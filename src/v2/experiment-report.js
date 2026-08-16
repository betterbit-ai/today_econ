const fs = require('fs');
const path = require('path');
const { sendAnalyticsReport } = require('../slack');
const { metricNumber } = require('../post-store');
const { allLedgerPublications, listLedgers, saveLedger } = require('./ledger');

const REPORT_JSON = path.join(process.cwd(), 'data', 'reports', 'diem-basic-experiment.json');
const REPORT_MARKDOWN = path.join(process.cwd(), 'data', 'reports', 'diem-basic-experiment.md');

function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function windowMetrics(publication = {}) {
  const window = publication.insights?.windows?.['7d'];
  if (!window) return null;
  return { window, media: window.media || window };
}

function rate(media, key) {
  const reach = metricNumber(media?.reach);
  const value = metricNumber(media?.[key]);
  return reach && value !== null ? Number(((value / reach) * 100).toFixed(2)) : null;
}

function isActivePublished(publication = {}) {
  const deleted = publication.moderation?.action === 'deleted' || Boolean(publication.moderation?.deletedAt);
  return publication.reel?.status === 'published' && !deleted;
}

function groupSummary(publications = [], allPublications = []) {
  const published = publications.filter(isActivePublished);
  const samples = published.map(publication => ({ publication, metrics: windowMetrics(publication) })).filter(item => item.metrics);
  const missing = {
    reach: samples.filter(item => metricNumber(item.metrics.media.reach) === null).length,
    saved: samples.filter(item => metricNumber(item.metrics.media.saved) === null).length,
    shares: samples.filter(item => metricNumber(item.metrics.media.shares) === null).length,
    averageWatchTime: samples.filter(item => metricNumber(item.metrics.media.ig_reels_avg_watch_time) === null).length,
    profileViews: samples.filter(item => metricNumber(item.metrics.window.account?.profile_views) === null).length,
    followerEstimate: samples.filter(item => metricNumber(item.metrics.window.followerDeltaEstimate) === null).length,
  };
  const qualityFailures = allPublications.reduce((count, publication) => (
    count + (publication.generation?.candidateFailures || []).filter(failure => failure.reason === 'quality_gate_failed').length
  ), 0);
  const moderationReasons = publications
    .filter(publication => publication.moderation?.deletedAt || publication.moderation?.correction)
    .map(publication => ({
      publicationKey: publication.publicationKey,
      action: publication.moderation.deletedAt ? 'deleted' : 'corrected',
      reason: publication.moderation.reason || publication.moderation.correction || '사유 미기록',
    }));
  return {
    totalRecords: publications.length,
    published: published.length,
    sevenDaySamples: samples.length,
    qualityFailures,
    rejected: publications.filter(publication => publication.status === 'rejected' || publication.review?.status === 'rejected').length,
    deletedOrCorrected: moderationReasons.length,
    moderationReasons,
    reachMedian: median(samples.map(item => metricNumber(item.metrics.media.reach))),
    savedRateMedian: median(samples.map(item => rate(item.metrics.media, 'saved'))),
    shareRateMedian: median(samples.map(item => rate(item.metrics.media, 'shares'))),
    engagementRateMedian: median(samples.map(item => metricNumber(item.metrics.window.engagementRate))),
    averageWatchTimeMedian: median(samples.map(item => metricNumber(item.metrics.media.ig_reels_avg_watch_time))),
    profileViewsMedian: median(samples.map(item => metricNumber(item.metrics.window.account?.profile_views))),
    followerDeltaEstimateMedian: median(samples.map(item => metricNumber(item.metrics.window.followerDeltaEstimate))),
    followerMetricCaveat: '계정 단위 관측 구간의 증분 추정치이며 단일 Reel 확정 기여가 아닙니다.',
    missing,
  };
}

function buildExperimentReport(ledgers = [], now = new Date()) {
  const all = ledgers.flatMap(ledger => allLedgerPublications(ledger));
  const hot = all.filter(publication => (publication.contentType || 'hot_news') === 'hot_news');
  const basics = all.filter(publication => publication.contentType === 'diem_basic');
  const publishedBasics = basics.filter(isActivePublished);
  const basicsObserved = publishedBasics.filter(publication => {
    const status = publication.insights?.windows?.['7d']?.status;
    return ['ok', 'unavailable'].includes(status);
  });
  return {
    schemaVersion: 1,
    experiment: 'diem_basic_four_week_quality_trial',
    generatedAt: now.toISOString(),
    status: publishedBasics.length >= 4 && basicsObserved.length >= 4 ? 'complete' : 'collecting',
    completion: {
      approvedBasicPublished: publishedBasics.length,
      basicSevenDayObserved: basicsObserved.length,
      requiredEach: 4,
    },
    groups: {
      hot_news: groupSummary(hot, hot),
      diem_basic: groupSummary(basics, basics),
    },
    decisionOptions: ['유지', '수정 후 재시험', '중단'],
    decision: null,
    interpretationRule: '최고 조회수 한 건이 아니라 중앙값, 표본 수, 저장·공유와 누락 지표를 함께 판단합니다.',
  };
}

function display(value, suffix = '') {
  return Number.isFinite(value) ? `${Number(value.toFixed(2)).toLocaleString()}${suffix}` : '집계 불가';
}

function groupMarkdown(label, group) {
  const missing = Object.entries(group.missing).map(([key, value]) => `${key} ${value}`).join(', ');
  return [
    `## ${label}`,
    `- 발행 ${group.published}편 · 7일 표본 ${group.sevenDaySamples}개 · 품질 실패 ${group.qualityFailures}건 · 반려 ${group.rejected}건`,
    `- 7일 도달 중앙값 ${display(group.reachMedian)} · 저장률 ${display(group.savedRateMedian, '%')} · 공유율 ${display(group.shareRateMedian, '%')}`,
    `- 참여율 ${display(group.engagementRateMedian, '%')} · 평균 시청 시간 ${display(group.averageWatchTimeMedian, 'ms')}`,
    `- 프로필 방문 중앙값 ${display(group.profileViewsMedian)} · 팔로워 증분 추정 중앙값 ${display(group.followerDeltaEstimateMedian)}`,
    `- 누락 지표: ${missing}`,
    `- 삭제·정정: ${group.deletedOrCorrected}건${group.moderationReasons.length ? ` · ${group.moderationReasons.map(item => `${item.publicationKey}(${item.reason})`).join(', ')}` : ''}`,
    `- 주의: ${group.followerMetricCaveat}`,
  ].join('\n');
}

function reportMarkdown(report) {
  return [
    '# DIEM 4주 품질·성과 실험',
    '',
    `- 상태: ${report.status}`,
    `- DIEM 기초 발행: ${report.completion.approvedBasicPublished}/${report.completion.requiredEach}`,
    `- DIEM 기초 7일 관측: ${report.completion.basicSevenDayObserved}/${report.completion.requiredEach}`,
    `- 생성 시각: ${report.generatedAt}`,
    '',
    groupMarkdown('핫뉴스', report.groups.hot_news),
    '',
    groupMarkdown('DIEM 기초', report.groups.diem_basic),
    '',
    `판단 원칙: ${report.interpretationRule}`,
    `다음 결정: ${report.decisionOptions.join(' / ')}`,
    '',
  ].join('\n').normalize('NFC');
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, value, 'utf8');
  fs.renameSync(temporary, filePath);
}

function loadPrevious(filePath = REPORT_JSON) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

async function saveExperimentReport({
  ledgers = listLedgers(),
  now = new Date(),
  jsonPath = REPORT_JSON,
  markdownPath = REPORT_MARKDOWN,
  sendReportImpl = sendAnalyticsReport,
} = {}) {
  const previous = loadPrevious(jsonPath);
  const report = buildExperimentReport(ledgers, now);
  const comparable = value => JSON.stringify({ ...value, generatedAt: null });
  if (previous && comparable(previous) === comparable(report)) return previous;
  atomicWrite(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  atomicWrite(markdownPath, reportMarkdown(report));
  if (report.status === 'complete' && previous?.status !== 'complete' && sendReportImpl) {
    await sendReportImpl([
      '📚 *DIEM 기초 4주 실험 관측 완료*',
      `핫뉴스: 7일 도달 중앙값 ${display(report.groups.hot_news.reachMedian)} · 저장률 ${display(report.groups.hot_news.savedRateMedian, '%')}`,
      `DIEM 기초: 7일 도달 중앙값 ${display(report.groups.diem_basic.reachMedian)} · 저장률 ${display(report.groups.diem_basic.savedRateMedian, '%')}`,
      `표본: 핫뉴스 ${report.groups.hot_news.sevenDaySamples}개 · DIEM 기초 ${report.groups.diem_basic.sevenDaySamples}개`,
      'GitHub 리포트를 확인하고 유지 / 수정 후 재시험 / 중단 중 하나를 결정해 주세요.',
    ].join('\n'));
  }
  return report;
}

function recordModeration({
  publicationKey,
  action,
  reason,
  ledgers = listLedgers(),
  saveLedgerImpl = saveLedger,
  now = new Date(),
} = {}) {
  if (!publicationKey) throw new Error('[DIEM Report] publication_key is required.');
  if (!['deleted', 'corrected'].includes(action)) throw new Error('[DIEM Report] action must be deleted or corrected.');
  if (!String(reason || '').trim()) throw new Error('[DIEM Report] moderation reason is required.');
  for (const ledger of ledgers) {
    const next = structuredClone(ledger);
    let target = Object.values(next.publications || {}).find(publication => publication.publicationKey === publicationKey);
    if (!target) target = (next.publicationHistory || []).find(publication => publication.publicationKey === publicationKey);
    if (!target) continue;
    target.moderation = {
      action,
      reason: String(reason).normalize('NFC').trim(),
      recordedAt: now.toISOString(),
      ...(action === 'deleted' ? { deletedAt: now.toISOString() } : { correction: String(reason).normalize('NFC').trim() }),
    };
    return saveLedgerImpl(next);
  }
  throw new Error(`[DIEM Report] Publication not found: ${publicationKey}`);
}

module.exports = {
  REPORT_JSON,
  REPORT_MARKDOWN,
  buildExperimentReport,
  reportMarkdown,
  recordModeration,
  saveExperimentReport,
};
