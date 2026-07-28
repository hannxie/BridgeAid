import { summarizeEligibility } from './eligibility-service.js';
import { registrationSteps } from './registration-service.js';

export function detectIntent(question = '') {
  const value = question.toLowerCase();
  if (/eligible|qualify|income|requirement/.test(value)) return 'eligibility';
  if (/apply|register|form|application/.test(value)) return 'registration';
  if (/hour|open|today|tonight|event|when/.test(value)) return 'availability';
  return 'resource-search';
}

export function routeAssistantRequest({ question, mode, resources = [], intake = {}, selectedResource = null }) {
  const intent = detectIntent(question);
  const result = { intent, agents: ['orchestrator'], actions: [], message: '' };
  if (intent === 'eligibility' && selectedResource) {
    result.agents.push('eligibility-assistant');
    const summary = summarizeEligibility(selectedResource);
    result.message = `${summary.summary || 'Published eligibility details are incomplete.'} ${summary.disclaimer}`;
    result.actions = ['Review requirements', 'Call to confirm'];
    return result;
  }
  if (intent === 'registration' && selectedResource) {
    result.agents.push('registration-assistant');
    const guide = registrationSteps(selectedResource);
    result.message = guide.steps.slice(0, 2).join(' ');
    result.actions = guide.formUrl ? ['Open official form', 'Review before submitting'] : ['Call the organization'];
    return result;
  }
  if (intent === 'availability') {
    result.agents.push('hours-verification-agent');
    result.message = 'Published schedules can change. Check the source shown on the resource and call ahead when availability is uncertain.';
    result.actions = ['Review nearby results', 'Call to confirm'];
    return result;
  }
  result.agents.push('location-resource-finder');
  const count = Math.min(resources.length, mode === 'self' ? 3 : 5);
  const need = intake.immediateNeed ? ` for ${intake.immediateNeed}` : '';
  result.message = count
    ? `I found ${count} relevant option${count === 1 ? '' : 's'}${need}. Start with the call, directions, or official-site actions on each card.`
    : 'Tell me what help is needed and enter a city or ZIP code. I will use saved resources first and then try a live search.';
  result.actions = mode === 'self' ? ['Search nearby', 'Call 211'] : ['Search nearby', 'Add options to the plan'];
  return result;
}
