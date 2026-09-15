const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const config = require('../../config');
const { fetchNews, fetchArticleDocument } = require('../crawler');
const { CATEGORIES } = require('./constants');
const {
  evaluateCandidate,
  rssCandidates,
  serializeCandidate,
} = require('./planner');
const { fetchPortalRankings, mergePopularCandidates } = require('./popular-news');
const { loadPerformanceReport } = require('./performance-loop');
const { computeEmbeddingMatrix } = require('./similarity');
const { buildTopicSignature, classifyCandidate } = require('./topic');
const { normalizeNfc } = require('./text');

const CLOUD_CANDIDATE_PACK_SCHEMA_VERSION = 1;
const DEFAULT_CLOUD_EDITORIAL_ROOT = path.join(process.cwd(), 'data', 'cloud-editorial');
const MAX_PACK_CANDIDATES = 15;
const MAX_CANDIDATES_PER_CATEGORY = 8;
const MAX_ARTICLE_CHARS = 6000;
const PACK_TTL_HOURS = 12;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeSlot(value = '') {
  const slot = String(value || '').normalize('NFC').replace(/[^A-Za-z0-9_-]/gu, '-').replace(/-+/gu, '-').replace(/^-|-$/gu, '');
  if (!slot) throw new Error('[DIEM Cloud Pack] slot must contain letters, numbers, underscores, or hyphens.');
  return slot;
}

function validDate(value = '') {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(String(value))) {
    throw new Error('[DIEM Cloud Pack] date must be YYYY-MM-DD.');
  }
  return String(value);
}

function candidatePackPath({
  root = config.cloudEditorialRoot || DEFAULT_CLOUD_EDITORIAL_ROOT,
  date,
  slot,
} = {}) {
  const safeDate = validDate(date);
  const safeRunSlot = safeSlot(slot);
  const [year, month] = safeDate.split('-');
  return path.join(path.resolve(root), 'inbox', year, month, `${safeDate}-${safeRunSlot}.json`);
}

function cleanArticleText(value = '', maxChars = MAX_ARTICLE_CHARS) {
  return normalizeNfc(String(value || ''))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxChars);
}

function compactSelectedCandidate(selected = {}) {
  const {
    fullText,
    topicSignature,
    ...candidate
  } = selected;
  return {
    candidate: {
      ...candidate,
      summary: cleanArticleText(candidate.summary, 800),
    },
    article: {
      fullText: cleanArticleText(fullText),
      evidenceSha256: sha256(cleanArticleText(fullText)),
      untrustedData: true,
    },
    topicSignature,
  };
}

function rejectionRecord(candidate, evaluation = {}) {
  return {
    candidate: serializeCandidate(candidate),
    reason: evaluation.reason || 'candidate_evaluation_failed',
    classificationTrace: evaluation.classificationTrace || null,
    hotness: evaluation.hotness || null,
    editorialValue: evaluation.editorialValue || null,
    duplicateCheck: evaluation.duplicateCheck || null,
  };
}

function packContentShape(pack = {}) {
  const next = structuredClone(pack);
  delete next.createdAt;
  delete next.expiresAt;
  delete next.integrity;
  return next;
}

function candidatePackHash(pack = {}) {
  return sha256(JSON.stringify(packContentShape(pack)).normalize('NFC'));
}

function expiryFor(now = new Date()) {
  return new Date(now.getTime() + PACK_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

function preliminarySignature(candidate) {
  const category = classifyCandidate(candidate).category || CATEGORIES.ISSUE;
  return buildTopicSignature(candidate, category);
}

async function buildCloudCandidatePack({
  date,
  slot,
  now = new Date(),
  categories = [CATEGORIES.ECONOMY, CATEGORIES.ISSUE],
  history = [],
  hotMode = false,
  dailyFloorMode = false,
  maxCandidates = MAX_PACK_CANDIDATES,
  maxCandidatesPerCategory = MAX_CANDIDATES_PER_CATEGORY,
  fetchPortalRankingsImpl = fetchPortalRankings,
  fetchNewsImpl = fetchNews,
  fetchArticleBodyImpl = fetchArticleDocument,
  embeddingMatrixImpl = computeEmbeddingMatrix,
  performanceReport = undefined,
  loadPerformanceReportImpl = loadPerformanceReport,
} = {}) {
  const safeDate = validDate(date);
  const safeRunSlot = safeSlot(slot);
  const portal = await fetchPortalRankingsImpl({ date: safeDate, now });
  let sourceCandidates = portal.candidates || mergePopularCandidates(portal.results || {});
  let popularityFallback = null;

  if (portal.allFailed || sourceCandidates.length === 0) {
    const items = await fetchNewsImpl(config.newsRssUrl);
    sourceCandidates = rssCandidates(items, safeDate);
    popularityFallback = {
      used: true,
      source: 'legacy_rss',
      errors: portal.errors || {},
      recordedAt: now.toISOString(),
    };
  }

  const candidates = sourceCandidates.slice(0, Math.max(1, Math.min(MAX_PACK_CANDIDATES, maxCandidates)));
  const topicHistory = (history || []).filter(entry => entry.signature?.text);
  let embeddingMatrix = [];
  let embeddingError = null;
  if (topicHistory.length > 0 && candidates.length > 0) {
    try {
      embeddingMatrix = await embeddingMatrixImpl(
        candidates.map(preliminarySignature).map(signature => signature.text),
        topicHistory.map(entry => entry.signature.text)
      );
    } catch (error) {
      embeddingError = error;
    }
  }

  const resolvedPerformanceReport = performanceReport === undefined
    ? loadPerformanceReportImpl()
    : performanceReport;
  const candidateGroups = Object.fromEntries(categories.map(category => [category, []]));
  const rejections = Object.fromEntries(categories.map(category => [category, []]));

  for (const category of categories) {
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      if (candidateGroups[category].length >= maxCandidatesPerCategory) break;
      const candidate = candidates[candidateIndex];
      try {
        const evaluation = await evaluateCandidate(candidate, {
          category,
          allCandidates: candidates,
          history,
          fetchArticleBodyImpl,
          semanticScores: embeddingMatrix[candidateIndex],
          embeddingError,
          hotMode,
          dailyFloorMode,
          now,
          referenceDate: safeDate,
          candidateIndex,
          performanceReport: resolvedPerformanceReport,
        });
        if (!evaluation.ok) {
          rejections[category].push(rejectionRecord(candidate, evaluation));
          continue;
        }
        candidateGroups[category].push({
          ...compactSelectedCandidate(evaluation.selected),
          duplicateCheck: evaluation.duplicateCheck,
          corroboration: evaluation.corroboration,
          newsFrame: evaluation.selected.newsFrame,
          editorialValue: evaluation.selected.editorialValue,
          performancePrior: evaluation.selected.performancePrior,
          hotness: evaluation.selected.hotness,
          classificationTrace: evaluation.classificationTrace,
        });
      } catch (error) {
        rejections[category].push(rejectionRecord(candidate, { reason: `evaluation_error:${error.message}` }));
      }
    }
  }

  const pack = {
    schemaVersion: CLOUD_CANDIDATE_PACK_SCHEMA_VERSION,
    kind: 'diem-cloud-candidate-pack',
    runId: safeRunSlot,
    date: safeDate,
    createdAt: now.toISOString(),
    expiresAt: expiryFor(now),
    selectionMode: dailyFloorMode ? 'daily_floor' : (hotMode ? 'hot' : 'quality'),
    popularityFallback,
    source: {
      candidateCount: candidates.length,
      maxCandidates: Math.max(1, Math.min(MAX_PACK_CANDIDATES, maxCandidates)),
      portalErrors: portal.errors || {},
    },
    candidates: candidateGroups,
    rejections,
    integrity: { contentSha256: '' },
  };
  pack.integrity.contentSha256 = candidatePackHash(pack);
  return pack;
}

function saveCloudCandidatePack(pack, {
  root = config.cloudEditorialRoot || DEFAULT_CLOUD_EDITORIAL_ROOT,
  date = pack?.date,
  slot = pack?.runId,
  fsImpl = fs,
} = {}) {
  const target = candidatePackPath({ root, date, slot });
  fsImpl.mkdirSync(path.dirname(target), { recursive: true });
  const serialized = `${JSON.stringify(pack, null, 2).normalize('NFC')}\n`;
  const temporary = `${target}.tmp`;
  fsImpl.writeFileSync(temporary, serialized, 'utf8');
  fsImpl.renameSync(temporary, target);
  return { path: target, pack };
}

module.exports = {
  CLOUD_CANDIDATE_PACK_SCHEMA_VERSION,
  DEFAULT_CLOUD_EDITORIAL_ROOT,
  MAX_ARTICLE_CHARS,
  MAX_CANDIDATES_PER_CATEGORY,
  MAX_PACK_CANDIDATES,
  buildCloudCandidatePack,
  candidatePackHash,
  candidatePackPath,
  packContentShape,
  saveCloudCandidatePack,
};
