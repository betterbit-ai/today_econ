const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getAccountInsights, getMediaInsights } = require('./instagram');
const { calculateEngagementRate, metricNumber, metricRecord } = require('./post-store');
const { sendAnalyticsReport } = require('./slack');
const { resolveInstagramToken } = require('./token-vault');
const { allLedgerPublications, listLedgers, saveLedger } = require('./v2/ledger');

const WINDOWS = Object.freeze([
  { label: '24h', hours: 24 },
  { label: '72h', hours: 72 },
  { label: '7d', hours: 168 },
]);
const ACCOUNT_METRICS = Object.freeze(['follower_count', 'profile_views', 'follows_and_unfollows']);
const STATE_FILE = path.join(__dirname, '..', 'data', 'analytics-state.json');
const MAX_WINDOW_ATTEMPTS = 3;
const RETRY_DELAY_HOURS = 6;

function loadState(filePath = STATE_FILE) {
  if (!fs.existsSync(filePath)) return { weeklyReports: [] };
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return { weeklyReports: [] };
  }
}

function saveState(state, filePath = STATE_FILE) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function windowNeedsCollection(record, now = new Date()) {
  if (!record) return true;
  if (record.status !== 'retry_pending') return false;
  if ((record.attempts || 0) >= MAX_WINDOW_ATTEMPTS) return false;
  return !record.nextRetryAt || new Date(record.nextRetryAt).getTime() <= now.getTime();
}

function dueWindows(post, now = new Date()) {
  const publishedAt = new Date(post.publishedAt);
  if (!Number.isFinite(publishedAt.getTime())) return [];
  const ageHours = (now.getTime() - publishedAt.getTime()) / 3600000;
  return WINDOWS.filter(window => (
    ageHours >= window.hours
    && windowNeedsCollection(post.metrics?.[window.label], now)
  ));
}

function latestMetrics(post) {
  return post.metrics?.['7d'] || post.metrics?.['72h'] || post.metrics?.['24h'] || null;
}

function displayMetric(metrics, key) {
  const record = metricRecord(metrics?.[key]);
  return record.status === 'ok' ? record.value : '집계 불가';
}

function displayRate(value) {
  const record = metricRecord(value);
  return record.status === 'ok' ? `${record.value}%` : '집계 불가';
}

function median(values = []) {
  const numeric = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (numeric.length === 0) return null;
  const middle = Math.floor(numeric.length / 2);
  return numeric.length % 2 ? numeric[middle] : (numeric[middle - 1] + numeric[middle]) / 2;
}

function medianRate(posts, numerator) {
  const rates = posts.map(({ metrics }) => {
    const reach = metricNumber(metrics.reach);
    const value = metricNumber(metrics[numerator]);
    return reach && value !== null ? Number(((value / reach) * 100).toFixed(2)) : null;
  });
  return median(rates);
}

function displayNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)).toLocaleString() : '집계 불가';
}

function contentType(post = {}) {
  return post.contentType || post.format || 'unknown';
}

function buildWeeklyReport(posts, now = new Date()) {
  const since = now.getTime() - 7 * 24 * 3600000;
  const recent = posts.filter(post => new Date(post.publishedAt).getTime() >= since && latestMetrics(post));
  if (recent.length === 0) return '📊 DIEM 주간 리포트\n이번 주에는 집계 가능한 게시물이 아직 없어요.';

  const ranked = recent
    .map(post => ({ post, metrics: latestMetrics(post) }))
    .sort((a, b) => (metricNumber(b.metrics.engagementRate) ?? -1) - (metricNumber(a.metrics.engagementRate) ?? -1));
  const reachMedian = median(ranked.map(item => metricNumber(item.metrics.reach)));
  const savedRateMedian = medianRate(ranked, 'saved');
  const shareRateMedian = medianRate(ranked, 'shares');
  const missingCount = ranked.filter(item => (
    metricNumber(item.metrics.reach) === null
    || metricNumber(item.metrics.saved) === null
    || metricNumber(item.metrics.shares) === null
  )).length;
  const top = ranked[0];
  const topMeta = top.post.contentMetadata || {};
  const formatSummary = [...ranked.reduce((groups, item) => {
    const format = contentType(item.post);
    const current = groups.get(format) || { count: 0, reach: 0, saved: 0, shares: 0 };
    current.count += 1;
    current.reach += metricNumber(item.metrics.reach) ?? 0;
    current.saved += metricNumber(item.metrics.saved) ?? 0;
    current.shares += metricNumber(item.metrics.shares) ?? 0;
    groups.set(format, current);
    return groups;
  }, new Map()).entries()]
    .map(([format, metrics]) => `${format}: ${metrics.count}개 · 도달 ${metrics.reach.toLocaleString()} · 저장 ${metrics.saved.toLocaleString()} · 공유 ${metrics.shares.toLocaleString()}`)
    .join('\n');

  return [
    '📊 *DIEM 주간 품질·성장 리포트*',
    `게시물 ${ranked.length}개 · 7일 도달 중앙값 ${displayNumber(reachMedian)} · 저장률 ${displayNumber(savedRateMedian)}% · 공유율 ${displayNumber(shareRateMedian)}%`,
    missingCount ? `⚠️ 일부 지표 누락 ${missingCount}개 · 누락값은 0으로 계산하지 않았습니다.` : '✅ 핵심 지표 누락 없음',
    formatSummary ? `\n*콘텐츠 유형별 성과*\n${formatSummary}` : '',
    '',
    `🏆 *반응 1위*: <${top.post.permalink}|${top.post.articleTitle}>`,
    `참여율 ${displayRate(top.metrics.engagementRate)} · 형식 ${contentType(top.post)} · 주제 ${topMeta.topic || '미분류'} · 채널 ${topMeta.money_channel || '미분류'} · 훅 ${topMeta.hook_type || '미분류'}`,
    '',
    '판단 원칙: 최고 조회수 한 건이 아니라 중앙값·저장·공유와 표본 수를 함께 봅니다.',
  ].join('\n');
}

function kstWeekKey(now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600000);
  const day = kst.getUTCDay();
  const monday = new Date(kst);
  monday.setUTCDate(kst.getUTCDate() - ((day + 6) % 7));
  return monday.toISOString().slice(0, 10);
}

function measurementTargetsFromLedgers(ledgers = []) {
  const targets = [];
  const seen = new Set();
  for (const ledger of ledgers) {
    for (const publication of allLedgerPublications(ledger)) {
      const mediaId = publication?.reel?.externalId;
      if (publication?.reel?.status !== 'published' || !mediaId) continue;
      const key = publication.publicationKey || String(mediaId);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({
        ledger,
        publication,
        publicationKey: key,
        mediaId: String(mediaId),
        permalink: publication.reel.permalink || '',
        publishedAt: publication.reel.publishedAt || publication.reel.updatedAt || publication.publishedAt || ledger.updatedAt,
        articleTitle: publication.candidate?.title || publication.editorial?.title?.text?.replace(/\n/gu, ' ') || '제목 미정',
        articleUrl: publication.candidate?.url || '',
        category: publication.category,
        contentType: publication.contentType || publication.editorial?.contentType || 'hot_news',
        format: 'reel',
        metrics: publication.insights?.windows || {},
        contentMetadata: publication.editorial?.contentMetadata || {},
      });
    }
  }
  return targets;
}

function unavailableRecords(metrics, reason) {
  return Object.fromEntries(metrics.map(metric => [metric, {
    value: null,
    status: 'unavailable',
    reason,
  }]));
}

function metricFailureReason(metrics = {}) {
  const reasons = Object.values(metrics)
    .filter(value => value?.status === 'unavailable' && value.reason)
    .map(value => String(value.reason).replace(/\s+/gu, ' ').trim());
  return reasons[0] || 'Instagram에서 집계 가능한 지표를 반환하지 않았습니다.';
}

function hasAnyMetric(metrics = {}) {
  return Object.values(metrics).some(value => value?.status === 'ok');
}

function nextRetryAt(now) {
  return new Date(now.getTime() + RETRY_DELAY_HOURS * 3600000).toISOString();
}

function followerDeltaEstimate(baselineAccount = {}, currentAccount = {}) {
  const baseline = metricNumber(baselineAccount.follower_count);
  const current = metricNumber(currentAccount.follower_count);
  if (baseline === null || current === null) {
    return {
      value: null,
      status: 'unavailable',
      reason: 'baseline or current follower_count unavailable',
      attribution: 'account_window_estimate',
    };
  }
  return {
    value: current - baseline,
    status: 'ok',
    attribution: 'account_window_estimate',
    caveat: '동일 기간의 다른 게시물과 외부 유입이 포함된 계정 증분 추정치',
  };
}

function snapshotLine({ post, window, metrics }) {
  const unavailableReason = hasAnyMetric(metrics.media || metrics)
    ? ''
    : ` · 원인 ${metricFailureReason(metrics.media || metrics).slice(0, 180)}`;
  return `• ${window} · ${contentType(post)} · <${post.permalink}|${post.articleTitle}> · 도달 ${displayMetric(metrics, 'reach')} · 저장 ${displayMetric(metrics, 'saved')} · 공유 ${displayMetric(metrics, 'shares')} · 참여율 ${displayRate(metrics.engagementRate)}${unavailableReason}`;
}

async function collectInsights({
  now = new Date(),
  fetchImpl = fetch,
  listLedgersImpl = listLedgers,
  saveLedgerImpl = saveLedger,
  resolveTokenImpl = resolveInstagramToken,
  getMediaInsightsImpl = getMediaInsights,
  getAccountInsightsImpl = getAccountInsights,
  sendAnalyticsReportImpl = sendAnalyticsReport,
  loadStateImpl = loadState,
  saveStateImpl = saveState,
} = {}) {
  const ledgers = listLedgersImpl();
  const targets = measurementTargetsFromLedgers(ledgers);
  if (targets.length === 0) return [];
  const instagramToken = resolveTokenImpl();
  let accountMetrics;
  try {
    accountMetrics = await getAccountInsightsImpl({
      userId: config.instagramUserId,
      token: instagramToken,
      version: config.instagramApiVersion,
      metrics: ACCOUNT_METRICS,
      fetchImpl,
    });
  } catch (error) {
    accountMetrics = unavailableRecords(ACCOUNT_METRICS, error.message);
  }

  const collected = [];
  const changedLedgers = new Set();
  for (const post of targets) {
    const publication = post.publication;
    publication.insights ||= { baseline: null, windows: {} };
    publication.insights.windows ||= {};
    post.metrics = publication.insights.windows;
    if (!publication.insights.baseline) {
      publication.insights.baseline = {
        account: accountMetrics,
        collectedAt: now.toISOString(),
        scope: 'account_snapshot_near_publication',
      };
      changedLedgers.add(post.ledger);
    }
    for (const window of dueWindows(post, now)) {
      let media;
      try {
        media = await getMediaInsightsImpl({
          mediaId: post.mediaId,
          token: instagramToken,
          version: config.instagramApiVersion,
          fetchImpl,
        });
      } catch (error) {
        media = unavailableRecords([
          'views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions',
          'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time',
        ], error.message);
      }
      const previous = publication.insights.windows[window.label] || {};
      const attempts = (previous.attempts || 0) + 1;
      const status = hasAnyMetric(media)
        ? 'ok'
        : (attempts >= MAX_WINDOW_ATTEMPTS ? 'unavailable' : 'retry_pending');
      const record = {
        ...media,
        media,
        account: accountMetrics,
        followerDeltaEstimate: followerDeltaEstimate(publication.insights.baseline.account, accountMetrics),
        engagementRate: calculateEngagementRate(media),
        status,
        attempts,
        collectedAt: now.toISOString(),
        ...(status === 'retry_pending' ? { nextRetryAt: nextRetryAt(now) } : { nextRetryAt: null }),
      };
      publication.insights.windows[window.label] = record;
      changedLedgers.add(post.ledger);
      collected.push({ post, window: window.label, metrics: record });
    }
  }

  for (const ledger of changedLedgers) saveLedgerImpl(ledger);

  if (collected.length > 0) {
    await sendAnalyticsReportImpl(`📈 *Instagram 성과 스냅샷*\n${collected.map(snapshotLine).join('\n')}`);
  }

  const kst = new Date(now.getTime() + 9 * 3600000);
  const state = loadStateImpl();
  const weekKey = kstWeekKey(now);
  if (kst.getUTCDay() === 1 && !(state.weeklyReports || []).includes(weekKey)) {
    const refreshedTargets = measurementTargetsFromLedgers(ledgers);
    await sendAnalyticsReportImpl(buildWeeklyReport(refreshedTargets, now));
    state.weeklyReports = [...(state.weeklyReports || []), weekKey].slice(-12);
    saveStateImpl(state);
  }

  return collected;
}

async function runCli() {
  try {
    await collectInsights();
  } catch (error) {
    await sendAnalyticsReport(`📉 *Instagram 성과 수집 실패*\n${String(error.message || error).slice(0, 1200)}`).catch(() => null);
    throw error;
  }
}

if (require.main === module) {
  runCli().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  ACCOUNT_METRICS,
  WINDOWS,
  buildWeeklyReport,
  collectInsights,
  dueWindows,
  followerDeltaEstimate,
  kstWeekKey,
  latestMetrics,
  measurementTargetsFromLedgers,
  runCli,
};
