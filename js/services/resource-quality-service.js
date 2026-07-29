const GENERIC_NAMES = [
  'community service organization',
  'nonprofit organization',
  'government office',
  'social services organization',
  'charity',
  'food bank',
  'unnamed organization'
];

const POLITICAL_PATTERN = /\b(?:u\.?s\.?\s+)?(?:senator|member of congress|congress(?:man|woman)?|representative|legislature|legislator|campaign|candidate|town hall|press release|constituent news|elected official)\b/i;

function identityText(resource = {}) {
  return [
    resource.organizationName,
    resource.programName,
    resource.name,
    resource.title,
    resource.pageTitle,
    resource.url,
    resource.website
  ].filter(Boolean).join(' ');
}

export function isGenericOrganizationName(value) {
  const name = String(value || '').normalize('NFKC').trim().toLowerCase();
  if (!name) return true;
  return GENERIC_NAMES.includes(name)
    || /^(?:community|nonprofit|government|social services?) (?:organization|office|agency)$/.test(name);
}

export function isDisallowedPoliticalResult(resource = {}) {
  return POLITICAL_PATTERN.test(identityText(resource));
}

export function hasSpecificProgramName(resource = {}) {
  return [resource.programName, resource.organizationName, resource.name]
    .some(value => value && !isGenericOrganizationName(value));
}

export function isDisplayableResource(resource = {}) {
  const name = resource.organizationName || resource.name;
  const category = String(resource.category || '');
  const hasArea = Boolean(
    resource.address
    || resource.city
    || resource.county
    || resource.zip
    || resource.latitude
    || resource.lat
    || resource.serviceAreas?.length
    || resource.scope === 'nationwide-online'
    || resource.scope === 'provider-directory'
  );
  const sources = Array.isArray(resource.sourceUrls)
    ? resource.sourceUrls.filter(Boolean)
    : [resource.url, resource.website, resource.osmUrl].filter(Boolean);
  const confidence = Number(resource.confidence);
  return Boolean(
    hasSpecificProgramName(resource)
    && !isGenericOrganizationName(name)
    && category
    && hasArea
    && sources.length
    && Number.isFinite(confidence)
    && (resource.resultType || resource.scope || resource.category)
    && !isDisallowedPoliticalResult(resource)
  );
}

export function resourceQualityReview(resource = {}) {
  const reasons = [];
  if (!hasSpecificProgramName(resource)) reasons.push('specific-name');
  if (isGenericOrganizationName(resource.organizationName || resource.name)) reasons.push('generic-name');
  if (isDisallowedPoliticalResult(resource)) reasons.push('political-entity');
  if (!(resource.sourceUrls?.length || resource.url || resource.website || resource.osmUrl)) reasons.push('source');
  if (!(resource.address || resource.serviceAreas?.length || resource.scope !== 'location')) reasons.push('service-area');
  if (!Number.isFinite(Number(resource.confidence))) reasons.push('confidence');
  return { displayable: reasons.length === 0, reviewRequired: reasons.length > 0, reasons };
}
