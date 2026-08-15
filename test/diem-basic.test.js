const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { createDailyLedger, updatePublication } = require('../src/v2/ledger');
const {
  BASIC_CONTENT_TYPE,
  basicContentHash,
  retryBasicPublication,
} = require('../src/v2/basic');
const {
  loadBasicCatalog,
  nextReadyBasicPackage,
  publishBasicPackage,
  stageBasicPackage,
  validateBasicPackage,
} = require('../src/v2/basic-content');

const CONTENT_ROOT = path.join(__dirname, '..', 'content', 'diem-basic');

test('the committed DIEM Basic curriculum contains four fully verified ready packages', () => {
  const catalog = loadBasicCatalog({ contentRoot: CONTENT_ROOT });
  assert.deepEqual(catalog.packages.map(item => item.id), [
    'isa-tax',
    'etf-etn',
    'fixed-variable-rate',
    'credit-score-rate',
  ]);
  for (const item of catalog.packages) {
    const validation = validateBasicPackage(item, {
      contentRoot: CONTENT_ROOT,
      now: new Date('2026-08-14T00:00:00.000Z'),
      verifyArtifacts: false,
    });
    assert.equal(validation.ok, true, `${item.id}: ${validation.errors.join('; ')}`);
    assert.equal(item.editorial.caption.sentences.length, 3);
    assert.equal(item.editorial.comments.hashtags.length, 15);
    assert.equal(new Set(item.sources.map(source => source.organization)).size >= 2, true);
    assert.equal(item.sources.every(source => source.official && source.primary), true);
    assert.equal(item.visual.kind, 'typographic');
    assert.equal(item.visual.peoplePolicy, 'prohibited');
    assert.equal(item.lesson.scenes.length, 5);
    assert.deepEqual(item.lesson.scenes.map(scene => scene.role), [
      'cover',
      'definition',
      'mechanism',
      'caution',
      'summary',
    ]);
    assert.deepEqual(item.lesson.scenes.map(scene => scene.durationSeconds), [3, 4, 5, 4, 3]);
    assert.equal(item.lesson.totalDurationSeconds, 19);
    assert.equal(item.lesson.scenes.every(scene => /요[.!?]?$/u.test(scene.body)), true);
    assert.equal(item.editorial.caption.sentences.every(sentence => /요[.!?]?(?:[\p{Extended_Pictographic}\uFE0F\u200D]+)?$/u.test(sentence)), true);
    assert.equal(item.artifacts.cards.length, 5);
    assert.equal(item.artifacts.cards.every(card => /^[a-f0-9]{64}$/u.test(card.sha256)), true);
  }
});

test('package validation fails closed for weak sourcing, unmapped claims, expiry, and artifact drift', () => {
  const item = loadBasicCatalog({ contentRoot: CONTENT_ROOT, verifyArtifacts: false }).packages[0];

  const weak = structuredClone(item);
  weak.sources = weak.sources.slice(0, 1);
  weak.claims[0].sourceIds = ['missing-source'];
  let result = validateBasicPackage(weak, {
    contentRoot: CONTENT_ROOT,
    now: new Date('2026-08-14T00:00:00.000Z'),
    verifyArtifacts: false,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /two distinct official primary sources/u);
  assert.match(result.errors.join(' '), /unknown source/u);

  result = validateBasicPackage(item, {
    contentRoot: CONTENT_ROOT,
    now: new Date('2030-01-01T00:00:00.000Z'),
    verifyArtifacts: false,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /needs_refresh/u);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-basic-artifacts-'));
  const drift = structuredClone(item);
  drift._directory = tempRoot;
  drift.artifacts.coverPath = 'cover.png';
  drift.artifacts.reelPath = 'reel.mp4';
  drift.artifacts.cards = item.artifacts.cards.map((card, index) => ({
    ...card,
    path: `cards/card-${String(index + 1).padStart(2, '0')}.png`,
  }));
  fs.writeFileSync(path.join(tempRoot, 'cover.png'), 'changed-cover');
  fs.writeFileSync(path.join(tempRoot, 'reel.mp4'), 'changed-reel');
  fs.mkdirSync(path.join(tempRoot, 'cards'));
  drift.artifacts.cards.forEach(card => fs.writeFileSync(path.join(tempRoot, card.path), 'changed-card'));
  result = validateBasicPackage(drift, {
    contentRoot: tempRoot,
    now: new Date('2026-08-14T00:00:00.000Z'),
    verifyArtifacts: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /artifact hash mismatch/u);
});

const hasFfprobe = spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;

test('committed lesson media contains five 1080x1920 cards and a nineteen-second H.264/AAC Reel', {
  skip: !hasFfprobe,
}, () => {
  const { packages } = loadBasicCatalog({ contentRoot: CONTENT_ROOT });
  for (const item of packages) {
    for (const card of item.artifacts.cards) {
      const png = fs.readFileSync(path.join(item._directory, card.path));
      assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
      assert.equal(png.readUInt32BE(16), 1080);
      assert.equal(png.readUInt32BE(20), 1920);
    }
    const probe = spawnSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,sample_rate,channels',
      '-of', 'json',
      path.join(item._directory, item.artifacts.reelPath),
    ], { encoding: 'utf8' });
    assert.equal(probe.status, 0, `${item.id}: ${probe.stderr}`);
    const media = JSON.parse(probe.stdout);
    const video = media.streams.find(stream => stream.codec_type === 'video');
    const audio = media.streams.find(stream => stream.codec_type === 'audio');
    assert.equal(video.codec_name, 'h264');
    assert.equal(video.width, 1080);
    assert.equal(video.height, 1920);
    assert.equal(video.avg_frame_rate, '30/1');
    assert.equal(video.pix_fmt, 'yuv420p');
    assert.equal(audio.codec_name, 'aac');
    assert.equal(audio.sample_rate, '48000');
    assert.equal(audio.channels, 2);
    assert.ok(Math.abs(Number(media.format.duration) - 19) < 0.08, `${item.id}: ${media.format.duration}`);
  }
});

test('the queue keeps curriculum order and never selects an already published content ID', () => {
  const catalog = loadBasicCatalog({ contentRoot: CONTENT_ROOT, verifyArtifacts: false });
  const first = nextReadyBasicPackage(catalog.packages, [], {
    now: new Date('2026-08-14T00:00:00.000Z'),
    contentRoot: CONTENT_ROOT,
    verifyArtifacts: false,
  });
  assert.equal(first.id, 'isa-tax');

  const ledger = createDailyLedger('2026-08-17');
  ledger.publicationHistory.push({
    publicationKey: 'diem:2026-08-17:economy:basic-isa-tax',
    category: 'economy',
    contentType: BASIC_CONTENT_TYPE,
    basicContentId: 'isa-tax',
    status: 'published',
    reel: { status: 'published', externalId: 'ig-isa' },
  });
  const second = nextReadyBasicPackage(catalog.packages, [ledger], {
    now: new Date('2026-08-18T00:00:00.000Z'),
    contentRoot: CONTENT_ROOT,
    verifyArtifacts: false,
  });
  assert.equal(second.id, 'etf-etn');
});

test('staging a stored package creates a ready publication without generating copy or searching images', () => {
  const item = loadBasicCatalog({ contentRoot: CONTENT_ROOT, verifyArtifacts: false }).packages[0];
  const publication = stageBasicPackage(item, {
    date: '2026-08-17',
    now: new Date('2026-08-17T00:30:00.000Z'),
  });
  assert.equal(publication.status, 'ready');
  assert.equal(publication.contentType, BASIC_CONTENT_TYPE);
  assert.equal(publication.basicContentId, 'isa-tax');
  assert.equal(publication.candidate.sourceMode, 'preauthored_official_sources');
  assert.equal(publication.image.kind, 'typographic');
  assert.equal(publication.artifacts.temporary, false);
  assert.equal(publication.approval.contentHash, basicContentHash(publication));
});

test('publishing selects one stored package, preserves the hot-news slot, and records the archived result', async () => {
  const current = createDailyLedger('2026-08-17');
  current.publications.economy = updatePublication(current, 'economy', {
    ...current.publications.economy,
    status: 'planned',
    candidate: { title: '다음 경제 뉴스', fullText: '보존해야 하는 현재 슬롯' },
  }).publications.economy;
  const currentKey = current.publications.economy.publicationKey;
  const saved = [];
  let calls = 0;

  const result = await publishBasicPackage({
    date: '2026-08-17',
    contentId: 'isa-tax',
    contentRoot: CONTENT_ROOT,
    ledgers: [current],
    ledger: current,
    token: 'token',
    verifyArtifacts: false,
    saveLedgerImpl: value => {
      saved.push(structuredClone(value));
      return value;
    },
    publishPreparedPublicationImpl: async sandbox => {
      calls += 1;
      return updatePublication(sandbox, 'economy', {
        ...sandbox.publications.economy,
        status: 'published',
        reel: {
          ...sandbox.publications.economy.reel,
          status: 'published',
          externalId: 'ig-basic-isa',
          publishedAt: '2026-08-17T01:00:00.000Z',
        },
        story: { status: 'published', attempts: 1, externalId: 'story-basic-isa' },
      });
    },
  });

  const publication = result.publicationHistory.find(item => item.basicContentId === 'isa-tax');
  assert.equal(calls, 1);
  assert.equal(saved.length, 2, 'ready state must be saved before external publishing and result afterwards');
  assert.equal(publication.status, 'published');
  assert.equal(publication.reel.externalId, 'ig-basic-isa');
  assert.equal(result.publications.economy.publicationKey, currentKey);

  await assert.rejects(() => publishBasicPackage({
    date: '2026-08-18',
    contentId: 'isa-tax',
    contentRoot: CONTENT_ROOT,
    ledgers: [result],
    ledger: createDailyLedger('2026-08-18'),
    token: 'token',
    verifyArtifacts: false,
    saveLedgerImpl: value => value,
  }), /already published/u);
});

test('a published stored Reel can recover only Story and comment-chain steps', async () => {
  const ledger = createDailyLedger('2026-08-17');
  const item = loadBasicCatalog({ contentRoot: CONTENT_ROOT, verifyArtifacts: false }).packages[0];
  const publication = stageBasicPackage(item, { date: '2026-08-17' });
  publication.status = 'published';
  publication.reel = { ...publication.reel, status: 'published', externalId: 'ig-basic' };
  publication.story = { status: 'retry_pending', attempts: 1 };
  publication.comment = { status: 'published', externalId: 'comment' };
  publication.reply = { status: 'retry_pending', attempts: 1 };
  publication.approval.contentHash = basicContentHash(publication);
  ledger.publicationHistory.push(publication);

  const result = await retryBasicPublication({
    publicationKey: publication.publicationKey,
    ledgers: [ledger],
    token: 'token',
    saveLedgerImpl: value => value,
    publishPreparedPublicationImpl: async sandbox => updatePublication(sandbox, 'economy', {
      ...sandbox.publications.economy,
      story: { status: 'published', externalId: 'story' },
      reply: { status: 'published', externalId: 'reply' },
    }),
  });
  const recovered = result.publicationHistory.find(item => item.publicationKey === publication.publicationKey);
  assert.equal(recovered.story.status, 'published');
  assert.equal(recovered.reply.status, 'published');
});
