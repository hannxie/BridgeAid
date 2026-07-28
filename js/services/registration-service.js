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

export function registrationGuidance(resource) {
  const registrationUrl = resource.registrationUrl || '';
  const officialDomains = resource.officialDomains || [];
  const validation = registrationUrl
    ? validateRegistrationLink(registrationUrl, officialDomains)
    : { valid: false, reason: 'No verified online application is published.' };
  const requirement = String(resource.registrationRequirement || '').toLowerCase();
  const notRequired = /not required|no registration|walk.?in|无需登记|不需要登记|no requiere inscripción/i.test(requirement);
  const phoneOrInPerson = !validation.valid && Boolean(resource.phone || resource.address);
  const actions = (resource.applicationLinks || [])
    .map(link => {
      const checked = validateRegistrationLink(link.url, officialDomains);
      return checked.valid ? { ...link, url: checked.url } : null;
    })
    .filter(Boolean);
  if (validation.valid && !actions.some(action => action.url === validation.url)) {
    actions.unshift({ type: 'application', url: validation.url, label: '' });
  }
  return {
    applicationUrl: validation.valid ? validation.url : '',
    officialWebsite: resource.officialWebsite || resource.website || resource.url || '',
    phone: resource.phone || '',
    address: resource.address || '',
    requiredDocuments: Array.isArray(resource.requiredDocuments) ? resource.requiredDocuments : [],
    applicationSteps: Array.isArray(resource.applicationSteps) ? resource.applicationSteps : [],
    applicationMethods: Array.isArray(resource.applicationMethods) ? resource.applicationMethods : [],
    applicationActions: actions,
    applicationDeadline: resource.applicationDeadline || '',
    appointmentRequirement: resource.appointmentRequirement || '',
    afterApplying: resource.afterApplying || '',
    applicationSourceUrl: resource.applicationSourceUrl || '',
    applicationLastVerified: resource.applicationLastVerified || resource.lastVerified || resource.verified || '',
    notRequired,
    phoneOrInPerson,
    hasVerifiedPath: validation.valid || actions.length > 0 || notRequired || phoneOrInPerson || Boolean(resource.officialWebsite || resource.website || resource.url),
    validationReason: validation.valid ? '' : validation.reason,
    neverSubmitAutomatically: true
  };
}
