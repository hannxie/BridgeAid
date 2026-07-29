import { normalizeResource, stableResourceComparator } from './resource-service.js?v=11';
import { resourceScheduleState } from './schedule-service.js';

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
  deadline: ''
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
    deadline: String(constraints.deadline || '').trim()
  };
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

function feasibility(resource, constraints, now) {
  const reasons = [];
  const schedule = resourceScheduleState(resource, now);
  const cost = estimatedTravelCost(resource, constraints.transportation);
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
  return { feasible: reasons.length === 0, reasons, schedule, cost };
}

function resourceScore(resource, constraints, now) {
  const schedule = resourceScheduleState(resource, now);
  let score = Number(resource._rank || 0);
  if (schedule.openNow) score += constraints.urgency === 'immediate' ? 50 : 20;
  if (resource.applicationMethods.includes('online')) score += 15;
  if (resource.applicationDeadline) score += 12;
  if (resource.localEligibilityVerified) score += 10;
  if (Number.isFinite(resource.distance)) score += Math.max(0, 10 - resource.distance);
  return score;
}

function actionForResource(resource, schedule, constraints) {
  const online = resource.applicationMethods.includes('online')
    && (resource.registrationUrl || resource.applicationLinks.some(link => link.type === 'application'));
  const travel = travelEstimate(resource, constraints.transportation);
  if (online) {
    return {
      type: 'online',
      action: `Complete the verified online step for ${resource.name} before traveling.`,
      timing: constraints.deadline ? `Before ${constraints.deadline}` : 'As soon as documents are ready',
      travel: ''
    };
  }
  if (schedule.openNow && resource.address) {
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
  const candidates = resources
    .map(resource => normalizeResource(resource))
    .filter(resource => resource.id)
    .map(resource => ({
      resource,
      feasibility: feasibility(resource, normalizedConstraints, now),
      score: resourceScore(resource, normalizedConstraints, now)
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
  const documents = [...new Set(selected.flatMap(candidate => candidate.resource.requiredDocuments).filter(Boolean))];
  const steps = [];
  if (documents.length) {
    steps.push({
      type: 'documents',
      title: 'Gather reusable documents once',
      action: `Collect: ${documents.join('; ')}.`,
      reason: 'These documents appear across the selected programs, so gathering them first can avoid repeated trips.',
      completionConfidence: {
        label: 'Higher confidence',
        reason: 'These documents are published by the selected providers; each provider may request additional proof.'
      }
    });
  }
  for (const candidate of selected) {
    const action = actionForResource(candidate.resource, candidate.feasibility.schedule, normalizedConstraints);
    steps.push({
      resourceId: candidate.resource.id,
      title: candidate.resource.name,
      ...action,
      reason: action.type === 'online'
        ? 'An online step can be completed before travel.'
        : action.type === 'visit'
          ? 'The published schedule and entered travel constraints make this a practical early stop.'
          : 'Availability or requirements need confirmation before travel.',
      completionConfidence: completionConfidence(candidate.resource)
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
  return {
    generatedAt: now.toISOString(),
    constraints: normalizedConstraints,
    steps,
    excluded,
    tradeoffs,
    explanation: 'Online and document steps come first, followed by feasible time-sensitive contacts and visits. No step guarantees acceptance or service availability.'
  };
}
