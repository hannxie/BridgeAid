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
    eligibilitySummary: resource.eligibilitySummary || '',
    registrationRequirement: resource.registrationRequirement || '',
    requiredDocuments: resource.requiredDocuments || [],
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

export function removePlanResource(plan, id) {
  return plan.filter(item => item.id !== id);
}

export function clearPlan() {
  return { plan: [], intake: {} };
}
