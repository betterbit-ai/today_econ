const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const CLI_VERSION = '2.1.302';
const CLAUDE_MODELS = Object.freeze({ sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' });

function claudeInvocation(request, { token, directory, env = process.env } = {}) {
  if (!Object.values(CLAUDE_MODELS).includes(request.model)) throw new Error('unexpected Claude comparison model');
  if (!token) throw new Error('claude_auth_required');
  return {
    args: ['--print', '--output-format', 'json', '--model', request.model,
      '--max-turns', '1', '--no-session-persistence', '--safe-mode', '--restricted',
      '--tools', '', '--disallowedTools', 'mcp__*', '--strict-mcp-config',
      '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
      '--system-prompt', String(request.systemPrompt || '').normalize('NFC')],
    input: String(request.userPrompt || '').normalize('NFC'),
    options: {
      cwd: directory, shell: false, timeout: 120_000, killSignal: 'SIGKILL', maxBuffer: 2 * 1024 * 1024,
      env: { PATH: env.PATH || '', HOME: directory, TMPDIR: directory,
        CLAUDE_CONFIG_DIR: directory, CLAUDE_CODE_OAUTH_TOKEN: token, CI: 'true' },
    },
  };
}

function parseClaudeOutput(stdout) {
  let envelope;
  try { envelope = JSON.parse(stdout); } catch { throw new Error('claude_invalid_envelope'); }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) throw new Error('claude_invalid_envelope');
  if (envelope.is_error) {
    const message = String(envelope.result || envelope.errors || envelope.subtype || '');
    if (/usage|rate.?limit|quota|credit|limit reached/iu.test(message)) throw new Error('claude_usage_limited');
    if (/auth|login|token|401|403/iu.test(message)) throw new Error('claude_auth_required');
    throw new Error('claude_execution_failed');
  }
  if (typeof envelope.result !== 'string' && (!envelope.structured_output || typeof envelope.structured_output !== 'object')) throw new Error('claude_invalid_envelope');
  // Preserve raw model text, including invalid drafts, for the same parser and repair path as Groq.
  const value = envelope.structured_output || envelope.result;
  return { value, modelIds: Object.keys(envelope.modelUsage || {}), turns: envelope.num_turns ?? null };
}

function createClaudeCaller({ token, binary = 'claude', env = process.env, runFile = execFile, onMetadata = () => {} } = {}) {
  return async request => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-editorial-shadow-'));
    try {
      const invocation = claudeInvocation(request, { token, directory, env });
      const stdout = await new Promise((resolve, reject) => {
        const child = runFile(binary, invocation.args, invocation.options, (error, output) => {
          if (error) {
            // Inspect only the result envelope, never persist stdout/stderr or native credential diagnostics.
            try { parseClaudeOutput(output); } catch (parsedError) {
              if (/^claude_(usage_limited|auth_required)$/u.test(parsedError.message)) { reject(parsedError); return; }
            }
            reject(new Error(error.code === 'ENOENT' ? 'claude_cli_missing' : error.killed ? 'claude_timeout' : 'claude_execution_failed'));
          } else resolve(output);
        });
        child.stdin.on('error', () => {});
        child.stdin.end(invocation.input);
      });
      const result = parseClaudeOutput(stdout);
      if (!result.modelIds.length || result.modelIds.some(model => model !== request.model && !model.startsWith(request.model + '-'))) throw new Error('claude_unexpected_model');
      onMetadata({ modelIds: result.modelIds, turns: result.turns });
      return result.value;
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  };
}

module.exports = { CLI_VERSION, CLAUDE_MODELS, claudeInvocation, parseClaudeOutput, createClaudeCaller };
