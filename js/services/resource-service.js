const FRESH_FOR_MS = 24 * 60 * 60 * 1000;

export function textFor(value, language = 'en') {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value[language] || value.en || '';
}

export function normalizeResource(resource, language = 'en') {
  const rawLatitude = resource.latitude ?? resource.lat;
  const rawLongitude = resource.longitude ?? resource.lng;
  const rawDistance = resource.distance;
  const sourceUrls = Array.isArray(resource.sourceUrls)
    ? resource.sourceUrls.filter(Boolean)
    : [resource.url || resource.osmUrl].filter(Boolean);
  const services = Array.isArray(resource.services)
    ? resource.services
    : [resource.category].filter(Boolean);
  return {
    id: String(resource.id || ''),
    organizationName: resource.organizationName || resource.name || 'Unnamed organization',
    programName: resource.programName || '',
    name: resource.name || resource.organizationName || 'Unnamed organization',
    category: resource.category || 'all',
    subcategories: Array.isArray(resource.subcategories) ? resource.subcategories : [],
    services,
    description: textFor(resource.description, language),
    phone: resource.phone || '',
    email: resource.email || '',
    address: resource.address || '',
    city: resource.city || '',
    county: resource.county || '',
    state: resource.state || '',
    zip: resource.zip || '',
    latitude: rawLatitude !== null && rawLatitude !== undefined && rawLatitude !== '' && Number.isFinite(Number(rawLatitude)) ? Number(rawLatitude) : null,
    longitude: rawLongitude !== null && rawLongitude !== undefined && rawLongitude !== '' && Number.isFinite(Number(rawLongitude)) ? Number(rawLongitude) : null,
    website: resource.website || resource.url || '',
    officialWebsite: resource.officialWebsite || resource.url || '',
    registrationUrl: resource.registrationUrl || '',
    hours: textFor(resource.hours, language),
    scheduleRules: Array.isArray(resource.scheduleRules) ? resource.scheduleRules : [],
    scheduleLabel: resource.scheduleLabel || (textFor(resource.hours, language) ? 'typical' : 'uncertain'),
    scheduleVerificationStatus: resource.scheduleVerificationStatus || '',
    scheduleSourceUrl: resource.scheduleSourceUrl || '',
    scheduleLastVerified: resource.scheduleLastVerified || '',
    scheduleVerificationAttempts: Array.isArray(resource.scheduleVerificationAttempts) ? resource.scheduleVerificationAttempts : [],
    nextEvent: resource.nextEvent || '',
    availabilityStatus: resource.availabilityStatus || 'Schedule uncertain',
    appointmentRequirement: resource.appointmentRequirement || '',
    walkInStatus: resource.walkInStatus || '',
    eligibilitySummary: textFor(resource.eligibilitySummary || resource.eligibility, language),
    eligibilityRules: Array.isArray(resource.eligibilityRules) ? resource.eligibilityRules : [],
    eligibilitySourceUrl: resource.eligibilitySourceUrl || '',
    eligibilityLastVerified: resource.eligibilityLastVerified || '',
    eligibilityExceptions: Array.isArray(resource.eligibilityExceptions) ? resource.eligibilityExceptions.map(value => textFor(value, language)) : [],
    serviceAreas: Array.isArray(resource.serviceAreas) ? resource.serviceAreas : [],
    localEligibilityVerified: Boolean(resource.localEligibilityVerified),
    requiredDocuments: Array.isArray(resource.requiredDocuments) ? resource.requiredDocuments.map(value => textFor(value, language)) : [],
    accessibility: Array.isArray(resource.accessibility) ? resource.accessibility.map(value => textFor(value, language)) : [],
    languages: Array.isArray(resource.languages) ? resource.languages.map(value => textFor(value, language)) : [],
    transportation: Array.isArray(resource.transportation) ? resource.transportation.map(value => textFor(value, language)) : [],
    registrationRequirement: resource.registrationRequirement || textFor(resource.access, language),
    freeStatus: resource.freeStatus || 'Confirm with organization',
    source: resource.source || 'Source not named',
    sourceUrls,
    dateDiscovered: resource.dateDiscovered || '',
    lastVerified: resource.lastVerified || resource.verified || '',
    confidence: Number.isFinite(Number(resource.confidence)) ? Number(resource.confidence) : null,
    verificationStatus: resource.verificationStatus || (resource.verified ? 'Previously checked' : 'Needs confirmation'),
    conflicts: Array.isArray(resource.conflicts) ? resource.conflicts : [],
    changeHistory: Array.isArray(resource.changeHistory) ? resource.changeHistory : [],
    keywords: Array.isArray(resource.keywords) ? resource.keywords : [],
    distance: rawDistance !== null && rawDistance !== undefined && rawDistance !== '' && Number.isFinite(Number(rawDistance)) ? Number(rawDistance) : null
  };
}

export function resourceKey(resource) {
  const r = normalizeResource(resource);
  return `${r.name}|${r.address}|${r.phone}`.toLowerCase().replace(/\W/g, '');
}

export function mergeDuplicates(resources) {
  const merged = new Map();
  for (const item of resources) {
    const key = resourceKey(item) || String(item.id);
    if (!merged.has(key)) {
      merged.set(key, { ...item, sourceUrls: [...(item.sourceUrls || [])] });
      continue;
    }
    const existing = merged.get(key);
    const combinedSources = new Set([
      ...(existing.sourceUrls || []),
      ...(item.sourceUrls || []),
      existing.url,
      item.url,
      existing.osmUrl,
      item.osmUrl
    ].filter(Boolean));
    merged.set(key, {
      ...item,
      ...existing,
      sourceUrls: [...combinedSources],
      conflicts: [...new Set([...(existing.conflicts || []), ...(item.conflicts || [])])]
    });
  }
  return [...merged.values()];
}

export function cacheKey(location, category, radius) {
  return `${String(location).trim().toLowerCase()}|${category || 'all'}|${Number(radius) || 5}`;
}

export function readCachedSearch(cache, key, now = Date.now()) {
  const entry = cache?.[key];
  if (!entry || !Array.isArray(entry.resources)) return null;
  return { ...entry, stale: now - Number(entry.savedAt || 0) > FRESH_FOR_MS };
}

export function writeCachedSearch(cache, key, resources, now = Date.now()) {
  return { ...(cache || {}), [key]: { savedAt: now, resources: mergeDuplicates(resources) } };
}

export function filterResources(resources, filters = {}) {
  return resources.filter(resource => {
    const r = normalizeResource(resource);
    if (filters.radius && r.distance !== null && r.distance > Number(filters.radius)) return false;
    if (filters.openNow && r.availabilityStatus !== 'Open now') return false;
    if (filters.availableToday && !['Open now', 'Available today'].includes(r.availabilityStatus)) return false;
    if (filters.walkIn && !/yes|accepted|walk-in/i.test(r.walkInStatus)) return false;
    if (filters.noId && r.requiredDocuments.some(d => /\bid\b|identification/i.test(d))) return false;
    if (filters.noRegistration && r.registrationRequirement && !/not required|none/i.test(r.registrationRequirement)) return false;
    if (filters.accessible && !r.accessibility.some(a => /wheelchair/i.test(a))) return false;
    if (filters.language && !r.languages.some(l => l.toLowerCase() === filters.language.toLowerCase())) return false;
    if (filters.confidence && (r.confidence ?? 0) < Number(filters.confidence)) return false;
    return true;
  });
}

export function rankResources(resources, context = {}) {
  const wanted = new Set(context.categories || []);
  return resources.map(item => {
    const r = normalizeResource(item);
    let score = 0;
    if (wanted.has(r.category) || r.services.some(s => wanted.has(s))) score += 40;
    if (r.distance !== null) score += Math.max(0, 25 - r.distance * 2);
    if (r.availabilityStatus === 'Open now') score += 18;
    if (r.walkInStatus) score += 5;
    if (r.sourceUrls.length) score += 6;
    if (r.confidence !== null) score += r.confidence * 10;
    return { ...item, _rank: score };
  }).sort((a, b) => b._rank - a._rank);
}
