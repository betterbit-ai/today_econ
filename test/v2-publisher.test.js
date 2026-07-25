const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createDailyLedger, updatePublication } = require('../src/v2/ledger');
const { publishCommentChain, publishPreparedPublication } = require('../src/v2/publisher');

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
});

test('reconciles an existing exact Reel instead of republishing', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-publisher-'));
  const ledger = readyLedger(root);
  let reelCalls = 0;
  const result = await publishPreparedPublication(ledger, 'economy', 'token', {
    reconcileReelImpl: async () => ({ status: 'reconciled', match: { id: 'existing', permalink: 'https://instagram.com/reel/existing' } }),
    publishReelImpl: async () => { reelCalls += 1; },
    publishCommentsImpl: async publication => publication,
  });
  assert.equal(reelCalls, 0);
  assert.equal(result.publications.economy.reel.externalId, 'existing');
  assert.equal(result.publications.economy.reel.reconciled, true);
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
