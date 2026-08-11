const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ACCOUNT_METRICS,
  buildWeeklyReport,
  collectInsights,
  dueWindows,
  measurementTargetsFromLedgers,
} = require('../src/collect-insights');

test('collects each measurement window once', () => {
  const post = { publishedAt: '2026-07-10T00:00:00Z', metrics: { '24h': {} } };
  const due = dueWindows(post, new Date('2026-07-13T01:00:00Z'));
  assert.deepEqual(due.map(item => item.label), ['72h']);
});

test('weekly report ranks by engagement rate', () => {
  const posts = [
    { articleTitle: 'A', permalink: 'https://a', format: 'reel', publishedAt: '2026-07-14T00:00:00Z', contentMetadata: { topic: '금리', hook_type: '숫자' }, metrics: { '24h': { reach: 100, saved: 2, shares: 1, engagementRate: 3 } } },
    { articleTitle: 'B', permalink: 'https://b', format: 'carousel', publishedAt: '2026-07-14T00:00:00Z', contentMetadata: { topic: '부동산', hook_type: '반전' }, metrics: { '24h': { reach: 50, saved: 5, shares: 3, engagementRate: 8 } } },
  ];
  const report = buildWeeklyReport(posts, new Date('2026-07-15T00:00:00Z'));
  assert.match(report, /<https:\/\/b\|B>/);
  assert.match(report, /참여율 8%/);
  assert.match(report, /reel: 1개 · 도달 100 · 저장 2 · 공유 1/);
  assert.match(report, /carousel: 1개 · 도달 50 · 저장 5 · 공유 3/);
  assert.match(report, /형식 carousel/);
});

test('derives measurement targets from current and archived V2 publications', () => {
  const ledgers = [{
    date: '2026-08-09',
    publicationHistory: [{
      publicationKey: 'diem:2026-08-09:economy:old',
      category: 'economy',
      contentType: 'hot_news',
      status: 'published',
      candidate: { title: '아카이브 경제', url: 'https://example.com/old' },
      reel: { status: 'published', externalId: 'ig-old', permalink: 'https://instagram.com/reel/old', publishedAt: '2026-08-08T00:00:00Z' },
    }],
    publications: {
      economy: { publicationKey: 'unused', category: 'economy', status: 'no_publish', reel: { status: 'no_publish' } },
      issue: {
        publicationKey: 'diem:2026-08-09:issue:new',
        category: 'issue',
        status: 'published',
        candidate: { title: '현재 시사', url: 'https://example.com/new' },
        reel: { status: 'published', externalId: 'ig-new', permalink: 'https://instagram.com/reel/new', updatedAt: '2026-08-09T00:00:00Z' },
      },
    },
  }];

  const targets = measurementTargetsFromLedgers(ledgers);
  assert.deepEqual(targets.map(target => target.mediaId), ['ig-old', 'ig-new']);
  assert.equal(targets[0].contentType, 'hot_news');
  assert.equal(targets[1].contentType, 'hot_news');
  assert.equal(targets[1].publishedAt, '2026-08-09T00:00:00Z');
});

test('uses supported account metrics instead of the rejected follows metric', () => {
  assert.deepEqual(ACCOUNT_METRICS, ['follower_count', 'profile_views', 'follows_and_unfollows']);
  assert.ok(!ACCOUNT_METRICS.includes('follows'));
});

test('collects ledger-native windows, stores an account baseline, and persists unavailable reasons', async () => {
  const ledger = {
    date: '2026-08-08',
    publicationHistory: [],
    publications: {
      economy: {
        publicationKey: 'diem:2026-08-08:economy:run',
        category: 'economy',
        status: 'published',
        candidate: { title: '경제 테스트', url: 'https://example.com/economy' },
        reel: { status: 'published', externalId: 'ig-economy', permalink: 'https://instagram.com/reel/economy', publishedAt: '2026-08-08T00:00:00Z' },
      },
      issue: { publicationKey: 'unused', category: 'issue', status: 'no_publish', reel: { status: 'no_publish' } },
    },
  };
  const saved = [];
  const messages = [];
  const result = await collectInsights({
    now: new Date('2026-08-09T01:00:00Z'),
    listLedgersImpl: () => [ledger],
    saveLedgerImpl: value => { saved.push(structuredClone(value)); return value; },
    resolveTokenImpl: () => 'token',
    getAccountInsightsImpl: async () => ({
      follower_count: { value: 217, status: 'ok' },
      profile_views: { value: null, status: 'unavailable', reason: 'permission missing' },
      follows_and_unfollows: { value: null, status: 'unavailable', reason: 'metric not returned' },
    }),
    getMediaInsightsImpl: async () => ({
      reach: { value: null, status: 'unavailable', reason: 'media permission missing' },
      views: { value: null, status: 'unavailable', reason: 'media permission missing' },
      likes: { value: null, status: 'unavailable', reason: 'media permission missing' },
      comments: { value: null, status: 'unavailable', reason: 'media permission missing' },
      saved: { value: null, status: 'unavailable', reason: 'media permission missing' },
      shares: { value: null, status: 'unavailable', reason: 'media permission missing' },
      total_interactions: { value: null, status: 'unavailable', reason: 'media permission missing' },
    }),
    sendAnalyticsReportImpl: async message => messages.push(message),
    loadStateImpl: () => ({ weeklyReports: [] }),
    saveStateImpl: () => {},
  });

  assert.equal(result.length, 1);
  assert.equal(saved.length, 1);
  const insights = saved[0].publications.economy.insights;
  assert.equal(insights.baseline.account.follower_count.value, 217);
  assert.equal(insights.windows['24h'].status, 'retry_pending');
  assert.equal(insights.windows['24h'].attempts, 1);
  assert.match(insights.windows['24h'].media.reach.reason, /permission missing/);
  assert.match(messages[0], /media permission missing/);
});

test('weekly report includes medians, rates, sample counts, and missing-data limits', () => {
  const posts = [
    { articleTitle: 'A', permalink: 'https://a', contentType: 'hot_news', publishedAt: '2026-08-08T00:00:00Z', metrics: { '7d': { reach: { value: 100, status: 'ok' }, saved: { value: 10, status: 'ok' }, shares: { value: 5, status: 'ok' }, total_interactions: { value: 20, status: 'ok' }, engagementRate: { value: 20, status: 'ok' } } } },
    { articleTitle: 'B', permalink: 'https://b', contentType: 'diem_basic', publishedAt: '2026-08-08T01:00:00Z', metrics: { '7d': { reach: { value: 300, status: 'ok' }, saved: { value: 60, status: 'ok' }, shares: { value: 15, status: 'ok' }, total_interactions: { value: 90, status: 'ok' }, engagementRate: { value: 30, status: 'ok' } } } },
    { articleTitle: 'C', permalink: 'https://c', contentType: 'hot_news', publishedAt: '2026-08-08T02:00:00Z', metrics: { '7d': { reach: { value: null, status: 'unavailable', reason: 'permission' }, saved: { value: null, status: 'unavailable', reason: 'permission' }, shares: { value: null, status: 'unavailable', reason: 'permission' }, engagementRate: { value: null, status: 'unavailable', reason: 'reach unavailable' } } } },
  ];
  const report = buildWeeklyReport(posts, new Date('2026-08-09T00:00:00Z'));
  assert.match(report, /7일 도달 중앙값 200/);
  assert.match(report, /저장률 15%/);
  assert.match(report, /공유율 5%/);
  assert.match(report, /hot_news: 2개/);
  assert.match(report, /diem_basic: 1개/);
  assert.match(report, /일부 지표 누락 1개/);
});
