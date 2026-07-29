import { resources as sourceResources } from '../../data/resources.js';
import { normalizeResource } from '../../js/services/resource-service.js';
import { isDisplayableResource } from '../../js/services/resource-quality-service.js';
import {
  locationContext,
  matchesUserLocation
} from '../../js/services/location-eligibility-service.js';

export const SUPPORTED_CHAT_LANGUAGES = Object.freeze(['en', 'es', 'zh']);
export const SUPPORTED_CHAT_INTENTS = Object.freeze([
  'find_local_resource',
  'find_nationwide_program',
  'ask_eligibility',
  'ask_hours',
  'ask_availability',
  'ask_directions',
  'save_resource',
  'remove_saved_resource',
  'compare_resources',
  'registration_help',
  'emergency_or_crisis',
  'general_bridgeaid_question'
]);

const SUPPORTED_CATEGORIES = Object.freeze([
  'all', 'food', 'shelter', 'health', 'mental', 'transport', 'hygiene',
  'jobs', 'education', 'family', 'legal', 'benefits', 'disability',
  'veteran', 'immigration', 'internet'
]);

const MISSING_LOCATION = Object.freeze({
  en: 'What city or ZIP code are you in? I’ll look for verified help near you.',
  es: '¿En qué ciudad o código postal estás? Buscaré ayuda verificada cerca de ti.',
  zh: '您所在的城市或邮政编码是什么？我会查找附近经过核实的援助。'
});

const NO_MATCHES = Object.freeze({
  en: 'I could not find a verified BridgeAid match for that request. Try a different location or need.',
  es: 'No encontré una opción verificada de BridgeAid para esa solicitud. Prueba otra ubicación o necesidad.',
  zh: '我没有找到符合该请求且经过核实的 BridgeAid 资源。请尝试其他地点或援助类型。'
});

export class ChatServiceError extends Error {
  constructor(code, message = code, status = 400) {
    super(message);
    this.name = 'ChatServiceError';
    this.code = code;
    this.status = status;
  }
}

export const CHAT_RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  properties: {
    language: { type: 'string', enum: [...SUPPORTED_CHAT_LANGUAGES, 'unsupported'] },
    intent: { type: 'string', enum: SUPPORTED_CHAT_INTENTS },
    category: {
      anyOf: [
        { type: 'string', enum: SUPPORTED_CATEGORIES },
        { type: 'null' }
      ]
    },
    time: {
      anyOf: [
        { type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' },
        { type: 'null' }
      ]
    },
    urgency: { type: 'string', enum: ['immediate', 'today', 'future', 'none'] },
    location: {
      anyOf: [
        { type: 'string', minLength: 1, maxLength: 120 },
        { type: 'null' }
      ]
    },
    tone: { type: 'string', enum: ['polite', 'neutral', 'urgent'] },
    response: { type: 'string', minLength: 1, maxLength: 900 },
    resourceIds: {
      type: 'array',
      maxItems: 5,
      uniqueItems: true,
      items: { type: 'string', minLength: 1, maxLength: 160 }
    }
  },
  required: [
    'language', 'intent', 'category', 'time', 'urgency', 'location',
    'tone', 'response', 'resourceIds'
  ]
});

function cleanString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function stringArray(value, maxItems = 20, maxLength = 160) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .map(item => cleanString(item, maxLength))
    .filter(Boolean))]
    .slice(0, maxItems);
}

export function validateChatInput(raw = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ChatServiceError('invalid_request', 'Request body must be an object.');
  }
  const message = cleanString(raw.message, 1000);
  if (!message) throw new ChatServiceError('invalid_request', 'A message is required.');
  if (String(raw.message || '').length > 1000) {
    throw new ChatServiceError('message_too_long', 'Message exceeds 1,000 characters.', 413);
  }
  const interfaceLanguage = SUPPORTED_CHAT_LANGUAGES.includes(raw.interfaceLanguage)
    ? raw.interfaceLanguage
    : 'en';
  const mode = raw.mode === 'helper' ? 'helper' : 'self';
  const category = SUPPORTED_CATEGORIES.includes(raw.category) ? raw.category : '';
  const currentPage = ['home', 'find', 'nationwide', 'eligibility', 'saved', 'registration']
    .includes(raw.currentPage) ? raw.currentPage : 'home';
  return {
    message,
    interfaceLanguage,
    mode,
    location: cleanString(raw.location, 120),
    category,
    currentPage,
    activeFilters: stringArray(raw.activeFilters, 12, 60),
    candidateResourceIds: stringArray(raw.candidateResourceIds, 20, 160),
    savedResourceIds: stringArray(raw.savedResourceIds, 20, 160),
    selectedResourceId: cleanString(raw.selectedResourceId, 160)
  };
}

function providerResource(resource) {
  const normalized = normalizeResource(resource, 'en');
  const officialUrl = normalized.registrationUrl
    || normalized.officialWebsite
    || normalized.website
    || normalized.url
    || normalized.sourceUrls?.[0]
    || '';
  return {
    id: normalized.id,
    organizationName: normalized.organizationName || normalized.name,
    programName: normalized.programName || '',
    name: normalized.name,
    category: normalized.category,
    services: normalized.services,
    description: normalized.serviceOffered || normalized.description || '',
    phone: normalized.phone || '',
    address: normalized.address || '',
    serviceArea: normalized.serviceAreas?.join(', ')
      || normalized.nationwideAvailability
      || (normalized.scope === 'location' ? '' : 'United States'),
    hours: normalized.hours || normalized.hoursNote || '',
    source: normalized.source || '',
    officialUrl,
    verificationStatus: normalized.verificationStatus || 'verified source',
    lastVerified: normalized.lastVerified || normalized.verified || '',
    confidence: normalized.confidence
  };
}

export function verifiedChatCandidates(input, resources = sourceResources) {
  const normalized = resources
    .filter(resource => String(resource.id) !== '211')
    .map(resource => normalizeResource(resource, 'en'))
    .filter(isDisplayableResource);
  const byId = new Map(normalized.map(resource => [String(resource.id), resource]));
  const requestedIds = [
    input.selectedResourceId,
    ...input.candidateResourceIds,
    ...input.savedResourceIds
  ].filter(Boolean);
  const hasRequestedCandidates = requestedIds.length > 0;
  let candidates = hasRequestedCandidates
    ? requestedIds.map(id => byId.get(String(id))).filter(Boolean)
    : normalized;
  if (input.category && !hasRequestedCandidates) {
    candidates = candidates.filter(resource => (
      resource.category === 'all'
      || resource.category === input.category
      || resource.services?.includes(input.category)
    ));
  }
  if (input.location) {
    const context = locationContext(input.location);
    candidates = candidates.filter(resource => (
      resource.scope !== 'location'
      || matchesUserLocation(resource, context).serves !== false
    ));
  }
  return [...new Map(candidates.map(resource => [resource.id, resource])).values()]
    .slice(0, 20)
    .map(providerResource);
}

export function buildProviderInput(input, candidates) {
  return {
    userMessage: input.message,
    interfaceLanguage: input.interfaceLanguage,
    bridgeAidContext: {
      currentPage: input.currentPage,
      mode: input.mode,
      savedGeneralLocation: input.location || null,
      selectedCategory: input.category || null,
      activeFilters: input.activeFilters,
      selectedResourceId: input.selectedResourceId || null,
      savedResourceIds: input.savedResourceIds
    },
    verifiedResources: candidates
  };
}

function validateProviderResult(raw, input, candidates) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ChatServiceError('invalid_provider_response', 'Provider response was not an object.', 502);
  }
  if (raw.language === 'unsupported') {
    throw new ChatServiceError('unsupported_language', 'The message language is not supported.', 422);
  }
  if (!SUPPORTED_CHAT_LANGUAGES.includes(raw.language)
    || !SUPPORTED_CHAT_INTENTS.includes(raw.intent)
    || (raw.category !== null && !SUPPORTED_CATEGORIES.includes(raw.category))
    || !['immediate', 'today', 'future', 'none'].includes(raw.urgency)
    || !['polite', 'neutral', 'urgent'].includes(raw.tone)
    || typeof raw.response !== 'string'
    || !raw.response.trim()
    || raw.response.length > 900
    || !Array.isArray(raw.resourceIds)
    || raw.resourceIds.length > 5
    || (raw.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time))
    || (raw.location !== null && (typeof raw.location !== 'string' || raw.location.length > 120))) {
    throw new ChatServiceError('invalid_provider_response', 'Provider response failed validation.', 502);
  }
  const knownIds = new Set(candidates.map(resource => String(resource.id)));
  if (raw.resourceIds.some(id => !knownIds.has(String(id)))) {
    throw new ChatServiceError('invalid_provider_response', 'Provider referenced an unknown resource.', 502);
  }
  const language = raw.language;
  const effectiveLocation = cleanString(raw.location || input.location, 120);
  const needsLocation = raw.intent === 'find_local_resource' && !effectiveLocation;
  const maxRecommendations = input.mode === 'helper' ? 5 : 3;
  const resourceIds = needsLocation ? [] : [...new Set(raw.resourceIds.map(String))].slice(0, maxRecommendations);
  let response = cleanString(raw.response, 900);
  if (needsLocation) response = MISSING_LOCATION[language];
  if (!needsLocation
    && ['find_local_resource', 'find_nationwide_program'].includes(raw.intent)
    && !resourceIds.length) {
    response = NO_MATCHES[language];
  }
  return {
    language,
    intent: raw.intent,
    category: raw.category,
    time: raw.time,
    urgency: raw.urgency,
    location: effectiveLocation || null,
    tone: raw.tone,
    response,
    resourceIds
  };
}

export async function processChatRequest(rawInput, {
  provider,
  resources = sourceResources
} = {}) {
  if (typeof provider !== 'function') {
    throw new ChatServiceError('api_unavailable', 'Chat provider is not configured.', 503);
  }
  const input = validateChatInput(rawInput);
  const candidates = verifiedChatCandidates(input, resources);
  const providerResult = await provider(buildProviderInput(input, candidates));
  return validateProviderResult(providerResult, input, candidates);
}
