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

function transitionEvents(before = {}, after = {}, { actionsUrl = githubActionsUrl() } = {}) {
  const events = [];
  const publicationKey = after.publicationKey;
  const category = after.category;
  const title = publicationTitle(after);
  const base = { publicationKey, category, title, actionsUrl };

  if (before.status !== after.status && after.status === 'no_publish') {
    events.push({
      ...base,
      stage: 'selection',
      status: 'no_publish',
      reason: after.reason || after.error || '품질 기준을 통과한 후보가 없습니다.',
    });
  }

  for (const stage of ['reel', 'comment', 'reply']) {
    const previous = before?.[stage] || {};
    const current = after?.[stage] || {};
    if (previous.status === current.status) continue;
    const shared = {
      ...base,
      stage,
      attempts: current.attempts,
      error: current.error,
      permalink: stage === 'reel' ? current.permalink : after.reel?.permalink,
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

  const usesIssue = ['retry_pending', 'manual_action_required', 'no_publish', 'recovered'].includes(event.status);
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
  transitionEvents,
};
