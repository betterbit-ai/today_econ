const test = require('node:test');
const assert = require('node:assert/strict');
const { buildExperimentReport } = require('../src/v2/experiment-report');

test('Basic completion and samples exclude late, corrected, retry-only and missing-reach observations', () => {
  const make = (index, window = {}) => ({
    publicationKey: `basic-${index}`, contentType: 'diem_basic', category: 'economy',
    reel: { status: 'published', publishedAt: '2026-10-01T00:00:00Z' },
    insights: { windows: { '7d': { status: 'ok', timingStatus: 'on_time', reach: 100, saved: 1, shares: 1, ...window } } },
  });
  const good = make(0);
  const late = make(1, { timingStatus: 'late_backfill' });
  const corrected = make(2); corrected.moderation = { action: 'corrected', correction: 'fact error' };
  const retry = make(3, { status: 'retry_pending', reach: { value: null, status: 'unavailable' } });
  const unavailable = make(4, { status: 'unavailable', reach: { value: null, status: 'unavailable' } });
  const report = buildExperimentReport([{ publications: {}, publicationHistory: [good, late, corrected, retry, unavailable] }]);
  assert.equal(report.groups.diem_basic.published, 4);
  assert.equal(report.groups.diem_basic.sevenDaySamples, 1);
  assert.equal(report.completion.basicSevenDayObserved, 1);
  assert.equal(report.status, 'collecting');
});

test('Basic uses the same coherent on-time recovered snapshot as news and weekly reports', () => {
  const first = { status: 'retry_pending', timingStatus: 'on_time', collectionStatus: 'partial', media: {
    reach: 100, saved: { value: null, status: 'unavailable' }, shares: { value: null, status: 'unavailable' },
  } };
  const retry = { status: 'ok', timingStatus: 'on_time', collectionStatus: 'complete', media: { reach: 200, saved: 20, shares: 10 } };
  const publication = { publicationKey: 'coherent-basic', contentType: 'diem_basic',
    reel: { status: 'published' }, insights: { windows: { '7d': { ...first, observations: [first, retry] } } },
  };
  const report = buildExperimentReport([{ publications: {}, publicationHistory: [publication] }]);
  assert.equal(report.groups.diem_basic.reachMedian, 200);
  assert.equal(report.groups.diem_basic.savedRateMedian, 10);
});

test('unknown timing Basic cannot advance completion even with high reach', () => {
  const make = index => ({ publicationKey: `unknown-basic-${index}`, contentType: 'diem_basic',
    reel: { status: 'published' }, insights: { windows: { '7d': {
      status: 'ok', timingStatus: 'unknown', reach: 10000, saved: 100, shares: 100,
    } } },
  });
  const report = buildExperimentReport([{ publications: {}, publicationHistory: Array.from({ length: 4 }, (_, index) => make(index)) }]);
  assert.equal(report.status, 'collecting');
  assert.equal(report.completion.basicSevenDayObserved, 0);
  assert.equal(report.groups.diem_basic.sevenDaySamples, 0);
});
