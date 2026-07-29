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
