const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  isLikelySyndicatedCopy,
  verifyCoreClaims,
  verifyExtraordinaryClaims,
} = require('../src/v2/fact-verifier');
const {
  assessImageSuitability,
  buildImageQueries,
  createTypographyFallback,
  extractPrimaryPersonIdentity,
  imageReuseKeys,
  scoreImageCandidate,
  searchOpenverse,
  selectLicensedImage,
} = require('../src/v2/image-selector');
const {
  decodeResponseBody,
  detectCharset,
  mergePopularCandidates,
  normalizeRank,
  parseDaumRanking,
  parseNaverRanking,
} = require('../src/v2/popular-news');
const { computeEmbeddingMatrix, evaluateAgainstHistory, executeJsonProcess } = require('../src/v2/similarity');

test('normalizes portal ranks to 100 through 1', () => {
  assert.equal(normalizeRank(1, 50), 100);
  assert.equal(normalizeRank(50, 50), 1);
  assert.equal(normalizeRank(1, 1), 100);
});

test('parses isolated Naver and Daum ranking fixtures', () => {
  const naver = parseNaverRanking(`
    <div class="rankingnews_list">
      <a class="list_title" href="https://n.news.naver.com/mnews/article/001/0001">한국은행 기준금리 동결</a>
      <a class="list_title" href="https://n.news.naver.com/mnews/article/002/0002">청년 주거 정책 확대</a>
    </div>`, '2026-07-25');
  const daum = parseDaumRanking(`
    <ol class="list_news2">
      <li><a class="link_txt" href="https://v.daum.net/v/202607251001">한국은행, 기준금리 동결 결정</a></li>
      <li><a class="link_txt" href="https://v.daum.net/v/202607251002">교육 지원 정책 발표</a></li>
    </ol>`, '2026-07-25');
  assert.equal(naver.length, 2);
  assert.equal(daum.length, 2);
  assert.equal(naver[0].normalizedScore, 100);
  assert.equal(daum[1].normalizedScore, 1);
});

test('merges the same event across portals and adds a cross-portal bonus', () => {
  const merged = mergePopularCandidates({
    naver: [{ portal: 'naver', rank: 1, normalizedScore: 100, title: '한국은행 기준금리 동결', url: 'https://n.news.naver.com/a' }],
    daum: [{ portal: 'daum', rank: 2, normalizedScore: 80, title: '한국은행, 기준금리 동결 결정', url: 'https://v.daum.net/v/1' }],
  });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].crossPortal, true);
  assert.equal(merged[0].popularityScore, 100);
  assert.equal(merged[0].sources.length, 2);
});

test('requires independent corroboration and matching material facts', () => {
  const primary = {
    title: '한국은행 기준금리 2.50% 동결',
    url: 'https://publisher-a.example/article',
    fullText: '한국은행은 7월 25일 기준금리를 2.50%로 동결했다.',
  };
  const secondary = {
    title: '기준금리 2.50% 유지',
    url: 'https://publisher-b.example/story',
    fullText: '한국은행이 7월 25일 회의에서 기준금리를 2.50%로 유지했다.',
  };
  assert.equal(verifyCoreClaims(primary, secondary).ok, true);
  assert.equal(verifyCoreClaims(primary, { ...secondary, fullText: secondary.fullText.replace('2.50%', '3.00%') }).ok, false);
  assert.equal(verifyCoreClaims(primary, { ...secondary, url: 'https://publisher-a.example/other' }).ok, false);
});

test('accepts an extraordinary claim only when another Naver publisher confirms the same value and event', () => {
  const primary = {
    title: '삼성 반도체 영업이익 223배 증가',
    url: 'https://n.news.naver.com/mnews/article/001/1001',
    fullText: '삼성전자의 반도체 영업이익이 1년 전보다 223배 늘었습니다.',
  };
  const secondary = {
    title: '메모리 회복으로 삼성 반도체 이익 223배',
    url: 'https://n.news.naver.com/mnews/article/015/2002',
    fullText: 'AI 메모리 수요 회복으로 삼성전자 반도체 부문의 이익이 전년보다 223배 커졌습니다.',
  };

  assert.equal(verifyExtraordinaryClaims(primary, secondary).ok, true);
  assert.equal(verifyExtraordinaryClaims(primary, { ...secondary, url: 'https://n.news.naver.com/mnews/article/001/2002' }).ok, false);
});

test('rejects highly similar syndicated body copy', () => {
  const body = '정부는 청년 주거 지원 정책을 다음 달부터 확대한다고 발표했다. 지원 대상은 전국 청년 가구다.';
  assert.equal(isLikelySyndicatedCopy({ fullText: body }, { fullText: body }), true);
});

test('uses injected embeddings and deterministic fallback for seven-day checks', async () => {
  const signature = { target: '한국은행 기준금리', event: '금리 동결', text: '경제 | 한국은행 기준금리 | 금리 동결' };
  const history = [{
    publicationKey: 'diem:2026-07-24:economy',
    signature: { target: '한국은행 기준금리', event: '금리 동결', text: '경제 | 기준금리 | 동결' },
  }];
  const embedded = await evaluateAgainstHistory(signature, history, { embedder: async () => [0.8] });
  assert.equal(embedded.duplicate, true);
  assert.equal(embedded.method, 'embedding');
  const fallback = await evaluateAgainstHistory(signature, history, { embedder: async () => { throw new Error('model unavailable'); } });
  assert.equal(fallback.method, 'deterministic_fallback');
  assert.match(fallback.error, /model unavailable/);
});

test('never applies a material-follow-up override to the same event on the same KST date', async () => {
  const signature = { target: '코스피', event: '사이드카 발동', text: 'economy | 코스피 | 사이드카 발동' };
  const result = await evaluateAgainstHistory(signature, [{
    date: '2026-07-29',
    publicationKey: 'diem:2026-07-29:economy:run-0900',
    signature,
  }], {
    embedder: async () => [0.95],
    candidate: { materialFollowUp: true },
    referenceDate: '2026-07-29',
  });

  assert.equal(result.duplicate, true);
  assert.equal(result.repeatOverride, false);
});

test('parses one batched local embedding matrix', async () => {
  const matrix = await computeEmbeddingMatrix(['가', '나'], ['다'], {
    execFileImpl: async (_command, _args, options) => {
      const input = JSON.parse(options.input);
      assert.deepEqual(input.queries, ['가', '나']);
      return { stdout: JSON.stringify({ matrix: [[0.8], [0.2]] }) };
    },
  });
  assert.deepEqual(matrix, [[0.8], [0.2]]);
});

test('writes the embedding payload to the helper stdin instead of relying on an unsupported execFile option', async () => {
  const { stdout } = await executeJsonProcess(process.execPath, [
    '-e',
    'let value = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", chunk => value += chunk); process.stdin.on("end", () => process.stdout.write(value));',
  ], {
    input: JSON.stringify({ queries: ['보완수사권'], corpus: ['형사소송법'] }),
    timeout: 2000,
  });

  assert.deepEqual(JSON.parse(stdout), { queries: ['보완수사권'], corpus: ['형사소송법'] });
});

test('scores licensed portrait imagery and falls back to typography', async () => {
  const score = scoreImageCandidate({
    source: 'pexels',
    width: 1600,
    height: 2400,
    description: '한국은행 금리 금융',
  }, '한국은행 금리', '기준금리 동결');
  assert.ok(score.score > 0.5);

  const selection = await selectLicensedImage(
    { title: '한국은행 기준금리 동결', category: 'economy' },
    { fetchImpl: async () => new Response('{}', { status: 500 }) }
  );
  assert.equal(selection.kind, 'typographic');
  assert.equal(selection.source, 'diem-original');
  assert.ok(selection.attempts.length > 0);
});

test('accepts only commercial and modifiable Openverse licenses', async () => {
  const images = await searchOpenverse('apartment sale contract', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        results: [
          {
            id: 'allowed-by',
            title: 'Apartment sale contract house keys',
            url: 'https://images.example/allowed.jpg',
            foreign_landing_url: 'https://example.org/allowed',
            creator: 'Creator',
            license: 'by',
            license_url: 'https://creativecommons.org/licenses/by/4.0/',
            width: 1600,
            height: 2400,
            tags: [{ name: 'apartment' }, { name: 'contract' }],
          },
          {
            id: 'blocked-nc',
            title: 'Apartment contract',
            url: 'https://images.example/blocked.jpg',
            license: 'by-nc',
            width: 1600,
            height: 2400,
          },
        ],
      }),
    }),
  });

  assert.equal(images.length, 1);
  assert.equal(images[0].id, 'openverse:allowed-by');
  assert.equal(images[0].source, 'openverse');
  assert.match(images[0].description, /apartment.*contract/iu);
});

test('prioritizes concrete housing and cash-support image queries', () => {
  const housing = buildImageQueries({
    title: '수도권 15억~20억 아파트 거래 절반이 신고가',
    summary: '서울 아파트 매매 거래와 실거주 부담을 다룬 기사입니다.',
    category: 'economy',
  });
  const benefit = buildImageQueries({
    title: '민생지원금 50만원 지급 시작',
    summary: '지역화폐와 소비쿠폰으로 현금성 지원을 지급합니다.',
    category: 'economy',
  });

  assert.match(housing[0], /South Korea apartment buildings/u);
  assert.match(benefit[0], /cash assistance voucher/u);
});

test('builds concrete event-first queries for recent production image failures', () => {
  const politicalPrimary = buildImageQueries({
    title: '김민석, 호남 순회경선에서 압승…누적 과반 1위',
    summary: '민주당 당대표 후보 경선에서 김민석 후보가 과반을 기록했다. 기사 후반에는 호남 반도체 산업 기대도 언급됐다.',
    category: 'issue',
    newsFrame: { eventKind: 'semiconductor', subject: '반도체' },
  });
  const historicalRemarks = buildImageQueries({
    title: '이병태 "국민이 왜 5·18에 죄의식 갖나" 작심 발언',
    summary: '이병태 전 대통령직속 규제합리화위원회 부위원장이 5·18 민주화운동 관련 글을 올려 논란이 됐다.',
    category: 'issue',
  });
  const deliveryEntry = buildImageQueries({
    title: '한밤중 집 안으로 들어온 배달기사',
    summary: '주문이 없었는데 배달기사가 열린 현관문 안으로 들어온 사건이다.',
    category: 'issue',
  });
  const weather = buildImageQueries({
    title: '시간당 65㎜ 폭우 쏟아진 해남, 호우위기경보 상향',
    summary: '집중호우로 도로와 주택 침수 신고가 이어졌다.',
    category: 'issue',
  });
  const billboard = buildImageQueries({
    title: "사비로 뉴욕에 '봉화사과' 광고 띄운 공무원",
    summary: '뉴욕 타임스스퀘어 전광판에 봉화사과 한글 광고를 게시했다.',
    category: 'issue',
  });

  assert.match(politicalPrimary[0], /election|ballot|convention|political party/i);
  assert.doesNotMatch(politicalPrimary.join(' '), /semiconductor|microchip|processor/i);
  assert.match(historicalRemarks[0], /Gwangju|May 18|democracy memorial/i);
  assert.ok(historicalRemarks.some(query => /National Cemetery|Uprising memorial/i.test(query)));
  assert.doesNotMatch(historicalRemarks.join(' '), /presidential office/i);
  assert.match(deliveryEntry[0], /front door|hallway|delivery package/i);
  assert.ok(deliveryEntry.some(query => /apartment front door/i.test(query)));
  assert.match(weather[0], /heavy rain|flooded|rainstorm/i);
  assert.match(billboard[0], /Times Square|billboard/i);
  assert.ok(billboard.some(query => /^Times Square billboard$/i.test(query)));
});

test('accepts person-free event objects for memorial, billboard, and home-access stories', () => {
  const cases = [
    [{ description: 'Graves of May 18th National Cemetery Gwangju South Korea' }, 'May 18 National Cemetery Gwangju', {
      title: '이병태 5·18 발언 논란',
      summary: '5·18 민주화운동 관련 발언이 논란이 됐다.',
      category: 'issue',
    }],
    [{ description: 'Times Square billboard at night in New York City' }, 'Times Square billboard', {
      title: '공무원 타임스스퀘어 광고',
      summary: '뉴욕 전광판에 지역 사과 광고를 게시했다.',
      category: 'issue',
    }],
    [{ description: 'Apartment building front door and entrance' }, 'apartment front door', {
      title: '배달기사 집 침입 사건',
      summary: '열린 현관문 안으로 배달기사가 들어왔다.',
      category: 'issue',
    }],
  ];

  for (const [image, query, candidate] of cases) {
    const result = assessImageSuitability(image, query, candidate, { requirePersonFreeEvidence: true });
    assert.equal(result.ok, true, `${query}: ${result.reason}`);
  }
});

test('does not mistake adult ages or presidential-affiliated posts for a minor or former president', () => {
  const adult = assessImageSuitability({
    description: 'Times Square digital billboard advertising screen at night',
  }, 'Times Square digital billboard advertising screen', {
    title: "사비로 뉴욕 광고 띄운 27세 공무원",
    summary: '27세 공무원이 타임스스퀘어 전광판에 광고를 냈다.',
  });
  const affiliated = extractPrimaryPersonIdentity({
    title: '이병태 5·18 발언 논란',
    summary: '이병태 전 대통령직속 규제합리화위원회 부위원장의 발언이 논란이 됐다.',
    editorialTitle: '이병태\n5·18 발언 논란',
  });

  assert.deepEqual(adult.requiredVisualRoles, []);
  assert.equal(adult.ok, true);
  assert.equal(affiliated, null);
});

test('rejects a generic Seoul tower when only geography overlaps a specific civic-event query', () => {
  const suitability = assessImageSuitability({
    description: 'Cityscape of Seoul showcasing modern office towers and a road intersection in South Korea',
  }, 'Gwangju May 18 democracy memorial South Korea', {
    title: '이병태 5·18 발언 논란',
    summary: '5·18 민주화운동에 관한 발언이 논란이 됐다.',
    category: 'issue',
  });

  assert.equal(suitability.ok, false);
  assert.equal(suitability.reason, 'primary_visual_anchor_missing');
});

test('uses event-specific fallback art when no licensed photo is safe', () => {
  const cases = [
    [{ title: '해남 폭우 위기경보 상향', summary: '집중호우와 침수 피해가 이어졌다.', category: 'issue' }, 'weather-emergency'],
    [{ title: '배달기사 집 침입 사건', summary: '열린 현관문 안으로 배달기사가 들어왔다.', category: 'issue' }, 'home-security'],
    [{ title: '공무원 타임스스퀘어 광고', summary: '뉴욕 전광판에 지역 사과 광고를 냈다.', category: 'issue' }, 'civic-advertising'],
    [{ title: '김민석 당대표 경선 압승', summary: '정당 대표 경선에서 과반을 기록했다.', category: 'issue' }, 'political-election'],
    [{ title: '이병태 5·18 발언 논란', summary: '5·18 민주화운동 관련 발언이 논란이 됐다.', category: 'issue' }, 'democratic-history'],
  ];

  for (const [candidate, expectedTheme] of cases) {
    assert.equal(createTypographyFallback(candidate).fallbackTheme, expectedTheme);
  }
});

test('skips licensed images used in the recent seven-day image history', async () => {
  const photos = [
    {
      id: 15476105,
      url: 'https://www.pexels.com/photo/the-inside-of-a-large-building-with-a-dome-15476105/',
      src: { portrait: 'https://images.pexels.com/photos/15476105/pexels-photo-15476105.jpeg?auto=compress&h=1200&w=800' },
      photographer: 'Used Creator',
      photographer_url: 'https://www.pexels.com/@used',
      width: 3000,
      height: 4000,
      alt: 'Korean National Assembly Seoul building chamber',
    },
    {
      id: 222222,
      url: 'https://www.pexels.com/photo/another-government-building-222222/',
      src: { portrait: 'https://images.pexels.com/photos/222222/pexels-photo-222222.jpeg?auto=compress&h=1200&w=800' },
      photographer: 'Fresh Creator',
      photographer_url: 'https://www.pexels.com/@fresh',
      width: 3000,
      height: 4000,
      alt: 'Korean National Assembly Seoul building',
    },
  ];
  const selection = await selectLicensedImage(
    { title: '정부 정책 국회 발표', category: 'issue' },
    {
      pexelsApiKey: 'pexels-key',
      recentImages: [{ id: 'pexels:15476105' }],
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ photos }),
      }),
    }
  );

  assert.equal(selection.kind, 'web');
  assert.equal(selection.id, 'pexels:222222');
  assert.equal(selection.rankWithinQuery, 2);
  assert.equal(selection.selectedPoolIndex, 1);
  assert.equal(selection.selectionPoolSize, 1);
  assert.equal(selection.reuseGuard.allowed, true);
  assert.equal(selection.reuseGuard.blockedCandidateCount, 1);
  assert.equal(selection.reuseGuard.windowDays, 7);
  assert.ok(selection.selectionReason.includes('rank #2'));
});

test('normalizes reusable image identifiers across ids, urls, and hashes', () => {
  const keys = imageReuseKeys({
    id: 'pexels:15476105',
    originalUrl: 'https://www.pexels.com/photo/x/?utm_source=diem',
    downloadUrl: 'https://images.pexels.com/photos/15476105/photo.jpeg?auto=compress',
    localSha256: 'abc123',
    visualFingerprint: 'diem-art:markets:v12',
  });
  assert.ok(keys.includes('pexels:15476105'));
  assert.ok(keys.includes('https://www.pexels.com/photo/x/'));
  assert.ok(keys.includes('https://images.pexels.com/photos/15476105/photo.jpeg'));
  assert.ok(keys.includes('abc123'));
  assert.ok(keys.includes('diem-art:markets:v12'));
});

test('prioritizes occupational heat and rooftop work over incidental apartment imagery', () => {
  const queries = buildImageQueries({
    title: '49.7도 치솟았는데 지금이 성수기',
    summary: '한국 김포 아파트 옥상 작업자들이 그늘 없이 두 시간 넘게 일했습니다.',
    fullText: '옥상 방수 작업 현장의 온도계가 49.7도를 기록했고 노동자들은 폭염에 노출됐습니다.',
    category: 'issue',
  });

  assert.match(queries[0], /construction|outdoor workers|rooftop/i);
  assert.match(queries[0], /heat/i);
  assert.doesNotMatch(queries[0], /real estate|apartment building/i);
  assert.ok(queries.every(query => !/^\s*\d/u.test(query)));
});

test('does not require country metadata for a person-free conceptual domestic workplace photo', () => {
  const candidate = {
    title: '김포 옥상 작업 49.7도 폭염',
    summary: '한국의 건설 노동자들이 옥상에서 그늘 없이 작업했습니다.',
    category: 'issue',
  };
  const result = assessImageSuitability({
    description: 'construction site rooftop thermometer during extreme heat',
  }, 'construction workers rooftop extreme heat', candidate);

  assert.equal(result.ok, true);
  assert.equal(result.requiredGeography, null);
});

test('selects a licensed occupational heat photo before unrelated apartment imagery', async () => {
  const photos = [
    {
      id: 401,
      url: 'https://www.pexels.com/photo/apartment-building-401/',
      src: { portrait: 'https://images.pexels.com/photos/401/apartment.jpeg' },
      photographer: 'Apartment Creator',
      width: 2400,
      height: 3600,
      alt: 'modern luxury apartment building exterior',
    },
    {
      id: 402,
      url: 'https://www.pexels.com/photo/roof-workers-402/',
      src: { portrait: 'https://images.pexels.com/photos/402/roof-workers.jpeg' },
      photographer: 'Safety Creator',
      width: 2400,
      height: 3600,
      alt: 'construction site rooftop thermometer and safety equipment during extreme heat',
    },
  ];
  const selection = await selectLicensedImage({
    title: '49.7도 치솟은 김포 옥상 작업',
    summary: '한국 김포 아파트 옥상 노동자들이 그늘 없이 일했습니다.',
    fullText: '현장 온도계가 49.7도를 기록한 폭염 속에서 작업이 이어졌습니다.',
    category: 'issue',
  }, {
    pexelsApiKey: 'pexels-key',
    fetchImpl: async () => ({ ok: true, json: async () => ({ photos }) }),
  });

  assert.equal(selection.kind, 'web');
  assert.equal(selection.id, 'pexels:402');
  assert.match(selection.query, /construction workers rooftop extreme heat/i);
  assert.equal(selection.suitability.requiredGeography, null);
});

test('allows neutral legal imagery while keeping foreign parliament photos out of Korean institution stories', () => {
  const candidate = {
    title: '청와대, 보완수사권 폐지 국회 판단 존중',
    summary: '형사소송법 개정안이 대한민국 국회 본회의를 통과했습니다.',
    category: 'issue',
  };
  const conceptual = assessImageSuitability({
    description: 'legal document and gavel representing legislation and law',
  }, 'law legislation legal document gavel', candidate);

  assert.equal(conceptual.ok, true);
  assert.equal(conceptual.requiredGeography, null);
});

test('assigns topic-grounded typography art and avoids its recent seven-day fingerprint', () => {
  const candidate = {
    title: '옥상 작업 49.7도 폭염',
    summary: '건설 노동자들이 그늘 없이 옥상에서 작업했습니다.',
    fullText: '현장 온도계가 49.7도를 기록했습니다.',
    category: 'issue',
  };
  const first = createTypographyFallback(candidate, { recentImages: [] });
  const second = createTypographyFallback(candidate, { recentImages: [first] });

  assert.equal(first.kind, 'typographic');
  assert.equal(first.fallbackTheme, 'occupational-heat');
  assert.match(first.visualFingerprint, /^diem-art:occupational-heat:v\d+$/u);
  assert.notEqual(second.visualFingerprint, first.visualFingerprint);
  assert.notEqual(second.id, first.id);
  assert.ok(second.reuseGuard.blockedCandidateCount >= 1);
});

test('fails the fallback reuse guard instead of silently repeating an exhausted art theme', () => {
  const recentImages = Array.from({ length: 64 }, (_, variant) => ({
    visualFingerprint: `diem-art:occupational-heat:v${variant}`,
  }));
  const fallback = createTypographyFallback({
    title: '옥상 작업 49.7도 폭염',
    summary: '폭염 속 옥상 노동 현장',
    category: 'issue',
  }, { recentImages });

  assert.equal(fallback.reuseGuard.allowed, false);
  assert.equal(fallback.reuseGuard.blockedCandidateCount, 64);
});

test('prioritizes the concrete article subject over a generic government background', () => {
  const queries = buildImageQueries({
    title: '정부, 결혼 축의금 100만원 현금 지원',
    category: 'issue',
    imageKeyword: 'government policy',
  });
  assert.match(queries[0], /wedding|couple|marriage/i);
  assert.doesNotMatch(queries[0], /government|parliament/i);
});

test('does not let resolution alone pass an unrelated image', () => {
  const unrelated = scoreImageCandidate({
    source: 'pexels',
    width: 3000,
    height: 4500,
    description: 'grand parliament chamber interior',
  }, 'wedding couple marriage', '결혼 축의금 현금 지원');
  assert.equal(unrelated.components.semanticMetadata, 0);
  assert.ok(unrelated.score < 0.42);
});

test('scores provider metadata against the image query without diluting it with a Korean headline', () => {
  const result = scoreImageCandidate({
    source: 'pexels',
    width: 2400,
    height: 3600,
    description: 'semiconductor microchip processor factory',
  }, 'semiconductor microchip processor', '한국 반도체 1위 유지 배터리 조선 중국 선두');

  assert.equal(result.components.semanticMetadata, 1);
  assert.ok(result.score >= 0.9);
});

test('rejects a medical professional photo when the article subject is a teenage patient', () => {
  const candidate = {
    title: "태국 고등학생 '귀신 분장' 응급 이송",
    summary: '16세 여학생이 복통을 호소해 병원으로 옮겨졌습니다.',
    category: 'issue',
  };
  const doctor = assessImageSuitability({
    description: 'adult female doctor medical professional smiling in clinic',
  }, 'healthcare hospital medical clinic', candidate);
  const patient = assessImageSuitability({
    description: 'teenage student patient receiving care in hospital emergency room',
  }, 'healthcare hospital medical clinic', candidate);

  assert.equal(doctor.ok, false);
  assert.equal(doctor.reason, 'unverified_stock_person');
  assert.equal(patient.ok, false);
  assert.equal(patient.reason, 'unverified_stock_person');
});

test('does not infer a minor visual role from an incidental biography buried in a business article', () => {
  const candidate = {
    title: '헤지펀드 SA, 반도체 보유주식 시타델에 매각',
    summary: 'SA가 반도체·AI 인프라 주식을 시타델에 넘기며 반대매매 우려가 완화됐습니다.',
    fullText: '창업자는 19세에 대학을 졸업한 경력이 있습니다.',
    category: 'economy',
  };
  const result = assessImageSuitability({
    description: 'semiconductor microchip processor factory',
  }, 'semiconductor microchip processor', candidate);

  assert.equal(result.ok, true);
  assert.deepEqual(result.requiredVisualRoles, []);
});

test('rejects a foreign parliament photo for a Korean National Assembly story', () => {
  const candidate = {
    title: '한국 국회, 형사소송법 개정안 통과',
    summary: '대한민국 국회 본회의에서 법안이 통과됐습니다.',
    category: 'issue',
  };
  const foreign = assessImageSuitability({
    description: 'ornate Houses of Parliament building in London England',
  }, 'Korean National Assembly Seoul', candidate);
  const korean = assessImageSuitability({
    description: 'Korean National Assembly building in Seoul South Korea',
  }, 'Korean National Assembly Seoul', candidate);

  assert.equal(foreign.ok, false);
  assert.equal(foreign.reason, 'geographic_context_mismatch');
  assert.equal(korean.ok, true);
});

test('prioritizes GDP imagery over incidental AI infrastructure in a macroeconomic article', () => {
  const queries = buildImageQueries({
    title: '미국 2분기 GDP 성장률 1.5% 둔화',
    summary: '개인소비와 AI 민간투자가 성장률을 받쳤습니다.',
    category: 'economy',
    newsFrame: { eventKind: 'gdp', subject: '미국 성장률' },
    imageKeyword: 'artificial intelligence server data center',
  });

  assert.match(queries[0], /GDP|gross domestic product|economic growth/i);
  assert.doesNotMatch(queries[0], /server|data center/i);
});

test('does not let incidental legislation in the article body replace the primary earnings image', () => {
  const queries = buildImageQueries({
    title: '삼성 반도체 2분기 영업이익 급증',
    summary: 'AI 메모리 수요로 반도체 실적이 개선됐습니다.',
    fullText: '기사 뒤쪽에서는 정부의 데이터센터 지원 법안과 국회 논의도 짧게 소개합니다.',
    category: 'economy',
    newsFrame: { eventKind: 'earnings', subject: '삼성전자 반도체', event: '2분기 영업이익 증가' },
  });

  assert.match(queries[0], /semiconductor|microchip/i);
  assert.doesNotMatch(queries[0], /assembly|parliament|legislation/i);
});

test('rejects generic keyword matches and selects the next person-free image with the concrete subject', async () => {
  const generic = assessImageSuitability({
    description: 'government support policy parliament building',
  }, 'government childcare support');
  assert.equal(generic.ok, false);
  assert.equal(generic.reason, 'concrete_subject_missing');

  const photos = [
    {
      id: 101,
      url: 'https://www.pexels.com/photo/government-building-101/',
      src: { portrait: 'https://images.pexels.com/photos/101/government.jpeg' },
      photographer: 'Generic Creator',
      width: 3000,
      height: 4500,
      alt: 'government support policy parliament building',
    },
    {
      id: 202,
      url: 'https://www.pexels.com/photo/childcare-application-202/',
      src: { portrait: 'https://images.pexels.com/photos/202/childcare-application.jpeg' },
      photographer: 'Relevant Creator',
      width: 3000,
      height: 4500,
      alt: 'childcare service enrollment application document on home table',
    },
  ];
  const selection = await selectLicensedImage({
    title: '정부, 아이돌봄 지원 확대',
    category: 'issue',
    imageKeyword: 'government childcare support',
  }, {
    pexelsApiKey: 'pexels-key',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ photos }),
    }),
  });

  assert.equal(selection.kind, 'web');
  assert.equal(selection.id, 'pexels:202');
  assert.equal(selection.suitability.ok, true);
  assert.equal(selection.attempts[0].suitabilityRejected, 1);
  assert.equal(selection.attempts[0].suitabilityRejections[0].id, 'pexels:101');
  assert.equal(selection.attempts[0].suitabilityRejections[0].reason, 'concrete_subject_missing');
});

test('keeps a named cover subject identity-critical but searches event context before a portrait', () => {
  const candidate = {
    title: '"어리석은 왕 불쌍히" 남산에 플래카드 걸었다가 벌어진 일',
    summary: '서울고법은 국가가 서울제일교회와 박형규 목사에게 배상해야 한다고 판결했다. 과거 학생운동과 대학 강연 이력도 소개됐다.',
    editorialTitle: '서울고법\n박형규 배상',
    category: 'issue',
  };

  assert.deepEqual(extractPrimaryPersonIdentity(candidate), { name: '박형규', role: '목사', critical: true });
  assert.match(buildImageQueries(candidate)[0], /legal|court|gavel|document/i);
  assert.doesNotMatch(buildImageQueries(candidate).join(' '), /박형규/u);
});

test('rejects unrelated stock people and accepts only exact-page verified portrait imagery', () => {
  const candidate = {
    title: "조세심판원, 배우 유연석 '30억 세금' 불복 청구 기각",
    summary: '배우 유연석의 조세심판 청구가 기각됐다.',
    editorialTitle: '조세심판원\n유연석 청구 기각',
    category: 'economy',
  };
  const stockPerson = assessImageSuitability({
    source: 'pexels',
    description: 'Korean actor portrait in a studio',
  }, '유연석', candidate, { selectionRole: 'portrait' });
  const verifiedPerson = assessImageSuitability({
    source: 'wikimedia',
    description: 'File:배우 유연석 2025년 공식 행사.jpg',
    identityAuthority: 'wikipedia-page',
  }, '유연석', candidate, { selectionRole: 'portrait' });

  assert.equal(stockPerson.ok, false);
  assert.equal(stockPerson.reason, 'named_person_identity_unverified');
  assert.equal(stockPerson.identity.required, true);
  assert.equal(verifiedPerson.ok, true);
  assert.equal(verifiedPerson.identity.verified, true);
});

test('uses a person-free contextual image before looking up a named subject portrait', async () => {
  const requestedUrls = [];
  const selection = await selectLicensedImage({
    title: '이재명 대통령, 폭염 시 휴가 권고',
    summary: '이재명 대통령이 폭염 기간 휴가 사용을 권고했다.',
    editorialTitle: '이재명 대통령\n휴가 권고',
    category: 'issue',
  }, {
    pexelsApiKey: 'pexels-key',
    fetchImpl: async url => {
      requestedUrls.push(String(url));
      return {
        ok: true,
        json: async () => ({ photos: [{
          id: 701,
          url: 'https://www.pexels.com/photo/presidential-office-701/',
          src: { portrait: 'https://images.pexels.com/photos/701/office.jpg' },
          photographer: 'Architecture Creator',
          width: 2400,
          height: 3600,
          alt: 'South Korea presidential office building exterior in Seoul',
        }] }),
      };
    },
  });

  assert.equal(selection.kind, 'web');
  assert.equal(selection.id, 'pexels:701');
  assert.equal(selection.visualRole, 'context');
  assert.equal(selection.identity.required, false);
  assert.ok(requestedUrls.some(url => /api\.pexels/u.test(url)));
  assert.ok(requestedUrls.every(url => !/ko\.wikipedia/u.test(url)));
});

test('rejects a generic stock person even when the setting matches the article query', () => {
  const suitability = assessImageSuitability({
    source: 'pexels',
    description: 'Black woman student sitting in a classroom',
  }, 'students school education classroom', {
    title: '서울고법 판결',
    summary: '교육 현장을 둘러싼 판결이 나왔다.',
  });

  assert.equal(suitability.ok, false);
  assert.equal(suitability.reason, 'unverified_stock_person');
});

test('falls back to typography when named-subject context and exact portrait are unavailable', async () => {
  const requestedUrls = [];
  const selection = await selectLicensedImage({
    title: "조세심판원, 배우 유연석 '30억 세금' 불복 청구 기각",
    summary: '배우 유연석이 낸 조세심판 청구가 기각됐다.',
    editorialTitle: '조세심판원\n유연석 청구 기각',
    category: 'economy',
  }, {
    pexelsApiKey: 'context-search-key',
    unsplashAccessKey: 'context-search-key',
    fetchImpl: async url => {
      requestedUrls.push(String(url));
      if (/api\.pexels/u.test(String(url))) return { ok: true, json: async () => ({ photos: [] }) };
      if (/api\.unsplash/u.test(String(url))) return { ok: true, json: async () => ({ results: [] }) };
      return { ok: true, json: async () => ({ query: { pages: {} } }) };
    },
  });

  assert.equal(selection.kind, 'typographic');
  assert.equal(selection.identity.required, false);
  assert.equal(selection.identity.depicted, false);
  assert.ok(requestedUrls.some(url => /api\.pexels/u.test(url)));
  assert.ok(requestedUrls.some(url => /ko\.wikipedia/u.test(url)));
});

test('resolves an exact Korean Wikipedia person page to its freely licensed Commons image', async () => {
  const requestedUrls = [];
  const selection = await selectLicensedImage({
    title: '이재명 대통령, 폭염 시 휴가 권고',
    summary: '이재명 대통령이 폭염 기간 휴가 사용을 권고했다.',
    editorialTitle: '이재명 대통령\n휴가 권고',
    category: 'issue',
  }, {
    fetchImpl: async url => {
      requestedUrls.push(String(url));
      if (String(url).includes('ko.wikipedia.org')) {
        return {
          ok: true,
          json: async () => ({ query: { pages: { 1: { pageid: 1, title: '이재명', pageimage: 'Lee Jae-myung 2026.jpg' } } } }),
        };
      }
      if (/titles=File(?::|%3A)/u.test(String(url))) {
        return {
          ok: true,
          json: async () => ({ query: { pages: { 2: {
            pageid: 2,
            title: 'File:Lee Jae-myung 2026.jpg',
            imageinfo: [{
              url: 'https://upload.wikimedia.org/lee.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Lee_Jae-myung_2026.jpg',
              width: 1600,
              height: 2400,
              extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } },
            }],
          } } } }),
        };
      }
      return { ok: true, json: async () => ({ query: { pages: {} } }) };
    },
  });

  assert.equal(selection.kind, 'web');
  assert.equal(selection.source, 'wikimedia');
  assert.equal(selection.identityAuthority, 'wikipedia-page');
  assert.equal(selection.identity.verified, true);
  assert.equal(selection.identity.name, '이재명');
  assert.ok(requestedUrls.some(url => url.includes('ko.wikipedia.org')));
  assert.ok(requestedUrls.some(url => /titles=File(?::|%3A)/u.test(url)));
});

test('uses typography instead of repeating a recently used verified portrait', async () => {
  const selection = await selectLicensedImage({
    title: '이재명 대통령, 폭염 시 휴가 권고',
    summary: '이재명 대통령이 폭염 기간 휴가 사용을 권고했다.',
    editorialTitle: '이재명 대통령\n휴가 권고',
    category: 'issue',
  }, {
    recentImages: [{ id: 'wikimedia:2' }],
    fetchImpl: async url => {
      const requestUrl = String(url);
      if (requestUrl.includes('ko.wikipedia.org')) {
        return {
          ok: true,
          json: async () => ({ query: { pages: { 1: { pageid: 1, title: '이재명', pageimage: 'Lee representative.jpg' } } } }),
        };
      }
      if (/titles=File(?::|%3A)/u.test(requestUrl)) {
        return {
          ok: true,
          json: async () => ({ query: { pages: { 2: {
            pageid: 2,
            title: 'File:Lee representative.jpg',
            imageinfo: [{
              url: 'https://upload.wikimedia.org/lee-representative.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Lee_representative.jpg',
              width: 1600,
              height: 2400,
              extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } },
            }],
          } } } }),
        };
      }
      return {
        ok: true,
        json: async () => ({ query: { pages: {
          2: {
            pageid: 2,
            title: 'File:이재명 대표 사진.jpg',
            imageinfo: [{
              url: 'https://upload.wikimedia.org/lee-representative.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Lee_representative.jpg',
              width: 1600,
              height: 2400,
              extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' } },
            }],
          },
          3: {
            pageid: 3,
            title: 'File:이재명 공식 행사 2026.jpg',
            imageinfo: [{
              url: 'https://upload.wikimedia.org/lee-event-2026.jpg',
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Lee_event_2026.jpg',
              width: 1800,
              height: 2700,
              extmetadata: {
                LicenseShortName: { value: 'CC BY 4.0' },
                ImageDescription: { value: '이재명 대통령 공식 행사 사진' },
              },
            }],
          },
        } } }),
      };
    },
  });

  assert.equal(selection.kind, 'typographic');
  assert.equal(selection.identity.depicted, false);
  assert.ok(selection.attempts.some(attempt => attempt.recentReuseBlocked >= 1));
});

test('ships 30 labeled Korean article pairs for live embedding calibration', () => {
  const dataset = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'similarity', 'korean-article-pairs.json'),
    'utf8'
  ));
  assert.equal(dataset.length, 30);
  assert.equal(dataset.filter(pair => pair.expectedDuplicate).length, 15);
  assert.equal(dataset.filter(pair => !pair.expectedDuplicate).length, 15);
});

test('detectCharset extracts charset from Content-Type header values', () => {
  assert.equal(detectCharset('text/html;charset=EUC-KR'), 'euc-kr');
  assert.equal(detectCharset('text/html; charset=utf-8'), 'utf-8');
  assert.equal(detectCharset('text/html'), '');
  assert.equal(detectCharset(''), '');
  assert.equal(detectCharset('text/html; charset="euc-kr"'), 'euc-kr');
});

test('decodeResponseBody correctly decodes EUC-KR encoded Korean text', async () => {
  const encoder = new TextEncoder();
  // "한국은행" in EUC-KR: 0xC7 0xD1 0xB1 0xB9 0xC0 0xBA 0xC7 0xE0
  const eucKrBytes = new Uint8Array([0xC7, 0xD1, 0xB1, 0xB9, 0xC0, 0xBA, 0xC7, 0xE0]);
  const eucKrResponse = {
    headers: new Map([['content-type', 'text/html;charset=EUC-KR']]),
    arrayBuffer: async () => eucKrBytes.buffer,
    text: async () => new TextDecoder('utf-8').decode(eucKrBytes),
  };
  // Patch headers.get
  eucKrResponse.headers.get = (key) => eucKrResponse.headers.get(key);
  const fakeHeaders = { get: (key) => key === 'content-type' ? 'text/html;charset=EUC-KR' : null };
  const result = await decodeResponseBody({ headers: fakeHeaders, arrayBuffer: async () => eucKrBytes.buffer });
  assert.equal(result, '한국은행');

  // UTF-8 path uses response.text()
  const utf8Response = {
    headers: { get: () => 'text/html; charset=utf-8' },
    text: async () => '한국은행 기준금리',
  };
  const utf8Result = await decodeResponseBody(utf8Response);
  assert.equal(utf8Result, '한국은행 기준금리');
});
