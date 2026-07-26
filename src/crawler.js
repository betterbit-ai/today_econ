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

/**
 * Fetches the full text of an article from its URL.
 * @param {string} articleUrl The URL of the news article.
 * @returns {Promise<string>} The full text of the article.
 */
async function fetchArticleBody(articleUrl) {
  let timeout;
  try {
    console.log(`[Crawler] Fetching full article body from: ${articleUrl}`);
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
      return '';
    }
    
    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove page chrome before selecting the editorial body. MK occasionally
    // renders author/search widgets inside the article wrapper, so selectors and
    // a final phrase sanitizer are both required.
    $('script, style, noscript, iframe, header, footer, nav, aside, form, button, figcaption').remove();
    $('[class*="author"], [class*="reporter"], [class*="byline"], [class*="google"], [class*="related"], [class*="recommend"], [class*="share"], [id*="author"], [id*="reporter"], [id*="google"], [id*="related"]').remove();
    $('[class*="caption"], [class*="photo_desc"], [class*="photo-desc"], [class*="copyright"], [class*="image_desc"], [class*="image-desc"]').remove();

    // Most news sites put their main content in article, .article, #article, #content, etc.
    let contentNode = $('.news_cnt_detail_wrap, .news_cnt_detail, .article_body, .article-body, #article_body, #news_body, #art_body, #dic_area, article').first();
    
    if (contentNode.length === 0) {
      // Fallback: Just grab body and let text extraction handle the rest
      contentNode = $('body');
    }

    // Cheerio's .text() concatenates adjacent block elements without a space.
    // Preserve editorial boundaries before extraction so `...했다.</p><p>20대`
    // cannot become `...했다.20대`, which makes multiple facts look like one
    // overlong sentence and causes the article to be rejected.
    contentNode.find('p, li, h2, h3, h4, blockquote').each((_, element) => {
      $(element).append('\n');
    });

    // Extract text and clean up excess whitespace
    let fullText = cleanArticleText(contentNode.text()).slice(0, 16000);
    
    // Normalize to NFC to avoid tokenizer issues as instructed in AGENTS.md
    if (fullText) {
      fullText = fullText.normalize('NFC');
    }

    console.log(`[Crawler] Successfully extracted ${fullText.length} characters from article body.`);
    return fullText;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.warn(`[Crawler] Fetch timed out for: ${articleUrl}`);
      return '';
    }
    console.error(`[Crawler] Failed to fetch article body: ${error.message}`);
    return '';
  } finally {
    if (typeof timeout !== 'undefined') clearTimeout(timeout);
  }
}

module.exports = {
  fetchNews,
  fetchOgImage,
  fetchArticleBody,
};
