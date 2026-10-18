const config = require('../../config');
const { createClaudeCaller, CLI_VERSION } = require('./claude');
const { createGroqCaller } = require('./groq');

const processBudget = { requests: 0 };
function editorialRuntime({ callModel, settings = config, createClaude = createClaudeCaller, budget = processBudget } = {}) {
  if (settings.editorialProvider === 'groq') return {
    callModel: callModel || createGroqCaller({ apiKey: settings.groqApiKey }),
    primaryModel: settings.groqPrimaryModel, fallbackModel: settings.groqFallbackModel,
    evidence: () => ({ provider: 'groq' }),
  };
  if (settings.editorialProvider !== 'claude') throw new Error('[DIEM Provider] unknown editorial provider');
  const execution = [];
  const native = callModel || createClaude({ token: settings.claudeCodeOauthToken,
    binary: settings.claudeCodeBinary, onMetadata: item => execution.push(item) });
  return {
    primaryModel: 'claude-opus-5-5', fallbackModel: null,
    callModel: async request => {
      if (request.model !== 'claude-opus-5-5') throw new Error('unexpected production editorial model');
      if (!callModel && ++budget.requests > 12) throw new Error('editorial process request budget exhausted');
      return native(request);
    },
    evidence: () => ({ provider: 'claude-code-subscription', cliVersion: CLI_VERSION, execution }),
  };
}

module.exports = { editorialRuntime };
