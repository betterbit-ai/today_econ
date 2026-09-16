const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildDeterministicEditorial } = require('../src/v2/editorial');
const { buildNewsFrame } = require('../src/v2/topic');
const { dailyPackageContentHash } = require('../src/v2/daily-content');
const {
  DiemMcpCore,
  MockGitHubClient,
} = require('../services/diem-mcp/src/core');

const NOW = new Date('2026-09-16T00:35:00.000Z');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function validPackage() {
  const evidenceText = [
    '한국은행은 9월 16일 기준금리를 연 2.50%로 동결했습니다.',
    '물가와 가계대출 흐름을 더 확인할 필요가 있다고 밝혔습니다.',
    '다음 통화정책 회의 전까지 새 경제 지표를 점검할 계획입니다.',
  ].join(' ');
  const article = {
    title: '한국은행 기준금리 2.50% 동결…가계대출 흐름 점검',
    summary: evidenceText,
    fullText: evidenceText,
    category: 'economy',
    target: '한국은행',
    event: '기준금리 동결',
    entities: ['한국은행', '기준금리'],
    verifiedFacts: evidenceText.split('.').filter(Boolean).map(text => `${text}.`),
  };
  article.newsFrame = buildNewsFrame(article, article.category);
  const pack = {
    schemaVersion: 1,
    packageId: '2026-09-16-0730-economy-rate',
    runId: '2026-09-16-0730',
    status: 'ready',
    category: 'economy',
    createdAt: NOW.toISOString(),
    expiresAt: '2026-09-16T12:35:00.000Z',
    source: {
      title: article.title,
      url: 'https://news.example/rate',
      publisher: 'Example News',
      publishedAt: '2026-09-16T00:00:00+09:00',
      observedAt: NOW.toISOString(),
      rank: 1,
      evidenceText,
      evidenceSha256: sha256(evidenceText),
    },
    selection: { whyNow: '당일 통화정책 결정입니다.', readerConsequence: '대출과 예금 금리의 기준입니다.', rejectedAlternatives: [] },
    newsFrame: article.newsFrame,
    claims: article.verifiedFacts.map((text, index) => ({ id: `claim-${index + 1}`, text, sourceSpans: [text] })),
    editorial: buildDeterministicEditorial(article, { handle: 'diem.magazine' }),
    visual: {
      kind: 'chatgpt-generated-editorial',
      assetPath: 'background.png',
      sha256: '',
      prompt: 'person-free editorial illustration',
      peoplePolicy: 'prohibited',
      photorealisticNewsPolicy: 'prohibited',
      visualFingerprint: 'diem-cloud:rate:001',
    },
    generation: { provider: 'chatgpt-scheduled-task', model: 'gpt-5.6-terra', reasoningEffort: 'high', taskRunId: 'task-001' },
    review: { mode: 'shadow', status: 'model-reviewed', checks: [], qualityIncident: null },
    integrity: { contentSha256: '' },
  };
  return pack;
}

test('returns the latest unexpired candidate pack and exposes only the requested category', async () => {
  const github = new MockGitHubClient({
    files: {
      'data/cloud-editorial/inbox/2026/09/old.json': JSON.stringify({ expiresAt: '2026-09-15T00:00:00.000Z', candidates: { economy: [{ id: 'old' }], issue: [] } }),
      'data/cloud-editorial/inbox/2026/09/fresh.json': JSON.stringify({ expiresAt: '2026-09-16T12:00:00.000Z', candidates: { economy: [{ id: 'fresh-e' }], issue: [{ id: 'fresh-i' }] } }),
    },
  });
  const core = new DiemMcpCore({ githubClient: github, now: () => NOW });

  const result = await core.call('get_pending_candidate_pack', { category: 'economy' });
  assert.deepEqual(result.candidates, [{ id: 'fresh-e' }]);
  assert.equal(result.path.endsWith('/fresh.json'), true);
});

test('writes a package and generated image only through the allowlisted package path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-mcp-'));
  const github = new MockGitHubClient();
  const core = new DiemMcpCore({ githubClient: github, assetRoot: root, now: () => NOW });
  const png = Buffer.from('89504e470d0a1a0a', 'hex');

  try {
    const asset = await core.call('ingest_generated_image', {
      requestId: 'req-image-1',
      mimeType: 'image/png',
      dataBase64: png.toString('base64'),
    });
    const pack = validPackage();
    const submitted = await core.call('submit_editorial_package', {
      requestId: 'req-package-1',
      candidatePackSha256: 'b'.repeat(64),
      package: pack,
      assetId: asset.assetId,
    });
    const replay = await core.call('submit_editorial_package', {
      requestId: 'req-package-1',
      candidatePackSha256: 'b'.repeat(64),
      package: pack,
      assetId: asset.assetId,
    });

    assert.equal(submitted.commitSha, replay.commitSha);
    assert.equal(github.commits.length, 1);
    assert.equal(github.files.has('content/diem-daily/2026/09/16/2026-09-16-0730/economy/package.json'), true);
    assert.equal(github.files.has('content/diem-daily/2026/09/16/2026-09-16-0730/economy/background.png'), true);
    assert.equal([...github.files.keys()].some(file => file.startsWith('.github/')), false);

    const restarted = new DiemMcpCore({ githubClient: github, assetRoot: root, now: () => NOW });
    const afterRestart = await restarted.call('submit_editorial_package', {
      requestId: 'req-package-1',
      candidatePackSha256: 'b'.repeat(64),
      package: pack,
      assetId: asset.assetId,
    });
    assert.equal(afterRestart.commitSha, submitted.commitSha);
    assert.equal(github.commits.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('writes exactly one idempotent canary file on a dedicated branch', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-mcp-canary-'));
  const github = new MockGitHubClient();
  const core = new DiemMcpCore({ githubClient: github, assetRoot: root, now: () => NOW });
  try {
    const first = await core.call('write_canary_proof', { requestId: 'scheduled-canary-1', note: 'scheduled task proof' });
    const replay = await core.call('write_canary_proof', { requestId: 'scheduled-canary-1', note: 'changed replay text' });
    assert.equal(first.commitSha, replay.commitSha);
    assert.equal(github.commits.length, 1);
    assert.deepEqual(github.commits[0].files, ['data/cloud-editorial/canary/scheduled-canary-1.json']);
    assert.equal(github.pullRequests.length, 1);
    assert.equal(first.branch, 'diem/canary/scheduled-canary-1');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects unsupported tools and refuses image inputs without inline bytes', async () => {
  const core = new DiemMcpCore({ githubClient: new MockGitHubClient(), now: () => NOW });
  await assert.rejects(() => core.call('shell', {}), /Unsupported DIEM MCP tool/u);
  await assert.rejects(() => core.call('ingest_generated_image', { requestId: 'req-image-2' }), /inline dataBase64/u);
});
