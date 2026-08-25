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
const OPENVERSE_LICENSES = new Set(['cc0', 'pdm', 'by', 'by-sa']);
const GENERATED_FALLBACK_ROOT = path.join(__dirname, '..', '..', 'assets', 'fallback', 'generated');
const GENERATED_FALLBACK_MANIFEST = JSON.parse(fs.readFileSync(path.join(GENERATED_FALLBACK_ROOT, 'manifest.json'), 'utf8'));

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
const LOW_INFORMATION_VISUAL_TOKENS = new Set([
  'south',
  'korea',
  'korean',
  'seoul',
  'city',
  'cityscape',
  'road',
  'street',
  'intersection',
  'building',
  'office',
]);
const TYPOGRAPHY_VARIANT_COUNT = 64;
const PERSON_ROLE_PATTERN = '전\\s*대통령(?!직속)|대통령(?!직속)|총리|부총리|장관|의원|대표|회장|총재|배우|가수|목사|교수|감독|선수|변호사|검사|판사|작가|방송인|후보';
const NON_PERSON_NAMES = new Set([
  '국내', '국민', '국회', '당국', '당대표', '대선', '대표', '미국', '법원', '서울', '정부', '전직', '차세대', '현직', '한국', '회사',
  '후보가', '후보는', '후보로', '후보를', '후보의',
]);
const PERSON_METADATA_PATTERN = /\b(?:person|people|portraits?|models?|man|men|woman|women|boys?|girls?|students?|workers?|doctors?|nurses?|teachers?|actors?|actresses|singers?|couples?|parents?|children?|famil(?:y|ies)|crowds?)\b|(?:사람|인물|남성|여성|학생|노동자|근로자|의사|간호사|교사|배우|가수|아동|자녀|부부|부모|가족|군중)/iu;
const PERSON_FREE_CONTEXT_PATTERN = /\b(?:building|exterior|interior|architecture|office|institution|document|paper|contract|legislation|law|gavel|courtroom|cityscape|skyline|flag|chart|screen|billboard|computer|phone|factory|microchip|chip|vehicle|car|apartment|house|door|doorway|entrance|package|parcel|ballot\s+box|podium|memorial|monument|cemetery|graves?|hospital|classroom|landscape|weather|storm|rain|flood|heatwave|thermometer|equipment|machinery|road|street|roof|rooftop|construction\s+site)\b|(?:건물|외관|내부|건축|기관|문서|서류|계약서|법안|법률|의사봉|법정|도시|전경|국기|차트|화면|전광판|컴퓨터|공장|반도체|차량|자동차|아파트|주택|현관|문|택배|소포|투표함|연단|기념관|기념비|묘역|묘지|병원|교실|풍경|날씨|폭우|침수|폭염|온도계|장비|기자재|도로|거리|지붕|옥상|건설현장)/iu;
const LEGAL_JUDGMENT_CONTEXT = /(지방법원|지법|고등법원|고법|대법원|헌법재판소|재판부|법정|판결|선고|실형|징역|유죄|무죄|구속영장|판사)/u;
const POLITICAL_MEETING_CONTEXT = /(만찬|오찬|식사|회동|간담회|회의)/u;
const DOMESTIC_POLITICAL_ACTOR = /(대통령|청와대|대통령실|당\s*지도부|더불어민주당|국민의힘|조국혁신당|당대표|원내대표)/u;
const FOREIGN_POLITICAL_CONTEXT = /(이란|미국|중국|일본|러시아|우크라이나|프랑스|영국|독일|이스라엘|팔레스타인|대만|태국|인도|브라질|캐나다|호주)/u;

function extractPrimaryPersonIdentity(candidate = {}) {
  const patterns = [
    { expression: new RegExp(`(${PERSON_ROLE_PATTERN})\\s+([\uac00-\ud7a3]{2,4})`, 'u'), roleFirst: true },
    { expression: new RegExp(`([\uac00-\ud7a3]{2,4})\\s*(${PERSON_ROLE_PATTERN})`, 'u'), roleFirst: false },
  ];
  const sources = [candidate.title, String(candidate.summary || '').slice(0, 900)]
    .map(value => normalizeNfc(value || ''))
    .filter(Boolean);
  for (const source of sources) {
    for (const pattern of patterns) {
      const match = source.match(pattern.expression);
      if (!match) continue;
      const name = normalizeNfc(pattern.roleFirst ? match[2] : match[1]).trim();
      const role = normalizeNfc(pattern.roleFirst ? match[1] : match[2]).replace(/\s+/gu, ' ').trim();
      if (!name || NON_PERSON_NAMES.has(name)) continue;
      const coverText = normalizeNfc(`${candidate.editorialTitle || ''} ${candidate.title || ''}`);
      return { name, role, critical: coverText.includes(name) };
    }
  }
  return null;
}

function articleSourceText(candidate = {}) {
  const title = normalizeNfc(candidate.title || '');
  const lead = normalizeNfc(String(candidate.summary || candidate.fullText || '').slice(0, 900));
  return `${title} ${lead}`.trim();
}

function isOccupationalHeatStory(text = '') {
  const normalized = normalizeNfc(text);
  const heat = /(폭염|고온|온열|열사병|체감온도|온도계|\d{2}(?:\.\d+)?\s*도)/u.test(normalized);
  const work = /(작업|작업자|노동|근로|현장|옥상|건설|배달|물류|농사|그늘|휴식)/u.test(normalized);
  return heat && work;
}

function eventVisualQueries(sourceText = '') {
  const queries = [];
  const domesticPoliticalContext = DOMESTIC_POLITICAL_ACTOR.test(sourceText)
    && !FOREIGN_POLITICAL_CONTEXT.test(sourceText);
  if (/이란/u.test(sourceText) && /(대통령|의회|협상|전쟁|강경파)/u.test(sourceText)) {
    return ['Iran government Tehran parliament diplomacy', 'Tehran government building Iran'];
  }
  if (POLITICAL_MEETING_CONTEXT.test(sourceText) && domesticPoliticalContext) {
    return [
      'South Korea presidential office meeting room conference table',
      'South Korea presidential office Blue House exterior',
      'South Korea government briefing room podium',
    ];
  }
  if (/(당대표|대표\s*경선|순회경선|전당대회|누적\s*과반|득표율)/u.test(sourceText)) {
    return [
      'South Korea political party convention podium',
      'South Korea party leadership election stage',
      'South Korea election ballot paper',
    ];
  }
  if (/5[·.]18|광주\s*민주화운동/u.test(sourceText)) {
    return ['May 18 National Cemetery Gwangju', 'Gwangju Uprising memorial', 'Gwangju May 18 democracy memorial South Korea'];
  }
  if (/(배달기사|배달원).{0,40}(집|주택|아파트|현관|문|침입|무단출입)|(집|현관|문).{0,40}(배달기사|배달원)/u.test(sourceText)) {
    return ['food delivery package front door', 'apartment front door', 'apartment front door delivery package hallway'];
  }
  if (/(폭우|집중호우|호우|침수|물폭탄|홍수)/u.test(sourceText)) {
    return ['heavy rain flooded street storm', 'flooded road rainstorm weather'];
  }
  if (/(타임스스퀘어|전광판|옥외\s*광고|뉴욕.{0,30}광고|광고.{0,30}뉴욕)/u.test(sourceText)) {
    return ['Times Square billboard', 'Times Square digital billboard advertising screen', 'digital billboard'];
  }
  if (isOccupationalHeatStory(sourceText)) {
    queries.push('construction workers rooftop extreme heat', 'outdoor workers heatwave safety');
    return queries;
  }
  if (domesticPoliticalContext && /(?:^|[^전])대통령(?!직속)|청와대|대통령실/u.test(sourceText)) {
    queries.push('South Korea presidential office building Seoul');
  }
  if (/(아파트|주택|부동산).{0,30}(신고가|거래|매매|실거주|세입자)/u.test(sourceText)) {
    queries.push('South Korea apartment buildings city skyline', 'apartment sale contract house keys');
  }
  if (/(민생지원금|지원금|현금\s*지원|보조금|지역화폐|소비쿠폰)/u.test(sourceText)
    && !/(결혼|혼인|신혼|축의금|예식)/u.test(sourceText)) {
    queries.push('cash assistance voucher wallet document', 'local currency voucher payment');
  }
  if (/(퇴직|퇴사|실업|구직|고용).{0,30}(지원|수당|정책|급여)/u.test(sourceText)) {
    queries.push('employment benefit application document desk');
  }
  if (/(법원|조세심판원|심판청구|재판)/u.test(sourceText) || LEGAL_JUDGMENT_CONTEXT.test(sourceText)) {
    queries.push('legal court document gavel');
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
  if (/(폭우|집중호우|호우|침수|물폭탄|홍수)/u.test(sourceText)) return 'weather-emergency';
  if (/(배달기사|배달원).{0,40}(집|주택|아파트|현관|문|침입|무단출입)|(집|현관|문).{0,40}(배달기사|배달원)/u.test(sourceText)) return 'home-security';
  if (/(타임스스퀘어|전광판|옥외\s*광고|뉴욕.{0,30}광고|광고.{0,30}뉴욕)/u.test(sourceText)) return 'civic-advertising';
  if (POLITICAL_MEETING_CONTEXT.test(sourceText) && DOMESTIC_POLITICAL_ACTOR.test(sourceText)) return 'political-meeting';
  if (/(당대표|대표\s*경선|순회경선|전당대회|누적\s*과반|득표율)/u.test(sourceText)) return 'political-election';
  if (/5[·.]18|광주\s*민주화운동/u.test(sourceText)) return 'democratic-history';
  if (isOccupationalHeatStory(sourceText)) return 'occupational-heat';
  if (LEGAL_JUDGMENT_CONTEXT.test(sourceText)) return 'legislation';
  if (/(보완수사권|형사소송법|법안|개정안|본회의|국회|청와대|대통령실|정치|선거)/u.test(sourceText)) return 'legislation';
  if (/(주식|증시|코스피|코스닥|나스닥|주가|투자|금리|환율|GDP|성장률|물가|대출)/iu.test(sourceText)) return 'markets';
  if (/(반도체|칩|웨이퍼|AI|인공지능|데이터센터|배터리|전기차)/iu.test(sourceText)) return 'technology';
  if (/(부동산|주택|아파트|전세|월세)/u.test(sourceText)) return 'housing';
  if (/(의료|병원|건강|환자|보험|복지)/u.test(sourceText)) return 'health';
  if (/(기후|폭염|한파|홍수|가뭄|산불|탄소)/u.test(sourceText)) return 'climate';
  if (/(고용|취업|일자리|노동|근로)/u.test(sourceText)) return 'work';
  return candidate.category === 'economy' ? 'markets' : 'public-interest';
}

function generatedFallbackTopic(candidate = {}) {
  const text = articleSourceText(candidate);
  if (/(지지율|국정\s*(?:운영|수행)|여론조사).{0,80}(하락|최저|비판|경고|전망)|(대통령|정권).{0,80}(지지율|여론조사)/u.test(text)) return 'public-opinion';
  if (/(작업자|노동자|근로자|현장).{0,60}(폭염|온열|열사병|그늘|작업중지)|(폭염|온열|열사병).{0,60}(작업자|노동자|근로자|현장|그늘)/iu.test(text)) return 'work';
  if (/(배달기사|배달원|주거침입|현관문|홈캠)/u.test(text)) return 'work';
  if (/(야생동물|구렁이|뱀|동물\s*보호)/u.test(text)) return 'public-interest';
  if (/(교도소|교정|수용자|교도관)/u.test(text)) return 'legislation';
  if (/(의료|병원|건강|질병|환자|시술|약국|보험료)/iu.test(text)) return 'health';
  if (/(곗돈|계\s*모임|사기|횡령|보이스피싱|채무|빚)/iu.test(text)) return 'finance';
  if (/(지하철|철도|KTX|SRT|역사|무정차|전장연|교통약자|장애인\s*이동)/iu.test(text)) return 'transit';
  if (/(폭우|집중호우|호우|침수|물폭탄|홍수|태풍|폭염|한파|산불|지진|재난|기후)/u.test(text)) return 'weather';
  if (/(외교|전쟁|미사일|군사|안보|국방부|북한|이란|러시아|우크라이나|이스라엘|정상회담)/u.test(text)) return 'geopolitics';
  if (/(법원|재판|판결|선고|징역|법안|국회|형사소송법|보완수사권|선관위|정치자금법|조세심판)/u.test(text)) return 'legislation';
  if (/(반도체|칩|웨이퍼|D램|HBM|AI|인공지능|데이터센터|배터리|전기차)/iu.test(text)) return 'technology';
  if (/(부동산|주택|아파트|전세|월세|청약|보증금|재건축|PF|공매)/iu.test(text)) return 'housing';
  if (/(고용|취업|퇴사|이직|실업급여|구직급여|노동|근로|직장|정년|공무원)/u.test(text)) return 'work';
  if (/(의료|병원|건강|질병|환자|시술|약국)/iu.test(text)) return 'health';
  if (/(세금|과세|연금|금리|대출|보험료|지원금|소비쿠폰|주식|증시|환율|물가|은행|ISA|ETF|ETN)/iu.test(text)) return 'finance';
  if (/((대통령|총리|장관|의원|정당)|국정|정책|선거|정치)/iu.test(text)) return 'legislation';
  return null;
}

function createGeneratedFallback(candidate = {}, {
  attempts = [],
  recentImages = [],
  reuseWindowDays = 7,
  reason = 'licensed image unavailable or actual-image review failed',
} = {}) {
  const requestedAssetId = String(candidate.generatedAssetId || '').trim();
  const requestedAsset = requestedAssetId
    ? (GENERATED_FALLBACK_MANIFEST.assets || []).find(asset => asset.id === requestedAssetId)
    : null;
  const topic = requestedAsset?.topics?.[0] || generatedFallbackTopic(candidate);
  if (!topic) return null;
  const recentKeys = recentImageKeySet(recentImages);
  const assets = (GENERATED_FALLBACK_MANIFEST.assets || []).filter(asset => (
    requestedAssetId ? asset.id === requestedAssetId : asset.topics?.includes(topic)
  ));
  let blockedCandidateCount = 0;
  for (const asset of assets) {
    const localPath = path.join(GENERATED_FALLBACK_ROOT, asset.file);
    if (!fs.existsSync(localPath)) continue;
    const buffer = fs.readFileSync(localPath);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    if (sha256 !== asset.sha256) continue;
    const selection = {
      kind: 'generated',
      id: `diem-generated:${asset.id}`,
      source: 'diem-generated',
      selectedAt: new Date().toISOString(),
      assetPath: path.relative(process.cwd(), localPath),
      localPath,
      sha256,
      localSha256: sha256,
      generatedTopic: topic,
      description: asset.description,
      license: { name: 'Project-owned AI-generated editorial asset', url: null },
      visualRole: 'context',
      identity: { required: false, name: null, role: null, depicted: false, verified: null },
      suitability: {
        ok: true,
        reason: 'project_generated_topic_match',
        personScreening: { detected: false, personFreeEvidence: true, requiredPersonFreeEvidence: true, safe: true },
      },
    };
    const keys = imageReuseKeys(selection);
    if (keys.some(key => recentKeys.has(key))) {
      blockedCandidateCount += 1;
      continue;
    }
    return {
      ...selection,
      attempts,
      reuseGuard: {
        allowed: true,
        windowDays: reuseWindowDays,
        recentImageCount: recentImages.length,
        recentKeyCount: recentKeys.size,
        blockedCandidateCount,
        selectedImageKeys: keys,
      },
      selectionReason: `${reason}; project-generated ${topic} asset ${asset.id} selected`,
    };
  }
  return null;
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

function identityAssessment(image = {}, candidate = {}, { selectionRole = 'context' } = {}) {
  const identity = extractPrimaryPersonIdentity(candidate);
  if (!identity?.critical || selectionRole !== 'portrait') {
    return {
      required: false,
      name: identity?.name || null,
      role: identity?.role || null,
      depicted: false,
      verified: null,
      trustedProvider: null,
      metadataMatched: null,
    };
  }
  const trustedProvider = image.identityAuthority === 'wikipedia-page'
    || image.identityAuthority === 'official'
    || image.source === 'official-press';
  const metadataMatched = imageMetadata(image).includes(identity.name)
    || normalizeNfc(image.identityVerifiedName || '').trim() === identity.name;
  return {
    required: true,
    name: identity.name,
    role: identity.role,
    depicted: true,
    verified: trustedProvider && metadataMatched,
    trustedProvider,
    metadataMatched,
  };
}

function personPresenceAssessment(image = {}, { requirePersonFreeEvidence = false } = {}) {
  const metadata = imageMetadata(image);
  const detected = PERSON_METADATA_PATTERN.test(metadata);
  const personFreeEvidence = PERSON_FREE_CONTEXT_PATTERN.test(metadata);
  return {
    detected,
    personFreeEvidence,
    requiredPersonFreeEvidence: requirePersonFreeEvidence,
    safe: !detected && (!requirePersonFreeEvidence || personFreeEvidence),
  };
}

const ARTICLE_VISUAL_ROLES = Object.freeze([
  {
    id: 'minor_student',
    article: text => /(미성년|여학생|남학생|고등학생|중학생|초등학생|청소년)/u.test(text)
      || [...text.matchAll(/(\d{1,2})세/gu)].some(match => Number(match[1]) <= 19),
    metadata: /(teen|teenage|student|schoolgirl|schoolboy|youth|child|adolescent)/iu,
  },
  {
    id: 'patient',
    article: text => /(환자|복통|응급\s*이송|긴급\s*이송|병원으로\s*(?:이송|옮겨)|치료를?\s*받)/u.test(text),
    metadata: /(patient|receiving\s*(?:care|treatment)|emergency\s*(?:room|patient)|ambulance|hospital\s*bed|sick|injured)/iu,
  },
]);

function visualRoleAssessment(image = {}, candidate = {}) {
  const articleText = normalizeNfc(`${candidate.title || ''} ${String(candidate.summary || '').slice(0, 900)}`);
  const metadata = imageMetadata(image);
  const requiredVisualRoles = ARTICLE_VISUAL_ROLES
    .filter(role => role.article(articleText))
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
  const koreanPoliticalEvent = /(더불어민주당|국민의힘|조국혁신당|당대표|전당대회|순회\s*경선|대표\s*경선|대선\s*후보)/u.test(articleText);
  const politicalVisual = /(election|ballot|vote|political|party|flag|투표|선거|정당|국기)/iu;
  const placeVisual = /(assembly|parliament|government|building|chamber|election|ballot|vote|political|party)/iu;
  const koreanPlace = /(korean|south\s*korea|seoul|yeouido|대한민국|한국|서울|여의도)/iu;
  const queryRequestsKoreanPlace = koreanPlace.test(query) && placeVisual.test(query);
  const imageClaimsInstitution = /(parliament|assembly|government\s*building|chamber|국회|의사당|청와대)/iu.test(metadata);
  const imageClaimsPoliticalContext = politicalVisual.test(metadata);
  const foreignPoliticalSymbolMismatch = (koreanInstitution || koreanPoliticalEvent || queryRequestsKoreanPlace)
    && /(usa|u\.?s\.?a?\.?|united\s*states|american|stars\s*and\s*stripes|union\s*jack|british|england).{0,20}(?:flag|ballot|vote|election)|(?:flag|ballot|vote|election).{0,20}(?:usa|u\.?s\.?a?\.?|united\s*states|american|stars\s*and\s*stripes|union\s*jack|british|england)/iu.test(metadata);
  const requiredGeography = (koreanInstitution || koreanPoliticalEvent || queryRequestsKoreanPlace)
    && (queryRequestsKoreanPlace || imageClaimsInstitution || imageClaimsPoliticalContext)
    ? 'south_korea'
    : null;
  const matchedGeography = requiredGeography === 'south_korea'
    && koreanPlace.test(metadata)
    && !foreignPoliticalSymbolMismatch;
  return {
    requiredGeography,
    matchedGeography: requiredGeography ? matchedGeography : true,
    missingGeography: requiredGeography && !matchedGeography ? requiredGeography : null,
    foreignPoliticalSymbolMismatch,
  };
}

function assessImageSuitability(image = {}, query = '', candidate = {}, {
  selectionRole = 'context',
  requirePersonFreeEvidence = false,
} = {}) {
  const queryTokens = extractSignatureTokens(normalizeNfc(query))
    .map(token => token.toLowerCase());
  const concreteQueryTokens = [...new Set(
    queryTokens.filter(token => !GENERIC_VISUAL_TOKENS.has(token))
  )];
  const metadataTokens = new Set(
    extractSignatureTokens(imageMetadata(image)).map(token => token.toLowerCase())
  );
  const matchedConcreteTokens = concreteQueryTokens.filter(token => metadataTokens.has(token));
  const primaryVisualAnchors = concreteQueryTokens.filter(token => !LOW_INFORMATION_VISUAL_TOKENS.has(token));
  const matchedPrimaryVisualAnchors = primaryVisualAnchors.filter(token => metadataTokens.has(token));
  const roles = visualRoleAssessment(image, candidate);
  const geography = geographicAssessment(image, candidate, query);
  const identity = identityAssessment(image, candidate, { selectionRole });
  const personScreening = personPresenceAssessment(image, { requirePersonFreeEvidence });
  const subjectMatched = concreteQueryTokens.length > 0 && matchedConcreteTokens.length > 0;
  const primaryVisualAnchorMatched = primaryVisualAnchors.length > 0 && matchedPrimaryVisualAnchors.length > 0;
  const roleMatched = roles.missingVisualRoles.length === 0;
  const geographyMatched = geography.missingGeography === null;
  const identityMatched = !identity.required || identity.verified;
  const personSafe = selectionRole === 'portrait' || personScreening.safe;
  const ok = subjectMatched && primaryVisualAnchorMatched && roleMatched && geographyMatched && identityMatched && personSafe;

  return {
    ok,
    reason: selectionRole !== 'portrait' && personScreening.detected
      ? 'unverified_stock_person'
      : selectionRole !== 'portrait' && requirePersonFreeEvidence && !personScreening.personFreeEvidence
        ? 'person_free_context_unverified'
      : geography.foreignPoliticalSymbolMismatch
        ? 'foreign_political_symbol_mismatch'
      : !identityMatched
      ? 'named_person_identity_unverified'
      : concreteQueryTokens.length === 0
      ? 'concrete_query_missing'
      : !geographyMatched
        ? 'geographic_context_mismatch'
      : !subjectMatched
        ? 'concrete_subject_missing'
      : !primaryVisualAnchorMatched
        ? 'primary_visual_anchor_missing'
        : !roleMatched
          ? 'article_subject_role_mismatch'
          : ok
        ? 'concrete_subject_matched'
        : 'concrete_subject_missing',
    concreteQueryTokens,
    matchedConcreteTokens,
    primaryVisualAnchors,
    matchedPrimaryVisualAnchors,
    primaryVisualAnchorMatched,
    matchRatio: Number((matchedConcreteTokens.length / Math.max(1, concreteQueryTokens.length)).toFixed(4)),
    ...roles,
    ...geography,
    identity,
    personScreening,
    selectionRole,
  };
}

function buildImageQueries(candidate = {}) {
  const sourceText = articleSourceText(candidate);
  const frame = candidate.newsFrame || {};
  const directArticleIsAboutParliament = /국회(?:의사당|본회의|상임위|청문회)|국회.{0,12}(?:발표|법안|표결|회의)|의회\s*(?:내부|본회의)|국회의사당/u.test(sourceText);
  const eventQueries = eventVisualQueries(sourceText);
  const exclusiveEventQuery = /(당대표|대표\s*경선|순회경선|전당대회|누적\s*과반|득표율|5[·.]18|광주\s*민주화운동|배달기사|배달원|폭우|집중호우|호우|침수|물폭탄|홍수|타임스스퀘어|전광판|옥외\s*광고)/u.test(sourceText);
  if (exclusiveEventQuery && eventQueries.length > 0) return eventQueries.slice(0, 5);
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

function imageFinalReviewScore(image = {}) {
  const suitability = image.suitability || {};
  const anchorCoverage = (suitability.matchedPrimaryVisualAnchors || []).length
    / Math.max(1, (suitability.primaryVisualAnchors || []).length);
  const score = (Number(image.score) || 0) * 0.55
    + (Number(suitability.matchRatio) || 0) * 0.25
    + anchorCoverage * 0.2;
  return Number(Math.max(0, Math.min(1, score)).toFixed(4));
}

function reviewImagePool(images = [], limit = 5) {
  const unique = new Map();
  for (const image of images) {
    const key = imageReuseKeys(image)[0] || `${image.source || 'unknown'}:${image.id || image.downloadUrl || unique.size}`;
    const reviewed = { ...image, finalReviewScore: imageFinalReviewScore(image) };
    const existing = unique.get(key);
    if (!existing || reviewed.finalReviewScore > existing.finalReviewScore) unique.set(key, reviewed);
  }
  return [...unique.values()]
    .sort((left, right) => right.finalReviewScore - left.finalReviewScore || right.score - left.score)
    .slice(0, limit);
}

function createTypographyFallback(candidate = {}, {
  attempts = [],
  recentImages = [],
  reuseWindowDays = 7,
  reason = 'no concrete-subject-matched licensed unused image met the confidence threshold',
} = {}) {
  const personIdentity = extractPrimaryPersonIdentity(candidate);
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
    identity: {
      required: false,
      name: personIdentity?.name || null,
      role: personIdentity?.role || null,
      depicted: false,
      verified: null,
    },
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

async function searchOpenverse(query, { fetchImpl = fetch } = {}) {
  const params = new URLSearchParams({
    q: query,
    page_size: '20',
    license_type: 'commercial,modification',
  });
  const data = await fetchJson(`https://api.openverse.org/v1/images/?${params}`, { fetchImpl });
  return (data.results || []).flatMap(image => {
    const licenseKey = String(image.license || '').toLowerCase().trim();
    if (!OPENVERSE_LICENSES.has(licenseKey) || !image.url) return [];
    const tags = (image.tags || []).map(tag => tag?.name || tag).filter(Boolean);
    return [{
      id: `openverse:${image.id}`,
      source: 'openverse',
      originalUrl: image.foreign_landing_url || image.detail_url || image.url,
      downloadUrl: image.url,
      creator: image.creator || '',
      creatorUrl: image.creator_url || '',
      width: image.width,
      height: image.height,
      description: [image.title, ...tags].filter(Boolean).join(' '),
      tags,
      license: {
        name: licenseKey === 'pdm' ? 'Public Domain Mark' : licenseKey.toUpperCase(),
        url: image.license_url || 'https://creativecommons.org/share-your-work/cclicenses/',
      },
    }];
  });
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
    const description = [
      page.title,
      metadata.ObjectName?.value,
      metadata.ImageDescription?.value,
      metadata.Categories?.value,
    ]
      .map(value => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
    return [{
      id: `wikimedia:${page.pageid}`,
      source: 'wikimedia',
      originalUrl: info.descriptionurl,
      downloadUrl: info.thumburl || info.url,
      creator: String(metadata.Artist?.value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      width: info.width,
      height: info.height,
      description,
      license: {
        name: licenseName,
        url: metadata.LicenseUrl?.value || 'https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia',
      },
    }];
  });
}

async function searchVerifiedWikimediaPerson(name, { fetchImpl = fetch } = {}) {
  const identityName = normalizeNfc(name).trim();
  if (!identityName) return [];
  const pageParams = new URLSearchParams({
    action: 'query',
    titles: identityName,
    redirects: '1',
    prop: 'pageimages',
    piprop: 'name',
    pilicense: 'free',
    format: 'json',
    origin: '*',
  });
  const pageData = await fetchJson(`https://ko.wikipedia.org/w/api.php?${pageParams}`, { fetchImpl });
  const page = Object.values(pageData.query?.pages || {}).find(item => item && !item.missing);
  if (!page?.pageimage) return [];
  const normalizedTitle = normalizeNfc(page.title || '').trim();
  const redirectedFromIdentity = (pageData.query?.redirects || []).some(redirect => (
    normalizeNfc(redirect.from || '').trim() === identityName
    && normalizeNfc(redirect.to || '').trim() === normalizedTitle
  ));
  if (normalizedTitle !== identityName && !redirectedFromIdentity) return [];

  const fileTitle = String(page.pageimage).startsWith('File:')
    ? String(page.pageimage)
    : `File:${page.pageimage}`;
  const fileParams = new URLSearchParams({
    action: 'query',
    titles: fileTitle,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size',
    iiurlwidth: '1600',
    format: 'json',
    origin: '*',
  });
  const fileData = await fetchJson(`https://commons.wikimedia.org/w/api.php?${fileParams}`, { fetchImpl });
  return Object.values(fileData.query?.pages || {}).flatMap(filePage => {
    const info = filePage.imageinfo?.[0];
    const metadata = info?.extmetadata || {};
    const licenseName = metadata.LicenseShortName?.value || metadata.UsageTerms?.value || '';
    if (!info?.url || !WIKIMEDIA_LICENSE.test(licenseName)) return [];
    const metadataDescription = [
      metadata.ObjectName?.value,
      metadata.ImageDescription?.value,
      metadata.Categories?.value,
    ]
      .map(value => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');
    return [{
      id: `wikimedia:${filePage.pageid}`,
      source: 'wikimedia',
      originalUrl: info.descriptionurl,
      downloadUrl: info.thumburl || info.url,
      creator: String(metadata.Artist?.value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
      width: info.thumbwidth || info.width,
      height: info.thumbheight || info.height,
      description: `${identityName} 한국어 위키백과 문서 ${normalizedTitle} ${filePage.title || ''} ${metadataDescription}`.trim(),
      identityAuthority: 'wikipedia-page',
      identityVerifiedName: identityName,
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
  reviewPoolTarget = 8,
  reviewImages,
  generatedFallbackEnabled = false,
} = {}) {
  const queries = buildImageQueries(candidate);
  const attempts = [];
  if (candidate.generatedAssetId) {
    const generated = createGeneratedFallback(candidate, {
      attempts: [{ provider: 'operator-generated-asset', assetId: candidate.generatedAssetId, count: 1 }],
      recentImages,
      reuseWindowDays,
      reason: 'operator-selected story-specific generated image',
    });
    if (!generated) throw new Error(`[DIEM Image] requested generated asset is unavailable or recently used: ${candidate.generatedAssetId}`);
    return generated;
  }
  const recentKeys = recentImageKeySet(recentImages);
  const identity = extractPrimaryPersonIdentity(candidate);
  const contextProviders = [
    { name: 'pexels', search: query => searchPexels(query, { apiKey: pexelsApiKey, fetchImpl }) },
    { name: 'unsplash', search: query => searchUnsplash(query, { accessKey: unsplashAccessKey, fetchImpl }) },
    { name: 'openverse', search: query => searchOpenverse(query, { fetchImpl }) },
    { name: 'wikimedia', search: query => searchWikimedia(query, { fetchImpl }) },
  ];
  const phases = [
    {
      visualRole: 'context',
      queries,
      providers: contextProviders,
      requirePersonFreeEvidence: true,
    },
    ...(identity?.critical ? [{
      visualRole: 'portrait',
      queries: [identity.name],
      providers: [{
        name: 'wikimedia-person-page',
        search: query => searchVerifiedWikimediaPerson(query, { fetchImpl }),
      }],
      requirePersonFreeEvidence: false,
    }] : []),
  ];

  for (const phase of phases) {
    let phaseBlockedCandidateCount = 0;
    for (const query of phase.queries) {
      const queryPool = [];
      for (const provider of phase.providers) {
        try {
          const images = (await provider.search(query)).slice(0, 20);
          const scored = images
          .map(image => ({
            ...image,
            query,
            ...scoreImageCandidate(image, query, candidate.title),
            suitability: assessImageSuitability(image, query, candidate, {
              selectionRole: phase.visualRole,
              requirePersonFreeEvidence: phase.requirePersonFreeEvidence,
            }),
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
          phaseBlockedCandidateCount += blocked.length;
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
            identity: image.suitability.identity,
            personScreening: image.suitability.personScreening,
          }));
          const suitabilityRejected = suitabilityRejections.length;
          attempts.push({
          provider: provider.name,
          visualRole: phase.visualRole,
          query,
          count: scored.length,
          suitableCount: suitable.length,
          suitabilityRejected,
          suitabilityRejections,
          eligibleCount: eligible.length,
          recentReuseBlocked: blocked.length,
          bestScore: scored[0]?.score ?? null,
          });
          queryPool.push(...unused);
        } catch (error) {
          attempts.push({ provider: provider.name, visualRole: phase.visualRole, query, count: 0, error: error.message });
        }
        if (reviewImagePool(queryPool, reviewPoolTarget).length >= reviewPoolTarget) break;
      }
      const shortlist = reviewImagePool(queryPool, 5);
      if (shortlist.length < 1) continue;
      let selected = shortlist[0];
      let visionReview = null;
      if (reviewImages) {
        try {
          visionReview = await reviewImages({ candidate, query, images: shortlist.slice(0, 2) });
          selected = shortlist.find(image => image.id === visionReview?.selectedId);
          if (!visionReview?.ok || !selected) {
            attempts.push({ provider: 'vision-review', visualRole: phase.visualRole, query, count: shortlist.length, error: visionReview?.reason || 'no safe image selected' });
            break;
          }
        } catch (error) {
          attempts.push({ provider: 'vision-review', visualRole: phase.visualRole, query, count: shortlist.length, error: error.message });
          break;
        }
      }
      const suitabilityRejected = attempts.reduce((total, attempt) => total + (attempt.suitabilityRejected || 0), 0);
      return {
        kind: 'web',
        selectedAt: new Date().toISOString(),
        ...selected,
        visualRole: phase.visualRole,
        identity: selected.suitability.identity,
        selectedPoolIndex: 1,
        selectionPoolSize: shortlist.length,
        finalReview: {
          ok: true,
          method: reviewImages ? 'vision_context_shortlist' : 'deterministic_context_shortlist',
          candidateCount: reviewImagePool(queryPool, Number.MAX_SAFE_INTEGER).length,
          selectedId: selected.id,
          selectedScore: selected.finalReviewScore,
          shortlist: shortlist.map(image => ({
            id: image.id,
            source: image.source,
            query: image.query,
            score: image.score,
            finalReviewScore: image.finalReviewScore,
            suitabilityReason: image.suitability.reason,
          })),
          visionReview,
        },
        attempts,
        reuseGuard: {
          allowed: true,
          windowDays: reuseWindowDays,
          recentImageCount: recentImages.length,
          recentKeyCount: recentKeys.size,
          blockedCandidateCount: phaseBlockedCandidateCount,
          selectedImageKeys: imageReuseKeys(selected),
        },
        selectionReason: `selected best of ${shortlist.length} context-reviewed unused candidates; source ${selected.source}, query rank #${selected.rankWithinQuery}, score ${selected.finalReviewScore}; ${suitabilityRejected} unsuitable and ${phaseBlockedCandidateCount} recent images blocked`,
      };
    }
    if (phase.visualRole === 'context' && generatedFallbackEnabled) {
      const generated = createGeneratedFallback(candidate, {
        attempts,
        recentImages,
        reuseWindowDays,
      });
      if (generated) return generated;
    }
  }

  return (generatedFallbackEnabled && createGeneratedFallback(candidate, {
    attempts,
    recentImages,
    reuseWindowDays,
  })) || createTypographyFallback(candidate, {
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
  createGeneratedFallback,
  downloadSelectedImage,
  extractPrimaryPersonIdentity,
  imageReuseKeys,
  generatedFallbackTopic,
  scoreImageCandidate,
  isSpecificImageKeyword,
  searchPexels,
  searchOpenverse,
  searchUnsplash,
  searchVerifiedWikimediaPerson,
  searchWikimedia,
  selectLicensedImage,
};
