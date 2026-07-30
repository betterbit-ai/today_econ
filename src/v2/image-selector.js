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

const KOR_TO_ENG_VISUALS = [
  { match: /결혼|혼인|신혼|축의금|예식/u, english: 'wedding couple marriage ceremony' },
  { match: /출산|육아|아동|보육|양육|저출생/u, english: 'family parents child childcare' },
  { match: /교육|학교|대학|학생|입시/u, english: 'students school education classroom' },
  { match: /개인정보|프라이버시|생체정보|얼굴|목소리/u, english: 'digital privacy face recognition data' },
  { match: /기후|폭염|한파|홍수|가뭄|탄소/u, english: 'climate weather environment' },
  { match: /외교|정상회담|국제정세/u, english: 'diplomacy international summit leaders' },
  { match: /자동차보험|차보험|교통사고|차량수리/u, english: 'car insurance accident repair' },
  { match: /국민연금|퇴직연금|연금개혁|노후/u, english: 'retirement pension senior finance' },
  { match: /반도체|칩|웨이퍼|설계|메모리/u, english: 'semiconductor microchip processor' },
  { match: /인공지능|AI|데이터센터|머신러닝/ui, english: 'artificial intelligence server data center' },
  { match: /부동산|주택|아파트|전세|월세/u, english: 'real estate modern apartment building' },
  { match: /금리|환율|물가|인플레이션|디플레이션|금융|대출/u, english: 'stock market trading finance chart' },
  { match: /배터리|전기차|EV|이차전지/ui, english: 'electric vehicle EV battery charging' },
  { match: /수출|수입|관세|무역|항만/u, english: 'cargo ship container port trade' },
  { match: /소비|유통|마트|백화점|쇼핑/u, english: 'retail shopping mall consumer' },
  { match: /의료|복지|병원|건강|건보/u, english: 'healthcare hospital medical clinic' },
  { match: /자동차|모빌리티|현대|기아/u, english: 'modern car automotive manufacturing' },
  { match: /주식|증시|코스피|나스닥|주가|종목|투자/u, english: 'stock market graph finance investment' },
  { match: /정부|정책|국회|정치|대통령|선거/u, english: 'government parliament policy law' },
  { match: /고용|취업|일자리|노동/u, english: 'office workers business meeting career' },
];

const GENERIC_IMAGE_KEYWORD = /^(?:government|policy|government policy|parliament|law|news|economy|finance|current affairs)(?:\s+(?:government|policy|parliament|law|news|economy|finance|current affairs))*$/i;
const GENERIC_VISUAL_TOKENS = new Set([
  'government',
  'policy',
  'news',
  'economy',
  'finance',
  'current',
  'affairs',
  'support',
  'program',
  'announcement',
  'change',
]);

function isSpecificImageKeyword(value = '') {
  const keyword = normalizeNfc(value).trim();
  if (keyword.length < 3 || GENERIC_IMAGE_KEYWORD.test(keyword)) return false;
  return keyword.toLowerCase().split(/\s+/u).some(token => token.length >= 4 && !GENERIC_VISUAL_TOKENS.has(token));
}

function imageMetadata(image = {}) {
  return normalizeNfc(`${image.description || ''} ${image.alt || ''} ${(image.tags || []).join(' ')}`);
}

const ARTICLE_VISUAL_ROLES = Object.freeze([
  {
    id: 'minor_student',
    article: /(\d{1,2}세|미성년|여학생|남학생|고등학생|중학생|초등학생|청소년)/u,
    metadata: /(teen|teenage|student|schoolgirl|schoolboy|youth|child|adolescent)/iu,
  },
  {
    id: 'patient',
    article: /(환자|복통|응급\s*이송|긴급\s*이송|병원으로\s*(?:이송|옮겨)|치료를?\s*받)/u,
    metadata: /(patient|receiving\s*(?:care|treatment)|emergency\s*(?:room|patient)|ambulance|hospital\s*bed|sick|injured)/iu,
  },
]);

function visualRoleAssessment(image = {}, candidate = {}) {
  const articleText = normalizeNfc(`${candidate.title || ''} ${candidate.summary || ''} ${candidate.fullText || ''}`);
  const metadata = imageMetadata(image);
  const requiredVisualRoles = ARTICLE_VISUAL_ROLES
    .filter(role => role.article.test(articleText))
    .map(role => role.id);
  const matchedVisualRoles = ARTICLE_VISUAL_ROLES
    .filter(role => requiredVisualRoles.includes(role.id) && role.metadata.test(metadata))
    .map(role => role.id);
  return {
    requiredVisualRoles,
    matchedVisualRoles,
    missingVisualRoles: requiredVisualRoles.filter(role => !matchedVisualRoles.includes(role)),
  };
}

function assessImageSuitability(image = {}, query = '', candidate = {}) {
  const queryTokens = extractSignatureTokens(normalizeNfc(query))
    .map(token => token.toLowerCase());
  const concreteQueryTokens = [...new Set(
    queryTokens.filter(token => !GENERIC_VISUAL_TOKENS.has(token))
  )];
  const metadataTokens = new Set(
    extractSignatureTokens(imageMetadata(image)).map(token => token.toLowerCase())
  );
  const matchedConcreteTokens = concreteQueryTokens.filter(token => metadataTokens.has(token));
  const roles = visualRoleAssessment(image, candidate);
  const subjectMatched = concreteQueryTokens.length > 0 && matchedConcreteTokens.length > 0;
  const roleMatched = roles.missingVisualRoles.length === 0;
  const ok = subjectMatched && roleMatched;

  return {
    ok,
    reason: concreteQueryTokens.length === 0
      ? 'concrete_query_missing'
      : !subjectMatched
        ? 'concrete_subject_missing'
        : !roleMatched
          ? 'article_subject_role_mismatch'
          : ok
        ? 'concrete_subject_matched'
        : 'concrete_subject_missing',
    concreteQueryTokens,
    matchedConcreteTokens,
    matchRatio: Number((matchedConcreteTokens.length / Math.max(1, concreteQueryTokens.length)).toFixed(4)),
    ...roles,
  };
}

function buildImageQueries(candidate = {}) {
  const sourceText = `${candidate.target || ''} ${candidate.event || ''} ${candidate.title || ''}`;
  const tokens = extractSignatureTokens(sourceText);

  const visualKeywords = KOR_TO_ENG_VISUALS
    .filter(({ match }) => match.test(sourceText))
    .map(({ english }) => english);

  const concreteVisuals = visualKeywords.filter(keyword => !/government parliament policy law/i.test(keyword));
  const governmentVisuals = visualKeywords.filter(keyword => /government parliament policy law/i.test(keyword));
  const explicitKeyword = isSpecificImageKeyword(candidate.imageKeyword) ? candidate.imageKeyword : '';
  const directArticleIsAboutParliament = /국회(?:의사당|본회의|상임위|청문회)|국회.{0,12}(?:발표|법안|표결|회의)|의회\s*(?:내부|본회의)|국회의사당/u.test(sourceText);
  const fallbackVisuals = directArticleIsAboutParliament ? governmentVisuals : [];

  return [...new Set([
    ...concreteVisuals,
    explicitKeyword,
    ...fallbackVisuals,
    tokens.slice(0, 3).join(' '),
    tokens.slice(0, 2).join(' '),
  ].map(value => normalizeNfc(value).trim()).filter(value => value.length >= 2))].slice(0, 5);
}

function scoreImageCandidate(image, query, _signature = '') {
  const metadata = imageMetadata(image);
  const queryTokens = extractSignatureTokens(query).map(token => token.toLowerCase());
  const metadataTokens = new Set(extractSignatureTokens(metadata).map(token => token.toLowerCase()));
  const overlap = queryTokens.filter(token => metadataTokens.has(token)).length / Math.max(1, queryTokens.length);
  const width = Number(image.width) || 0;
  const height = Number(image.height) || 0;
  const resolution = width >= 1080 && height >= 1350 ? 1 : Math.min(1, (width * height) / (1080 * 1350));
  const portrait = height >= width ? 1 : Math.max(0.2, height / Math.max(1, width));
  const watermarkPenalty = /watermark|logo|template|mockup/i.test(metadata) ? 0.5 : 0;
  const score = overlap * 0.65 + resolution * 0.15 + portrait * 0.15 + (image.source === 'pexels' ? 0.05 : 0) - watermarkPenalty;
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

function normalizeImageIdentifier(value = '') {
  const normalized = normalizeNfc(value).trim();
  if (!normalized) return '';
  return normalized.replace(/[?#].*$/u, '');
}

function imageReuseKeys(image = {}) {
  const source = image.image || image;
  return [...new Set([
    source.id,
    source.originalUrl,
    source.downloadUrl,
    source.localSha256,
    source.sha256,
  ].map(value => normalizeImageIdentifier(String(value || ''))).filter(Boolean))];
}

function recentImageKeySet(recentImages = []) {
  return new Set(recentImages.flatMap(imageReuseKeys));
}

function imageWasRecentlyUsed(image, recentKeys) {
  return imageReuseKeys(image).some(key => recentKeys.has(key));
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
  recentImages = [],
  reuseWindowDays = 7,
} = {}) {
  const queries = buildImageQueries(candidate);
  const attempts = [];
  const recentKeys = recentImageKeySet(recentImages);
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
          .map(image => ({
            ...image,
            query,
            ...scoreImageCandidate(image, query, candidate.title),
            suitability: assessImageSuitability(image, query, candidate),
          }))
          .filter(image => image.downloadUrl && image.width >= 800 && image.height >= 800)
          .sort((a, b) => b.score - a.score)
          .map((image, index) => ({ ...image, rankWithinQuery: index + 1 }));
        const suitable = scored.filter(image => (
          image.components.semanticMetadata > 0 && image.suitability.ok
        ));
        const eligible = suitable.filter(img => img.score >= minimumScore);
        const blocked = eligible.filter(image => imageWasRecentlyUsed(image, recentKeys));
        const unused = eligible.filter(image => !imageWasRecentlyUsed(image, recentKeys));
        const suitabilityRejections = scored
          .filter(image => !image.suitability.ok)
          .map(image => ({
            id: image.id,
            rankWithinQuery: image.rankWithinQuery,
            reason: image.suitability.reason,
            concreteQueryTokens: image.suitability.concreteQueryTokens,
            matchedConcreteTokens: image.suitability.matchedConcreteTokens,
            requiredVisualRoles: image.suitability.requiredVisualRoles,
            matchedVisualRoles: image.suitability.matchedVisualRoles,
            missingVisualRoles: image.suitability.missingVisualRoles,
          }));
        const suitabilityRejected = suitabilityRejections.length;
        attempts.push({
          provider: provider.name,
          query,
          count: scored.length,
          suitableCount: suitable.length,
          suitabilityRejected,
          suitabilityRejections,
          eligibleCount: eligible.length,
          recentReuseBlocked: blocked.length,
          bestScore: scored[0]?.score ?? null,
        });
        if (unused.length > 0) {
          const topN = unused.slice(0, 5);
          const selectedIndex = 0;
          const selected = topN[selectedIndex];
          return {
            kind: 'web',
            selectedAt: new Date().toISOString(),
            ...selected,
            selectedPoolIndex: selectedIndex + 1,
            selectionPoolSize: topN.length,
            attempts,
            reuseGuard: {
              allowed: true,
              windowDays: reuseWindowDays,
              recentImageCount: recentImages.length,
              recentKeyCount: recentKeys.size,
              blockedCandidateCount: blocked.length,
              selectedImageKeys: imageReuseKeys(selected),
            },
            selectionReason: `selected concrete-subject-matched unused rank #${selected.rankWithinQuery} from ${provider.name} results above ${minimumScore}; ${suitabilityRejected} unsuitable and ${blocked.length} recent images blocked`,
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
    reuseGuard: {
      allowed: true,
      windowDays: reuseWindowDays,
      recentImageCount: recentImages.length,
      recentKeyCount: recentKeys.size,
      blockedCandidateCount: attempts.reduce((sum, attempt) => sum + (attempt.recentReuseBlocked || 0), 0),
    },
    selectionReason: 'no concrete-subject-matched licensed unused image met the confidence threshold',
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
  assessImageSuitability,
  buildImageQueries,
  downloadSelectedImage,
  imageReuseKeys,
  scoreImageCandidate,
  isSpecificImageKeyword,
  searchPexels,
  searchUnsplash,
  searchWikimedia,
  selectLicensedImage,
};
