const LANGUAGES = new Set(['en', 'es', 'zh']);
const INTENTS = new Set([
  'find_local_resource', 'find_nationwide_program', 'ask_eligibility',
  'ask_hours', 'ask_availability', 'ask_directions', 'save_resource',
  'remove_saved_resource', 'compare_resources', 'registration_help',
  'emergency_or_crisis', 'general_bridgeaid_question'
]);

export class ChatApiError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ChatApiError';
    this.code = code;
  }
}

export function validateChatApiResponse(value) {
  if (!value || typeof value !== 'object'
    || !LANGUAGES.has(value.language)
    || !INTENTS.has(value.intent)
    || typeof value.response !== 'string'
    || !value.response.trim()
    || !Array.isArray(value.resourceIds)
    || value.resourceIds.some(id => typeof id !== 'string')
    || (value.time !== null && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))
    || (value.location !== null && typeof value.location !== 'string')) {
    throw new ChatApiError('invalid_provider_response');
  }
  return {
    language: value.language,
    intent: value.intent,
    category: typeof value.category === 'string' ? value.category : null,
    time: value.time,
    urgency: value.urgency,
    location: value.location,
    tone: value.tone,
    response: value.response,
    resourceIds: [...new Set(value.resourceIds)].slice(0, 5)
  };
}

export async function requestBridgeAI(payload, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000
} = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    let body = {};
    try {
      body = await response.json();
    } catch {
      throw new ChatApiError('invalid_provider_response');
    }
    if (!response.ok) {
      throw new ChatApiError(body?.error?.code || 'api_unavailable');
    }
    return validateChatApiResponse(body);
  } catch (error) {
    if (error?.name === 'AbortError') throw new ChatApiError('api_timeout');
    if (error instanceof ChatApiError) throw error;
    throw new ChatApiError('api_unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

