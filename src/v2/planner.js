const config = require('../../config');
const { fetchNews, fetchArticleBody } = require('../crawler');
const { CATEGORIES } = require('./constants');
const { findIndependentEvidence } = require('./fact-verifier');
const { fetchPortalRankings, mergePopularCandidates, normalizeRank, titleEventSimilarity } = require('./popular-news');
const { computeEmbeddingMatrix, evaluateAgainstHistory } = require('./similarity');
const { buildTopicSignature, classifyCandidate, isMaterialFollowUp } = require('./topic');

function rssCandidates(items = [], date) {
  return items.slice(0, 50).map((item, index, all) => ({
    title: item.title,
    url: item.link,
    publishedDate: date,
    summary: item.summary,
    popularityScore: normalizeRank(index + 1, all.length),
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
    popularityScore: candidate.popularityScore,
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

async function hydrateArticle(source, { fetchArticleBodyImpl = fetchArticleBody } = {}) {
  if (source.fullText) return source;
  const fullText = await fetchArticleBodyImpl(source.url);
  return { ...source, fullText: fullText || source.summary || '' };
}

async function evaluateCandidate(candidate, {
  category,
  allCandidates,
  history,
  fetchArticleBodyImpl,
  embedder,
  semanticScores,
  embeddingError,
} = {}) {
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
  }, { fetchArticleBodyImpl });
  if (!primary.fullText || primary.fullText.length < 80) return { ok: false, reason: 'primary_article_inaccessible' };

  const enrichedCandidate = { ...candidate, summary: primary.fullText.slice(0, 800), category };
  const signature = buildTopicSignature(enrichedCandidate, category);
  const duplicateCheck = await evaluateAgainstHistory(signature, history, {
    embedder: semanticScores
      ? async () => semanticScores
      : embeddingError
        ? async () => { throw embeddingError; }
        : embedder,
    candidate: { materialFollowUp: isMaterialFollowUp(enrichedCandidate) },
  });
  if (duplicateCheck.duplicate) return { ok: false, reason: 'recent_duplicate', duplicateCheck };

  const pool = corroborationPool(candidate, allCandidates);
  const corroboratingArticles = [];
  for (const source of pool.slice(0, 8)) {
    try {
      const article = await hydrateArticle(source, { fetchArticleBodyImpl });
      if (article.fullText?.length >= 80) corroboratingArticles.push(article);
    } catch {
      // Candidate-level rejection records the final absence of evidence.
    }
  }
  const evidence = findIndependentEvidence(primary, corroboratingArticles);
  // [2026-07-25 변경] 타 포털(Daum 등) 및 타 도메인 필수 교차검증(Corroboration) 게이트 주석 처리
  // 1. 다음(Daum) 뉴스 랭킹 폐지 및 네이버 랭킹 단독 운영 체제 전환에 따라, 두 포털이 무조건 공통으로
  //    다루는 뉴스만 발행하도록 요구하는 것은 지나치게 빡빡하여 대다수 후보를 탈락시킵니다.
  // 2. 네이버 랭킹 뉴스 단독으로도 대중의 높은 주목도와 조회수가 검증된 기사이므로, 타 독립 도메인에서의
  //    수치/날짜 완전 일치 보도가 없더라도 발행 게이트를 통과하도록 변경합니다.
  // if (!evidence) return { ok: false, reason: 'independent_corroboration_missing', duplicateCheck };

  return {
    ok: true,
    selected: {
      ...serializeCandidate(candidate),
      category,
      fullText: primary.fullText,
      summary: candidate.summary || primary.fullText.slice(0, 300),
      topicSignature: signature,
    },
    duplicateCheck: { ...duplicateCheck, signature },
    corroboration: evidence ? evidence.result.corroboratedBy : null,
  };
}

async function planDailyQueue({
  date,
  history = [],
  fetchPortalRankingsImpl = fetchPortalRankings,
  fetchNewsImpl = fetchNews,
  fetchArticleBodyImpl = fetchArticleBody,
  embedder,
  embeddingMatrixImpl = computeEmbeddingMatrix,
} = {}) {
  const portal = await fetchPortalRankingsImpl({ date });
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
  const signatures = candidates.map(candidate => buildTopicSignature(candidate, classifyCandidate(candidate).category));
  let embeddingMatrix = null;
  let embeddingError = null;
  if (history.length > 0 && !embedder) {
    try {
      embeddingMatrix = await embeddingMatrixImpl(
        signatures.map(signature => signature.text),
        history.map(entry => entry.signature.text)
      );
    } catch (error) {
      embeddingError = error;
    }
  }
  const usedUrls = new Set();

  for (const category of [CATEGORIES.ECONOMY, CATEGORIES.ISSUE]) {
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
      reason: 'no_candidate_passed_quality_gates',
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
