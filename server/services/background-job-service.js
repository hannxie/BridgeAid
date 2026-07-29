import { resourceIsFresh } from '../../js/services/resource-service.js';

export function createJob(type, payload, now = new Date()) {
  const allowed = ['discovery', 'verification', 'geocoding', 'eligibility-extraction'];
  if (!allowed.includes(type)) throw new Error('Unsupported job type.');
  return {
    id: `${type}-${now.getTime()}`,
    type,
    payload,
    status: 'queued',
    attempts: 0,
    maxAttempts: 3,
    nextAttemptAt: now.toISOString(),
    failures: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
}

export function createVerificationJobs(resources = [], now = new Date(), maximum = 25) {
  return resources
    .filter(resource => resource?.id)
    .filter(resource => (
      resource.sourceUrls?.length
      || resource.officialWebsite
      || resource.hoursSourceUrl
      || resource.eligibilitySourceUrl
    ))
    .filter(resource => (
      !resourceIsFresh(resource, now.getTime())
      || !resource.hoursLastVerified
      || !resource.eligibilityLastVerified
    ))
    .sort((a, b) => {
      const aPriority = a.verificationPriority === 'high' || a.category === 'food' ? 0 : 1;
      const bPriority = b.verificationPriority === 'high' || b.category === 'food' ? 0 : 1;
      return aPriority - bPriority || String(a.id).localeCompare(String(b.id));
    })
    .slice(0, Math.max(0, Number(maximum) || 0))
    .map((resource, index) => ({
      ...createJob('verification', {
        resourceId: String(resource.id),
        checks: ['hours', 'eligibility', 'temporary-closure', 'special-events'],
        sourceUrls: [
          ...(resource.sourceUrls || []),
          resource.officialWebsite,
          resource.hoursSourceUrl,
          resource.eligibilitySourceUrl
        ].filter(Boolean)
      }, now),
      id: `verification-${resource.id}-${now.getTime()}-${index}`,
      priority: resource.verificationPriority === 'high' || resource.category === 'food' ? 'high' : 'normal'
    }));
}

export function createDiscoveryJobs(coverage = {}, targets = [], now = new Date(), maximum = 100) {
  const existing = coverage.byLocation || {};
  const normalizedTargets = targets
    .filter(target => target?.location && target?.category)
    .map(target => ({
      location: String(target.location).normalize('NFKC').trim(),
      category: String(target.category).trim(),
      radiusMiles: Math.min(25, Math.max(1, Number(target.radiusMiles) || 10))
    }))
    .filter(target => (existing[target.location]?.[target.category] || 0) < 3)
    .sort((a, b) => (
      (existing[a.location]?.[a.category] || 0) - (existing[b.location]?.[b.category] || 0)
      || a.location.localeCompare(b.location)
      || a.category.localeCompare(b.category)
    ))
    .slice(0, Math.max(0, Number(maximum) || 0));
  return normalizedTargets.map((target, index) => ({
    ...createJob('discovery', {
      ...target,
      sources: ['official-provider', 'government-directory', 'nonprofit-network', 'approved-place-api']
    }, now),
    id: `discovery-${target.location.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${target.category}-${now.getTime()}-${index}`,
    priority: (existing[target.location]?.[target.category] || 0) === 0 ? 'high' : 'normal'
  }));
}

export function createEligibilityResearchJobs(resources = [], now = new Date(), maximum = 25) {
  return resources
    .filter(resource => resource?.id)
    .filter(resource => {
      const verifiedAt = Date.parse(resource.eligibilityLastVerified || '');
      const stale = !Number.isFinite(verifiedAt) || now.getTime() - verifiedAt > 90 * 86400000;
      return stale
        || !Array.isArray(resource.eligibilityRules)
        || (!resource.eligibilityRules.length
          && !['no_restrictions_listed', 'open'].includes(resource.eligibilityStatus));
    })
    .sort((a, b) => {
      const aMissing = !a.eligibilityRules?.length ? 0 : 1;
      const bMissing = !b.eligibilityRules?.length ? 0 : 1;
      return aMissing - bMissing || String(a.id).localeCompare(String(b.id));
    })
    .slice(0, Math.max(0, Number(maximum) || 0))
    .map((resource, index) => ({
      ...createJob('eligibility-extraction', {
        resourceId: String(resource.id),
        organizationName: resource.organizationName || resource.name,
        programName: resource.programName || resource.name,
        sourceSequence: [
          'official-program-page',
          'official-eligibility-page',
          'application-or-intake-form',
          'official-faq',
          'program-guidelines',
          'required-documents-page',
          'trusted-government-or-nonprofit-directory',
          'recent-official-announcement'
        ],
        sourceUrls: [
          resource.eligibilitySourceUrl,
          resource.applicationSourceUrl,
          ...(resource.sourceUrls || [])
        ].filter(Boolean),
        requiredOutcomeFields: [
          'serviceArea', 'residency', 'age', 'income', 'householdSize', 'housingStatus',
          'insurance', 'employmentOrStudentStatus', 'disabilityOrVeteranStatus',
          'documents', 'exceptions', 'deadlines', 'applicationLink'
        ]
      }, now),
      id: `eligibility-${resource.id}-${now.getTime()}-${index}`,
      priority: resource.eligibilityRules?.length ? 'normal' : 'high'
    }));
}

export function recordEligibilityResearchOutcome(job, outcome, now = new Date()) {
  const allowed = ['rules_extracted', 'no_public_restrictions', 'ambiguous_review', 'source_not_found', 'technical_failure'];
  if (!allowed.includes(outcome?.status)) throw new Error('Unsupported eligibility research outcome.');
  const completed = ['rules_extracted', 'no_public_restrictions', 'source_not_found'].includes(outcome.status);
  return {
    ...job,
    status: completed ? 'completed' : outcome.status === 'ambiguous_review' ? 'needs_review' : 'failed',
    researchOutcome: {
      status: outcome.status,
      rules: Array.isArray(outcome.rules) ? outcome.rules : [],
      evidence: Array.isArray(outcome.evidence) ? outcome.evidence : [],
      reason: String(outcome.reason || ''),
      checkedAt: now.toISOString()
    },
    updatedAt: now.toISOString()
  };
}

export function recordJobFailure(job, error, now = new Date()) {
  const attempts = job.attempts + 1;
  const retryMinutes = Math.min(60, 2 ** attempts);
  return {
    ...job,
    attempts,
    status: attempts >= job.maxAttempts ? 'failed' : 'retrying',
    nextAttemptAt: attempts >= job.maxAttempts ? '' : new Date(now.getTime() + retryMinutes * 60000).toISOString(),
    failures: [...job.failures, { at: now.toISOString(), message: String(error?.message || error) }],
    updatedAt: now.toISOString()
  };
}
