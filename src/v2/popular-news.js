const cheerio = require('cheerio');
const { normalizeNfc } = require('./text');
const { extractSignatureTokens, jaccardSimilarity } = require('./topic');

const PORTAL_URLS = Object.freeze({
  naver: 'https://news.naver.com/main/ranking/popularDay.naver',
  daum: 'https://news.daum.net/ranking/popular',
});

function normalizeRank(rank, count) {
  const size = Math.max(1, Number(count) || 1);
  const position = Math.max(1, Math.min(size, Number(rank) || 1));
  if (size === 1) return 100;
  return Number((100 - (99 * (position - 1)) / (size - 1)).toFixed(4));
}

function absoluteUrl(value, base) {
  try {
    return new URL(value, base).toString();
  } catch {
    return '';
  }
}

function canonicalUrl(value = '') {
  try {
    const url = new URL(value);
    ['sid', 'sid1', 'oid', 'aid', 'type', 'mode', 'mid', 'utm_source', 'utm_medium', 'utm_campaign']
      .forEach(key => url.searchParams.delete(key));
    url.hash = '';
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return String(value).trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

function normalizedTitle(value = '') {
  return normalizeNfc(value)
    .replace(/^\[[^\]]+\]\s*/u, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseRankingHtml(html, {
  portal,
  date,
  baseUrl = PORTAL_URLS[portal],
  selectors,
} = {}) {
  const $ = cheerio.load(html);
  const seen = new Set();
  const items = [];
  const selectorList = selectors || (portal === 'naver'
    ? [
      '.rankingnews_list a.list_title',
      '.rankingnews_box a.list_title',
      'a[href*="n.news.naver.com/mnews/article"]',
      'a[href*="/article/"]',
    ]
    : [
      '.list_news2 a.link_txt',
      '.rank_news a.link_txt',
      'a[href*="v.daum.net/v/"]',
      'a[href*="news.daum.net/v/"]',
    ]);

  for (const selector of selectorList) {
    $(selector).each((_, element) => {
      if (items.length >= 50) return false;
      const anchor = $(element);
      const title = normalizeNfc(anchor.attr('data-title') || anchor.attr('title') || anchor.text()).replace(/\s+/g, ' ').trim();
      const url = absoluteUrl(anchor.attr('href'), baseUrl);
      const key = `${canonicalUrl(url)}|${normalizedTitle(title)}`;
      if (!title || title.length < 4 || !url || seen.has(key)) return;
      if (portal === 'naver' && !/naver\.com/i.test(url)) return;
      if (portal === 'daum' && !/(daum\.net|v\.daum\.net)/i.test(url)) return;
      seen.add(key);
      items.push({ portal, rank: items.length + 1, title, url, date });
    });
    if (items.length >= 50) break;
  }

  return items.map(item => ({ ...item, normalizedScore: normalizeRank(item.rank, items.length) }));
}

function parseNaverRanking(html, date) {
  return parseRankingHtml(html, { portal: 'naver', date });
}

function parseDaumRanking(html, date) {
  return parseRankingHtml(html, { portal: 'daum', date });
}

function titleEventSimilarity(left = '', right = '') {
  const a = normalizedTitle(left);
  const b = normalizedTitle(right);
  if (a === b) return 1;
  return jaccardSimilarity(a, b);
}

function sameCandidate(left, right) {
  if (canonicalUrl(left.url) === canonicalUrl(right.url)) return true;
  const similarity = titleEventSimilarity(left.title, right.title);
  if (similarity >= 0.55) return true;
  const leftTokens = extractSignatureTokens(left.title);
  const rightTokens = new Set(extractSignatureTokens(right.title));
  const shared = leftTokens.filter(token => rightTokens.has(token));
  return shared.length >= 3 && shared.some(token => /\d|은행|정부|기업|법|정책|금리|주택/u.test(token));
}

function mergePopularCandidates(portalResults = {}) {
  const clusters = [];
  for (const source of Object.values(portalResults).flat().filter(Boolean)) {
    let cluster = clusters.find(entry => entry.sources.some(existing => sameCandidate(existing, source)));
    if (!cluster) {
      cluster = { sources: [] };
      clusters.push(cluster);
    }
    if (!cluster.sources.some(existing => existing.portal === source.portal && canonicalUrl(existing.url) === canonicalUrl(source.url))) {
      cluster.sources.push(source);
    }
  }

  return clusters
    .map(cluster => {
      const portals = new Set(cluster.sources.map(source => source.portal));
      const mean = cluster.sources.reduce((sum, source) => sum + source.normalizedScore, 0) / cluster.sources.length;
      const primary = [...cluster.sources].sort((a, b) => b.normalizedScore - a.normalizedScore)[0];
      return {
        title: primary.title,
        url: primary.url,
        publishedDate: primary.date,
        popularityScore: Number((mean + (portals.size >= 2 ? 10 : 0)).toFixed(4)),
        crossPortal: portals.size >= 2,
        sources: cluster.sources.sort((a, b) => b.normalizedScore - a.normalizedScore),
      };
    })
    .sort((a, b) => b.popularityScore - a.popularityScore);
}

async function fetchHtml(url, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DIEMNewsBot/2.0)',
        'Accept-Language': 'ko-KR,ko;q=0.9',
      },
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPortalRankings({ date, fetchImpl = fetch } = {}) {
  const results = {};
  const errors = {};
  await Promise.all(Object.entries(PORTAL_URLS).map(async ([portal, url]) => {
    try {
      const html = await fetchHtml(url, { fetchImpl });
      results[portal] = portal === 'naver' ? parseNaverRanking(html, date) : parseDaumRanking(html, date);
      if (results[portal].length === 0) throw new Error('ranking parser returned no articles');
    } catch (error) {
      results[portal] = [];
      errors[portal] = error.message;
    }
  }));
  return {
    results,
    errors,
    candidates: mergePopularCandidates(results),
    allFailed: Object.values(results).every(items => items.length === 0),
  };
}

module.exports = {
  PORTAL_URLS,
  canonicalUrl,
  fetchPortalRankings,
  mergePopularCandidates,
  normalizeRank,
  normalizedTitle,
  parseDaumRanking,
  parseNaverRanking,
  parseRankingHtml,
  sameCandidate,
  titleEventSimilarity,
};
