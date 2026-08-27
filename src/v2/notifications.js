const { normalizeNfc } = require('./text');
const { MANUAL_REEL_STORY_SHARE_REASON } = require('./constants');

const NOTIFIABLE_STATUSES = new Set([
  'published',
  'retry_pending',
  'recovered',
  'manual_action_required',
  'no_publish',
]);

function notificationKey({ publicationKey, stage = 'pipeline', status } = {}) {
  const key = [publicationKey, stage, status].map(value => normalizeNfc(value).trim()).join(':');
  if (!publicationKey || !status) throw new Error('[DIEM Notifications] publicationKey and status are required.');
  return key;
}

function issueKey({ publicationKey, stage = 'pipeline' } = {}) {
  if (!publicationKey) throw new Error('[DIEM Notifications] publicationKey is required.');
  return `${normalizeNfc(publicationKey).trim()}:${normalizeNfc(stage).trim()}`;
}

function issueMarker(event) {
  return `<!-- diem-operation:${issueKey(event)} -->`;
}

function wasNotified(notifications = [], key) {
  return notifications.some(item => item?.key === key);
}

function shouldNotify(event, notifications = []) {
  if (!NOTIFIABLE_STATUSES.has(event?.status)) return false;
  return !wasNotified(notifications, notificationKey(event));
}

function categoryLabel(category) {
  return category === 'issue' ? '시사' : category === 'economy' ? '경제' : '운영';
}

function safeError(value) {
  return normalizeNfc(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function buildSlackStatusText(event = {}) {
  const label = categoryLabel(event.category);
  const title = normalizeNfc(event.title || '제목 미정').trim().slice(0, 120);
  const stage = normalizeNfc(event.stage || 'pipeline').trim();
  const attempts = Math.max(0, Number(event.attempts) || 0);
  const actionsUrl = String(event.actionsUrl || '').trim();
  const issueUrl = String(event.issueUrl || '').trim();
  const links = [
    issueUrl ? `<${issueUrl}|GitHub Issue>` : '',
    actionsUrl ? `<${actionsUrl}|Actions 실행>` : '',
  ].filter(Boolean).join(' · ');

  if (event.status === 'published') {
    const permalink = String(event.permalink || '').trim();
    return `✅ DIEM ${label} 발행 완료\n${title}${permalink ? `\n<${permalink}|Instagram 게시물>` : ''}`.normalize('NFC');
  }
  if (event.status === 'retry_pending') {
    return `⚠️ DIEM ${label} ${stage} 최초 실패 · 재시도 예정\n${title}\n시도 ${attempts}회${safeError(event.error) ? ` · ${safeError(event.error)}` : ''}`.normalize('NFC');
  }
  if (event.status === 'recovered') {
    return `✅ DIEM ${label} ${stage} 자동 복구 완료\n${title}`.normalize('NFC');
  }
  if (event.status === 'manual_action_required') {
    if (stage === 'story' && safeError(event.error) === MANUAL_REEL_STORY_SHARE_REASON) {
      const permalink = String(event.permalink || '').trim();
      return [
        `📲 DIEM ${label} Reel → Story 공유 필요`,
        title,
        permalink ? `<${permalink}|Instagram Reel 열기>` : 'Reel 링크를 원장에서 확인해 주세요.',
        'Instagram 앱에서 공유 아이콘 → 스토리에 추가',
      ].join('\n').normalize('NFC');
    }
    return `🚨 DIEM ${label} ${stage} 수동 조치 필요\n${title}${safeError(event.error) ? `\n${safeError(event.error)}` : ''}${links ? `\n${links}` : ''}`.normalize('NFC');
  }
  if (event.status === 'no_publish') {
    if (stage === 'daily_watchdog') {
      return `🚨 DIEM 24시간 이상 무발행\n${safeError(event.reason) || '안전 기준을 통과한 후보가 없습니다.'}${links ? `\n${links}` : ''}`.normalize('NFC');
    }
    return `ℹ️ DIEM ${label} 발행 생략\n${title}${safeError(event.reason) ? `\n사유: ${safeError(event.reason)}` : ''}${links ? `\n${links}` : ''}`.normalize('NFC');
  }
  throw new Error(`[DIEM Notifications] Unsupported notification status: ${event.status}`);
}

async function sendSlackStatus({
  event,
  channelId,
  client,
} = {}) {
  if (!client?.chat?.postMessage) throw new Error('[DIEM Notifications] Slack client is not configured.');
  if (!channelId) throw new Error('[DIEM Notifications] Slack channel ID is required.');
  return client.chat.postMessage({
    channel: channelId,
    text: buildSlackStatusText(event),
    unfurl_links: false,
    unfurl_media: false,
  });
}

async function sendBasicDraftPreview({
  publication,
  channelId,
  client,
  actionsUrl,
} = {}) {
  if (!client?.chat?.postMessage) throw new Error('[DIEM Notifications] Slack client is not configured.');
  if (!channelId) throw new Error('[DIEM Notifications] Slack channel ID is required.');
  if (!publication?.publicationKey) throw new Error('[DIEM Notifications] DIEM Basic publication is required.');
  const title = normalizeNfc(publication.editorial?.title?.text || '제목 미정').replace(/\n/gu, ' / ');
  const caption = normalizeNfc(publication.editorial?.caption?.text || '').trim();
  const source = publication.source || {};
  const imageUrl = publication.release?.imageUrls?.[0] || '';
  const quality = publication.quality?.ok === true ? '통과' : '확인 필요';
  const text = [
    '📝 DIEM 기초 주간 초안 준비 완료',
    title,
    '',
    caption,
    '',
    `출처: ${source.title || '제목 미상'}${source.url ? `\n${source.url}` : ''}`,
    `기준일: ${source.checkedAt || publication.preparedAt || '미상'}`,
    `품질 체크: ${quality} · ${(publication.quality?.checks || []).join(', ')}`,
    `publication_key: ${publication.publicationKey}`,
    actionsUrl ? `검토 후 DIEM Economy Action에서 publish_basic으로 승인: ${actionsUrl}` : '',
  ].filter(value => value !== '').join('\n').normalize('NFC');
  return client.chat.postMessage({
    channel: channelId,
    text,
    ...(imageUrl ? { blocks: [
      { type: 'section', text: { type: 'mrkdwn', text } },
      { type: 'image', image_url: imageUrl, alt_text: `DIEM 기초 미리보기: ${title}` },
    ] } : {}),
    unfurl_links: false,
    unfurl_media: false,
  });
}

function parseRepository(repository) {
  const [owner, repo] = String(repository || '').split('/');
  if (!owner || !repo) throw new Error('[DIEM Notifications] GitHub repository must be owner/repo.');
  return { owner, repo };
}

async function githubRequest({
  repository,
  token,
  path,
  method = 'GET',
  body,
  fetchImpl = fetch,
} = {}) {
  if (!token) throw new Error('[DIEM Notifications] GitHub token is required.');
  const { owner, repo } = parseRepository(repository);
  const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/${String(path).replace(/^\//, '')}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'diem-pipeline',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return null;
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`[DIEM Notifications] GitHub ${response.status}: ${payload?.message || payload?.raw || response.statusText}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function findOperationalIssue(options = {}) {
  const { event } = options;
  const marker = issueMarker(event);
  const issues = await githubRequest({
    ...options,
    path: 'issues?state=all&per_page=100',
  });
  return (Array.isArray(issues) ? issues : []).find(issue => (
    !issue.pull_request && normalizeNfc(issue.body || '').includes(marker)
  )) || null;
}

function buildIssueBody(event) {
  const detail = buildSlackStatusText(event).replace(/<([^|>]+)\|([^>]+)>/g, '$2: $1');
  return `${issueMarker(event)}\n\n${detail}\n\npublication_key: \`${normalizeNfc(event.publicationKey)}\`\nstage: \`${normalizeNfc(event.stage || 'pipeline')}\``;
}

async function commentOnGitHubIssue({
  issueNumber,
  event,
  ...options
} = {}) {
  if (!issueNumber) throw new Error('[DIEM Notifications] GitHub issue number is required.');
  return githubRequest({
    ...options,
    path: `issues/${issueNumber}/comments`,
    method: 'POST',
    body: { body: buildIssueBody(event) },
  });
}

async function upsertGitHubIssue({
  event,
  labels = [],
  ...options
} = {}) {
  const existing = await findOperationalIssue({ event, ...options });
  if (existing) {
    if (existing.state === 'closed') {
      await githubRequest({
        ...options,
        path: `issues/${existing.number}`,
        method: 'PATCH',
        body: { state: 'open' },
      });
    }
    await commentOnGitHubIssue({ issueNumber: existing.number, event, ...options });
    return { ...existing, state: 'open', reused: true };
  }
  const created = await githubRequest({
    ...options,
    path: 'issues',
    method: 'POST',
    body: {
      title: `[DIEM] ${categoryLabel(event.category)} ${event.stage || 'pipeline'} 조치 필요`,
      body: buildIssueBody(event),
      ...(labels.length ? { labels } : {}),
    },
  });
  return { ...created, reused: false };
}

async function closeGitHubIssue({
  event,
  resolution = '자동 복구되어 이슈를 종료합니다.',
  ...options
} = {}) {
  const existing = await findOperationalIssue({ event, ...options });
  if (!existing || existing.state === 'closed') return existing;
  await githubRequest({
    ...options,
    path: `issues/${existing.number}/comments`,
    method: 'POST',
    body: { body: normalizeNfc(resolution).trim() },
  });
  return githubRequest({
    ...options,
    path: `issues/${existing.number}`,
    method: 'PATCH',
    body: { state: 'closed' },
  });
}

function recordNotification(publication, event, receipt = {}, now = new Date()) {
  if (!publication || typeof publication !== 'object') {
    throw new Error('[DIEM Notifications] Publication record is required.');
  }
  const key = notificationKey(event);
  if (wasNotified(publication.notifications || [], key)) return structuredClone(publication);
  const next = structuredClone(publication);
  next.notifications = [
    ...(next.notifications || []),
    {
      key,
      status: event.status,
      stage: event.stage || 'pipeline',
      sentAt: now.toISOString(),
      slackTs: receipt.slackTs || null,
      issueNumber: receipt.issueNumber || null,
      issueUrl: receipt.issueUrl || null,
    },
  ];
  return next;
}

module.exports = {
  NOTIFIABLE_STATUSES,
  buildIssueBody,
  buildSlackStatusText,
  closeGitHubIssue,
  commentOnGitHubIssue,
  findOperationalIssue,
  githubRequest,
  issueKey,
  issueMarker,
  notificationKey,
  parseRepository,
  recordNotification,
  sendBasicDraftPreview,
  sendSlackStatus,
  shouldNotify,
  upsertGitHubIssue,
  wasNotified,
};
