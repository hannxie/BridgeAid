export function addPlanResource(plan, resource, now = new Date()) {
  if (plan.some(item => item.id === resource.id)) return plan;
  return [...plan, {
    id: resource.id,
    name: resource.name,
    phone: resource.phone || '',
    website: resource.officialWebsite || resource.website || '',
    directions: resource.directions || '',
    status: 'Not contacted',
    note: '',
    questions: '',
    eligibilitySummary: resource.eligibilitySummary || '',
    registrationRequirement: resource.registrationRequirement || '',
    requiredDocuments: resource.requiredDocuments || [],
    address: resource.address || '',
    category: resource.category || 'all',
    services: resource.services || [],
    distance: Number.isFinite(resource.distance) ? resource.distance : null,
    hours: resource.hours || '',
    weeklyHours: resource.weeklyHours || null,
    onlineAlwaysAvailable: Boolean(resource.onlineAlwaysAvailable),
    timeZone: resource.timeZone || '',
    hoursLastVerified: resource.hoursLastVerified || '',
    lastVerified: resource.lastVerified || '',
    verificationStatus: resource.verificationStatus || '',
    discoveryStatus: resource.discoveryStatus || '',
    applicationMethods: resource.applicationMethods || [],
    applicationLinks: resource.applicationLinks || [],
    registrationUrl: resource.registrationUrl || '',
    appointmentOnly: Boolean(resource.appointmentOnly),
    appointmentRequirement: resource.appointmentRequirement || '',
    accessibility: resource.accessibility || [],
    applicationDeadline: resource.applicationDeadline || '',
    eligibilityStatus: resource.eligibilityStatus || '',
    localEligibilityVerified: Boolean(resource.localEligibilityVerified),
    planCreated: now.toISOString()
  }];
}

export function updatePlanStatus(plan, id, status) {
  const allowed = ['Not contacted', 'Called', 'Confirmed', 'Unavailable'];
  if (!allowed.includes(status)) return plan;
  return plan.map(item => item.id === id ? { ...item, status } : item);
}

export function updatePlanNote(plan, id, note) {
  return plan.map(item => item.id === id ? { ...item, note: String(note || '') } : item);
}

export function updatePlanQuestions(plan, id, questions) {
  return plan.map(item => item.id === id ? { ...item, questions: String(questions || '') } : item);
}

export function removePlanResource(plan, id) {
  return plan.filter(item => item.id !== id);
}

export function clearPlan() {
  return { plan: [], intake: {} };
}
