const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildCloudCandidatePack,
  candidatePackPath,
  saveCloudCandidatePack,
} = require('../src/v2/cloud-candidate-pack');

const NOW = new Date('2026-09-16T00:35:00.000Z');
const DATE = '2026-09-16';

function candidate({ title, url, popularityScore = 100 }) {
  return {
    title,
    url,
    popularityScore,
    popularitySignalReliable: true,
    sources: [{
      portal: 'naver',
      rank: 1,
      normalizedScore: popularityScore,
      title,
      url,
    }],
  };
}

test('builds an immutable cloud candidate pack without editorial generation or publication writes', async () => {
  let portalCalls = 0;
  let articleCalls = 0;
  const rate = candidate({
    title: '한국은행 기준금리 2.50% 동결…가계대출 흐름 점검',
    url: 'https://news.example/rate',
  });

  const pack = await buildCloudCandidatePack({
    date: DATE,
    slot: 'run-001',
    now: NOW,
    categories: ['economy'],
    fetchPortalRankingsImpl: async () => {
      portalCalls += 1;
      return { candidates: [rate], allFailed: false, errors: {} };
    },
    fetchArticleBodyImpl: async () => {
      articleCalls += 1;
      return '한국은행은 기준금리를 연 2.50%로 동결했다. 물가와 가계대출 흐름을 더 확인할 필요가 있다고 밝혔으며 다음 회의 전까지 경제 지표를 점검한다.';
    },
    embeddingMatrixImpl: async () => [],
    history: [],
  });

  assert.equal(portalCalls, 1);
  assert.equal(articleCalls, 1);
  assert.equal(pack.schemaVersion, 1);
  assert.equal(pack.kind, 'diem-cloud-candidate-pack');
  assert.equal(pack.runId, 'run-001');
  assert.equal(pack.publication, undefined);
  assert.equal(pack.candidates.economy.length, 1);
  assert.equal(pack.candidates.economy[0].candidate.url, rate.url);
  assert.equal(pack.candidates.economy[0].article.untrustedData, true);
  assert.equal(pack.candidates.economy[0].article.fullText.includes('기준금리를'), true);
  assert.equal(pack.candidates.economy[0].newsFrame.eventKind, 'interest_rate');
  assert.match(pack.integrity.contentSha256, /^[a-f0-9]{64}$/u);
  assert.equal(pack.rejections.economy.length, 0);
});

test('normalizes Korean to NFC and writes only the cloud inbox path', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-cloud-pack-'));
  const outputPath = candidatePackPath({ root, date: DATE, slot: 'run-002' });
  const pack = {
    schemaVersion: 1,
    kind: 'diem-cloud-candidate-pack',
    runId: 'run-002',
    date: DATE,
    createdAt: NOW.toISOString(),
    candidates: { economy: [], issue: [] },
    rejections: { economy: [], issue: [] },
    label: '경제',
    integrity: { contentSha256: 'a'.repeat(64) },
  };

  try {
    const saved = saveCloudCandidatePack(pack, { root, date: DATE, slot: 'run-002' });
    assert.equal(saved.path, outputPath);
    assert.equal(fs.existsSync(outputPath), true);
    const stored = fs.readFileSync(outputPath, 'utf8');
    assert.equal(stored, stored.normalize('NFC'));
    assert.equal(JSON.parse(stored).label, '경제');
    assert.equal(outputPath.startsWith(path.join(root, 'inbox')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
