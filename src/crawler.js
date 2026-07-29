const Parser = require('rss-parser');
const cheerio = require('cheerio');
const { cleanArticleText } = require('./article');
const parser = new Parser();

/**
 * Fetches the og:image URL from an article page.
 * @param {string} articleUrl The URL of the news article.
 * @returns {Promise<string|null>} The og:image URL or null if not found.
 */
async function fetchOgImage(articleUrl) {
  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(articleUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TodayEconBot/1.0)',
      },
    });
    clearTimeout(timeout);
    
    if (!response.ok) return null;
    
    const html = await response.text();
    
    // Extract og:image from meta tags
    const ogMatch = html.match(/<meta\s+(?:property|name)=["']og:image["']\s+content=["']([^"']+)["']/i)
      || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["']og:image["']/i);
    
    if (ogMatch && ogMatch[1]) {
      const imageUrl = ogMatch[1].trim();
      const lowerUrl = imageUrl.toLowerCase();
      
      // Filter out typical brand logos or social share fallback images
      const logoPatterns = [
        'logo',
        'default',
        'bi_sns',
        'ci_sns',
        'sns_share',
        'facebook_share',
        'facebook_mknews',
        'twitter_share',
        'mk_bi',
        'mk_ci',
        'mk_logo',
        'main_logo',
        'snslogo',
        'sns_logo',
        'temp/logo',
        'mklogo',
        'brand'
      ];
      
      if (logoPatterns.some(pattern => lowerUrl.includes(pattern))) {
        console.log(`[Crawler] Filtered out corporate brand logo/fallback image: ${imageUrl}`);
        return null;
      }

      // Validate it looks like an actual image URL
      if (imageUrl.startsWith('http') && /\.(jpg|jpeg|png|webp|gif)/i.test(imageUrl)) {
        return imageUrl;
      }
      // Some og:image URLs don't have extensions but are still valid
      if (imageUrl.startsWith('http')) {
        return imageUrl;
      }
    }
    
    return null;
  } catch (error) {
    console.warn(`[Crawler] Failed to fetch og:image from ${articleUrl}:`, error.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches and parses economic news articles from an RSS feed.
 * @param {string} rssUrl The URL of the RSS feed to fetch.
 * @returns {Promise<Array<{title: string, link: string, pubDate: string, summary: string, imageUrl: string|null}>>}
 */
async function fetchNews(rssUrl) {
  try {
    console.log(`[Crawler] Fetching RSS feed from: ${rssUrl}`);
    const feed = await parser.parseURL(rssUrl);
    
    if (!feed.items || feed.items.length === 0) {
      console.warn('[Crawler] No news items found in feed.');
      return [];
    }

    const items = feed.items
      .map(item => {
        // Extract cleanest summary possible
        const summary = item.contentSnippet || item.content || item.description || '';
        return {
          title: item.title ? item.title.trim() : '',
          link: item.link ? item.link.trim() : '',
          pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
          summary: summary.trim().substring(0, 300),
          imageUrl: null, // Will be populated after selection
        };
      })
      .filter(item => {
        const lowerTitle = item.title.toLowerCase();
        // Filter out completely irrelevant news types early
        if (lowerTitle.includes('[인사]')) return false;
        if (lowerTitle.includes('[부고]')) return false;
        if (lowerTitle.includes('[동정]')) return false;
        if (lowerTitle.includes('[알림]')) return false;
        if (lowerTitle.includes('[게시판]')) return false;
        if (lowerTitle.includes('[부음]')) return false;
        return true;
      });

    console.log(`[Crawler] Successfully parsed ${items.length} items.`);
    return items;
  } catch (error) {
    console.error('[Crawler] Failed to parse RSS feed:', error);
    throw error;
  }
}

function normalizePublishedAt(value = '') {
  const clean = String(value).normalize('NFC').trim();
  if (!clean) return null;
  if (!Number.isNaN(new Date(clean).getTime())) return clean;
  const korean = clean.match(/(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})[.\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/u);
  if (!korean) return null;
  const [, year, month, day, hour, minute, second = '00'] = korean;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour.padStart(2, '0')}:${minute}:${second}+09:00`;
}

function extractPublishedAt($) {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:regDate"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
  ];
  for (const selector of selectors) {
    const value = $(selector).first().attr('content');
    const normalized = normalizePublishedAt(value);
    if (normalized) return normalized;
  }
  const dataDateTime = $('[data-date-time]').first().attr('data-date-time');
  const normalizedDataDate = normalizePublishedAt(dataDateTime);
  if (normalizedDataDate) return normalizedDataDate;

  for (const element of $('script[type="application/ld+json"]').toArray()) {
    try {
      const parsed = JSON.parse($(element).text());
      const records = Array.isArray(parsed) ? parsed : [parsed];
      const date = records.flatMap(record => record?.['@graph'] || [record])
        .map(record => record?.datePublished)
        .find(Boolean);
      const normalized = normalizePublishedAt(date);
      if (normalized) return normalized;
    } catch {
      // Invalid page-owned JSON-LD must not block body extraction.
    }
  }
  return null;
}

function parseArticleDocument(html = '') {
  const $ = cheerio.load(html);
  const publishedAt = extractPublishedAt($);

  // Remove page chrome before selecting the editorial body. MK occasionally
  // renders author/search widgets inside the article wrapper, so selectors and
  // a final phrase sanitizer are both required.
  $('script, style, noscript, iframe, header, footer, nav, aside, form, button, figcaption').remove();
  $('[class*="author"], [class*="reporter"], [class*="byline"], [class*="google"], [class*="related"], [class*="recommend"], [class*="share"], [id*="author"], [id*="reporter"], [id*="google"], [id*="related"]').remove();
  $('[class*="caption"], [class*="photo_desc"], [class*="photo-desc"], [class*="copyright"], [class*="image_desc"], [class*="image-desc"]').remove();

  let contentNode = $('.news_cnt_detail_wrap, .news_cnt_detail, .article_body, .article-body, #article_body, #news_body, #art_body, #dic_area, article').first();
  if (contentNode.length === 0) contentNode = $('body');
  contentNode.find('p, li, h2, h3, h4, blockquote').each((_, element) => {
    $(element).append('\n');
  });

  const fullText = cleanArticleText(contentNode.text()).slice(0, 16000).normalize('NFC');
  return { fullText, publishedAt };
}

/**
 * Fetches the full text and publication time of an article from its URL.
 * @param {string} articleUrl The URL of the news article.
 * @returns {Promise<{fullText: string, publishedAt: string|null}>}
 */
async function fetchArticleDocument(articleUrl) {
  let timeout;
  try {
    console.log(`[Crawler] Fetching article document from: ${articleUrl}`);
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(articleUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
      },
    });
    
    if (!response.ok) {
      console.warn(`[Crawler] Failed to fetch article body, status: ${response.status}`);
      return { fullText: '', publishedAt: null };
    }
    
    const article = parseArticleDocument(await response.text());
    console.log(`[Crawler] Successfully extracted ${article.fullText.length} characters from article body.`);
    return article;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`[Crawler] Fetch timed out for: ${articleUrl}`);
      return { fullText: '', publishedAt: null };
    }
    console.error(`[Crawler] Failed to fetch article body: ${error.message}`);
    return { fullText: '', publishedAt: null };
  } finally {
    if (typeof timeout !== 'undefined') clearTimeout(timeout);
  }
}

async function fetchArticleBody(articleUrl) {
  return (await fetchArticleDocument(articleUrl)).fullText;
}

module.exports = {
  fetchNews,
  fetchOgImage,
  fetchArticleBody,
  fetchArticleDocument,
  normalizePublishedAt,
  parseArticleDocument,
};
