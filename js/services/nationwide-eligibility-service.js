import { eligibilityForLocation } from './location-eligibility-service.js';

export const QUIZ_QUESTION_BANK = Object.freeze({
  state: {
    label: 'What state or territory do you live in?',
    help: 'State rules matter for some programs. Choose “Prefer not to answer” if you are unsure.',
    type: 'state'
  },
  ageRange: {
    label: 'What is your age range?',
    help: 'Age is asked only when it can change which programs may fit.',
    type: 'select',
    options: [
      ['0-4', 'Under 5'], ['5-15', '5–15'], ['16-17', '16–17'], ['18-24', '18–24'],
      ['25-54', '25–54'], ['55-61', '55–61'], ['62-64', '62–64'], ['65-120', '65 or older']
    ]
  },
  householdSize: {
    label: 'How many people are in your household?',
    help: 'Use the household definition in the official program before applying.',
    type: 'number',
    min: 1,
    max: 30
  },
  incomeRange: {
    label: 'About how much is your household’s yearly income before taxes?',
    help: 'A range is enough for this preliminary screen. Programs use different income definitions.',
    type: 'select',
    options: [
      ['0-25000', 'Less than $25,000'], ['25000-50000', '$25,000–$49,999'],
      ['50000-75000', '$50,000–$74,999'], ['75000-100000', '$75,000–$99,999'],
      ['100000-9999999', '$100,000 or more']
    ]
  },
  resourceRange: {
    label: 'About how much do you have in countable savings and other resources?',
    help: 'Do not include account numbers. Official exclusions differ by program.',
    type: 'select',
    options: [
      ['0-2000', '$2,000 or less'], ['2001-3000', '$2,001–$3,000'],
      ['3001-10000', '$3,001–$10,000'], ['10001-9999999', 'More than $10,000']
    ]
  },
  citizenshipStatus: {
    label: 'Which status best describes you?',
    help: 'Asked only for programs whose official rules use citizenship or immigration status.',
    type: 'select',
    options: [
      ['citizen', 'U.S. citizen'], ['national', 'U.S. national'],
      ['lawfully-present', 'Lawfully present noncitizen'], ['permanent-resident', 'Lawful permanent resident'],
      ['other', 'Another status'], ['prefer-not', 'Prefer not to answer']
    ]
  },
  workAuthorization: {
    label: 'Are you currently authorized to work in the United States?',
    help: 'Choose “Not sure” if an official reviewer needs to confirm.',
    type: 'yesno'
  },
  usResident: {
    label: 'Do you currently live in the United States?',
    type: 'yesno'
  },
  incarcerated: {
    label: 'Are you currently incarcerated?',
    type: 'yesno'
  },
  medicareCoverage: {
    label: 'Do you already have Medicare coverage?',
    type: 'yesno'
  },
  veteranStatus: {
    label: 'What is your connection to military service?',
    type: 'select',
    options: [
      ['veteran', 'Veteran'], ['service-member', 'Current service member'],
      ['family', 'Family or survivor'], ['none', 'No military connection'], ['prefer-not', 'Prefer not to answer']
    ]
  },
  disabilityStatus: {
    label: 'Do you have a disability or serious health condition?',
    help: 'No diagnosis is requested or stored.',
    type: 'yesno'
  },
  studentStatus: {
    label: 'Are you enrolled in or planning an eligible college, career, or training program?',
    type: 'yesno'
  },
  employmentStatus: {
    label: 'Which work situation best fits?',
    type: 'select',
    options: [
      ['working', 'Working'], ['seeking', 'Looking for work'], ['unable', 'Unable to work'],
      ['retired', 'Retired'], ['other', 'Another situation'], ['prefer-not', 'Prefer not to answer']
    ]
  },
  pregnancyOrYoungChild: {
    label: 'Does the application involve pregnancy, postpartum or breastfeeding status, an infant, or a child under 5?',
    type: 'yesno'
  },
  hasChildren: {
    label: 'Are you seeking help for a child in your household?',
    type: 'yesno'
  },
  qualifyingBenefits: {
    label: 'Does anyone in your household receive SNAP, Medicaid, SSI, TANF, public housing assistance, or another listed benefit?',
    help: 'The official program will confirm which benefits count.',
    type: 'yesno'
  },
  housingStatus: {
    label: 'Which housing situation best fits?',
    type: 'select',
    options: [
      ['stable', 'Stable housing'], ['at-risk', 'At risk of losing housing'],
      ['homeless', 'Experiencing homelessness'], ['foster', 'Foster care situation'],
      ['prefer-not', 'Prefer not to answer']
    ]
  },
  insuranceStatus: {
    label: 'Do you currently have health insurance?',
    type: 'yesno'
  },
  disasterAffected: {
    label: 'Was your home or household affected by a federally declared disaster?',
    type: 'yesno'
  }
});

function selectedNeeds(answers = {}) {
  return Array.isArray(answers.needs) ? answers.needs.filter(Boolean) : [];
}

export function nationwideCandidates(resources = [], answers = {}) {
  const needs = selectedNeeds(answers);
  const national = resources.filter(resource => resource.scope !== 'location');
  if (!needs.length) return national;
  return national.filter(resource => {
    const services = new Set([resource.category, ...(resource.services || [])]);
    return needs.some(need => services.has(need));
  });
}

export function conditionalEligibilityQuestions(resources = [], answers = {}) {
  const candidates = nationwideCandidates(resources, answers);
  const ids = [...new Set(candidates.flatMap(resource => resource.eligibilityQuestions || []))];
  const priority = [
    'state', 'ageRange', 'usResident', 'citizenshipStatus', 'workAuthorization',
    'incarcerated', 'medicareCoverage', 'veteranStatus', 'disabilityStatus',
    'householdSize', 'incomeRange', 'resourceRange', 'qualifyingBenefits',
    'studentStatus', 'employmentStatus', 'pregnancyOrYoungChild', 'hasChildren',
    'housingStatus', 'insuranceStatus', 'disasterAffected'
  ];
  return ids
    .filter(id => QUIZ_QUESTION_BANK[id])
    .sort((a, b) => priority.indexOf(a) - priority.indexOf(b))
    .map(id => ({ id, ...QUIZ_QUESTION_BANK[id] }));
}

function rangeValue(value) {
  if (typeof value === 'number') return { min: value, max: value };
  const match = String(value ?? '').match(/^(\d+)-(\d+)$/);
  if (!match) return null;
  return { min: Number(match[1]), max: Number(match[2]) };
}

function evaluateRule(rule, answers) {
  if (rule.operator === 'always') return { outcome: 'pass', label: rule.label };
  const answer = answers[rule.field];
  if (answer === undefined || answer === '' || answer === 'not-sure' || answer === 'prefer-not') {
    return { outcome: 'unknown', label: rule.label, field: rule.field };
  }
  if (rule.operator === 'eq') {
    return { outcome: String(answer) === String(rule.value) ? 'pass' : 'fail', label: rule.label, field: rule.field };
  }
  if (rule.operator === 'oneOf') {
    return {
      outcome: (rule.value || []).map(String).includes(String(answer)) ? 'pass' : 'fail',
      label: rule.label,
      field: rule.field
    };
  }
  if (rule.operator === 'between') {
    const range = rangeValue(answer);
    if (!range) return { outcome: 'unknown', label: rule.label, field: rule.field };
    if (range.min >= Number(rule.value[0]) && range.max <= Number(rule.value[1])) {
      return { outcome: 'pass', label: rule.label, field: rule.field };
    }
    if (range.max < Number(rule.value[0]) || range.min > Number(rule.value[1])) {
      return { outcome: 'fail', label: rule.label, field: rule.field };
    }
    return { outcome: 'unknown', label: rule.label, field: rule.field };
  }
  if (rule.operator === 'lte') {
    const range = rangeValue(answer);
    if (!range) return { outcome: 'unknown', label: rule.label, field: rule.field };
    if (range.max <= Number(rule.value)) return { outcome: 'pass', label: rule.label, field: rule.field };
    if (range.min > Number(rule.value)) return { outcome: 'fail', label: rule.label, field: rule.field };
    return { outcome: 'unknown', label: rule.label, field: rule.field };
  }
  return { outcome: 'unknown', label: rule.label, field: rule.field };
}

export function evaluateNationwideProgram(resource, answers = {}) {
  const locationEligibility = eligibilityForLocation(resource, {
    label: answers.location || answers.state || '',
    state: answers.state || ''
  });
  const withLocation = result => ({
    ...result,
    locationCode: locationEligibility.code,
    locationConfirmed: locationEligibility.confirmed,
    locationSourceUrl: locationEligibility.sourceUrl || resource.eligibilitySourceUrl || ''
  });
  if (locationEligibility.serves === false) {
    return withLocation({
      label: 'Unlikely match',
      code: 'unlikely',
      matched: [],
      unknown: [],
      problems: ['This program does not serve the selected location.']
    });
  }
  if (resource.eligibilityType === 'provider-directory' || resource.eligibilityType === 'benefit-screening-tool') {
    return withLocation({
      label: 'More information needed',
      code: 'more-info',
      matched: [],
      unknown: ['This resource helps find or screen programs; the selected provider decides eligibility.'],
      problems: []
    });
  }
  if (resource.stateVariation && ['missing', 'rules-unconfirmed', 'unconfirmed'].includes(locationEligibility.code)) {
    return withLocation({
      label: 'More information needed',
      code: 'more-info',
      matched: [],
      unknown: [answers.state
        ? 'Official rules for the selected state have not been verified in BridgeAid.'
        : 'Choose a state before BridgeAid evaluates location-dependent rules.'],
      problems: []
    });
  }
  const evaluations = (locationEligibility.rules || resource.eligibilityRules || [])
    .map(rule => evaluateRule(rule, answers));
  const matched = evaluations.filter(item => item.outcome === 'pass').map(item => item.label);
  const problems = evaluations.filter(item => item.outcome === 'fail').map(item => item.label);
  const unknown = evaluations.filter(item => item.outcome === 'unknown').map(item => item.label);
  if (problems.length) return withLocation({ label: 'Unlikely match', code: 'unlikely', matched, unknown, problems });
  if (!resource.manualReview && evaluations.length && !unknown.length) {
    return withLocation({ label: 'Likely match', code: 'likely', matched, unknown, problems });
  }
  if (resource.manualReview) {
    unknown.push('The official program or a trained reviewer must confirm additional criteria.');
    return withLocation({ label: 'More information needed', code: 'more-info', matched, unknown, problems });
  }
  if (evaluations.length && unknown.length) {
    return withLocation({ label: 'Possible match', code: 'possible', matched, unknown, problems });
  }
  if (!evaluations.length) {
    unknown.push('No complete machine-checkable eligibility rules are published for this resource.');
  }
  return withLocation({ label: 'More information needed', code: 'more-info', matched, unknown, problems });
}

export function matchNationwidePrograms(resources = [], answers = {}) {
  const order = { likely: 0, possible: 1, 'more-info': 2, unlikely: 3 };
  return nationwideCandidates(resources, answers)
    .map(resource => ({
      resource,
      decision: evaluateNationwideProgram(resource, answers)
    }))
    .sort((a, b) => order[a.decision.code] - order[b.decision.code]
      || String(a.resource.name).localeCompare(String(b.resource.name)));
}
