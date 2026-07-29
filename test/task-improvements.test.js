import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  QUIZ_QUESTION_BANK,
  pruneConditionalAnswers
} from '../js/services/nationwide-eligibility-service.js';
import { resources } from '../data/resources.js';
import { translate } from '../js/localization.js';

const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');

test('mission heading is localized, centered in a bubble, and body copy stays normal case', async () => {
  const [app, css] = await Promise.all([read('../js/app.js'), read('../css/styles.css')]);
  const home = app.slice(app.indexOf('function homePage()'), app.indexOf('function emptyLocalFilters()'));
  assert.equal(translate('en', 'homeMissionTitle'), 'OUR MISSION');
  assert.match(home, /class="mission-bubble"/);
  assert.match(css, /\.mission-bubble\s*\{[\s\S]*border-radius:\s*999px/);
  assert.match(css, /\.mission-copy\s*\{[\s\S]*text-align:\s*center/);
  assert.match(css, /\.mission-copy p\s*\{[\s\S]*text-transform:\s*none/);
});

test('disability, SNAP, and pregnancy questions use the requested concise wording', () => {
  assert.equal(QUIZ_QUESTION_BANK.disabilityStatus.label, 'Do you have a disability?');
  assert.equal(QUIZ_QUESTION_BANK.qualifyingBenefits.label, 'Does anyone in your household receive SNAP?');
  assert.equal(QUIZ_QUESTION_BANK.qualifyingBenefits.help, 'SNAP is a food benefit program.');
  assert.equal(QUIZ_QUESTION_BANK.pregnancyOrYoungChild.label, 'Is anyone in your household pregnant?');
});

test('yes/no quiz answers are semantic radio cards with persistent selected state', async () => {
  const [app, css] = await Promise.all([read('../js/app.js'), read('../css/styles.css')]);
  const input = app.slice(app.indexOf('function nationwideQuestionInput'), app.indexOf('function nationwideQuizPanel'));
  assert.match(input, /type="radio" name="answer"/);
  assert.match(input, /for="\$\{attr\(id\)\}"/);
  assert.match(input, /String\(value\) === optionValue \? 'checked'/);
  assert.match(input, /preferNotAnswer/);
  assert.doesNotMatch(input, /quizOption_\$\{question\.id\}.*yes/);
  assert.match(css, /\.quiz-choice\s*\{[\s\S]*min-height:\s*48px/);
  assert.match(css, /\.quiz-choice-grid\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.quiz-choice:has\(input:checked\)/);
});

test('hidden conditional quiz answers are pruned before matching', () => {
  const national = resources.filter(resource => resource.scope !== 'location');
  const answers = {
    needs: ['jobs'],
    pregnancyOrYoungChild: 'yes',
    employmentStatus: 'seeking'
  };
  const pruned = pruneConditionalAnswers(national, answers);
  assert.equal(pruned.employmentStatus, 'seeking');
  assert.equal('pregnancyOrYoungChild' in pruned, false);
});

test('filters are closed by default and use explicit accessible apply, clear, and close controls', async () => {
  const app = await read('../js/app.js');
  assert.match(app, /filtersOpen:\s*false/);
  assert.match(app, /onlineFiltersOpen:\s*false/);
  assert.match(app, /aria-expanded="\$\{open\}"/);
  assert.match(app, /aria-controls="\$\{online \? 'nationwide-filter-panel' : 'local-filter-panel'\}"/);
  assert.match(app, /data-apply-filters="local"/);
  assert.match(app, /data-clear-filters="local"/);
  assert.match(app, /data-close-filters="local"/);
  assert.match(app, /activeFilterCount/);
  assert.match(app, /<div class="search-actions">[\s\S]*search-submit[\s\S]*filterButton\('local'\)/);
});

test('chat submission updates only chat DOM and preserves page scroll and focus', async () => {
  const app = await read('../js/app.js');
  const send = app.slice(app.indexOf('async function sendChat'), app.indexOf("app.addEventListener('submit'"));
  const sync = app.slice(app.indexOf('function syncChatDom'), app.indexOf('function footer'));
  assert.doesNotMatch(send, /\brender\(/);
  assert.match(send, /const pageScrollY = window\.scrollY/);
  assert.match(send, /syncChatDom\(\{ pageScrollY, focusInput: true \}\)/);
  assert.match(sync, /messages\.replaceChildren\(fragment\)/);
  assert.match(sync, /text\.textContent = message\.text/);
  assert.match(sync, /messages\.scrollTop = messages\.scrollHeight/);
  assert.match(sync, /input\.focus\(\{ preventScroll: true \}\)/);
  assert.match(sync, /window\.scrollTo\(window\.scrollX, pageScrollY\)/);
  assert.match(app, /event\.target\.form\?\.requestSubmit\(\)/);
  assert.match(app, /event\.key !== 'Enter'/);
});

test('frontend contains no API key and chat is routed through the backend endpoint', async () => {
  const [app, client, env] = await Promise.all([
    read('../js/app.js'),
    read('../js/services/chat-api-service.js'),
    read('../.env.example')
  ]);
  assert.match(client, /fetchImpl\('\/api\/chat'/);
  assert.match(app, /requestBridgeAI\(/);
  assert.doesNotMatch(`${app}\n${client}`, /OPENAI_API_KEY|Bearer sk-/);
  assert.match(env, /OPENAI_API_KEY=/);
});

test('new logo assets are self-contained and wired into header, favicon, and manifest', async () => {
  const [app, index, manifest, horizontal, icon, favicon, notes] = await Promise.all([
    read('../js/app.js'),
    read('../index.html'),
    read('../manifest.webmanifest'),
    read('../assets/logo-bridgeaid.svg'),
    read('../assets/logo-bridgeaid-icon.svg'),
    read('../assets/favicon.svg'),
    read('../docs/LOGO_CONCEPTS.md')
  ]);
  for (const svg of [horizontal, icon, favicon]) {
    assert.match(svg, /<svg[\s\S]*viewBox=/);
    assert.doesNotMatch(svg, /\b(?:href|src)=["']https?:/);
  }
  assert.match(app, /assets\/logo-bridgeaid-icon\.svg/);
  assert.match(app, /<strong>BridgeAid<\/strong>/);
  assert.match(index, /assets\/favicon\.svg/);
  assert.match(manifest, /assets\/logo-bridgeaid-icon\.svg/);
  assert.match(notes, /Span and path \(selected\)/);
  assert.match(notes, /Linked piers/);
});

test('all new task strings are available in English, Spanish, and Chinese', () => {
  const keys = [
    'homeMissionTitle', 'filters', 'applyFilters', 'clearFilters', 'filterError',
    'preferNotAnswer', 'quizQuestion_disabilityStatus',
    'quizQuestion_qualifyingBenefits', 'quizQuestion_pregnancyOrYoungChild',
    'assistantLoading', 'chatApiUnavailable', 'chatApiTimeout',
    'chatInvalidResponse', 'chatUnsupportedLanguage', 'chatMissingLocation',
    'chatNoMatches'
  ];
  for (const language of ['en', 'es', 'zh']) {
    for (const key of keys) {
      assert.notEqual(translate(language, key), key, `${language} missing ${key}`);
    }
  }
});
