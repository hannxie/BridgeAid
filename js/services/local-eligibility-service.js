import { evaluateEligibility } from './eligibility-service.js';
import { normalizeResource } from './resource-service.js';

function locationTokens(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9\u3400-\u9fff]+/)
    .filter(token => token.length >= 2);
}

export function servesLocation(resource, location) {
  const normalized = normalizeResource(resource);
  const searchable = [
    normalized.address,
    normalized.city,
    normalized.county,
    normalized.state,
    normalized.zip,
    ...(resource.serviceAreas || [])
  ].join(' ').toLowerCase();
  const tokens = locationTokens(location);
  const zip = Number(String(location || '').match(/\b\d{5}\b/)?.[0]);
  const inPublishedRange = Number.isFinite(zip) && (resource.serviceAreaZipRanges || [])
    .some(([minimum, maximum]) => zip >= Number(minimum) && zip <= Number(maximum));
  const matchesPrefix = Number.isFinite(zip) && (resource.serviceAreaZipPrefixes || [])
    .some(prefix => String(zip).startsWith(String(prefix)));
  return Boolean((tokens.length && tokens.some(token => searchable.includes(token))) || inPublishedRange || matchesPrefix);
}

export function localProgramForResource(resource, location) {
  if (!resource) return null;
  const normalized = normalizeResource(resource);
  const verifiedRules = normalized.eligibilityRules.length > 0
    && Boolean(resource.eligibilitySourceUrl || normalized.sourceUrls[0])
    && servesLocation(resource, location);
  return {
    ...normalized,
    localEligibilityVerified: verifiedRules,
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
    return { status: 'Unable to determine', passed: [], failed: [], missing: ['program', 'location'], reasons: [], program: null };
  }
  if (!program.localEligibilityVerified) {
    return {
      status: 'Unable to determine',
      passed: [],
      failed: [],
      missing: program.eligibilityRules.length ? ['verified local service area'] : ['verified local eligibility rules'],
      reasons: [],
      program
    };
  }
  const evaluated = evaluateEligibility(program.eligibilityRules, answers);
  const passed = (evaluated.details || []).filter(detail => detail.passed);
  const failed = (evaluated.details || []).filter(detail => !detail.passed);
  return { ...evaluated, passed, failed, program };
}
