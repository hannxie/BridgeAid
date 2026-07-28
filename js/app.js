import { categories as legacyCategories, keywordMap, resources as sourceResources } from '../data/resources.js';
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
  readCachedSearch,
  writeCachedSearch,
  mergeDuplicates,
  textFor
} from './services/resource-service.js';
import { geocodeLocation, fetchNearbyResources } from './services/location-service.js';
import { evaluateEligibility, questionsForRules, summarizeEligibility } from './services/eligibility-service.js';
import { registrationSteps } from './services/registration-service.js';
import { routeAssistantRequest } from './services/orchestrator.js';
import { escapeHtml, sanitizePhone, safeExternalUrl } from './services/html-service.js';
import {
  addPlanResource,
  updatePlanStatus,
  updatePlanNote,
  removePlanResource,
  clearPlan as emptyPlan
} from './services/helper-plan-service.js';

const STORAGE = {
  mode: 'bridgeaid-mode',
  location: 'bridgeaid-location',
  helperIntake: 'bridgeaid-helper-intake',
  helperPlan: 'bridgeaid-helper-plan',
  cache: 'bridgeaid-resource-cache',
  searches: 'bridgeaid-saved-searches',
  language: 'ba-lang',
  saved: 'ba-saved'
};

const SELF_CATEGORIES = [
  { id: 'food', icon: '●', en: 'Food today', es: 'Comida hoy', zh: '今天的食物' },
  { id: 'shelter', icon: '⌂', en: 'Sleep tonight', es: 'Dormir esta noche', zh: '今晚住宿' },
  { id: 'safe', icon: '◆', en: 'Safe place', es: 'Lugar seguro', zh: '安全场所' },
  { id: 'health', icon: '+', en: 'Health care', es: 'Atención médica', zh: '医疗保健' },
  { id: 'hygiene', icon: '◌', en: 'Shower or laundry', es: 'Ducha o lavandería', zh: '淋浴或洗衣' },
  { id: 'transport', icon: '→', en: 'Transportation', es: 'Transporte', zh: '交通' },
  { id: 'benefits', icon: '✓', en: 'Benefits', es: 'Beneficios', zh: '福利' },
  { id: 'jobs', icon: '□', en: 'Jobs', es: 'Empleo', zh: '就业' },
  { id: 'legal', icon: '§', en: 'Legal help', es: 'Ayuda legal', zh: '法律帮助' }
];

const EXTRA_CATEGORIES = [
  { id: 'safe', icon: '◆', label: { en: 'Safe place', es: 'Lugar seguro', zh: '安全场所' }, query: 'domestic violence safe place crisis center' },
  { id: 'hygiene', icon: '◌', label: { en: 'Shower & laundry', es: 'Ducha y lavandería', zh: '淋浴和洗衣' }, query: 'free shower laundry hygiene services' }
];

const categories = [...legacyCategories, ...EXTRA_CATEGORIES];

const COPY = {
  en: {
    tagline: 'Trusted help. Clear next steps.',
    selfMode: 'I need help',
    helperMode: 'I’m helping someone',
    switchMode: 'Switch how you are using BridgeAid',
    home: 'Home',
    find: 'Find help',
    saved: 'Saved',
    about: 'Privacy',
    selfHero: 'What do you need right now?',
    selfSub: 'Find free help near you.',
    helperHero: 'Help someone find support.',
    helperSub: 'Answer a few questions to build a resource plan.',
    need: 'What help is needed?',
    needPlaceholder: 'Food today, a safe place, health care…',
    location: 'City, ZIP code, county, neighborhood, address, or landmark',
    search: 'Find resources',
    gps: 'Use my location',
    results: 'Resource results',
    official: 'Official site',
    call: 'Call',
    directions: 'Directions',
    select: 'Select for plan',
    selected: 'In plan',
    compare: 'Compare',
    requirements: 'View requirements',
    eligibility: 'Check eligibility',
    register: 'Registration help',
    report: 'Report incorrect info',
    confirm: 'Confirm availability',
    source: 'Source',
    checked: 'Last verified',
    uncertain: 'Schedule uncertain — call ahead',
    noResults: 'No resources match these filters. Clear a filter or broaden the search.',
    cached: 'Showing saved results while live information is unavailable.',
    stale: 'Saved results may be out of date. Call to confirm.',
    offline: 'You are offline. Saved and national resources are still available.',
    assistantSelf: 'What do you need help with right now?',
    assistantHelper: 'Tell me what the person needs and any limits we should consider.'
  },
  es: {
    tagline: 'Ayuda confiable. Próximos pasos claros.',
    selfMode: 'Necesito ayuda',
    helperMode: 'Estoy ayudando a alguien',
    switchMode: 'Cambiar cómo usa BridgeAid',
    home: 'Inicio',
    find: 'Buscar ayuda',
    saved: 'Guardado',
    about: 'Privacidad',
    selfHero: '¿Qué necesita ahora?',
    selfSub: 'Encuentre ayuda gratuita cerca.',
    helperHero: 'Ayude a alguien a encontrar apoyo.',
    helperSub: 'Responda unas preguntas para crear un plan.',
    need: '¿Qué ayuda se necesita?',
    needPlaceholder: 'Comida hoy, lugar seguro, atención médica…',
    location: 'Ciudad, código postal, condado, barrio, dirección o punto de referencia',
    search: 'Buscar recursos',
    gps: 'Usar mi ubicación',
    results: 'Resultados',
    official: 'Sitio oficial',
    call: 'Llamar',
    directions: 'Direcciones',
    select: 'Añadir al plan',
    selected: 'En el plan',
    compare: 'Comparar',
    requirements: 'Ver requisitos',
    eligibility: 'Revisar elegibilidad',
    register: 'Ayuda para solicitar',
    report: 'Reportar información incorrecta',
    confirm: 'Confirmar disponibilidad',
    source: 'Fuente',
    checked: 'Última verificación',
    uncertain: 'Horario incierto — llame antes',
    noResults: 'Ningún recurso coincide con los filtros.',
    cached: 'Mostrando resultados guardados.',
    stale: 'Los resultados guardados pueden estar desactualizados.',
    offline: 'Está sin conexión. Los recursos guardados siguen disponibles.',
    assistantSelf: '¿Con qué necesita ayuda ahora?',
    assistantHelper: 'Dígame qué necesita la persona y qué límites debemos considerar.'
  },
  zh: {
    tagline: '可信帮助，清晰步骤。',
    selfMode: '我需要帮助',
    helperMode: '我在帮助别人',
    switchMode: '切换使用方式',
    home: '首页',
    find: '寻找帮助',
    saved: '已保存',
    about: '隐私',
    selfHero: '您现在需要什么？',
    selfSub: '查找附近的免费帮助。',
    helperHero: '帮助他人获得支持。',
    helperSub: '回答几个问题，建立资源计划。',
    need: '需要什么帮助？',
    needPlaceholder: '今天的食物、安全场所、医疗…',
    location: '城市、邮编、县、社区、地址或地标',
    search: '查找资源',
    gps: '使用我的位置',
    results: '资源结果',
    official: '官方网站',
    call: '致电',
    directions: '路线',
    select: '加入计划',
    selected: '已加入',
    compare: '比较',
    requirements: '查看要求',
    eligibility: '检查资格',
    register: '申请帮助',
    report: '报告错误信息',
    confirm: '确认可用性',
    source: '来源',
    checked: '最后核实',
    uncertain: '时间不确定——请提前致电',
    noResults: '没有资源符合这些筛选条件。',
    cached: '正在显示保存的结果。',
    stale: '保存的结果可能已过期。',
    offline: '您当前离线。保存的资源仍然可用。',
    assistantSelf: '您现在需要什么帮助？',
    assistantHelper: '请告诉我此人需要什么以及需要考虑的限制。'
  }
};

const emptyFilters = {
  openNow: false,
  availableToday: false,
  walkIn: false,
  noId: false,
  noRegistration: false,
  accessible: false,
  language: '',
  confidence: ''
};

const initialLocation = safeStorageGet(STORAGE.location, safeStorageGet('ba-location', ''));
const state = {
  mode: loadMode(),
  modePromptOpen: false,
  page: 'home',
  lang: ['en', 'es', 'zh'].includes(safeStorageGet(STORAGE.language, 'en')) ? safeStorageGet(STORAGE.language, 'en') : 'en',
  query: '',
  location: typeof initialLocation === 'string' ? initialLocation : '',
  coordinates: null,
  radius: 5,
  category: 'all',
  filters: { ...emptyFilters },
  saved: new Set(Array.isArray(safeStorageGet(STORAGE.saved, [])) ? safeStorageGet(STORAGE.saved, []) : []),
  liveResults: [],
  resolvedLocation: '',
  loading: false,
  error: '',
  cacheNotice: '',
  offline: !navigator.onLine,
  helperIntake: safeObject(STORAGE.helperIntake),
  helperPlan: safeArray(STORAGE.helperPlan),
  compareIds: new Set(),
  selectedResource: null,
  panel: '',
  eligibilityAnswers: {},
  chatOpen: false,
  chatMessages: [],
  storageWarning: ''
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
const t = key => COPY[state.lang]?.[key] || COPY.en[key] || key;
const tx = value => textFor(value, state.lang);
const esc = escapeHtml;
const attr = esc;
const phoneHref = sanitizePhone;
const category = id => categories.find(item => item.id === id) || categories[0];

function safeUrl(value) {
  return safeExternalUrl(value);
}

function persistPreference(key, value) {
  if (!safeStorageSet(key, value)) state.storageWarning = 'Your browser blocked local saving. This session still works, but changes may not persist.';
}

function persistShared() {
  persistPreference(STORAGE.location, state.location);
  persistPreference(STORAGE.language, state.lang);
  persistPreference(STORAGE.saved, [...state.saved]);
}

function persistHelper() {
  persistPreference(STORAGE.helperIntake, state.helperIntake);
  persistPreference(STORAGE.helperPlan, state.helperPlan);
}

function detectCategories(query) {
  const text = String(query || '').toLowerCase();
  const found = Object.entries(keywordMap)
    .filter(([, words]) => words.some(word => text.includes(word)))
    .map(([id]) => id);
  if (/safe|danger|violence|abuse/.test(text)) found.push('safe');
  if (/shower|laundry|hygiene|wash/.test(text)) found.push('hygiene');
  return [...new Set(found)];
}

function staticMatches() {
  const detected = detectCategories(state.query);
  const wanted = state.category !== 'all' ? [state.category] : detected;
  let rows = sourceResources.map(r => normalizeResource(r, state.lang));
  if (wanted.length) {
    rows = rows.filter(r => r.category === 'all' || wanted.includes(r.category) || r.services.some(s => wanted.includes(s)));
  }
  return rankResources(rows, { categories: wanted });
}

function allResults() {
  const combined = mergeDuplicates([...state.liveResults, ...staticMatches()]);
  return filterResources(combined, { ...state.filters, radius: state.radius });
}

function modeSelector() {
  if (state.mode && !state.modePromptOpen) return '';
  return `<div class="mode-overlay" role="dialog" aria-modal="true" aria-labelledby="mode-title">
    <div class="mode-dialog">
      <span class="brand-mark" aria-hidden="true">B</span>
      <p class="eyebrow">BridgeAid</p>
      <h1 id="mode-title">How are you using BridgeAid?</h1>
      <div class="mode-options">
        <button class="mode-option" data-mode="self">
          <span class="mode-icon" aria-hidden="true">●</span>
          <span><strong>I need help</strong><small>Find food, shelter, health care, and other support for yourself.</small></span>
        </button>
        <button class="mode-option" data-mode="helper">
          <span class="mode-icon" aria-hidden="true">◎</span>
          <span><strong>I’m helping someone</strong><small>Find and organize resources for another person.</small></span>
        </button>
      </div>
      ${state.mode ? '<button class="text-btn" data-close-mode>Cancel</button>' : ''}
    </div>
  </div>`;
}

function header() {
  return `<header class="topbar">
    <nav class="wrap nav" aria-label="Main navigation">
      <button class="brand" data-page="home" aria-label="BridgeAid home">
        <span class="logo" aria-hidden="true">B</span>
        <span>BridgeAid<small>${t('tagline')}</small></span>
      </button>
      <button class="mobile-menu" data-menu aria-label="Open menu" aria-expanded="false">☰</button>
      <div class="nav-links" id="navLinks">
        <button data-page="home">${t('home')}</button>
        <button data-page="find">${t('find')}</button>
        <button data-page="saved">${t('saved')} (${state.saved.size})</button>
        <button data-page="about">${t('about')}</button>
      </div>
      <div class="nav-actions">
        <button class="mode-chip" data-switch-mode aria-label="${t('switchMode')}">
          <span aria-hidden="true">${state.mode === 'helper' ? '◎' : '●'}</span>
          ${state.mode === 'helper' ? t('helperMode') : t('selfMode')}
        </button>
        <label class="sr-only" for="language">Language</label>
        <select id="language" aria-label="Language">
          <option value="en" ${state.lang === 'en' ? 'selected' : ''}>English</option>
          <option value="es" ${state.lang === 'es' ? 'selected' : ''}>Español</option>
          <option value="zh" ${state.lang === 'zh' ? 'selected' : ''}>中文</option>
        </select>
      </div>
    </nav>
  </header>`;
}

function emergencyLinks() {
  return `<div class="safety" aria-label="Urgent phone support">
    <a href="tel:911"><strong>911</strong> Immediate danger</a>
    <a href="tel:988"><strong>988</strong> Crisis support</a>
    <a href="tel:211"><strong>211</strong> Local services</a>
  </div>`;
}

function statusMessages() {
  return `<div id="status-region" class="status-stack" aria-live="polite">
    ${state.offline ? `<div class="offline-state">◉ ${t('offline')}</div>` : ''}
    ${state.cacheNotice ? `<div class="cache-state">${esc(state.cacheNotice)}</div>` : ''}
    ${state.storageWarning ? `<div class="error-state">${esc(state.storageWarning)}</div>` : ''}
    ${state.error ? `<div class="error-state">${esc(state.error)}</div>` : ''}
  </div>`;
}

function searchBox(compact = false) {
  return `<form id="searchForm" class="search-box ${compact ? 'compact' : ''}" novalidate>
    <label>
      <span>${t('need')}</span>
      <input id="needInput" name="need" value="${attr(state.query)}" placeholder="${attr(t('needPlaceholder'))}" autocomplete="off">
    </label>
    <label>
      <span>${t('location')}</span>
      <input id="locationInput" name="location" value="${attr(state.location)}" placeholder="${attr(t('location'))}" autocomplete="postal-code" aria-describedby="location-privacy">
      <small id="location-privacy">A general location is enough. Exact GPS coordinates are not saved.</small>
    </label>
    <label class="radius-control">
      <span>Search radius</span>
      <select id="radius" name="radius">
        ${[1, 5, 10, 25].map(value => `<option value="${value}" ${state.radius === value ? 'selected' : ''}>${value} mile${value === 1 ? '' : 's'}</option>`).join('')}
      </select>
    </label>
    <button type="button" class="secondary" data-gps>◎ ${t('gps')}</button>
    <button class="primary" type="submit">⌕ ${t('search')}</button>
  </form>`;
}

function selfCategoryButtons() {
  return `<div class="category-grid urgent-categories">
    ${SELF_CATEGORIES.map(item => `<button class="category" data-category="${item.id}">
      <span aria-hidden="true">${item.icon}</span><strong>${esc(item[state.lang] || item.en)}</strong>
    </button>`).join('')}
  </div>`;
}

function helperIntake() {
  const f = (name, label, type = 'text', options = []) => {
    const value = state.helperIntake[name] ?? '';
    if (type === 'select') {
      return `<label><span>${label} <small>Optional</small></span><select name="${name}" data-intake>
        <option value="">Choose only if relevant</option>
        ${options.map(option => `<option value="${attr(option)}" ${value === option ? 'selected' : ''}>${esc(option)}</option>`).join('')}
      </select></label>`;
    }
    return `<label><span>${label} <small>Optional</small></span><input name="${name}" value="${attr(value)}" data-intake></label>`;
  };
  const restrictions = ['familyRestrictions', 'petRestrictions', 'genderRestrictions', 'ageRestrictions', 'sobrietyRestrictions'];
  return `<section class="intake-card" aria-labelledby="intake-title">
    <div class="section-head">
      <div><span class="step-label">Guided intake · optional until search</span><h2 id="intake-title">What should the plan account for?</h2></div>
      <button class="text-btn" data-clear-intake>Clear intake</button>
    </div>
    <p class="privacy-notice">Only enter information you have permission to use. Notes stay on this device.</p>
    <p class="helper-explanation">These questions help filter practical restrictions. Do not enter names, Social Security numbers, medical or immigration document numbers, banking information, passwords, or photos of identification.</p>
    <div class="intake-grid">
      ${f('immediateNeed', 'Immediate need')}
      ${f('location', 'City or ZIP code')}
      ${f('safetyTonight', 'Safety tonight', 'select', ['Safe tonight', 'Not safe tonight', 'Unsure'])}
      ${f('ageGroup', 'Age group', 'select', ['Child', 'Teen', 'Adult', 'Older adult'])}
      ${f('childrenInvolved', 'Children involved', 'select', ['Yes', 'No', 'Unsure'])}
      ${f('veteranStatus', 'Veteran status', 'select', ['Yes', 'No', 'Prefer not to say'])}
      ${f('identification', 'Identification available', 'select', ['Yes', 'No', 'Some documents'])}
      ${f('transportation', 'Transportation available', 'select', ['Walking only', 'Transit', 'Car', 'Needs a ride'])}
      ${f('phoneAccess', 'Phone access', 'select', ['Reliable', 'Limited', 'No phone'])}
      ${f('accessibility', 'Accessibility needs')}
      ${f('preferredLanguage', 'Preferred language')}
      ${restrictions.map(name => f(name, name.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()))).join('')}
    </div>
    <label class="notes-field"><span>Additional notes <small>Optional — stored on this device</small></span>
      <textarea name="notes" data-intake rows="3">${esc(state.helperIntake.notes || '')}</textarea>
    </label>
    ${state.helperIntake.safetyTonight === 'Not safe tonight' ? `<div class="danger-notice"><strong>If there is immediate danger, call 911. For crisis support, call or text 988.</strong></div>` : ''}
    <button class="primary" data-helper-search>Build resource options</button>
  </section>`;
}

function homePage() {
  const helper = state.mode === 'helper';
  return `<main id="main">
    <section class="hero ${helper ? 'helper-hero' : ''}">
      <div class="wrap">
        <span class="eyebrow">${helper ? 'Helper workspace' : 'Help near you'}</span>
        <h1>${helper ? t('helperHero') : t('selfHero')}</h1>
        <p>${helper ? t('helperSub') : t('selfSub')}</p>
        ${helper ? '' : searchBox()}
        ${emergencyLinks()}
      </div>
    </section>
    ${statusMessages()}
    ${helper ? `<div class="wrap section helper-layout"><div>${helperIntake()}</div>${planPanel(true)}</div>` : `
      <section class="wrap section" aria-labelledby="need-categories">
        <div class="section-head"><h2 id="need-categories">Choose what you need</h2></div>
        ${selfCategoryButtons()}
      </section>`}
    <section class="wrap section">
      <div class="section-head"><div><span class="step-label">Verified starting points</span><h2>Trusted national resources</h2></div><button class="text-btn" data-page="find">See all</button></div>
      <div class="resource-list">${staticMatches().slice(0, helper ? 3 : 4).map(resourceCard).join('')}</div>
    </section>
  </main>`;
}

function filtersPanel() {
  const check = (name, label) => `<label class="filter-check"><input type="checkbox" data-filter="${name}" ${state.filters[name] ? 'checked' : ''}><span>${label}</span></label>`;
  return `<details class="filters-panel">
    <summary>Filter these results</summary>
    <div class="filter-grid">
      ${check('openNow', 'Open now')}
      ${check('availableToday', 'Available today')}
      ${check('walkIn', 'Walk-ins accepted')}
      ${check('noId', 'No identification required')}
      ${check('noRegistration', 'No registration required')}
      ${check('accessible', 'Wheelchair accessible')}
      <label><span>Language offered</span><input data-filter-text="language" value="${attr(state.filters.language)}" placeholder="Example: Spanish"></label>
      <label><span>Minimum confidence</span><select data-filter-text="confidence">
        <option value="">Any confidence</option>
        <option value="0.5" ${state.filters.confidence === '0.5' ? 'selected' : ''}>50%+</option>
        <option value="0.75" ${state.filters.confidence === '0.75' ? 'selected' : ''}>75%+</option>
      </select></label>
      <button class="ghost" data-clear-filters>Clear filters</button>
    </div>
  </details>`;
}

function availabilityBadge(resource) {
  const label = resource.availabilityStatus || t('uncertain');
  const className = /open now|available today/i.test(label) ? 'confirmed' : /uncertain|needs confirmation/i.test(label) ? 'uncertain' : '';
  return `<span class="verification-badge ${className}"><span aria-hidden="true">${className === 'confirmed' ? '✓' : '!'}</span>${esc(label)}</span>`;
}

function metadata(resource) {
  const entries = [
    ['Distance', resource.distance !== null ? `${resource.distance.toFixed(1)} miles` : ''],
    ['Next available', resource.nextEvent],
    ['Walk-in / appointment', resource.walkInStatus || resource.appointmentRequirement],
    ['Eligibility', resource.eligibilitySummary],
    ['Documents', resource.requiredDocuments.join(', ')],
    ['Registration', resource.registrationRequirement],
    ['Accessibility', resource.accessibility.join(', ')],
    ['Languages', resource.languages.join(', ')],
    ['Transportation', resource.transportation.join(', ')]
  ].filter(([, value]) => value);
  if (!entries.length) return '';
  return `<dl class="resource-meta">${entries.map(([label, value]) => `<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')}</dl>`;
}

function sourceDetails(resource) {
  const sourceLinks = resource.sourceUrls
    .map(url => safeUrl(url))
    .filter(Boolean)
    .map((url, index) => `<a href="${attr(url)}" target="_blank" rel="noopener noreferrer">Source ${index + 1}</a>`)
    .join(' · ');
  return `<div class="source-details">
    <span><strong>${t('source')}:</strong> ${esc(resource.source)}</span>
    ${resource.lastVerified ? `<span><strong>${t('checked')}:</strong> ${esc(resource.lastVerified)}</span>` : ''}
    ${resource.confidence !== null ? `<span><strong>Confidence:</strong> ${Math.round(resource.confidence * 100)}% (not a guarantee)</span>` : ''}
    ${sourceLinks ? `<span>${sourceLinks}</span>` : ''}
    ${resource.conflicts.length ? `<span class="conflict"><strong>Conflicting information:</strong> ${esc(resource.conflicts.join(' · '))}</span>` : ''}
  </div>`;
}

function resourceCard(raw) {
  const resource = normalizeResource(raw, state.lang);
  const inPlan = state.helperPlan.some(item => item.id === resource.id);
  const compared = state.compareIds.has(resource.id);
  const site = safeUrl(resource.officialWebsite || resource.website);
  const directions = resource.latitude !== null
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${resource.latitude},${resource.longitude}`)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${resource.name} ${resource.address || state.location}`)}`;
  return `<article class="resource-card" data-resource-card="${attr(resource.id)}">
    <div class="card-top">
      <span class="tag">${esc(category(resource.category).icon)} ${esc(tx(category(resource.category).label))}</span>
      ${availabilityBadge(resource)}
    </div>
    <div>
      <h3>${esc(resource.name)}</h3>
      ${resource.programName ? `<p class="program-name">${esc(resource.programName)}</p>` : ''}
    </div>
    ${resource.description ? `<p class="description">${esc(resource.description)}</p>` : ''}
    ${metadata(resource)}
    <details class="fact-details">
      <summary>Facts, uncertainty, and sources</summary>
      ${sourceDetails(resource)}
      ${resource.verificationStatus ? `<p><strong>Verification:</strong> ${esc(resource.verificationStatus)}</p>` : ''}
      <p class="ai-label"><strong>BridgeAid summary:</strong> ${esc(resource.eligibilitySummary || 'Eligibility details are not published in a structured form.')} Confirm with the organization.</p>
    </details>
    <div class="card-actions action-priority">
      ${resource.phone ? `<a class="primary" href="tel:${attr(phoneHref(resource.phone))}">☎ ${t('call')}</a>` : ''}
      <a class="secondary" href="${attr(directions)}" target="_blank" rel="noopener noreferrer">⌖ ${t('directions')}</a>
      ${site ? `<a class="ghost" href="${attr(site)}" target="_blank" rel="noopener noreferrer">${t('official')} ↗</a>` : ''}
    </div>
    <div class="card-actions card-tools">
      <button class="text-action" data-resource-action="requirements" data-id="${attr(resource.id)}">${t('requirements')}</button>
      <button class="text-action" data-resource-action="eligibility" data-id="${attr(resource.id)}">${t('eligibility')}</button>
      <button class="text-action" data-resource-action="registration" data-id="${attr(resource.id)}">${t('register')}</button>
      ${state.mode === 'helper' ? `
        <button class="text-action" data-add-plan="${attr(resource.id)}" aria-pressed="${inPlan}">${inPlan ? `✓ ${t('selected')}` : `+ ${t('select')}`}</button>
        <button class="text-action" data-compare="${attr(resource.id)}" aria-pressed="${compared}">${compared ? '✓ ' : ''}${t('compare')}</button>
        <button class="text-action" data-confirm-reminder="${attr(resource.id)}">${t('confirm')}</button>
      ` : ''}
      <button class="text-action" data-report="${attr(resource.id)}">${t('report')}</button>
      <button class="text-action" data-save="${attr(resource.id)}" aria-pressed="${state.saved.has(resource.id)}">${state.saved.has(resource.id) ? '★ Saved' : '☆ Save'}</button>
    </div>
  </article>`;
}

function comparisonPanel(resources) {
  const selected = resources.filter(resource => state.compareIds.has(resource.id)).slice(0, 3);
  if (state.mode !== 'helper' || !selected.length) return '';
  return `<section class="comparison-panel" aria-labelledby="compare-title">
    <div class="section-head"><h2 id="compare-title">Compare resources</h2><button class="text-btn" data-clear-compare>Clear comparison</button></div>
    <div class="comparison-scroll"><table>
      <thead><tr><th>Resource</th><th>Availability</th><th>Eligibility</th><th>Distance</th><th>Source</th></tr></thead>
      <tbody>${selected.map(r => `<tr><th>${esc(r.name)}</th><td>${esc(r.availabilityStatus)}</td><td>${esc(r.eligibilitySummary || 'Confirm')}</td><td>${r.distance !== null ? `${r.distance.toFixed(1)} mi` : 'Not available'}</td><td>${esc(r.source)}</td></tr>`).join('')}</tbody>
    </table></div>
  </section>`;
}

function resultsPage() {
  const resources = allResults();
  const helper = state.mode === 'helper';
  return `<main id="main" class="wrap section page">
    <div class="page-head">
      <div><span class="eyebrow">${helper ? 'Helper workspace' : 'Help near you'}</span><h1>${t('results')}</h1>
      <p>${state.query ? `“${esc(state.query)}”` : 'All trusted resources'}${state.location ? ` near ${esc(state.location)}` : ''}</p></div>
      ${emergencyLinks()}
    </div>
    ${statusMessages()}
    ${searchBox(true)}
    ${filtersPanel()}
    ${state.loading ? `<div class="loading-state" role="status"><span class="spinner" aria-hidden="true"></span><strong>Checking saved and live resources…</strong></div>` : ''}
    ${comparisonPanel(resources)}
    <div class="${helper ? 'results-layout' : ''}">
      <section aria-labelledby="resource-list-title">
        <div class="section-head"><h2 id="resource-list-title">${resources.length} resource${resources.length === 1 ? '' : 's'}</h2><small>Every result includes a traceable source.</small></div>
        <div class="resource-list">${resources.length ? resources.map(resourceCard).join('') : `<div class="empty-state">${t('noResults')}</div>`}</div>
      </section>
      ${helper ? planPanel(false) : ''}
    </div>
  </main>`;
}

function planText() {
  const created = state.helperPlan[0]?.planCreated || new Date().toISOString();
  const lines = [
    'BridgeAid resource plan',
    `Created: ${new Date(created).toLocaleString()}`,
    `Updated: ${new Date().toLocaleString()}`,
    `Need: ${state.helperIntake.immediateNeed || state.query || 'Not entered'}`,
    `Location: ${state.helperIntake.location || state.location || 'Not entered'}`,
    '',
    ...state.helperPlan.flatMap((item, index) => [
      `${index + 1}. ${item.name}`,
      item.phone ? `Phone: ${item.phone}` : '',
      item.website ? `Official link: ${item.website}` : '',
      item.directions ? `Directions: ${item.directions}` : '',
      `Status: ${item.status || 'Not contacted'}`,
      item.eligibilitySummary ? `Eligibility: ${item.eligibilitySummary}` : '',
      item.registrationRequirement ? `Registration: ${item.registrationRequirement}` : '',
      item.requiredDocuments?.length ? `Documents: ${item.requiredDocuments.join(', ')}` : '',
      item.note ? `Note: ${item.note}` : '',
      'Next step: Confirm eligibility and availability with the organization.',
      ''
    ].filter(Boolean))
  ];
  return lines.join('\n');
}

function planPanel(home = false) {
  const created = state.helperPlan[0]?.planCreated;
  return `<aside class="plan-panel ${home ? 'home-plan' : ''}" aria-labelledby="plan-title">
    <div class="section-head">
      <div><span class="step-label">Local plan · ${state.helperPlan.length} selected</span><h2 id="plan-title">Resource plan</h2></div>
    </div>
    <p><strong>Need:</strong> ${esc(state.helperIntake.immediateNeed || state.query || 'Not entered')}</p>
    <p><strong>Location:</strong> ${esc(state.helperIntake.location || state.location || 'Not entered')}</p>
    ${created ? `<p class="plan-time">Created ${esc(new Date(created).toLocaleString())}<br>Updated ${esc(new Date().toLocaleString())}</p>` : ''}
    <div class="plan-items">
      ${state.helperPlan.length ? state.helperPlan.map(planItem).join('') : '<p class="empty-plan">Select resources to build a plan. Notes and status stay on this device.</p>'}
    </div>
    <div class="plan-actions">
      <button class="secondary" data-copy-plan ${state.helperPlan.length ? '' : 'disabled'}>Copy plain text</button>
      <button class="ghost" data-print-plan ${state.helperPlan.length ? '' : 'disabled'}>Print</button>
      <button class="danger-button" data-clear-plan ${state.helperPlan.length || Object.keys(state.helperIntake).length ? '' : 'disabled'}>Clear this plan</button>
    </div>
    <p class="storage-note">Browser storage is not encrypted. Anyone with access to this device and browser profile may be able to read this plan.</p>
  </aside>`;
}

function planItem(item) {
  return `<article class="plan-item">
    <div><h3>${esc(item.name)}</h3>${item.phone ? `<a href="tel:${attr(phoneHref(item.phone))}">${esc(item.phone)}</a>` : ''}</div>
    <label>Status<select data-plan-status="${attr(item.id)}">
      ${['Not contacted', 'Called', 'Confirmed', 'Unavailable'].map(status => `<option ${item.status === status ? 'selected' : ''}>${status}</option>`).join('')}
    </select></label>
    <label>Local note<textarea rows="2" data-plan-note="${attr(item.id)}" placeholder="Short note — saved on this device">${esc(item.note || '')}</textarea></label>
    <button class="text-action" data-remove-plan="${attr(item.id)}">Remove</button>
  </article>`;
}

function savedPage() {
  const all = [...state.liveResults, ...sourceResources].map(r => normalizeResource(r, state.lang));
  const saved = all.filter(r => state.saved.has(r.id));
  return `<main id="main" class="wrap section page"><div class="page-head"><h1>Saved resources</h1>${emergencyLinks()}</div>
    <div class="resource-list">${saved.length ? saved.map(resourceCard).join('') : '<div class="empty-state">No saved resources yet.</div>'}</div></main>`;
}

function privacyPage() {
  return `<main id="main" class="wrap section page about">
    <span class="eyebrow">Privacy and limits</span>
    <h1>Your information stays under your control.</h1>
    <p class="lead">BridgeAid stores the selected mode, general location, language, saved resources, cached searches, and helper plan in this browser. Helper notes are not encrypted. Exact GPS coordinates and eligibility answers are not saved.</p>
    <div class="about-grid">
      <article><h2>1</h2><h3>Location</h3><p>GPS is requested only after you choose it. Coordinates are used for the current search and are not written to storage.</p><button class="ghost" data-clear-location>Clear saved location</button></article>
      <article><h2>2</h2><h3>Eligibility</h3><p>Answers are kept only in memory for this tab and can be cleared at any time.</p><button class="ghost" data-clear-eligibility>Clear eligibility answers</button></article>
      <article><h2>3</h2><h3>Plans and searches</h3><p>Plans, notes, saved resources, and cached searches stay on this device.</p><button class="danger-button" data-clear-private>Clear local BridgeAid data</button></article>
    </div>
    <div class="notice"><strong>Always confirm.</strong> BridgeAid does not guarantee eligibility, appointments, capacity, funding, supplies, beds, or service availability.</div>
    ${emergencyLinks()}
  </main>`;
}

function sidePanel() {
  if (!state.panel || !state.selectedResource) return '';
  const resource = normalizeResource(state.selectedResource, state.lang);
  const eligibility = summarizeEligibility(resource);
  let body = '';
  if (state.panel === 'requirements') {
    body = `<h2 id="panel-title">Requirements</h2><p>${esc(eligibility.summary || 'Published requirements are incomplete.')}</p>
      ${resource.requiredDocuments.length ? `<h3>Documents</h3><ul>${resource.requiredDocuments.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
      <p><strong>Source:</strong> ${resource.sourceUrls[0] ? `<a href="${attr(safeUrl(resource.sourceUrls[0]))}" target="_blank" rel="noopener noreferrer">Review full source</a>` : 'No separate requirements page published'}</p>
      <p>${eligibility.disclaimer}</p>`;
  }
  if (state.panel === 'eligibility') {
    const rules = resource.eligibilityRules;
    const questions = questionsForRules(rules, state.eligibilityAnswers);
    const result = evaluateEligibility(rules, state.eligibilityAnswers);
    body = `<h2 id="panel-title">Preliminary eligibility check</h2>
      <p>${esc(eligibility.summary || 'Published rules are incomplete.')}</p>
      ${questions.slice(0, 3).map(q => `<label>${esc(q.question)}<input data-eligibility-answer="${attr(q.field)}"></label>`).join('')}
      <div class="eligibility-result"><strong>${esc(result.status)}</strong><ul>${result.reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul>
      ${result.missing.length ? `<p>Missing: ${esc(result.missing.join(', '))}</p>` : ''}</div>
      <p>Only the organization can make a final decision.</p><button class="ghost" data-clear-eligibility>Clear answers</button>`;
  }
  if (state.panel === 'registration') {
    const guide = registrationSteps(resource);
    body = `<h2 id="panel-title">Registration help</h2><ol>${guide.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>
      ${guide.formUrl ? `<a class="primary" href="${attr(guide.formUrl)}" target="_blank" rel="noopener noreferrer">Open verified official form</a>` : ''}
      <p class="danger-notice">${esc(guide.warning)}</p>
      <details><summary>Calling script</summary><p>“Hi, I’m calling about ${esc(resource.name)}. Could you confirm who qualifies, what documents are needed, and how to register?”</p></details>`;
  }
  return `<div class="drawer-backdrop" data-close-panel><section class="side-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" data-panel-content>
    <button class="drawer-close" data-close-panel aria-label="Close panel">×</button>${body}</section></div>`;
}

function chat() {
  const opening = state.mode === 'helper' ? t('assistantHelper') : t('assistantSelf');
  return `<button class="chat-launcher" data-chat aria-expanded="${state.chatOpen}">BridgeAI <span aria-hidden="true">${state.chatOpen ? '×' : '✦'}</span></button>
    ${state.chatOpen ? `<section class="chat-panel" aria-label="BridgeAI assistant">
      <div class="chat-head"><strong>BridgeAI</strong><small>One assistant · verified sources only</small></div>
      <div class="chat-messages" aria-live="polite"><p class="assistant-message">${esc(opening)}</p>
        ${state.chatMessages.map(message => `<p class="${message.role}-message">${esc(message.text)}</p>`).join('')}
      </div>
      <form id="chatForm"><label class="sr-only" for="chatInput">Message BridgeAI</label><input id="chatInput" placeholder="${attr(opening)}"><button class="primary">Send</button></form>
    </section>` : ''}`;
}

function footer() {
  return `<footer><div class="wrap"><strong>BridgeAid</strong><br><small>Confirm availability and eligibility directly with organizations. Local browser storage is not encrypted.</small></div></footer>`;
}

function render({ focus = '' } = {}) {
  document.documentElement.lang = state.lang === 'zh' ? 'zh-Hans' : state.lang;
  const page = state.page === 'home' ? homePage() : state.page === 'find' ? resultsPage() : state.page === 'saved' ? savedPage() : privacyPage();
  app.innerHTML = `${header()}${page}${footer()}${chat()}${sidePanel()}${modeSelector()}`;
  if (focus) requestAnimationFrame(() => document.querySelector(focus)?.focus());
}

function resourceById(id) {
  return [...state.liveResults, ...sourceResources].map(r => normalizeResource(r, state.lang)).find(r => r.id === id);
}

function addToPlan(id) {
  const resource = resourceById(id);
  if (!resource) return;
  const existing = state.helperPlan.find(item => item.id === id);
  if (existing) {
    state.helperPlan = state.helperPlan.filter(item => item.id !== id);
  } else {
    const directions = resource.latitude !== null
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${resource.latitude},${resource.longitude}`)}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${resource.name} ${state.location}`)}`;
    state.helperPlan = addPlanResource(state.helperPlan, { ...resource, directions });
  }
  persistHelper();
  render();
}

async function searchNearby({ coordinates = null } = {}) {
  state.error = '';
  state.cacheNotice = '';
  state.loading = true;
  render();
  const key = cacheKey(state.location, state.category, state.radius);
  const cache = safeObject(STORAGE.cache);
  const cached = readCachedSearch(cache, key);
  if (cached) {
    state.liveResults = cached.resources;
    state.cacheNotice = cached.stale ? t('stale') : 'Showing saved results while checking for updates.';
    render();
  }
  if (state.offline) {
    state.loading = false;
    if (cached) state.cacheNotice = t('cached');
    render();
    return;
  }
  try {
    const point = coordinates || await geocodeLocation(state.location);
    state.coordinates = { lat: point.lat, lng: point.lng };
    state.resolvedLocation = point.label || state.location;
    let rows = await fetchNearbyResources({ lat: point.lat, lng: point.lng, radius: state.radius });
    const desired = state.category !== 'all' ? [state.category] : detectCategories(state.query);
    if (desired.length) rows = rows.filter(r => desired.includes(r.category));
    rows = rankResources(mergeDuplicates(rows), { categories: desired }).slice(0, 50);
    state.liveResults = rows;
    const nextCache = writeCachedSearch(cache, key, rows);
    persistPreference(STORAGE.cache, nextCache);
    persistPreference(STORAGE.searches, [...new Set([...safeArray(STORAGE.searches), state.location])].slice(-10));
    state.cacheNotice = cached ? 'Saved results were refreshed.' : '';
  } catch (error) {
    state.error = cached
      ? `${error.message || 'Live search failed'} Saved results are still shown.`
      : error.message || 'Live search failed. National directories are still available.';
    if (cached) state.cacheNotice = t('cached');
  } finally {
    state.loading = false;
    render();
  }
}

function submitSearch(form) {
  const data = new FormData(form);
  state.query = String(data.get('need') || '').trim();
  state.location = String(data.get('location') || '').trim();
  state.radius = Number(data.get('radius')) || 5;
  state.coordinates = null;
  const detected = detectCategories(state.query);
  state.category = detected.length === 1 ? detected[0] : 'all';
  state.page = 'find';
  persistShared();
  render();
  if (state.location) searchNearby();
  else {
    state.error = 'Add a general location to search nearby. National resources are still shown.';
    render({ focus: '#locationInput' });
  }
}

function clearPlan() {
  const cleared = emptyPlan();
  state.helperPlan = cleared.plan;
  state.helperIntake = cleared.intake;
  persistHelper();
  render();
}

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
    render({ focus: '#main' });
    scrollTo(0, 0);
  }
  if (target.matches('[data-menu]')) {
    const links = document.querySelector('#navLinks');
    links.classList.toggle('open');
    target.setAttribute('aria-expanded', String(links.classList.contains('open')));
  }
  if (target.matches('[data-category]')) {
    state.category = target.dataset.category;
    state.query = SELF_CATEGORIES.find(item => item.id === state.category)?.en || tx(category(state.category).label);
    state.page = 'find';
    persistShared();
    render({ focus: '#main' });
    if (state.location) searchNearby();
  }
  if (target.matches('[data-gps]')) {
    if (!navigator.geolocation) {
      state.error = 'Location services are unavailable. Enter a city or ZIP code instead.';
      render();
      return;
    }
    target.disabled = true;
    target.textContent = 'Requesting permission…';
    navigator.geolocation.getCurrentPosition(
      position => {
        state.location = 'Current area';
        state.page = 'find';
        persistShared();
        searchNearby({ coordinates: { lat: position.coords.latitude, lng: position.coords.longitude } });
      },
      error => {
        state.error = error.code === 3
          ? 'Location request timed out. Enter a city or ZIP code instead.'
          : 'Location permission was not granted. Manual location search still works.';
        render({ focus: '#locationInput' });
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
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
  if (target.matches('[data-save]')) {
    const id = target.dataset.save;
    state.saved.has(id) ? state.saved.delete(id) : state.saved.add(id);
    persistShared();
    render();
  }
  if (target.matches('[data-resource-action]')) {
    state.selectedResource = resourceById(target.dataset.id);
    state.panel = target.dataset.resourceAction;
    render({ focus: '.drawer-close' });
  }
  if (target.matches('[data-close-panel]') && !event.target.closest('[data-panel-content]')) {
    state.panel = '';
    state.selectedResource = null;
    render();
  }
  if (target.matches('.drawer-close')) {
    state.panel = '';
    state.selectedResource = null;
    render();
  }
  if (target.matches('[data-confirm-reminder]')) {
    const item = resourceById(target.dataset.confirmReminder);
    state.chatOpen = true;
    state.chatMessages.push({ role: 'assistant', text: `Reminder: call ${item?.name || 'the organization'} to confirm availability before traveling.` });
    render();
  }
  if (target.matches('[data-report]')) {
    const item = resourceById(target.dataset.report);
    const source = item?.sourceUrls?.[0] || item?.officialWebsite;
    if (source) window.open(source, '_blank', 'noopener,noreferrer');
    else {
      state.error = 'No correction contact is published. Call the organization and note the correction locally.';
      render();
    }
  }
  if (target.matches('[data-helper-search]')) {
    state.query = state.helperIntake.immediateNeed || '';
    state.location = state.helperIntake.location || state.location;
    if (!state.query || !state.location) {
      state.error = 'Immediate need and location are required to build resource options.';
      render();
      return;
    }
    state.category = detectCategories(state.query)[0] || 'all';
    state.page = 'find';
    persistShared();
    persistHelper();
    render();
    searchNearby();
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
  if (target.matches('[data-clear-plan]')) clearPlan();
  if (target.matches('[data-copy-plan]')) {
    try {
      await navigator.clipboard.writeText(planText());
      state.cacheNotice = 'Plan copied as plain text.';
    } catch {
      state.error = 'Copy failed. Select the plan text after choosing Print, or copy each item manually.';
    }
    render();
  }
  if (target.matches('[data-print-plan]')) window.print();
  if (target.matches('[data-clear-filters]')) {
    state.filters = { ...emptyFilters };
    render();
  }
  if (target.matches('[data-clear-location]')) {
    state.location = '';
    state.coordinates = null;
    safeStorageRemove(STORAGE.location);
    safeStorageRemove('ba-coords');
    render();
  }
  if (target.matches('[data-clear-eligibility]')) {
    state.eligibilityAnswers = {};
    render();
  }
  if (target.matches('[data-clear-private]')) {
    clearPrivateData();
    state.location = '';
    state.coordinates = null;
    state.helperIntake = {};
    state.helperPlan = [];
    state.liveResults = [];
    render();
  }
  if (target.matches('[data-chat]')) {
    state.chatOpen = !state.chatOpen;
    render({ focus: state.chatOpen ? '#chatInput' : '[data-chat]' });
  }
});

app.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.matches('#searchForm')) submitSearch(event.target);
  if (event.target.matches('#chatForm')) {
    const input = event.target.querySelector('#chatInput');
    const question = input.value.trim();
    if (!question) return;
    state.chatMessages.push({ role: 'user', text: question });
    const response = routeAssistantRequest({
      question,
      mode: state.mode,
      resources: allResults(),
      intake: state.helperIntake,
      selectedResource: state.selectedResource
    });
    state.chatMessages.push({ role: 'assistant', text: response.message });
    render({ focus: '#chatInput' });
  }
});

app.addEventListener('change', event => {
  const target = event.target;
  if (target.matches('#language')) {
    state.lang = target.value;
    persistShared();
    render();
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
  if (target.matches('[data-plan-status]')) {
    state.helperPlan = updatePlanStatus(state.helperPlan, target.dataset.planStatus, target.value);
    persistHelper();
    render();
  }
  if (target.matches('[data-plan-note]')) {
    state.helperPlan = updatePlanNote(state.helperPlan, target.dataset.planNote, target.value);
    persistHelper();
  }
  if (target.matches('[data-eligibility-answer]')) {
    state.eligibilityAnswers[target.dataset.eligibilityAnswer] = target.value;
    render({ focus: `[data-eligibility-answer="${target.dataset.eligibilityAnswer}"]` });
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
