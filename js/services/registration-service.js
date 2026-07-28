export function validateRegistrationLink(url, officialDomains = []) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return { valid: false, reason: 'The form is not served over HTTPS.' };
    if (officialDomains.length && !officialDomains.some(domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`))) {
      return { valid: false, reason: 'The form domain is not on the approved official-domain list.' };
    }
    return { valid: true, url: parsed.href };
  } catch {
    return { valid: false, reason: 'The registration link is invalid.' };
  }
}

export function registrationSteps(resource) {
  const url = resource.registrationUrl || '';
  const validation = url ? validateRegistrationLink(url, resource.officialDomains || []) : { valid: false };
  const steps = [
    resource.requiredDocuments?.length ? `Gather: ${resource.requiredDocuments.join(', ')}.` : 'Ask which documents are required.',
    resource.phone ? 'Call if you need an accommodation, interpreter, or paper option.' : 'Check the official site for accommodations or a paper option.'
  ];
  if (validation.valid) steps.unshift('Open the official form and review it before entering personal information.');
  else steps.unshift('No verified online form is available. Contact the organization before sharing personal information.');
  return {
    formUrl: validation.valid ? validation.url : '',
    steps,
    warning: 'BridgeAid will not submit or finalize a form without your explicit confirmation.'
  };
}

export function maySubmitRegistration({ confirmed = false, authorized = false } = {}) {
  return Boolean(confirmed && authorized);
}
