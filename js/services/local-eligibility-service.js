import { evaluateEligibility } from './eligibility-service.js';
import { normalizeResource } from './resource-service.js?v=11';

function locationTokens(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9\u3400-\u9fff]+/)
    .filter(token => token.length >= 2);
}

export function servesLocation(resource, location) {
  const normalized = normalizeResource(resource);
  const query = String(location || '').normalize('NFKC').trim().toLowerCase();
  const tokens = locationTokens(location);
  const zip = Number(String(location || '').match(/\b\d{5}\b/)?.[0]);
  const inPublishedRange = Number.isFinite(zip) && (resource.serviceAreaZipRanges || [])
    .some(([minimum, maximum]) => zip >= Number(minimum) && zip <= Number(maximum));
  const matchesPrefix = Number.isFinite(zip) && (resource.serviceAreaZipPrefixes || [])
    .some(prefix => String(zip).startsWith(String(prefix)));
  const exactZip = Number.isFinite(zip) && String(normalized.zip) === String(zip);
  if (inPublishedRange || matchesPrefix || exactZip) return true;

  const namedAreas = [
    normalized.city,
    normalized.county,
    ...(resource.serviceAreas || [])
  ]
    .map(value => String(value || '').toLowerCase().trim())
    .filter(value => value.length >= 3);
  const namedMatch = namedAreas.some(area =>
    query.includes(area) || (query.length >= 4 && area.includes(query)));
  if (namedMatch) return true;

  const genericLocationWords = new Set(['county', 'city', 'state', 'near', 'area']);
  const meaningfulTokens = tokens.filter(token => token.length >= 3 && !genericLocationWords.has(token));
  const areaTokens = new Set(namedAreas.flatMap(locationTokens).filter(token => !genericLocationWords.has(token)));
  if (meaningfulTokens.some(token => areaTokens.has(token))) return true;

  const addressQuery = query.replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedAddress = normalized.address.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (/\d/.test(addressQuery) && addressQuery.length >= 5 && normalizedAddress.includes(addressQuery)) return true;

  const stateOnly = tokens.length === 1 && tokens[0].length === 2;
  return stateOnly && tokens[0] === normalized.state.toLowerCase();
}

export function localProgramForResource(resource, location) {
  if (!resource) return null;
  const normalized = normalizeResource(resource);
  const inServiceArea = normalized.scope === 'nationwide-online' || servesLocation(resource, location);
  const verifiedRules = normalized.eligibilityRules.length > 0
    && Boolean(resource.eligibilitySourceUrl || normalized.sourceUrls[0])
    && inServiceArea;
  const publishedStatus = normalized.eligibilityStatus
    || (!normalized.eligibilityRules.length && resource.eligibilitySourceUrl ? 'no_restrictions_listed' : '');
  return {
    ...normalized,
    localEligibilityVerified: verifiedRules,
    eligibilityStatus: publishedStatus,
    inServiceArea,
    eligibilityLocation: location,
    eligibilitySourceUrl: resource.eligibilitySourceUrl || normalized.sourceUrls[0] || '',
    eligibilityLastVerified: resource.eligibilityLastVerified || normalized.lastVerified || ''
  };
}

export function localEligibilityQuestions(resource, location, answers = {}) {
  const program = localProgramForResource(resource, location);
  if (!program?.localEligibilityVerified) return [];
  return program.eligibilityRules
    .filter(rule => rule?.field && rule.operator !== 'always')
    .map(rule => ({
      field: rule.field,
      question: rule.question || rule.label || rule.field,
      operator: rule.operator || '',
      value: rule.value,
      answered: answers[rule.field] !== undefined && answers[rule.field] !== ''
    }));
}

export function evaluateLocalEligibility(resource, location, answers = {}) {
  const program = localProgramForResource(resource, location);
  if (!program) {
    return { status: 'Eligibility information temporarily unavailable', passed: [], failed: [], missing: ['program', 'location'], reasons: [], program: null };
  }
  if (!program.localEligibilityVerified) {
    const noListedRequirements = program.inServiceArea
      && ['no_restrictions_listed', 'open'].includes(program.eligibilityStatus);
    return {
      status: noListedRequirements
        ? 'No eligibility requirements published'
        : 'Eligibility information temporarily unavailable',
      passed: [],
      failed: [],
      missing: program.inServiceArea
        ? ['published structured eligibility rules']
        : ['verified local service area'],
      reasons: [],
      program
    };
  }
  const evaluated = evaluateEligibility(program.eligibilityRules, answers);
  const passed = (evaluated.details || []).filter(detail => detail.passed);
  const failed = (evaluated.details || []).filter(detail => !detail.passed);
  return { ...evaluated, passed, failed, program };
}
