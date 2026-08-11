const fs = require('fs');
const path = require('path');
const { metricNumber } = require('../post-store');
const { allLedgerPublications, listLedgers } = require('./ledger');
const { normalizeNfc } = require('./text');

const REPORT_JSON = path.join(process.cwd(), 'data', 'reports', 'diem-performance.json');
const REPORT_MARKDOWN = path.join(process.cwd(), 'data', 'reports', 'diem-performance.md');
const OBSERVATION_WINDOWS = Object.freeze(['24h', '72h', '7d']);
const MIN_CATEGORY_SAMPLES = 5;
const MIN_FEATURE_SAMPLES = 3;
const PRIOR_MIN = -6;
const PRIOR_MAX = 8;
const WINDOW_HOURS = Object.freeze({ '24h': 24, '72h': 72, '7d': 168 });
const MAX_WINDOW_LATENESS_HOURS = Object.freeze({ '24h': 12, '72h': 12, '7d': 24 });

function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function rate(media = {}, key) {
  const reach = metricNumber(media.reach);
  const value = metricNumber(media[key]);
  return reach && value !== null ? Number(((value / reach) * 100).toFixed(3)) : null;
}

function featureSet(input = {}) {
  const candidate = input.candidate || input;
  const frame = candidate.newsFrame || input.duplicateCheck?.signature || {};
  const text = normalizeNfc([
    candidate.title,
    candidate.summary,
    frame.subject,
    frame.event,
    frame.eventLabel,
  ].filter(Boolean).join(' '));
  const features = new Set();
  if (/\d/u.test(text)) features.add('concrete_number');
  if (/(아파트|주택|부동산|전세|월세|집값|신고가|실거주)/u.test(text)) features.add('housing_money');
  if (/(지원금|현금\s*지원|보조금|민생지원|세금|보험료|연금|소득|임금|퇴직)/u.test(text)) features.add('household_money');
  if (/(취업|고용|일자리|퇴사|휴가|근로|노동|직장)/u.test(text)) features.add('work_life');
  if (/(사이드카|서킷브레이커|폭락|폭등|급락|급등|신고가)/u.test(text)) features.add('market_shock');
  if (/(금리|환율|물가|GDP|성장률)/iu.test(text)) features.add('macro_indicator');
  if (/(실적|영업이익|매출|인수|합병|IPO|상장)/iu.test(text)) features.add('company_event');
  if (/(대통령|정부|정책|법안|국회|법원|판결|시행|폐지|확정)/u.test(text)) features.add('public_decision');
  if (frame.eventKind) features.add(`event:${frame.eventKind}`);
  return [...features].sort();
}

function windowTimingStatus(publication = {}, windowLabel, window = {}) {
  if (window.timingStatus) return window.timingStatus;
  const publishedAt = new Date(
    publication.reel?.publishedAt
    || publication.reel?.updatedAt
    || publication.publishedAt
  );
  const collectedAt = new Date(window.collectedAt);
  if (!Number.isFinite(publishedAt.getTime()) || !Number.isFinite(collectedAt.getTime())) return 'unknown';
  const targetHours = WINDOW_HOURS[windowLabel];
  if (!targetHours) return 'unknown';
  const latenessHours = (
    collectedAt.getTime()
    - publishedAt.getTime()
    - targetHours * 3600000
  ) / 3600000;
  return latenessHours > (MAX_WINDOW_LATENESS_HOURS[windowLabel] ?? 12)
    ? 'late_backfill'
    : 'on_time';
}

function sampleFor(publication = {}, windowLabel) {
  if (publication.reel?.status !== 'published') return null;
  const window = publication.insights?.windows?.[windowLabel];
  if (!window || !['ok', 'unavailable'].includes(window.status)) return null;
  if (windowTimingStatus(publication, windowLabel, window) === 'late_backfill') return null;
  const media = window.media || window;
  const views = metricNumber(media.views);
  const reach = metricNumber(media.reach);
  const exposure = views ?? reach;
  if (exposure === null) return null;
  return {
    publicationKey: publication.publicationKey,
    category: publication.category,
    title: publication.editorial?.title?.text?.replace(/\n/gu, ' / ')
      || publication.candidate?.title
      || '제목 미정',
    permalink: publication.reel?.permalink || null,
    exposure,
    views,
    reach,
    savedRate: rate(media, 'saved'),
    shareRate: rate(media, 'shares'),
    engagementRate: metricNumber(window.engagementRate),
    averageWatchTime: metricNumber(media.ig_reels_avg_watch_time),
    followerDeltaEstimate: metricNumber(window.followerDeltaEstimate),
    features: featureSet(publication),
    image: {
      kind: publication.image?.kind || 'unknown',
      source: publication.image?.source || 'unknown',
    },
    audio: {
      mode: publication.audio?.mode || (publication.audio?.trackId ? 'track' : 'unknown'),
      trackId: publication.audio?.trackId || null,
      mood: publication.audio?.mood || null,
    },
  };
}

function featureSignals(samples = [], baselineExposure) {
  const groups = new Map();
  for (const sample of samples) {
    for (const feature of sample.features) {
      if (!groups.has(feature)) groups.set(feature, []);
      groups.get(feature).push(sample.exposure);
    }
  }
  return [...groups.entries()].map(([feature, exposures]) => {
    const featureMedian = median(exposures);
    const lift = baselineExposure && featureMedian !== null
      ? Number((featureMedian / baselineExposure).toFixed(3))
      : null;
    return {
      feature,
      samples: exposures.length,
      exposureMedian: featureMedian,
      lift,
      signal: exposures.length < MIN_FEATURE_SAMPLES || lift === null
        ? 'insufficient_data'
        : lift >= 1.35
          ? 'winner'
          : lift <= 0.7
            ? 'underperformer'
            : 'neutral',
    };
  }).sort((left, right) => (right.lift ?? -1) - (left.lift ?? -1));
}

function summarizeCategory(samples = []) {
  const exposureMedian = median(samples.map(sample => sample.exposure));
  const enough = samples.length >= MIN_CATEGORY_SAMPLES;
  const ranked = [...samples].sort((left, right) => right.exposure - left.exposure);
  return {
    status: enough ? 'ready' : 'insufficient_data',
    samples: samples.length,
    minimumSamples: MIN_CATEGORY_SAMPLES,
    metrics: {
      exposureMedian,
      viewsMedian: median(samples.map(sample => sample.views)),
      reachMedian: median(samples.map(sample => sample.reach)),
      savedRateMedian: median(samples.map(sample => sample.savedRate)),
      shareRateMedian: median(samples.map(sample => sample.shareRate)),
      engagementRateMedian: median(samples.map(sample => sample.engagementRate)),
      averageWatchTimeMedian: median(samples.map(sample => sample.averageWatchTime)),
      followerDeltaEstimateMedian: median(samples.map(sample => sample.followerDeltaEstimate)),
    },
    winners: enough && exposureMedian
      ? ranked.filter(sample => sample.exposure >= exposureMedian * 1.5).slice(0, 5)
      : [],
    underperformers: enough && exposureMedian
      ? ranked.filter(sample => sample.exposure <= exposureMedian * 0.5).slice(-5).reverse()
      : [],
    featureSignals: enough ? featureSignals(samples, exposureMedian) : [],
    caveat: '같은 관찰 구간의 표본만 비교하며 계정 팔로워 증분은 단일 Reel 확정 기여가 아닙니다.',
  };
}

function distribution(values = []) {
  const counts = values.reduce((result, value) => {
    const key = value || 'unknown';
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  const total = values.length;
  return Object.fromEntries(Object.entries(counts)
    .sort((left, right) => right[1] - left[1])
    .map(([key, count]) => [key, {
      count,
      share: total ? Number(((count / total) * 100).toFixed(2)) : 0,
    }]));
}

function chooseLearningWindow(windows = {}, category) {
  return ['7d', '72h', '24h'].find(label => (
    windows[label]?.categories?.[category]?.status === 'ready'
  )) || null;
}

function buildPerformanceReport(ledgers = [], now = new Date()) {
  const seenRecords = new Set();
  const records = ledgers.flatMap(allLedgerPublications).filter(publication => {
    if (!publication.publicationKey || seenRecords.has(publication.publicationKey)) return false;
    seenRecords.add(publication.publicationKey);
    return true;
  });
  const seen = new Set();
  const publications = records.filter(publication => {
    if (!publication.publicationKey || seen.has(publication.publicationKey)) return false;
    seen.add(publication.publicationKey);
    return publication.reel?.status === 'published';
  });
  const windows = Object.fromEntries(OBSERVATION_WINDOWS.map(windowLabel => {
    const samples = publications.map(publication => sampleFor(publication, windowLabel)).filter(Boolean);
    const excludedLateBackfills = publications.filter(publication => {
      const window = publication.insights?.windows?.[windowLabel];
      return window && windowTimingStatus(publication, windowLabel, window) === 'late_backfill';
    }).length;
    return [windowLabel, {
      sampleCount: samples.length,
      excludedLateBackfills,
      categories: {
        economy: summarizeCategory(samples.filter(sample => sample.category === 'economy')),
        issue: summarizeCategory(samples.filter(sample => sample.category === 'issue')),
      },
    }];
  }));
  const trackDistribution = distribution(publications
    .filter(publication => publication.audio?.mode !== 'silent')
    .map(publication => publication.audio?.trackId));
  const largestTrackShare = Math.max(0, ...Object.values(trackDistribution).map(value => value.share));
  const learningWindows = {
    economy: chooseLearningWindow(windows, 'economy'),
    issue: chooseLearningWindow(windows, 'issue'),
  };
  return {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    status: Object.values(learningWindows).some(Boolean) ? 'ready' : 'insufficient_data',
    observationRule: '24h, 72h, 7d 지표를 섞지 않고 카테고리별 표본 5편 이상에서만 패턴을 학습합니다.',
    publishedCount: publications.length,
    operations: {
      totalRuns: records.length,
      noPublishReasons: distribution(records
        .filter(publication => publication.status === 'no_publish')
        .map(publication => publication.reason)),
      candidateFailureReasons: distribution(records.flatMap(publication => (
        publication.generation?.candidateFailures || []
      )).map(failure => failure.reason)),
      titleRepairFailures: records.flatMap(publication => (
        publication.generation?.candidateFailures || []
      )).flatMap(failure => failure.modelAttempts || [])
        .filter(attempt => attempt.stage === 'title_repair' && attempt.status === 'failed').length,
    },
    windows,
    learningWindows,
    image: {
      kindDistribution: distribution(publications.map(publication => publication.image?.kind)),
      sourceDistribution: distribution(publications.map(publication => publication.image?.source)),
      typographyFallbackRate: publications.length
        ? Number((publications.filter(publication => publication.image?.kind === 'typographic').length / publications.length * 100).toFixed(2))
        : null,
    },
    music: {
      trackDistribution,
      moodDistribution: distribution(publications.map(publication => publication.audio?.mood)),
      diversityWarning: largestTrackShare > 20
        ? `한 트랙이 비민감 Reel의 ${largestTrackShare}%를 차지합니다.`
        : null,
      decisionRule: '한 트랙 사용률이 20%를 넘거나 충분한 표본에서 반복 피로가 확인될 때만 음원을 추가합니다.',
    },
  };
}

function performancePrior(candidate = {}, report = {}, { category = candidate.category } = {}) {
  const windowLabel = report.learningWindows?.[category];
  const categoryReport = windowLabel ? report.windows?.[windowLabel]?.categories?.[category] : null;
  if (!categoryReport || categoryReport.status !== 'ready') {
    return { adjustment: 0, window: null, matched: [], reason: 'insufficient_performance_samples' };
  }
  const currentFeatures = new Set(featureSet(candidate));
  const matched = (categoryReport.featureSignals || []).filter(signal => (
    currentFeatures.has(signal.feature)
    && signal.samples >= MIN_FEATURE_SAMPLES
    && ['winner', 'underperformer'].includes(signal.signal)
  ));
  const raw = matched.reduce((score, signal) => (
    score + (signal.signal === 'winner' ? 4 : -3)
  ), 0);
  return {
    adjustment: Math.max(PRIOR_MIN, Math.min(PRIOR_MAX, raw)),
    window: windowLabel,
    matched,
    reason: matched.length ? 'bounded_evidence_prior' : 'no_repeated_feature_signal',
  };
}

function display(value, suffix = '') {
  return Number.isFinite(value) ? `${Number(value.toFixed(2)).toLocaleString()}${suffix}` : '집계 불가';
}

function performanceMarkdown(report) {
  const lines = [
    '# DIEM 지속 성과 리포트',
    '',
    `- 상태: ${report.status}`,
    `- 발행 원장 Reel: ${report.publishedCount}편`,
    `- 생성 시각: ${report.generatedAt}`,
    `- 원칙: ${report.observationRule}`,
    '',
  ];
  for (const windowLabel of OBSERVATION_WINDOWS) {
    lines.push(`## ${windowLabel}`);
    for (const category of ['economy', 'issue']) {
      const summary = report.windows[windowLabel].categories[category];
      lines.push(`- ${category}: 표본 ${summary.samples}편 · 노출 중앙값 ${display(summary.metrics.exposureMedian)} · 공유율 ${display(summary.metrics.shareRateMedian, '%')} · 저장률 ${display(summary.metrics.savedRateMedian, '%')}`);
      if (summary.winners.length) lines.push(`  - 반복 후보: ${summary.winners.map(item => `${item.title}(${display(item.exposure)})`).join(', ')}`);
      if (summary.underperformers.length) lines.push(`  - 부진 후보: ${summary.underperformers.map(item => `${item.title}(${display(item.exposure)})`).join(', ')}`);
      const signals = summary.featureSignals.filter(signal => signal.signal !== 'neutral').slice(0, 8);
      if (signals.length) lines.push(`  - 특성 신호: ${signals.map(signal => `${signal.feature} ${signal.signal}×${display(signal.lift)}`).join(', ')}`);
    }
    if (report.windows[windowLabel].excludedLateBackfills) {
      lines.push(`- 정시 비교에서 제외한 늦은 백필: ${report.windows[windowLabel].excludedLateBackfills}편`);
    }
    lines.push('');
  }
  lines.push('## 이미지·음악 운영');
  lines.push(`- 타이포그래피 폴백률: ${display(report.image.typographyFallbackRate, '%')}`);
  lines.push(`- 이미지 공급원: ${Object.entries(report.image.sourceDistribution).map(([key, value]) => `${key} ${value.count}편`).join(', ') || '기록 없음'}`);
  lines.push(`- 음악: ${report.music.diversityWarning || '현재 20% 초과 단일 트랙 편중 경고 없음'}`);
  lines.push(`- 음악 판단 원칙: ${report.music.decisionRule}`);
  lines.push(`- 편집 후보 실패: ${Object.entries(report.operations.candidateFailureReasons).map(([key, value]) => `${key} ${value.count}건`).join(', ') || '기록 없음'}`);
  lines.push(`- 제목 재정제 실패: ${report.operations.titleRepairFailures}건`);
  lines.push('');
  lines.push('## 해석 주의');
  lines.push('- 한 건의 바이럴이나 부진으로 주제를 금지하지 않습니다. 표본 하한과 중앙값을 함께 봅니다.');
  lines.push('- 도달은 발견 가능성, 공유·저장은 효용, 팔로워 증분은 계정 단위 추정치로 분리해 해석합니다.');
  lines.push('');
  return lines.join('\n').normalize('NFC');
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, value, 'utf8');
  fs.renameSync(temporary, filePath);
}

function savePerformanceReport({
  ledgers = listLedgers(),
  now = new Date(),
  jsonPath = REPORT_JSON,
  markdownPath = REPORT_MARKDOWN,
} = {}) {
  const report = buildPerformanceReport(ledgers, now);
  atomicWrite(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  atomicWrite(markdownPath, performanceMarkdown(report));
  return report;
}

function loadPerformanceReport(filePath = REPORT_JSON) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

module.exports = {
  MIN_CATEGORY_SAMPLES,
  MIN_FEATURE_SAMPLES,
  OBSERVATION_WINDOWS,
  PRIOR_MAX,
  PRIOR_MIN,
  REPORT_JSON,
  REPORT_MARKDOWN,
  buildPerformanceReport,
  featureSet,
  loadPerformanceReport,
  performanceMarkdown,
  performancePrior,
  savePerformanceReport,
  windowTimingStatus,
};
