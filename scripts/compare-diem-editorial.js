#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { MODELS, CLI_VERSION, loadDataset, runComparison, createClaudeCaller,
  createGroqComparisonCaller, renderHtml, renderMarkdown, safeError } = require('../src/v2/editorial-comparison');

function options(args) {
  const result = { mode: 'preview', batch: 'first', candidate: 'sonnet' };
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/u, '');
    if (!['mode', 'batch', 'output', 'candidate'].includes(key) || !args[index + 1]) throw new Error('Use --mode preview|live --batch first|second [--candidate sonnet|opus] [--output directory]');
    result[key] = args[index + 1];
  }
  if (!['preview', 'live'].includes(result.mode) || !['first', 'second'].includes(result.batch)) throw new Error('Invalid comparison mode or batch');
  if (!['sonnet', 'opus'].includes(result.candidate)) throw new Error('Invalid comparison candidate');
  return result;
}

function preflight({ mode, candidate = 'sonnet', env = process.env, checkBinary = spawnSync } = {}) {
  if (mode !== 'live') return { ready: false, missing: [], cli: 'not_checked_in_preview' };
  const missing = [];
  if (!env.CLAUDE_CODE_OAUTH_TOKEN) missing.push('CLAUDE_CODE_OAUTH_TOKEN');
  if (candidate !== 'opus' && !env.GROQ_API_KEY) missing.push('GROQ_API_KEY');
  const binary = env.CLAUDE_COMPARISON_BIN || 'claude';
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-cli-check-'));
  let cli = 'unavailable';
  try {
    const checked = checkBinary(binary, ['--version'], { cwd: directory, timeout: 15_000, encoding: 'utf8', shell: false,
      env: { PATH: env.PATH || '', HOME: directory, CLAUDE_CONFIG_DIR: directory } });
    if (checked.status === 0 && String(checked.stdout).trim().startsWith(CLI_VERSION + ' ')) cli = CLI_VERSION;
    else missing.push('Claude Code ' + CLI_VERSION);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  return { ready: missing.length === 0, missing, cli };
}

async function main(args = process.argv.slice(2), { env = process.env } = {}) {
  const selected = options(args);
  const dataset = loadDataset();
  const setup = preflight({ mode: selected.mode, candidate: selected.candidate, env });
  const secrets = [env.CLAUDE_CODE_OAUTH_TOKEN, env.GROQ_API_KEY].filter(Boolean);
  const metadata = [];
  const callers = setup.ready ? {
    ...(selected.candidate !== 'opus' ? { groq: createGroqComparisonCaller({ apiKey: env.GROQ_API_KEY }) } : {}),
    claude: createClaudeCaller({ token: env.CLAUDE_CODE_OAUTH_TOKEN, binary: env.CLAUDE_COMPARISON_BIN || 'claude', env,
      onMetadata: item => metadata.push(item) }),
  } : {};
  const report = await runComparison({ dataset, ...selected, credentialsReady: setup.ready, callers, secrets,
    runId: env.GITHUB_RUN_ID || 'local-' + Date.now(), githubSha: env.GITHUB_SHA || null });
  report.setup = setup;
  report.claudeExecutionMetadata = metadata;
  // A final serialization guard prevents provider diagnostics from leaking credentials into any format.
  let serialized = JSON.stringify(report);
  for (const secret of secrets) serialized = serialized.split(secret).join('[REDACTED]');
  const safeReport = JSON.parse(serialized);
  const output = path.resolve(selected.output || path.join('.diem-cache/editorial-comparison', report.runId));
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(safeReport, null, 2) + '\n');
  fs.writeFileSync(path.join(output, 'report.md'), renderMarkdown(safeReport));
  fs.writeFileSync(path.join(output, 'report.html'), renderHtml(safeReport));
  if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY,
    '## DIEM 원고 비교: ' + report.status + '\n\n모델: ' + Object.values(report.models || MODELS).join(' / ') + '\n\n' +
    '결과는 이 실행의 **diem-editorial-comparison** artifact에서 report.html을 다운로드해 확인하세요. 실제 발행은 없습니다.\n\n' +
    (setup.missing.length ? '준비 필요: ' + setup.missing.join(', ') + '\n\n' : '') +
    Object.entries(report.summary).map(([provider, s]) => '- ' + provider + ': 검사 ' + s.attempted + ', 통과 ' + s.passed + ', 사용 불가 ' + s.unavailable + ', 미실행 ' + s.notRun).join('\n') + '\n');
  process.stdout.write(JSON.stringify({ status: report.status, mode: report.mode, batch: report.batch, output, setup, summary: report.summary }) + '\n');
  return safeReport;
}
if (require.main === module) main().catch(error => { process.stderr.write('DIEM comparison setup failed: ' + safeError(error, [process.env.CLAUDE_CODE_OAUTH_TOKEN, process.env.GROQ_API_KEY]) + '. No publishing was performed.\n'); process.exitCode = 1; });
module.exports = { options, preflight, main };
