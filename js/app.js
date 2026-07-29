import {
  categories as legacyCategories,
  keywordMap,
  resources as sourceResources,
  nationwideResources
} from '../data/resources.js?v=12';
import { translate, detectMessageLanguage, requestedLanguage } from './localization.js?v=12';
import {
  safeStorageGet,
  safeStorageSet,
  safeStorageRemove,
  loadMode,
  switchMode,
  clearPrivateData
} from './services/storage.js';
import {
  normalizeResource,
  filterResources,
  rankResources,
  cacheKey,
  coordinateCacheKey,
  readCachedSearch,
  writeCachedSearch,
  mergeDuplicates,
  sortResources,
  resourceIsFresh,
  freshResources,
  searchSignature
} from './services/resource-service.js?v=12';
import {
  geocodeLocation,
  fetchNearbyResources,
  geocodeResourceAddresses,
  suggestLocations
} from './services/location-service.js?v=12';
import {
  formatScheduleTime,
  resourceScheduleState,
  weeklyScheduleRows
} from './services/schedule-service.js';
import { parseSituation } from './services/situation-service.js';
import {
  enrichWithConfiguredPlaces,
  placesApiKey
} from './services/places-enrichment-service.js';
import {
  createRequestCoordinator,
  memoizeByKey,
  storedFirstResponse
} from './services/performance-service.js';
import {
  localProgramForResource,
  localEligibilityQuestions,
  evaluateLocalEligibility,
  servesLocation
} from './services/local-eligibility-service.js?v=12';
import { registrationGuidance } from './services/registration-service.js';
import {
  answerGroundedAssistant,
  assistantCategory,
  locationFromMessage
} from './services/grounded-assistant.js?v=12';
import {
  createCorrectionReport,
  queueCorrection,
  verifyCorrectionReport
} from './services/correction-service.js';
import { verifyResourceSchedule } from './services/schedule-verification-service.js';
import { escapeHtml, sanitizePhone, safeExternalUrl } from './services/html-service.js';
import {
  addPlanResource,
  updatePlanStatus,
  updatePlanNote,
  updatePlanQuestions,
  removePlanResource,
  clearPlan as emptyPlan
} from './services/helper-plan-service.js';
import { buildDecisionPlan, normalizePlanConstraints } from './services/decision-plan-service.js';
import { exportEligibilityCsv } from './services/eligibility-data-service.js';

const STORAGE = {
  mode: 'bridgeaid-mode',
  location: 'bridgeaid-location',
  language: 'ba-lang',
  languageExplicit: 'bridgeaid-language-explicit',
  unit: 'bridgeaid-distance-unit',
  saved: 'ba-saved',
  helperIntake: 'bridgeaid-helper-intake',
  helperPlan: 'bridgeaid-helper-plan',
  cache: 'bridgeaid-resource-cache-v12',
  searches: 'bridgeaid-saved-searches',
  corrections: 'bridgeaid-correction-queue'
};

const CATEGORY_CONFIG = [
  { id: 'all', icon: '✦', key: 'categoryAll' },
  { id: 'food', icon: '●', key: 'categoryFood' },
  { id: 'shelter', icon: '⌂', key: 'categoryShelter' },
  { id: 'health', icon: '+', key: 'categoryHealth' },
  { id: 'mental', icon: '◐', key: 'categoryMental' },
  { id: 'transport', icon: '→', key: 'categoryTransport' },
  { id: 'hygiene', icon: '◌', key: 'categoryHygiene' },
  { id: 'jobs', icon: '□', key: 'categoryJobs' },
  { id: 'education', icon: '▤', key: 'categoryEducation' },
  { id: 'family', icon: '◇', key: 'categoryFamily' },
  { id: 'legal', icon: '§', key: 'categoryLegal' },
  { id: 'benefits', icon: '✓', key: 'categoryBenefits' },
  { id: 'disability', icon: '○', key: 'categoryDisability' },
  { id: 'veteran', icon: '★', key: 'categoryVeteran' },
  { id: 'immigration', icon: '◎', key: 'categoryImmigration' },
  { id: 'internet', icon: '⌘', key: 'categoryInternet' }
];

const CATEGORY_KEYS = Object.fromEntries(CATEGORY_CONFIG.map(item => [item.id, item.key]));
const categories = legacyCategories;
const STATUS_CODES = ['notContacted', 'called', 'confirmed', 'unavailable'];
const STATUS_STORAGE = {
  notContacted: 'Not contacted',
  called: 'Called',
  confirmed: 'Confirmed',
  unavailable: 'Unavailable'
};
const STATUS_KEYS = {
  notContacted: 'statusNotContacted',
  called: 'statusCalled',
  confirmed: 'statusConfirmed',
  unavailable: 'statusUnavailable'
};

const defaultUnit = /^en-US/i.test(navigator.language || '') ? 'mi' : 'km';
const initialLocation = safeStorageGet(STORAGE.location, safeStorageGet('ba-location', ''));
const initialLanguage = safeStorageGet(STORAGE.language, 'en');

const state = {
  mode: loadMode(),
  modePromptOpen: false,
  page: 'home',
  lang: ['en', 'zh', 'es'].includes(initialLanguage) ? initialLanguage : 'en',
  languageExplicit: Boolean(safeStorageGet(STORAGE.languageExplicit, false)),
  category: '',
  otherNeed: '',
  situation: '',
  situationConstraints: parseSituation(''),
  query: '',
  location: typeof initialLocation === 'string' ? initialLocation : '',
  coordinates: null,
  radiusValue: 5,
  unit: ['mi', 'km'].includes(safeStorageGet(STORAGE.unit, defaultUnit)) ? safeStorageGet(STORAGE.unit, defaultUnit) : defaultUnit,
  travelMode: 'walking',
  sortBy: 'relevance',
  searched: false,
  filters: {
    openNow: false,
    availableToday: false,
    walkIn: false,
    noId: false,
    noRegistration: false,
    accessible: false,
    language: '',
    verifiedEligibility: false
  },
  onlineFilters: {
    category: 'all',
    eligibility: 'all',
    applicationMethod: 'all'
  },
  saved: new Set(safeArray(STORAGE.saved)),
  liveResults: [],
  storedResults: sourceResources,
  resolvedLocation: '',
  activeSearchKey: '',
  loading: false,
  errorKey: '',
  errorText: '',
  locationSuggestions: [],
  locationSuggestionsLoading: false,
  discoveryStatus: 'idle',
  visibleResults: 20,
  searchDiagnostics: [],
  noticeKey: '',
  offline: !navigator.onLine,
  storageWarning: false,
  helperIntake: safeObject(STORAGE.helperIntake),
  helperPlan: safeArray(STORAGE.helperPlan),
  planConstraints: normalizePlanConstraints(),
  decisionPlan: null,
  compareIds: new Set(),
  selectedResourceId: '',
  panel: '',
  registrationStep: 0,
  reportSubmitted: false,
  corrections: safeArray(STORAGE.corrections),
  eligibility: {
    resourceId: '',
    location: typeof initialLocation === 'string' ? initialLocation : '',
    answers: {},
    step: 0,
    started: false
  },
  chatOpen: false,
  chatLoading: false,
  chatMessages: [],
  chatContext: {},
  chatMetrics: { lastResponseMs: null, answerComputeMs: null, strategy: 'stored-first' }
};

function safeObject(key) {
  const value = safeStorageGet(key, {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function safeArray(key) {
  const value = safeStorageGet(key, []);
  return Array.isArray(value) ? value : [];
}

const app = document.querySelector('#app');
const translationCache = memoizeByKey(500);
const responseCache = memoizeByKey(100);
const searchCoordinator = createRequestCoordinator();
const enrichmentCoordinator = createRequestCoordinator();
const locationSuggestionCoordinator = createRequestCoordinator();
let locationSuggestionSequence = 0;
const tr = (key, variables = {}, language = state.lang) => {
  const cacheKey = `${language}|${key}|${JSON.stringify(variables)}`;
  if (translationCache.has(cacheKey)) return translationCache.get(cacheKey);
  return translationCache.set(cacheKey, translate(language, key, variables));
};
const esc = escapeHtml;
const attr = escapeHtml;
const safeUrl = safeExternalUrl;
const phoneHref = sanitizePhone;

function persist(key, value) {
  if (!safeStorageSet(key, value)) state.storageWarning = true;
}

function persistShared() {
  persist(STORAGE.location, state.location);
  persist(STORAGE.language, state.lang);
  persist(STORAGE.languageExplicit, state.languageExplicit);
  persist(STORAGE.unit, state.unit);
  persist(STORAGE.saved, [...state.saved]);
}

function persistHelper() {
  persist(STORAGE.helperIntake, state.helperIntake);
  persist(STORAGE.helperPlan, state.helperPlan);
}

function captureSearchDraft() {
  const need = document.querySelector('#needSelect');
  const other = document.querySelector('#otherNeedInput');
  const situation = document.querySelector('#situationInput');
  const location = document.querySelector('#locationInput');
  const radius = document.querySelector('#radius');
  const travelMode = document.querySelector('#travelMode');
  if (need) state.category = need.value;
  if (other) state.otherNeed = other.value;
  if (situation) state.situation = situation.value;
  if (location) state.location = location.value;
  if (radius) state.radiusValue = Number(radius.value) || state.radiusValue;
  if (travelMode) state.travelMode = travelMode.value;
}

function categoryLabel(id, language = state.lang) {
  return tr(CATEGORY_KEYS[id] || 'categoryAll', {}, language);
}

function categoryIcon(id) {
  return CATEGORY_CONFIG.find(item => item.id === id)?.icon
    || categories.find(item => item.id === id)?.icon
    || '•';
}

function categoryQuery(id) {
  return categories.find(item => item.id === id)?.query || categoryLabel(id, 'en');
}

function detectCategories(query) {
  const text = String(query || '').toLowerCase();
  const detected = Object.entries(keywordMap)
    .filter(([, words]) => words.some(word => text.includes(word)))
    .map(([id]) => id);
  if (/shower|laundry|hygiene|ducha|lavander|淋浴|洗衣/.test(text)) detected.push('hygiene');
  return [...new Set(detected)];
}

function desiredCategories() {
  const structured = state.category && !['all', 'other'].includes(state.category)
    ? [state.category]
    : [];
  return [...new Set([
    ...structured,
    ...(Array.isArray(state.helperIntake.serviceCategories) ? state.helperIntake.serviceCategories : []),
    ...(state.situationConstraints.categories || []),
    ...detectCategories(`${state.otherNeed} ${state.situation} ${state.helperIntake.situation || ''}`)
  ])].sort();
}

function searchNeed() {
  const need = state.category === 'other' ? state.otherNeed.trim() : categoryLabel(state.category);
  return [need, state.situation.trim()].filter(Boolean).join(' · ');
}

function recordSearchDiagnostic(event, details = {}) {
  const entry = {
    at: new Date().toISOString(),
    event,
    key: state.activeSearchKey,
    location: state.location,
    category: state.category,
    resultCount: state.liveResults.length,
    ...details
  };
  state.searchDiagnostics = [...state.searchDiagnostics, entry].slice(-50);
  console.info('[BridgeAid search]', entry);
  return entry;
}

function mergeSearchResults(existing, incoming, desired = []) {
  return rankResources(mergeDuplicates([
    ...(existing || []),
    ...(incoming || [])
  ]), { categories: desired, constraints: state.situationConstraints });
}

function applySituationFilters(text) {
  const value = String(text || '').toLowerCase();
  state.situationConstraints = parseSituation(text, {
    location: state.location || state.helperIntake.location,
    coordinates: state.coordinates
  });
  if (/no (?:photo )?(?:id|identification)|without (?:an? )?(?:id|identification)|do(?:es)? not have (?:an? )?(?:id|identification)|sin identificaci[oó]n/.test(value)) {
    state.filters.noId = true;
  }
  if (/tonight|today|this evening|esta noche|hoy|今晚|今天/.test(value)) {
    if (!state.situationConstraints.requestedInstant) state.filters.availableToday = true;
  }
  if (/wheelchair|silla de ruedas|轮椅/.test(value)) {
    state.filters.accessible = true;
  }
  if (state.situationConstraints.walkInOnly) state.filters.walkIn = true;
  if (Number.isFinite(state.situationConstraints.maxDistance)) {
    state.radiusValue = Math.min(state.radiusValue, state.situationConstraints.maxDistance);
  }
}

function effectiveRadiusMiles() {
  return state.unit === 'km' ? state.radiusValue / 1.609344 : state.radiusValue;
}

function distanceDisplay(miles) {
  if (miles === null || miles === undefined) return '';
  const value = state.unit === 'km' ? miles * 1.609344 : miles;
  return `${value.toFixed(1)} ${state.unit === 'km' ? tr('kilometers').toLowerCase() : tr('miles').toLowerCase()}`;
}

function staticMatches() {
  if (!state.searched) return [];
  const wanted = desiredCategories();
  let rows = state.storedResults
    .filter(resource => String(resource.id) !== '211')
    .filter(resource => (resource.scope || 'location') === 'location')
    .filter(resource => resourceIsFresh(resource))
    .map(resource => normalizeResource(resource, state.lang));
  rows = rows.filter(resource => {
    const original = state.storedResults.find(item => String(item.id) === resource.id);
    const isLocationBound = Boolean(
      original?.serviceAreas?.length
      || original?.serviceAreaZipRanges?.length
      || original?.serviceAreaZipPrefixes?.length
    );
    return !isLocationBound || servesLocation(original, state.location);
  });
  if (wanted.length) {
    rows = rows.filter(resource => resource.category === 'all'
      || wanted.includes(resource.category)
      || resource.services.some(service => wanted.includes(service)));
  }
  return rankResources(rows, { categories: wanted, constraints: state.situationConstraints });
}

function allResults() {
  if (!state.searched) return [];
  const combined = mergeDuplicates([...state.liveResults, ...staticMatches()])
    .map(resource => {
      const normalized = normalizeResource(resource, state.lang);
      return {
        ...normalized,
        localEligibilityVerified: Boolean(localProgramForResource(normalized, state.location)?.localEligibilityVerified)
      };
    });
  const ranked = rankResources(combined, {
    categories: desiredCategories(),
    constraints: state.situationConstraints
  });
  const filtered = filterResources(ranked, {
    ...state.filters,
    radius: effectiveRadiusMiles()
  });
  return sortResources(filtered, state.sortBy);
}

function resourceById(id) {
  return mergeDuplicates([...state.liveResults, ...state.storedResults])
    .map(resource => normalizeResource(resource, state.lang))
    .find(resource => resource.id === id);
}

function currentResource() {
  return resourceById(state.selectedResourceId || state.eligibility.resourceId);
}

function modeSelector() {
  if (state.mode && !state.modePromptOpen) return '';
  return `<div class="mode-overlay" role="dialog" aria-modal="true" aria-labelledby="mode-title">
    <div class="mode-dialog">
      <span class="brand-mark" aria-hidden="true">B</span>
      <p class="eyebrow">BridgeAid</p>
      <h1 id="mode-title">${tr('modeQuestion')}</h1>
      <div class="mode-options">
        <button class="mode-option" data-mode="self">
          <span class="mode-icon" aria-hidden="true">●</span>
          <span><strong>${tr('modeSelf')}</strong><small>${tr('modeSelfDescription')}</small></span>
        </button>
        <button class="mode-option" data-mode="helper">
          <span class="mode-icon" aria-hidden="true">◎</span>
          <span><strong>${tr('modeHelper')}</strong><small>${tr('modeHelperDescription')}</small></span>
        </button>
      </div>
      ${state.mode ? `<button class="text-btn" data-close-mode>${tr('cancel')}</button>` : ''}
    </div>
  </div>`;
}

function header() {
  return `<header class="topbar">
    <nav class="wrap nav" aria-label="${attr(tr('mainNavigation'))}">
      <button class="brand" data-page="home" aria-label="${attr(tr('navHome'))}">
        <span class="logo" aria-hidden="true">B</span>
        <span>BridgeAid<small>${tr('brandTagline')}</small></span>
      </button>
      <button class="mobile-menu" data-menu aria-label="${attr(tr('openMenu'))}" aria-expanded="false">☰</button>
      <div class="nav-links" id="navLinks">
        <button data-page="home">${tr('navHome')}</button>
        <button data-page="find">${tr('navFind')}</button>
        <button data-page="nationwide">${tr('navNationwide')}</button>
        <button data-page="eligibility">${tr('navEligibility')}</button>
        <button data-page="saved">${tr('navSaved')} (${state.saved.size})</button>
        <button data-page="privacy">${tr('navPrivacy')}</button>
      </div>
      <div class="nav-actions">
        <button class="mode-chip" data-switch-mode aria-label="${attr(tr('switchMode'))}">
          <span aria-hidden="true">${state.mode === 'helper' ? '◎' : '●'}</span>
          ${state.mode === 'helper' ? tr('modeHelper') : tr('modeSelf')}
        </button>
        <label class="sr-only" for="language">${tr('language')}</label>
        <select id="language" aria-label="${attr(tr('language'))}">
          <option value="en" ${state.lang === 'en' ? 'selected' : ''}>English</option>
          <option value="zh" ${state.lang === 'zh' ? 'selected' : ''}>简体中文</option>
          <option value="es" ${state.lang === 'es' ? 'selected' : ''}>Español</option>
        </select>
      </div>
    </nav>
  </header>`;
}

function communityLink() {
  return `<div class="hero-211">
    <a class="call-211" href="tel:211" aria-describedby="call-211-description" title="${attr(tr('call211Tooltip'))}">
      <span aria-hidden="true">☎</span> ${tr('call211')}
    </a>
    <span class="sr-only" id="call-211-description">${tr('call211Tooltip')}</span>
  </div>`;
}

function statusMessages() {
  return `<div class="status-stack" aria-live="polite">
    ${state.offline ? `<div class="offline-state">◉ ${tr('offline')}</div>` : ''}
    ${state.noticeKey ? `<div class="cache-state">${tr(state.noticeKey)}</div>` : ''}
    ${state.storageWarning ? `<div class="error-state">${tr('storageBlocked')}</div>` : ''}
    ${state.errorKey ? `<div class="error-state">${tr(state.errorKey)}${state.errorKey === 'searchUnavailable' ? ` <button class="ghost retry-search" data-retry-search>${tr('retrySearch')}</button>` : ''}</div>` : ''}
    ${state.errorText ? `<div class="error-state">${esc(state.errorText)}</div>` : ''}
  </div>`;
}

function categoryOptions(selected = state.category) {
  return `<option value="" ${selected ? '' : 'selected'}>${tr('chooseNeed')}</option>
    ${CATEGORY_CONFIG.filter(item => item.id !== 'all').map(item => `<option value="${item.id}" ${selected === item.id ? 'selected' : ''}>${tr(item.key)}</option>`).join('')}
    <option value="other" ${selected === 'other' ? 'selected' : ''}>${tr('needOther')}</option>`;
}

function locationSuggestionMarkup(target = 'search') {
  if (state.locationSuggestionsLoading) {
    return `<div class="location-suggestions loading" role="status">${tr('locationSuggestionsLoading')}</div>`;
  }
  if (!state.locationSuggestions.length) return '';
  return `<div class="location-suggestions" role="listbox" aria-label="${attr(tr('locationSuggestions'))}">
    <strong>${tr('locationSuggestions')}</strong>
    <div>${state.locationSuggestions.slice(0, 5).map(choice =>
      `<button type="button" class="ghost" role="option" data-location-target="${attr(target)}" data-location-suggestion="${attr(choice.label)}" data-lat="${attr(choice.lat)}" data-lng="${attr(choice.lng)}">${esc(choice.label)}</button>`).join('')}</div>
  </div>`;
}

function updateLocationSuggestionDom() {
  document.querySelectorAll('[data-location-suggestions]').forEach(container => {
    container.innerHTML = locationSuggestionMarkup(container.dataset.locationTarget || 'search');
  });
}

function radiusOptions() {
  return [1, 5, 10, 25]
    .map(value => `<option value="${value}" ${state.radiusValue === value ? 'selected' : ''}>${state.unit === 'km'
      ? tr('radiusKilometers', { value })
      : tr('radiusMiles', { value })}</option>`)
    .join('');
}

function searchBox(compact = false) {
  return `<form id="searchForm" class="search-box search-box-v2 ${compact ? 'compact' : ''}" novalidate>
    <div class="search-primary-row">
      <label class="search-location">
        <span>${tr('locationLabel')}</span>
        <input id="locationInput" name="location" value="${attr(state.location)}" placeholder="${attr(tr('locationPlaceholder'))}" autocomplete="off" required aria-required="true" aria-describedby="location-privacy" aria-controls="location-suggestions">
        <div id="location-suggestions" data-location-suggestions data-location-target="search">${locationSuggestionMarkup('search')}</div>
      </label>
      <label class="search-service">
        <span>${tr('needLabel')}</span>
        <select id="needSelect" name="need" required aria-required="true">${categoryOptions()}</select>
      </label>
      <label class="search-distance">
        <span>${tr('radius')}</span>
        <select id="radius" name="radius">${radiusOptions()}</select>
      </label>
      <button class="primary search-submit" type="submit">⌕ ${tr('findResources')}</button>
    </div>
    ${state.category === 'other' ? `<label class="search-other">
      <span>${tr('needOtherLabel')}</span>
      <input id="otherNeedInput" name="otherNeed" value="${attr(state.otherNeed)}" placeholder="${attr(tr('needOtherPlaceholder'))}" required>
    </label>` : ''}
    <label class="search-situation">
      <span>${tr('situationLabel')} <small>${tr('optional')}</small></span>
      <textarea id="situationInput" name="situation" rows="2" placeholder="${attr(tr('situationPlaceholder'))}">${esc(state.situation)}</textarea>
    </label>
    <div class="search-options-row">
      <small id="location-privacy">${tr('locationPrivacy')}</small>
      <label><span>${tr('distanceUnit')}</span><select id="distanceUnit" name="unit">
        <option value="mi" ${state.unit === 'mi' ? 'selected' : ''}>${tr('miles')}</option>
        <option value="km" ${state.unit === 'km' ? 'selected' : ''}>${tr('kilometers')}</option>
      </select></label>
      <label><span>${tr('travelMode')}</span><select id="travelMode" name="travelMode">
        <option value="walking" ${state.travelMode === 'walking' ? 'selected' : ''}>${tr('walking')}</option>
        <option value="transit" ${state.travelMode === 'transit' ? 'selected' : ''}>${tr('transit')}</option>
        <option value="driving" ${state.travelMode === 'driving' ? 'selected' : ''}>${tr('driving')}</option>
      </select></label>
      <button type="button" class="secondary" data-gps>◎ ${tr('useLocation')}</button>
    </div>
  </form>`;
}

function helperField(name, labelKey, type = 'text', options = [], required = false) {
  const value = state.helperIntake[name] ?? '';
  const requirement = required ? `<strong class="required-label">${tr('required')}</strong>` : `<small>${tr('optional')}</small>`;
  if (type === 'select') {
    return `<label><span>${tr(labelKey)} ${requirement}</span>
      <select name="${name}" data-intake ${required ? 'required aria-required="true"' : ''}>
        <option value="">${tr('chooseAnswer')}</option>
        ${options.map(option => `<option value="${option.value}" ${value === option.value ? 'selected' : ''}>${tr(option.key)}</option>`).join('')}
      </select>
    </label>`;
  }
  return `<label><span>${tr(labelKey)} ${requirement}</span><input name="${name}" value="${attr(value)}" data-intake ${required ? 'required aria-required="true"' : ''}></label>`;
}

function helperIntake() {
  const yesNo = [{ value: 'yes', key: 'yes' }, { value: 'no', key: 'no' }, { value: 'unsure', key: 'unsure' }];
  const selectedCategories = Array.isArray(state.helperIntake.serviceCategories)
    ? state.helperIntake.serviceCategories
    : [state.helperIntake.serviceCategory].filter(Boolean);
  return `<section class="intake-card" aria-labelledby="intake-title">
    <div class="section-head">
      <div><span class="step-label">${tr('helperIntakeStep')}</span><h2 id="intake-title">${tr('helperIntakeTitle')}</h2></div>
      <button class="text-btn" data-clear-intake>${tr('clearIntake')}</button>
    </div>
    <p class="privacy-notice">${tr('privacyNotice')}</p>
    <p class="helper-explanation">${tr('sensitiveWarning')}</p>
    <div class="helper-intake-steps">
      <p><strong>1.</strong> ${tr('helperLocationQuestion')}</p>
      <p><strong>2.</strong> ${tr('helperSupportQuestion')}</p>
      <p><strong>3.</strong> ${tr('helperAuthorizedDescription')}</p>
    </div>
    <div class="intake-grid">
      <label><span>${tr('location')} <strong class="required-label">${tr('required')}</strong></span>
        <input id="helperLocationInput" name="location" value="${attr(state.helperIntake.location || '')}" data-intake required aria-required="true" autocomplete="off">
        <div data-location-suggestions data-location-target="helper">${locationSuggestionMarkup('helper')}</div>
      </label>
      <fieldset class="helper-category-picker">
        <legend>${tr('helperSupportTypes')} <strong class="required-label">${tr('required')}</strong></legend>
        ${CATEGORY_CONFIG.filter(item => item.id !== 'all').map(item => `<label class="filter-check">
          <input type="checkbox" data-intake-category value="${item.id}" ${selectedCategories.includes(item.id) ? 'checked' : ''}>
          <span>${categoryIcon(item.id)} ${tr(item.key)}</span>
        </label>`).join('')}
      </fieldset>
      ${helperField('safetyTonight', 'safetyTonight', 'select', [
        { value: 'safe', key: 'safe' },
        { value: 'notSafe', key: 'notSafe' },
        { value: 'unsure', key: 'unsure' }
      ])}
      ${helperField('ageGroup', 'ageGroup')}
      ${helperField('childrenInvolved', 'children', 'select', yesNo)}
      ${helperField('veteranStatus', 'veteranStatus', 'select', [
        { value: 'yes', key: 'yes' },
        { value: 'no', key: 'no' },
        { value: 'preferNot', key: 'preferNot' }
      ])}
      ${helperField('identification', 'identification', 'select', [
        { value: 'yes', key: 'yes' },
        { value: 'no', key: 'no' },
        { value: 'some', key: 'someDocuments' }
      ])}
      ${helperField('transportation', 'transportation', 'select', [
        { value: 'walking', key: 'walkingOnly' },
        { value: 'transit', key: 'transit' },
        { value: 'car', key: 'car' },
        { value: 'ride', key: 'needsRide' }
      ])}
      ${helperField('phoneAccess', 'phoneAccess', 'select', [
        { value: 'reliable', key: 'reliable' },
        { value: 'limited', key: 'limited' },
        { value: 'none', key: 'noPhone' }
      ])}
      ${helperField('accessibility', 'accessibilityNeeds')}
      ${helperField('preferredLanguage', 'preferredLanguage')}
      ${helperField('familyRestrictions', 'familyRestrictions')}
      ${helperField('petRestrictions', 'petRestrictions')}
      ${helperField('genderRestrictions', 'genderRestrictions')}
      ${helperField('ageRestrictions', 'ageRestrictions')}
      ${helperField('sobrietyRestrictions', 'sobrietyRestrictions')}
    </div>
    <label class="notes-field"><span>${tr('additionalNotes')} <small>${tr('localDeviceNote')}</small></span>
      <textarea name="notes" data-intake rows="3">${esc(state.helperIntake.notes || '')}</textarea>
    </label>
    <label class="notes-field"><span>${tr('helperSituationLabel')} <small>${tr('optional')}</small></span>
      <textarea name="situation" data-intake rows="3" placeholder="${attr(tr('helperSituationPlaceholder'))}">${esc(state.helperIntake.situation || '')}</textarea>
    </label>
    ${state.helperIntake.safetyTonight === 'notSafe' ? `<div class="danger-notice">${tr('safetySupportNote')}</div>` : ''}
    <button class="primary" data-helper-search>${tr('buildOptions')}</button>
  </section>`;
}

function homePage() {
  const helper = state.mode === 'helper';
  return `<main id="main">
    <section class="hero ${helper ? 'helper-hero' : ''}">
      <div class="wrap">
        ${communityLink()}
        <span class="eyebrow">${helper ? tr('helperEyebrow') : tr('selfEyebrow')}</span>
        <h1>${helper ? tr('helperHero') : tr('selfHero')}</h1>
        <p>${helper ? tr('helperSub') : tr('selfSub')}</p>
        ${helper ? '' : searchBox()}
      </div>
    </section>
    ${statusMessages()}
    ${helper
      ? `<div class="wrap section helper-layout"><div>${helperIntake()}</div>${planPanel()}</div>`
      : `<section class="wrap section home-empty"><p>${tr('noHomeResources')}</p></section>`}
  </main>`;
}

function filtersPanel() {
  const checkbox = (name, key) => `<label class="filter-check"><input type="checkbox" data-filter="${name}" ${state.filters[name] ? 'checked' : ''}><span>${tr(key)}</span></label>`;
  return `<details class="filters-panel">
    <summary>${tr('filters')}</summary>
    <div class="filter-grid">
      ${checkbox('openNow', 'filterOpenNow')}
      ${checkbox('availableToday', 'filterAvailableToday')}
      ${checkbox('walkIn', 'filterWalkIn')}
      ${checkbox('noId', 'filterNoId')}
      ${checkbox('noRegistration', 'filterNoRegistration')}
      ${checkbox('accessible', 'filterAccessible')}
      ${checkbox('verifiedEligibility', 'filterVerifiedEligibility')}
      <label><span>${tr('filterLanguage')}</span><input data-filter-text="language" value="${attr(state.filters.language)}" placeholder="${attr(tr('filterLanguagePlaceholder'))}"></label>
      <button class="ghost" data-clear-filters>${tr('clearFilters')}</button>
    </div>
  </details>`;
}

function scheduleDisplay(resource) {
  const status = resourceScheduleState(resource);
  if (resource.scheduleVerificationStatus === 'researching') return { label: tr('scheduleResearching'), status };
  if (status.code === 'hours_not_listed') return { label: tr('hoursNotPubliclyListed'), status };
  if (status.code === 'appointment_only') return { label: tr('appointmentOnly'), status };
  if (status.code === 'online_available') return { label: tr('onlineAvailable'), status };
  return { label: tr('schedulePublished'), status };
}

function availabilityText(resource) {
  const status = resourceScheduleState(resource);
  if (resource.temporaryClosure) return tr('temporaryClosure');
  if (status.code === 'open_now') return tr('openNow');
  if (status.code === 'opens_at') return tr('opensAt', { time: formatScheduleTime(status.nextOpenTime, state.lang) });
  if (status.code === 'appointment_only') return tr('appointmentOnly');
  if (status.code === 'online_available') return tr('onlineAvailable');
  if (status.code === 'event_today') return tr('upcomingEvent');
  if (status.code === 'hours_not_listed') return tr('hoursNotPubliclyListed');
  return tr('closed');
}

function weeklyHoursBlock(resource) {
  const rows = weeklyScheduleRows(resource, state.lang);
  const hasKnownRows = rows.some(row => row.known);
  const exceptions = (resource.holidayHours || []).filter(exception => exception.date);
  const unknownScheduleLabel = resource.appointmentOnly
    ? tr('appointmentOnly')
    : resource.onlineAlwaysAvailable
      ? tr('onlineAvailable')
      : tr('hoursNotPubliclyListed');
  return `<div class="weekly-hours">
    ${hasKnownRows ? rows.map(row => `<div class="hours-row ${row.current ? 'current-day' : ''}">
      <strong>${tr(`day${row.day[0].toUpperCase()}${row.day.slice(1)}`)}</strong>
      <span>${!row.known
        ? tr('hoursNotPubliclyListed')
        : row.closed
          ? tr('closed')
          : row.periods.map(period => (
            period.open === '00:00' && period.close === '24:00'
              ? tr('open24Hours')
              : esc(period.label)
          )).join(', ')}</span>
    </div>`).join('') : `<p class="hours-unlisted">${unknownScheduleLabel}</p>`}
    ${resource.hoursNote ? `<p class="hours-note">${esc(resource.hoursNote)}</p>` : ''}
    ${resource.specialHours.length ? `<div class="special-hours"><strong>${tr('specialHours')}</strong><ul>${resource.specialHours.map(item => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}
    ${exceptions.length ? `<details class="holiday-hours"><summary>${tr('holidayHours')}</summary><ul>${exceptions.map(item => `<li>${esc(item.date)} — ${esc(item.label || (item.closed ? tr('closed') : tr('specialHours')))}</li>`).join('')}</ul></details>` : ''}
    <div class="hours-evidence">
      ${resource.hoursLastVerified ? `<span>${tr('lastVerified')}: ${esc(resource.hoursLastVerified)}</span>` : ''}
    </div>
  </div>`;
}

function verificationText(resource) {
  if (/openstreetmap|community-sourced/i.test(`${resource.source} ${resource.verificationStatus}`)) return tr('communitySourced');
  if (resource.lastVerified) return tr('verifiedPreviously');
  return tr('needsVerification');
}

function directionsUrl(resource, mode = state.travelMode) {
  const destination = resource.latitude !== null
    ? `${resource.latitude},${resource.longitude}`
    : resource.address || `${resource.name} ${state.location}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=${encodeURIComponent(mode)}`;
}

function walkingDetails(resource) {
  if (resource.distance === null) return '';
  const minutes = Math.max(1, Math.round(resource.distance / 3 * 60));
  return tr('walkingEstimate', {
    distance: distanceDisplay(resource.distance),
    minutes
  });
}

function requestedAvailabilityMarkup(resource) {
  const availability = resource._availabilityAtRequest;
  if (!availability || !state.situationConstraints.requestedInstant) return '';
  const requested = new Intl.DateTimeFormat(state.lang, {
    timeZone: state.situationConstraints.timeZone,
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(state.situationConstraints.requestedInstant);
  const key = availability.available && availability.confirmed
    ? 'confirmedAtRequestedTime'
    : availability.confirmed
      ? 'unavailableAtRequestedTime'
      : 'uncertainAtRequestedTime';
  return `<div class="requested-availability ${availability.available ? 'available' : availability.confirmed ? 'unavailable' : 'uncertain'}">
    <strong>${tr(key, { time: requested })}</strong>
    <span>${esc(availability.reason)}</span>
  </div>`;
}

function eligibilityDisplay(program) {
  if (!program) return tr('eligibilityResearchPending');
  if (program.localEligibilityVerified) return program.eligibilitySummary;
  if (['no_restrictions_listed', 'open'].includes(program.eligibilityStatus)) {
    return program.eligibilitySummary || tr('noEligibilityRequirementsExplanation');
  }
  if (!program.inServiceArea) return tr('eligibilityOutOfArea');
  if (program.eligibilityResearchStatus === 'technical_failure') {
    return tr('eligibilityTemporarilyUnavailable');
  }
  if (program.eligibilityResearchStatus === 'ambiguous_review') {
    return tr('eligibilityNeedsReview');
  }
  return tr('eligibilityResearchPending');
}

function resourceCard(raw, options = {}) {
  const resource = normalizeResource(raw, state.lang);
  const schedule = scheduleDisplay(resource);
  const localProgram = localProgramForResource(resource, state.location);
  const inPlan = state.helperPlan.some(item => item.id === resource.id);
  const compared = state.compareIds.has(resource.id);
  const site = safeUrl(resource.officialWebsite || resource.website);
  const applicationLink = resource.applicationLinks.find(link => link.type === 'application') || resource.applicationLinks[0];
  const application = safeUrl(applicationLink?.url || resource.registrationUrl);
  const applicationLabel = applicationLink
    ? applicationLink.label || tr({
      application: 'startApplication',
      eligibility: 'checkEligibility',
      questionnaire: 'completeQuestionnaire',
      appointment: 'scheduleAppointment',
      download: 'downloadApplication',
      documents: 'viewRequiredDocuments',
      contact: 'contactIntake'
    }[applicationLink.type] || 'openApplication')
    : tr('officialApplication');
  const address = resource.address || tr('addressUnavailable');
  const verificationDate = resource.lastVerified
    || resource.hoursLastVerified
    || (resource.dateDiscovered
      ? tr('notYetVerified', { date: new Date(resource.dateDiscovered).toLocaleDateString(state.lang) })
      : tr('nonePublished'));
  return `<article class="resource-card category-${attr(resource.category)}" data-resource-card="${attr(resource.id)}">
    <div class="card-top">
      <span class="tag">${categoryIcon(resource.category)} ${categoryLabel(resource.category)}</span>
      <span class="verification-badge ${schedule.status.code === 'hours_not_listed' ? 'uncertain' : 'confirmed'}"><span aria-hidden="true">${schedule.status.code === 'hours_not_listed' ? '!' : '✓'}</span>${schedule.label}</span>
    </div>
    <div><h3>${esc(resource.name)}</h3>${resource.programName ? `<p class="program-name">${esc(resource.programName)}</p>` : ''}</div>
    ${resource.description ? `<p class="description">${esc(resource.description)}</p>` : ''}
    ${resource._rankExplanation ? `<p class="rank-explanation"><strong>${tr('whyPrioritized')}:</strong> ${esc(resource._rankExplanation)}</p>` : ''}
    ${requestedAvailabilityMarkup(resource)}
    <dl class="resource-meta">
      <dt>${tr('address')}</dt><dd>${esc(address)}</dd>
      ${walkingDetails(resource) ? `<dt>${tr('distance')}</dt><dd>${esc(walkingDetails(resource))}</dd>` : ''}
      <dt>${tr('hours')}</dt><dd>${weeklyHoursBlock(resource)}</dd>
      <dt>${tr('availability')}</dt><dd>${availabilityText(resource)}</dd>
      <dt>${tr('eligibilitySummary')}</dt><dd>${esc(eligibilityDisplay(localProgram))}</dd>
      <dt>${tr('registrationRequirement')}</dt><dd>${esc(resource.registrationRequirement || tr('registrationUseContact'))}</dd>
    </dl>
    <p class="verification-line"><strong>${tr('lastVerified')}:</strong> ${esc(verificationDate)} · ${esc(verificationText(resource))}</p>
    <div class="card-actions action-priority">
      ${resource.phone ? `<a class="primary" href="tel:${attr(phoneHref(resource.phone))}">☎ ${tr('call')}</a>` : ''}
      <a class="secondary" href="${attr(directionsUrl(resource, 'walking'))}" target="_blank" rel="noopener noreferrer">⌖ ${tr('walkingDirections')}</a>
      ${state.travelMode !== 'walking' ? `<a class="ghost" href="${attr(directionsUrl(resource))}" target="_blank" rel="noopener noreferrer">${state.travelMode === 'transit' ? tr('transitDirections') : tr('drivingDirections')}</a>` : ''}
      ${application ? `<a class="ghost" href="${attr(application)}" target="_blank" rel="noopener noreferrer">${esc(applicationLabel)} ↗</a>` : site ? `<a class="ghost" href="${attr(site)}" target="_blank" rel="noopener noreferrer">${tr('officialWebsite')} ↗</a>` : ''}
    </div>
    <div class="card-actions card-tools">
      <button class="text-action" data-requirements="${attr(resource.id)}">${tr('viewRequirements')}</button>
      <button class="text-action" data-eligibility="${attr(resource.id)}">${tr('checkEligibility')}</button>
      <button class="text-action" data-registration="${attr(resource.id)}">${tr('registrationHelp')}</button>
      <button class="text-action" data-report="${attr(resource.id)}">${tr('reportIncorrect')}</button>
      <button class="text-action" data-save="${attr(resource.id)}" aria-pressed="${state.saved.has(resource.id)}">${state.saved.has(resource.id) ? `★ ${tr('savedAction')}` : `☆ ${tr('save')}`}</button>
      ${state.mode === 'helper' && !options.compact ? `
        <button class="text-action" data-add-plan="${attr(resource.id)}" aria-pressed="${inPlan}">${inPlan ? `✓ ${tr('inPlan')}` : `+ ${tr('selectPlan')}`}</button>
        <button class="text-action" data-compare="${attr(resource.id)}" aria-pressed="${compared}">${compared ? '✓ ' : ''}${tr('compare')}</button>` : ''}
    </div>
  </article>`;
}

function comparisonPanel(resources) {
  const selected = resources.filter(resource => state.compareIds.has(resource.id)).slice(0, 3);
  if (state.mode !== 'helper' || !selected.length) return '';
  return `<section class="comparison-panel" aria-labelledby="comparison-title">
    <div class="section-head"><h2 id="comparison-title">${tr('comparison')}</h2><button class="text-btn" data-clear-compare>${tr('clearComparison')}</button></div>
    <div class="comparison-scroll"><table>
      <thead><tr><th>${tr('compareResource')}</th><th>${tr('hours')}</th><th>${tr('compareEligibility')}</th><th>${tr('distance')}</th><th>${tr('lastVerified')}</th></tr></thead>
      <tbody>${selected.map(resource => `<tr>
        <th>${esc(resource.name)}</th>
        <td>${esc(resource.hours || tr('scheduleUncertain'))}</td>
        <td>${esc(eligibilityDisplay(localProgramForResource(resource, state.location)))}</td>
        <td>${esc(walkingDetails(resource) || tr('unknown'))}</td>
        <td>${esc(resource.lastVerified || resource.hoursLastVerified || tr('nonePublished'))}</td>
      </tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function planConstraintValue(name) {
  return state.planConstraints?.[name] ?? '';
}

function decisionPlanPanel(resources) {
  const plan = state.decisionPlan;
  const title = state.mode === 'helper' ? tr('resourcePlan') : tr('buildActionPlan');
  return `<section class="decision-planner" aria-labelledby="decision-plan-title">
    <div class="section-head">
      <div><span class="step-label">${tr('optional')}</span><h2 id="decision-plan-title">${title}</h2></div>
    </div>
    <p>${tr('actionPlanIntro')}</p>
    <form id="actionPlanForm" class="constraint-grid">
      <label><span>${tr('urgency')}</span><select name="urgency">
        <option value="immediate" ${planConstraintValue('urgency') === 'immediate' ? 'selected' : ''}>${tr('urgencyImmediate')}</option>
        <option value="today" ${planConstraintValue('urgency') === 'today' ? 'selected' : ''}>${tr('urgencyToday')}</option>
        <option value="longTerm" ${planConstraintValue('urgency') === 'longTerm' ? 'selected' : ''}>${tr('urgencyLongTerm')}</option>
      </select></label>
      <label><span>${tr('availableDays')}</span><input name="availableDays" value="${attr(planConstraintValue('availableDays'))}" placeholder="${attr(tr('availableDaysPlaceholder'))}"></label>
      <label><span>${tr('availableTimes')}</span><input name="availableTimes" value="${attr(planConstraintValue('availableTimes'))}" placeholder="${attr(tr('availableTimesPlaceholder'))}"></label>
      <label><span>${tr('transportation')}</span><select name="transportation">
        <option value="walking" ${planConstraintValue('transportation') === 'walking' ? 'selected' : ''}>${tr('walking')}</option>
        <option value="transit" ${planConstraintValue('transportation') === 'transit' ? 'selected' : ''}>${tr('transit')}</option>
        <option value="driving" ${planConstraintValue('transportation') === 'driving' ? 'selected' : ''}>${tr('driving')}</option>
      </select></label>
      <label><span>${tr('maximumDistance')}</span><input type="number" min="1" max="25" step="1" name="maxDistance" value="${attr(planConstraintValue('maxDistance'))}"></label>
      <label><span>${tr('transportBudget')}</span><input type="number" min="0" step="0.01" name="transportationBudget" value="${attr(planConstraintValue('transportationBudget'))}"></label>
      <label><span>${tr('walkingLimit')}</span><input type="number" min="0" step="0.1" name="walkingLimit" value="${attr(planConstraintValue('walkingLimit'))}"></label>
      <label><span>${tr('applicationDeadline')}</span><input type="date" name="deadline" value="${attr(planConstraintValue('deadline'))}"></label>
      <label class="wide"><span>${tr('physicalLimitations')}</span><input name="physicalLimitations" value="${attr(planConstraintValue('physicalLimitations'))}"></label>
      <label class="filter-check"><input type="checkbox" name="wheelchairAccessible" ${planConstraintValue('wheelchairAccessible') ? 'checked' : ''}><span>${tr('wheelchairAccessible')}</span></label>
      <label class="filter-check"><input type="checkbox" name="childcareNeeded" ${planConstraintValue('childcareNeeded') ? 'checked' : ''}><span>${tr('childcareNeeded')}</span></label>
      <button class="primary wide" type="submit" ${resources.length ? '' : 'disabled'}>${tr('generatePlan')}</button>
    </form>
    ${plan ? `<div class="generated-plan" aria-live="polite">
      <h3>${tr('yourActionPlan')}</h3>
      <p>${esc(plan.explanation)}</p>
      ${plan.steps.length ? `<ol>${plan.steps.map(step => `<li>
        <strong>${esc(step.title)}</strong>
        <p>${esc(step.action)}</p>
        ${step.timing ? `<p><strong>${tr('timing')}:</strong> ${esc(step.timing)}</p>` : ''}
        ${step.travel ? `<p><strong>${tr('travelEstimate')}:</strong> ${esc(step.travel)}</p>` : ''}
        <p><strong>${tr('whyThisOrder')}:</strong> ${esc(step.reason)}</p>
        <p><strong>${tr('completionEstimate')}:</strong> ${esc(step.completionConfidence.label)} — ${esc(step.completionConfidence.reason)}</p>
      </li>`).join('')}</ol>` : `<div class="empty-state">${tr('noFeasiblePlan')}</div>`}
      ${plan.tradeoffs.length ? `<h3>${tr('tradeoffs')}</h3><ul>${plan.tradeoffs.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
      ${plan.excluded.length ? `<details><summary>${tr('excludedResults', { count: plan.excluded.length })}</summary><ul>${plan.excluded.map(item => `<li><strong>${esc(item.name)}</strong>: ${esc(item.reasons.join('; '))}</li>`).join('')}</ul></details>` : ''}
      <p class="privacy-notice">${tr('planNoGuarantee')}</p>
    </div>` : ''}
  </section>`;
}

function findPage() {
  const resources = allResults();
  const visibleResources = resources.slice(0, state.visibleResults);
  return `<main id="main" class="wrap section page">
    <div class="page-head">
      <div><span class="eyebrow">${state.mode === 'helper' ? tr('helperEyebrow') : tr('selfEyebrow')}</span><h1>${tr('searchResults')}</h1>
        ${state.searched ? `<p>${tr('resultsFor', { need: searchNeed(), location: state.location })}</p>` : `<p>${tr('noHomeResources')}</p>`}
      </div>
    </div>
    ${statusMessages()}
    ${searchBox(true)}
    ${state.searched ? filtersPanel() : ''}
    ${state.loading ? `<div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span><strong>${tr('loading')}</strong></div>` : ''}
    ${state.discoveryStatus === 'discovering' ? `<div class="cache-state">${tr('discoveryRunning')}</div>` : ''}
    ${comparisonPanel(resources)}
    <div class="${state.mode === 'helper' && state.searched ? 'results-layout' : ''}">
      <section aria-labelledby="resource-list-title">
        ${state.searched ? `<div class="section-head results-heading"><div><h2 id="resource-list-title">${tr('resultsCount', { count: resources.length })}</h2><small>${tr('everyResultSourced')}</small></div>
          <label class="sort-control"><span>${tr('sortBy')}</span><select id="sortBy">
            <option value="nearest" ${state.sortBy === 'nearest' ? 'selected' : ''}>${tr('sortNearest')}</option>
            <option value="farthest" ${state.sortBy === 'farthest' ? 'selected' : ''}>${tr('sortFarthest')}</option>
            <option value="relevance" ${state.sortBy === 'relevance' ? 'selected' : ''}>${tr('sortRelevant')}</option>
            <option value="openSoonest" ${state.sortBy === 'openSoonest' ? 'selected' : ''}>${tr('sortOpenSoonest')}</option>
          </select></label></div>
          <div class="resource-list">${resources.length ? visibleResources.map(resource => resourceCard(resource)).join('') : `<div class="empty-state">${tr('noResults')}</div>`}</div>
          ${visibleResources.length < resources.length ? `<button class="secondary load-more" data-load-more>${tr('loadMore', { remaining: resources.length - visibleResources.length })}</button>` : ''}`
          : `<div class="empty-state">${tr('noHomeResources')}</div>`}
      </section>
      ${state.mode === 'helper' && state.searched ? planPanel() : ''}
    </div>
    ${state.searched ? decisionPlanPanel(resources) : ''}
  </main>`;
}

function planText() {
  const created = state.helperPlan[0]?.planCreated || new Date().toISOString();
  const helperNeeds = (state.helperIntake.serviceCategories || [])
    .map(categoryLabel)
    .join(', ') || searchNeed() || tr('notEntered');
  return [
    `BridgeAid — ${tr('resourcePlan')}`,
    `${tr('created')}: ${new Date(created).toLocaleString(state.lang)}`,
    `${tr('updated')}: ${new Date().toLocaleString(state.lang)}`,
    `${tr('need')}: ${helperNeeds}`,
    `${tr('location')}: ${state.helperIntake.location || state.location || tr('notEntered')}`,
    '',
    ...state.helperPlan.flatMap((item, index) => [
      `${index + 1}. ${item.name}`,
      item.phone ? `${tr('call')}: ${item.phone}` : '',
      item.website ? `${tr('officialWebsite')}: ${item.website}` : '',
      item.directions ? `${tr('walkingDirections')}: ${item.directions}` : '',
      `${tr('status')}: ${tr(STATUS_KEYS[statusCode(item.status)] || 'statusNotContacted')}`,
      item.note ? `${tr('localNote')}: ${item.note}` : '',
      item.questions ? `${tr('questionsToAsk')}: ${item.questions}` : '',
      tr('confirmOrganization'),
      ''
    ].filter(Boolean))
  ].join('\n');
}

function statusCode(value) {
  return Object.entries(STATUS_STORAGE).find(([, stored]) => stored === value)?.[0] || 'notContacted';
}

function planPanel() {
  const created = state.helperPlan[0]?.planCreated;
  const helperNeeds = (state.helperIntake.serviceCategories || [])
    .map(categoryLabel)
    .join(', ') || searchNeed() || tr('notEntered');
  return `<aside class="plan-panel" aria-labelledby="plan-title">
    <div class="section-head"><div><span class="step-label">${tr('planLocal', { count: state.helperPlan.length })}</span><h2 id="plan-title">${tr('resourcePlan')}</h2></div></div>
    <p><strong>${tr('need')}:</strong> ${esc(helperNeeds)}</p>
    <p><strong>${tr('location')}:</strong> ${esc(state.helperIntake.location || state.location || tr('notEntered'))}</p>
    ${created ? `<p class="plan-time">${tr('created')} ${esc(new Date(created).toLocaleString(state.lang))}<br>${tr('updated')} ${esc(new Date().toLocaleString(state.lang))}</p>` : ''}
    <div class="plan-items">${state.helperPlan.length ? state.helperPlan.map(planItem).join('') : `<p class="empty-plan">${tr('planEmpty')}</p>`}</div>
    <div class="plan-actions">
      <button class="secondary" data-copy-plan ${state.helperPlan.length ? '' : 'disabled'}>${tr('copyPlan')}</button>
      <button class="secondary" data-share-plan ${state.helperPlan.length ? '' : 'disabled'}>${tr('sharePlan')}</button>
      <button class="ghost" data-print-plan ${state.helperPlan.length ? '' : 'disabled'}>${tr('print')}</button>
      <button class="danger-button" data-clear-plan ${state.helperPlan.length || Object.keys(state.helperIntake).length ? '' : 'disabled'}>${tr('clearPlan')}</button>
    </div>
    <p class="storage-note">${tr('planStorageWarning')}</p>
  </aside>`;
}

function planItem(item) {
  const code = statusCode(item.status);
  return `<article class="plan-item">
    <div><h3>${esc(item.name)}</h3>${item.phone ? `<a href="tel:${attr(phoneHref(item.phone))}">${esc(item.phone)}</a>` : ''}</div>
    <label>${tr('status')}<select data-plan-status="${attr(item.id)}">
      ${STATUS_CODES.map(option => `<option value="${option}" ${code === option ? 'selected' : ''}>${tr(STATUS_KEYS[option])}</option>`).join('')}
    </select></label>
    <label>${tr('localNote')}<textarea rows="2" data-plan-note="${attr(item.id)}" placeholder="${attr(tr('localNotePlaceholder'))}">${esc(item.note || '')}</textarea></label>
    <label>${tr('questionsToAsk')}<textarea rows="2" data-plan-questions="${attr(item.id)}" placeholder="${attr(tr('questionsToAskPlaceholder'))}">${esc(item.questions || '')}</textarea></label>
    <details><summary>${tr('callingScript')}</summary><p>${tr('callingScriptText', { program: item.name })}</p></details>
    <button class="text-action" data-remove-plan="${attr(item.id)}">${tr('remove')}</button>
  </article>`;
}

function nationwideCard(raw) {
  const resource = normalizeResource(raw, state.lang);
  const primaryLink = resource.applicationLinks[0];
  const website = safeUrl(primaryLink?.url || resource.officialWebsite || resource.website);
  const eligibilityLabel = resource.eligibilityStatus === 'structured'
    ? resource.eligibilitySummary
    : resource.requiresLocalProvider
    ? tr('onlineEligibilityLocalProvider')
    : resource.eligibilityStatus === 'open'
      ? tr('onlineEligibilityOpen')
      : tr('onlineEligibilityVaries');
  return `<article class="resource-card nationwide-card category-${attr(resource.category)}" data-resource-card="${attr(resource.id)}">
    <div class="card-top">
      <span class="tag">${categoryIcon(resource.category)} ${categoryLabel(resource.category)}</span>
      <span class="verification-badge confirmed"><span aria-hidden="true">✓</span>${tr('nationwideAccess')}</span>
    </div>
    <div><h2>${esc(resource.name)}</h2></div>
    <p class="description">${esc(resource.serviceOffered || resource.description)}</p>
    <dl class="resource-meta">
      <dt>${tr('whoItHelps')}</dt><dd>${esc(resource.whoItHelps || resource.eligibilitySummary)}</dd>
      <dt>${tr('eligibilitySummary')}</dt><dd>${esc(eligibilityLabel)}</dd>
      <dt>${tr('waysToApply')}</dt><dd>${esc(applicationMethods(resource.applicationMethods) || tr('confirmOrganization'))}</dd>
      <dt>${tr('cost')}</dt><dd>${esc(resource.freeStatus || tr('confirmOrganization'))}</dd>
      ${resource.applicationDeadline ? `<dt>${tr('applicationDeadline')}</dt><dd>${esc(resource.applicationDeadline)}</dd>` : ''}
      <dt>${tr('documents')}</dt><dd>${resource.requiredDocuments.length
        ? `<ul>${resource.requiredDocuments.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`
        : esc(tr('nonePublished'))}</dd>
    </dl>
    ${resource.requiresLocalProvider ? `<p class="local-provider-note">${tr('localProviderExplanation')}</p>` : ''}
    ${resource.applicationSteps.length ? `<details class="online-steps"><summary>${tr('applicationProcess')}</summary><ol>${resource.applicationSteps.map(step => `<li>${esc(step)}</li>`).join('')}</ol></details>` : ''}
    <p class="verification-line"><strong>${tr('lastVerified')}:</strong> ${esc(resource.lastVerified || resource.applicationLastVerified)}</p>
    <div class="card-actions action-priority">
      ${resource.phone ? `<a class="primary" href="tel:${attr(phoneHref(resource.phone))}">☎ ${tr('call')}</a>` : ''}
      ${website ? `<a class="${resource.phone ? 'secondary' : 'primary'}" href="${attr(website)}" target="_blank" rel="noopener noreferrer">${esc(primaryLink?.label || tr('openOfficialResource'))} ↗</a>` : ''}
      <button class="ghost" data-save="${attr(resource.id)}" aria-pressed="${state.saved.has(resource.id)}">${state.saved.has(resource.id) ? `★ ${tr('savedAction')}` : `☆ ${tr('save')}`}</button>
    </div>
  </article>`;
}

function nationwidePage() {
  const normalized = freshResources(nationwideResources)
    .filter(resource => !resource.requiresLocalProvider)
    .map(resource => normalizeResource(resource, state.lang));
  const categoriesAvailable = [...new Set(normalized
    .map(resource => resource.category)
    .filter(category => category !== 'all'))].sort();
  const filtered = normalized
    .filter(resource => state.onlineFilters.category === 'all'
      || resource.category === state.onlineFilters.category
      || resource.services.includes(state.onlineFilters.category))
    .filter(resource => {
      if (state.onlineFilters.eligibility === 'all') return true;
      if (state.onlineFilters.eligibility === 'localProvider') return resource.requiresLocalProvider;
      return resource.eligibilityStatus === state.onlineFilters.eligibility;
    })
    .filter(resource => state.onlineFilters.applicationMethod === 'all'
      || (state.onlineFilters.applicationMethod === 'multiple'
        ? resource.applicationMethods.length > 1
        : resource.applicationMethods.includes(state.onlineFilters.applicationMethod)))
    .sort((a, b) => a.name.localeCompare(b.name, state.lang, { sensitivity: 'base' }));
  return `<main id="main" class="wrap section page nationwide-page">
    <span class="eyebrow">${tr('nationwideEyebrow')}</span>
    <h1>${tr('nationwideTitle')}</h1>
    <p class="lead">${tr('nationwideIntro')}</p>
    <section class="online-filters" aria-label="${attr(tr('nationwideFilters'))}">
      <label><span>${tr('category')}</span><select data-online-filter="category">
        <option value="all">${tr('categoryAll')}</option>
        ${categoriesAvailable.map(category => `<option value="${attr(category)}" ${state.onlineFilters.category === category ? 'selected' : ''}>${categoryLabel(category)}</option>`).join('')}
      </select></label>
      <label><span>${tr('onlineEligibilityFilter')}</span><select data-online-filter="eligibility">
        <option value="all">${tr('filterAll')}</option>
        <option value="open" ${state.onlineFilters.eligibility === 'open' ? 'selected' : ''}>${tr('onlineEligibilityOpen')}</option>
        <option value="structured" ${state.onlineFilters.eligibility === 'structured' ? 'selected' : ''}>${tr('onlineEligibilityStructured')}</option>
        <option value="varies" ${state.onlineFilters.eligibility === 'varies' ? 'selected' : ''}>${tr('onlineEligibilityVaries')}</option>
        <option value="localProvider" ${state.onlineFilters.eligibility === 'localProvider' ? 'selected' : ''}>${tr('onlineEligibilityLocalProvider')}</option>
      </select></label>
      <label><span>${tr('applicationMethodFilter')}</span><select data-online-filter="applicationMethod">
        <option value="all">${tr('filterAll')}</option>
        <option value="online" ${state.onlineFilters.applicationMethod === 'online' ? 'selected' : ''}>${tr('applyOnline')}</option>
        <option value="phone" ${state.onlineFilters.applicationMethod === 'phone' ? 'selected' : ''}>${tr('applyByPhone')}</option>
        <option value="mail" ${state.onlineFilters.applicationMethod === 'mail' ? 'selected' : ''}>${tr('applyByMail')}</option>
        <option value="inPerson" ${state.onlineFilters.applicationMethod === 'inPerson' ? 'selected' : ''}>${tr('applyInPerson')}</option>
        <option value="multiple" ${state.onlineFilters.applicationMethod === 'multiple' ? 'selected' : ''}>${tr('multipleMethods')}</option>
      </select></label>
    </section>
    <p class="results-summary">${tr('resultsCount', { count: filtered.length })}</p>
    <div class="resource-list nationwide-list">${filtered.length
      ? filtered.map(nationwideCard).join('')
      : `<div class="empty-state">${tr('noOnlineResults')}</div>`}</div>
  </main>`;
}

function savedPage() {
  const available = mergeDuplicates([...state.liveResults, ...sourceResources])
    .filter(resource => String(resource.id) !== '211')
    .filter(resource => resourceIsFresh(resource))
    .map(resource => normalizeResource(resource, state.lang));
  const saved = available.filter(resource => state.saved.has(resource.id));
  const unavailableCount = [...state.saved].filter(id => !available.some(resource => resource.id === id)).length;
  return `<main id="main" class="wrap section page">
    <div class="page-head"><h1>${tr('savedTitle')}</h1></div>
    ${unavailableCount ? `<div class="error-state">${tr('savedNeedsVerification', { count: unavailableCount })} <button class="ghost" data-retry-saved>${tr('retryVerification')}</button></div>` : ''}
    <div class="resource-list">${saved.length ? saved.map(resource =>
      resource.scope === 'nationwide-online' ? nationwideCard(resource) : resourceCard(resource)).join('') : `<div class="empty-state">${tr('savedEmpty')}</div>`}</div>
  </main>`;
}

function privacyPage() {
  return `<main id="main" class="wrap section page about">
    <span class="eyebrow">${tr('privacyEyebrow')}</span>
    <h1>${tr('privacyTitle')}</h1>
    <p class="lead">${tr('privacyIntro')}</p>
    <div class="privacy-grid">
      <article><h2>${tr('privacyLocationTitle')}</h2><p>${tr('privacyLocationText')}</p><button class="ghost" data-clear-location>${tr('clearLocation')}</button></article>
      <article><h2>${tr('privacyQuizTitle')}</h2><p>${tr('privacyQuizText')}</p><button class="ghost" data-clear-eligibility>${tr('clearEligibility')}</button></article>
      <article><h2>${tr('privacySavedTitle')}</h2><p>${tr('privacySavedText')}</p><button class="danger-button" data-clear-private>${tr('clearLocalData')}</button></article>
      <article><h2>${tr('privacyReportsTitle')}</h2><p>${tr('privacyReportsText')}</p><p><strong>${state.corrections.length}</strong> ${tr('reportQueued')}</p></article>
    </div>
    <div class="notice"><strong>${tr('availabilityConfirm')}.</strong> ${tr('privacyConfirm')}</div>
  </main>`;
}

function eligibilityFieldKey(field) {
  return {
    age: 'ageRange',
    ageRange: 'ageRange',
    householdSize: 'householdSize',
    income: 'incomeRange',
    housingStatus: 'housingStatus',
    employmentStatus: 'employmentStatus',
    studentStatus: 'studentStatus',
    insuranceStatus: 'insuranceStatus',
    disabilityStatus: 'disabilityStatus',
    veteranStatus: 'veteranStatus',
    dependents: 'dependents',
    identification: 'identification',
    programConsiderations: 'programConsiderations'
  }[field] || 'programConsiderations';
}

function eligibilityMissingLabel(value) {
  if (value === 'program') return tr('missingProgram');
  if (value === 'location') return tr('missingLocation');
  if (String(value).includes('eligibility rules') || String(value).includes('service area')) return tr('missingLocalRules');
  return tr(eligibilityFieldKey(value));
}

function eligibilityField(question, answer) {
  const field = question.field;
  const labelKey = eligibilityFieldKey(field);
  const label = question.question || tr(labelKey);
  const options = {
    age: [['17', 'under18'], ['21', 'age18to24'], ['40', 'age25to59'], ['65', 'age60plus']],
    ageRange: [['17', 'under18'], ['21', 'age18to24'], ['40', 'age25to59'], ['65', 'age60plus']],
    income: [['10000', 'incomeUnder20'], ['30000', 'income20to40'], ['60000', 'income40to75'], ['75000', 'income75plus'], ['', 'incomeUnknown']],
    housingStatus: [['housed', 'housed'], ['temporary', 'temporaryHousing'], ['unhoused', 'unhoused']],
    employmentStatus: [['employed', 'employed'], ['unemployed', 'unemployed'], ['notWorking', 'notWorking']],
    studentStatus: [['student', 'student'], ['notStudent', 'notStudent']],
    insuranceStatus: [['insured', 'insured'], ['uninsured', 'uninsured']],
    disabilityStatus: [['yes', 'disabilityYes'], ['no', 'disabilityNo']],
    veteranStatus: [['yes', 'yes'], ['no', 'no'], ['preferNot', 'preferNot']],
    identification: [['yes', 'yes'], ['no', 'no'], ['some', 'someDocuments']]
  }[field];
  if (['lte', 'gte', 'between', 'incomeTable'].includes(question.operator) || ['householdSize', 'dependents'].includes(field)) {
    return `<label><span>${esc(label)}</span><input type="number" min="0" data-eligibility-field="${field}" value="${attr(answer || '')}"></label>`;
  }
  if (question.operator === 'eq' && String(question.value).toLowerCase() === 'yes') {
    return `<label><span>${esc(label)}</span><select data-eligibility-field="${field}">
      <option value="">${tr('chooseAnswer')}</option>
      <option value="yes" ${String(answer) === 'yes' ? 'selected' : ''}>${tr('yes')}</option>
      <option value="no" ${String(answer) === 'no' ? 'selected' : ''}>${tr('no')}</option>
    </select></label>`;
  }
  if (question.operator === 'in' && Array.isArray(question.value)) {
    return `<label><span>${esc(label)}</span><select data-eligibility-field="${field}">
      <option value="">${tr('chooseAnswer')}</option>
      ${question.value.map(value => `<option value="${attr(value)}" ${String(answer) === String(value) ? 'selected' : ''}>${esc(value)}</option>`).join('')}
    </select></label>`;
  }
  if (!options) {
    return `<label><span>${esc(label)}</span><input data-eligibility-field="${field}" value="${attr(answer || '')}"></label>`;
  }
  return `<label><span>${esc(label)}</span><select data-eligibility-field="${field}">
    <option value="">${tr('chooseAnswer')}</option>
    ${options.map(([value, key]) => `<option value="${value}" ${String(answer) === value ? 'selected' : ''}>${tr(key)}</option>`).join('')}
  </select></label>`;
}

function eligibilityPage() {
  const resources = mergeDuplicates([
    ...(state.searched ? allResults() : []),
    ...freshResources(sourceResources
      .filter(resource => resource.scope !== 'provider-directory'))
  ]).map(resource => normalizeResource(resource, state.lang));
  const selected = resourceById(state.eligibility.resourceId);
  const questions = selected
    ? localEligibilityQuestions(selected, state.eligibility.location, state.eligibility.answers)
    : [];
  const result = state.eligibility.started && selected
    ? evaluateLocalEligibility(selected, state.eligibility.location, state.eligibility.answers)
    : null;
  const currentQuestion = questions[state.eligibility.step];
  const complete = state.eligibility.started && (!questions.length || state.eligibility.step >= questions.length);
  return `<main id="main" class="wrap section page eligibility-page">
    <span class="eyebrow">${tr('eligibilityEyebrow')}</span>
    <h1>${tr('eligibilityTitle')}</h1>
    <p class="lead">${tr('eligibilityIntro')}</p>
    <button class="ghost admin-export" data-export-eligibility>${tr('exportEligibilityCsv')}</button>
    ${statusMessages()}
    <section class="eligibility-workspace">
      <div class="eligibility-setup">
        <label><span>${tr('chooseProgram')}</span>
          <select id="eligibilityResource">
            <option value="">${tr('selectProgram')}</option>
            ${resources.map(resource => `<option value="${attr(resource.id)}" ${state.eligibility.resourceId === resource.id ? 'selected' : ''}>${esc(resource.name)}</option>`).join('')}
          </select>
        </label>
        <label><span>${tr('eligibilityLocation')}</span>
          <input id="eligibilityLocation" value="${attr(state.eligibility.location)}" placeholder="${attr(tr('locationPlaceholder'))}">
          <small>${tr('eligibilityLocationHelp')}</small>
        </label>
        ${!state.eligibility.started ? `<button class="primary" data-start-eligibility>${tr('startEligibility')}</button>` : ''}
      </div>
      ${state.eligibility.started && selected ? `<div class="eligibility-quiz">
        <div class="eligibility-context">
          <p><strong>${tr('localProgramUsed')}:</strong> ${esc(selected.name)}</p>
          <p><strong>${tr('locationUsed')}:</strong> ${esc(state.eligibility.location)}</p>
        </div>
        ${!complete && currentQuestion ? `
          <div class="progress-track" aria-label="${attr(tr('answerQuestion', { current: state.eligibility.step + 1, total: questions.length }))}">
            <span style="width:${Math.round((state.eligibility.step + 1) / questions.length * 100)}%"></span>
          </div>
          <p class="step-label">${tr('answerQuestion', { current: state.eligibility.step + 1, total: questions.length })}</p>
          ${eligibilityField(currentQuestion, state.eligibility.answers[currentQuestion.field])}
          <button class="primary" data-next-eligibility>${state.eligibility.step + 1 === questions.length ? tr('seeResult') : tr('continue')}</button>
        ` : eligibilityResult(result, selected)}
      </div>` : ''}
    </section>
  </main>`;
}

function statusTranslation(status) {
  return {
    'Likely eligible': 'likelyEligible',
    'Possibly eligible': 'possiblyEligible',
    'Likely not eligible': 'likelyNotEligible',
    'No eligibility requirements published': 'noEligibilityRequirementsListed',
    'Eligibility research pending': 'eligibilityResearchPending',
    'Eligibility details require review': 'eligibilityNeedsReview',
    'Program does not serve this location': 'eligibilityOutOfArea',
    'Eligibility information temporarily unavailable': 'eligibilityTemporarilyUnavailable'
  }[status] || 'eligibilityTemporarilyUnavailable';
}

const ELIGIBILITY_DETAIL_KEYS = {
  whoQualifies: 'whoQualifies',
  geographicRestrictions: 'geographicRestrictions',
  incomeRequirements: 'incomeRequirements',
  ageHouseholdRequirements: 'ageHouseholdRequirements',
  importantExceptions: 'importantExceptions',
  applicationDeadline: 'applicationDeadline'
};

function eligibilityDetailsBlock(resource) {
  const details = resource.eligibilityDetails || {};
  const rows = Object.entries(ELIGIBILITY_DETAIL_KEYS)
    .filter(([field]) => details[field])
    .map(([field, key]) => `<dt>${tr(key)}</dt><dd>${esc(details[field])}</dd>`)
    .join('');
  return rows ? `<dl class="eligibility-details">${rows}</dl>` : '';
}

const APPLICATION_ACTION_KEYS = {
  application: 'startApplication',
  eligibility: 'checkEligibility',
  questionnaire: 'completeQuestionnaire',
  appointment: 'scheduleAppointment',
  download: 'downloadApplication',
  documents: 'viewRequiredDocuments',
  contact: 'contactIntake'
};

function applicationActions(guide) {
  const links = guide.applicationActions.map(action => {
    const label = action.label || tr(APPLICATION_ACTION_KEYS[action.type] || 'openApplication');
    return `<a class="${action.type === 'application' ? 'primary' : 'secondary'}" href="${attr(action.url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`;
  });
  if (!guide.applicationActions.length && guide.phone) {
    links.push(`<a class="primary" href="tel:${attr(phoneHref(guide.phone))}">☎ ${tr('callToApply')}</a>`);
  }
  return links.join('');
}

function applicationMethods(methods = []) {
  const keys = {
    online: 'applyOnline',
    phone: 'applyByPhone',
    mail: 'applyByMail',
    email: 'applyByEmail',
    fax: 'applyByFax',
    inPerson: 'applyInPerson',
    appointment: 'scheduleAppointment',
    localProvider: 'applyThroughLocalProvider'
  };
  return methods.map(method => tr(keys[method] || 'confirmOrganization')).join(' · ');
}

function eligibilityResult(result, resource) {
  if (!result) return '';
  const noPublishedRules = result.status === 'No eligibility requirements published';
  const temporarilyUnavailable = result.status === 'Eligibility information temporarily unavailable';
  const pendingResearch = result.status === 'Eligibility research pending';
  const needsReview = result.status === 'Eligibility details require review';
  const outOfArea = result.status === 'Program does not serve this location';
  return `<section class="eligibility-result" aria-live="polite">
    <h2>${tr(statusTranslation(result.status))}</h2>
    <p>${noPublishedRules
      ? tr('noEligibilityRequirementsExplanation')
      : temporarilyUnavailable
        ? tr('eligibilityTemporarilyUnavailableExplanation')
        : pendingResearch
          ? tr('eligibilityResearchPendingExplanation')
          : needsReview
            ? tr('eligibilityReviewExplanation')
            : outOfArea
              ? tr('eligibilityOutOfAreaExplanation')
        : tr('nearbyRulesDiffer')}</p>
    ${eligibilityDetailsBlock(resource)}
    ${result.passed?.length ? `<h3>${tr('satisfied')}</h3><ul>${result.passed.map(item => `<li>${tr('requirementMet', { requirement: tr(eligibilityFieldKey(item.field)) })}</li>`).join('')}</ul>` : ''}
    ${result.failed?.length ? `<h3>${tr('notSatisfied')}</h3><ul>${result.failed.map(item => `<li>${tr('requirementNotMet', { requirement: tr(eligibilityFieldKey(item.field)) })}</li>`).join('')}</ul>` : ''}
    ${result.missing?.length ? `<h3>${tr('missingInfo')}</h3><ul>${result.missing.map(item => `<li>${esc(eligibilityMissingLabel(item))}</li>`).join('')}</ul>` : ''}
    ${result.program?.localEligibilityVerified && resource.eligibilityExceptions?.length ? `<h3>${tr('exceptions')}</h3><ul>${resource.eligibilityExceptions.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
    ${resource.requiredDocuments?.length ? `<h3>${tr('documents')}</h3><ul>${resource.requiredDocuments.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
    <h3>${tr('nextSteps')}</h3><p>${tr('confirmOrganization')}</p>
    ${resource.eligibilitySourceUrl ? `<p><a class="secondary" href="${attr(safeUrl(resource.eligibilitySourceUrl))}" target="_blank" rel="noopener noreferrer">${tr('eligibilitySourceLink')} â†—</a></p>` : ''}
    <p><strong>${tr('lastVerified')}:</strong> ${esc(result.program?.eligibilityLastVerified || tr('nonePublished'))}</p>
    <p class="privacy-notice">${tr('preliminaryOnly')}</p>
    <button class="ghost" data-clear-eligibility>${tr('restartQuiz')}</button>
  </section>`;
}

function registrationPage() {
  const resource = currentResource();
  if (!resource) {
    return `<main id="main" class="wrap section page"><h1>${tr('registrationTitle')}</h1><div class="empty-state">${tr('selectProgram')}</div></main>`;
  }
  const guide = registrationGuidance(resource);
  const steps = ['registrationStepDocuments', 'registrationStepApply', 'registrationStepConfirm'];
  const step = Math.max(0, Math.min(2, state.registrationStep));
  let content = '';
  if (step === 0) {
    content = resource.requiredDocuments.length
      ? `<h2>${tr('documents')}</h2><ul>${resource.requiredDocuments.map(document => `<li>${esc(document)}</li>`).join('')}</ul>`
      : `<h2>${tr('documents')}</h2><p>${tr('nonePublished')}. ${tr('confirmOrganization')}</p>`;
  }
  if (step === 1) {
    content = `<h2>${tr('registrationStepApply')}</h2>
      ${guide.notRequired ? `<p>${tr('registrationNotRequired')}</p>` : ''}
      ${guide.applicationSteps.length ? `<p>${tr('applicationProcess')}</p><ol class="application-steps">${guide.applicationSteps.map(item => `<li>${esc(item)}</li>`).join('')}</ol>` : ''}
      ${guide.applicationMethods.length ? `<p><strong>${tr('waysToApply')}:</strong> ${applicationMethods(guide.applicationMethods)}</p>` : ''}
      ${guide.applicationActions.length ? `<p>${tr('registrationReview')}</p><div class="application-actions">${applicationActions(guide)}</div>` : `
        <p>${guide.phoneOrInPerson ? tr('registrationPhoneOnly') : tr('registrationNoForm')}</p>
        <p>${tr('registrationUseContact')}</p>
        <div class="application-actions">${applicationActions(guide)}${guide.officialWebsite ? `<a class="secondary" href="${attr(safeUrl(guide.officialWebsite))}" target="_blank" rel="noopener noreferrer">${tr('openOfficialSite')} ↗</a>` : ''}</div>`}
      ${guide.applicationDeadline ? `<p><strong>${tr('applicationDeadline')}:</strong> ${esc(guide.applicationDeadline)}</p>` : ''}
      ${guide.appointmentRequirement ? `<p><strong>${tr('appointmentRequirements')}:</strong> ${esc(guide.appointmentRequirement)}</p>` : ''}
      ${guide.applicationLastVerified ? `<p><strong>${tr('lastVerified')}:</strong> ${esc(guide.applicationLastVerified)}</p>` : ''}
      <details><summary>${tr('callingScript')}</summary><p>${tr('callingScriptText', { program: resource.name })}</p></details>`;
  }
  if (step === 2) {
    content = `<h2>${tr('registrationStepConfirm')}</h2><p>${tr('registrationNeverSubmit')}</p>
      <p>${esc(guide.afterApplying || tr('confirmOrganization'))}</p>
      <div class="registration-summary">
        <p><strong>${tr('localProgramUsed')}:</strong> ${esc(resource.name)}</p>
        <p><strong>${tr('locationUsed')}:</strong> ${esc(state.location || tr('notEntered'))}</p>
        <p><strong>${tr('registrationRequirement')}:</strong> ${esc(resource.registrationRequirement || tr('registrationUseContact'))}</p>
      </div>`;
  }
  return `<main id="main" class="wrap section page registration-page">
    <span class="eyebrow">${tr('registrationProgress', { current: step + 1, total: 3 })}</span>
    <h1>${tr('registrationTitle')}</h1>
    <p class="lead">${esc(resource.name)}</p>
    <div class="registration-progress">${steps.map((key, index) => `<span class="${index <= step ? 'active' : ''}">${index + 1}. ${tr(key)}</span>`).join('')}</div>
    <section class="registration-card">${content}</section>
    <div class="wizard-actions">
      <button class="ghost" data-registration-prev ${step === 0 ? 'disabled' : ''}>${tr('previous')}</button>
      <button class="primary" data-registration-next ${step === 2 ? 'disabled' : ''}>${tr('next')}</button>
    </div>
  </main>`;
}

function requirementsPanel() {
  const resource = currentResource();
  if (state.panel !== 'requirements' || !resource) return '';
  const local = localProgramForResource(resource, state.location);
  const requirementsHeading = local?.localEligibilityVerified
    ? tr('requirementsTitle')
    : ['no_restrictions_listed', 'open'].includes(local?.eligibilityStatus)
      ? tr('noEligibilityRequirementsListed')
      : local?.eligibilityResearchStatus === 'technical_failure'
        ? tr('eligibilityTemporarilyUnavailable')
        : local?.eligibilityResearchStatus === 'ambiguous_review'
          ? tr('eligibilityNeedsReview')
          : !local?.inServiceArea
            ? tr('eligibilityOutOfArea')
            : tr('eligibilityResearchPending');
  const eligibilityMessage = eligibilityDisplay(local);
  return drawer(`<h2 id="panel-title">${requirementsHeading}</h2>
    <p><strong>${tr('localProgramUsed')}:</strong> ${esc(resource.name)}</p>
    <p><strong>${tr('locationUsed')}:</strong> ${esc(state.location || tr('notEntered'))}</p>
    <p>${esc(eligibilityMessage)}</p>
    ${local?.localEligibilityVerified ? eligibilityDetailsBlock(resource) : ''}
    ${local?.localEligibilityVerified && resource.requiredDocuments.length ? `<h3>${tr('documents')}</h3><ul>${resource.requiredDocuments.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
    <p><strong>${tr('lastVerified')}:</strong> ${esc(local?.eligibilityLastVerified || tr('nonePublished'))}</p>
    <p class="privacy-notice">${tr('preliminaryOnly')}</p>`);
}

function reportPanel() {
  const resource = currentResource();
  if (state.panel !== 'report' || !resource) return '';
  const types = [
    ['address', 'reportAddress'],
    ['hours', 'reportHours'],
    ['closed', 'reportClosed'],
    ['service', 'reportService'],
    ['eligibility', 'reportEligibility'],
    ['registration', 'reportRegistration'],
    ['duplicate', 'reportDuplicate'],
    ['other', 'reportOther']
  ];
  return drawer(`<h2 id="panel-title">${tr('reportTitle')}</h2>
    ${state.reportSubmitted ? `<div class="cache-state"><strong>${tr('reportSubmitted')}</strong><p>${tr('reportVerificationProcess')}</p></div>` : `
      <p>${tr('reportIntro')}</p>
      <form id="reportForm">
        <input type="hidden" name="resourceId" value="${attr(resource.id)}">
        <label><span>${tr('reportType')}</span><select name="type" required>
          ${types.map(([value, key]) => `<option value="${value}">${tr(key)}</option>`).join('')}
        </select></label>
        <label><span>${tr('reportDetails')}</span><textarea name="details" rows="4" placeholder="${attr(tr('reportDetailsPlaceholder'))}"></textarea></label>
        <button class="primary" type="submit">${tr('submitReport')}</button>
      </form>`}`);
}

function drawer(content) {
  return `<div class="drawer-backdrop"><section class="side-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
    <button class="drawer-close" data-close-panel aria-label="${attr(tr('close'))}">×</button>${content}
  </section></div>`;
}

function chatRecommendation(resource, language) {
  const normalized = normalizeResource(resource, language);
  const website = safeUrl(normalized.registrationUrl || normalized.officialWebsite || normalized.website);
  const schedule = resourceScheduleState(normalized);
  const scheduleText = schedule.code === 'open_now'
    ? tr('openNow', {}, language)
    : schedule.code === 'opens_at'
      ? tr('opensAt', { time: formatScheduleTime(schedule.nextOpenTime, language) }, language)
      : schedule.code === 'hours_not_listed'
        ? tr('hoursNotPubliclyListed', {}, language)
      : schedule.code === 'appointment_only'
          ? tr('appointmentOnly', {}, language)
          : schedule.code === 'event_today'
            ? tr('upcomingEvent', {}, language)
          : tr('closed', {}, language);
  return `<article class="chat-resource">
    <strong>${esc(normalized.name)}</strong>
    <span>${esc(normalized.address || tr('addressUnavailable', {}, language))}</span>
    <span>${tr('hours', {}, language)}: ${esc(scheduleText)}</span>
    ${website ? `<a href="${attr(website)}" target="_blank" rel="noopener noreferrer">${tr(normalized.registrationUrl ? 'officialApplication' : 'officialWebsite', {}, language)} ↗</a>` : ''}
  </article>`;
}

function chat() {
  const opening = state.mode === 'helper' ? tr('assistantHelperOpening') : tr('assistantSelfOpening');
  return `<button class="chat-launcher" data-chat aria-expanded="${state.chatOpen}">${tr('assistantName')} <span aria-hidden="true">${state.chatOpen ? '×' : '✦'}</span></button>
    ${state.chatOpen ? `<section class="chat-panel" aria-label="${attr(tr('assistantName'))}"
      data-response-ms="${state.chatMetrics.lastResponseMs === null ? '' : Math.round(state.chatMetrics.lastResponseMs)}"
      data-response-strategy="${attr(state.chatMetrics.strategy)}">
      <div class="chat-head"><strong>${tr('assistantName')}</strong><small>${tr('assistantSubtitle')}</small></div>
      <div class="chat-messages" aria-live="polite">
        <p class="assistant-message">${opening}</p>
        ${state.chatMessages.map(message => `<div class="${message.role}-message" lang="${message.language || state.lang}">
          <p>${esc(message.text)}</p>
          ${message.recommendations?.map(resource => chatRecommendation(resource, message.language || state.lang)).join('') || ''}
        </div>`).join('')}
        ${state.chatLoading ? `<div class="assistant-message chat-loading" role="status"><span class="spinner" aria-hidden="true"></span>${tr('assistantLoading')}</div>` : ''}
      </div>
      <form id="chatForm"><label class="sr-only" for="chatInput">${tr('assistantName')}</label>
        <input id="chatInput" placeholder="${attr(tr('chatPlaceholder'))}">
        <button class="primary">${tr('send')}</button>
      </form>
    </section>` : ''}`;
}

function footer() {
  return `<footer><div class="wrap"><strong>BridgeAid</strong><br><small>${tr('footerNotice')}</small></div></footer>`;
}

function render(options = {}) {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-Hans' : state.lang;
  document.title = tr('appTitle');
  const page = {
    home: homePage,
    find: findPage,
    nationwide: nationwidePage,
    eligibility: eligibilityPage,
    registration: registrationPage,
    saved: savedPage,
    privacy: privacyPage
  }[state.page]?.() || homePage();
  app.innerHTML = `${header()}${page}${footer()}${chat()}${requirementsPanel()}${reportPanel()}${modeSelector()}`;
  if (options.focus) requestAnimationFrame(() => document.querySelector(options.focus)?.focus());
}

async function researchMissingSchedules(resources) {
  if (state.offline) return resources;
  const pending = resources.map(resource => (
    (!resource.weeklyHours || !resourceIsFresh(resource)) && resource.sourceUrls?.length
      ? { ...resource, scheduleVerificationStatus: 'researching' }
      : resource
  ));
  const candidates = pending
    .filter(resource => resource.scheduleVerificationStatus === 'researching')
    .sort((a, b) => Number(b.verificationPriority === 'high') - Number(a.verificationPriority === 'high'))
    .slice(0, 5);
  if (!candidates.length) return pending;
  const checkedResults = await Promise.allSettled(candidates.map(resource => verifyResourceSchedule(resource)));
  const checked = checkedResults
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);
  const updates = new Map(checked.map(resource => [resource.id, resource]));
  return pending.map(resource => updates.get(resource.id) || resource);
}

async function enrichStoredEvidence(point, { key, location, quiet = false } = {}) {
  const locationKey = `${Number(point.lat).toFixed(4)},${Number(point.lng).toFixed(4)}`;
  return enrichmentCoordinator.run(`stored:${locationKey}`, async () => {
    let updated = await geocodeResourceAddresses(state.storedResults, {
      origin: point,
      maximum: 20
    });
    const apiKey = placesApiKey();
    if (apiKey && !state.offline) {
      const candidates = updated
        .filter(resource => resource.address && servesLocation(resource, location))
        .slice(0, 5);
      const enrichedResults = await Promise.allSettled(
        candidates.map(resource => enrichWithConfiguredPlaces(resource, { apiKey }))
      );
      const enriched = new Map(enrichedResults
        .filter(result => result.status === 'fulfilled')
        .map(result => [result.value.id, result.value]));
      updated = updated.map(resource => enriched.get(resource.id) || resource);
      updated = await geocodeResourceAddresses(updated, { origin: point, maximum: 20 });
    }
    const outdated = updated
      .filter(resource => resource.scope !== 'nationwide-online' && !resourceIsFresh(resource))
      .sort((a, b) => Number(b.verificationPriority === 'high') - Number(a.verificationPriority === 'high'))
      .slice(0, 5);
    if (outdated.length) {
      const verified = await Promise.allSettled(outdated.map(resource => verifyResourceSchedule(resource)));
      const replacements = new Map(verified
        .filter(result => result.status === 'fulfilled' && resourceIsFresh(result.value))
        .map(result => [String(result.value.id), result.value]));
      updated = updated.map(resource => replacements.get(String(resource.id)) || resource);
    }
    if (key && state.activeSearchKey !== key) return updated;
    state.storedResults = updated;
    if (state.searched && !quiet) render();
    return updated;
  });
}

async function performNearbySearch({
  coordinates = null,
  quiet = false,
  key,
  cache,
  cached,
  location,
  desired,
  radius
} = {}) {
  if (state.activeSearchKey !== key) return state.liveResults;
  state.errorKey = '';
  state.errorText = '';
  state.locationSuggestions = [];
  state.noticeKey = '';
  state.loading = true;
  state.discoveryStatus = 'discovering';
  recordSearchDiagnostic('search_started', { radius, desired });
  if (!quiet) render();
  const freshCached = cached && !cached.stale && cached.resources.length ? cached : null;
  if (freshCached) {
    state.liveResults = mergeSearchResults([], freshCached.resources, desired);
    recordSearchDiagnostic('fresh_cache_rendered', { cachedCount: freshCached.resources.length });
    if (!quiet) render();
  }
  if (state.offline) {
    state.loading = false;
    state.discoveryStatus = freshCached || staticMatches().length ? 'verified-results-available' : 'unavailable';
    if (!freshCached && !staticMatches().length) state.errorKey = 'searchUnavailable';
    if (!quiet) render();
    return state.liveResults;
  }
  try {
    const point = coordinates || await geocodeLocation(location);
    if (state.activeSearchKey !== key) return state.liveResults;
    state.coordinates = { lat: point.lat, lng: point.lng };
    state.situationConstraints = parseSituation(`${state.otherNeed} ${state.situation}`, {
      location: state.location,
      coordinates: state.coordinates
    });
    state.resolvedLocation = point.label || location;
    const canonicalCategory = [state.category || 'all', ...desired].join(':');
    const canonicalKey = coordinateCacheKey(point, canonicalCategory, radius);
    const canonicalCached = canonicalKey ? readCachedSearch(safeObject(STORAGE.cache), canonicalKey) : null;
    const reusableCached = canonicalCached && !canonicalCached.stale && canonicalCached.resources.length
      ? canonicalCached
      : freshCached;
    if (reusableCached) {
      state.liveResults = mergeSearchResults(state.liveResults, reusableCached.resources, desired);
      if (!quiet) render();
    }
    void enrichStoredEvidence(point, { key, location, quiet });
    let rows = await fetchNearbyResources({
      lat: point.lat,
      lng: point.lng,
      radius
    });
    if (desired.length) rows = rows.filter(resource => desired.includes(resource.category));
    rows = mergeSearchResults(reusableCached?.resources || [], rows, desired);
    let updatedCache = writeCachedSearch(safeObject(STORAGE.cache), key, rows);
    if (canonicalKey) updatedCache = writeCachedSearch(updatedCache, canonicalKey, rows);
    persist(STORAGE.cache, updatedCache);
    persist(STORAGE.searches, [...new Set([...safeArray(STORAGE.searches), location])].slice(-10));
    if (state.activeSearchKey !== key) return rows;
    state.liveResults = rows;
    state.discoveryStatus = rows.length || staticMatches().length ? 'verified-results-available' : 'no-results-yet';
    recordSearchDiagnostic('live_discovery_merged', { liveCount: rows.length });
    if (!quiet) render();
    void enrichmentCoordinator.run(`hours:${key}`, async () => {
      const checked = await researchMissingSchedules(rows);
      const complete = mergeSearchResults(state.liveResults, checked, desired);
      let checkedCache = writeCachedSearch(safeObject(STORAGE.cache), key, complete);
      if (canonicalKey) checkedCache = writeCachedSearch(checkedCache, canonicalKey, complete);
      persist(STORAGE.cache, checkedCache);
      if (state.activeSearchKey !== key) return checked;
      state.liveResults = complete;
      recordSearchDiagnostic('verification_merge_completed', { verifiedCount: checked.length, total: complete.length });
      if (!quiet) render();
      return complete;
    });
  } catch (error) {
    if (state.activeSearchKey === key) {
      if (error.code === 'AMBIGUOUS_LOCATION') {
        state.errorKey = 'locationAmbiguous';
        state.locationSuggestions = Array.isArray(error.choices) ? error.choices : [];
      } else if (error.code === 'LOCATION_NOT_FOUND') {
        state.errorKey = 'locationNotFound';
      } else {
        state.errorKey = 'searchUnavailable';
      }
      state.discoveryStatus = staticMatches().length || state.liveResults.length
        ? 'verified-results-available'
        : 'unavailable';
      recordSearchDiagnostic('search_failed', { code: error.code || 'SEARCH_FAILED', message: error.message });
    }
  } finally {
    if (state.activeSearchKey === key) {
      state.loading = false;
      if (state.discoveryStatus === 'discovering') {
        state.discoveryStatus = state.liveResults.length || staticMatches().length
          ? 'verified-results-available'
          : 'no-results-yet';
      }
      if (!quiet) render();
    }
  }
  return state.liveResults;
}

async function searchNearby({ coordinates = null, quiet = false } = {}) {
  const location = state.location;
  const category = state.category || 'all';
  const otherNeed = state.otherNeed;
  const radius = effectiveRadiusMiles();
  const desired = desiredCategories();
  const key = searchSignature({
    location,
    category,
    categories: desired,
    situation: `${otherNeed} ${state.situation}`,
    radius,
    filters: state.filters,
    sort: state.sortBy
  });
  const cache = safeObject(STORAGE.cache);
  const cached = readCachedSearch(cache, key);
  state.activeSearchKey = key;
  recordSearchDiagnostic('search_normalized', { desired, radius });
  return searchCoordinator.run(key, () => performNearbySearch({
    coordinates,
    quiet,
    key,
    cache,
    cached,
    location,
    desired,
    radius
  }));
}

async function submitSearch(form) {
  const data = new FormData(form);
  state.category = String(data.get('need') || '');
  state.otherNeed = String(data.get('otherNeed') || '').trim();
  state.situation = String(data.get('situation') || '').trim();
  state.location = String(data.get('location') || '').trim();
  state.unit = String(data.get('unit') || state.unit);
  state.radiusValue = Number(data.get('radius')) || 5;
  state.travelMode = String(data.get('travelMode') || 'walking');
  state.query = searchNeed();
  state.coordinates = null;
  state.locationSuggestions = [];
  if (!state.category || !state.location) {
    state.errorKey = 'locationRequired';
    render({ focus: !state.category ? '#needSelect' : '#locationInput' });
    return;
  }
  if (state.category === 'other' && !state.otherNeed) {
    state.errorKey = 'otherNeedRequired';
    render({ focus: '#otherNeedInput' });
    return;
  }
  applySituationFilters(`${state.otherNeed} ${state.situation}`);
  state.searched = true;
  state.page = 'find';
  state.storedResults = sourceResources;
  state.liveResults = [];
  state.visibleResults = 20;
  state.decisionPlan = null;
  persistShared();
  render();
  void searchNearby();
}

function generateDecisionPlan(form) {
  const data = new FormData(form);
  state.planConstraints = normalizePlanConstraints({
    urgency: data.get('urgency'),
    availableDays: data.get('availableDays'),
    availableTimes: data.get('availableTimes'),
    transportation: data.get('transportation'),
    maxDistance: data.get('maxDistance'),
    transportationBudget: data.get('transportationBudget'),
    walkingLimit: data.get('walkingLimit'),
    wheelchairAccessible: data.has('wheelchairAccessible'),
    physicalLimitations: data.get('physicalLimitations'),
    childcareNeeded: data.has('childcareNeeded'),
    deadline: data.get('deadline')
  });
  const selectedIds = new Set(state.helperPlan.map(item => item.id));
  const candidates = allResults().filter(resource => !selectedIds.size || selectedIds.has(resource.id));
  state.decisionPlan = buildDecisionPlan(candidates, state.planConstraints, {
    mode: state.mode,
    situationConstraints: state.situationConstraints
  });
  render({ focus: '#decision-plan-title' });
}

function addToPlan(id) {
  const resource = resourceById(id);
  if (!resource) return;
  if (state.helperPlan.some(item => item.id === id)) {
    state.helperPlan = removePlanResource(state.helperPlan, id);
  } else {
    state.helperPlan = addPlanResource(state.helperPlan, {
      ...resource,
      directions: directionsUrl(resource, 'walking')
    });
  }
  persistHelper();
  render();
}

async function processReport(form) {
  const data = new FormData(form);
  const resource = resourceById(String(data.get('resourceId') || ''));
  if (!resource) return;
  const report = createCorrectionReport({
    resource,
    type: String(data.get('type') || ''),
    details: String(data.get('details') || '')
  });
  state.corrections = queueCorrection(state.corrections, report);
  persist(STORAGE.corrections, state.corrections);
  state.reportSubmitted = true;
  render();
  try {
    const checked = await verifyCorrectionReport(report, resource);
    state.corrections = state.corrections.map(item => item.id === checked.id ? checked : item);
    persist(STORAGE.corrections, state.corrections);
  } catch {
    // The queued report remains available for later administrative review.
  }
}

async function sendChat(form) {
  const input = form.querySelector('#chatInput');
  const message = input.value.trim();
  if (!message) return;
  const responseStartedAt = performance.now();
  performance.clearMarks?.('bridgeai-response-start');
  performance.clearMarks?.('bridgeai-response-ready');
  performance.clearMeasures?.('bridgeai-stored-response');
  performance.mark?.('bridgeai-response-start');
  const messageLanguage = requestedLanguage(message)
    || detectMessageLanguage(message, state.chatContext.language || state.lang);
  state.chatMessages.push({ role: 'user', text: message, language: messageLanguage });
  state.chatLoading = true;
  const requested = requestedLanguage(message);
  if (requested) {
    state.lang = requested;
    state.languageExplicit = true;
    persistShared();
  }
  const messageLocation = locationFromMessage(message);
  const messageCategory = assistantCategory(message);
  if (messageLocation) state.location = messageLocation;
  if (messageCategory) {
    state.category = messageCategory;
    state.query = categoryLabel(messageCategory);
  }
  state.situation = message;
  applySituationFilters(message);
  render();
  await new Promise(resolve => requestAnimationFrame(resolve));
  const responseKey = [
    messageLanguage,
    message.toLowerCase(),
    state.location.toLowerCase(),
    state.category,
    state.chatContext.category || '',
    state.chatContext.intent || ''
  ].join('|');
  const liveResourceIds = new Set(state.liveResults.map(resource => String(resource.id)));
  const assistantResources = mergeDuplicates([...state.liveResults, ...state.storedResults])
    .filter(resource => String(resource.id) !== '211')
    .filter(resource => resource.scope !== 'nationwide-online')
    .filter(resource => resourceIsFresh(resource))
    .filter(resource => filterResources([resource], state.filters).length > 0)
    .filter(resource => {
      if (liveResourceIds.has(String(resource.id))) return true;
      const isLocationBound = Boolean(
        resource.serviceAreas?.length
        || resource.serviceAreaZipRanges?.length
        || resource.serviceAreaZipPrefixes?.length
      );
      return isLocationBound && servesLocation(resource, state.location);
    });
  const selectedForAssistant = currentResource();
  const selectedIsLocal = selectedForAssistant
    && assistantResources.some(resource => String(resource.id) === selectedForAssistant.id);
  const task = storedFirstResponse({
    answer: () => {
      if (responseCache.has(responseKey)) return responseCache.get(responseKey);
      const answer = answerGroundedAssistant({
        message,
        selectedLanguage: messageLanguage,
        languageExplicit: state.languageExplicit,
        currentLocation: state.location,
        resources: assistantResources,
        context: state.chatContext,
        selectedResource: selectedIsLocal ? selectedForAssistant : null,
        translate
      });
      return responseCache.set(responseKey, answer);
    },
    enrich: async () => {
      if (!state.location || !state.category) return [];
      state.searched = true;
      return searchNearby({ quiet: true });
    }
  });
  const answer = task.response;
  state.chatMetrics.answerComputeMs = task.responseMs;
  state.chatMetrics.lastResponseMs = Math.max(0, performance.now() - responseStartedAt);
  performance.mark?.('bridgeai-response-ready');
  performance.measure?.('bridgeai-stored-response', 'bridgeai-response-start', 'bridgeai-response-ready');
  state.chatContext = answer.context;
  state.chatMessages.push({
    role: 'assistant',
    text: answer.text,
    language: answer.language,
    recommendations: answer.recommendations
  });
  state.chatLoading = false;
  persistShared();
  render({ focus: '#chatInput' });
  void task.enrichment;
}

app.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.matches('#searchForm')) submitSearch(event.target);
  if (event.target.matches('#actionPlanForm')) generateDecisionPlan(event.target);
  if (event.target.matches('#chatForm')) sendChat(event.target);
  if (event.target.matches('#reportForm')) processReport(event.target);
});

app.addEventListener('click', async event => {
  const target = event.target.closest('button, a');
  if (!target) return;
  if (target.matches('[data-mode]')) {
    switchMode(state, target.dataset.mode);
    state.modePromptOpen = false;
    state.page = 'home';
    render({ focus: '#main' });
  }
  if (target.matches('[data-switch-mode]')) {
    state.modePromptOpen = true;
    render({ focus: '[data-mode="self"]' });
  }
  if (target.matches('[data-close-mode]')) {
    state.modePromptOpen = false;
    render({ focus: '[data-switch-mode]' });
  }
  if (target.matches('[data-page]')) {
    state.page = target.dataset.page;
    state.errorKey = '';
    state.errorText = '';
    render({ focus: '#main' });
    scrollTo(0, 0);
  }
  if (target.matches('[data-menu]')) {
    const links = document.querySelector('#navLinks');
    links.classList.toggle('open');
    target.setAttribute('aria-expanded', String(links.classList.contains('open')));
  }
  if (target.matches('[data-gps]')) {
    if (!navigator.geolocation) {
      state.errorKey = 'locationDenied';
      render();
      return;
    }
    target.disabled = true;
    navigator.geolocation.getCurrentPosition(
      async position => {
        state.location = tr('useLocation');
        state.searched = Boolean(state.category);
        state.page = state.searched ? 'find' : 'home';
        state.storedResults = sourceResources;
        state.liveResults = [];
        persistShared();
        if (state.searched) void searchNearby({ coordinates: { lat: position.coords.latitude, lng: position.coords.longitude } });
        else render();
      },
      error => {
        state.errorKey = error.code === 3 ? 'locationTimeout' : 'locationDenied';
        render({ focus: '#locationInput' });
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  }
  if (target.matches('[data-location-suggestion]')) {
    state.location = target.dataset.locationSuggestion;
    if (target.dataset.locationTarget === 'helper') {
      state.helperIntake.location = state.location;
      persistHelper();
    }
    state.locationSuggestions = [];
    state.errorKey = '';
    state.coordinates = { lat: Number(target.dataset.lat), lng: Number(target.dataset.lng) };
    state.situationConstraints = parseSituation(`${state.otherNeed} ${state.situation}`, {
      location: state.location,
      coordinates: state.coordinates
    });
    persistShared();
    render();
    if (target.dataset.locationTarget !== 'helper' && state.searched && state.category) {
      void searchNearby({ coordinates: state.coordinates });
    }
  }
  if (target.matches('[data-load-more]')) {
    state.visibleResults += 20;
    render({ focus: '[data-load-more]' });
  }
  if (target.matches('[data-save]')) {
    const id = target.dataset.save;
    state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
    persistShared();
    render();
  }
  if (target.matches('[data-eligibility]')) {
    state.eligibility.resourceId = target.dataset.eligibility;
    state.eligibility.location = state.location;
    state.eligibility.answers = {};
    state.eligibility.step = 0;
    state.eligibility.started = false;
    state.page = 'eligibility';
    render({ focus: '#main' });
  }
  if (target.matches('[data-registration]')) {
    state.selectedResourceId = target.dataset.registration;
    state.registrationStep = 0;
    state.page = 'registration';
    render({ focus: '#main' });
  }
  if (target.matches('[data-requirements]')) {
    state.selectedResourceId = target.dataset.requirements;
    state.panel = 'requirements';
    render({ focus: '.drawer-close' });
  }
  if (target.matches('[data-report]')) {
    state.selectedResourceId = target.dataset.report;
    state.panel = 'report';
    state.reportSubmitted = false;
    render({ focus: '.drawer-close' });
  }
  if (target.matches('[data-close-panel]')) {
    state.panel = '';
    state.reportSubmitted = false;
    render();
  }
  if (target.matches('[data-add-plan]')) addToPlan(target.dataset.addPlan);
  if (target.matches('[data-compare]')) {
    const id = target.dataset.compare;
    state.compareIds.has(id) ? state.compareIds.delete(id) : state.compareIds.add(id);
    if (state.compareIds.size > 3) state.compareIds.delete([...state.compareIds][0]);
    render();
  }
  if (target.matches('[data-clear-compare]')) {
    state.compareIds.clear();
    render();
  }
  if (target.matches('[data-helper-search]')) {
    const selectedCategories = Array.isArray(state.helperIntake.serviceCategories)
      ? state.helperIntake.serviceCategories
      : [];
    state.otherNeed = '';
    state.situation = state.helperIntake.situation || '';
    state.category = selectedCategories[0] || '';
    state.location = state.helperIntake.location || state.location;
    if (!state.category || !state.location) {
      state.errorKey = 'locationRequired';
      render();
      return;
    }
    applySituationFilters(`${state.situation} ${state.helperIntake.identification || ''} ${state.helperIntake.accessibility || ''}`);
    state.query = searchNeed();
    state.searched = true;
    state.page = 'find';
    state.storedResults = sourceResources;
    state.liveResults = [];
    state.visibleResults = 20;
    state.decisionPlan = null;
    persistHelper();
    persistShared();
    render();
    void searchNearby();
  }
  if (target.matches('[data-clear-intake]')) {
    state.helperIntake = {};
    persistHelper();
    render();
  }
  if (target.matches('[data-remove-plan]')) {
    state.helperPlan = removePlanResource(state.helperPlan, target.dataset.removePlan);
    persistHelper();
    render();
  }
  if (target.matches('[data-clear-plan]')) {
    const cleared = emptyPlan();
    state.helperPlan = cleared.plan;
    state.helperIntake = cleared.intake;
    persistHelper();
    render();
  }
  if (target.matches('[data-copy-plan]')) {
    try {
      await navigator.clipboard.writeText(planText());
      state.noticeKey = 'copied';
    } catch {
      state.errorKey = 'copyFailed';
    }
    render();
  }
  if (target.matches('[data-share-plan]')) {
    const text = planText();
    try {
      if (navigator.share) await navigator.share({ title: 'BridgeAid resource plan', text });
      else await navigator.clipboard.writeText(text);
      state.noticeKey = 'copied';
    } catch (error) {
      if (error?.name !== 'AbortError') state.errorKey = 'copyFailed';
    }
    render();
  }
  if (target.matches('[data-print-plan]')) window.print();
  if (target.matches('[data-clear-filters]')) {
    state.filters = {
      openNow: false,
      availableToday: false,
      walkIn: false,
      noId: false,
      noRegistration: false,
      accessible: false,
      language: '',
      verifiedEligibility: false
    };
    render();
  }
  if (target.matches('[data-retry-search]')) {
    state.errorKey = '';
    void searchNearby();
  }
  if (target.matches('[data-retry-saved]')) {
    if (!state.location || !state.category) {
      state.page = 'home';
      state.errorKey = 'locationRequired';
      render({ focus: '#locationInput' });
    } else {
      state.page = 'find';
      state.searched = true;
      state.errorKey = '';
      render();
      void searchNearby();
    }
    applySituationFilters(`${state.otherNeed} ${state.situation} ${state.helperIntake.identification || ''} ${state.helperIntake.accessibility || ''}`);
  }
  if (target.matches('[data-start-eligibility]')) {
    const resourceSelect = document.querySelector('#eligibilityResource');
    const locationInput = document.querySelector('#eligibilityLocation');
    state.eligibility.resourceId = resourceSelect?.value || '';
    state.eligibility.location = locationInput?.value.trim() || '';
    if (!state.eligibility.resourceId || !state.eligibility.location) {
      state.errorKey = 'locationRequired';
      render();
      return;
    }
    state.eligibility.started = true;
    state.eligibility.step = 0;
    state.eligibility.answers = {};
    render();
  }
  if (target.matches('[data-next-eligibility]')) {
    const resource = resourceById(state.eligibility.resourceId);
    const questions = localEligibilityQuestions(resource, state.eligibility.location, state.eligibility.answers);
    const question = questions[state.eligibility.step];
    const field = document.querySelector('[data-eligibility-field]');
    if (question && field) state.eligibility.answers[question.field] = field.value;
    state.eligibility.step += 1;
    render();
  }
  if (target.matches('[data-clear-eligibility]')) {
    state.eligibility.answers = {};
    state.eligibility.step = 0;
    state.eligibility.started = false;
    render();
  }
  if (target.matches('[data-registration-prev]')) {
    state.registrationStep = Math.max(0, state.registrationStep - 1);
    render();
  }
  if (target.matches('[data-registration-next]')) {
    state.registrationStep = Math.min(2, state.registrationStep + 1);
    render();
  }
  if (target.matches('[data-clear-location]')) {
    state.location = '';
    state.coordinates = null;
    state.activeSearchKey = '';
    state.storedResults = sourceResources;
    state.liveResults = [];
    state.eligibility.location = '';
    safeStorageRemove(STORAGE.location);
    safeStorageRemove('ba-coords');
    render();
  }
  if (target.matches('[data-clear-private]')) {
    clearPrivateData();
    safeStorageRemove(STORAGE.corrections);
    state.location = '';
    state.coordinates = null;
    state.helperIntake = {};
    state.helperPlan = [];
    state.liveResults = [];
    state.activeSearchKey = '';
    state.searched = false;
    state.corrections = [];
    state.eligibility = { resourceId: '', location: '', answers: {}, step: 0, started: false };
    state.noticeKey = 'clearDataDone';
    state.mode = '';
    state.modePromptOpen = true;
    render();
  }
  if (target.matches('[data-chat]')) {
    state.chatOpen = !state.chatOpen;
    render({ focus: state.chatOpen ? '#chatInput' : '[data-chat]' });
  }
});

app.addEventListener('change', event => {
  const target = event.target;
  if (target.matches('#language')) {
    captureSearchDraft();
    state.lang = target.value;
    state.languageExplicit = true;
    persistShared();
    render();
  }
  if (target.matches('#needSelect')) {
    captureSearchDraft();
    state.category = target.value;
    state.errorKey = '';
    render({ focus: state.category === 'other' ? '#otherNeedInput' : '#locationInput' });
  }
  if (target.matches('#distanceUnit')) {
    captureSearchDraft();
    state.unit = target.value;
    persistShared();
    render({ focus: '#distanceUnit' });
  }
  if (target.matches('[data-intake]')) {
    state.helperIntake[target.name] = target.value;
    persistHelper();
    render();
  }
  if (target.matches('[data-filter]')) {
    state.filters[target.dataset.filter] = target.checked;
    render();
  }
  if (target.matches('[data-filter-text]')) {
    state.filters[target.dataset.filterText] = target.value;
    render();
  }
  if (target.matches('[data-online-filter]')) {
    state.onlineFilters[target.dataset.onlineFilter] = target.value;
    render();
  }
  if (target.matches('#sortBy')) {
    state.sortBy = target.value;
    render();
  }
  if (target.matches('[data-plan-status]')) {
    state.helperPlan = updatePlanStatus(state.helperPlan, target.dataset.planStatus, STATUS_STORAGE[target.value]);
    persistHelper();
    render();
  }
  if (target.matches('[data-plan-note]')) {
    state.helperPlan = updatePlanNote(state.helperPlan, target.dataset.planNote, target.value);
    persistHelper();
  }
  if (target.matches('[data-plan-questions]')) {
    state.helperPlan = updatePlanQuestions(state.helperPlan, target.dataset.planQuestions, target.value);
    persistHelper();
  }
  if (target.matches('[data-export-eligibility]')) {
    const csv = exportEligibilityCsv(sourceResources);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `bridgeaid-eligibility-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  if (target.matches('#eligibilityResource')) {
    state.eligibility.resourceId = target.value;
    state.eligibility.started = false;
    state.eligibility.answers = {};
    state.eligibility.step = 0;
  }
});

let filterInputTimer = null;
let locationInputTimer = null;
app.addEventListener('input', event => {
  const target = event.target;
  if (target.matches('[data-intake]') && !target.matches('#helperLocationInput')) {
    state.helperIntake[target.name] = target.value;
    persistHelper();
  }
  if (target.matches('[data-intake-category]')) {
    const selected = new Set(Array.isArray(state.helperIntake.serviceCategories)
      ? state.helperIntake.serviceCategories
      : []);
    target.checked ? selected.add(target.value) : selected.delete(target.value);
    state.helperIntake.serviceCategories = [...selected];
    persistHelper();
    render();
  }
  if (target.matches('#locationInput, #helperLocationInput')) {
    if (target.matches('#helperLocationInput')) {
      state.helperIntake.location = target.value;
      persistHelper();
    } else {
      state.location = target.value;
    }
    state.coordinates = null;
    state.locationSuggestions = [];
    clearTimeout(locationInputTimer);
    const query = target.value.trim();
    if (query.length < 2) {
      state.locationSuggestionsLoading = false;
      updateLocationSuggestionDom();
      return;
    }
    const sequence = ++locationSuggestionSequence;
    state.locationSuggestionsLoading = true;
    updateLocationSuggestionDom();
    locationInputTimer = setTimeout(async () => {
      try {
        const suggestions = await locationSuggestionCoordinator.run(query.toLowerCase(), () => suggestLocations(query));
        if (sequence !== locationSuggestionSequence) return;
        state.locationSuggestions = suggestions.slice(0, 5);
      } catch {
        if (sequence !== locationSuggestionSequence) return;
        state.locationSuggestions = [];
      } finally {
        if (sequence === locationSuggestionSequence) {
          state.locationSuggestionsLoading = false;
          updateLocationSuggestionDom();
        }
      }
    }, 250);
    return;
  }
  applySituationFilters(`${state.otherNeed} ${state.situation}`);
  if (target.matches('[data-filter-text]')) {
    clearTimeout(filterInputTimer);
    filterInputTimer = setTimeout(() => {
      state.filters[target.dataset.filterText] = target.value;
      render();
    }, 150);
  }
});

window.addEventListener('online', () => {
  state.offline = false;
  render();
});
window.addEventListener('offline', () => {
  state.offline = true;
  render();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
}

render();
