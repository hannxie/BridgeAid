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
  cacheKey,
  readCachedSearch,
  writeCachedSearch
} from '../js/services/resource-service.js';
import {
  nextRecurringEvent,
  resolveSchedule,
  formatInTimeZone
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
  normalizeOsmElement
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
import { createJob, recordJobFailure } from '../server/services/background-job-service.js';

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

test('duplicate merging retains supporting evidence', () => {
  const merged = mergeDuplicates([
    { id: 'a', name: 'Food Bank', address: '1 Main', sourceUrls: ['https://one.example'] },
    { id: 'b', name: 'Food Bank', address: '1 Main', sourceUrls: ['https://two.example'] }
  ]);
  assert.equal(merged.length, 1);
  assert.deepEqual(new Set(merged[0].sourceUrls), new Set(['https://one.example', 'https://two.example']));
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
  const cache = writeCachedSearch({}, 'key', [{ id: 'a', name: 'A' }], now);
  assert.equal(readCachedSearch(cache, 'key', now + 1000).stale, false);
  assert.equal(readCachedSearch(cache, 'key', now + 2 * 86400000).stale, true);
});

test('offline behavior can reuse cached resources', () => {
  const cache = writeCachedSearch({}, 'offline', [{ id: 'a', name: 'Saved' }], 100);
  assert.equal(readCachedSearch(cache, 'offline', 200).resources[0].name, 'Saved');
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
    tags: { name: 'Food Pantry', amenity: 'food_bank' }
  }, { lat: 47, lng: -122 });
  assert.equal(resource.category, 'food');
  assert.match(resource.sourceUrls[0], /openstreetmap/);
  assert.equal(resource.verificationStatus.includes('confirm'), true);
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

test('critical UI copy and privacy constraints are present', async () => {
  const app = await readFile(new URL('../js/app.js', import.meta.url), 'utf8');
  assert.match(app, /How are you using BridgeAid\?/);
  assert.match(app, /What do you need right now\?/);
  assert.match(app, /Help someone find support\./);
  assert.match(app, /Only enter information you have permission to use/);
  assert.doesNotMatch(app, /Social Security number["']?\s*[:=]\s*['"]/i);
});

test('responsive CSS includes 320-friendly, tablet, desktop, reduced-motion, and print rules', async () => {
  const css = await readFile(new URL('../css/styles.css', import.meta.url), 'utf8');
  assert.match(css, /max-width:430px/);
  assert.match(css, /max-width:760px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media print/);
});
