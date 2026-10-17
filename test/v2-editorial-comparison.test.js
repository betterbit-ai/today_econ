const test = require('node:test');
const assert = require('node:assert/strict');
const { loadDataset, articleHash, claudeInvocation, parseClaudeOutput, runComparison, renderHtml, summarize } = require('../src/v2/editorial-comparison');

test('Groq repairs wait outside the preceding TPM window without adding requests', async () => {
  const { createGroqComparisonCaller } = require('../src/v2/editorial-comparison');
  let clock = 0, calls = 0;
  const waits = [];
  const caller = createGroqComparisonCaller({ now: () => clock,
    sleep: async ms => { waits.push(ms); clock += ms; },
    client: { chat: { completions: { create: async () => { calls++; return { choices: [{ message: { content: '{}' } }] }; } } } },
  });
  const request = { model: 'openai/gpt-oss-120b', systemPrompt: '', userPrompt: '' };
  await caller(request);
  clock += 10_000;
  await caller(request);
  clock += 70_000;
  await caller(request);
  assert.deepEqual(waits, [55_000]);
  assert.equal(calls, 3);
});

test('fixed dataset has five real articles in each category and rejects source drift', () => {
  const data = loadDataset();
  assert.equal(data.cases.length, 10);
  assert.equal(data.cases.filter(c => c.article.category === 'economy').length, 5);
  assert.equal(data.cases.filter(c => c.article.category === 'issue').length, 5);
  assert.equal(articleHash(data.cases[0].article), data.cases[0].inputSha256);
  const manifest = structuredClone(data.manifest);
  manifest.cases[0].inputSha256 = '0'.repeat(64);
  assert.throws(() => loadDataset({ manifest }), /input hash mismatch/u);
});

test('Claude receives only OAuth, no tools, settings, API or publishing credentials', () => {
  const call = claudeInvocation({ model: 'claude-sonnet-5-5', systemPrompt: 'system', userPrompt: '$(echo never) `command`' }, {
    token: 'test-oauth', directory: '/tmp/shadow', env: { PATH: '/usr/bin', HOME: '/private', ANTHROPIC_API_KEY: 'api', GROQ_API_KEY: 'groq', INSTAGRAM_ACCESS_TOKEN: 'ig', GITHUB_TOKEN: 'gh', SLACK_BOT_TOKEN: 'slack' },
  });
  assert.equal(call.options.env.CLAUDE_CODE_OAUTH_TOKEN, 'test-oauth');
  for (const key of ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'INSTAGRAM_ACCESS_TOKEN', 'GITHUB_TOKEN', 'SLACK_BOT_TOKEN']) assert.equal(call.options.env[key], undefined);
  assert.equal(call.options.env.HOME, '/tmp/shadow');
  assert.ok(call.args.includes('--safe-mode'));
  assert.equal(call.args[call.args.indexOf('--tools') + 1], '');
  assert.equal(call.args[call.args.indexOf('--disallowedTools') + 1], 'mcp__*');
  assert.equal(call.args[call.args.indexOf('--max-turns') + 1], '1');
  assert.equal(call.options.shell, false);
  assert.match(call.input, /\$\(echo never\)/u);
  assert.equal(call.args.includes(call.input), false);
});

test('Claude envelope parsing distinguishes usage errors and does not return raw errors', () => {
  assert.equal(parseClaudeOutput(JSON.stringify({ type: 'result', is_error: false, result: '{"sentences":[]}' })).value, '{"sentences":[]}');
  assert.throws(() => parseClaudeOutput(JSON.stringify({ is_error: true, result: 'usage limit hit sk-sensitive' })), /claude_usage_limited/u);
  assert.throws(() => parseClaudeOutput(JSON.stringify({ is_error: true, result: 'login required sk-sensitive' })), /claude_auth_required/u);
  assert.throws(() => parseClaudeOutput(JSON.stringify({ is_error: true, result: 'sk-sensitive' })), /^Error: claude_execution_failed$/u);
});

test('missing credentials or preview never calls either provider or invents measurements', async () => {
  let calls = 0;
  const dataset = loadDataset();
  const report = await runComparison({ dataset, batch: 'first', mode: 'live', credentialsReady: false, callers: { groq: async () => { calls++; }, claude: async () => { calls++; } } });
  assert.equal(calls, 0);
  assert.equal(report.status, 'setup_required');
  assert.equal(report.cases.length, 5);
  assert.equal(report.summary.groq.attempted, 0);
  assert.equal(report.summary.groq.passRate, null);
  assert.equal(report.summary.claude.attempted, 0);
  assert.equal(report.summary.claude.passRate, null);
});

test('paired runner uses one model per provider and bounded repairs with no cross-model fallback', async () => {
  const dataset = loadDataset();
  let groqCalls = 0, claudeCalls = 0;
  const report = await runComparison({ dataset, batch: 'first', mode: 'live', credentialsReady: true, callers: {
    groq: async ({ model }) => { assert.equal(model, 'openai/gpt-oss-120b'); groqCalls++; return { broken: true }; },
    claude: async ({ model }) => { assert.equal(model, 'claude-sonnet-5-5'); claudeCalls++; return { broken: true }; },
  } });
  assert.equal(groqCalls, 10);
  assert.equal(claudeCalls, 10);
  assert.equal(report.summary.groq.attempted, 5);
  assert.equal(report.summary.groq.passed, 0);
  assert.equal(report.summary.claude.passed, 0);
  assert.equal(report.status, 'completed_needs_human_review');
  assert.equal(report.cases[0].results.claude.requests.length, 2);
});

test('setup interruptions remain visible and are excluded from paired completion', async () => {
  const dataset = loadDataset();
  const report = await runComparison({ dataset, batch: 'first', mode: 'live', credentialsReady: true, callers: {
    groq: async () => { throw new Error('rate limit reached'); },
    claude: async () => { throw new Error('claude_usage_limited'); },
  } });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.summary.claude.passed, 0);
  assert.equal(report.summary.claude.unavailable, 5);
  assert.equal(report.summary.claude.passRate, null);
  assert.ok(report.cases.every(c => c.results.claude.status === 'unavailable'));
});

test('HTML escapes article/model content and labels unrun data and human review', async () => {
  const report = await runComparison({ dataset: loadDataset(), batch: 'second', mode: 'preview' });
  report.cases[0].article.title = '<script>alert(1)</script>';
  const html = renderHtml(report);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /미실행/u);
  assert.match(html, /사람 검토/u);
  assert.equal(summarize(report.cases, 'groq').passRate, null);
});

test('successful repaired output is validated, recorded, and marked for human review', async () => {
  const { compareOne } = require('../src/v2/editorial-comparison');
  const article = { category: 'economy', title: '한국은행 기준금리 인하',
    verifiedFacts: ['한국은행은 기준금리를 0.25%포인트 인하했습니다.', '새 기준금리는 다음 달부터 적용됩니다.'],
    context: '한국은행은 물가 둔화를 인하 배경으로 설명했습니다.', target: '기준금리', event: '금리 인하', entities: ['한국은행'] };
  let calls = 0;
  const result = await compareOne(article, 'claude', async () => {
    calls++;
    return { titleCandidates: [{ title: '한국은행\n기준금리 인하' }], sentences: [
      calls === 1 ? '한국은행이 기준금리를 0.50%포인트 낮췄습니다.' : '한국은행이 기준금리를 낮췄습니다.',
      '인하한 기준금리는 다음 달부터 적용됩니다.', '금리를 낮춘 배경으로 한국은행은 물가 둔화를 들었습니다.',
    ], emojis: { first: '📰', third: '📰' }, topicTags: ['한국은행', '금리', '물가'], imageKeyword: 'central bank building' };
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.firstResponsePassed, false);
  assert.equal(result.repairCount, 1);
  assert.equal(result.numericOmissionAfterRepair, true);
  assert.equal(result.humanReview, 'pending');
  assert.match(result.requests[0].output.sentences[0], /0.50/u);
});

test('live preflight checks pinned CLI in a clean environment and preview does not inspect auth', () => {
  const { preflight, options } = require('../scripts/compare-diem-editorial');
  let inspected = 0;
  const result = preflight({ mode: 'live', env: { PATH: '/usr/bin', GROQ_API_KEY: 'private-groq', CLAUDE_CODE_OAUTH_TOKEN: 'private-oauth', GITHUB_TOKEN: 'private-gh' },
    checkBinary: (_binary, args, options) => {
      inspected++;
      assert.deepEqual(args, ['--version']);
      assert.equal(options.env.GITHUB_TOKEN, undefined);
      assert.equal(options.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
      return { status: 0, stdout: '2.1.302 (Claude Code)\n' };
    } });
  assert.equal(result.ready, true);
  preflight({ mode: 'preview', checkBinary: () => { throw new Error('must not execute'); } });
  assert.equal(inspected, 1);
  assert.throws(() => options(['--mode', 'publish']), /Invalid/u);
});

test('shadow workflow isolates publish secrets and concurrency from live publication', () => {
  const fs = require('fs');
  const path = require('path');
  const workflow = fs.readFileSync(path.join(__dirname, '../.github/workflows/diem_economy.yml'), 'utf8');
  const job = workflow.slice(workflow.indexOf('  compare-editorial:'), workflow.indexOf('  publish-economy:'));
  for (const name of ['INSTAGRAM_ACCESS_TOKEN', 'INSTAGRAM_TOKEN_ENCRYPTION_KEY', 'SLACK_BOT_TOKEN', 'GITHUB_TOKEN']) assert.ok(job.includes(name + ": ''"));
  assert.match(job, /contents: read/u);
  assert.match(job, /persist-credentials: false/u);
  assert.match(job, /npm ci --prefix services\/diem-mcp --ignore-scripts/u);
  assert.match(job, /-u PUBLISH_INSTAGRAM_STORY -u MANUAL_REEL_STORY_SHARE/u);
  assert.match(job, /-u INSTAGRAM_TOKEN_SOURCE/u);
  assert.ok(job.includes("inputs.comparison_mode == 'live' && secrets.CLAUDE_CODE_OAUTH_TOKEN || ''"));
  assert.ok(job.includes("inputs.comparison_mode == 'live' && secrets.GROQ_API_KEY || ''"));
  assert.doesNotMatch(job, /commit-diem-state|daily-package-publish|index.js publish/u);
  assert.match(workflow, /inputs.operation == 'compare_editorial'.*diem-editorial-shadow.*diem-v2-durable-writes/u);
});

test('ten paired positive/negative controls protect duration, denominator, comparison, money role and claim state', () => {
  const { validatorControls } = require('../src/v2/editorial-comparison');
  const controls = validatorControls();
  assert.equal(controls.length, 10);
  assert.equal(controls.filter(c => c.expected === 'pass').length, 5);
  assert.deepEqual(controls.filter(c => !c.ok), []);
});

test('batch time budget stops new requests while preserving an incomplete result', async () => {
  const { compareOne } = require('../src/v2/editorial-comparison');
  let calls = 0;
  const result = await compareOne(loadDataset().cases[0].article, 'claude', async () => { calls++; }, { now: () => 1000, deadline: 1001 });
  assert.equal(calls, 0);
  assert.equal(result.status, 'unavailable');
  assert.match(result.error, /comparison_time_budget_exhausted/u);
});

test('both providers receive identical initial system and source prompts', async () => {
  const first = {};
  const report = await runComparison({ dataset: loadDataset(), batch: 'first', mode: 'live', credentialsReady: true, callers: Object.fromEntries(['groq', 'claude'].map(provider => [provider, async request => {
    first[provider] ||= { systemPrompt: request.systemPrompt, userPrompt: request.userPrompt };
    return { broken: true };
  }])) });
  assert.deepEqual(first.groq, first.claude);
  assert.equal(report.pairedCompleted, 5);
  for (const raw of ['null', '[]', '{}']) assert.throws(() => parseClaudeOutput(raw), /claude_invalid_envelope/u);
});

test('Claude preserves model text for identical shared parsing, including fences, preambles and malformed JSON', () => {
  const { parseModelResult } = require('../src/v2/editorial');
  for (const raw of ['{"sentences":[]}', '```json\n{"sentences":[]}\n```', 'Here is the result: {"sentences":[]}']) {
    const claude = parseClaudeOutput(JSON.stringify({ type: 'result', result: raw })).value;
    assert.equal(claude, raw);
    assert.deepEqual(parseModelResult(claude), parseModelResult(raw));
  }
  const malformed = 'not JSON';
  const claude = parseClaudeOutput(JSON.stringify({ type: 'result', result: malformed })).value;
  assert.equal(claude, malformed);
  assert.throws(() => parseModelResult(claude));
  assert.throws(() => parseModelResult(malformed));
});
