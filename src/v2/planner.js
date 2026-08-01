const config = require('../../config');
const { fetchNews, fetchArticleDocument } = require('../crawler');
const { CATEGORIES } = require('./constants');
const { extraordinaryClaims, findExtraordinaryEvidence } = require('./fact-verifier');
const { assessHotness } = require('./hotness');
const { fetchPortalRankings, mergePopularCandidates, normalizeRank, titleEventSimilarity } = require('./popular-news');
const { computeEmbeddingMatrix, evaluateAgainstHistory } = require('./similarity');
const {
  assessDiemEditorialValue,
  buildNewsFrame,
  buildTopicSignature,
  classifyCandidate,
  isMaterialFollowUp,
} = require('./topic');

function rssCandidates(items = [], date) {
  return items.slice(0, 50).map((item, index, all) => ({
    title: item.title,
    url: item.link,
    publishedDate: date,
    publishedAt: item.pubDate || null,
    observedAt: new Date().toISOString(),
    summary: item.summary,
    popularityScore: normalizeRank(index + 1, all.length),
    popularitySignalReliable: false,
    crossPortal: false,
    sources: [{
      portal: 'rss',
      publisher: 'legacy-rss',
      rank: index + 1,
      normalizedScore: normalizeRank(index + 1, all.length),
      title: item.title,
      url: item.link,
      summary: item.summary,
      date,
    }],
  }));
}

function serializeCandidate(candidate) {
  return {
    title: candidate.title,
    url: candidate.url,
    publishedDate: candidate.publishedDate,
    publishedAt: candidate.publishedAt || null,
    observedAt: candidate.observedAt || null,
    popularityScore: candidate.popularityScore,
    popularitySignalReliable: candidate.popularitySignalReliable !== false,
    hotness: candidate.hotness || null,
    crossPortal: Boolean(candidate.crossPortal),
    sources: (candidate.sources || []).map(source => ({
      portal: source.portal,
      publisher: source.publisher || null,
      rank: source.rank,
      normalizedScore: source.normalizedScore,
      title: source.title,
      url: source.url,
    })),
  };
}

function corroborationPool(candidate, allCandidates) {
  const direct = (candidate.sources || []).filter(source => source.url !== candidate.url);
  const related = allCandidates
    .filter(other => other !== candidate && titleEventSimilarity(candidate.title, other.title) >= 0.3)
    .flatMap(other => other.sources || []);
  const seen = new Set();
  return [...direct, ...related].filter(source => {
    if (!source.url || seen.has(source.url)) return false;
    seen.add(source.url);
    return true;
  });
}

async function hydrateArticle(source, { fetchArticleBodyImpl = fetchArticleDocument } = {}) {
  if (source.fullText) return source;
  const fetched = await fetchArticleBodyImpl(source.url);
  const article = typeof fetched === 'string' ? { fullText: fetched } : (fetched || {});
  return {
    ...source,
    ...article,
    fullText: article.fullText || source.summary || '',
    publishedAt: article.publishedAt || source.publishedAt || null,
  };
}

async function evaluateCandidate(candidate, {
  category,
  allCandidates,
  history,
  fetchArticleBodyImpl,
  embedder,
  semanticScores,
  embeddingError,
  hotMode = false,
  now = new Date(),
  referenceDate,
} = {}) {
  const topicHistory = (history || []).filter(entry => entry.signature?.text);
  const classified = classifyCandidate(candidate);
  if (classified.category !== category) {
    return { ok: false, reason: classified.category ? `assigned_to_${classified.category}` : classified.excluded.join(',') };
  }

  const primarySource = (candidate.sources || [])[0] || candidate;
  const primary = await hydrateArticle({
    ...primarySource,
    title: primarySource.title || candidate.title,
    url: primarySource.url || candidate.url,
    summary: primarySource.summary || candidate.summary,
    publishedAt: primarySource.publishedAt || candidate.publishedAt || null,
    observedAt: primarySource.observedAt || candidate.observedAt || now.toISOString(),
  }, { fetchArticleBodyImpl });
  if (!primary.fullText || primary.fullText.length < 80) return { ok: false, reason: 'primary_article_inaccessible' };

  const enrichedCandidate = {
    ...candidate,
    summary: primary.fullText.slice(0, 800),
    fullText: primary.fullText,
    publishedAt: primary.publishedAt || candidate.publishedAt || null,
    observedAt: candidate.observedAt || now.toISOString(),
    category,
  };
  const enrichedClassification = classifyCandidate(enrichedCandidate);
  if (enrichedClassification.category !== category) {
    return {
      ok: false,
      reason: enrichedClassification.category
        ? `assigned_to_${enrichedClassification.category}_after_hydration`
        : enrichedClassification.excluded.join(','),
    };
  }

  const newsFrame = buildNewsFrame(enrichedCandidate, category);
  const editorialValue = assessDiemEditorialValue(enrichedCandidate, category, newsFrame);
  if (!editorialValue.ok) {
    return {
      ok: false,
      reason: `low_editorial_value:${editorialValue.reason}`,
      editorialValue,
      newsFrame,
    };
  }

  const hotness = assessHotness({ ...enrichedCandidate, editorialValue }, { now });
  if (hotMode && !hotness.ok) {
    return {
      ok: false,
      reason: `not_hot:${hotness.reason}`,
      editorialValue,
      newsFrame,
      hotness,
    };
  }

  const signature = buildTopicSignature(enrichedCandidate, category);
  const duplicateCheck = await evaluateAgainstHistory(signature, topicHistory, {
    embedder: semanticScores
      ? async () => semanticScores
      : embeddingError
        ? async () => { throw embeddingError; }
        : embedder,
    candidate: { materialFollowUp: isMaterialFollowUp(enrichedCandidate) },
    referenceDate,
  });
  if (duplicateCheck.duplicate) return { ok: false, reason: 'recent_duplicate', duplicateCheck };

  let evidence = null;
  const extraordinary = extraordinaryClaims(primary);
  if (extraordinary.length > 0) {
    const corroboratingArticles = [];
    for (const source of corroborationPool(candidate, allCandidates).slice(0, 8)) {
      try {
        const article = await hydrateArticle(source, { fetchArticleBodyImpl });
        if (article.fullText?.length >= 80) corroboratingArticles.push(article);
      } catch {
        // The candidate is rejected below if no independent evidence survives.
      }
    }
    evidence = findExtraordinaryEvidence(primary, corroboratingArticles);
    if (!evidence) {
      return {
        ok: false,
        reason: 'extraordinary_claim_unverified',
        duplicateCheck,
        extraordinaryClaims: extraordinary,
      };
    }
  }


  return {
    ok: true,
    selected: {
      ...serializeCandidate(candidate),
      category,
      fullText: primary.fullText,
      publishedAt: enrichedCandidate.publishedAt,
      observedAt: enrichedCandidate.observedAt,
      summary: candidate.summary || primary.fullText.slice(0, 300),
      topicSignature: signature,
      newsFrame,
      editorialValue,
      hotness,
    },
    duplicateCheck: { ...duplicateCheck, signature },
    corroboration: evidence ? evidence.result.corroboratedBy : null,
  };
}

async function planDailyQueue({
  date,
  history = [],
  categories = [CATEGORIES.ECONOMY, CATEGORIES.ISSUE],
  hotMode = false,
  now = new Date(),
  fetchPortalRankingsImpl = fetchPortalRankings,
  fetchNewsImpl = fetchNews,
  fetchArticleBodyImpl = fetchArticleDocument,
  embedder,
  embeddingMatrixImpl = computeEmbeddingMatrix,
} = {}) {
  const portal = await fetchPortalRankingsImpl({ date, now });
  let candidates = portal.candidates || mergePopularCandidates(portal.results || {});
  let popularityFallback = null;
  if (portal.allFailed || candidates.length === 0) {
    const items = await fetchNewsImpl(config.newsRssUrl);
    candidates = rssCandidates(items, date);
    popularityFallback = {
      used: true,
      source: 'legacy_rss',
      errors: portal.errors || {},
      recordedAt: new Date().toISOString(),
    };
  }

  const results = {
    date,
    popularityFallback,
    candidates: candidates.map(candidate => ({ ...serializeCandidate(candidate), category: classifyCandidate(candidate).category, rejectionReasons: [] })),
    publications: {},
  };
  const topicHistory = history.filter(entry => entry.signature?.text);
  const signatures = candidates.map(candidate => buildTopicSignature(candidate, classifyCandidate(candidate).category));
  let embeddingMatrix = null;
  let embeddingError = null;
  if (topicHistory.length > 0 && !embedder) {
    try {
      embeddingMatrix = await embeddingMatrixImpl(
        signatures.map(signature => signature.text),
        topicHistory.map(entry => entry.signature.text)
      );
    } catch (error) {
      embeddingError = error;
    }
  }
  const usedUrls = new Set();

  for (const category of categories) {
    let selected = null;
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const candidate = candidates[candidateIndex];
      const record = results.candidates.find(item => item.url === candidate.url);
      if (usedUrls.has(candidate.url)) {
        record.rejectionReasons.push(`${category}:same_event_already_selected`);
        continue;
      }
      try {
        const evaluation = await evaluateCandidate(candidate, {
          category,
          allCandidates: candidates,
          history,
          fetchArticleBodyImpl,
          embedder,
          semanticScores: embeddingMatrix?.[candidateIndex],
          embeddingError,
          hotMode,
          now,
          referenceDate: date,
        });
        if (!evaluation.ok) {
          record.rejectionReasons.push(`${category}:${evaluation.reason}`);
          continue;
        }
        selected = evaluation;
        usedUrls.add(candidate.url);
        break;
      } catch (error) {
        record.rejectionReasons.push(`${category}:evaluation_error:${error.message}`);
      }
    }
    results.publications[category] = selected || {
      ok: false,
      status: 'no_publish',
      reason: hotMode ? 'no_candidate_passed_hotness_gate' : 'no_candidate_passed_quality_gates',
    };
  }
  return results;
}

module.exports = {
  corroborationPool,
  evaluateCandidate,
  hydrateArticle,
  planDailyQueue,
  rssCandidates,
  serializeCandidate,
};
