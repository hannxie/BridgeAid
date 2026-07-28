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
  verifyResourceSchedule
} from '../js/services/schedule-verification-service.js';
import { registrationGuidance } from '../js/services/registration-service.js';

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

test('generic national eligibility is not presented as confirmed local eligibility', () => {
  const result = evaluateLocalEligibility({
    id: 'national',
    name: 'National Directory',
    eligibilityRules: [{ field: 'age', operator: 'gte', value: 18 }],
    sourceUrls: ['https://official.example']
  }, '98101', { age: 30 });
  assert.equal(result.status, 'Unable to determine');
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
  const fetcher = async () => ({
    ok: true,
    text: async () => '<script type="application/ld+json">{"openingHours":["Mo-Fr 09:00-17:00"]}</script>'
  });
  const checked = await verifyResourceSchedule(resource, fetcher, new Date('2026-01-02T00:00:00Z'));
  assert.equal(checked.hours, 'Mo-Fr 09:00-17:00');
  assert.equal(checked.scheduleVerificationStatus, 'verified_from_official_source');
});

test('missing schedule becomes uncertain only after source checks fail', async () => {
  const resource = { id: 'a', officialWebsite: 'https://official.example' };
  const fetcher = async () => ({ ok: true, text: async () => '<html>No hours listed</html>' });
  const checked = await verifyResourceSchedule(resource, fetcher, new Date('2026-01-02T00:00:00Z'));
  assert.equal(checked.scheduleVerificationStatus, 'searched_no_reliable_schedule');
  assert.equal(checked.scheduleVerificationAttempts.length, 1);
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
