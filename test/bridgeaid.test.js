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
  coordinateCacheKey
} from '../js/services/resource-service.js';
import {
  nextRecurringEvent,
  resolveSchedule,
  formatInTimeZone,
  weeklyScheduleRows,
  resourceScheduleState
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
  normalizeOsmElement,
  fetchNearbyResources,
  geocodeResourceAddresses,
  clearLocationCaches
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
  removePlanResource,
  clearPlan
} from '../js/services/helper-plan-service.js';
import { detectIntent, routeAssistantRequest } from '../js/services/orchestrator.js';
import { requireAdmin, applyAdminAction, AuthorizationError } from '../server/services/admin-service.js';
import {
  createJob,
  createVerificationJobs,
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
    'Education',
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
  const local = resources.filter(resource => resource.city === 'Seattle' && resource.verified === '2026-07-28');
  assert.ok(local.length >= 12);
  for (const resource of local) {
    assert.match(resource.address, /Seattle, WA \d{5}$/);
    assert.ok(resource.category);
    assert.ok(resource.source);
    assert.ok(resource.eligibilitySourceUrl?.startsWith('https://'));
    assert.equal(resource.eligibilityLastVerified, '2026-07-28');
    assert.equal(resource.applicationLastVerified, '2026-07-28');
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

test('eligibility returns unable to determine without official rules', () => {
  assert.equal(evaluateEligibility([], {}).status, 'Unable to determine');
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
  assert.equal(resource.weeklyHours.monday[0].open, '09:00');
  assert.deepEqual(resource.accessibility, ['Wheelchair accessible']);
  assert.deepEqual(resource.languages, ['English', 'Spanish']);
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

test('helper plan supports add, status, note, remove, and clear', () => {
  const added = addPlanResource([], { id: 'a', name: 'A' }, new Date('2026-01-01T00:00:00Z'));
  assert.equal(added[0].status, 'Not contacted');
  const called = updatePlanStatus(added, 'a', 'Called');
  assert.equal(called[0].status, 'Called');
  const noted = updatePlanNote(called, 'a', '<private note>');
  assert.equal(noted[0].note, '<private note>');
  assert.equal(removePlanResource(noted, 'a').length, 0);
  assert.deepEqual(clearPlan(), { plan: [], intake: {} });
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
  assert.equal(evaluateLocalEligibility(program, '10001', {}).status, 'Eligibility information temporarily unavailable');
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
  assert.equal(result.status, 'Eligibility information temporarily unavailable');
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
  const local = resources.filter(resource => resource.city === 'Seattle' && resource.verified === '2026-07-28');
  assert.equal(local.length, 13);
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
    'This provider does not publicly list specific eligibility restrictions. Contact the provider to confirm availability.'
  );
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(appSource, /noEligibilityRequirementsListed/);
  assert.doesNotMatch(appSource, /function sourceBlock/);
});

test('nationwide online resources are separated from local results and carry actionable details', () => {
  assert.ok(nationwideResources.length >= 10);
  assert.ok(nationwideResources.every(resource => resource.scope === 'nationwide-online'));
  assert.ok(nationwideResources.every(resource => resource.applicationSteps?.length >= 3));
  assert.ok(nationwideResources.every(resource => resource.applicationMethods?.length));
  assert.ok(nationwideResources.every(resource => resource.lastVerified));
  assert.ok(resources.filter(resource => resource.scope === 'location').every(resource => !resource.onlineOnly));
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

test('removed support numbers and confidence scores are absent from the interface source', async () => {
  const paths = [
    '../js/app.js',
    '../js/localization.js',
    '../data/resources.js',
    '../README.md'
  ];
  const combined = (await Promise.all(paths.map(path => readFile(new URL(path, import.meta.url), 'utf8')))).join('\n');
  assert.doesNotMatch(combined, /9(?:11|88)/);
  assert.doesNotMatch(await readFile(new URL('../js/app.js', import.meta.url), 'utf8'), /confidence/i);
});

test('home page implementation does not render preloaded resource cards', async () => {
  const appSource = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  const homeFunction = appSource.slice(appSource.indexOf('function homePage()'), appSource.indexOf('function filtersPanel()'));
  assert.doesNotMatch(homeFunction, /resourceCard\(/);
  assert.match(homeFunction, /noHomeResources/);
  assert.match(appSource, /<select id="needSelect"/);
});
