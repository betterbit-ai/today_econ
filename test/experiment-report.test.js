const assert = require('node:assert/strict');
const test = require('node:test');

const { buildExperimentReport, recordModeration, reportMarkdown } = require('../src/v2/experiment-report');
const { createDailyLedger } = require('../src/v2/ledger');

function metric(value) {
  return { value, status: 'ok' };
}

function publication({ key, type, reach, saved, shares, watchTime, status = 'published' }) {
  return {
    publicationKey: key,
    category: 'economy',
    contentType: type,
    status,
    quality: { ok: true },
    review: { status: type === 'diem_basic' ? 'approved' : null },
    reel: { status: 'published', externalId: key, publishedAt: '2026-08-01T00:00:00.000Z' },
    insights: {
      windows: {
        '7d': {
          status: 'ok',
          reach: metric(reach),
          saved: metric(saved),
          shares: metric(shares),
          ig_reels_avg_watch_time: metric(watchTime),
          account: { profile_views: metric(20) },
          followerDeltaEstimate: { value: 2, status: 'ok', attribution: 'account_window_estimate' },
        },
      },
    },
  };
}

test('four-week report compares medians, rates, sample size, and unavailable limits by content type', () => {
  const ledger = createDailyLedger('2026-08-31');
  ledger.publicationHistory = [
    publication({ key: 'hot-1', type: 'hot_news', reach: 1000, saved: 20, shares: 10, watchTime: 8 }),
    publication({ key: 'hot-2', type: 'hot_news', reach: 3000, saved: 90, shares: 60, watchTime: 10 }),
    publication({ key: 'basic-1', type: 'diem_basic', reach: 800, saved: 80, shares: 24, watchTime: 12 }),
    publication({ key: 'basic-2', type: 'diem_basic', reach: 1200, saved: 180, shares: 60, watchTime: 14 }),
  ];
  const report = buildExperimentReport([ledger], new Date('2026-09-08T00:00:00.000Z'));

  assert.equal(report.groups.hot_news.published, 2);
  assert.equal(report.groups.hot_news.sevenDaySamples, 2);
  assert.equal(report.groups.hot_news.reachMedian, 2000);
  assert.equal(report.groups.diem_basic.reachMedian, 1000);
  assert.equal(report.groups.diem_basic.savedRateMedian, 12.5);
  assert.equal(report.groups.diem_basic.shareRateMedian, 4);
  assert.equal(report.groups.diem_basic.averageWatchTimeMedian, 13);
  assert.equal(report.status, 'collecting');
  assert.match(reportMarkdown(report), /표본 2개/u);
  assert.match(reportMarkdown(report), /누락 지표/u);
});

test('operator deletion or correction reasons remain part of the experiment evidence', () => {
  const ledger = createDailyLedger('2026-08-31');
  ledger.publications.economy = publication({ key: 'diem:2026-08-31:economy', type: 'hot_news', reach: 100, saved: 2, shares: 1, watchTime: 8 });
  ledger.publications.economy.category = 'economy';
  let saved = null;
  recordModeration({
    publicationKey: ledger.publications.economy.publicationKey,
    action: 'deleted',
    reason: '배경 이미지가 기사 인물과 달라 운영자가 삭제함',
    ledgers: [ledger],
    saveLedgerImpl: value => { saved = value; return value; },
  });
  const report = buildExperimentReport([saved]);
  assert.equal(report.groups.hot_news.deletedOrCorrected, 1);
  assert.match(report.groups.hot_news.moderationReasons[0].reason, /배경 이미지/u);
});
