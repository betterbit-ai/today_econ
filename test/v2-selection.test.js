const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { verifyCoreClaims, isLikelySyndicatedCopy } = require('../src/v2/fact-verifier');
const { scoreImageCandidate, selectLicensedImage } = require('../src/v2/image-selector');
const {
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

test('ships 30 labeled Korean article pairs for live embedding calibration', () => {
  const dataset = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'similarity', 'korean-article-pairs.json'),
    'utf8'
  ));
  assert.equal(dataset.length, 30);
  assert.equal(dataset.filter(pair => pair.expectedDuplicate).length, 15);
  assert.equal(dataset.filter(pair => !pair.expectedDuplicate).length, 15);
});
