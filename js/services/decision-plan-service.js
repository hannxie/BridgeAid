import { normalizeResource, stableResourceComparator } from './resource-service.js?v=13';
import { resourceAvailabilityAt, resourceScheduleState } from './schedule-service.js';

const DEFAULT_CONSTRAINTS = Object.freeze({
  urgency: 'today',
  availableDays: '',
  availableTimes: '',
  transportation: 'walking',
  maxDistance: 10,
  transportationBudget: '',
  walkingLimit: '',
  wheelchairAccessible: false,
  physicalLimitations: '',
  childcareNeeded: false,
  deadline: '',
  immediateNeeds: '',
  longerTermNeeds: ''
});

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizePlanConstraints(constraints = {}) {
  const transportation = ['walking', 'transit', 'driving'].includes(constraints.transportation)
    ? constraints.transportation
    : DEFAULT_CONSTRAINTS.transportation;
  return {
    ...DEFAULT_CONSTRAINTS,
    ...constraints,
    urgency: ['immediate', 'today', 'longTerm'].includes(constraints.urgency)
      ? constraints.urgency
      : DEFAULT_CONSTRAINTS.urgency,
    transportation,
    maxDistance: numberOrNull(constraints.maxDistance) ?? DEFAULT_CONSTRAINTS.maxDistance,
    transportationBudget: numberOrNull(constraints.transportationBudget),
    walkingLimit: numberOrNull(constraints.walkingLimit),
    wheelchairAccessible: Boolean(constraints.wheelchairAccessible),
    childcareNeeded: Boolean(constraints.childcareNeeded),
    availableDays: String(constraints.availableDays || '').trim(),
    availableTimes: String(constraints.availableTimes || '').trim(),
    physicalLimitations: String(constraints.physicalLimitations || '').trim(),
    deadline: String(constraints.deadline || '').trim(),
    immediateNeeds: String(constraints.immediateNeeds || '').trim(),
    longerTermNeeds: String(constraints.longerTermNeeds || '').trim()
  };
}

const DAY_ALIASES = {
  sun: 'sunday', sunday: 'sunday',
  mon: 'monday', monday: 'monday',
  tue: 'tuesday', tues: 'tuesday', tuesday: 'tuesday',
  wed: 'wednesday', wednesday: 'wednesday',
  thu: 'thursday', thur: 'thursday', thurs: 'thursday', thursday: 'thursday',
  fri: 'friday', friday: 'friday',
  sat: 'saturday', saturday: 'saturday'
};

function availableDayNames(value) {
  return [...new Set(String(value || '').toLowerCase().match(/[a-z]+/g)
    ?.map(token => DAY_ALIASES[token])
    .filter(Boolean) || [])];
}

function clockMinutes(value, suffix = '') {
  const match = String(value || '').trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (minute > 59) return null;
  if (suffix) {
    hour %= 12;
    if (/p/i.test(suffix)) hour += 12;
  }
  if (hour > 23) return null;
  return hour * 60 + minute;
}

function availableTimeRange(value) {
  const match = String(value || '').toLowerCase().match(
    /(\d{1,2}(?::\d{2})?)\s*(a\.?m\.?|p\.?m\.?)?\s*(?:-|–|to)\s*(\d{1,2}(?::\d{2})?)\s*(a\.?m\.?|p\.?m\.?)?/
  );
  if (!match) return null;
  const start = clockMinutes(match[1], match[2] || match[4]);
  const end = clockMinutes(match[3], match[4] || match[2]);
  return start !== null && end !== null && end > start ? { start, end } : null;
}

function periodMinutes(value) {
  const [hour, minute] = String(value || '').split(':').map(Number);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
}

function scheduleFit(resource, constraints) {
  if (resource.onlineAlwaysAvailable || resource.applicationMethods.includes('online')) {
    return { matches: true, verified: true, reason: '' };
  }
  if (!resource.weeklyHours || !resource.hoursLastVerified
    || resource.discoveryStatus === 'verification_pending'
    || /community-sourced/i.test(resource.verificationStatus)) {
    return {
      matches: true,
      verified: false,
      reason: 'The selected resource does not have a provider-verified schedule for automatic planning.'
    };
  }
  const days = availableDayNames(constraints.availableDays);
  const consideredDays = days.length ? days : Object.keys(resource.weeklyHours);
  const range = availableTimeRange(constraints.availableTimes);
  const periods = consideredDays.flatMap(day => resource.weeklyHours?.[day] || []);
  if (!periods.length) {
    return {
      matches: false,
      verified: true,
      reason: days.length
        ? `no verified service window matches ${days.join(', ')}`
        : 'no verified service window is published'
    };
  }
  if (range && !periods.some(period => {
    const open = periodMinutes(period.open);
    const close = periodMinutes(period.close);
    return open !== null && close !== null && open < range.end && close > range.start;
  })) {
    return {
      matches: false,
      verified: true,
      reason: `no verified service window overlaps ${constraints.availableTimes}`
    };
  }
  return { matches: true, verified: true, reason: '' };
}

function estimatedTravelCost(resource, method) {
  if (!Number.isFinite(resource.distance)) return null;
  if (method === 'walking') return 0;
  if (method === 'transit') return 5.5;
  return resource.distance * 2 * 0.7;
}

function travelEstimate(resource, method) {
  if (!Number.isFinite(resource.distance)) return '';
  const speed = method === 'walking' ? 3 : method === 'transit' ? 12 : 25;
  return `${Math.max(1, Math.round(resource.distance / speed * 60))} min estimated ${method}`;
}

function completionConfidence(resource) {
  if (resource.localEligibilityVerified && resource.applicationMethods.length) {
    return {
      label: 'Higher confidence',
      reason: 'Published eligibility and application steps are available, but the provider makes the final decision.'
    };
  }
  if (resource.eligibilityStatus === 'no_restrictions_listed' && resource.applicationMethods.length) {
    return {
      label: 'Needs confirmation',
      reason: 'An application path is published, but the provider does not publish specific eligibility restrictions.'
    };
  }
  return {
    label: 'Unclear',
    reason: 'Current eligibility or intake requirements are incomplete, so confirm before relying on this step.'
  };
}

function feasibility(resource, constraints, now, situationConstraints = {}) {
  const reasons = [];
  const schedule = resourceScheduleState(resource, now);
  const cost = estimatedTravelCost(resource, constraints.transportation);
  const requestedAvailability = situationConstraints.requestedInstant
    ? resourceAvailabilityAt(resource, situationConstraints.requestedInstant)
    : null;
  const scheduleMatch = scheduleFit(resource, constraints);
  if (Number.isFinite(resource.distance) && resource.distance > constraints.maxDistance) {
    reasons.push(`outside the ${constraints.maxDistance}-mile travel limit`);
  }
  if (constraints.transportation === 'walking'
    && constraints.walkingLimit !== null
    && Number.isFinite(resource.distance)
    && resource.distance > constraints.walkingLimit) {
    reasons.push(`outside the ${constraints.walkingLimit}-mile walking limit`);
  }
  if (constraints.transportationBudget !== null && cost !== null && cost > constraints.transportationBudget) {
    reasons.push('estimated round-trip transportation cost exceeds the entered budget');
  }
  if (constraints.wheelchairAccessible
    && !resource.accessibility.some(value => /wheelchair/i.test(value))) {
    reasons.push('wheelchair accessibility is not verified');
  }
  if (constraints.childcareNeeded
    && !resource.services.includes('family')
    && !/child|family/i.test(`${resource.description} ${resource.registrationRequirement}`)) {
    reasons.push('childcare support is not published');
  }
  if (resource.temporaryClosure) reasons.push('a temporary closure is published');
  if (!scheduleMatch.matches) reasons.push(scheduleMatch.reason);
  if (constraints.deadline) {
    const deadline = Date.parse(`${constraints.deadline}T23:59:59`);
    if (Number.isFinite(deadline) && deadline < now.getTime()) reasons.push('the entered application deadline has passed');
  }
  if (requestedAvailability?.confirmed && !requestedAvailability.available
    && constraints.urgency === 'immediate') {
    reasons.push('not available at the requested time');
  }
  if (situationConstraints.appointmentRestriction && resource.appointmentOnly) {
    reasons.push('an appointment is required');
  }
  return { feasible: reasons.length === 0, reasons, schedule, scheduleMatch, requestedAvailability, cost };
}

function resourceScore(resource, constraints, now, situationConstraints = {}) {
  const schedule = resourceScheduleState(resource, now);
  let score = Number(resource._rank || 0);
  const requestedAvailability = situationConstraints.requestedInstant
    ? resourceAvailabilityAt(resource, situationConstraints.requestedInstant)
    : null;
  if (requestedAvailability?.available && requestedAvailability.confirmed) score += 80;
  if (requestedAvailability?.confirmed && !requestedAvailability.available) score -= 70;
  if (schedule.openNow) score += constraints.urgency === 'immediate' ? 50 : 20;
  if (resource.applicationMethods.includes('online')) score += 15;
  if (resource.applicationDeadline) score += 12;
  if (resource.localEligibilityVerified) score += 10;
  if (Number.isFinite(resource.distance)) score += Math.max(0, 10 - resource.distance);
  return score;
}

function needMatchScore(resource, text) {
  const terms = String(text || '')
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter(term => term.length > 2) || [];
  if (!terms.length) return 0;
  const haystack = [
    resource.name,
    resource.category,
    ...(resource.services || []),
    resource.description,
    resource.serviceOffered
  ].join(' ').toLowerCase();
  return terms.filter(term => haystack.includes(term)).length;
}

function deadlinePriority(resource, now) {
  const timestamp = Date.parse(resource.applicationDeadline || '');
  if (!Number.isFinite(timestamp) || timestamp < now.getTime()) return 0;
  const daysRemaining = Math.ceil((timestamp - now.getTime()) / 86400000);
  return daysRemaining <= 7 ? 40 : daysRemaining <= 30 ? 20 : 5;
}

function actionableDocument(value) {
  const document = String(value || '').trim();
  if (!document) return false;
  return !/^(?:none|no documents?)\b|does not (?:list|publish).*documents?|documents? (?:are|is) not (?:listed|published|required)/i.test(document);
}

function actionForResource(resource, schedule, constraints, mode, requestedAvailability) {
  const online = resource.applicationMethods.includes('online')
    && (resource.registrationUrl || resource.applicationLinks.some(link => link.type === 'application'));
  const travel = travelEstimate(resource, constraints.transportation);
  if (mode === 'helper' && resource.phone) {
    return {
      type: 'phone',
      action: `Call ${resource.name} to confirm availability, program-specific eligibility, documents, and the next usable time.`,
      timing: constraints.availableTimes || 'During published phone hours',
      travel: ''
    };
  }
  if (requestedAvailability?.available && resource.address && !resource.appointmentOnly) {
    return {
      type: 'visit',
      action: `Go to ${resource.name} for the requested service window after a final availability check.`,
      timing: 'At the requested time',
      travel
    };
  }
  if (online) {
    return {
      type: 'online',
      action: `Complete the verified online step for ${resource.name} before traveling.`,
      timing: constraints.deadline ? `Before ${constraints.deadline}` : 'As soon as documents are ready',
      travel: ''
    };
  }
  if (schedule.openNow && resource.address && !resource.appointmentOnly) {
    return {
      type: 'visit',
      action: `Visit ${resource.name} while its published schedule shows it open.`,
      timing: 'Now, after confirming availability',
      travel
    };
  }
  if (resource.phone) {
    return {
      type: 'phone',
      action: `Call ${resource.name} to confirm availability, eligibility, and the next usable time.`,
      timing: constraints.availableTimes || 'During published phone hours',
      travel: ''
    };
  }
  return {
    type: 'verify',
    action: `Confirm the next available time with ${resource.name} before making a trip.`,
    timing: constraints.availableDays || 'Before traveling',
    travel
  };
}

export function buildDecisionPlan(resources = [], constraints = {}, options = {}) {
  const normalizedConstraints = normalizePlanConstraints(constraints);
  const now = options.now || new Date();
  const mode = options.mode === 'helper' ? 'helper' : 'self';
  const situationConstraints = options.situationConstraints || {};
  const candidates = resources
    .map(resource => normalizeResource(resource))
    .filter(resource => resource.id)
    .map(resource => ({
      resource,
      feasibility: feasibility(resource, normalizedConstraints, now, situationConstraints),
      score: resourceScore(resource, normalizedConstraints, now, situationConstraints)
    }));
  const excluded = candidates
    .filter(candidate => !candidate.feasibility.feasible)
    .map(candidate => ({
      resourceId: candidate.resource.id,
      name: candidate.resource.name,
      reasons: candidate.feasibility.reasons
    }));
  const selected = candidates
    .filter(candidate => candidate.feasibility.feasible)
    .sort((a, b) => b.score - a.score || stableResourceComparator(a.resource, b.resource))
    .slice(0, Math.max(1, Number(options.maximumResources) || 5));
  const documents = [...new Set(selected
    .flatMap(candidate => candidate.resource.requiredDocuments)
    .filter(actionableDocument))];
  const documentCounts = selected
    .flatMap(candidate => candidate.resource.requiredDocuments)
    .filter(actionableDocument)
    .reduce((counts, document) => counts.set(document, (counts.get(document) || 0) + 1), new Map());
  const reusableDocuments = [...documentCounts]
    .filter(([, count]) => count > 1)
    .map(([document]) => document);
  const steps = [];
  if (documents.length && mode === 'helper') {
    steps.push({
      type: 'documents',
      title: reusableDocuments.length ? 'Gather reusable documents once' : 'Gather required documents',
      action: `Collect: ${documents.join('; ')}.`,
      reason: reusableDocuments.length
        ? 'These documents appear across multiple selected programs, so gathering them first can avoid repeated trips.'
        : 'Gathering the published documents before provider contact can prevent an avoidable delay.',
      completionConfidence: {
        label: 'Higher confidence',
        reason: 'These documents are published by the selected providers; each provider may request additional proof.'
      }
    });
  }
  const resourceSteps = selected.map(candidate => {
    const action = actionForResource(
      candidate.resource,
      candidate.feasibility.schedule,
      normalizedConstraints,
      mode,
      candidate.feasibility.requestedAvailability
    );
    const immediateMatch = needMatchScore(candidate.resource, normalizedConstraints.immediateNeeds);
    const longerTermMatch = needMatchScore(candidate.resource, normalizedConstraints.longerTermNeeds);
    const deadlineWeight = deadlinePriority(candidate.resource, now);
    return {
      resourceId: candidate.resource.id,
      title: candidate.resource.name,
      ...action,
      reason: immediateMatch
        ? 'This resource matches an immediate need, so it is placed before longer-term work.'
        : deadlineWeight
          ? 'A published application deadline makes this step time-sensitive.'
          : action.type === 'online'
            ? 'An online step can be completed before travel.'
            : action.type === 'visit'
              ? 'The published schedule and entered travel constraints make this a practical early stop.'
              : 'Availability or requirements need confirmation before travel.',
      completionConfidence: completionConfidence(candidate.resource),
      scheduleVerified: candidate.feasibility.scheduleMatch.verified,
      priorityScore: immediateMatch * 100 + deadlineWeight + longerTermMatch * 10
    };
  }).sort((left, right) => {
    if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
    const priority = step => {
      if (step.type === 'visit' && step.timing === 'At the requested time') return 0;
      return { online: 1, phone: 2, visit: 3, verify: 4 }[step.type] ?? 5;
    };
    return priority(left) - priority(right);
  });
  steps.push(...resourceSteps);
  if (documents.length && mode === 'self') {
    steps.push({
      type: 'documents',
      title: 'Prepare what to bring next',
      action: `After the immediate step, gather: ${documents.join('; ')}.`,
      reason: 'Immediate, low-friction actions stay first; documents are grouped for later applications.',
      completionConfidence: {
        label: 'Higher confidence',
        reason: 'These documents are published by the selected providers; each provider may request additional proof.'
      }
    });
  }
  const nearbyStops = selected
    .filter(candidate => Number.isFinite(candidate.resource.distance))
    .sort((a, b) => a.resource.distance - b.resource.distance)
    .map(candidate => candidate.resource.name);
  const tradeoffs = [];
  if (excluded.length) tradeoffs.push(`${excluded.length} result(s) were left out because they conflict with the entered constraints.`);
  if (nearbyStops.length > 1) tradeoffs.push(`In-person stops are ordered by distance to reduce backtracking: ${nearbyStops.join(' → ')}.`);
  if (normalizedConstraints.availableDays || normalizedConstraints.availableTimes) {
    tradeoffs.push('Published schedules are used when available; confirm that they still match your entered availability.');
  }
  if (normalizedConstraints.physicalLimitations) {
    tradeoffs.push('Physical limitations were recorded, but only published accessibility facts can be used for automatic screening.');
  }
  const unverifiedSchedules = selected.filter(candidate => !candidate.feasibility.scheduleMatch.verified);
  if (unverifiedSchedules.length) {
    tradeoffs.push(`${unverifiedSchedules.length} selected resource(s) have unverified schedules and require provider confirmation before travel.`);
  }
  if (normalizedConstraints.immediateNeeds) {
    tradeoffs.push(`Immediate priorities recorded: ${normalizedConstraints.immediateNeeds}.`);
  }
  if (normalizedConstraints.longerTermNeeds) {
    tradeoffs.push(`Longer-term priorities recorded: ${normalizedConstraints.longerTermNeeds}.`);
  }
  return {
    generatedAt: now.toISOString(),
    constraints: normalizedConstraints,
    mode,
    steps,
    excluded,
    tradeoffs,
    documents,
    reusableDocuments,
    explanation: mode === 'helper'
      ? 'Coordination starts with reusable documents and provider confirmation calls before travel. No step guarantees acceptance or service availability.'
      : 'Immediate visits or verified online actions stay first, with reusable documents grouped afterward. No step guarantees acceptance or service availability.'
  };
}
