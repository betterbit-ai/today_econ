const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PRIOR_MAX,
  buildPerformanceReport,
  followerSnapshotSummary,
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
  format = 'flash',
  strategyVersion = 'discovery-funnel-v3',
} = {}) {
  const media = {
    views: metric(Math.round(exposure * 1.25)),
    reach: metric(exposure),
    saved: metric(Math.max(1, Math.round(exposure * 0.02))),
    shares: metric(Math.max(1, Math.round(exposure * 0.03))),
    ig_reels_avg_watch_time: metric(8000 + index),
  };
  return {
    publicationKey: `diem:2026-08-${String(index + 1).padStart(2, '0')}:${category}:run-${index}`,
    category,
    candidate: { title, summary: `${title}에 관한 구체적인 설명입니다.` },
    editorial: { reelFormat: format },
    reel: { status: 'published', externalId: `ig-${index}`, permalink: `https://instagram.com/reel/${index}` },
    analytics: {
      featureSchemaVersion: 3,
      strategyVersion,
      reelDurationSeconds: format === 'explain' ? 13 : 6,
    },
    image: { kind: imageKind, source: imageSource },
    audio: { mode: 'track', trackId, mood: category === 'economy' ? 'steady' : 'serious' },
    insights: {
      windows: {
        '7d': {
          status: 'ok',
          timingStatus: 'on_time',
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
      timingStatus: undefined,
      collectedAt: '2026-08-02T03:00:00Z',
    },
  };
  const late = publication(1, { exposure: 5000 });
  late.reel.updatedAt = '2026-08-01T00:00:00Z';
  late.insights.windows = {
    '24h': {
      ...late.insights.windows['7d'],
      timingStatus: undefined,
      collectedAt: '2026-08-08T00:00:00Z',
    },
  };
  const report = buildPerformanceReport([{ publicationHistory: [onTime, late], publications: {} }]);

  assert.equal(windowTimingStatus(onTime, '24h', onTime.insights.windows['24h']), 'on_time');
  assert.equal(windowTimingStatus(late, '24h', late.insights.windows['24h']), 'late_backfill');
  assert.equal(report.windows['24h'].sampleCount, 1);
  assert.equal(report.windows['24h'].excludedLateBackfills, 1);
  assert.equal(report.windows['24h'].categories.economy.metrics.reachMedian, 500);
});

test('learns repeated feature lift only after the category sample floor and caps its prior', () => {
  const ledger = {
    publicationHistory: [
      publication(0, { title: '서울 아파트 신고가 20억원', exposure: 2000 }),
      publication(1, { title: '수도권 아파트 신고가 18억원', exposure: 1800 }),
      publication(2, { title: '아파트 거래 신고가 15억원', exposure: 1600 }),
      publication(3, { title: '서울 아파트 거래 14억원', exposure: 1500 }),
      publication(4, { title: '아파트 가격 13억원', exposure: 1400 }),
      publication(5, { title: '기준금리 동결', exposure: 300 }),
      publication(6, { title: '환율 보합', exposure: 250 }),
      publication(7, { title: 'GDP 성장률', exposure: 200 }),
      publication(8, { title: '수출 증가', exposure: 180 }),
      publication(9, { title: '기업 실적', exposure: 160 }),
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
  assert.equal(report.image.generatedFallbackRate, 0);
  assert.equal(report.image.combinedFallbackRate, 40);
  assert.match(report.music.diversityWarning, /100%/u);
  assert.equal(report.music.trackDistribution['same-track'].count, 5);
});

test('reports recent Vision transport and JSON failures separately from semantic rejects', () => {
  const jsonFailure = publication(0, { imageKind: 'generated', imageSource: 'diem-generated' });
  jsonFailure.image.attempts = [{ provider: 'vision-review', error: '400 {"code":"json_validate_failed"}' }];
  const accessFailure = publication(1, { imageKind: 'generated', imageSource: 'diem-generated' });
  accessFailure.image.attempts = [{ provider: 'vision-review', error: 'failed to retrieve media: received status code: 403' }];
  const contextFailure = publication(2, { imageKind: 'web', imageSource: 'pexels' });
  contextFailure.image.attempts = [{ provider: 'vision-review', error: 'Neither image depicts the primary article event.' }];
  [jsonFailure, accessFailure, contextFailure].forEach((item, index) => {
    item.publicationKey = `diem:2026-09-09:economy:report-${index}`;
  });

  const report = buildPerformanceReport([{ publicationHistory: [jsonFailure, accessFailure, contextFailure], publications: {} }], new Date('2026-09-09T12:00:00+09:00'));

  assert.equal(report.image.recentSevenDays.publishedCount, 3);
  assert.equal(report.image.recentSevenDays.fallbackCount, 2);
  assert.equal(report.image.recentSevenDays.fallbackRate, 66.67);
  assert.equal(report.image.visionFailureDistribution.json_error.count, 1);
  assert.equal(report.image.visionFailureDistribution.image_access.count, 1);
  assert.equal(report.image.visionFailureDistribution.context_rejected.count, 1);
});

test('keeps model_not_found distinct from other Vision model errors', () => {
  const missing = publication(0, { imageKind: 'generated', imageSource: 'diem-generated' });
  missing.image.attempts = [{ provider: 'vision-review', error: '[DIEM Vision] model_not_found: qwen/qwen3.8-27b' }];
  const generic = publication(1, { imageKind: 'generated', imageSource: 'diem-generated' });
  generic.image.attempts = [{ provider: 'vision-review', error: '[DIEM Vision] model_error: upstream failed' }];
  const report = buildPerformanceReport([{ publicationHistory: [missing, generic], publications: {} }]);
  assert.equal(report.image.visionFailureDistribution.model_not_found.count, 1);
  assert.equal(report.image.visionFailureDistribution.model_error.count, 1);
});

test('does not substitute views when reach is unavailable and reports format cohorts', () => {
  const flash = publication(0, { exposure: 400, format: 'flash' });
  const explain = publication(1, { exposure: 320, format: 'explain', imageKind: 'generated', imageSource: 'diem-generated' });
  const viewsOnly = publication(2, { exposure: 10000 });
  viewsOnly.insights.windows['7d'].media.reach = { value: null, status: 'unavailable' };

  const report = buildPerformanceReport([{ publicationHistory: [flash, explain, viewsOnly], publications: {} }]);
  const window = report.windows['7d'];
  assert.equal(window.sampleCount, 2);
  assert.equal(window.categories.economy.metrics.reachMedian, 360);
  assert.equal(window.cohorts.format.flash.samples, 1);
  assert.equal(window.cohorts.format.explain.samples, 1);
  assert.equal(window.cohorts.image.library.samples, 1);
  assert.equal(window.cohorts.strategyVersion['discovery-funnel-v3'].samples, 2);
  assert.equal(window.cohorts.format.flash.normalizedWatchRatioMedian, 1.3333);
});

test('records reader-need features for later growth comparisons', () => {
  const { featureSet } = require('../src/v2/performance-loop');
  assert.ok(featureSet({ candidate: {
    title: '정책대출 주택가격 기준',
    newsFrame: { eventKind: 'housing_policy', readerNeed: 'housing', subject: '정책대출' },
  } }).includes('reader_need:housing'));
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
  assert.equal(report.windows['7d'].categories.economy.metrics.reachMedian, 300);
  assert.equal(report.operations.moderatedPublications, 1);
  assert.equal(report.successCriteria.qualityIncidents.value, 1);
});

test('keeps legacy quality incidents in the audit without failing the v3 success target', () => {
  const legacyDeleted = publication(0, { strategyVersion: 'legacy' });
  legacyDeleted.analytics.featureSchemaVersion = 2;
  legacyDeleted.moderation = { action: 'deleted', reason: 'legacy correction' };
  const report = buildPerformanceReport([{ publicationHistory: [legacyDeleted], publications: {} }]);
  assert.equal(report.operations.qualityIncidentCount, 1);
  assert.equal(report.operations.strategyQualityIncidentCount, 0);
  assert.equal(report.successCriteria.qualityIncidents.value, 0);
});

test('deduplicates overlapping account follower snapshots instead of summing post deltas', () => {
  const first = publication(0);
  const second = publication(1);
  for (const item of [first, second]) {
    item.insights.windows['7d'].collectedAt = '2026-09-29T00:00:00.000Z';
    item.insights.windows['7d'].account = { follower_count: metric(334) };
  }
  const latest = publication(2);
  latest.insights.windows['7d'].collectedAt = '2026-09-30T00:00:00.000Z';
  latest.insights.windows['7d'].account = { follower_count: metric(337) };
  assert.deepEqual(followerSnapshotSummary([first, second, latest]), {
    periodDays: 14,
    snapshots: 2,
    first: { collectedAt: '2026-09-29T00:00:00.000Z', followers: 334 },
    latest: { collectedAt: '2026-09-30T00:00:00.000Z', followers: 337 },
    netChange: 3,
    attribution: 'deduplicated_14d_account_snapshots_not_summed_post_deltas',
  });
});

test('evaluates final reach targets only from strategy v3 on-time samples', () => {
  const current = Array.from({ length: 10 }, (_, index) => publication(index, { exposure: 300 + index }));
  const legacy = publication(99, { exposure: 100000, strategyVersion: 'legacy' });
  legacy.analytics.featureSchemaVersion = 2;
  for (const item of [...current, legacy]) {
    item.insights.windows['24h'] = item.insights.windows['7d'];
  }
  const report = buildPerformanceReport([{ publicationHistory: [...current, legacy], publications: {} }]);
  assert.equal(report.windows['24h'].categories.economy.samples, 11);
  assert.equal(report.successCriteria.economyReachMedian.samples, 10);
  assert.equal(report.successCriteria.economyReachMedian.value, 304.5);
});

test('Basic is separate from news learning and legacy unknown duration is not invented', () => {
  const news = publication(0);
  delete news.analytics.reelDurationSeconds;
  const basic = publication(1, { exposure: 100000 });
  basic.contentType = 'diem_basic';
  const report = buildPerformanceReport([{ publicationHistory: [news, basic], publications: {} }]);
  assert.equal(report.publishedCount, 1);
  assert.equal(report.basicPublishedCount, 1);
  assert.equal(report.windows['7d'].categories.economy.samples, 1);
  assert.equal(report.windows['7d'].cohorts.format.flash.normalizedWatchRatioMedian, null);
});

test('flash-only goals do not require explain samples; enabled explain still requires five', () => {
  const publications = Array.from({ length: 20 }, (_, index) => publication(index, {
    category: index < 10 ? 'economy' : 'issue', exposure: 400,
  }));
  for (const item of publications) item.insights.windows['24h'] = {
    ...item.insights.windows['7d'], collectedAt: '2026-10-01T00:00:00Z',
    account: { follower_count: metric(334) },
  };
  publications[1].insights.windows['24h'].collectedAt = '2026-10-02T00:00:00Z';
  publications[1].insights.windows['24h'].account = { follower_count: metric(335) };
  const ledgers = [{ publicationHistory: publications, publications: {} }];
  const disabled = buildPerformanceReport(ledgers, new Date('2026-10-02T00:00:00Z'), { explainReelsEnabled: false });
  assert.equal(disabled.successCriteria.explainWatchRatio.status, 'not_applicable');
  assert.equal(disabled.successCriteria.status, 'achieved');
  const enabled = buildPerformanceReport(ledgers, new Date('2026-10-02T00:00:00Z'), { explainReelsEnabled: true });
  assert.equal(enabled.successCriteria.status, 'insufficient_data');
  assert.equal(enabled.successCriteria.explainWatchRatio.minimumSamples, 5);
});

test('missing save and share metrics do not become negative utility observations', () => {
  const missing = publication(0);
  missing.insights.windows['7d'].media.saved = { value: null, status: 'unavailable' };
  missing.insights.windows['7d'].media.shares = { value: null, status: 'unavailable' };
  const report = buildPerformanceReport([{ publicationHistory: [missing], publications: {} }]);
  assert.equal(report.windows['7d'].categories.economy.metrics.positiveSaveOrShareRate, null);
});

test('follower snapshots retain retry observations without double counting the primary', () => {
  const item = publication(0);
  const first = { collectedAt: '2026-10-01T00:00:00Z', account: { follower_count: metric(334) } };
  const last = { collectedAt: '2026-10-02T00:00:00Z', account: { follower_count: metric(336) } };
  item.insights.windows['24h'] = { ...first, observations: [first, last] };
  item.insights.windows['7d'] = first;
  const summary = followerSnapshotSummary([item], new Date('2026-10-02T00:00:00Z'));
  assert.equal(summary.snapshots, 2);
  assert.equal(summary.netChange, 2);
});

test('reports recover a complete on-time retry as one coherent snapshot while keeping late retries excluded', () => {
  const item = publication(0);
  const first = { status: 'retry_pending', timingStatus: 'on_time', collectionStatus: 'partial',
    media: { reach: metric(100), saved: { value: null, status: 'unavailable' }, shares: { value: null, status: 'unavailable' } } };
  const retry = { status: 'ok', timingStatus: 'on_time', collectionStatus: 'complete',
    media: { reach: metric(200), saved: metric(20), shares: metric(10), ig_reels_avg_watch_time: metric(3000) } };
  const late = { status: 'ok', timingStatus: 'late_backfill', collectionStatus: 'complete',
    media: { reach: metric(9000), saved: metric(900), shares: metric(900), ig_reels_avg_watch_time: metric(6000) } };
  item.insights.windows['24h'] = { ...first, observations: [first, retry, late] };
  const report = buildPerformanceReport([{ publications: {}, publicationHistory: [item] }]);
  const metrics = report.windows['24h'].categories.economy.metrics;
  assert.equal(metrics.reachMedian, 200);
  assert.equal(metrics.savedRateMedian, 10);
  assert.equal(metrics.shareRateMedian, 5);
  assert.equal(metrics.normalizedWatchRatioMedian, 0.5);
  assert.equal(item.insights.windows['24h'].media.reach.value, 100);
});

test('unknown timing never enters comparable samples or growth goals; timestamps can prove on-time collection', () => {
  const { selectWindowObservation, sampleFor } = require('../src/v2/performance-loop');
  const unknown = publication(0, { exposure: 10000 });
  unknown.insights.windows['24h'] = { ...unknown.insights.windows['7d'], timingStatus: 'unknown' };
  assert.equal(selectWindowObservation(unknown, '24h'), null);
  assert.equal(sampleFor(unknown, '24h'), null);
  const report = buildPerformanceReport([{ publications: {}, publicationHistory: [unknown] }]);
  assert.equal(report.windows['24h'].sampleCount, 0);
  assert.equal(report.successCriteria.economyReachMedian.samples, 0);
  assert.equal(unknown.insights.windows['24h'].media.reach.value, 10000);
  const inferred = publication(1);
  inferred.reel.publishedAt = '2026-10-01T00:00:00Z';
  inferred.insights.windows['24h'] = { ...inferred.insights.windows['7d'], timingStatus: undefined, collectedAt: '2026-10-02T06:00:00Z' };
  assert.equal(windowTimingStatus(inferred, '24h', inferred.insights.windows['24h']), 'on_time');
  assert.equal(sampleFor(inferred, '24h').reach, 100);
});

test('inferred pre-window measurements cannot count as on-time observations', () => {
  const { selectWindowObservation, sampleFor } = require('../src/v2/performance-loop');
  const early = publication(0);
  early.reel.publishedAt = '2026-10-01T00:00:00Z';
  early.insights.windows['24h'] = { ...early.insights.windows['7d'], timingStatus: undefined, collectedAt: '2026-10-01T06:00:00Z' };
  assert.equal(windowTimingStatus(early, '24h', early.insights.windows['24h']), 'early_collection');
  assert.equal(selectWindowObservation(early, '24h'), null);
  assert.equal(sampleFor(early, '24h'), null);
});
