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
