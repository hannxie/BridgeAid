export const ELIGIBILITY_RESEARCH_DATE = '2026-07-29';

const open = (sourceName, notes = 'This resource is open for information, referral, search, or general use; a downstream program may apply its own rules.') => ({
  eligibilityType: 'open-access',
  eligibilityRules: [{ field: 'serviceNeed', operator: 'always', label: 'Open access for the published service' }],
  eligibilityQuestions: [],
  officialSourceName: sourceName,
  eligibilityConfidence: 'high',
  eligibilityNotes: notes,
  stateVariation: false,
  requiresOfficialConfirmation: false,
  manualReview: false
});

const directory = (sourceName, stateVariation = true) => ({
  eligibilityType: 'provider-directory',
  eligibilityRules: [],
  eligibilityQuestions: ['state'],
  officialSourceName: sourceName,
  eligibilityConfidence: 'high',
  eligibilityNotes: 'This is a locator or referral directory, not a benefit program. Eligibility is determined by the listed local provider or program.',
  stateVariation,
  requiresOfficialConfirmation: true,
  manualReview: false
});

const reviewed = (sourceName, type, questions, rules, options = {}) => ({
  eligibilityType: type,
  eligibilityQuestions: questions,
  eligibilityRules: rules,
  officialSourceName: sourceName,
  eligibilityConfidence: options.confidence || 'high',
  eligibilityNotes: options.notes || 'Preliminary screening only. The administering organization makes the final decision.',
  stateVariation: Boolean(options.stateVariation),
  requiresOfficialConfirmation: options.requiresOfficialConfirmation ?? true,
  manualReview: Boolean(options.manualReview)
});

const manual = (sourceName, type, questions = [], options = {}) => reviewed(
  sourceName,
  type,
  questions,
  options.rules || [],
  {
    confidence: options.confidence || 'medium',
    notes: options.notes || 'Public eligibility depends on details that cannot be reduced safely to a short quiz. Review the official program instructions.',
    stateVariation: options.stateVariation,
    requiresOfficialConfirmation: true,
    manualReview: true
  }
);

const eq = (field, value, label) => ({ field, operator: 'eq', value, label, required: true });
const oneOf = (field, value, label) => ({ field, operator: 'oneOf', value, label, required: true });
const between = (field, value, label) => ({ field, operator: 'between', value, label, required: true });
const lte = (field, value, label) => ({ field, operator: 'lte', value, label, required: true });

export const NATIONWIDE_ELIGIBILITY_PROFILES = Object.freeze({
  '211': open('211'),
  'findhelp': directory('Findhelp'),
  'hud': directory('U.S. Department of Housing and Urban Development'),
  'feeding-america': directory('Feeding America'),
  'usda-hunger': open('USDA Food and Nutrition Service'),
  'hrsa': directory('Health Resources and Services Administration'),
  'samhsa': open('Substance Abuse and Mental Health Services Administration'),
  'lawhelp': directory('LawHelp.org'),
  'benefit-finder': manual('USA.gov', 'benefit-screening-tool', ['state', 'ageRange', 'householdSize', 'incomeRange', 'veteranStatus', 'disabilityStatus'], {
    stateVariation: true,
    notes: 'Benefit Finder is a screening questionnaire covering many programs. It does not itself award benefits.'
  }),
  'snap': directory('USDA Food and Nutrition Service'),
  'job-centers': directory('U.S. Department of Labor CareerOneStop'),
  'community-action': directory('Community Action Partnership'),
  'salvation-army': directory('The Salvation Army USA'),
  'catholic-charities': directory('Catholic Charities USA'),

  'federal-student-aid-fafsa': manual('Federal Student Aid', 'categorical-and-school-specific', ['studentStatus', 'citizenshipStatus'], {
    stateVariation: true,
    notes: 'Submitting FAFSA is free. Aid eligibility also depends on enrollment, program eligibility, satisfactory progress, tax-data consent, and program-specific financial-need rules.'
  }),
  'job-corps-application': reviewed('U.S. Department of Labor Job Corps', 'means-tested-and-categorical',
    ['ageRange', 'workAuthorization', 'incomeRange', 'disabilityStatus'],
    [
      between('ageRange', [16, 24], 'Generally age 16 through 24'),
      eq('workAuthorization', 'yes', 'U.S. citizen, qualifying resident, territorial resident, or authorized to work')
    ],
    {
      manualReview: true,
      notes: 'An admissions representative reviews income, age exceptions, conduct, court supervision, and other enrollment criteria. A disability may permit an age exception.'
    }),
  'apprenticeship-job-finder': open('U.S. Department of Labor Apprenticeship.gov', 'Anyone may search. Each employer and apprenticeship posting sets qualifications.'),
  'healthcare-marketplace-application': reviewed('HealthCare.gov', 'categorical',
    ['state', 'usResident', 'citizenshipStatus', 'incarcerated', 'medicareCoverage'],
    [
      eq('usResident', 'yes', 'Lives in the United States'),
      oneOf('citizenshipStatus', ['citizen', 'national', 'lawfully-present'], 'Citizen, national, or lawfully present noncitizen'),
      eq('incarcerated', 'no', 'Not incarcerated'),
      eq('medicareCoverage', 'no', 'Not already enrolled in Medicare')
    ],
    { stateVariation: true, notes: 'Some states operate their own Marketplace. Savings and Medicaid/CHIP results depend on household, income, and state rules.' }),
  'ssa-disability-online': manual('Social Security Administration', 'work-history-and-medical', ['ageRange', 'disabilityStatus', 'employmentStatus'], {
    notes: 'SSDI requires enough recent covered work plus SSA’s disability standard. SSI uses separate income and resource rules; SSA makes the medical and work-credit decision.'
  }),
  'va-health-care-application': manual('U.S. Department of Veterans Affairs', 'veteran-status-and-service-history', ['veteranStatus'], {
    notes: 'Eligibility and priority group depend on service history, discharge, disability, income, exposures, and other statutory categories.'
  }),
  'va-disability-claim': reviewed('U.S. Department of Veterans Affairs', 'service-connected-disability',
    ['veteranStatus', 'disabilityStatus'],
    [
      oneOf('veteranStatus', ['veteran', 'service-member'], 'Veteran or qualifying service member'),
      eq('disabilityStatus', 'yes', 'Current physical or mental condition')
    ],
    { notes: 'VA must find that the condition was caused or aggravated by military service and review discharge and evidence requirements.' }),
  'va-education-benefits': manual('U.S. Department of Veterans Affairs', 'service-and-benefit-specific', ['veteranStatus', 'studentStatus'], {
    notes: 'Eligibility depends on the selected GI Bill or education program, service dates and length, discharge, remaining entitlement, and school/program approval.'
  }),
  'lifeline-national-verifier': manual('Universal Service Administrative Company', 'means-tested-or-program-based',
    ['state', 'householdSize', 'incomeRange', 'qualifyingBenefits'],
    {
      notes: 'Standard Lifeline eligibility is based on income at or below 135% of the current federal poverty guidelines or participation in a qualifying program. Tribal and survivor pathways differ.',
      stateVariation: true
    }),
  'irs-free-file': reviewed('Internal Revenue Service', 'income-limited',
    ['incomeRange'],
    [lte('incomeRange', 89000, '2025 adjusted gross income of $89,000 or less for 2026 guided filing')],
    { notes: 'Each trusted partner may add age, state, military, or other limits. Fillable Forms remain available regardless of income.' }),
  'fdic-money-smart': open('Federal Deposit Insurance Corporation'),
  'hud-housing-counseling': open('U.S. Department of Housing and Urban Development', 'Anyone may search for a HUD-approved counselor. Agencies may charge for some services and may use program-specific intake rules.'),
  'uscis-online-account': open('U.S. Citizenship and Immigration Services', 'Creating or using an online account does not establish eligibility for an immigration form or benefit.'),
  '988-lifeline': open('988 Suicide & Crisis Lifeline'),
  'acl-dial': open('Administration for Community Living'),
  'identity-theft-recovery': open('Federal Trade Commission'),
  'careeronestop-scholarship-finder': open('U.S. Department of Labor CareerOneStop', 'Anyone may search. Each scholarship sets its own eligibility and deadline.'),
  'americorps-opportunity-application': manual('AmeriCorps', 'position-specific', ['ageRange', 'citizenshipStatus'], {
    notes: 'Age, citizenship or lawful-permanent-resident status, service term, background checks, and other qualifications vary by AmeriCorps program and posting.'
  }),
  'usajobs-federal-application': manual('USAJOBS', 'job-specific', ['citizenshipStatus', 'employmentStatus', 'veteranStatus', 'disabilityStatus'], {
    notes: 'Eligibility depends on the announcement’s hiring path, citizenship exceptions, qualifications, grade, suitability, and conditions of employment.'
  }),
  'lsc-legal-aid-locator': directory('Legal Services Corporation'),
  'eoir-pro-bono-provider-list': directory('U.S. Department of Justice Executive Office for Immigration Review', false),
  'ssa-retirement-application': manual('Social Security Administration', 'age-and-work-history', ['ageRange', 'employmentStatus'], {
    notes: 'Retirement eligibility and payment depend on age, insured work credits, earnings record, family circumstances, and the month benefits begin.'
  }),
  'ssa-medicare-application': manual('Social Security Administration', 'age-disability-and-enrollment-window', ['ageRange', 'disabilityStatus', 'employmentStatus'], {
    notes: 'Medicare eligibility and enrollment timing depend on age, disability or specified conditions, work history, current coverage, and enrollment period.'
  }),
  'ssa-ssi-application-request': manual('Social Security Administration', 'means-tested-and-categorical',
    ['ageRange', 'disabilityStatus', 'householdSize', 'incomeRange', 'resourceRange', 'state'],
    {
      notes: 'SSI generally requires age 65+, blindness, or disability plus limited income and resources. Exclusions, deeming, living arrangements, and state supplements require SSA review.',
      stateVariation: true
    }),
  'va-veterans-pension': manual('U.S. Department of Veterans Affairs', 'means-tested-service-and-age-disability', ['veteranStatus', 'ageRange', 'disabilityStatus', 'incomeRange'], {
    notes: 'VA pension depends on wartime service, discharge, age or permanent disability, and current net-worth and income rules.'
  }),
  'va-vre-application': manual('U.S. Department of Veterans Affairs', 'service-connected-disability', ['veteranStatus', 'disabilityStatus'], {
    notes: 'Veterans generally need a non-dishonorable discharge and at least a 10% VA service-connected disability rating; a counselor determines entitlement and services.'
  }),
  'uscis-naturalization-n400': manual('U.S. Citizenship and Immigration Services', 'immigration-status-and-residency', ['ageRange', 'citizenshipStatus'], {
    notes: 'The common five-year path generally requires age 18+, lawful permanent residence, continuous residence, physical presence, state/district residence, English and civics, and good moral character. Spouse, military, disability, and other exceptions require official review.'
  }),
  'irs-vita-tce-locator': manual('Internal Revenue Service', 'income-age-disability-or-language-priority', ['ageRange', 'incomeRange', 'disabilityStatus'], {
    notes: 'VITA generally prioritizes people with lower income, disabilities, or limited English; TCE generally serves people age 60+. Site services and supported return types vary.'
  }),
  'irs-online-payment-agreement': manual('Internal Revenue Service', 'tax-account-specific', ['incomeRange'], {
    notes: 'Online eligibility, fees, documentation, and payment terms depend on tax debt, filing compliance, proposed term, collection status, and account type.'
  }),
  'head-start-locator-application': manual('HeadStart.gov', 'means-tested-or-categorical', ['state', 'ageRange', 'incomeRange', 'qualifyingBenefits', 'housingStatus'], {
    stateVariation: true,
    notes: 'Families at or below the poverty guideline, receiving TANF/SSI/SNAP, experiencing homelessness, or caring for a foster child may qualify. Local programs confirm eligibility and space.'
  }),
  'childcare-assistance-selector': manual('ChildCare.gov', 'state-administered', ['state', 'hasChildren', 'employmentStatus', 'studentStatus', 'incomeRange'], {
    stateVariation: true,
    notes: 'States and territories set their own income, activity, child-age, priority, copayment, and availability rules.'
  }),
  'usda-sun-meals-finder': reviewed('USDA Food and Nutrition Service', 'age-based-open-site',
    ['ageRange'],
    [between('ageRange', [0, 18], 'Age 18 or under for open SUN Meals sites')],
    { notes: 'Open SUN Meals sites provide free meals without an application. Site dates, meal times, and rural to-go rules vary.' }),
  'paf-case-management': manual('Patient Advocate Foundation', 'diagnosis-insurance-and-financial-need', ['disabilityStatus', 'insuranceStatus', 'incomeRange'], {
    notes: 'Case management depends on diagnosis, U.S. residence or treatment, insurance or access issue, financial or practical need, and program scope.'
  }),
  'pan-fundfinder': manual('PAN Foundation', 'disease-fund-specific', ['insuranceStatus', 'incomeRange'], {
    notes: 'FundFinder is a search and alert tool. Each disease fund has its own diagnosis, insurance, income, residency, treatment, funding, and enrollment-status rules.'
  }),
  'fema-disaster-assistance': manual('Federal Emergency Management Agency', 'declared-disaster-and-loss-specific', ['state', 'disasterAffected', 'housingStatus', 'insuranceStatus'], {
    stateVariation: true,
    notes: 'Eligibility depends on an eligible declared disaster and location, primary-residence or other covered need, occupancy or ownership, insurance, loss verification, and assistance already received.'
  }),
  'pcs-for-people-online': manual('PCs for People', 'means-tested-or-program-based', ['state', 'incomeRange', 'qualifyingBenefits'], {
    stateVariation: true,
    notes: 'Eligibility uses participation in an accepted assistance program or published income/area-median-income rules. Product inventory, internet coverage, documents, and price vary.'
  }),
  'computers-with-causes': manual('Computers with Causes', 'discretionary-need-and-inventory', ['studentStatus', 'employmentStatus', 'veteranStatus', 'disabilityStatus'], {
    notes: 'The nonprofit verifies demonstrated need and chooses awards based on priorities and inventory; submitting a request does not guarantee a computer.'
  }),
  'wic-participant-application': manual('USDA Food and Nutrition Service', 'categorical-means-tested-and-nutrition-risk',
    ['state', 'pregnancyOrYoungChild', 'householdSize', 'incomeRange', 'qualifyingBenefits'],
    {
      stateVariation: true,
      notes: 'WIC requires a qualifying pregnancy/postpartum/breastfeeding, infant, or under-5 category; residence; income or adjunctive program eligibility; and a nutrition-risk assessment by WIC staff.'
    })
});

export function applyNationwideEligibilityResearch(resource) {
  const profile = NATIONWIDE_ELIGIBILITY_PROFILES[String(resource.id)] || manual(
    resource.organizationName || resource.source || 'Official program source',
    'manual-review-required',
    [],
    { confidence: 'low', notes: 'No reviewed national eligibility profile is available yet.' }
  );
  return {
    ...resource,
    ...profile,
    eligibilitySourceUrl: resource.eligibilitySourceUrl || resource.url || resource.sourceUrls?.[0] || '',
    lastEligibilityVerified: ELIGIBILITY_RESEARCH_DATE,
    eligibilityLastVerified: ELIGIBILITY_RESEARCH_DATE
  };
}

export function nationwideEligibilityReviewQueue(resources = []) {
  return resources
    .filter(resource => resource.scope !== 'location')
    .filter(resource => resource.manualReview || resource.eligibilityConfidence === 'low')
    .map(resource => ({
      resourceId: resource.id,
      program: resource.name,
      sourceUrl: resource.eligibilitySourceUrl,
      reason: resource.manualReview
        ? 'Final eligibility requires official or human review.'
        : 'Eligibility confidence is low.'
    }));
}
