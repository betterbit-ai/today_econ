const { WebClient } = require('@slack/web-api');
const config = require('../../config');
const {
  closeGitHubIssue,
  recordNotification,
  sendSlackStatus,
  shouldNotify,
  upsertGitHubIssue,
} = require('./notifications');
const { updatePublication } = require('./ledger');

function githubActionsUrl(repository = config.githubRepository, runId = config.githubRunId) {
  if (!repository || !runId) return '';
  return `https://github.com/${repository}/actions/runs/${runId}`;
}

function publicationTitle(publication = {}) {
  return publication.editorial?.title?.text
    || publication.candidate?.title
    || '선정 후보 없음';
}

function rejectionLabel(reason = '') {
  if (reason === 'category_not_allowed') return '분야 부적합';
  if (/^assigned_to_/u.test(reason)) return '다른 분야 배정';
  if (reason === 'not_hot:article_too_old') return '기사 신선도 초과';
  if (/popularity/u.test(reason)) return '인기 기준 미달';
  if (/editorial_value/u.test(reason)) return '편집 가치 미달';
  if (reason === 'recent_duplicate') return '최근 7일 중복';
  if (reason === 'primary_article_inaccessible') return '원문 접근 실패';
  if (reason === 'extraordinary_claim_unverified') return '고위험 주장 검증 실패';
  if (/evaluation_error/u.test(reason)) return '후보 평가 오류';
  return reason.replace(/^not_hot:/u, '').slice(0, 80);
}

function formatKstTimestamp(value) {
  const instant = new Date(value || '');
  if (Number.isNaN(instant.getTime())) return '시각 미상';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute} KST`;
}

function dailyWatchdogReason(publication = {}) {
  const diagnostics = publication.selectionDiagnostics || {};
  const health = diagnostics.publicationHealth || {};
  const elapsed = Number(health.hoursSinceLastPublished);
  const elapsedText = Number.isFinite(elapsed) ? `${Math.floor(elapsed)}시간` : '24시간 이상';
  const lastPublished = health.lastPublishedAt
    ? `마지막 성공 Reel ${formatKstTimestamp(health.lastPublishedAt)}`
    : `성공 Reel 기록 없음(감시 시작 ${formatKstTimestamp(health.monitoringStartedAt)})`;
  const reasons = Object.entries(diagnostics.rejectionCounts || {})
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([reason, count]) => `${rejectionLabel(reason)} ${count}건`)
    .join(', ');
  return `${lastPublished}, 현재까지 ${elapsedText} 무발행. 일일 최소 발행 후보 ${diagnostics.candidateCount || 0}건을 검토했지만 안전 기준 통과 후보가 없습니다.${reasons ? ` 주요 탈락 사유: ${reasons}.` : ''}`;
}

function transitionEvents(before = {}, after = {}, { actionsUrl = githubActionsUrl() } = {}) {
  const events = [];
  const publicationKey = after.publicationKey;
  const category = after.category;
  const title = publicationTitle(after);
  const base = { publicationKey, category, title, actionsUrl };

  const isNewRun = before.publicationKey !== after.publicationKey;
  const changedToNoPublish = after.status === 'no_publish'
    && (before.status !== after.status || isNewRun);
  const routineHotPoll = after.reason === 'no_candidate_passed_hotness_gate';
  const dailyFloorMiss = after.reason === 'no_candidate_passed_daily_floor_gates';
  const watchdogAlertDue = Boolean(after.selectionDiagnostics?.publicationHealth?.watchdogAlertDue);
  if (changedToNoPublish && !routineHotPoll && (!dailyFloorMiss || watchdogAlertDue)) {
    events.push({
      ...base,
      stage: dailyFloorMiss ? 'daily_watchdog' : 'selection',
      status: 'no_publish',
      reason: dailyFloorMiss
        ? dailyWatchdogReason(after)
        : (after.reason || after.error || '품질 기준을 통과한 후보가 없습니다.'),
    });
  }

  for (const stage of ['reel', 'story', 'comment', 'reply']) {
    const previous = before?.[stage] || {};
    const current = after?.[stage] || {};
    if (previous.status === current.status) continue;
    const shared = {
      ...base,
      stage,
      attempts: current.attempts,
      error: current.error,
      permalink: stage === 'reel' ? current.permalink : (current.permalink || after.reel?.permalink),
    };
    if (current.status === 'retry_pending') {
      events.push({ ...shared, status: 'retry_pending' });
    } else if (current.status === 'manual_action_required') {
      events.push({ ...shared, status: 'manual_action_required' });
    } else if (
      current.status === 'published'
      && (stage === 'reel' || previous.status === 'retry_pending' || previous.status === 'manual_action_required')
    ) {
      events.push({
        ...shared,
        status: previous.status === 'retry_pending' || previous.status === 'manual_action_required'
          ? 'recovered'
          : 'published',
      });
    }
  }
  return events;
}

function operationalClients({
  slackToken = config.slackBotToken,
  slackClient,
} = {}) {
  return {
    slackClient: slackClient || (slackToken ? new WebClient(slackToken) : null),
  };
}

async function dispatchOperationalEvent(publication, event, {
  slackClient,
  slackChannelId = config.slackChannelId,
  githubToken = config.githubToken,
  githubRepository = config.githubRepository,
  sendSlackImpl = sendSlackStatus,
  upsertIssueImpl = upsertGitHubIssue,
  closeIssueImpl = closeGitHubIssue,
} = {}) {
  if (!shouldNotify(event, publication.notifications || [])) {
    return { publication: structuredClone(publication), sent: false, errors: [] };
  }

  const receipt = {};
  const errors = [];
  let configuredTargets = 0;
  let completedTargets = 0;

  if (slackClient && slackChannelId) {
    configuredTargets += 1;
    try {
      const response = await sendSlackImpl({ event, channelId: slackChannelId, client: slackClient });
      receipt.slackTs = response?.ts || null;
      completedTargets += 1;
    } catch (error) {
      errors.push({ target: 'slack', message: error.message });
    }
  }

  const usesIssue = ['retry_pending', 'manual_action_required', 'no_publish', 'recovered'].includes(event.status)
    && event.stage !== 'daily_watchdog';
  if (usesIssue && githubToken && githubRepository) {
    configuredTargets += 1;
    try {
      const issue = event.status === 'recovered'
        ? await closeIssueImpl({ event, token: githubToken, repository: githubRepository })
        : await upsertIssueImpl({ event, token: githubToken, repository: githubRepository });
      receipt.issueNumber = issue?.number || null;
      receipt.issueUrl = issue?.html_url || null;
      completedTargets += 1;
    } catch (error) {
      errors.push({ target: 'github', message: error.message });
    }
  }

  const sent = configuredTargets > 0 && configuredTargets === completedTargets;
  return {
    publication: sent ? recordNotification(publication, event, receipt) : structuredClone(publication),
    sent,
    errors,
  };
}

async function notifyTransitions(ledger, category, before, {
  clients = operationalClients(),
  ...options
} = {}) {
  let next = structuredClone(ledger);
  const after = next.publications[category];
  const events = transitionEvents(before, after, options);
  const errors = [];

  for (const event of events) {
    const result = await dispatchOperationalEvent(next.publications[category], event, {
      ...clients,
      ...options,
    });
    next = updatePublication(next, category, result.publication);
    errors.push(...result.errors.map(error => ({ ...error, event })));
  }
  return { ledger: next, events, errors };
}

module.exports = {
  dispatchOperationalEvent,
  githubActionsUrl,
  notifyTransitions,
  operationalClients,
  publicationTitle,
  dailyWatchdogReason,
  formatKstTimestamp,
  rejectionLabel,
  transitionEvents,
};
