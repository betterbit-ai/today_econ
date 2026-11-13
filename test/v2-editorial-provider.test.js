const assert = require('node:assert/strict');
const test = require('node:test');
const { editorialRuntime } = require('../src/v2/editorial-provider');

test('editorialRuntime returns groq runtime when configured with groq', () => {
  const runtime = editorialRuntime({
    settings: {
      editorialProvider: 'groq',
      groqApiKey: 'dummy_key',
      groqPrimaryModel: 'openai/gpt-oss-120b',
      groqFallbackModel: 'openai/gpt-oss-20b',
    },
  });
  assert.equal(runtime.primaryModel, 'openai/gpt-oss-120b');
  assert.equal(runtime.fallbackModel, 'openai/gpt-oss-20b');
  assert.equal(runtime.evidence().provider, 'groq');
});

test('editorialRuntime falls back to groq when claude auth is missing', async () => {
  let groqCalled = false;
  const mockGroqCaller = async req => {
    groqCalled = true;
    return '{"titleCandidates":[{"title":"테스트 타이틀"}]}';
  };
  const runtime = editorialRuntime({
    settings: {
      editorialProvider: 'claude',
      groqApiKey: 'dummy_key',
      groqPrimaryModel: 'openai/gpt-oss-120b',
      groqFallbackModel: 'openai/gpt-oss-20b',
    },
    callModel: null,
    createClaude: () => null,
  });
  assert.equal(runtime.evidence().provider, 'groq-fallback');
  assert.equal(runtime.primaryModel, 'openai/gpt-oss-120b');
});
