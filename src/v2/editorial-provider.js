const config = require('../../config');
const { createClaudeCaller, CLI_VERSION } = require('./claude');
const { createGroqCaller } = require('./groq');

const processBudget = { requests: 0 };
function editorialRuntime({ callModel, settings = config, createClaude = createClaudeCaller, budget = processBudget } = {}) {
  const provider = settings.editorialProvider || 'groq';
  if (provider === 'groq') return {
    callModel: callModel || createGroqCaller({ apiKey: settings.groqApiKey }),
    primaryModel: settings.groqPrimaryModel || 'openai/gpt-oss-120b',
    fallbackModel: settings.groqFallbackModel || 'openai/gpt-oss-20b',
    evidence: () => ({ provider: 'groq' }),
  };
  if (provider !== 'claude') throw new Error('[DIEM Provider] unknown editorial provider');
  const execution = [];
  const native = callModel || (settings.claudeCodeOauthToken ? createClaude({
    token: settings.claudeCodeOauthToken,
    binary: settings.claudeCodeBinary,
    onMetadata: item => execution.push(item),
  }) : null);

  if (!native && settings.groqApiKey) {
    return {
      callModel: createGroqCaller({ apiKey: settings.groqApiKey }),
      primaryModel: settings.groqPrimaryModel || 'openai/gpt-oss-120b',
      fallbackModel: settings.groqFallbackModel || 'openai/gpt-oss-20b',
      evidence: () => ({ provider: 'groq-fallback', reason: 'claude_auth_missing' }),
    };
  }

  return {
    primaryModel: 'claude-opus-5-5',
    fallbackModel: settings.groqApiKey ? (settings.groqFallbackModel || 'openai/gpt-oss-20b') : null,
    callModel: async request => {
      if (request.model === 'claude-opus-5-5') {
        if (!callModel && ++budget.requests > 12) throw new Error('editorial process request budget exhausted');
        try {
          if (!native) throw new Error('claude_auth_required');
          return await native(request);
        } catch (error) {
          if (settings.groqApiKey) {
            const fallbackCaller = createGroqCaller({ apiKey: settings.groqApiKey });
            return await fallbackCaller({ ...request, model: settings.groqPrimaryModel || 'openai/gpt-oss-120b' });
          }
          throw error;
        }
      }
      if (settings.groqApiKey) {
        const fallbackCaller = createGroqCaller({ apiKey: settings.groqApiKey });
        return await fallbackCaller(request);
      }
      throw new Error('unexpected production editorial model');
    },
    evidence: () => ({ provider: 'claude-code-subscription', cliVersion: CLI_VERSION, execution }),
  };
}

module.exports = { editorialRuntime };
