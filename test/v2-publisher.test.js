const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createDailyLedger, updatePublication } = require('../src/v2/ledger');
const { preparePublication, publishCommentChain, publishPreparedPublication } = require('../src/v2/publisher');

function readyLedger(root) {
  fs.mkdirSync(root, { recursive: true });
  const reelPath = path.join(root, 'economy.mp4');
  fs.writeFileSync(reelPath, 'video');
  let ledger = createDailyLedger('2026-07-25');
  ledger = updatePublication(ledger, 'economy', {
    status: 'ready',
    candidate: { title: '기준금리 동결', fullText: '충분한 기사 근거 문장입니다.'.repeat(10) },
    editorial: {
      caption: { text: '첫 문장입니다.🏦\n\n둘째 문장입니다.\n\n셋째 문장입니다.📊' },
      comments: {
        first: '🏦',
        reply: '@diem.magazine #경제 #금융 #경제뉴스 #재테크초보 #뉴스요약 #릴스 #diem #diemmagazine #데일리이슈앤이코노미 #한국은행 #기준금리 #물가',
        compactReply: '@diem.magazine #경제 #금융 #diem #diemmagazine #데일리이슈앤이코노미',
        hashtags: ['#경제'],
      },
    },
    artifacts: { reelPath },
    reel: { status: 'ready', attempts: 0, externalId: null },
  });
  return ledger;
}

test('publishes only one Reel and records its external identity', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-publisher-'));
  const ledger = readyLedger(root);
  let reelCalls = 0;
  let passedAudioConfig = null;
  const result = await publishPreparedPublication(ledger, 'economy', 'token', {
    cleanupReleasesImpl: async () => [],
    createReleaseImpl: async () => ({ releaseId: 1, tag: 'temp', createdAt: new Date().toISOString(), videoUrl: 'https://example.com/reel.mp4' }),
    reconcileReelImpl: async () => ({ status: 'not_found', shouldPublish: true }),
    publishReelImpl: async (params) => {
      reelCalls += 1;
      return { id: 'ig-reel', permalink: 'https://instagram.com/reel/ig-reel' };
    },
    publishStoryImpl: async () => ({ id: 'ig-story' }),
    searchInstagramAudioImpl: async () => [{ id: 'mock-audio-123' }],
    publishCommentsImpl: async publication => publication,
  });
  assert.equal(reelCalls, 1);
  assert.equal(result.publications.economy.reel.status, 'published');
  assert.equal(result.publications.economy.reel.externalId, 'ig-reel');
  assert.equal(result.publications.economy.status, 'published');
  assert.equal(result.publications.economy.carousel, undefined);
  assert.equal(result.publications.economy.story.status, 'published');
  assert.equal(result.publications.economy.story.externalId, 'ig-story');
  assert.equal(result.publications.economy.story.attempts, 1);
  assert.equal(result.publications.economy.release.videoUrl, 'https://example.com/reel.mp4');
});

test('passes recent historical and same-day ledger images into image selection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-prepare-'));
  let ledger = createDailyLedger('2026-07-26');
  ledger = updatePublication(ledger, 'issue', {
    status: 'published',
    image: {
      kind: 'web',
      id: 'pexels:same-day',
      originalUrl: 'https://www.pexels.com/photo/same-day/',
      downloadUrl: 'https://images.pexels.com/photos/same-day/photo.jpeg',
    },
    reel: { status: 'published', attempts: 1, externalId: 'ig-issue' },
  });
  ledger = updatePublication(ledger, 'economy', {
    status: 'planned',
    candidate: {
      title: '한국은행 기준금리 2.50% 동결',
      fullText: '한국은행은 기준금리를 2.50%로 동결했습니다. 물가와 가계대출 흐름을 더 지켜보기 위한 결정입니다. 다음 회의에서도 경제 지표를 확인할 예정입니다.',
      verifiedFacts: [
        '한국은행은 기준금리를 2.50%로 동결했습니다.',
        '물가와 가계대출 흐름을 더 지켜보기 위한 결정입니다.',
        '다음 회의에서도 경제 지표를 확인할 예정입니다.',
      ],
      context: '기준금리 동결은 예금과 대출 금리 흐름을 보는 생활경제 신호입니다.',
      category: 'economy',
    },
    duplicateCheck: {
      signature: {
        target: '기준금리',
        event: '동결',
        entities: ['한국은행'],
      },
    },
  });

  let recentImages = null;
  const result = await preparePublication(ledger, 'economy', {
    artifactRoot: root,
    history: [{
      publicationKey: 'diem:2026-07-25:issue',
      image: { id: 'pexels:yesterday', originalUrl: 'https://www.pexels.com/photo/yesterday/' },
    }],
    callModel: async () => ({
      titleCandidates: [{ title: '기준금리\n2.50% 동결' }],
      selectedTitleIndex: 0,
      sentences: [
        '한국은행은 기준금리를 2.50%로 동결하며 현재 통화정책 기조를 유지했습니다.',
        '물가와 가계대출 흐름을 더 지켜보기 위한 결정입니다.',
        '다음 회의에서도 경제 지표를 확인하며 추가 조정 여부를 판단할 예정입니다.',
      ],
      emojis: { first: '🏦', third: '📊' },
      topicTags: ['한국은행', '기준금리', '물가', '가계대출'],
      imageKeyword: 'central bank',
    }),
    selectImageImpl: async (_article, options) => {
      recentImages = options.recentImages;
      return {
        kind: 'web',
        id: 'pexels:fresh',
        source: 'pexels',
        originalUrl: 'https://www.pexels.com/photo/fresh/',
        downloadUrl: 'https://images.pexels.com/photos/fresh/photo.jpeg',
        license: { name: 'Pexels License', url: 'https://www.pexels.com/license/' },
      };
    },
    downloadImageImpl: async selection => ({ ...selection, localPath: null, sha256: 'fresh-image-sha' }),
    renderCoverImpl: async ({ outputPath }) => fs.writeFileSync(outputPath, 'cover'),
    selectMusicImpl: () => ({ trackId: 'mock-track', filePath: null, title: 'Mock' }),
    createReelImpl: async ({ outputPath, music }) => {
      fs.writeFileSync(outputPath, 'video');
      return { outputPath, audio: { trackId: music.trackId } };
    },
  });

  assert.deepEqual(recentImages.map(image => image.id).sort(), ['pexels:same-day', 'pexels:yesterday']);
  assert.equal(result.publications.economy.image.id, 'pexels:fresh');
  assert.equal(result.publications.economy.image.localSha256, 'fresh-image-sha');
});

test('reselects an image when its downloaded hash matches the recent seven-day history', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-image-hash-'));
  let ledger = createDailyLedger('2026-07-29');
  ledger = updatePublication(ledger, 'economy', {
    status: 'planned',
    candidate: {
      title: '한국은행 기준금리 2.50% 동결',
      fullText: '한국은행은 기준금리를 2.50%로 동결했습니다. 물가와 가계대출 흐름을 확인한 결정입니다. 다음 회의에서도 경제 지표를 점검합니다.',
      category: 'economy',
    },
    duplicateCheck: { signature: { target: '기준금리', event: '동결', entities: ['한국은행'] } },
  });
  const selections = [
    { kind: 'web', id: 'pexels:duplicate-alias', source: 'pexels', downloadUrl: 'https://images.example/duplicate.jpg' },
    { kind: 'web', id: 'pexels:fresh-after-hash', source: 'pexels', downloadUrl: 'https://images.example/fresh.jpg' },
  ];
  let selectionCalls = 0;
  const result = await preparePublication(ledger, 'economy', {
    artifactRoot: root,
    history: [{
      publicationKey: 'diem:2026-07-28:economy',
      image: { id: 'unsplash:different-id', localSha256: 'same-binary-sha' },
    }],
    callModel: async () => ({
      titleCandidates: [{ title: '기준금리\n2.50% 동결' }],
      selectedTitleIndex: 0,
      sentences: [
        '한국은행은 기준금리를 2.50%로 동결하며 통화정책 기조를 유지했습니다.',
        '물가와 가계대출 흐름을 더 확인하기 위한 결정입니다.',
        '다음 회의에서도 새 경제 지표를 점검할 예정입니다.',
      ],
      emojis: { first: '🏦', third: '📊' },
      topicTags: ['한국은행', '기준금리', '물가'],
      imageKeyword: 'central bank finance',
    }),
    selectImageImpl: async () => selections[Math.min(selectionCalls++, selections.length - 1)],
    downloadImageImpl: async selection => ({
      ...selection,
      localPath: null,
      sha256: selection.id.includes('duplicate') ? 'same-binary-sha' : 'fresh-binary-sha',
    }),
    renderCoverImpl: async ({ outputPath }) => fs.writeFileSync(outputPath, 'cover'),
    selectMusicImpl: () => ({ trackId: 'mock-track', filePath: null, title: 'Mock' }),
    createReelImpl: async ({ outputPath, music }) => {
      fs.writeFileSync(outputPath, 'video');
      return { outputPath, audio: { trackId: music.trackId } };
    },
  });

  assert.equal(selectionCalls, 2);
  assert.equal(result.publications.economy.image.id, 'pexels:fresh-after-hash');
  assert.equal(result.publications.economy.image.localSha256, 'fresh-binary-sha');
});

test('reconciles an existing exact Reel instead of republishing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-publisher-'));
  const ledger = readyLedger(root);
  let reelCalls = 0;
  let storyCalls = 0;
  ledger.publications.economy.release = {
    tag: 'diem-media-existing',
    videoUrl: 'https://example.com/existing.mp4',
  };
  const result = await publishPreparedPublication(ledger, 'economy', 'token', {
    reconcileReelImpl: async () => ({ status: 'reconciled', match: { id: 'existing', permalink: 'https://instagram.com/reel/existing' } }),
    publishReelImpl: async () => { reelCalls += 1; },
    publishStoryImpl: async ({ videoUrl }) => {
      storyCalls += 1;
      assert.equal(videoUrl, 'https://example.com/existing.mp4');
      return { id: 'story-existing' };
    },
    publishCommentsImpl: async publication => publication,
  });
  assert.equal(reelCalls, 0);
  assert.equal(storyCalls, 1);
  assert.equal(result.publications.economy.reel.externalId, 'existing');
  assert.equal(result.publications.economy.reel.reconciled, true);
  assert.equal(result.publications.economy.story.externalId, 'story-existing');
});

test('retries Story across persisted runs without republishing the successful Reel', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-story-retry-'));
  let ledger = readyLedger(root);
  let reelCalls = 0;
  let storyCalls = 0;
  const dependencies = {
    cleanupReleasesImpl: async () => [],
    createReleaseImpl: async () => ({
      releaseId: 1,
      tag: 'temp-story-retry',
      createdAt: new Date().toISOString(),
      videoUrl: 'https://example.com/story-retry.mp4',
    }),
    reconcileReelImpl: async () => ({ status: 'not_found', shouldPublish: true }),
    publishReelImpl: async () => {
      reelCalls += 1;
      return { id: 'ig-reel-stable', permalink: 'https://instagram.com/reel/stable' };
    },
    publishStoryImpl: async () => {
      storyCalls += 1;
      throw new Error('temporary Story API outage');
    },
    publishCommentsImpl: async publication => publication,
  };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    ledger = await publishPreparedPublication(ledger, 'economy', 'token', dependencies);
    assert.equal(ledger.publications.economy.reel.status, 'published');
    assert.equal(ledger.publications.economy.reel.externalId, 'ig-reel-stable');
    assert.equal(ledger.publications.economy.story.attempts, attempt);
  }

  assert.equal(reelCalls, 1);
  assert.equal(storyCalls, 3);
  assert.equal(ledger.publications.economy.status, 'published');
  assert.equal(ledger.publications.economy.story.status, 'manual_action_required');
  assert.match(ledger.publications.economy.story.error, /Story API outage/u);
});

test('keeps a published Reel when top-level comment permission fails', async () => {
  const publication = readyLedger(fs.mkdtempSync(path.join(os.tmpdir(), 'diem-comments-'))).publications.economy;
  publication.status = 'published';
  publication.reel = { status: 'published', attempts: 1, externalId: 'ig-reel' };
  const error = new Error('Unsupported request - missing permission');
  error.status = 403;
  const result = await publishCommentChain(publication, {
    token: 'token',
    listCommentsImpl: async () => [],
    createCommentImpl: async () => { throw error; },
  });
  assert.equal(result.reel.status, 'published');
  assert.equal(result.comment.status, 'manual_action_required');
  assert.equal(result.reply.status, 'planned');
});

test('uses the compact five-tag reply once after a hashtag-count rejection', async () => {
  const publication = readyLedger(fs.mkdtempSync(path.join(os.tmpdir(), 'diem-comments-'))).publications.economy;
  publication.status = 'published';
  publication.reel = { status: 'published', attempts: 1, externalId: 'ig-reel' };
  publication.comment = { status: 'published', attempts: 1, externalId: 'comment-1' };
  const messages = [];
  const result = await publishCommentChain(publication, {
    token: 'token',
    listCommentsImpl: async () => [{ id: 'comment-1', text: '🏦', username: 'diem.magazine', replies: { data: [] } }],
    replyImpl: async ({ message }) => {
      messages.push(message);
      if (messages.length === 1) {
        const error = new Error('Too many hashtags');
        error.status = 400;
        throw error;
      }
      return { id: 'reply-1' };
    },
  });
  assert.equal(messages.length, 2);
  assert.equal(messages[1], publication.editorial.comments.compactReply);
  assert.equal(result.reply.status, 'published');
  assert.equal(result.reply.usedCompactHashtags, true);
  assert.deepEqual(result.reply.originalHashtags, ['#경제']);
});
