const assert = require('node:assert/strict');
const test = require('node:test');

const {
  applyIndependentStepOutcome,
  createTopLevelComment,
  listComments,
  listRecentReels,
  nextFailedStep,
  reconcileExactComment,
  reconcileExactReel,
  replyToComment,
} = require('../src/v2/instagram');

test('uses the professional-account comment and reply endpoints', async () => {
  const calls = [];
  const requestImpl = async request => {
    calls.push(request);
    return { id: `id-${calls.length}` };
  };
  const comment = await createTopLevelComment({
    mediaId: 'media-1',
    message: '📊',
    token: 'token',
    requestImpl,
  });
  const reply = await replyToComment({
    commentId: comment.id,
    message: '@diem.magazine #경제 #diem',
    token: 'token',
    requestImpl,
  });

  assert.equal(comment.id, 'id-1');
  assert.equal(reply.id, 'id-2');
  assert.equal(calls[0].path, 'media-1/comments');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].params.message, '📊');
  assert.equal(calls[1].path, 'id-1/replies');
  assert.equal(calls[1].method, 'POST');
});

test('lists comments and filters recent account media to Reels', async () => {
  const calls = [];
  const requestImpl = async request => {
    calls.push(request);
    if (request.path.endsWith('/comments')) return { data: [{ id: 'comment-1', text: '📊' }] };
    return {
      data: [
        { id: 'reel-1', media_type: 'VIDEO', media_product_type: 'REELS' },
        { id: 'image-1', media_type: 'IMAGE', media_product_type: 'FEED' },
      ],
    };
  };

  assert.equal((await listComments({ mediaId: 'media-1', token: 'token', requestImpl })).length, 1);
  const reels = await listRecentReels({ userId: 'user-1', token: 'token', requestImpl });
  assert.deepEqual(reels.map(item => item.id), ['reel-1']);
  assert.equal(calls[1].path, 'user-1/media');
  assert.match(calls[1].params.fields, /caption/);
});

test('reconciles only one exact NFC caption on the same KST date', () => {
  const expectedCaption = '금리가 동결됐습니다.🏦\n\n물가를 지켜봅니다.\n\n다음 지표가 중요합니다.📊';
  const result = reconcileExactReel([
    {
      id: 'matching',
      caption: expectedCaption.normalize('NFD'),
      timestamp: '2026-07-25T12:03:00.000Z',
      media_type: 'VIDEO',
      media_product_type: 'REELS',
    },
    {
      id: 'wrong-date',
      caption: expectedCaption,
      timestamp: '2026-07-24T12:03:00.000Z',
      media_type: 'VIDEO',
      media_product_type: 'REELS',
    },
    {
      id: 'feed-video',
      caption: expectedCaption,
      timestamp: '2026-07-25T12:03:00.000Z',
      media_type: 'VIDEO',
      media_product_type: 'FEED',
    },
  ], {
    expectedCaption,
    publicationDate: '2026-07-25',
  });
  assert.equal(result.status, 'reconciled');
  assert.equal(result.match.id, 'matching');
  assert.equal(result.shouldPublish, false);

  const absent = reconcileExactReel([], { expectedCaption, publicationDate: '2026-07-25' });
  assert.equal(absent.shouldPublish, true);
});

test('refuses automatic action when duplicate exact Reel or comment matches are ambiguous', () => {
  const reel = {
    caption: '같은 본문',
    timestamp: '2026-07-25T12:00:00.000Z',
    media_type: 'VIDEO',
    media_product_type: 'REELS',
  };
  const reelResult = reconcileExactReel(
    [{ ...reel, id: '1' }, { ...reel, id: '2' }],
    { expectedCaption: '같은 본문', publicationDate: '2026-07-25' }
  );
  assert.equal(reelResult.status, 'ambiguous');
  assert.equal(reelResult.shouldPublish, false);

  const commentResult = reconcileExactComment([
    { id: '1', text: '📊' },
    { id: '2', text: '📊' },
  ], '📊');
  assert.equal(commentResult.status, 'ambiguous');
  assert.equal(commentResult.shouldCreate, false);
});

test('reconciles emoji-only comments only when they belong to the configured account', () => {
  const comments = [
    { id: 'other', text: '📊', username: 'reader' },
    { id: 'self', text: '📊', from: { username: 'diem.magazine' } },
  ];
  const result = reconcileExactComment(comments, '📊', { username: 'diem.magazine' });
  assert.equal(result.status, 'reconciled');
  assert.equal(result.match.id, 'self');
});

test('permission and unsupported errors immediately require manual action', () => {
  const permission = new Error('Unsupported post request: missing permission');
  permission.status = 400;
  permission.payload = { error: { code: 100 } };
  const next = nextFailedStep({ status: 'planned', attempts: 0 }, permission);
  assert.equal(next.status, 'manual_action_required');
  assert.equal(next.attempts, 1);

  const forbidden = new Error('Forbidden');
  forbidden.status = 403;
  assert.equal(nextFailedStep({ attempts: 0 }, forbidden).status, 'manual_action_required');
});

test('transient comment failures retry at most three times without changing Reel state', () => {
  const publication = {
    status: 'published',
    reel: { status: 'published', attempts: 1, externalId: 'reel-1' },
    comment: { status: 'planned', attempts: 0, externalId: null },
    reply: { status: 'planned', attempts: 0, externalId: null },
    notifications: [],
  };
  const failure = new Error('temporary upstream failure');
  const once = applyIndependentStepOutcome(publication, 'comment', { error: failure });
  const twice = applyIndependentStepOutcome(once, 'comment', { error: failure });
  const thrice = applyIndependentStepOutcome(twice, 'comment', { error: failure });

  assert.equal(once.comment.status, 'retry_pending');
  assert.equal(twice.comment.status, 'retry_pending');
  assert.equal(thrice.comment.status, 'manual_action_required');
  assert.equal(thrice.comment.attempts, 3);
  assert.deepEqual(thrice.reel, publication.reel);
  assert.equal(thrice.status, 'published');
});

test('a successful reply updates only the reply step', () => {
  const publication = {
    status: 'published',
    reel: { status: 'published', attempts: 1, externalId: 'reel-1' },
    comment: { status: 'published', attempts: 1, externalId: 'comment-1' },
    reply: { status: 'retry_pending', attempts: 1, externalId: null },
  };
  const next = applyIndependentStepOutcome(
    publication,
    'reply',
    { result: { id: 'reply-1' } },
    new Date('2026-07-25T12:00:00.000Z')
  );
  assert.equal(next.reply.status, 'published');
  assert.equal(next.reply.externalId, 'reply-1');
  assert.equal(next.reply.attempts, 2);
  assert.deepEqual(next.reel, publication.reel);
  assert.deepEqual(next.comment, publication.comment);
});
