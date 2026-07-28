export function questionsForRules(rules = [], answers = {}) {
  return rules
    .filter(rule => rule?.field && answers[rule.field] === undefined)
    .map(rule => ({ field: rule.field, question: rule.question || `What is the ${rule.field}?` }));
}

export function evaluateEligibility(rules = [], answers = {}) {
  if (!rules.length) {
    return {
      status: 'Unable to determine',
      reasons: ['The organization has not published structured eligibility rules.'],
      missing: []
    };
  }
  const reasons = [];
  const details = [];
  const missing = [];
  let failed = false;
  for (const rule of rules) {
    const value = answers[rule.field];
    if (value === undefined || value === '') {
      missing.push(rule.field);
      continue;
    }
    let passed = true;
    if (rule.operator === 'lte') passed = Number(value) <= Number(rule.value);
    if (rule.operator === 'gte') passed = Number(value) >= Number(rule.value);
    if (rule.operator === 'eq') passed = String(value).toLowerCase() === String(rule.value).toLowerCase();
    if (rule.operator === 'in') passed = (rule.value || []).map(String).map(v => v.toLowerCase()).includes(String(value).toLowerCase());
    if (rule.operator === 'incomeTable') {
      const size = Number(answers.householdSize);
      const limit = Number(rule.value?.[size] ?? rule.value?.default);
      if (!size || !Number.isFinite(limit)) missing.push('householdSize');
      else passed = Number(value) <= limit;
    }
    reasons.push(`${rule.label || rule.field}: ${passed ? 'meets the published rule' : 'does not meet the published rule'}.`);
    details.push({ field: rule.field, label: rule.label || rule.field, passed });
    failed ||= !passed;
  }
  if (failed) return { status: 'Likely not eligible', reasons, details, missing: [...new Set(missing)] };
  if (missing.length) return { status: 'Possibly eligible', reasons, details, missing: [...new Set(missing)] };
  return { status: 'Likely eligible', reasons, details, missing: [] };
}

export function summarizeEligibility(resource) {
  const summary = resource.eligibilitySummary || resource.eligibility || '';
  return {
    summary: typeof summary === 'string' ? summary : summary.en || '',
    sourceUrl: resource.eligibilitySourceUrl || resource.officialWebsite || resource.website || resource.url || '',
    lastVerified: resource.lastVerified || resource.verified || '',
    disclaimer: 'Only the organization can confirm eligibility.'
  };
}
