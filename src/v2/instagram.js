const { instagramRequest, sanitizeInstagramErrorMessage } = require('../instagram');
const { normalizeNfc } = require('./text');
const { isSameKstDate } = require('./time');

const COMMENT_FIELDS = 'id,text,timestamp,username,from,replies{id,text,timestamp,username,from}';
const RECENT_MEDIA_FIELDS = 'id,caption,permalink,timestamp,media_type,media_product_type,username';
const MAX_STEP_ATTEMPTS = 3;

function requireIdentifier(value, label) {
  const resolved = String(value || '').trim();
  if (!resolved) throw new Error(`[DIEM Instagram] Missing ${label}.`);
  return resolved;
}

function requireMessage(value) {
  const message = normalizeNfc(value).trim();
  if (!message) throw new Error('[DIEM Instagram] Comment message cannot be empty.');
  return message;
}

async function createTopLevelComment({
  mediaId,
  message,
  token,
  version = 'v23.0',
  fetchImpl = fetch,
  requestImpl = instagramRequest,
} = {}) {
  requireIdentifier(token, 'access token');
  const result = await requestImpl({
    path: `${requireIdentifier(mediaId, 'media ID')}/comments`,
    token,
    version,
    method: 'POST',
    params: { message: requireMessage(message) },
    fetchImpl,
  });
  if (!result?.id) throw new Error('[DIEM Instagram] Comment API returned no comment ID.');
  return { id: String(result.id), text: requireMessage(message) };
}

async function replyToComment({
  commentId,
  message,
  token,
  version = 'v23.0',
  fetchImpl = fetch,
  requestImpl = instagramRequest,
} = {}) {
  requireIdentifier(token, 'access token');
  const result = await requestImpl({
    path: `${requireIdentifier(commentId, 'comment ID')}/replies`,
    token,
    version,
    method: 'POST',
    params: { message: requireMessage(message) },
    fetchImpl,
  });
  if (!result?.id) throw new Error('[DIEM Instagram] Reply API returned no reply ID.');
  return { id: String(result.id), text: requireMessage(message) };
}

async function listComments({
  mediaId,
  token,
  version = 'v23.0',
  limit = 50,
  fetchImpl = fetch,
  requestImpl = instagramRequest,
} = {}) {
  requireIdentifier(token, 'access token');
  const result = await requestImpl({
    path: `${requireIdentifier(mediaId, 'media ID')}/comments`,
    token,
    version,
    params: {
      fields: COMMENT_FIELDS,
      limit: Math.max(1, Math.min(100, Number(limit) || 50)),
    },
    fetchImpl,
  });
  return Array.isArray(result?.data) ? result.data : [];
}

function isReel(media = {}) {
  return String(media.media_product_type || '').toUpperCase() === 'REELS'
    || String(media.media_type || '').toUpperCase() === 'REELS';
}

async function listRecentReels({
  userId,
  token,
  version = 'v23.0',
  limit = 25,
  fetchImpl = fetch,
  requestImpl = instagramRequest,
} = {}) {
  requireIdentifier(token, 'access token');
  const result = await requestImpl({
    path: `${requireIdentifier(userId, 'Instagram user ID')}/media`,
    token,
    version,
    params: {
      fields: RECENT_MEDIA_FIELDS,
      limit: Math.max(1, Math.min(100, Number(limit) || 25)),
    },
    fetchImpl,
  });
  return (Array.isArray(result?.data) ? result.data : []).filter(isReel);
}

function commentUsername(comment = {}) {
  return normalizeNfc(comment.username || comment.from?.username || '').replace(/^@/, '').toLowerCase();
}

function reconcileExactComment(comments = [], expectedText = '', { username } = {}) {
  const text = requireMessage(expectedText);
  const expectedUsername = normalizeNfc(username || '').replace(/^@/, '').toLowerCase();
  const matches = comments.filter(comment => (
    normalizeNfc(comment?.text) === text
    && (!expectedUsername || commentUsername(comment) === expectedUsername)
  ));
  if (matches.length === 1) {
    return { status: 'reconciled', match: matches[0], shouldCreate: false };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', matches, shouldCreate: false };
  }
  return { status: 'not_found', match: null, shouldCreate: true };
}

function reconcileExactReel(reels = [], {
  expectedCaption,
  publicationDate,
} = {}) {
  const caption = normalizeNfc(expectedCaption);
  if (!caption) throw new Error('[DIEM Instagram] Expected Reel caption cannot be empty.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publicationDate || '')) {
    throw new Error('[DIEM Instagram] Publication date must be YYYY-MM-DD.');
  }
  const reference = new Date(`${publicationDate}T12:00:00+09:00`);
  const matches = reels.filter(media => (
    isReel(media)
    && normalizeNfc(media.caption) === caption
    && isSameKstDate(media.timestamp, reference)
  ));
  if (matches.length === 1) {
    return { status: 'reconciled', match: matches[0], shouldPublish: false };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', matches, shouldPublish: false };
  }
  return { status: 'not_found', match: null, shouldPublish: true };
}

async function reconcileRecentReel(options = {}) {
  const reels = await listRecentReels(options);
  return reconcileExactReel(reels, options);
}

function serializeInstagramError(error = {}, { secrets = [] } = {}) {
  const apiError = error.payload?.error || {};
  const numeric = value => value !== undefined && value !== null && value !== '' && Number.isFinite(Number(value))
    ? Number(value) : null;
  const text = value => value == null ? null : sanitizeInstagramErrorMessage(value, { secrets });
  return {
    httpStatus: numeric(error.status),
    code: numeric(apiError.code),
    subcode: numeric(apiError.error_subcode),
    userMessage: text(apiError.error_user_msg || apiError.message),
    traceId: text(apiError.fbtrace_id)?.slice(0, 200) ?? null,
  };
}

function instagramErrorDisposition(error = {}) {
  const status = Number(error.status);
  // Meta also uses OAuthException for transient responses; HTTP retry status takes precedence.
  if (status === 429 || status >= 500) return 'retry_pending';
  const message = normalizeNfc(`${error.message || ''} ${error.payload?.error?.message || ''}`);
  const code = Number(error.payload?.error?.code);
  const subcode = Number(error.payload?.error?.error_subcode);
  const permissionOrUnsupported = [401, 403].includes(status)
    || [10, 100, 102, 190, 200, 294].includes(code)
    || [33, 2108006, 2207050, 2207051].includes(subcode)
    || /(permission|권한|unsupported|not supported|does not support|cannot access|access is restricted|access restricted|account (?:is )?restricted|OAuthException|invalid.*(?:access )?token|(?:access )?token.*expired|session.*expired)/iu.test(message);
  return permissionOrUnsupported ? 'manual_action_required' : 'retry_pending';
}

function nextFailedStep(step = {}, error = {}, {
  maxAttempts = MAX_STEP_ATTEMPTS,
  now = new Date(),
  secrets = [],
} = {}) {
  const attempts = Math.max(0, Number(step.attempts) || 0) + 1;
  const disposition = instagramErrorDisposition(error);
  const errorDetails = serializeInstagramError(error, { secrets });
  const status = disposition === 'manual_action_required' || attempts >= maxAttempts
    ? 'manual_action_required'
    : 'retry_pending';
  return {
    ...step,
    status,
    attempts,
    error: sanitizeInstagramErrorMessage(error.message || 'Instagram request failed', { secrets }),
    errorDetails,
    errorCode: errorDetails.code ?? errorDetails.httpStatus,
    updatedAt: now.toISOString(),
  };
}

function applyIndependentStepOutcome(publication, stepName, outcome = {}, now = new Date()) {
  if (!publication || typeof publication !== 'object') {
    throw new Error('[DIEM Instagram] Publication record is required.');
  }
  if (!['comment', 'reply'].includes(stepName)) {
    throw new Error(`[DIEM Instagram] Unsupported independent step: ${stepName}`);
  }
  const next = structuredClone(publication);
  const current = next[stepName] || { status: 'planned', attempts: 0 };
  if (outcome.error) {
    next[stepName] = nextFailedStep(current, outcome.error, {
      maxAttempts: outcome.maxAttempts,
      now,
      secrets: outcome.secrets,
    });
    return next;
  }
  const id = requireIdentifier(outcome.result?.id, `${stepName} result ID`);
  next[stepName] = {
    ...current,
    status: 'published',
    attempts: Math.max(0, Number(current.attempts) || 0) + 1,
    externalId: id,
    error: null,
    errorCode: null,
    errorDetails: null,
    updatedAt: now.toISOString(),
  };
  return next;
}

module.exports = {
  COMMENT_FIELDS,
  MAX_STEP_ATTEMPTS,
  RECENT_MEDIA_FIELDS,
  applyIndependentStepOutcome,
  commentUsername,
  createTopLevelComment,
  instagramErrorDisposition,
  isReel,
  listComments,
  listRecentReels,
  nextFailedStep,
  reconcileExactComment,
  reconcileExactReel,
  reconcileRecentReel,
  replyToComment,
  serializeInstagramError,
};
