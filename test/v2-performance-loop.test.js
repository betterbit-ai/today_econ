const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PRIOR_MAX,
  buildPerformanceReport,
  performancePrior,
  windowTimingStatus,
} = require('../src/v2/performance-loop');

function metric(value) {
  return { value, status: 'ok' };
}

function publication(index, {
  category = 'economy',
  exposure = 100,
  title = `경제 기사 ${index}`,
  imageKind = 'web',
  imageSource = 'pexels',
  trackId = `track-${index % 5}`,
} = {}) {
  const media = {
    views: metric(exposure),
    reach: metric(Math.round(exposure * 0.8)),
    saved: metric(Math.max(1, Math.round(exposure * 0.02))),
    shares: metric(Math.max(1, Math.round(exposure * 0.03))),
    ig_reels_avg_watch_time: metric(8000 + index),
  };
  return {
    publicationKey: `diem:2026-08-${String(index + 1).padStart(2, '0')}:${category}:run-${index}`,
    category,
    candidate: { title, summary: `${title}에 관한 구체적인 설명입니다.` },
    reel: { status: 'published', externalId: `ig-${index}`, permalink: `https://instagram.com/reel/${index}` },
    image: { kind: imageKind, source: imageSource },
    audio: { mode: 'track', trackId, mood: category === 'economy' ? 'steady' : 'serious' },
    insights: {
      windows: {
        '7d': {
          status: 'ok',
          media,
          engagementRate: metric(5),
          followerDeltaEstimate: metric(index % 2),
        },
      },
    },
  };
}

test('keeps observation windows separate and withholds learning below five samples', () => {
  const ledger = {
    publicationHistory: [
      publication(0, { title: '아파트 신고가 20억원', exposure: 1000 }),
      publication(1, { title: '아파트 신고가 18억원', exposure: 900 }),
      publication(2, { title: '기준금리 동결', exposure: 100 }),
      publication(3, { title: '환율 변동', exposure: 90 }),
    ],
    publications: {},
  };
  const report = buildPerformanceReport([ledger], new Date('2026-08-11T00:00:00Z'));

  assert.equal(report.windows['7d'].categories.economy.samples, 4);
  assert.equal(report.windows['7d'].categories.economy.status, 'insufficient_data');
  assert.equal(report.windows['24h'].categories.economy.samples, 0);
  assert.equal(performancePrior({ category: 'economy', title: '서울 아파트 신고가' }, report).adjustment, 0);
});

test('keeps late historical backfills visible but out of comparable performance samples', () => {
  const onTime = publication(0, { exposure: 500 });
  onTime.reel.updatedAt = '2026-08-01T00:00:00Z';
  onTime.insights.windows = {
    '24h': {
      ...onTime.insights.windows['7d'],
      collectedAt: '2026-08-02T03:00:00Z',
    },
  };
  const late = publication(1, { exposure: 5000 });
  late.reel.updatedAt = '2026-08-01T00:00:00Z';
  late.insights.windows = {
    '24h': {
      ...late.insights.windows['7d'],
      collectedAt: '2026-08-08T00:00:00Z',
    },
  };
  const report = buildPerformanceReport([{ publicationHistory: [onTime, late], publications: {} }]);

  assert.equal(windowTimingStatus(onTime, '24h', onTime.insights.windows['24h']), 'on_time');
  assert.equal(windowTimingStatus(late, '24h', late.insights.windows['24h']), 'late_backfill');
  assert.equal(report.windows['24h'].sampleCount, 1);
  assert.equal(report.windows['24h'].excludedLateBackfills, 1);
  assert.equal(report.windows['24h'].categories.economy.metrics.exposureMedian, 500);
});

test('learns repeated feature lift only after the category sample floor and caps its prior', () => {
  const ledger = {
    publicationHistory: [
      publication(0, { title: '서울 아파트 신고가 20억원', exposure: 2000 }),
      publication(1, { title: '수도권 아파트 신고가 18억원', exposure: 1800 }),
      publication(2, { title: '아파트 거래 신고가 15억원', exposure: 1600 }),
      publication(3, { title: '기준금리 동결', exposure: 300 }),
      publication(4, { title: '환율 보합', exposure: 250 }),
      publication(5, { title: 'GDP 성장률', exposure: 200 }),
    ],
    publications: {},
  };
  const report = buildPerformanceReport([ledger], new Date('2026-08-11T00:00:00Z'));
  const economy = report.windows['7d'].categories.economy;
  const housingSignal = economy.featureSignals.find(signal => signal.feature === 'housing_money');
  const prior = performancePrior({
    category: 'economy',
    title: '수도권 아파트 신고가 20억원',
    summary: '주택 거래 절반이 신고가를 기록했습니다.',
  }, report);

  assert.equal(economy.status, 'ready');
  assert.equal(housingSignal.signal, 'winner');
  assert.ok(prior.adjustment > 0);
  assert.ok(prior.adjustment <= PRIOR_MAX);
  assert.equal(prior.window, '7d');
});

test('reports image fallback and music concentration without changing assets', () => {
  const ledger = {
    publicationHistory: Array.from({ length: 5 }, (_, index) => publication(index, {
      exposure: 100 + index,
      imageKind: index < 2 ? 'typographic' : 'web',
      imageSource: index < 2 ? 'diem-original' : 'openverse',
      trackId: 'same-track',
    })),
    publications: {},
  };
  const report = buildPerformanceReport([ledger]);

  assert.equal(report.image.typographyFallbackRate, 40);
  assert.match(report.music.diversityWarning, /100%/u);
  assert.equal(report.music.trackDistribution['same-track'].count, 5);
});

test('keeps operator-deleted publications out of performance learning while preserving the audit count', () => {
  const kept = publication(0, { exposure: 300 });
  const deleted = publication(1, { exposure: 100000 });
  deleted.moderation = {
    action: 'deleted',
    reason: '제목과 기사 상태 불일치',
    deletedAt: '2026-08-14T12:00:00.000Z',
  };

  const report = buildPerformanceReport([{ publicationHistory: [kept, deleted], publications: {} }]);

  assert.equal(report.publishedCount, 1);
  assert.equal(report.windows['7d'].sampleCount, 1);
  assert.equal(report.windows['7d'].categories.economy.metrics.exposureMedian, 300);
  assert.equal(report.operations.moderatedPublications, 1);
});
