import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  safeStorageGet,
  safeStorageSet,
  loadMode,
  switchMode,
  validMode
} from '../js/services/storage.js';
import {
  normalizeResource,
  mergeDuplicates,
  rankResources,
  filterResources,
  resourceCoverage,
  cacheKey,
  readCachedSearch,
  writeCachedSearch,
  sortResources,
  resourceIsFresh,
  freshResources,
  coordinateCacheKey,
  normalizeSearchParameters,
  searchSignature
} from '../js/services/resource-service.js';
import {
  nextRecurringEvent,
  resolveSchedule,
  formatInTimeZone,
  weeklyScheduleRows,
  resourceScheduleState,
  resourceAvailabilityAt
} from '../js/services/schedule-service.js';
import {
  questionsForRules,
  evaluateEligibility,
  summarizeEligibility
} from '../js/services/eligibility-service.js';
import {
  validateRegistrationLink,
  registrationSteps,
  maySubmitRegistration
} from '../js/services/registration-service.js';
import {
  haversineMiles,
  geocodeLocation,
  buildOverpassQuery,
  inferCategory,
  normalizeOsmElement,
  fetchNearbyResources,
  geocodeResourceAddresses,
  clearLocationCaches,
  suggestLocations
} from '../js/services/location-service.js';
import {
  escapeHtml,
  sanitizePhone,
  safeExternalUrl
} from '../js/services/html-service.js';
import {
  addPlanResource,
  updatePlanStatus,
  updatePlanNote,
  updatePlanQuestions,
  removePlanResource,
  clearPlan
} from '../js/services/helper-plan-service.js';
import { detectIntent, routeAssistantRequest } from '../js/services/orchestrator.js';
import { requireAdmin, applyAdminAction, AuthorizationError } from '../server/services/admin-service.js';
import {
  createJob,
  createVerificationJobs,
  createDiscoveryJobs,
  createEligibilityResearchJobs,
  recordEligibilityResearchOutcome,
  recordJobFailure
} from '../server/services/background-job-service.js';
import {
  LOCALES,
  translate,
  detectMessageLanguage,
  requestedLanguage,
  localeCompleteness
} from '../js/localization.js';
import {
  assistantIntent,
  assistantCategory,
  locationFromMessage,
  answerGroundedAssistant
} from '../js/services/grounded-assistant.js';
import {
  servesLocation,
  localProgramForResource,
  localEligibilityQuestions,
  evaluateLocalEligibility
} from '../js/services/local-eligibility-service.js';
import {
  createCorrectionReport,
  queueCorrection,
  verifyCorrectionReport
} from '../js/services/correction-service.js';
import {
  sourcePriority,
  verifyResourceSchedule,
  parseOpeningHours
} from '../js/services/schedule-verification-service.js';
import {
  googlePeriodsToWeeklyHours,
  googleSpecialHours,
  placesApiKey,
  findConfiguredPlace,
  mergePlaceEvidence
} from '../js/services/places-enrichment-service.js';
import {
  createRequestCoordinator,
  storedFirstResponse
} from '../js/services/performance-service.js';
import { registrationGuidance } from '../js/services/registration-service.js';
import { categories, resources, nationwideResources } from '../data/resources.js';
import { buildDecisionPlan, normalizePlanConstraints } from '../js/services/decision-plan-service.js';
import {
  createSearchLifecycle,
  beginSearchState,
  completeSearchState,
  searchFailureOutcome
} from '../js/services/search-lifecycle-service.js';
import { parseSituation } from '../js/services/situation-service.js';
import { eligibilityRecord, exportEligibilityCsv } from '../js/services/eligibility-data-service.js';
import { hashForPage, isCurrentPage, pageFromHash } from '../js/services/route-service.js';

class MemoryStorage {
  constructor() {
    this.data = new Map();
    this.fail = false;
  }
  getItem(key) {
    if (this.fail) throw new Error('blocked');
    return this.data.has(key) ? this.data.get(key) : null;
  }
  setItem(key, value) {
    if (this.fail) throw new Error('blocked');
    this.data.set(key, value);
  }
  removeItem(key) {
    this.data.delete(key);
  }
}

test('mode selection accepts only self or helper', () => {
  assert.equal(validMode('self'), 'self');
  assert.equal(validMode('helper'), 'helper');
  assert.equal(validMode('invalid'), '');
});

test('mode persistence survives a new state load', () => {
  const storage = new MemoryStorage();
  const state = { mode: '', location: '98101' };
  assert.equal(switchMode(state, 'self', storage), true);
  assert.equal(loadMode(storage), 'self');
});

test('mode switching preserves location', () => {
  const storage = new MemoryStorage();
  const state = { mode: 'self', location: 'Seattle, WA' };
  switchMode(state, 'helper', storage);
  assert.equal(state.location, 'Seattle, WA');
  assert.equal(state.mode, 'helper');
});

test('corrupt or unavailable local storage falls back without throwing', () => {
  const storage = new MemoryStorage();
  storage.data.set('bad', '{not json');
  assert.deepEqual(safeStorageGet('bad', { safe: true }, storage), { safe: true });
  storage.fail = true;
  assert.equal(safeStorageSet('x', 1, storage), false);
});

test('legacy resources normalize missing fields and preserve sources', () => {
  const resource = normalizeResource({ id: '1', name: 'Clinic', url: 'https://example.org', verified: '2026-01-01', services: ['health'] });
  assert.equal(resource.organizationName, 'Clinic');
  assert.deepEqual(resource.requiredDocuments, []);
  assert.deepEqual(resource.sourceUrls, ['https://example.org']);
  assert.equal(resource.lastVerified, '2026-01-01');
});

test('service taxonomy uses the requested complete order with All Services first', () => {
  assert.deepEqual(categories.map(category => category.label.en), [
    'All Services',
    'Food',
    'Housing and Shelter',
    'Healthcare',
    'Mental Health',
    'Transportation',
    'Clothing and Hygiene',
    'Employment',
    'Education and Scholarships',
    'Childcare and Family Support',
    'Legal Assistance',
    'Financial Assistance and Benefits',
    'Disability Services',
    'Veteran Services',
    'Immigration Assistance',
    'Internet and Technology',
    'Other'
  ]);
});

test('verified Seattle additions include actionable local evidence and full addresses', () => {
  const local = resources.filter(resource => resource.city === 'Seattle' && resource.verified === '2026-07-29');
  assert.ok(local.length >= 12);
  for (const resource of local) {
    assert.match(resource.address, /Seattle, WA \d{5}$/);
    assert.ok(resource.category);
    assert.ok(resource.source);
    assert.ok(resource.eligibilitySourceUrl?.startsWith('https://'));
    assert.equal(resource.eligibilityLastVerified, '2026-07-29');
    assert.equal(resource.applicationLastVerified, '2026-07-29');
    assert.ok(resource.applicationSteps?.length >= 3);
    assert.ok(resource.applicationLinks?.length >= 1);
    assert.ok(resource.eligibilityDetails?.whoQualifies);
    assert.ok(resource.eligibilityDetails?.geographicRestrictions);
  }
});

test('all published application actions are HTTPS links on approved official domains', () => {
  for (const resource of resources.filter(resource => resource.verified === '2026-07-28')) {
    for (const action of resource.applicationLinks) {
      assert.equal(
        validateRegistrationLink(action.url, resource.officialDomains).valid,
        true,
        `${resource.id}: ${action.url}`
      );
    }
  }
});

test('resource coverage reports the expanded non-food categories', () => {
  const coverage = resourceCoverage(resources);
  for (const category of ['shelter', 'health', 'mental', 'transport', 'hygiene', 'jobs', 'education', 'legal', 'benefits', 'disability', 'veteran', 'immigration', 'internet']) {
    assert.ok(coverage.counts[category] >= 1, category);
  }
  for (const category of ['shelter', 'health', 'mental', 'transport', 'hygiene', 'jobs', 'education', 'family', 'legal', 'benefits', 'disability', 'veteran', 'immigration', 'internet']) {
    assert.ok(coverage.byLocation.Seattle[category] >= 1, `Seattle/${category}`);
  }
});

test('duplicate merging retains supporting evidence', () => {
  const merged = mergeDuplicates([
    { id: 'a', name: 'Food Bank', address: '1 Main', sourceUrls: ['https://one.example'] },
    { id: 'b', name: 'Food Bank', address: '1 Main', sourceUrls: ['https://two.example'] }
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(new Set(merged[0].sourceUrls), new Set(['https://one.example', 'https://two.example']));
});

test('duplicate merging and relevance order are identical across input arrival order', () => {
  const rows = [
    { id: 'b', name: 'Community Pantry', address: '1 Main St', phone: '555-111-2222', category: 'food', distance: 2, sourceUrls: ['https://b.example'] },
    { id: 'a', name: 'Community Pantry', address: '1 Main Street', phone: '(555) 111-2222', category: 'food', distance: 2, sourceUrls: ['https://a.example'] },
    { id: 'c', name: 'Another Pantry', address: '2 Main St', category: 'food', distance: 2, sourceUrls: ['https://c.example'] }
  ];
  const first = rankResources(mergeDuplicates(rows), { categories: ['food'] });
  const second = rankResources(mergeDuplicates([...rows].reverse()), { categories: ['food'] });
  assert.deepEqual(first, second);
});

test('geographic ranking favors relevant nearby results', () => {
  const ranked = rankResources([
    { id: 'far', name: 'Far', category: 'food', distance: 20, sourceUrls: ['https://a.example'] },
    { id: 'near', name: 'Near', category: 'food', distance: 1, sourceUrls: ['https://b.example'] }
  ], { categories: ['food'] });
  assert.equal(ranked[0].id, 'near');
});

test('radius and accessibility filters work on cached results', () => {
  const result = filterResources([
    { id: 'a', name: 'A', distance: 2, accessibility: ['Wheelchair accessible'] },
    { id: 'b', name: 'B', distance: 12 }
  ], { radius: 5, accessible: true });
  assert.deepEqual(result.map(item => item.id), ['a']);
});

test('cache keys vary by location category and radius', () => {
  assert.notEqual(cacheKey('98101', 'food', 5), cacheKey('98101', 'food', 10));
});

test('resource cache returns fresh and stale saved results deterministically', () => {
  const now = Date.UTC(2026, 0, 2);
  const cache = writeCachedSearch({}, 'key', [{
    id: 'a',
    name: 'A',
    lastVerified: '2026-01-02',
    verificationPeriodDays: 30
  }], now);
  assert.equal(readCachedSearch(cache, 'key', now + 1000).stale, false);
  assert.equal(readCachedSearch(cache, 'key', now + 2 * 86400000).stale, true);
});

test('offline behavior can reuse cached resources', () => {
  const cache = writeCachedSearch({}, 'offline', [{
    id: 'a',
    name: 'Saved',
    lastVerified: '1970-01-01T00:00:00.100Z',
    verificationPeriodDays: 30
  }], 100);
  assert.equal(readCachedSearch(cache, 'offline', 200).resources[0].name, 'Saved');
});

test('expired resources are excluded rather than shown as saved fallback', () => {
  const now = Date.UTC(2026, 6, 28);
  const expired = { id: 'old', name: 'Old', lastVerified: '2025-01-01', verificationPeriodDays: 30 };
  const current = { id: 'new', name: 'New', lastVerified: '2026-07-28', verificationPeriodDays: 30 };
  assert.equal(resourceIsFresh(expired, now), false);
  assert.deepEqual(freshResources([expired, current], now).map(resource => resource.id), ['new']);
  const cache = writeCachedSearch({}, 'mixed', [expired, current], now);
  const read = readCachedSearch(cache, 'mixed', now);
  assert.deepEqual(read.resources.map(resource => resource.id), ['new']);
  assert.equal(read.expiredCount, 1);
  assert.equal(read.stale, false);
});

test('canonical coordinate cache keys make equivalent place labels deterministic', () => {
  const point = { lat: 47.60621, lng: -122.33207 };
  assert.equal(
    coordinateCacheKey(point, 'food', 5),
    coordinateCacheKey({ lat: 47.606209, lng: -122.332069 }, 'food', 5)
  );
});

test('request coordination deduplicates concurrent external work', async () => {
  const coordinator = createRequestCoordinator();
  let calls = 0;
  let release;
  const pending = coordinator.run('same-search', () => {
    calls += 1;
    return new Promise(resolve => {
      release = resolve;
    });
  });
  const duplicate = coordinator.run('same-search', () => {
    calls += 1;
    return Promise.resolve('duplicate');
  });
  assert.equal(pending, duplicate);
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  release('complete');
  assert.equal(await duplicate, 'complete');
});

test('request coordination releases failed work so a retry can run', async () => {
  const coordinator = createRequestCoordinator();
  await assert.rejects(
    coordinator.run('retryable-search', async () => {
      throw new Error('temporary failure');
    }),
    /temporary failure/
  );
  assert.equal(coordinator.size(), 0);
  assert.equal(await coordinator.run('retryable-search', async () => 'recovered'), 'recovered');
});

test('every search begins with clean transient state and can recover after failure', () => {
  const lifecycle = createSearchLifecycle();
  const state = {
    liveResults: [{ id: 'old' }],
    errorKey: 'searchUnavailable',
    errorText: 'old failure',
    noticeKey: 'old notice',
    loading: false,
    discoveryStatus: 'unavailable'
  };
  const failed = lifecycle.begin('city-a');
  beginSearchState(state, { key: failed.key, requestId: failed.id });
  assert.equal(state.errorKey, '');
  assert.equal(state.errorText, '');
  assert.equal(state.loading, true);
  assert.deepEqual(state.liveResults, []);
  completeSearchState(state, { hasResults: false, errorKey: 'searchUnavailable' });
  lifecycle.finish(failed);
  const retry = lifecycle.begin('city-a');
  beginSearchState(state, { key: retry.key, requestId: retry.id });
  assert.equal(state.errorKey, '');
  assert.equal(state.loading, true);
  assert.equal(lifecycle.isCurrent(retry), true);
});

test('rapid location changes make only the newest search current', () => {
  const lifecycle = createSearchLifecycle();
  const cityA = lifecycle.begin('city-a');
  const cityB = lifecycle.begin('city-b');
  assert.equal(lifecycle.isCurrent(cityA), false);
  assert.equal(lifecycle.finish(cityA), false);
  assert.equal(lifecycle.isCurrent(cityB), true);
  assert.equal(lifecycle.finish(cityB), true);
});

test('live discovery failure preserves verified results and reserves Retry for total failure', () => {
  assert.deepEqual(searchFailureOutcome(new Error('overpass unavailable'), true), {
    errorKey: '',
    noticeKey: 'searchPartialResults',
    partial: true
  });
  assert.deepEqual(searchFailureOutcome(new Error('overpass unavailable'), false), {
    errorKey: 'searchUnavailable',
    noticeKey: '',
    partial: false
  });
});

test('stored-first responses return before background enrichment and record latency', async () => {
  let release;
  const times = [100, 104];
  const task = storedFirstResponse({
    answer: () => ({ text: 'stored answer' }),
    enrich: () => new Promise(resolve => {
      release = resolve;
    }),
    clock: () => times.shift()
  });
  assert.equal(task.response.text, 'stored answer');
  assert.equal(task.responseMs, 4);
  await Promise.resolve();
  assert.equal(typeof release, 'function');
  release('enriched');
  assert.equal(await task.enrichment, 'enriched');
});

test('weekly recurring schedules calculate the next event', () => {
  const result = nextRecurringEvent('Every Monday', new Date('2026-07-28T12:00:00'));
  assert.equal(result.toISOString().slice(0, 10), '2026-08-03');
});

test('monthly ordinal schedules calculate the next actual date', () => {
  const result = nextRecurringEvent('The second Tuesday of each month', new Date('2026-07-28T12:00:00'));
  assert.equal(result.toISOString().slice(0, 10), '2026-08-11');
});

test('last weekday of month skips weekends', () => {
  const result = nextRecurringEvent('Last weekday of the month', new Date('2026-07-28T12:00:00'));
  assert.equal(result.toISOString().slice(0, 10), '2026-07-31');
});

test('every-other-week schedules respect an anchor', () => {
  const result = nextRecurringEvent('Every other Thursday', new Date('2026-07-31T12:00:00'), new Date('2026-07-23T12:00:00'));
  assert.equal(result.toISOString().slice(0, 10), '2026-08-06');
});

test('conflicting schedules remain uncertain', () => {
  const result = resolveSchedule([{ value: '9–5' }, { value: '10–4' }]);
  assert.equal(result.label, 'Schedule uncertain');
  assert.equal(result.conflicts.length, 2);
});

test('missing schedule remains uncertain', () => {
  assert.equal(resolveSchedule([]).label, 'Schedule uncertain');
});

test('time-zone formatting accounts for daylight-saving time', () => {
  const winter = formatInTimeZone(new Date('2026-01-15T20:00:00Z'), 'America/Los_Angeles');
  const summer = formatInTimeZone(new Date('2026-07-15T20:00:00Z'), 'America/Los_Angeles');
  assert.match(winter, /12:00 PM/);
  assert.match(summer, /1:00 PM/);
});

test('seven-day schedules highlight the local current day and calculate open state', () => {
  const resource = {
    timeZone: 'America/Los_Angeles',
    weeklyHours: {
      monday: [{ open: '09:00', close: '17:00' }],
      tuesday: [{ open: '09:00', close: '17:00' }],
      wednesday: [{ open: '09:00', close: '17:00' }],
      thursday: [{ open: '09:00', close: '17:00' }],
      friday: [{ open: '09:00', close: '17:00' }],
      saturday: [],
      sunday: []
    }
  };
  const now = new Date('2026-07-28T17:00:00Z');
  const rows = weeklyScheduleRows(resource, 'en', now);
  assert.equal(rows.length, 7);
  assert.equal(rows.find(row => row.current).day, 'tuesday');
  assert.equal(resourceScheduleState(resource, now).code, 'open_now');
  assert.equal(resourceScheduleState(resource, new Date('2026-08-02T17:00:00Z')).openNow, false);
});

test('overnight hours, holiday closures, events, appointments, and unknown hours are conservative', () => {
  const overnight = {
    timeZone: 'America/Los_Angeles',
    weeklyHours: {
      monday: [],
      tuesday: [{ open: '22:00', close: '02:00' }],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: []
    }
  };
  assert.equal(resourceScheduleState(overnight, new Date('2026-07-29T08:00:00Z')).openNow, true);
  const holiday = {
    ...overnight,
    weeklyHours: { ...overnight.weeklyHours, tuesday: [{ open: '09:00', close: '17:00' }] },
    holidayHours: [{ date: '2026-07-28', closed: true }]
  };
  assert.equal(resourceScheduleState(holiday, new Date('2026-07-28T17:00:00Z')).openNow, false);
  assert.equal(resourceScheduleState({ eventDates: ['2026-07-28'] }, new Date('2026-07-28T17:00:00Z')).availableToday, true);
  assert.equal(resourceScheduleState({
    eventDates: ['2026-07-28'],
    weeklyHours: { ...overnight.weeklyHours, tuesday: [] }
  }, new Date('2026-07-28T17:00:00Z')).code, 'event_today');
  assert.equal(resourceScheduleState({ appointmentOnly: true }, new Date('2026-07-28T17:00:00Z')).openNow, false);
  const appointment = resourceScheduleState({
    appointmentOnly: true,
    weeklyHours: { ...overnight.weeklyHours, tuesday: [{ open: '09:00', close: '17:00' }] }
  }, new Date('2026-07-28T17:00:00Z'));
  assert.equal(appointment.code, 'appointment_only');
  assert.equal(appointment.availableToday, true);
  assert.equal(appointment.openNow, false);
  assert.equal(resourceScheduleState({}, new Date('2026-07-28T17:00:00Z')).code, 'hours_not_listed');
  assert.equal(resourceScheduleState({ temporaryClosure: true, weeklyHours: holiday.weeklyHours }, new Date('2026-07-28T17:00:00Z')).openNow, false);
});

test('all result filters combine without treating missing evidence as affirmative', () => {
  const now = new Date('2026-07-28T17:00:00Z');
  const matching = {
    id: 'matching',
    name: 'Matching',
    category: 'health',
    services: ['health'],
    distance: 2,
    weeklyHours: {
      monday: [],
      tuesday: [{ open: '09:00', close: '17:00' }],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: [],
      sunday: []
    },
    timeZone: 'America/Los_Angeles',
    walkInStatus: 'Walk-ins accepted',
    noIdRequired: true,
    registrationRequirement: 'Not required',
    accessibility: ['Wheelchair accessible'],
    languages: ['Spanish'],
    localEligibilityVerified: true
  };
  const missingEvidence = { id: 'unknown', name: 'Unknown', category: 'health', distance: 1 };
  const result = filterResources([matching, missingEvidence], {
    category: 'health',
    radius: 5,
    openNow: true,
    availableToday: true,
    walkIn: true,
    noId: true,
    noRegistration: true,
    accessible: true,
    language: 'spanish',
    verifiedEligibility: true
  }, { now });
  assert.deepEqual(result.map(resource => resource.id), ['matching']);
});

test('distance and open-soonest sorting keep missing values last', () => {
  const schedule = open => ({
    monday: [],
    tuesday: [{ open, close: '17:00' }],
    wednesday: [],
    thursday: [],
    friday: [],
    saturday: [],
    sunday: []
  });
  const rows = [
    { id: 'far', distance: 8, weeklyHours: schedule('11:00'), timeZone: 'America/Los_Angeles' },
    { id: 'near', distance: 1, weeklyHours: schedule('10:00'), timeZone: 'America/Los_Angeles' },
    { id: 'missing', distance: null }
  ];
  assert.deepEqual(sortResources(rows, 'nearest').map(row => row.id), ['near', 'far', 'missing']);
  assert.deepEqual(sortResources(rows, 'farthest').map(row => row.id), ['far', 'near', 'missing']);
  assert.deepEqual(
    sortResources(rows, 'openSoonest', new Date('2026-07-28T16:00:00Z')).map(row => row.id),
    ['near', 'far', 'missing']
  );
});

test('eligibility questions include only missing relevant fields', () => {
  const rules = [
    { field: 'age', question: 'Age?' },
    { field: 'county', question: 'County?' }
  ];
  assert.deepEqual(questionsForRules(rules, { age: 30 }).map(item => item.field), ['county']);
});

test('eligibility without stored rules is not mislabeled as a technical failure', () => {
  assert.equal(evaluateEligibility([], {}).status, 'No eligibility requirements published');
});

test('missing eligibility answers return possibly eligible', () => {
  const result = evaluateEligibility([{ field: 'age', operator: 'gte', value: 18 }], {});
  assert.equal(result.status, 'Possibly eligible');
});

test('explainable eligibility returns likely eligible', () => {
  const result = evaluateEligibility([{ field: 'age', label: 'Age 18+', operator: 'gte', value: 18 }], { age: 25 });
  assert.equal(result.status, 'Likely eligible');
  assert.match(result.reasons[0], /meets/);
});

test('eligibility exceptions can be expressed as allowed values', () => {
  const result = evaluateEligibility([{ field: 'status', operator: 'in', value: ['veteran', 'spouse'] }], { status: 'spouse' });
  assert.equal(result.status, 'Likely eligible');
});

test('household-size-dependent income limits calculate correctly', () => {
  const rule = { field: 'income', operator: 'incomeTable', value: { 1: 20000, 2: 27000, default: 30000 } };
  assert.equal(evaluateEligibility([rule], { income: 26000, householdSize: 2 }).status, 'Likely eligible');
  assert.equal(evaluateEligibility([rule], { income: 28000, householdSize: 2 }).status, 'Likely not eligible');
});

test('eligibility summaries preserve source and uncertainty', () => {
  const summary = summarizeEligibility({ eligibilitySummary: 'County residents may apply.', officialWebsite: 'https://official.example' });
  assert.equal(summary.sourceUrl, 'https://official.example');
  assert.match(summary.disclaimer, /confirm/);
});

test('registration links require HTTPS and can be restricted to official domains', () => {
  assert.equal(validateRegistrationLink('http://example.org/form').valid, false);
  assert.equal(validateRegistrationLink('https://apply.example.org/form', ['example.org']).valid, true);
  assert.equal(validateRegistrationLink('https://phish.example/form', ['example.org']).valid, false);
});

test('registration guide does not invent a form', () => {
  const guide = registrationSteps({ name: 'Program', requiredDocuments: [] });
  assert.equal(guide.formUrl, '');
  assert.match(guide.steps[0], /No verified online form/);
});

test('registration submission requires confirmation and authorization', () => {
  assert.equal(maySubmitRegistration({ confirmed: true, authorized: false }), false);
  assert.equal(maySubmitRegistration({ confirmed: true, authorized: true }), true);
});

test('haversine distance is geographically plausible', () => {
  const miles = haversineMiles(47.6062, -122.3321, 47.6205, -122.3493);
  assert.ok(miles > 1 && miles < 2);
});

test('geocoding handles successful, empty, and API-error responses', async () => {
  const ok = async () => ({ ok: true, json: async () => [{ lat: '47.6', lon: '-122.3', display_name: 'Seattle', importance: .9 }] });
  assert.equal((await geocodeLocation('Seattle', ok)).label, 'Seattle');
  const empty = async () => ({ ok: true, json: async () => [] });
  await assert.rejects(() => geocodeLocation('Nope', empty), /not found/);
  const failed = async () => ({ ok: false });
  await assert.rejects(() => geocodeLocation('Seattle', failed), /lookup failed/);
});

test('ambiguous geocoding asks for clarification', async () => {
  const ambiguous = async () => ({ ok: true, json: async () => [
    { lat: '1', lon: '1', display_name: 'Springfield A', importance: .5 },
    { lat: '2', lon: '2', display_name: 'Springfield B', importance: .49 }
  ] });
  await assert.rejects(() => geocodeLocation('Springfield', ambiguous), error => error.code === 'AMBIGUOUS_LOCATION');
});

test('situation text extracts exact local time and ranks confirmed food availability first', () => {
  const constraints = parseSituation('I need food tonight at 7:00 PM within 5 miles and without an ID.', {
    location: 'Seattle, WA',
    now: new Date('2026-07-29T16:00:00Z')
  });
  assert.deepEqual(constraints.categories, ['food']);
  assert.equal(constraints.requestedDate, '2026-07-29');
  assert.equal(constraints.requestedMinutes, 19 * 60);
  assert.equal(constraints.timeZone, 'America/Los_Angeles');
  assert.equal(constraints.noId, true);
  assert.equal(constraints.maxDistance, 5);

  const base = {
    category: 'food',
    services: ['food'],
    timeZone: 'America/Los_Angeles',
    verified: '2026-07-29',
    verificationPeriodDays: 30,
    noIdRequired: true,
    sourceUrls: ['https://official.example']
  };
  const ranked = rankResources([
    { ...base, id: 'closed', name: 'Closes early', distance: 0.5, weeklyHours: { wednesday: [{ open: '09:00', close: '17:00' }] } },
    { ...base, id: 'open', name: 'Dinner pantry', distance: 0.8, weeklyHours: { wednesday: [{ open: '18:00', close: '20:00' }] } },
    { ...base, id: 'unknown', name: 'Unknown schedule', distance: 0.2 }
  ], { categories: ['food'], constraints });
  assert.equal(ranked[0].id, 'open');
  assert.equal(ranked[0]._availabilityAtRequest.code, 'confirmed_available');
  assert.match(ranked[0]._rankExplanation, /confirmed available at the requested time/);
  assert.equal(ranked.find(resource => resource.id === 'closed')._availabilityAtRequest.code, 'confirmed_unavailable');
});

test('a requested time uses the nearest date phrase in a multi-need situation', () => {
  const constraints = parseSituation(
    'Needs food tonight at 8:30 PM and shelter options tomorrow.',
    {
      location: 'Seattle, WA',
      now: new Date('2026-07-29T16:00:00Z')
    }
  );
  assert.equal(constraints.requestedDate, '2026-07-29');
  assert.equal(constraints.requestedMinutes, 20 * 60 + 30);
  const tomorrow = parseSituation(
    'Needs food today and shelter tomorrow at 7:00 AM.',
    {
      location: 'Seattle, WA',
      now: new Date('2026-07-29T16:00:00Z')
    }
  );
  assert.equal(tomorrow.requestedDate, '2026-07-30');
});

test('exact availability checks distribution windows and appointment requirements', () => {
  const instant = parseSituation('food tonight at 7 PM', {
    location: 'Seattle, WA',
    now: new Date('2026-07-29T16:00:00Z')
  }).requestedInstant;
  const open = resourceAvailabilityAt({
    timeZone: 'America/Los_Angeles',
    weeklyHours: { wednesday: [{ open: '18:30', close: '19:30' }] }
  }, instant);
  const appointment = resourceAvailabilityAt({
    timeZone: 'America/Los_Angeles',
    appointmentOnly: true,
    weeklyHours: { wednesday: [{ open: '18:30', close: '19:30' }] }
  }, instant);
  assert.equal(open.code, 'confirmed_available');
  assert.equal(appointment.code, 'appointment_required');
});

test('location autocomplete returns at most five deduplicated U.S. suggestions', async () => {
  const fetcher = async () => ({
    ok: true,
    json: async () => ({
      features: [
        { properties: { name: 'Chicago', state: 'Illinois', countrycode: 'US' }, geometry: { coordinates: [-87.6298, 41.8781] } },
        { properties: { name: 'Chicago', state: 'Illinois', countrycode: 'US' }, geometry: { coordinates: [-87.6298, 41.8781] } },
        { properties: { name: 'Chicago Heights', state: 'Illinois', countrycode: 'US' }, geometry: { coordinates: [-87.6359, 41.5061] } },
        { properties: { name: 'Chicago', state: 'Outside US', countrycode: 'CA' }, geometry: { coordinates: [-80, 44] } }
      ]
    })
  });
  const suggestions = await suggestLocations('Chcago', fetcher);
  assert.equal(suggestions.length, 2);
  assert.match(suggestions[0].label, /Chicago, Illinois, USA/);
  assert.ok(suggestions.every(suggestion => Number.isFinite(suggestion.lat) && Number.isFinite(suggestion.lng)));
});

test('normalized search signatures are stable and include situation, filters, and sorting', () => {
  const first = searchSignature({
    location: ' Chicago,  IL ',
    radius: 10,
    category: 'food',
    categories: ['family', 'food'],
    situation: 'No ID',
    filters: { accessible: false, noId: true },
    sort: 'nearest'
  });
  const second = searchSignature({
    location: 'chicago,il',
    radius: 10,
    category: 'FOOD',
    categories: ['food', 'family', 'food'],
    situation: ' no id ',
    filters: { noId: true },
    sort: 'NEAREST'
  });
  assert.equal(first, second);
  assert.deepEqual(normalizeSearchParameters({ filters: { noId: true, openNow: false } }).filters, { noId: true });
  assert.notEqual(first, searchSignature({ location: 'Chicago, IL', radius: 10, category: 'food', situation: 'has ID' }));
});

test('radius is represented in the Overpass query', () => {
  assert.match(buildOverpassQuery(47, -122, 1), /around:1609/);
  assert.match(buildOverpassQuery(47, -122, 25), /around:40234/);
});

test('OpenStreetMap normalization retains source attribution', () => {
  const resource = normalizeOsmElement({
    id: 1,
    type: 'node',
    lat: 47,
    lon: -122,
    tags: {
      name: 'Food Pantry',
      amenity: 'food_bank',
      opening_hours: 'Mo-Fr 09:00-17:00',
      wheelchair: 'yes',
      'contact:language': 'English; Spanish'
    }
  }, { lat: 47, lng: -122 });
  assert.equal(resource.category, 'food');
  assert.match(resource.sourceUrls[0], /openstreetmap/);
  assert.equal(resource.verificationStatus.includes('confirm'), true);
  assert.equal(resource.eligibilityStatus, 'varies');
  assert.equal(resource.eligibilityResearchStatus, 'pending');
  assert.equal(resource.weeklyHours.monday[0].open, '09:00');
  assert.deepEqual(resource.accessibility, ['Wheelchair accessible']);
  assert.deepEqual(resource.languages, ['English', 'Spanish']);
});

test('community-discovered hours remain uncertain until provider verification', () => {
  const resource = normalizeOsmElement({
    type: 'node',
    id: 9,
    lat: 47.61,
    lon: -122.33,
    tags: {
      name: 'Example Food Bank',
      amenity: 'food_bank',
      opening_hours: 'Mo-Su 20:00-22:00',
      'addr:city': 'Seattle',
      'addr:state': 'WA'
    }
  }, { lat: 47.61, lng: -122.33 });
  const result = resourceAvailabilityAt(resource, new Date('2026-07-30T03:30:00Z'));
  assert.equal(result.code, 'uncertain');
  assert.match(result.reason, /not yet been confirmed/i);
});

test('community centers are not classified as food aid from incidental wording', () => {
  assert.equal(inferCategory({
    name: 'Area 01 Community Center',
    amenity: 'community_centre',
    description: 'Community center for a Housing and Food Services population'
  }), 'family');
  assert.equal(inferCategory({ name: 'Neighborhood Food Bank', amenity: 'food_bank' }), 'food');
});

test('stored addresses receive coordinates and distance in the background enrichment path', async () => {
  clearLocationCaches();
  const fetcher = async () => ({
    ok: true,
    json: async () => [{ lat: '47.6101', lon: '-122.3344', display_name: '1 Main St, Seattle, WA' }]
  });
  const enriched = await geocodeResourceAddresses(
    [{ id: 'stored', name: 'Stored', address: '1 Main St, Seattle, WA' }],
    { origin: { lat: 47.6062, lng: -122.3321 }, fetcher, maximum: 1 }
  );
  assert.equal(enriched[0].latitude, 47.6101);
  assert.ok(enriched[0].distance > 0);
});

test('live discovery tries both bounded endpoints and clearly fails when both fail', async () => {
  let attempts = 0;
  const fetcher = async () => {
    attempts += 1;
    throw new Error('external unavailable');
  };
  await assert.rejects(
    fetchNearbyResources({ lat: 47.6, lng: -122.3, fetcher }),
    /external unavailable/
  );
  assert.equal(attempts, 2);
});

test('configured Places enrichment preserves official facts and flags conflicts', async () => {
  assert.equal(placesApiKey({ querySelector: () => ({ content: ' configured-key ' }) }), 'configured-key');
  let unconfiguredCalls = 0;
  const none = await findConfiguredPlace({ name: 'Program' }, {
    apiKey: '',
    fetcher: async () => {
      unconfiguredCalls += 1;
      return {};
    }
  });
  assert.equal(none, null);
  assert.equal(unconfiguredCalls, 0);

  const periods = googlePeriodsToWeeklyHours([{
    open: { day: 1, hour: 9, minute: 0 },
    close: { day: 1, hour: 17, minute: 0 }
  }]);
  assert.deepEqual(periods.monday, [{ open: '09:00', close: '17:00' }]);
  assert.deepEqual(googleSpecialHours({
    specialDays: [{ date: { year: 2026, month: 12, day: 25 }, exceptionalHours: true }]
  }), [{ date: '2026-12-25', periods: null, label: '' }]);

  const official = {
    id: 'official',
    address: '1 Official Way',
    phone: '206-555-0100',
    officialWebsite: 'https://official.example',
    weeklyHours: { monday: [{ open: '08:00', close: '16:00' }] },
    hoursSourceUrl: 'https://official.example/hours'
  };
  const merged = mergePlaceEvidence(official, {
    id: 'place-id',
    formattedAddress: '2 Different Way',
    nationalPhoneNumber: '206-555-0199',
    websiteUri: 'https://different.example',
    businessStatus: 'CLOSED_TEMPORARILY',
    regularOpeningHours: { periods: [{ open: { day: 1, hour: 9 }, close: { day: 1, hour: 17 } }] }
  }, '2026-07-28');
  assert.equal(merged.address, official.address);
  assert.equal(merged.weeklyHours, official.weeklyHours);
  assert.equal(merged.hoursSourceUrl, official.hoursSourceUrl);
  assert.equal(merged.temporaryClosure, true);
  assert.ok(merged.conflicts.length >= 3);
});

test('user-provided text is escaped before DOM insertion', () => {
  assert.equal(escapeHtml('<img src=x onerror="alert(1)">'), '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
});

test('phone and external URL sanitizers reject unsafe values', () => {
  assert.equal(sanitizePhone('+1 (206) 555-0100;ext=1'), '+120655501001');
  assert.equal(safeExternalUrl('javascript:alert(1)'), '');
});

test('helper plan supports add, status, notes, provider questions, remove, and clear', () => {
  const added = addPlanResource([], { id: 'a', name: 'A' }, new Date('2026-01-01T00:00:00Z'));
  assert.equal(added[0].status, 'Not contacted');
  const called = updatePlanStatus(added, 'a', 'Called');
  assert.equal(called[0].status, 'Called');
  const noted = updatePlanNote(called, 'a', '<private note>');
  assert.equal(noted[0].note, '<private note>');
  const questioned = updatePlanQuestions(noted, 'a', 'Is Tuesday available?');
  assert.equal(questioned[0].questions, 'Is Tuesday available?');
  assert.equal(removePlanResource(questioned, 'a').length, 0);
  assert.deepEqual(clearPlan(), { plan: [], intake: {} });
});

test('helper plan snapshots retain the facts needed after navigation or refresh', () => {
  const [snapshot] = addPlanResource([], {
    id: 'clinic',
    name: 'Community Clinic',
    category: 'health',
    services: ['health'],
    address: '100 Main St',
    distance: 1.2,
    hours: 'Monday 9 a.m.-3 p.m.',
    weeklyHours: { monday: [{ open: '09:00', close: '15:00' }] },
    hoursLastVerified: '2026-07-28',
    applicationMethods: ['online', 'phone'],
    registrationUrl: 'https://official.example/apply',
    appointmentOnly: true,
    accessibility: ['Wheelchair accessible'],
    requiredDocuments: ['Photo ID']
  });
  assert.equal(snapshot.address, '100 Main St');
  assert.equal(snapshot.distance, 1.2);
  assert.equal(snapshot.weeklyHours.monday[0].open, '09:00');
  assert.deepEqual(snapshot.applicationMethods, ['online', 'phone']);
  assert.equal(snapshot.appointmentOnly, true);
  assert.deepEqual(snapshot.requiredDocuments, ['Photo ID']);
});

test('assistant routes to modular agents and respects mode limits', () => {
  assert.equal(detectIntent('Am I eligible?'), 'eligibility');
  const answer = routeAssistantRequest({ question: 'find food', mode: 'self', resources: [{}, {}, {}, {}] });
  assert.deepEqual(answer.agents, ['orchestrator', 'location-resource-finder']);
  assert.match(answer.message, /3 relevant/);
});

test('administrative actions enforce server-side authorization and audit changes', () => {
  assert.throws(() => requireAdmin({ authenticated: true, role: 'viewer' }), AuthorizationError);
  const updated = applyAdminAction({
    session: { authenticated: true, role: 'admin', userId: 'staff-1' },
    resource: { id: 'a', changeHistory: [] },
    action: 'approve',
    actorId: 'staff-1',
    now: new Date('2026-01-01T00:00:00Z')
  });
  assert.equal(updated.reviewStatus, 'approved');
  assert.equal(updated.changeHistory.length, 1);
});

test('background jobs record bounded retries and failures', () => {
  let job = createJob('verification', { resourceId: 'a' }, new Date('2026-01-01T00:00:00Z'));
  job = recordJobFailure(job, new Error('timeout'), new Date('2026-01-01T00:00:00Z'));
  assert.equal(job.status, 'retrying');
  job = recordJobFailure(job, new Error('timeout'), new Date('2026-01-01T00:10:00Z'));
  job = recordJobFailure(job, new Error('timeout'), new Date('2026-01-01T00:20:00Z'));
  assert.equal(job.status, 'failed');
  assert.equal(job.failures.length, 3);
});

test('background verification queues stale and incomplete food records first', () => {
  const jobs = createVerificationJobs([
    {
      id: 'general',
      category: 'legal',
      lastVerified: '2024-01-01',
      sourceUrls: ['https://example.org/general']
    },
    {
      id: 'food',
      category: 'food',
      lastVerified: '2024-01-01',
      sourceUrls: ['https://example.org/food'],
      verificationPriority: 'high'
    },
    {
      id: 'current',
      category: 'health',
      lastVerified: '2026-07-28',
      hoursLastVerified: '2026-07-28',
      eligibilityLastVerified: '2026-07-28',
      sourceUrls: ['https://example.org/current']
    }
  ], new Date('2026-07-28T12:00:00Z'));
  assert.deepEqual(jobs.map(job => job.payload.resourceId), ['food', 'general']);
  assert.equal(jobs[0].priority, 'high');
  assert.deepEqual(jobs[0].payload.checks, ['hours', 'eligibility', 'temporary-closure', 'special-events']);
});

test('coverage gaps create deterministic nationwide discovery jobs', () => {
  const jobs = createDiscoveryJobs({
    byLocation: {
      Chicago: { food: 1, legal: 3 }
    }
  }, [
    { location: 'Chicago', category: 'legal' },
    { location: 'Chicago', category: 'food' },
    { location: 'Boise', category: 'education', radiusMiles: 15 }
  ], new Date('2026-07-28T12:00:00Z'));
  assert.deepEqual(jobs.map(job => `${job.payload.location}:${job.payload.category}`), [
    'Boise:education',
    'Chicago:food'
  ]);
  assert.equal(jobs[0].priority, 'high');
  assert.ok(jobs.every(job => job.type === 'discovery'));
});

test('eligibility research queue separates extracted, review, not-found, and technical outcomes', () => {
  const now = new Date('2026-07-29T12:00:00Z');
  const jobs = createEligibilityResearchJobs([
    { id: 'missing', name: 'Missing Program', sourceUrls: ['https://official.example/program'] },
    { id: 'fresh', name: 'Fresh Program', eligibilityRules: [{ field: 'age', operator: 'gte', value: 18 }], eligibilityLastVerified: '2026-07-28' }
  ], now);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].payload.programName, 'Missing Program');
  assert.equal(jobs[0].type, 'eligibility-extraction');
  const review = recordEligibilityResearchOutcome(jobs[0], {
    status: 'ambiguous_review',
    reason: 'The official page and intake form use different income periods.'
  }, now);
  assert.equal(review.status, 'needs_review');
  assert.match(review.researchOutcome.reason, /different income periods/);
  const technical = recordEligibilityResearchOutcome(jobs[0], {
    status: 'technical_failure',
    reason: 'Official host timed out.'
  }, now);
  assert.equal(technical.status, 'failed');
});

test('eligibility records are stored per organization and program and export clean CSV', () => {
  const jobCorps = resources.find(resource => resource.id === 'job-corps-application');
  const record = eligibilityRecord(jobCorps);
  assert.equal(record.organization, 'U.S. Department of Labor');
  assert.equal(record.program, 'Job Corps');
  assert.equal(record.service_area, 'United States');
  assert.ok(record.eligibility_page.startsWith('https://'));
  assert.ok(record.application_link.startsWith('https://'));
  const csv = exportEligibilityCsv([jobCorps]);
  assert.match(csv, /"organization","program","service_category"/);
  assert.match(csv, /"U\.S\. Department of Labor","Job Corps"/);
});

test('decision planning respects distance, budget, accessibility, and reusable documents', () => {
  const base = {
    category: 'food',
    services: ['food'],
    lastVerified: '2026-07-28',
    verificationPeriodDays: 90,
    applicationMethods: ['inPerson'],
    requiredDocuments: ['Proof of address'],
    weeklyHours: {
      monday: [{ open: '00:00', close: '24:00' }],
      tuesday: [{ open: '00:00', close: '24:00' }],
      wednesday: [{ open: '00:00', close: '24:00' }],
      thursday: [{ open: '00:00', close: '24:00' }],
      friday: [{ open: '00:00', close: '24:00' }],
      saturday: [{ open: '00:00', close: '24:00' }],
      sunday: [{ open: '00:00', close: '24:00' }]
    }
  };
  const plan = buildDecisionPlan([
    { ...base, id: 'near', name: 'Near Pantry', distance: 1, accessibility: ['Wheelchair accessible'] },
    { ...base, id: 'far', name: 'Far Pantry', distance: 12, accessibility: ['Wheelchair accessible'] },
    { ...base, id: 'unknown-access', name: 'Unknown Access', distance: 2, accessibility: [] }
  ], {
    transportation: 'walking',
    maxDistance: 5,
    walkingLimit: 3,
    transportationBudget: 0,
    wheelchairAccessible: true
  }, { now: new Date('2026-07-28T12:00:00Z') });
  assert.ok(plan.steps.some(step => step.type === 'documents'));
  assert.ok(plan.steps.some(step => step.resourceId === 'near'));
  assert.equal(plan.mode, 'self');
  assert.equal(plan.steps.at(-1).type, 'documents');
  const helperPlan = buildDecisionPlan([
    { ...base, id: 'near', name: 'Near Pantry', phone: '206-555-0100', distance: 1, accessibility: ['Wheelchair accessible'] }
  ], {
    transportation: 'walking',
    maxDistance: 5
  }, { now: new Date('2026-07-28T12:00:00Z'), mode: 'helper' });
  assert.equal(helperPlan.steps[0].type, 'documents');
  assert.equal(helperPlan.steps[1].type, 'phone');
  assert.match(helperPlan.explanation, /provider confirmation calls/);
  assert.deepEqual(plan.excluded.map(item => item.resourceId).sort(), ['far', 'unknown-access']);
  assert.match(plan.explanation, /No step guarantees/);
  assert.equal(normalizePlanConstraints({ maxDistance: -1 }).maxDistance, 10);
});

test('decision planning uses verified schedules, appointment rules, urgency, and online-first ordering', () => {
  const scheduleBase = {
    category: 'benefits',
    services: ['benefits'],
    lastVerified: '2026-07-28',
    hoursLastVerified: '2026-07-28',
    verificationPeriodDays: 90,
    requiredDocuments: [],
    accessibility: [],
    weeklyHours: { monday: [{ open: '09:00', close: '12:00' }] }
  };
  const plan = buildDecisionPlan([
    {
      ...scheduleBase,
      id: 'online-benefits',
      name: 'Benefits Application',
      applicationMethods: ['online'],
      registrationUrl: 'https://official.example/apply'
    },
    {
      ...scheduleBase,
      id: 'urgent-food',
      name: 'Emergency Food Pantry',
      category: 'food',
      services: ['food'],
      applicationMethods: ['inPerson'],
      address: '1 Main St',
      distance: 1
    },
    {
      ...scheduleBase,
      id: 'appointment-clinic',
      name: 'Appointment Clinic',
      category: 'health',
      services: ['health'],
      applicationMethods: ['phone'],
      phone: '206-555-0100',
      appointmentOnly: true,
      address: '2 Main St',
      distance: 2
    }
  ], {
    urgency: 'immediate',
    immediateNeeds: 'emergency food',
    availableDays: 'Monday',
    availableTimes: '9 a.m.-11 a.m.',
    transportation: 'walking',
    maxDistance: 5
  }, { now: new Date('2026-07-27T12:00:00Z') });
  const resourceSteps = plan.steps.filter(step => step.resourceId);
  assert.equal(resourceSteps[0].resourceId, 'urgent-food');
  assert.match(resourceSteps[0].reason, /immediate need/);
  assert.equal(resourceSteps.find(step => step.resourceId === 'appointment-clinic').type, 'phone');
  assert.equal(resourceSteps.find(step => step.resourceId === 'online-benefits').type, 'online');

  const conflict = buildDecisionPlan([{
    ...scheduleBase,
    id: 'monday-only',
    name: 'Monday Only',
    applicationMethods: ['inPerson']
  }], {
    availableDays: 'Tuesday',
    transportation: 'walking',
    maxDistance: 5
  }, { now: new Date('2026-07-27T12:00:00Z') });
  assert.equal(conflict.steps.length, 0);
  assert.match(conflict.excluded[0].reasons.join(' '), /Tuesday/i);
});

test('page routes survive direct, refreshed, and nested Action Plan URLs', () => {
  assert.equal(hashForPage('actionPlan'), '#/action-plan');
  assert.equal(pageFromHash('#/action-plan'), 'actionPlan');
  assert.equal(pageFromHash('#/action-plan/review'), 'actionPlan');
  assert.equal(pageFromHash('#action-plan?source=saved'), 'actionPlan');
  assert.equal(pageFromHash('#/unknown'), 'home');
  assert.equal(isCurrentPage('actionPlan', 'actionPlan'), true);
  assert.equal(isCurrentPage('find', 'actionPlan'), false);
});

test('active navigation renders an accessible non-color-only current-page state', async () => {
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(appSource, /aria-current="page"/);
  assert.match(appSource, /isCurrentPage\(state\.page, page\)/);
  assert.match(css, /\.nav-links button\[aria-current="page"\]/);
  assert.match(css, /box-shadow:\s*inset 0 -3px 0/);
  assert.match(css, /\.nav-links button\[aria-current="page"\]::after/);
});

test('critical UI copy and privacy constraints are present', async () => {
  const locale = await readFile(new URL('../js/localization.js', import.meta.url), 'utf8');
  assert.match(locale, /How are you using BridgeAid\?/);
  assert.match(locale, /What do you need right now\?/);
  assert.match(locale, /Help someone find support\./);
  assert.match(locale, /Only enter information you have permission to use/);
  assert.doesNotMatch(locale, /Social Security number["']?\s*[:=]\s*['"]/i);
});

test('responsive CSS includes 320-friendly, tablet, desktop, reduced-motion, and print rules', async () => {
  const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /max-width:430px/);
  assert.match(css, /max-width:760px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media print/);
});

test('all three locales contain exactly the same translation keys', () => {
  const completeness = localeCompleteness();
  for (const language of ['en', 'zh', 'es']) {
    assert.deepEqual(completeness[language].missing, []);
    assert.deepEqual(completeness[language].extra, []);
  }
});

test('every literal translation key used by the app exists in all locales', async () => {
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const usedKeys = [...appSource.matchAll(/\btr\(['"]([^'"]+)['"]/g)].map(match => match[1]);
  for (const key of usedKeys) {
    assert.ok(key in LOCALES.en, `missing English key: ${key}`);
    assert.ok(key in LOCALES.zh, `missing Chinese key: ${key}`);
    assert.ok(key in LOCALES.es, `missing Spanish key: ${key}`);
  }
});

test('reviewed Chinese and Spanish core copy is natural and complete', () => {
  assert.equal(translate('zh', 'selfHero'), '您现在最需要什么？');
  assert.equal(translate('zh', 'privacyTitle'), '您的信息由您掌控。');
  assert.equal(translate('es', 'selfHero'), '¿Qué necesita en este momento?');
  assert.equal(translate('es', 'privacyTitle'), 'Usted mantiene el control de su información.');
});

test('message language detection and explicit language requests work', () => {
  assert.equal(detectMessageLanguage('我想找食物', 'en'), 'zh');
  assert.equal(detectMessageLanguage('Necesito comida cerca', 'en'), 'es');
  assert.equal(detectMessageLanguage('I need food', 'zh'), 'en');
  assert.equal(requestedLanguage('Please answer in Spanish'), 'es');
  assert.equal(requestedLanguage('请用中文回答'), 'zh');
});

test('assistant understands multilingual categories, locations, and distinct intents', () => {
  assert.equal(assistantCategory('我需要食物'), 'food');
  assert.equal(assistantCategory('Necesito ayuda legal'), 'legal');
  assert.equal(assistantCategory('Necesito atención médica'), 'health');
  assert.equal(locationFromMessage('Find food near Seattle, WA'), 'Seattle, WA');
  assert.equal(assistantIntent('What time are you open?'), 'hours');
  assert.equal(assistantIntent('How do I apply?'), 'registration');
});

test('assistant language requests are not mistaken for locations', () => {
  assert.equal(locationFromMessage('Please answer in English. How do I apply?'), '');
  assert.equal(locationFromMessage('Respóndame en español. ¿Cómo solicito?'), '');
  assert.equal(locationFromMessage('Find food in Seattle, WA'), 'Seattle, WA');
});

test('grounded assistant cites stored resources and responds in the message language', () => {
  const fixture = [{
    id: 'local-food',
    name: 'Community Pantry',
    category: 'food',
    services: ['food'],
    address: '100 Main St, Seattle, WA 98101',
    hours: { en: 'Mon 9–5', zh: '周一 9:00–17:00', es: 'Lun 9–5' },
    eligibility: { en: 'Seattle residents', zh: '西雅图居民', es: 'Residentes de Seattle' },
    source: 'Official program',
    sourceUrls: ['https://official.example/program'],
    verified: '2026-07-01',
    distance: 1
  }];
  const answer = answerGroundedAssistant({
    message: 'Necesito comida en 98101',
    selectedLanguage: 'en',
    languageExplicit: false,
    resources: fixture,
    translate
  });
  assert.equal(answer.language, 'es');
  assert.match(answer.text, /Encontré/);
  assert.equal(answer.recommendations[0].name, 'Community Pantry');
  assert.equal(answer.recommendations[0].address, '100 Main St, Seattle, WA 98101');
});

test('latest assistant message language wins and remains consistent across turns', () => {
  const fixture = [{
    id: 'local-food',
    name: 'Community Pantry',
    category: 'food',
    services: ['food'],
    address: '100 Main St, Seattle, WA 98101',
    sourceUrls: ['https://official.example/program']
  }];
  const chinese = answerGroundedAssistant({
    message: '我需要食物',
    selectedLanguage: 'en',
    currentLocation: 'Seattle',
    resources: fixture,
    translate
  });
  assert.equal(chinese.language, 'zh');
  assert.match(chinese.text, /找到/);
  const spanish = answerGroundedAssistant({
    message: 'Necesito comida',
    selectedLanguage: 'zh',
    currentLocation: 'Seattle',
    resources: fixture,
    context: chinese.context,
    translate
  });
  assert.equal(spanish.language, 'es');
  assert.match(spanish.text, /Encontré/);
  const english = answerGroundedAssistant({
    message: 'I need food',
    selectedLanguage: 'es',
    currentLocation: 'Seattle',
    resources: fixture,
    context: spanish.context,
    translate
  });
  assert.equal(english.language, 'en');
  assert.match(english.text, /I found/);
});

test('assistant asks specific follow-ups and does not repeat unrelated answers', () => {
  const missingLocation = answerGroundedAssistant({
    message: 'I need food',
    selectedLanguage: 'en',
    resources: [],
    translate
  });
  assert.equal(missingLocation.followUp, 'location');
  const resource = {
    id: 'clinic',
    name: 'Local Clinic',
    category: 'health',
    services: ['health'],
    address: '1 Pine St, Seattle, WA',
    hours: 'Mon–Fri 9–5',
    sourceUrls: ['https://official.example'],
    registrationUrl: 'https://official.example/apply'
  };
  const hours = answerGroundedAssistant({
    message: 'What hours is the clinic open?',
    selectedLanguage: 'en',
    currentLocation: 'Seattle',
    resources: [resource],
    selectedResource: resource,
    translate
  });
  const registration = answerGroundedAssistant({
    message: 'How do I apply?',
    selectedLanguage: 'en',
    currentLocation: 'Seattle',
    resources: [resource],
    selectedResource: resource,
    translate
  });
  assert.notEqual(hours.text, registration.text);
});

test('local eligibility requires both a matching service area and official rules', () => {
  const fixture = {
    id: 'local-benefit',
    name: 'King County Benefit',
    category: 'benefits',
    address: 'Seattle, WA 98101',
    serviceAreas: ['King County', '98101'],
    eligibilityRules: [{ field: 'householdSize', operator: 'gte', value: 1 }],
    eligibilitySourceUrl: 'https://kingcounty.example/eligibility',
    eligibilityLastVerified: '2026-07-20',
    sourceUrls: ['https://kingcounty.example/eligibility']
  };
  assert.equal(servesLocation(fixture, '98101'), true);
  assert.equal(localProgramForResource(fixture, '98101').localEligibilityVerified, true);
  assert.equal(localProgramForResource(fixture, 'Tacoma').localEligibilityVerified, false);
});

test('local scope matching does not treat a shared state abbreviation as the same city', () => {
  const austin = resources.find(resource => resource.id === 'central-texas-food-bank-onsite-pantry');
  const cleveland = resources.find(resource => resource.id === 'houston-food-bank-trinity-river-crc');
  assert.equal(servesLocation(austin, 'Austin, TX'), true);
  assert.equal(servesLocation(cleveland, 'Austin, TX'), false);
  assert.equal(servesLocation(cleveland, '77327'), true);
});

test('local eligibility asks only program-specific questions and explains results', () => {
  const fixture = {
    id: 'local-benefit',
    name: 'Local Benefit',
    address: 'Seattle, WA 98101',
    eligibilityRules: [
      { field: 'householdSize', operator: 'gte', value: 1 },
      { field: 'income', operator: 'lte', value: 30000 }
    ],
    eligibilitySourceUrl: 'https://official.example/eligibility',
    sourceUrls: ['https://official.example/eligibility']
  };
  const questions = localEligibilityQuestions(fixture, '98101', {});
  assert.deepEqual(questions.map(question => question.field), ['householdSize', 'income']);
  const result = evaluateLocalEligibility(fixture, '98101', { householdSize: 2, income: 25000 });
  assert.equal(result.status, 'Likely eligible');
  assert.equal(result.passed.length, 2);
});

test('Seattle utility screening applies the exact 2026 household-income table', () => {
  const program = resources.find(resource => resource.id === 'seattle-udp');
  const eligible = evaluateLocalEligibility(program, '98101', {
    householdSize: 2,
    income: 5500,
    utilityAccount: 'yes'
  });
  const overLimit = evaluateLocalEligibility(program, 'Seattle, WA', {
    householdSize: 2,
    income: 5600,
    utilityAccount: 'yes'
  });
  assert.equal(eligible.status, 'Likely eligible');
  assert.equal(overLimit.status, 'Likely not eligible');
  assert.equal(evaluateLocalEligibility(program, '10001', {}).status, 'Program does not serve this location');
});

test('age-range eligibility supports exact program minimum and maximum ages', () => {
  assert.equal(evaluateEligibility([{ field: 'age', operator: 'between', value: [19, 64] }], { age: 19 }).status, 'Likely eligible');
  assert.equal(evaluateEligibility([{ field: 'age', operator: 'between', value: [19, 64] }], { age: 65 }).status, 'Likely not eligible');
});

test('rich registration guidance returns steps, methods, deadlines, and multiple actions', () => {
  const program = normalizeResource(resources.find(resource => resource.id === 'sha-low-income-housing'));
  const guide = registrationGuidance(program);
  assert.equal(guide.hasVerifiedPath, true);
  assert.ok(guide.applicationSteps.length >= 3);
  assert.ok(guide.applicationMethods.includes('online'));
  assert.ok(guide.applicationDeadline);
  assert.ok(guide.afterApplying);
  assert.ok(guide.applicationActions.length >= 2);
});

test('generic national eligibility is not presented as confirmed local eligibility', () => {
  const result = evaluateLocalEligibility({
    id: 'national',
    name: 'National Directory',
    eligibilityRules: [{ field: 'age', operator: 'gte', value: 18 }],
    sourceUrls: ['https://official.example']
  }, '98101', { age: 30 });
  assert.equal(result.status, 'Program does not serve this location');
});

test('temporary eligibility unavailability is reserved for technical research failures', () => {
  const base = {
    id: 'program',
    name: 'Program',
    city: 'Seattle',
    serviceAreas: ['Seattle'],
    eligibilitySourceUrl: 'https://official.example/eligibility'
  };
  assert.equal(evaluateLocalEligibility({
    ...base,
    eligibilityResearchStatus: 'pending'
  }, 'Seattle', {}).status, 'Eligibility research pending');
  assert.equal(evaluateLocalEligibility({
    ...base,
    eligibilityResearchStatus: 'ambiguous_review'
  }, 'Seattle', {}).status, 'Eligibility details require review');
  assert.equal(evaluateLocalEligibility({
    ...base,
    eligibilityResearchStatus: 'technical_failure'
  }, 'Seattle', {}).status, 'Eligibility information temporarily unavailable');
  assert.equal(evaluateLocalEligibility({
    ...base,
    eligibilityStatus: 'no_restrictions_listed',
    eligibilityResearchStatus: 'no_public_restrictions'
  }, 'Seattle', {}).status, 'No eligibility requirements published');
});

test('registration guidance always provides a verified path or clear alternative', () => {
  const online = registrationGuidance({
    registrationUrl: 'https://apply.example.org/form',
    officialDomains: ['example.org']
  });
  assert.equal(online.applicationUrl, 'https://apply.example.org/form');
  const phone = registrationGuidance({ phone: '211', registrationRequirement: 'Call to apply' });
  assert.equal(phone.phoneOrInPerson, true);
  assert.equal(phone.hasVerifiedPath, true);
});

test('correction reports queue without overwriting verified resource data', () => {
  const resource = { id: 'a', name: 'Program', address: 'Old address', sourceUrls: ['https://official.example'] };
  const report = createCorrectionReport({ resource, type: 'address', details: 'The sign shows a new address.', now: new Date('2026-01-01T00:00:00Z') });
  const queue = queueCorrection([], report);
  assert.equal(queue[0].status, 'verification_queued');
  assert.equal(resource.address, 'Old address');
});

test('correction verification sends confirmed evidence to administrative review', async () => {
  const resource = { id: 'a', name: 'Program', sourceUrls: ['https://official.example'] };
  const report = createCorrectionReport({ resource, type: 'closed' });
  const fetcher = async () => ({ ok: true, text: async () => '<p>Program permanently closed</p>' });
  const verified = await verifyCorrectionReport(report, resource, fetcher, new Date('2026-01-02T00:00:00Z'));
  assert.equal(verified.status, 'evidence_found');
  assert.equal(verified.requiresAdminReview, true);
  assert.equal(verified.proposedChange.evidenceUrl, 'https://official.example');
});

test('schedule verification checks official sources and extracts JSON-LD hours', async () => {
  const resource = { id: 'a', officialWebsite: 'https://official.example', sourceUrls: ['https://directory.example'] };
  assert.equal(sourcePriority(resource)[0], 'https://official.example');
  assert.equal(parseOpeningHours('Mo-Fr 09:00-17:00').friday[0].close, '17:00');
  const fetcher = async () => ({
    ok: true,
    text: async () => '<script type="application/ld+json">{"openingHours":["Mo-Fr 09:00-17:00"]}</script>'
  });
  const checked = await verifyResourceSchedule(resource, fetcher, new Date('2026-01-02T00:00:00Z'));
  assert.equal(checked.hours, 'Mo-Fr 09:00-17:00');
  assert.equal(checked.weeklyHours.monday[0].open, '09:00');
  assert.equal(checked.scheduleVerificationStatus, 'verified_from_official_source');
});

test('missing schedule becomes uncertain only after source checks fail', async () => {
  const resource = { id: 'a', officialWebsite: 'https://official.example' };
  const fetcher = async () => ({ ok: true, text: async () => '<html>No hours listed</html>' });
  const checked = await verifyResourceSchedule(resource, fetcher, new Date('2026-01-02T00:00:00Z'));
  assert.equal(checked.scheduleVerificationStatus, 'searched_no_reliable_schedule');
  assert.equal(checked.scheduleVerificationAttempts.length, 1);
});

test('verified Seattle resources publish seven-day hours or an explicit not-listed state', () => {
  const local = resources.filter(resource => resource.city === 'Seattle' && resource.verified === '2026-07-29');
  assert.ok(local.length >= 15);
  for (const resource of local) {
    assert.ok(resource.weeklyHours || resource.scheduleLabel === 'not_listed', resource.id);
    if (resource.weeklyHours) assert.equal(weeklyScheduleRows(resource).length, 7, resource.id);
    assert.ok(resource.hoursSourceUrl, `${resource.id} hours source`);
    assert.ok(resource.hoursLastVerified, `${resource.id} hours verification date`);
  }
});

test('eligibility fallback uses the exact required disclosure in the interface', async () => {
  assert.equal(
    LOCALES.en.noEligibilityRequirementsExplanation,
    'No eligibility requirements published. This provider does not publicly list specific restrictions, so contact the provider to confirm.'
  );
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /noEligibilityRequirementsListed/);
  assert.doesNotMatch(appSource, /function sourceBlock/);
});

test('nationwide online resources are separated from local results and carry actionable details', () => {
  assert.ok(nationwideResources.length >= 40);
  assert.ok(nationwideResources.every(resource => resource.scope === 'nationwide-online'));
  assert.ok(nationwideResources.every(resource => !resource.requiresLocalProvider));
  assert.ok(nationwideResources.every(resource => resource.applicationSteps?.length >= 3));
  assert.ok(nationwideResources.every(resource => resource.applicationMethods?.length));
  assert.ok(nationwideResources.every(resource => resource.lastVerified));
  assert.ok(nationwideResources.every(resource => resource.eligibilitySourceUrl?.startsWith('https://')));
  assert.ok(nationwideResources.every(resource => resource.applicationLinks?.some(link => link.url?.startsWith('https://'))));
  assert.ok(nationwideResources.every(resource => resource.nationwideAvailability));
  assert.ok(nationwideResources.every(resource => resource.eligibilitySummary));
  assert.ok(nationwideResources.every(resource => Array.isArray(resource.requiredDocuments)));
  assert.ok(nationwideResources.every(resource => resource.applicationLinks.every(link => validateRegistrationLink(link.url).valid)));
  assert.ok(nationwideResources.filter(resource => resource.eligibilityStatus === 'structured').length >= 8);
  assert.ok(resources.filter(resource => resource.scope === 'location').every(resource => !resource.onlineOnly));
  assert.ok(resources.some(resource => resource.scope === 'provider-directory'));
  for (const category of ['education', 'jobs', 'legal', 'health', 'mental', 'benefits', 'shelter', 'food', 'veteran', 'disability', 'immigration', 'family', 'internet']) {
    assert.ok(nationwideResources.some(resource => resource.category === category || resource.services.includes(category)), category);
  }
});

test('verified food programs include distribution schedules and short re-verification periods', () => {
  const foodBanks = resources.filter(resource => resource.verificationPriority === 'high');
  assert.ok(foodBanks.length >= 4);
  for (const resource of foodBanks) {
    assert.equal(resource.scope, 'location');
    assert.equal(resource.verificationPeriodDays, 30);
    assert.ok(resource.hoursLastVerified);
    assert.ok(resource.hoursSourceUrl?.startsWith('https://'));
    assert.ok(resource.weeklyHours || resource.scheduleRules?.length);
    assert.ok(resource.applicationSteps?.length >= 3);
  }
});

test('search UI exposes one Call 211 action and does not warn when stored fallback exists', async () => {
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.equal((appSource.match(/href="tel:211"/g) || []).length, 1);
  assert.doesNotMatch(appSource, /state\.errorKey\s*=\s*['"]searchError['"]/);
  assert.match(appSource, /staticMatches\(\)\.length/);
  assert.match(appSource, /void searchNearby\(\)/);
});

test('only the verified 988 crisis number is present and completion estimates are explicitly non-guaranteed', async () => {
  const paths = [
    '../js/app.js',
    '../js/localization.js',
    '../data/resources.js',
    '../README.md'
  ];
  const combined = (await Promise.all(paths.map(path => readFile(new URL(path, import.meta.url), 'utf8')))).join('\n');
  assert.doesNotMatch(combined, /\b911\b/);
  assert.match(combined, /988 Suicide & Crisis Lifeline/);
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /completionConfidence/);
  assert.match(appSource, /planNoGuarantee/);
});

test('home page implementation does not render preloaded resource cards', async () => {
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const homeFunction = appSource.slice(appSource.indexOf('function homePage()'), appSource.indexOf('function filtersPanel()'));
  assert.doesNotMatch(homeFunction, /resourceCard\(/);
  assert.match(homeFunction, /noHomeResources/);
  assert.match(appSource, /<select id="needSelect"/);
});

test('search UI requires both intake fields, paginates without a 50-record cap, and hides stale saved cards', async () => {
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /name="location"[^>]+required/);
  assert.match(appSource, /name="need"[^>]+required/);
  assert.doesNotMatch(appSource, /helperField\('immediateNeed'/);
  assert.match(appSource, /data-intake-category/);
  assert.match(appSource, /id="helperLocationInput"[^>]*required/);
  assert.match(appSource, /data-load-more/);
  assert.doesNotMatch(appSource, /\.slice\(0,\s*50\)/);
  const savedFunction = appSource.slice(appSource.indexOf('function savedPage()'), appSource.indexOf('function privacyPage()'));
  assert.match(savedFunction, /resourceIsFresh/);
  assert.match(savedFunction, /savedNeedsVerification/);
});

test('resource cards expose category text and Last verified without visible source lists', async () => {
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const cardFunction = appSource.slice(appSource.indexOf('function resourceCard('), appSource.indexOf('function comparisonPanel('));
  assert.match(cardFunction, /categoryLabel\(resource\.category\)/);
  assert.match(cardFunction, /tr\('lastVerified'\)/);
  assert.doesNotMatch(cardFunction, /sourceUrls|sourceBlock|sourceNumber/);
});
