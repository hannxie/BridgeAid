import { CHAT_RESPONSE_SCHEMA, ChatServiceError } from './chat-service.js';

const SYSTEM_INSTRUCTIONS = `You are BridgeAI, the concise multilingual resource assistant for BridgeAid.
Detect the dominant language of the latest user message. Support English (en), Spanish (es), and Simplified Chinese (zh); use "unsupported" for other languages.
Interpret intent, service category, explicit time in 24-hour HH:MM form, urgency, and a real location only when the user actually supplied one. Never treat ordinary sentence fragments as locations.
Respond in the same language as the latest user message, regardless of interface language.
Use only verifiedResources supplied in the input. Never invent an organization, program, service, address, schedule, eligibility fact, URL, phone number, or resource ID.
Return resource IDs only from verifiedResources. Preserve official organization and program names.
If local help is requested without a saved or explicit location, ask for a city or ZIP code and return no resource IDs.
If verifiedResources do not contain a match, say so plainly and return no resource IDs.
Keep responses short. In self mode recommend at most three resources. In helper mode provide brief comparison or planning guidance.
Do not infer diagnoses, immigration status, or other sensitive facts.`;

function responseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }
  return '';
}

export function createOpenAIChatProvider({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_CHAT_MODEL || 'gpt-5.6',
  timeoutMs = Number(process.env.OPENAI_CHAT_TIMEOUT_MS || 12000),
  fetchImpl = globalThis.fetch
} = {}) {
  return async function openAIChatProvider(input) {
    if (!apiKey) {
      throw new ChatServiceError('api_unavailable', 'OPENAI_API_KEY is not configured.', 503);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    try {
      const response = await fetchImpl('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          store: false,
          instructions: SYSTEM_INSTRUCTIONS,
          input: JSON.stringify(input),
          max_output_tokens: 900,
          text: {
            format: {
              type: 'json_schema',
              name: 'bridgeaid_chat_response',
              strict: true,
              schema: CHAT_RESPONSE_SCHEMA
            }
          }
        })
      });
      if (!response.ok) {
        throw new ChatServiceError('api_unavailable', `Provider returned HTTP ${response.status}.`, 503);
      }
      const payload = await response.json();
      const output = responseText(payload);
      if (!output) {
        throw new ChatServiceError('invalid_provider_response', 'Provider returned no structured output.', 502);
      }
      try {
        return JSON.parse(output);
      } catch {
        throw new ChatServiceError('invalid_provider_response', 'Provider returned invalid JSON.', 502);
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new ChatServiceError('api_timeout', 'Chat provider timed out.', 504);
      }
      if (error instanceof ChatServiceError) throw error;
      throw new ChatServiceError('api_unavailable', 'Chat provider request failed.', 503);
    } finally {
      clearTimeout(timeout);
    }
  };
}

