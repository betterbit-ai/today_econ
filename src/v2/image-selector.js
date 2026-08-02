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
  'parliament',
  'law',
]);
const TYPOGRAPHY_VARIANT_COUNT = 64;

function articleSourceText(candidate = {}) {
  const frame = candidate.newsFrame || {};
  const primary = normalizeNfc([
    candidate.target,
    candidate.event,
    candidate.title,
    candidate.summary,
    frame.subject,
    frame.target,
    frame.event,
    frame.action,
    frame.state,
  ].filter(Boolean).join(' '));
  if (primary.length >= 24) return primary;
  return normalizeNfc(`${primary} ${String(candidate.fullText || '').slice(0, 500)}`).trim();
}

function isOccupationalHeatStory(text = '') {
  const normalized = normalizeNfc(text);
  const heat = /(폭염|고온|온열|열사병|체감온도|온도계|\d{2}(?:\.\d+)?\s*도)/u.test(normalized);
  const work = /(작업|작업자|노동|근로|현장|옥상|건설|배달|물류|농사|그늘|휴식)/u.test(normalized);
  return heat && work;
}

function eventVisualQueries(sourceText = '') {
  const queries = [];
  if (isOccupationalHeatStory(sourceText)) {
    queries.push('construction workers rooftop extreme heat', 'outdoor workers heatwave safety');
    return queries;
  }
  if (/(보완수사권|형사소송법|법안|개정안|본회의|국회|청와대|대통령실)/u.test(sourceText)) {
    if (/(대한민국|한국|국회|청와대|대통령실|여의도)/u.test(sourceText)) {
      queries.push('Korean National Assembly Seoul');
    }
    queries.push('law legislation legal document gavel');
  }
  return queries;
}

function inferFallbackTheme(candidate = {}) {
  const sourceText = articleSourceText(candidate);
  if (isOccupationalHeatStory(sourceText)) return 'occupational-heat';
  if (/(보완수사권|형사소송법|법안|개정안|본회의|국회|청와대|대통령실|정치|선거)/u.test(sourceText)) return 'legislation';
  if (/(주식|증시|코스피|코스닥|나스닥|주가|투자|금리|환율|GDP|성장률|물가|대출)/iu.test(sourceText)) return 'markets';
  if (/(반도체|칩|웨이퍼|AI|인공지능|데이터센터|배터리|전기차)/iu.test(sourceText)) return 'technology';
  if (/(부동산|주택|아파트|전세|월세)/u.test(sourceText)) return 'housing';
  if (/(의료|병원|건강|환자|보험|복지)/u.test(sourceText)) return 'health';
  if (/(기후|폭염|한파|홍수|가뭄|산불|탄소)/u.test(sourceText)) return 'climate';
  if (/(고용|취업|일자리|노동|근로)/u.test(sourceText)) return 'work';
  return candidate.category === 'economy' ? 'markets' : 'public-interest';
}

function stableVariantStart(candidate = {}, theme = '') {
  const seed = `${theme}|${candidate.target || ''}|${candidate.event || ''}|${candidate.title || ''}`;
  return Number.parseInt(crypto.createHash('sha256').update(normalizeNfc(seed)).digest('hex').slice(0, 8), 16)
    % TYPOGRAPHY_VARIANT_COUNT;
}

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
  const articleText = normalizeNfc(`${candidate.title || ''} ${String(candidate.summary || '').slice(0, 900)}`);
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

function geographicAssessment(image = {}, candidate = {}, query = '') {
  const titleText = normalizeNfc(candidate.title || '');
  const articleText = normalizeNfc(`${titleText} ${String(candidate.summary || '').slice(0, 900)}`);
  const metadata = imageMetadata(image);
  const koreanInstitution = /(국회|국회의사당|본회의|청와대|대통령실)/u.test(articleText);
  const queryRequestsKoreanPlace = /(korean|south\s*korea|seoul|yeouido).*(assembly|parliament|government|building|chamber)|(assembly|parliament|government|building|chamber).*(korean|south\s*korea|seoul|yeouido)/iu.test(query);
  const imageClaimsInstitution = /(parliament|assembly|government\s*building|chamber|국회|의사당|청와대)/iu.test(metadata);
  const requiredGeography = koreanInstitution && (queryRequestsKoreanPlace || imageClaimsInstitution)
    ? 'south_korea'
    : null;
  const matchedGeography = requiredGeography === 'south_korea'
    && /(south\s*korea|korean|korea|seoul|yeouido|대한민국|한국|서울|여의도)/iu.test(metadata);
  return {
    requiredGeography,
    matchedGeography: requiredGeography ? matchedGeography : true,
    missingGeography: requiredGeography && !matchedGeography ? requiredGeography : null,
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
  const geography = geographicAssessment(image, candidate, query);
  const subjectMatched = concreteQueryTokens.length > 0 && matchedConcreteTokens.length > 0;
  const roleMatched = roles.missingVisualRoles.length === 0;
  const geographyMatched = geography.missingGeography === null;
  const ok = subjectMatched && roleMatched && geographyMatched;

  return {
    ok,
    reason: concreteQueryTokens.length === 0
      ? 'concrete_query_missing'
      : !geographyMatched
        ? 'geographic_context_mismatch'
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
    ...geography,
  };
}

function buildImageQueries(candidate = {}) {
  const sourceText = articleSourceText(candidate);
  const frame = candidate.newsFrame || {};
  const directArticleIsAboutParliament = /국회(?:의사당|본회의|상임위|청문회)|국회.{0,12}(?:발표|법안|표결|회의)|의회\s*(?:내부|본회의)|국회의사당/u.test(sourceText);
  const eventQueries = eventVisualQueries(sourceText);
  const frameQueries = [];
  if (frame.eventKind === 'gdp') {
    frameQueries.push(/미국|미\s*상무부/u.test(sourceText)
      ? 'United States GDP economic growth'
      : 'GDP economic growth chart');
  } else if (eventQueries.length === 0 && (frame.eventKind === 'legislation' || directArticleIsAboutParliament) && /(대한민국|한국|국회|여의도|청와대|대통령실)/u.test(sourceText)) {
    frameQueries.push('Korean National Assembly Seoul');
  } else if (frame.eventKind === 'market_move') {
    frameQueries.push(/코스닥/u.test(sourceText) ? 'KOSDAQ stock market chart' : 'KOSPI stock market chart');
  } else if (frame.eventKind === 'asset_sale') {
    frameQueries.push(/반도체|칩|메모리/u.test(sourceText)
      ? 'semiconductor stock portfolio trading'
      : 'investment portfolio asset sale');
  } else if (frame.eventKind === 'earnings' && /반도체|삼성전자/u.test(sourceText)) {
    frameQueries.push('semiconductor microchip factory');
  }

  const occupationalHeat = isOccupationalHeatStory(sourceText);
  const visualKeywords = KOR_TO_ENG_VISUALS
    .filter(({ match }) => match.test(sourceText))
    .map(({ english }) => english)
    .filter(keyword => !(occupationalHeat && /real estate|apartment building/i.test(keyword)));

  const concreteVisuals = visualKeywords.filter(keyword => !/government parliament policy law/i.test(keyword));
  const governmentVisuals = visualKeywords.filter(keyword => /government parliament policy law/i.test(keyword));
  const requestedKeyword = isSpecificImageKeyword(candidate.imageKeyword) ? candidate.imageKeyword : '';
  const frameTokenSet = new Set(frameQueries.flatMap(query => extractSignatureTokens(query).map(token => token.toLowerCase())));
  const explicitKeyword = requestedKeyword && (
    frameQueries.length === 0
    || extractSignatureTokens(requestedKeyword).some(token => frameTokenSet.has(token.toLowerCase()))
  ) ? requestedKeyword : '';
  const fallbackVisuals = directArticleIsAboutParliament ? governmentVisuals : [];
  const providerReadyKeyword = explicitKeyword && /[a-z]{3}/iu.test(explicitKeyword) ? explicitKeyword : '';

  return [...new Set([
    ...eventQueries,
    ...frameQueries,
    ...concreteVisuals,
    providerReadyKeyword,
    ...fallbackVisuals,
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
    source.visualFingerprint,
    source.artVariantId,
  ].map(value => normalizeImageIdentifier(String(value || ''))).filter(Boolean))];
}

function recentImageKeySet(recentImages = []) {
  return new Set(recentImages.flatMap(imageReuseKeys));
}

function imageWasRecentlyUsed(image, recentKeys) {
  return imageReuseKeys(image).some(key => recentKeys.has(key));
}

function createTypographyFallback(candidate = {}, {
  attempts = [],
  recentImages = [],
  reuseWindowDays = 7,
  reason = 'no concrete-subject-matched licensed unused image met the confidence threshold',
} = {}) {
  const fallbackTheme = inferFallbackTheme(candidate);
  const recentKeys = recentImageKeySet(recentImages);
  const start = stableVariantStart(candidate, fallbackTheme);
  let fallbackVariant = start;
  let blockedCandidateCount = 0;
  for (let offset = 0; offset < TYPOGRAPHY_VARIANT_COUNT; offset += 1) {
    const variant = (start + offset) % TYPOGRAPHY_VARIANT_COUNT;
    const fingerprint = `diem-art:${fallbackTheme}:v${variant}`;
    if (!recentKeys.has(fingerprint)) {
      fallbackVariant = variant;
      break;
    }
    blockedCandidateCount += 1;
  }
  const visualFingerprint = `diem-art:${fallbackTheme}:v${fallbackVariant}`;
  return {
    kind: 'typographic',
    id: visualFingerprint,
    source: 'diem-original',
    license: { name: 'Project-owned original', url: null },
    selectedAt: new Date().toISOString(),
    attempts,
    score: 0,
    fallbackTheme,
    fallbackVariant,
    artVariantId: visualFingerprint,
    visualFingerprint,
    reuseGuard: {
      allowed: blockedCandidateCount < TYPOGRAPHY_VARIANT_COUNT,
      windowDays: reuseWindowDays,
      recentImageCount: recentImages.length,
      recentKeyCount: recentKeys.size,
      blockedCandidateCount: blockedCandidateCount
        + attempts.reduce((sum, attempt) => sum + (attempt.recentReuseBlocked || 0), 0),
      selectedImageKeys: [visualFingerprint],
    },
    selectionReason: `${reason}; topic-grounded ${fallbackTheme} art variant ${fallbackVariant} selected`,
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
            requiredGeography: image.suitability.requiredGeography,
            matchedGeography: image.suitability.matchedGeography,
            missingGeography: image.suitability.missingGeography,
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

  return createTypographyFallback(candidate, {
    attempts,
    recentImages,
    reuseWindowDays,
  });
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
  createTypographyFallback,
  downloadSelectedImage,
  imageReuseKeys,
  scoreImageCandidate,
  isSpecificImageKeyword,
  searchPexels,
  searchUnsplash,
  searchWikimedia,
  selectLicensedImage,
};
