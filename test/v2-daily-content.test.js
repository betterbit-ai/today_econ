const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { buildDeterministicEditorial } = require('../src/v2/editorial');
const { buildNewsFrame } = require('../src/v2/topic');
const {
  dailyPackageContentHash,
  publishDailyPackage,
  prepareDailyPackage,
  prepareDailyPackageFromFile,
  stageDailyPackage,
  validateDailyPackage,
} = require('../src/v2/daily-content');
const { createDailyLedger } = require('../src/v2/ledger');

const DATE = '2026-09-16';
const NOW = new Date('2026-09-16T00:35:00.000Z');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function packageFixture({ mode = 'assisted' } = {}) {
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
    publishedAt: '2026-09-16T00:00:00+09:00',
    target: '한국은행',
    event: '기준금리 동결',
    entities: ['한국은행', '기준금리'],
    verifiedFacts: evidenceText.split('.').filter(Boolean).map(text => `${text}.`),
  };
  article.newsFrame = buildNewsFrame(article, article.category);
  const editorial = buildDeterministicEditorial(article, { handle: 'diem.magazine' });
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
      publishedAt: article.publishedAt,
      observedAt: NOW.toISOString(),
      rank: 1,
      evidenceText,
      evidenceSha256: sha256(evidenceText),
    },
    selection: {
      whyNow: '통화정책 결정이 당일 공개됐습니다.',
      readerConsequence: '대출과 예금 금리를 확인할 때 기준이 됩니다.',
      rejectedAlternatives: [],
    },
    newsFrame: article.newsFrame,
    claims: article.verifiedFacts.map((fact, index) => ({
      id: `claim-${index + 1}`,
      text: fact,
      sourceSpans: [fact],
    })),
    editorial,
    visual: {
      kind: 'typographic',
      fallbackTheme: 'rate-reset',
      visualFingerprint: 'diem-cloud:rate-reset:2026-09-16',
      peoplePolicy: 'prohibited',
      photorealisticNewsPolicy: 'prohibited',
    },
    generation: {
      provider: 'chatgpt-scheduled-task',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      taskRunId: 'task-run-001',
    },
    review: { mode, status: 'model-reviewed', checks: [], qualityIncident: null },
    integrity: { contentSha256: '' },
  };
  pack.integrity.contentSha256 = dailyPackageContentHash(pack);
  return pack;
}

test('validates and stages a cloud editorial package without Groq generation', () => {
  const pack = packageFixture();
  const validation = validateDailyPackage(pack, { now: NOW });
  assert.equal(validation.ok, true, validation.errors.join('; '));

  const publication = stageDailyPackage(pack, { date: DATE, now: NOW });
  assert.equal(publication.status, 'planned');
  assert.equal(publication.contentType, 'diem_daily');
  assert.equal(publication.candidate.url, pack.source.url);
  assert.equal(publication.editorial.generation.mode, 'chatgpt_cloud_scheduled');
  assert.equal(publication.image.kind, 'typographic');
  assert.equal(publication.reel.status, 'planned');
});

test('prepares a staged package with stored editorial content and never calls a text model', async () => {
  const pack = packageFixture();
  const ledger = createDailyLedger(DATE, NOW);
  ledger.publications.economy = stageDailyPackage(pack, { date: DATE, now: NOW });
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-daily-package-'));
  let modelCalls = 0;

  try {
    const prepared = await prepareDailyPackage(ledger, 'economy', {
      package: pack,
      artifactRoot,
      callModel: async () => { modelCalls += 1; },
      renderCoverImpl: async ({ outputPath, followCtaOutputPath }) => {
        fs.writeFileSync(outputPath, 'cover');
        fs.writeFileSync(followCtaOutputPath, 'cta');
      },
      selectMusicImpl: () => ({ trackId: null, mode: 'silent', mood: 'serious' }),
      createReelImpl: async ({ outputPath }) => {
        fs.writeFileSync(outputPath, 'reel');
        return { outputPath, audio: { trackId: null, mode: 'silent', mood: 'serious' } };
      },
    });

    assert.equal(modelCalls, 0);
    assert.equal(prepared.publications.economy.status, 'ready');
    assert.equal(prepared.publications.economy.reel.status, 'ready');
    assert.equal(fs.existsSync(path.join(artifactRoot, DATE, 'economy', 'economy-cover.png')), true);
    assert.equal(fs.existsSync(path.join(artifactRoot, DATE, 'economy', 'economy-reel.mp4')), true);
  } finally {
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});

test('blocks shadow packages from preparation and packages with altered evidence', async () => {
  const shadow = packageFixture({ mode: 'shadow' });
  const shadowLedger = createDailyLedger(DATE, NOW);
  shadowLedger.publications.economy = stageDailyPackage(shadow, { date: DATE, now: NOW });
  await assert.rejects(
    () => prepareDailyPackage(shadowLedger, 'economy', { package: shadow }),
    /shadow package cannot be prepared/u
  );

  const altered = packageFixture();
  altered.source.evidenceText = '바뀐 근거';
  assert.equal(validateDailyPackage(altered, { now: NOW }).ok, false);
});

test('stages, prepares, and publishes one assisted package without re-running editorial generation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-daily-content-root-'));
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-daily-content-artifacts-'));
  const pack = packageFixture();
  const packageDirectory = path.join(root, '2026', '09', '16', pack.runId, 'economy');
  const packagePath = path.join(packageDirectory, 'package.json');
  fs.mkdirSync(packageDirectory, { recursive: true });
  fs.writeFileSync(packagePath, `${JSON.stringify(pack, null, 2)}\n`);
  let persisted = createDailyLedger(DATE, NOW);
  let modelCalls = 0;

  const saveLedgerImpl = ledger => {
    persisted = structuredClone(ledger);
    return persisted;
  };
  const prepareOptions = {
    artifactRoot,
    renderCoverImpl: async ({ outputPath, followCtaOutputPath }) => {
      fs.writeFileSync(outputPath, 'cover');
      fs.writeFileSync(followCtaOutputPath, 'cta');
    },
    selectMusicImpl: () => ({ trackId: null, mode: 'silent', mood: 'serious' }),
    createReelImpl: async ({ outputPath }) => {
      fs.writeFileSync(outputPath, 'reel');
      return { outputPath, audio: { trackId: null, mode: 'silent', mood: 'serious' } };
    },
    callModel: async () => { modelCalls += 1; },
  };

  try {
    const prepared = await prepareDailyPackageFromFile({
      packagePath,
      contentRoot: root,
      date: DATE,
      now: NOW,
      ledger: persisted,
      ledgers: [persisted],
      saveLedgerImpl,
      ...prepareOptions,
    });
    assert.equal(prepared.publications.economy.status, 'ready');
    assert.equal(modelCalls, 0);

    const published = await publishDailyPackage({
      packagePath,
      contentRoot: root,
      date: DATE,
      now: NOW,
      ledger: persisted,
      ledgers: [persisted],
      token: 'test-token',
      saveLedgerImpl,
      publishPreparedPublicationImpl: async ledger => {
        const next = structuredClone(ledger);
        next.publications.economy.status = 'published';
        next.publications.economy.reel = {
          ...next.publications.economy.reel,
          status: 'published',
          externalId: 'reel-1',
          permalink: 'https://instagram.example/reel-1',
        };
        return next;
      },
    });
    assert.equal(published.publications.economy.reel.status, 'published');
    assert.equal(published.publications.economy.dailyPackageId, pack.packageId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(artifactRoot, { recursive: true, force: true });
  }
});
