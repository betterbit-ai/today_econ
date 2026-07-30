const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { verifyCoreClaims, isLikelySyndicatedCopy } = require('../src/v2/fact-verifier');
const {
  assessImageSuitability,
  buildImageQueries,
  imageReuseKeys,
  scoreImageCandidate,
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
const { computeEmbeddingMatrix, evaluateAgainstHistory } = require('../src/v2/similarity');

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
      alt: 'government parliament policy law chamber',
    },
    {
      id: 222222,
      url: 'https://www.pexels.com/photo/another-government-building-222222/',
      src: { portrait: 'https://images.pexels.com/photos/222222/pexels-photo-222222.jpeg?auto=compress&h=1200&w=800' },
      photographer: 'Fresh Creator',
      photographer_url: 'https://www.pexels.com/@fresh',
      width: 3000,
      height: 4000,
      alt: 'government parliament policy law building',
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
  });
  assert.ok(keys.includes('pexels:15476105'));
  assert.ok(keys.includes('https://www.pexels.com/photo/x/'));
  assert.ok(keys.includes('https://images.pexels.com/photos/15476105/photo.jpeg'));
  assert.ok(keys.includes('abc123'));
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
  assert.equal(doctor.reason, 'article_subject_role_mismatch');
  assert.equal(patient.ok, true);
  assert.ok(patient.matchedVisualRoles.includes('minor_student'));
  assert.ok(patient.matchedVisualRoles.includes('patient'));
});

test('rejects generic keyword matches and selects the next image with the concrete subject', async () => {
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
      url: 'https://www.pexels.com/photo/family-childcare-202/',
      src: { portrait: 'https://images.pexels.com/photos/202/childcare.jpeg' },
      photographer: 'Relevant Creator',
      width: 3000,
      height: 4500,
      alt: 'family parents child using childcare service at home',
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
