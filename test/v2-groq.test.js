const assert = require('node:assert/strict');
const test = require('node:test');

const { createGroqCaller, retryAfterMs } = require('../src/v2/groq');

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
