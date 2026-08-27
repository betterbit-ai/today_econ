const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildSlackStatusText,
  closeGitHubIssue,
  notificationKey,
  recordNotification,
  sendSlackStatus,
  shouldNotify,
  upsertGitHubIssue,
} = require('../src/v2/notifications');
const { dispatchOperationalEvent } = require('../src/v2/operations');
const { MANUAL_REEL_STORY_SHARE_REASON } = require('../src/v2/constants');

function jsonResponse(payload, status = 200) {
  return new Response(payload === null ? '' : JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const baseEvent = {
  publicationKey: 'diem:2026-07-25:economy',
  category: 'economy',
  stage: 'reel',
  title: '기준금리 동결',
};

test('builds status-only Slack text without caption or media payloads', async () => {
  const calls = [];
  const client = {
    chat: {
      postMessage: async payload => {
        calls.push(payload);
        return { ts: '1.1' };
      },
    },
    filesUploadV2: async () => {
      throw new Error('files must never be uploaded');
    },
  };
  const event = {
    ...baseEvent,
    status: 'published',
    permalink: 'https://instagram.com/reel/one',
    caption: '전송되면 안 되는 본문 전문',
    imagePath: '/tmp/cover.png',
    videoPath: '/tmp/reel.mp4',
  };
  await sendSlackStatus({ event, channelId: 'channel', client });
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /발행 완료/);
  assert.match(calls[0].text, /instagram\.com/);
  assert.doesNotMatch(calls[0].text, /전송되면 안 되는|cover\.png|reel\.mp4/);
  assert.equal(calls[0].unfurl_media, false);
});

test('deduplicates operational events by publication, stage, and status', () => {
  const event = { ...baseEvent, status: 'retry_pending' };
  const publication = {
    status: 'published',
    reel: { status: 'published', externalId: 'reel-1' },
    comment: { status: 'retry_pending' },
    notifications: [],
  };
  assert.equal(shouldNotify(event, publication.notifications), true);
  const recorded = recordNotification(publication, event, { slackTs: '1.1' });
  assert.equal(shouldNotify(event, recorded.notifications), false);
  assert.equal(recorded.notifications[0].key, notificationKey(event));
  assert.deepEqual(recorded.reel, publication.reel);
  assert.equal(recorded.status, 'published');
});

test('formats only defined state transitions', () => {
  assert.match(buildSlackStatusText({ ...baseEvent, status: 'retry_pending', attempts: 1 }), /재시도 예정/);
  assert.match(buildSlackStatusText({ ...baseEvent, status: 'recovered' }), /복구 완료/);
  assert.match(buildSlackStatusText({ ...baseEvent, status: 'manual_action_required' }), /수동 조치/);
  assert.match(buildSlackStatusText({ ...baseEvent, status: 'no_publish', reason: '후보 소진' }), /발행 생략/);
  assert.throws(() => buildSlackStatusText({ ...baseEvent, status: 'failed' }), /Unsupported/);
});

test('formats one-click native Reel Story sharing guidance', () => {
  const text = buildSlackStatusText({
    ...baseEvent,
    stage: 'story',
    status: 'manual_action_required',
    error: MANUAL_REEL_STORY_SHARE_REASON,
    permalink: 'https://www.instagram.com/reel/DIEM123/',
  });
  assert.match(text, /Reel → Story 공유 필요/u);
  assert.match(text, /Instagram Reel 열기/u);
  assert.match(text, /공유 아이콘 → 스토리에 추가/u);
  assert.doesNotMatch(text, /native_reel_story_share_required/u);
});

test('sends routine native Story prompts to Slack without opening a GitHub issue', async () => {
  let issueCalls = 0;
  const result = await dispatchOperationalEvent({ notifications: [] }, {
    ...baseEvent,
    stage: 'story',
    status: 'manual_action_required',
    error: MANUAL_REEL_STORY_SHARE_REASON,
    permalink: 'https://www.instagram.com/reel/DIEM123/',
  }, {
    slackClient: { chat: { postMessage: async () => ({ ts: '1.2' }) } },
    slackChannelId: 'channel',
    githubToken: 'token',
    githubRepository: 'owner/repo',
    upsertIssueImpl: async () => { issueCalls += 1; return { number: 1 }; },
  });
  assert.equal(result.sent, true);
  assert.equal(issueCalls, 0);
  assert.equal(result.publication.notifications.length, 1);
});

test('formats a 24-hour watchdog alert with an actionable reason and no content payload', () => {
  const text = buildSlackStatusText({
    ...baseEvent,
    stage: 'daily_watchdog',
    status: 'no_publish',
    reason: '마지막 발행 후 25시간 경과. 분야 부적합 43건, 기사 신선도 초과 4건.',
    caption: '게시물 본문은 보내면 안 됩니다.',
  });

  assert.match(text, /24시간 이상 무발행/);
  assert.match(text, /25시간 경과/);
  assert.doesNotMatch(text, /게시물 본문은/);
});

test('creates a GitHub issue with a stable hidden marker', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('issues?state=all')) return jsonResponse([]);
    if (String(url).endsWith('/issues') && options.method === 'POST') {
      return jsonResponse({ number: 7, html_url: 'https://github.com/owner/repo/issues/7', state: 'open' }, 201);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const event = { ...baseEvent, status: 'manual_action_required', error: '권한 없음' };
  const issue = await upsertGitHubIssue({
    event,
    repository: 'owner/repo',
    token: 'token',
    fetchImpl,
  });
  assert.equal(issue.number, 7);
  assert.equal(issue.reused, false);
  const body = JSON.parse(calls[1].options.body).body;
  assert.match(body, /<!-- diem-operation:diem:2026-07-25:economy:reel -->/);
});

test('reuses an existing issue and appends a status comment', async () => {
  const marker = '<!-- diem-operation:diem:2026-07-25:economy:reel -->';
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('issues?state=all')) {
      return jsonResponse([{ number: 7, html_url: 'issue-url', state: 'open', body: marker }]);
    }
    if (String(url).endsWith('/issues/7/comments') && options.method === 'POST') {
      return jsonResponse({ id: 9 }, 201);
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const issue = await upsertGitHubIssue({
    event: { ...baseEvent, status: 'manual_action_required', error: '다시 실패' },
    repository: 'owner/repo',
    token: 'token',
    fetchImpl,
  });
  assert.equal(issue.reused, true);
  assert.equal(calls.filter(call => call.url.endsWith('/issues')).length, 0);
  assert.ok(calls.some(call => call.url.endsWith('/issues/7/comments')));
});

test('comments and closes the matching issue after recovery', async () => {
  const marker = '<!-- diem-operation:diem:2026-07-25:economy:reel -->';
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('issues?state=all')) {
      return jsonResponse([{ number: 7, state: 'open', body: marker }]);
    }
    if (String(url).endsWith('/issues/7/comments')) return jsonResponse({ id: 10 }, 201);
    if (String(url).endsWith('/issues/7') && options.method === 'PATCH') {
      return jsonResponse({ number: 7, state: 'closed' });
    }
    throw new Error(`Unexpected request ${url}`);
  };
  const closed = await closeGitHubIssue({
    event: { ...baseEvent, status: 'recovered' },
    repository: 'owner/repo',
    token: 'token',
    fetchImpl,
  });
  assert.equal(closed.state, 'closed');
  assert.equal(JSON.parse(calls.at(-1).options.body).state, 'closed');
});
