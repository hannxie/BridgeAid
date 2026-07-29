import { normalizeResource } from './resource-service.js?v=13';

function csvCell(value) {
  const text = Array.isArray(value)
    ? value.join(' | ')
    : typeof value === 'object' && value !== null
      ? JSON.stringify(value)
      : String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export function eligibilityRecord(resource) {
  const normalized = normalizeResource(resource);
  return {
    organization: normalized.organizationName,
    program: normalized.programName || normalized.name,
    service_category: normalized.category,
    service_area: normalized.scope === 'nationwide-online'
      ? 'United States'
      : normalized.serviceAreas.join(' | '),
    residency_requirements: normalized.eligibilityDetails.geographicRestrictions || '',
    age_requirements: normalized.eligibilityDetails.ageHouseholdRequirements || '',
    income_limits: normalized.eligibilityDetails.incomeRequirements || '',
    household_size_rules: normalized.eligibilityRules.filter(rule => rule.operator === 'incomeTable'),
    housing_status: normalized.eligibilityRules.filter(rule => rule.field === 'housingStatus'),
    insurance_requirements: normalized.eligibilityRules.filter(rule => rule.field === 'insuranceStatus'),
    employment_or_student_status: normalized.eligibilityRules.filter(rule => ['employmentStatus', 'studentStatus'].includes(rule.field)),
    disability_or_veteran_requirements: normalized.eligibilityRules.filter(rule => ['disabilityStatus', 'veteranStatus'].includes(rule.field)),
    documentation_requirements: normalized.requiredDocuments,
    exceptions: normalized.eligibilityExceptions,
    application_deadline: normalized.applicationDeadline,
    eligibility_page: normalized.eligibilitySourceUrl,
    application_link: normalized.applicationLinks[0]?.url || normalized.registrationUrl,
    eligibility_status: normalized.eligibilityStatus,
    research_status: normalized.eligibilityResearchStatus,
    last_verified: normalized.eligibilityLastVerified || normalized.lastVerified,
    internal_source_records: normalized.sourceUrls
  };
}

export function exportEligibilityCsv(resources = []) {
  const records = resources
    .filter(resource => resource?.id)
    .map(eligibilityRecord);
  if (!records.length) return '';
  const headers = Object.keys(records[0]);
  return [
    headers.map(csvCell).join(','),
    ...records.map(record => headers.map(header => csvCell(record[header])).join(','))
  ].join('\r\n');
}
