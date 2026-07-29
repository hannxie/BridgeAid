import test from 'node:test';
import assert from 'node:assert/strict';
import {
  processChatRequest,
  validateChatInput,
  ChatServiceError
} from '../server/services/chat-service.js';
import { createOpenAIChatProvider } from '../server/services/openai-chat-provider.js';
import { createRateLimiter, createBridgeAidServer } from '../server/index.js';
import {
  requestBridgeAI,
  validateChatApiResponse,
  ChatApiError
} from '../js/services/chat-api-service.js';

const multilingualCases = [
  {
    message: 'I need food at 7 in the morning.',
    language: 'en',
    response: 'What city or ZIP code are you in?'
  },
  {
    message: 'Quiero comer a las siete en la mañana, por favor.',
    language: 'es',
    response: '¿En qué ciudad o código postal estás?'
  },
  {
    message: '我早上七点想找吃的。',
    language: 'zh',
    response: '您所在的城市或邮政编码是什么？'
  }
];

for (const example of multilingualCases) {
  test(`structured chat preserves ${example.language} and extracts food at 07:00`, async () => {
    let providerInput;
    const result = await processChatRequest({
      message: example.message,
      interfaceLanguage: 'en',
      mode: 'self',
      location: '',
      category: '',
      currentPage: 'find',
      candidateResourceIds: ['feeding-america']
    }, {
      provider: async input => {
        providerInput = input;
        return {
          language: example.language,
          intent: 'find_local_resource',
          category: 'food',
          time: '07:00',
          urgency: 'today',
          location: null,
          tone: example.language === 'es' ? 'polite' : 'neutral',
          response: example.response,
          resourceIds: []
        };
      }
    });
    assert.equal(providerInput.userMessage, example.message);
    assert.equal(result.language, example.language);
    assert.equal(result.category, 'food');
    assert.equal(result.time, '07:00');
    assert.equal(result.location, null);
    assert.deepEqual(result.resourceIds, []);
    assert.match(result.response, new RegExp(
      example.response.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ));
    assert.doesNotMatch(String(result.location), /mañana|por favor|早上/);
  });
}

test('chat rejects resource IDs that are absent from verified candidates', async () => {
  await assert.rejects(
    processChatRequest({
      message: 'Find food',
      interfaceLanguage: 'en',
      mode: 'self',
      location: '98101',
      category: 'food',
      candidateResourceIds: ['feeding-america']
    }, {
      provider: async () => ({
        language: 'en',
        intent: 'find_local_resource',
        category: 'food',
        time: null,
        urgency: 'none',
        location: '98101',
        tone: 'neutral',
        response: 'Here is a result.',
        resourceIds: ['fabricated-resource']
      })
    }),
    error => error instanceof ChatServiceError
      && error.code === 'invalid_provider_response'
  );
});

test('chat input validation limits messages and removes private unrecognized fields', () => {
  assert.throws(
    () => validateChatInput({ message: 'x'.repeat(1001) }),
    error => error.code === 'message_too_long'
  );
  const validated = validateChatInput({
    message: 'help',
    interfaceLanguage: 'es',
    quizAnswers: { disabilityStatus: 'yes' },
    helperNotes: 'private note'
  });
  assert.equal(validated.interfaceLanguage, 'es');
  assert.equal('quizAnswers' in validated, false);
  assert.equal('helperNotes' in validated, false);
});

test('OpenAI provider uses Responses API structured output without provider storage', async () => {
  let request;
  const provider = createOpenAIChatProvider({
    apiKey: 'test-only-key',
    model: 'gpt-5.6',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        async json() {
          return {
            output_text: JSON.stringify({
              language: 'en',
              intent: 'general_bridgeaid_question',
              category: null,
              time: null,
              urgency: 'none',
              location: null,
              tone: 'neutral',
              response: 'BridgeAid helps you find verified resources.',
              resourceIds: []
            })
          };
        }
      };
    }
  });
  const result = await provider({ userMessage: 'What is BridgeAid?', verifiedResources: [] });
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.options.headers.Authorization, 'Bearer test-only-key');
  assert.equal(request.body.store, false);
  assert.equal(request.body.text.format.type, 'json_schema');
  assert.equal(request.body.text.format.strict, true);
  assert.equal(result.language, 'en');
});

test('rate limiter resets after its bounded window', () => {
  let now = 0;
  const allow = createRateLimiter({ limit: 2, windowMs: 100, now: () => now });
  assert.equal(allow('client'), true);
  assert.equal(allow('client'), true);
  assert.equal(allow('client'), false);
  now = 101;
  assert.equal(allow('client'), true);
});

test('POST /api/chat serves validated structured responses', async t => {
  const server = createBridgeAidServer({
    rateLimiter: () => true,
    provider: async () => ({
      language: 'en',
      intent: 'general_bridgeaid_question',
      category: null,
      time: null,
      urgency: 'none',
      location: null,
      tone: 'neutral',
      response: 'BridgeAid finds verified help.',
      resourceIds: []
    })
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'What is BridgeAid?', interfaceLanguage: 'en' })
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.intent, 'general_bridgeaid_question');
  assert.deepEqual(body.resourceIds, []);
});

test('browser chat client validates success and localized error codes', async () => {
  const valid = {
    language: 'es',
    intent: 'find_local_resource',
    category: 'food',
    time: '07:00',
    urgency: 'today',
    location: null,
    tone: 'polite',
    response: '¿En qué ciudad estás?',
    resourceIds: []
  };
  assert.equal(validateChatApiResponse(valid).language, 'es');
  const result = await requestBridgeAI({ message: 'hola' }, {
    fetchImpl: async () => ({ ok: true, json: async () => valid })
  });
  assert.equal(result.time, '07:00');
  await assert.rejects(
    requestBridgeAI({ message: 'hola' }, {
      fetchImpl: async () => ({
        ok: false,
        json: async () => ({ error: { code: 'rate_limited' } })
      })
    }),
    error => error instanceof ChatApiError && error.code === 'rate_limited'
  );
});
