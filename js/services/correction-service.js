const ALLOWED_TYPES = [
  'address',
  'hours',
  'closed',
  'service',
  'eligibility',
  'registration',
  'duplicate',
  'other'
];

export function createCorrectionReport({ resource, type, details = '', now = new Date() }) {
  if (!resource?.id) throw new Error('A resource is required.');
  if (!ALLOWED_TYPES.includes(type)) throw new Error('Choose a valid correction type.');
  return {
    id: `correction-${resource.id}-${now.getTime()}`,
    resourceId: resource.id,
    resourceName: resource.name,
    type,
    details: String(details || ''),
    status: 'verification_queued',
    submittedAt: now.toISOString(),
    sourceUrls: [...(resource.sourceUrls || [])],
    verificationAttempts: [],
    proposedChange: null,
    requiresAdminReview: false
  };
}

export function queueCorrection(queue, report) {
  return [...(Array.isArray(queue) ? queue : []), report];
}

function evidenceSignal(type, text, responseOk) {
  const value = String(text || '').toLowerCase();
  if (type === 'registration' && !responseOk) return 'confirmed';
  if (type === 'closed' && /permanently closed|program closed|no longer operating|cerrado permanentemente|永久关闭/.test(value)) return 'confirmed';
  if (type === 'service' && /no longer offer|service discontinued|ya no ofrece|不再提供/.test(value)) return 'confirmed';
  return 'unclear';
}

export async function verifyCorrectionReport(report, resource, fetcher = fetch, now = new Date()) {
  const sources = (resource.sourceUrls || []).filter(Boolean);
  const attempts = [];
  for (const url of sources.slice(0, 3)) {
    try {
      const response = await fetcher(url, { headers: { Accept: 'text/html,application/json' } });
      const text = response.ok ? await response.text() : '';
      const signal = evidenceSignal(report.type, text, response.ok);
      attempts.push({ url, checkedAt: now.toISOString(), responseOk: response.ok, signal });
      if (signal === 'confirmed') {
        return {
          ...report,
          status: 'evidence_found',
          verificationAttempts: attempts,
          proposedChange: { type: report.type, evidenceUrl: url, verifiedAt: now.toISOString() },
          requiresAdminReview: true
        };
      }
    } catch (error) {
      attempts.push({ url, checkedAt: now.toISOString(), responseOk: false, signal: 'unavailable', error: String(error.message || error) });
    }
  }
  return {
    ...report,
    status: 'needs_admin_review',
    verificationAttempts: attempts,
    requiresAdminReview: true
  };
}
