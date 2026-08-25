const assert = require('node:assert/strict');
const test = require('node:test');

const { createGroqCaller, createGroqVisionReviewer, isJsonValidationFailure, retryAfterMs } = require('../src/v2/groq');

test('uses retry-after for a bounded free-tier 429 retry', async () => {
  const waits = [];
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async params => {
          calls += 1;
          assert.equal(params.model, 'openai/gpt-oss-120b');
          assert.equal(params.service_tier, undefined);
          if (calls === 1) {
            const error = new Error('rate limited');
            error.status = 429;
            error.headers = new Map([['retry-after', '2']]);
            throw error;
          }
          return { choices: [{ message: { content: '{"ok":true}' } }] };
        },
      },
    },
  };
  const call = createGroqCaller({ client, sleep: async ms => waits.push(ms) });
  assert.equal(await call({ model: 'openai/gpt-oss-120b', systemPrompt: '한글', userPrompt: '근거' }), '{"ok":true}');
  assert.deepEqual(waits, [2000]);
});

test('does not sleep through a daily-quota retry window or switch to a paid tier', async () => {
  let slept = false;
  const error = new Error('tokens per day exceeded');
  error.status = 429;
  error.headers = new Map([['retry-after', '7200']]);
  const client = { chat: { completions: { create: async () => { throw error; } } } };
  const call = createGroqCaller({ client, sleep: async () => { slept = true; } });
  await assert.rejects(call({ model: 'openai/gpt-oss-20b' }), /tokens per day/);
  assert.equal(slept, false);
  assert.equal(retryAfterMs(error), 7_200_000);
});

test('recovers a rejected Groq JSON-mode generation as plain JSON text once', async () => {
  const requests = [];
  const client = { chat: { completions: { create: async params => {
    requests.push(params);
    if (params.response_format) {
      const error = new Error('400 {"error":{"code":"json_validate_failed","message":"Failed to validate JSON"}}');
      error.status = 400;
      throw error;
    }
    return { choices: [{ message: { content: '{"sentences":["하나","둘","셋"]}' } }] };
  } } } };
  const call = createGroqCaller({ client });
  const result = await call({ model: 'openai/gpt-oss-120b', systemPrompt: 'JSON 편집', userPrompt: '기사' });
  assert.equal(result, '{"sentences":["하나","둘","셋"]}');
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0].response_format, { type: 'json_object' });
  assert.equal(requests[1].response_format, undefined);
  assert.match(requests[1].messages[0].content, /JSON mode recovery/u);
  assert.equal(isJsonValidationFailure(Object.assign(new Error('json_validate_failed'), { status: 400 })), true);
});

test('vision review rejects foreign political symbols and selects only a safe article image', async () => {
  let request;
  const client = { chat: { completions: { create: async params => {
    request = params;
    return { choices: [{ message: { content: JSON.stringify({
      ok: true,
      selectedId: 'safe-office',
      reason: 'Korean institutional setting matches the article',
      evaluations: [
        { id: 'us-ballot', relevant: false, countryMismatch: true, foreignPoliticalSymbol: true, unrelatedPerson: false, reason: 'United States flag' },
        { id: 'safe-office', relevant: true, countryMismatch: false, foreignPoliticalSymbol: false, unrelatedPerson: false, reason: 'safe' },
      ],
    }) } }] };
  } } } };
  const review = createGroqVisionReviewer({ client });
  const result = await review({
    candidate: { title: '이재명 대통령 당 지도부 식사', summary: '한국 대통령과 당 지도부의 만찬입니다.' },
    query: 'South Korea presidential office meeting room',
    images: [
      { id: 'us-ballot', downloadUrl: 'https://example.com/us.jpg' },
      { id: 'safe-office', downloadUrl: 'https://example.com/office.jpg' },
    ],
  });
  assert.equal(request.model, 'qwen/qwen3.6-27b');
  assert.equal(request.messages[0].content.filter(item => item.type === 'image_url').length, 2);
  assert.equal(result.ok, true);
  assert.equal(result.selectedId, 'safe-office');
});
