const assert = require('node:assert/strict');
const test = require('node:test');

const { createDailyLedger, updatePublication } = require('../src/v2/ledger');
const {
  basicContentHash,
  prepareBasicDraft,
  publishBasicDraft,
  rejectBasicDraft,
  retryBasicPublication,
  validateBasicEditorial,
} = require('../src/v2/basic');

function sourceLedger() {
  let ledger = createDailyLedger('2026-08-08');
  ledger = updatePublication(ledger, 'economy', {
    status: 'published',
    contentType: 'hot_news',
    candidate: {
      title: '기준금리 동결, 대출금리 흐름은',
      url: 'https://news.example.com/rates',
      publishedAt: '2026-08-08T01:00:00.000Z',
      fullText: '한국은행은 기준금리를 동결했습니다. 예금과 대출금리는 시장금리와 은행별 가산금리에 따라 다르게 움직일 수 있습니다.',
      category: 'economy',
    },
    reel: { status: 'published', attempts: 1, externalId: 'ig-hot-news', publishedAt: '2026-08-08T02:00:00.000Z' },
  });
  return ledger;
}

function preparedBasicLedger(ledger) {
  const publication = ledger.publications.economy;
  return updatePublication(ledger, 'economy', {
    ...publication,
    status: 'ready',
    editorial: {
      title: { text: '기준금리와\n대출금리 차이' },
      caption: {
        sentences: ['기준금리는 중앙은행이 정하는 기준입니다.🏦', '대출금리는 기준금리에 조달비용과 가산금리 등이 더해집니다.', '동결 소식만으로 내 대출금리가 같다고 단정하면 안 됩니다.🔎'],
        text: '기준금리는 중앙은행이 정하는 기준입니다.🏦\n\n대출금리는 기준금리에 조달비용과 가산금리 등이 더해집니다.\n\n동결 소식만으로 내 대출금리가 같다고 단정하면 안 됩니다.🔎',
      },
      comments: { first: '🏦', reply: '@diem.magazine #경제 #금융 #경제뉴스 #재테크초보 #뉴스요약 #릴스 #diem #diemmagazine #데일리이슈앤이코노미 #기준금리 #대출금리 #금리공부' },
      quality: { ok: true, checks: ['definition', 'example', 'caution', 'source'] },
    },
    image: {
      kind: 'typographic',
      source: 'diem-original',
      license: { name: 'Project-owned original', url: null },
      fallbackTheme: 'markets',
      visualFingerprint: 'diem-art:markets:v1',
      reuseGuard: { allowed: true },
    },
    artifacts: {
      coverPath: '.diem-cache/basic-cover.png',
      coverSha256: 'cover-hash',
      reelPath: '.diem-cache/basic-reel.mp4',
      reelSha256: 'reel-hash',
    },
    reel: { status: 'ready', attempts: 0, externalId: null },
  });
}

test('DIEM Basic educational quality rejects investment advice and missing caution', () => {
  const result = validateBasicEditorial({
    caption: { sentences: [
      '기준금리는 중앙은행이 정하는 금리 기준입니다.',
      '이 상품을 지금 매수하면 됩니다.',
      '대출금리가 내려갑니다.',
    ] },
  }, { url: 'https://example.com/source' });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /recommendation/u);
  assert.match(result.errors.join(' '), /caution/u);
});

test('weekly DIEM Basic preparation records a draft and preview without calling Instagram', async () => {
  const ledgers = [sourceLedger()];
  const current = createDailyLedger('2026-08-09');
  let releaseAssets = null;
  let preview = null;
  let publishCalls = 0;
  const saved = await prepareBasicDraft({
    date: '2026-08-09',
    ledgers,
    ledger: current,
    preparePublicationImpl: async ledger => preparedBasicLedger(ledger),
    createReleaseImpl: async ({ assetPaths }) => {
      releaseAssets = assetPaths;
      return {
        releaseId: 41,
        tag: 'diem-basic-draft-2026-w32',
        createdAt: '2026-08-09T00:00:00.000Z',
        htmlUrl: 'https://github.com/example/releases/basic',
        imageUrls: ['https://github.com/example/basic-cover.png'],
        videoUrl: 'https://github.com/example/basic-reel.mp4',
        assets: [],
      };
    },
    sendPreviewImpl: async input => { preview = input.publication; },
    saveLedgerImpl: value => value,
    publishPreparedPublicationImpl: async () => { publishCalls += 1; },
  });

  const draft = saved.publicationHistory.find(item => item.contentType === 'diem_basic');
  assert.equal(draft.status, 'draft');
  assert.equal(draft.source.url, 'https://news.example.com/rates');
  assert.equal(draft.approval.contentHash, basicContentHash(draft));
  assert.equal(releaseAssets.length, 2);
  assert.equal(preview.publicationKey, draft.publicationKey);
  assert.equal(publishCalls, 0);
});

test('DIEM Basic approval fails closed for wrong key, changed hash, and duplicate publication', async () => {
  const base = await prepareBasicDraft({
    date: '2026-08-09',
    ledgers: [sourceLedger()],
    ledger: createDailyLedger('2026-08-09'),
    preparePublicationImpl: async ledger => preparedBasicLedger(ledger),
    createReleaseImpl: async () => ({ releaseId: 1, tag: 'basic', createdAt: new Date().toISOString(), imageUrls: ['https://example/cover.png'], videoUrl: 'https://example/reel.mp4', assets: [] }),
    sendPreviewImpl: async () => {},
    saveLedgerImpl: value => value,
  });
  const draft = base.publicationHistory.find(item => item.contentType === 'diem_basic');
  const common = { ledgers: [base], token: 'token', saveLedgerImpl: value => value };

  await assert.rejects(() => publishBasicDraft({ ...common, publicationKey: 'wrong-key' }), /not found/);
  const changed = structuredClone(base);
  changed.publicationHistory.find(item => item.publicationKey === draft.publicationKey).editorial.caption.text += ' 변경';
  await assert.rejects(() => publishBasicDraft({ ...common, ledgers: [changed], publicationKey: draft.publicationKey }), /content hash mismatch/);
  const already = structuredClone(base);
  const alreadyDraft = already.publicationHistory.find(item => item.publicationKey === draft.publicationKey);
  alreadyDraft.status = 'published';
  alreadyDraft.reel.externalId = 'ig-basic';
  await assert.rejects(() => publishBasicDraft({ ...common, ledgers: [already], publicationKey: draft.publicationKey }), /already published/);
});

test('exact DIEM Basic approval publishes once and replaces only its archived record', async () => {
  const base = await prepareBasicDraft({
    date: '2026-08-09',
    ledgers: [sourceLedger()],
    ledger: createDailyLedger('2026-08-09'),
    preparePublicationImpl: async ledger => preparedBasicLedger(ledger),
    createReleaseImpl: async () => ({ releaseId: 1, tag: 'basic', createdAt: new Date().toISOString(), imageUrls: ['https://example/cover.png'], videoUrl: 'https://example/reel.mp4', assets: [] }),
    sendPreviewImpl: async () => {},
    saveLedgerImpl: value => value,
  });
  const draft = base.publicationHistory.find(item => item.contentType === 'diem_basic');
  const currentEconomyKey = base.publications.economy.publicationKey;
  let calls = 0;
  const result = await publishBasicDraft({
    ledgers: [base],
    publicationKey: draft.publicationKey,
    token: 'token',
    saveLedgerImpl: value => value,
    publishPreparedPublicationImpl: async ledger => {
      calls += 1;
      return updatePublication(ledger, 'economy', {
        ...ledger.publications.economy,
        status: 'published',
        reel: { ...ledger.publications.economy.reel, status: 'published', externalId: 'ig-basic', permalink: 'https://instagram.com/reel/basic', publishedAt: '2026-08-09T02:00:00.000Z' },
        story: { status: 'published', attempts: 1, externalId: 'ig-story' },
      });
    },
  });

  const published = result.publicationHistory.find(item => item.publicationKey === draft.publicationKey);
  assert.equal(calls, 1);
  assert.equal(published.status, 'published');
  assert.equal(published.reel.externalId, 'ig-basic');
  assert.equal(result.publications.economy.publicationKey, currentEconomyKey);
});

test('a rejected DIEM Basic draft records a reason and permits only one regeneration', () => {
  const ledger = createDailyLedger('2026-08-09');
  ledger.publicationHistory.push({
    publicationKey: 'diem:2026-08-09:economy:basic-2026-w32',
    category: 'economy',
    contentType: 'diem_basic',
    status: 'draft',
    experiment: { weekKey: '2026-W32', regeneration: 0 },
    reel: { status: 'ready' },
  });
  const rejected = rejectBasicDraft(ledger, ledger.publicationHistory[0].publicationKey, '설명이 어렵습니다.');
  assert.equal(rejected.publicationHistory[0].status, 'rejected');
  assert.equal(rejected.publicationHistory[0].review.reason, '설명이 어렵습니다.');
  assert.equal(rejected.publicationHistory[0].experiment.regeneration, 1);
  assert.throws(() => rejectBasicDraft(rejected, rejected.publicationHistory[0].publicationKey, '다시 반려'), /already rejected/);
});

test('an already published DIEM Basic Reel can recover only its independent steps', async () => {
  const ledger = createDailyLedger('2026-08-09');
  const publication = {
    publicationKey: 'diem:2026-08-09:economy:basic-2026-w32',
    category: 'economy',
    contentType: 'diem_basic',
    schemaVersion: 1,
    status: 'published',
    candidate: { title: '기준금리', url: 'https://example.com', publishedAt: '2026-08-08' },
    editorial: { caption: { text: '본문' } },
    image: { kind: 'typographic', source: 'diem-original', license: { name: 'Project-owned original' }, visualFingerprint: 'diem-art:markets:v1' },
    artifacts: { coverSha256: 'cover', reelSha256: 'reel' },
    source: { url: 'https://example.com' },
    quality: { ok: true },
    reel: { status: 'published', externalId: 'ig-basic' },
    story: { status: 'retry_pending' },
    comment: { status: 'published', externalId: 'comment' },
    reply: { status: 'retry_pending' },
  };
  publication.approval = { contentHash: basicContentHash(publication) };
  ledger.publicationHistory.push(publication);
  let calls = 0;
  const result = await retryBasicPublication({
    publicationKey: publication.publicationKey,
    ledgers: [ledger],
    token: 'token',
    saveLedgerImpl: value => value,
    publishPreparedPublicationImpl: async sandbox => {
      calls += 1;
      return updatePublication(sandbox, 'economy', {
        ...sandbox.publications.economy,
        story: { status: 'published', externalId: 'story' },
        reply: { status: 'published', externalId: 'reply' },
      });
    },
  });
  const recovered = result.publicationHistory.find(item => item.publicationKey === publication.publicationKey);
  assert.equal(calls, 1);
  assert.equal(recovered.reel.externalId, 'ig-basic');
  assert.equal(recovered.story.status, 'published');
  assert.equal(recovered.reply.status, 'published');
});
