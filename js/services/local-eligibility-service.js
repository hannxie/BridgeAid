import { evaluateEligibility } from './eligibility-service.js';
import { normalizeResource } from './resource-service.js?v=16';
import { eligibilityForLocation, matchesUserLocation } from './location-eligibility-service.js';

function locationTokens(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9\u3400-\u9fff]+/)
    .filter(token => token.length >= 2);
}

export function servesLocation(resource, location) {
  return matchesUserLocation(normalizeResource(resource), location).serves === true;
}

export function localProgramForResource(resource, location) {
  if (!resource) return null;
  const normalized = normalizeResource(resource);
  const locationEligibility = eligibilityForLocation(normalized, location);
  const hasPublishedServiceArea = Boolean(
    normalized.city
    || normalized.county
    || normalized.zip
    || normalized.serviceAreas.length
    || normalized.serviceAreaZipRanges.length
    || normalized.serviceAreaZipPrefixes.length
  );
  const nearbyDiscoveredResource = normalized.scope === 'location'
    && normalized.distance !== null
    && !hasPublishedServiceArea;
  const inServiceArea = locationEligibility.serves === true
    || nearbyDiscoveredResource;
  const applicableRules = locationEligibility.rules || [];
  const verifiedRules = applicableRules.length > 0
    && Boolean(resource.eligibilitySourceUrl || normalized.sourceUrls[0])
    && inServiceArea;
  const publishedStatus = normalized.eligibilityStatus;
  return {
    ...normalized,
    eligibilityRules: applicableRules,
    localEligibilityVerified: verifiedRules,
    eligibilityStatus: publishedStatus,
    inServiceArea,
    eligibilityLocation: location,
    eligibilitySourceUrl: locationEligibility.sourceUrl || resource.eligibilitySourceUrl || normalized.sourceUrls[0] || '',
    eligibilityLastVerified: locationEligibility.lastVerified || resource.eligibilityLastVerified || normalized.lastVerified || '',
    locationEligibility
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
    const technicalFailure = program.eligibilityResearchStatus === 'technical_failure';
    const needsReview = program.eligibilityResearchStatus === 'ambiguous_review';
    const outOfArea = !program.inServiceArea;
    return {
      status: outOfArea
        ? 'Program does not serve this location'
        : noListedRequirements
          ? 'No eligibility requirements published'
          : technicalFailure
            ? 'Eligibility information temporarily unavailable'
            : needsReview
              ? 'Eligibility details require review'
              : 'Eligibility research pending',
      passed: [],
      failed: [],
      missing: outOfArea
        ? ['verified local service area']
        : noListedRequirements
          ? []
          : ['published structured eligibility rules'],
      reasons: program.eligibilityResearchReason ? [program.eligibilityResearchReason] : [],
      program
    };
  }
  const evaluated = evaluateEligibility(program.eligibilityRules, answers);
  const passed = (evaluated.details || []).filter(detail => detail.passed);
  const failed = (evaluated.details || []).filter(detail => !detail.passed);
  return { ...evaluated, passed, failed, program };
}
