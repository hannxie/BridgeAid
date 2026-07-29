const STATE_CODES = Object.freeze({
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin',
  WY: 'Wyoming', PR: 'Puerto Rico'
});

const STATE_BY_NAME = new Map(Object.entries(STATE_CODES)
  .map(([code, name]) => [name.toLowerCase(), code]));

function clean(value) {
  return String(value || '').normalize('NFKC').trim();
}

function stateCode(value) {
  const candidate = clean(value);
  if (/^[A-Z]{2}$/i.test(candidate) && STATE_CODES[candidate.toUpperCase()]) {
    return candidate.toUpperCase();
  }
  return STATE_BY_NAME.get(candidate.toLowerCase()) || '';
}

export function locationContext(value = {}) {
  const source = typeof value === 'string' ? { label: value } : (value || {});
  const label = clean(source.label || source.location);
  const zip = clean(source.zip || label.match(/\b\d{5}(?:-\d{4})?\b/)?.[0]).slice(0, 5);
  const explicitState = stateCode(source.stateCode || source.state);
  const abbreviation = label.match(/(?:,|\s)\s*([A-Z]{2})(?:\s+\d{5})?(?:,|$)/i)?.[1];
  const namedState = [...STATE_BY_NAME.keys()].find(name => label.toLowerCase().includes(name));
  const state = explicitState || stateCode(abbreviation) || stateCode(namedState);
  const countyMatch = clean(source.county || label.match(/([^,]+ County)\b/i)?.[1]);
  const city = clean(source.city || label.split(',')[0]).replace(/\b\d{5}(?:-\d{4})?\b/g, '').trim();
  return {
    label,
    city,
    county: countyMatch,
    state,
    stateName: STATE_CODES[state] || '',
    zip,
    lat: Number.isFinite(Number(source.lat)) ? Number(source.lat) : null,
    lng: Number.isFinite(Number(source.lng)) ? Number(source.lng) : null
  };
}

function normalized(value) {
  return clean(value).toLowerCase().replace(/\s+/g, ' ');
}

function zipMatches(resource, context) {
  if (!context.zip) return false;
  if (clean(resource.zip).slice(0, 5) === context.zip) return true;
  if ((resource.serviceAreaZipPrefixes || []).some(prefix => context.zip.startsWith(String(prefix)))) return true;
  return (resource.serviceAreaZipRanges || [])
    .some(([minimum, maximum]) => Number(context.zip) >= Number(minimum)
      && Number(context.zip) <= Number(maximum));
}

function namedAreaMatches(resource, context) {
  const areas = [
    resource.address,
    resource.city,
    resource.county,
    ...(resource.serviceAreas || [])
  ].map(normalized).filter(Boolean);
  const candidates = [context.city, context.county, context.label].map(normalized).filter(Boolean);
  return areas.some(area => candidates.some(candidate =>
    candidate === area || candidate.includes(area) || area.includes(candidate)));
}

export function matchesUserLocation(resource, rawContext) {
  const context = locationContext(rawContext);
  const scope = resource.scope || 'location';
  if (scope === 'nationwide-online' && !resource.stateVariation) {
    return { code: 'national', confirmed: true, serves: true, level: 'national', context };
  }
  if (!context.label && !context.state && !context.zip) {
    return { code: 'missing', confirmed: false, serves: null, level: '', context };
  }
  if (zipMatches(resource, context)) {
    return { code: 'zip', confirmed: true, serves: true, level: 'zip', context };
  }
  if (namedAreaMatches(resource, context)) {
    const level = resource.county && normalized(resource.county) === normalized(context.county) ? 'county' : 'city';
    return { code: level, confirmed: true, serves: true, level, context };
  }
  const resourceState = stateCode(resource.state);
  if (resourceState && context.state) {
    if (resourceState !== context.state) {
      return { code: 'out-of-area', confirmed: true, serves: false, level: 'state', context };
    }
    const hasNarrowArea = Boolean(
      resource.city
      || resource.county
      || resource.zip
      || resource.serviceAreas?.length
      || resource.serviceAreaZipRanges?.length
      || resource.serviceAreaZipPrefixes?.length
    );
    return hasNarrowArea
      ? { code: 'unconfirmed', confirmed: false, serves: null, level: 'state', context }
      : { code: 'state', confirmed: true, serves: true, level: 'state', context };
  }
  if (scope === 'provider-directory') {
    return { code: context.state ? 'state' : 'unconfirmed', confirmed: Boolean(context.state), serves: true, level: 'state', context };
  }
  return { code: 'unconfirmed', confirmed: false, serves: null, level: '', context };
}

export function eligibilityForLocation(resource, rawContext) {
  const context = locationContext(rawContext);
  const match = matchesUserLocation(resource, context);
  if (match.serves === false) {
    return { ...match, rules: [], sourceUrl: resource.eligibilitySourceUrl || '', requiresConfirmation: true };
  }
  const byState = resource.eligibilityByState || resource.eligibilityRulesByState || {};
  const localProfile = context.state ? byState[context.state] : null;
  if (localProfile) {
    return {
      ...match,
      code: match.code === 'unconfirmed' ? 'state' : match.code,
      confirmed: true,
      serves: match.serves !== false,
      rules: localProfile.rules || localProfile.eligibilityRules || [],
      sourceUrl: localProfile.sourceUrl || localProfile.eligibilitySourceUrl || resource.eligibilitySourceUrl || '',
      lastVerified: localProfile.lastVerified || resource.lastEligibilityVerified || '',
      requiresConfirmation: Boolean(localProfile.requiresOfficialConfirmation)
    };
  }
  if (resource.stateVariation) {
    return {
      ...match,
      code: context.state ? 'rules-unconfirmed' : 'missing',
      confirmed: false,
      serves: match.serves,
      rules: [],
      sourceUrl: resource.eligibilitySourceUrl || '',
      lastVerified: resource.lastEligibilityVerified || '',
      requiresConfirmation: true
    };
  }
  return {
    ...match,
    rules: resource.eligibilityRules || [],
    sourceUrl: resource.eligibilitySourceUrl || '',
    lastVerified: resource.lastEligibilityVerified || '',
    requiresConfirmation: Boolean(resource.requiresOfficialConfirmation)
  };
}

export function locationStatusKey(result) {
  return {
    national: 'locationServesNationwide',
    state: 'locationServesState',
    county: 'locationServesCounty',
    city: 'locationServesCity',
    zip: 'locationServesZip',
    'out-of-area': 'locationNotAvailable',
    missing: 'locationNeeded',
    'rules-unconfirmed': 'locationRulesUnconfirmed',
    unconfirmed: 'locationEligibilityUnconfirmed'
  }[result?.code] || 'locationEligibilityUnconfirmed';
}
