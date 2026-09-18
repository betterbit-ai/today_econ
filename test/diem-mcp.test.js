const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildDeterministicEditorial } = require('../src/v2/editorial');
const { candidatePackHash } = require('../src/v2/cloud-candidate-pack');
const { buildNewsFrame } = require('../src/v2/topic');
const { dailyPackageContentHash } = require('../src/v2/daily-content');
const {
  candidatePackContentHash,
  validateSubmissionPackage,
} = require('../services/diem-mcp/src/package-contract');
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
      kind: 'diem-library',
      assetId: 'finance-100',
      sha256: 'a'.repeat(64),
      peoplePolicy: 'prohibited',
      photorealisticNewsPolicy: 'prohibited',
      visualFingerprint: 'diem-library:finance-100',
    },
    generation: { provider: 'chatgpt-scheduled-task', model: 'gpt-5.6-terra', reasoningEffort: 'high', taskRunId: 'task-001' },
    review: { mode: 'assisted', status: 'model-reviewed', checks: [], qualityIncident: null },
    integrity: { contentSha256: '' },
  };
  pack.integrity.contentSha256 = dailyPackageContentHash(pack);
  return pack;
}

function visualLibraryManifest() {
  return JSON.stringify({
    assets: Array.from({ length: 43 }, (_, index) => ({
      id: `finance-${String(index + 100).padStart(3, '0')}`,
      sha256: String.fromCharCode(97 + (index % 6)).repeat(64),
      topics: ['finance'],
      description: 'person-free editorial asset',
    })),
  });
}

function candidatePackFor(item, candidates = null) {
  const pack = {
    schemaVersion: 1,
    kind: 'diem-cloud-candidate-pack',
    runId: item.runId,
    date: '2026-09-16',
    createdAt: NOW.toISOString(),
    expiresAt: item.expiresAt,
    candidates: candidates || {
      economy: [{
        candidate: { title: item.source.title, url: item.source.url, category: item.category, newsFrame: item.newsFrame },
        article: { fullText: item.source.evidenceText, evidenceSha256: item.source.evidenceSha256, untrustedData: true },
        newsFrame: item.newsFrame,
      }],
      issue: [],
    },
    rejections: { economy: [], issue: [] },
    integrity: { contentSha256: '' },
  };
  pack.integrity.contentSha256 = candidatePackContentHash(pack);
  return pack;
}

function candidatePackFile(item) {
  return {
    'data/cloud-editorial/inbox/2026/09/2026-09-16-0730.json': JSON.stringify(candidatePackFor(item)),
  };
}

test('MCP candidate-pack integrity calculation matches the repository producer', () => {
  const pack = candidatePackFor(validPackage());
  assert.equal(candidatePackContentHash(pack), candidatePackHash(pack));
});

test('returns the latest unexpired candidate pack and exposes only the requested category', async () => {
  const oldPack = candidatePackFor(validPackage(), { economy: [{ id: 'old' }], issue: [] });
  oldPack.expiresAt = '2026-09-15T00:00:00.000Z';
  oldPack.integrity.contentSha256 = candidatePackContentHash(oldPack);
  const github = new MockGitHubClient({
    files: {
      'data/cloud-editorial/inbox/2026/09/old.json': JSON.stringify(oldPack),
      'data/cloud-editorial/inbox/2026/09/fresh.json': JSON.stringify(candidatePackFor(validPackage(), { economy: [{ id: 'fresh-e' }], issue: [{ id: 'fresh-i' }] })),
    },
  });
  const freshPack = JSON.parse(github.files.get('data/cloud-editorial/inbox/2026/09/fresh.json'));
  freshPack.expiresAt = '2026-09-16T12:00:00.000Z';
  freshPack.integrity.contentSha256 = candidatePackContentHash(freshPack);
  github.files.set('data/cloud-editorial/inbox/2026/09/fresh.json', JSON.stringify(freshPack));
  const core = new DiemMcpCore({ githubClient: github, now: () => NOW });

  const result = await core.call('get_pending_candidate_pack', { category: 'economy' });
  assert.deepEqual(result.candidates, [{ id: 'fresh-e' }]);
  assert.equal(result.path.endsWith('/fresh.json'), true);
});

test('returns only pinned metadata from the reviewed visual library', async () => {
  const github = new MockGitHubClient({
    files: {
      'assets/fallback/generated/manifest.json': visualLibraryManifest(),
      'data/publications/2026/09/2026-09-15.json': JSON.stringify({
        date: '2026-09-15',
        publications: {
          economy: { status: 'published', image: { id: 'diem-generated:finance-100', localSha256: 'a'.repeat(64) } },
          issue: { status: 'planned', image: { id: 'diem-library:finance-101' } },
        },
      }),
    },
  });
  const core = new DiemMcpCore({ githubClient: github, now: () => NOW });
  const result = await core.call('get_visual_library');
  assert.equal(result.status, 'ready');
  assert.equal(result.assetCount, 43);
  assert.equal(result.assets[0].recentlyUsed, true);
  assert.equal(result.assets[0].recentUseDates[0], '2026-09-15');
  assert.equal(result.assets[1].recentlyUsed, false);
  assert.deepEqual(Object.keys(result.assets[0]).sort(), ['description', 'energy', 'id', 'recentUseDates', 'recentlyUsed', 'sha256', 'topics']);
});

test('fails closed when a recent publication ledger is malformed', async () => {
  const github = new MockGitHubClient({
    files: {
      'assets/fallback/generated/manifest.json': visualLibraryManifest(),
      'data/publications/2026/09/2026-09-15.json': '{invalid',
    },
  });
  const core = new DiemMcpCore({ githubClient: github, now: () => NOW });
  await assert.rejects(() => core.call('get_visual_library'), /history could not be verified/u);
});

test('ignores candidate packs whose content hash does not match their integrity field', async () => {
  const pack = candidatePackFor(validPackage());
  pack.integrity.contentSha256 = 'b'.repeat(64);
  const github = new MockGitHubClient({
    files: { 'data/cloud-editorial/inbox/2026/09/2026-09-16-0730.json': JSON.stringify(pack) },
  });
  const core = new DiemMcpCore({ githubClient: github, now: () => NOW });
  assert.equal((await core.call('get_pending_candidate_pack')).status, 'no_candidate_pack');
});

test('ignores files that do not use the cloud candidate-pack schema', async () => {
  const pack = candidatePackFor(validPackage());
  pack.kind = 'untrusted-data';
  pack.integrity.contentSha256 = candidatePackContentHash(pack);
  const github = new MockGitHubClient({
    files: { 'data/cloud-editorial/inbox/2026/09/2026-09-16-0730.json': JSON.stringify(pack) },
  });
  const core = new DiemMcpCore({ githubClient: github, now: () => NOW });
  assert.equal((await core.call('get_pending_candidate_pack')).status, 'no_candidate_pack');
});

test('accepts only a pinned visual library reference in an editorial package', () => {
  const pack = validPackage();
  pack.visual = {
    kind: 'diem-library',
    assetId: 'finance-01',
    sha256: 'c'.repeat(64),
    visualFingerprint: 'diem-library:finance-01',
    peoplePolicy: 'prohibited',
    photorealisticNewsPolicy: 'prohibited',
  };
  pack.integrity.contentSha256 = dailyPackageContentHash(pack);
  assert.equal(validateSubmissionPackage(pack, { now: NOW }).ok, true);
  pack.visual.assetId = '../unsafe';
  pack.integrity.contentSha256 = dailyPackageContentHash(pack);
  assert.equal(validateSubmissionPackage(pack, { now: NOW }).ok, false);
});

test('refuses a library package before opening a PR when its asset is not allowlisted', async () => {
  const github = new MockGitHubClient({
    files: {
      ...candidatePackFile(validPackage()),
      'assets/fallback/generated/manifest.json': visualLibraryManifest(),
    },
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-mcp-library-'));
  const core = new DiemMcpCore({ githubClient: github, assetRoot: root, now: () => NOW });
  const pack = validPackage();
  pack.visual = {
    kind: 'diem-library',
    assetId: 'finance-100',
    sha256: 'a'.repeat(64),
    visualFingerprint: 'diem-library:finance-100',
    peoplePolicy: 'prohibited',
    photorealisticNewsPolicy: 'prohibited',
  };
  pack.integrity.contentSha256 = dailyPackageContentHash(pack);
  try {
    await core.call('submit_editorial_package', {
      requestId: 'library-package-1',
      candidatePackSha256: candidatePackContentHash(candidatePackFor(pack)),
      package: pack,
    });
    assert.equal(github.pullRequests.length, 1);

    pack.visual.assetId = 'finance-999';
    pack.integrity.contentSha256 = dailyPackageContentHash(pack);
    await assert.rejects(() => core.call('submit_editorial_package', {
      requestId: 'library-package-2',
      candidatePackSha256: candidatePackContentHash(candidatePackFor(pack)),
      package: pack,
    }), /not allowlisted/u);
    assert.equal(github.pullRequests.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('submits only an assisted package matching the latest candidate evidence, frame, hash, and expiry', async () => {
  const original = validPackage();
  const packFile = candidatePackFile(original);
  const candidatePackSha256 = candidatePackContentHash(candidatePackFor(original));

  for (const [label, mutate, expected] of [
    ['mode', item => { item.review.mode = 'auto'; }, /must use assisted/u],
    ['visual-kind', item => { item.visual.kind = 'chatgpt-generated-editorial'; item.integrity.contentSha256 = dailyPackageContentHash(item); }, /must use a reviewed visual-library/u],
    ['source', item => { item.source.url = 'https://news.example/not-in-candidates'; item.integrity.contentSha256 = dailyPackageContentHash(item); }, /must match a candidate/u],
    ['frame', item => { item.newsFrame.subject = '다른 주제'; item.integrity.contentSha256 = dailyPackageContentHash(item); }, /newsFrame.subject/u],
    ['expiry', item => { item.expiresAt = '2026-09-17T12:35:00.000Z'; item.integrity.contentSha256 = dailyPackageContentHash(item); }, /must not extend/u],
  ]) {
    const github = new MockGitHubClient({ files: packFile });
    const core = new DiemMcpCore({ githubClient: github, now: () => NOW });
    const item = structuredClone(original);
    mutate(item);
    await assert.rejects(() => core.call('submit_editorial_package', {
      requestId: `reject-${label}-package`,
      candidatePackSha256,
      package: item,
    }), expected);
    assert.equal(github.pullRequests.length, 0, `${label} mismatch must be rejected before PR creation`);
  }

  const github = new MockGitHubClient({ files: packFile });
  const core = new DiemMcpCore({ githubClient: github, now: () => NOW });
  await assert.rejects(() => core.call('submit_editorial_package', {
    requestId: 'reject-stale-pack',
    candidatePackSha256: 'b'.repeat(64),
    package: original,
  }), /missing, expired, changed, or no longer the latest/u);
  assert.equal(github.pullRequests.length, 0);
});

test('writes an idempotent package reference without uploading image bytes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-mcp-'));
  const pack = validPackage();
  const github = new MockGitHubClient({
    files: {
      ...candidatePackFile(pack),
      'assets/fallback/generated/manifest.json': visualLibraryManifest(),
    },
  });
  const core = new DiemMcpCore({ githubClient: github, assetRoot: root, now: () => NOW });

  try {
    const submitted = await core.call('submit_editorial_package', {
      requestId: 'req-package-1',
      candidatePackSha256: candidatePackContentHash(candidatePackFor(pack)),
      package: pack,
    });
    const replay = await core.call('submit_editorial_package', {
      requestId: 'req-package-1',
      candidatePackSha256: candidatePackContentHash(candidatePackFor(pack)),
      package: pack,
    });

    assert.equal(submitted.commitSha, replay.commitSha);
    assert.equal(github.commits.length, 1);
    assert.equal(github.files.has('content/diem-daily/2026/09/16/2026-09-16-0730/economy/package.json'), true);
    assert.equal(github.files.has('content/diem-daily/2026/09/16/2026-09-16-0730/economy/background.png'), false);
    assert.equal([...github.files.keys()].some(file => file.startsWith('.github/')), false);

    const restarted = new DiemMcpCore({ githubClient: github, assetRoot: root, now: () => NOW });
    const afterRestart = await restarted.call('submit_editorial_package', {
      requestId: 'req-package-1',
      candidatePackSha256: candidatePackContentHash(candidatePackFor(pack)),
      package: pack,
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

test('does not expose image handoff tools in the visual-library workflow', async () => {
  const core = new DiemMcpCore({ githubClient: new MockGitHubClient(), now: () => NOW });
  await assert.rejects(() => core.call('shell', {}), /Unsupported DIEM MCP tool/u);
  await assert.rejects(() => core.call('ingest_generated_image', { requestId: 'req-image-2' }), /Unsupported DIEM MCP tool/u);
  await assert.rejects(() => core.call('write_image_canary_proof', { requestId: 'req-image-3' }), /Unsupported DIEM MCP tool/u);
  await assert.rejects(() => core.call('attach_image_to_package', { requestId: 'req-image-4' }), /Unsupported DIEM MCP tool/u);
});
