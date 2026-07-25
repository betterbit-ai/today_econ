const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { extractSignatureTokens } = require('./topic');
const { normalizeNfc } = require('./text');

const LICENSES = Object.freeze({
  pexels: { name: 'Pexels License', url: 'https://www.pexels.com/license/' },
  unsplash: { name: 'Unsplash License', url: 'https://unsplash.com/license' },
});
const WIKIMEDIA_LICENSE = /public domain|cc0|cc by(?:-sa)?(?:\s|$)/i;

function buildImageQueries(candidate = {}) {
  const tokens = extractSignatureTokens(`${candidate.target || ''} ${candidate.event || ''} ${candidate.title || ''}`);
  const categoryConcept = candidate.category === 'issue' ? 'Korea current affairs policy' : 'Korea economy finance';
  return [...new Set([
    tokens.slice(0, 3).join(' '),
    `${tokens.slice(0, 2).join(' ')} ${candidate.event || ''}`.trim(),
    `${tokens[0] || ''} ${categoryConcept}`.trim(),
    categoryConcept,
  ].map(value => normalizeNfc(value).trim()).filter(value => value.length >= 2))].slice(0, 5);
}

function scoreImageCandidate(image, query, signature = '') {
  const metadata = `${image.description || ''} ${image.alt || ''} ${(image.tags || []).join(' ')}`;
  const queryTokens = extractSignatureTokens(`${query} ${signature}`);
  const metadataTokens = new Set(extractSignatureTokens(metadata));
  const overlap = queryTokens.filter(token => metadataTokens.has(token)).length / Math.max(1, queryTokens.length);
  const width = Number(image.width) || 0;
  const height = Number(image.height) || 0;
  const resolution = width >= 1080 && height >= 1350 ? 1 : Math.min(1, (width * height) / (1080 * 1350));
  const portrait = height >= width ? 1 : Math.max(0.2, height / Math.max(1, width));
  const watermarkPenalty = /watermark|logo|template|mockup/i.test(metadata) ? 0.5 : 0;
  const score = overlap * 0.55 + resolution * 0.2 + portrait * 0.2 + (image.source === 'pexels' ? 0.05 : 0) - watermarkPenalty;
  return {
    score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
    components: {
      semanticMetadata: Number(overlap.toFixed(4)),
      resolution: Number(resolution.toFixed(4)),
      cropSafety: Number(portrait.toFixed(4)),
      watermarkPenalty,
    },
  };
}

async function fetchJson(url, { fetchImpl = fetch, headers = {} } = {}) {
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'DIEMNewsBot/2.0', ...headers } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  return response.json();
}

async function searchPexels(query, { apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey) return [];
  const url = `https://api.pexels.com/v1/search?orientation=portrait&per_page=20&query=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, { fetchImpl, headers: { Authorization: apiKey } });
  return (data.photos || []).map(photo => ({
    id: `pexels:${photo.id}`,
    source: 'pexels',
    originalUrl: photo.url,
    downloadUrl: photo.src?.portrait || photo.src?.large2x || photo.src?.original,
    creator: photo.photographer,
    creatorUrl: photo.photographer_url,
    width: photo.width,
    height: photo.height,
    description: photo.alt || '',
    license: LICENSES.pexels,
  }));
}

async function searchUnsplash(query, { accessKey, fetchImpl = fetch } = {}) {
  if (!accessKey) return [];
  const url = `https://api.unsplash.com/search/photos?orientation=portrait&per_page=20&query=${encodeURIComponent(query)}`;
  const data = await fetchJson(url, { fetchImpl, headers: { Authorization: `Client-ID ${accessKey}` } });
  return (data.results || []).map(photo => ({
    id: `unsplash:${photo.id}`,
    source: 'unsplash',
    originalUrl: photo.links?.html,
    downloadUrl: photo.urls?.regular || photo.urls?.full,
    creator: photo.user?.name,
    creatorUrl: photo.user?.links?.html,
    width: photo.width,
    height: photo.height,
    description: photo.description || photo.alt_description || '',
    license: LICENSES.unsplash,
  }));
}

async function searchWikimedia(query, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: '20',
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size',
    format: 'json',
    origin: '*',
  });
  const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`, { fetchImpl });
  return Object.values(data.query?.pages || {}).flatMap(page => {
    const info = page.imageinfo?.[0];
    const metadata = info?.extmetadata || {};
    const licenseName = metadata.LicenseShortName?.value || metadata.UsageTerms?.value || '';
    if (!info?.url || !WIKIMEDIA_LICENSE.test(licenseName)) return [];
    return [{
      id: `wikimedia:${page.pageid}`,
      source: 'wikimedia',
      originalUrl: info.descriptionurl,
      downloadUrl: info.thumburl || info.url,
      creator: String(metadata.Artist?.value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      width: info.width,
      height: info.height,
      description: page.title,
      license: {
        name: licenseName,
        url: metadata.LicenseUrl?.value || 'https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia',
      },
    }];
  });
}

async function selectLicensedImage(candidate, {
  pexelsApiKey,
  unsplashAccessKey,
  fetchImpl = fetch,
  minimumScore = 0.42,
} = {}) {
  const queries = buildImageQueries(candidate);
  const attempts = [];
  const providers = [
    { name: 'pexels', search: query => searchPexels(query, { apiKey: pexelsApiKey, fetchImpl }) },
    { name: 'unsplash', search: query => searchUnsplash(query, { accessKey: unsplashAccessKey, fetchImpl }) },
    { name: 'wikimedia', search: query => searchWikimedia(query, { fetchImpl }) },
  ];

  for (const provider of providers) {
    for (const query of queries) {
      try {
        const images = (await provider.search(query)).slice(0, 20);
        const scored = images
          .map(image => ({ ...image, query, ...scoreImageCandidate(image, query, candidate.title) }))
          .filter(image => image.downloadUrl && image.width >= 800 && image.height >= 800)
          .sort((a, b) => b.score - a.score);
        attempts.push({ provider: provider.name, query, count: scored.length, bestScore: scored[0]?.score ?? null });
        if (scored[0]?.score >= minimumScore) {
          return {
            kind: 'web',
            selectedAt: new Date().toISOString(),
            ...scored[0],
            attempts,
            selectionReason: `highest licensed ${provider.name} result above ${minimumScore}`,
          };
        }
      } catch (error) {
        attempts.push({ provider: provider.name, query, count: 0, error: error.message });
      }
    }
  }

  return {
    kind: 'typographic',
    source: 'diem-original',
    license: { name: 'Project-owned original', url: null },
    selectedAt: new Date().toISOString(),
    attempts,
    score: 0,
    selectionReason: 'no licensed image met the confidence threshold',
  };
}

async function downloadSelectedImage(selection, { fetchImpl = fetch, outputDir = os.tmpdir() } = {}) {
  if (!selection || selection.kind !== 'web') return { ...selection, localPath: null, sha256: null };
  const response = await fetchImpl(selection.downloadUrl, { headers: { 'User-Agent': 'DIEMNewsBot/2.0' } });
  if (!response.ok) throw new Error(`[DIEM Image] download failed: ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!/^image\//i.test(contentType)) throw new Error(`[DIEM Image] unexpected content type: ${contentType}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 5000) throw new Error('[DIEM Image] downloaded image is too small');
  fs.mkdirSync(outputDir, { recursive: true });
  const extension = /png/i.test(contentType) ? '.png' : /webp/i.test(contentType) ? '.webp' : '.jpg';
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const localPath = path.join(outputDir, `diem-image-${sha256.slice(0, 12)}${extension}`);
  fs.writeFileSync(localPath, buffer);
  return { ...selection, localPath, sha256, bytes: buffer.length, contentType };
}

module.exports = {
  LICENSES,
  buildImageQueries,
  downloadSelectedImage,
  scoreImageCandidate,
  searchPexels,
  searchUnsplash,
  searchWikimedia,
  selectLicensedImage,
};
