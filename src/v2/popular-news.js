const cheerio = require('cheerio');
const { normalizeNfc } = require('./text');
const { extractSignatureTokens, jaccardSimilarity } = require('./topic');

const PORTAL_URLS = Object.freeze({
  naver: 'https://news.naver.com/main/ranking/popularDay.naver',
  // [2026-07-25 변경] 다음(Daum) 뉴스 교차검증 및 랭킹 수집 주석 처리
  // 1. 기존 Daum 뉴스 랭킹 페이지(/ranking/popular)가 서비스 중단(404 Not Found)되었습니다.
  // 2. 뉴스 메인(news.daum.net)에서 일반 기사를 파싱하는 것은 조회수 기반의 실제 대중 인기도를 반영하지 못합니다.
  // 3. 네이버와 다음 양쪽 포털이 무조건 동일 뉴스를 공통 보도해야 발행하도록 강제하는 교차검증 기준은 지나치게 엄격하여
  //    모든 뉴스 후보를 탈락(no_publish)시키는 원인이 됩니다.
  // 따라서 네이버 랭킹 단독으로 대중이 주목할 만한 기사를 수집 및 검증하여 발행하도록 다음 수집을 제외(주석 처리)합니다.
  // daum: 'https://news.daum.net/',
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
      let title = normalizeNfc(anchor.attr('data-title') || anchor.attr('title') || anchor.text()).replace(/\s+/g, ' ').trim();
      if (portal === 'daum') {
        // Strip trailing publisher + relative time, e.g. "뉴스1 1시간 전"
        title = title.replace(/\s+[\p{L}A-Za-z0-9]+\s+\d+[가-힣]+\s+전\s*$/u, '').trim();
      }
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
        publishedAt: primary.publishedAt || null,
        observedAt: primary.observedAt || null,
        popularityScore: Number((mean + (portals.size >= 2 ? 10 : 0)).toFixed(4)),
        crossPortal: portals.size >= 2,
        sources: cluster.sources.sort((a, b) => b.normalizedScore - a.normalizedScore),
      };
    })
    .sort((a, b) => b.popularityScore - a.popularityScore);
}

function detectCharset(contentType = '') {
  const match = contentType.match(/charset\s*=\s*([^\s;]+)/i);
  if (!match) return '';
  return match[1].trim().toLowerCase().replace(/^["']|["']$/g, '');
}

async function decodeResponseBody(response) {
  const charset = detectCharset(response.headers.get('content-type') || '');
  if (!charset || charset === 'utf-8' || charset === 'utf8') {
    return response.text();
  }
  const buffer = await response.arrayBuffer();
  return new TextDecoder(charset).decode(buffer);
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
    return await decodeResponseBody(response);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchPortalRankings({ date, now = new Date(), fetchImpl = fetch } = {}) {
  const results = {};
  const errors = {};
  await Promise.all(Object.entries(PORTAL_URLS).map(async ([portal, url]) => {
    try {
      const html = await fetchHtml(url, { fetchImpl });
      results[portal] = (portal === 'naver' ? parseNaverRanking(html, date) : parseDaumRanking(html, date))
        .map(item => ({ ...item, observedAt: now.toISOString() }));
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
  decodeResponseBody,
  detectCharset,
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
