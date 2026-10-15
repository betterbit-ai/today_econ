const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateCandidate, planDailyQueue } = require('../src/v2/planner');
const { buildTopicSignature } = require('../src/v2/topic');

const candidate = {
  title: '코스피·코스닥 8%대 낙폭…동반 서킷브레이커 발동',
  url: 'https://example.com/market',
};
const body = '코스피는 전일 대비 8% 하락했다. 코스피와 코스닥 양대 시장에 서킷브레이커가 발동됐다. 국내 주식시장의 거래가 일시 중단됐고, 거래소는 재개 시각을 안내했다.';
const hydratedSignature = buildTopicSignature({ ...candidate, summary: body.slice(0, 800), fullText: body, category: 'economy' }, 'economy');
const base = {
  category: 'economy', allCandidates: [candidate],
  history: [{ date: '2026-10-15', publicationKey: 'other-event', signature: { text: 'economy | 관세', target: '관세', event: '수출' } }],
  referenceDate: '2026-10-15',
  fetchArticleBodyImpl: async () => body,
};

test('hydration changes the query, so stale batch similarity cannot reject the new event', async () => {
  let queries = [];
  const result = await evaluateCandidate(candidate, {
    ...base,
    semanticScores: [0.99],
    semanticQuery: buildTopicSignature(candidate, 'economy').text,
    embedder: async query => { queries.push(query); return [0.1]; },
  });
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(queries, [hydratedSignature.text]);
  assert.equal(result.duplicateCheck.score, 0.1);
});

test('scores for the exact hydrated query remain reusable and still reject duplicates', async () => {
  const result = await evaluateCandidate(candidate, {
    ...base,
    semanticScores: [0.99],
    semanticQuery: hydratedSignature.text,
    embedder: async () => assert.fail('matching batch query should be reused'),
  });
  assert.equal(result.reason, 'recent_duplicate');
  assert.equal(result.duplicateCheck.matchedPublicationKey, 'other-event');
  assert.equal(result.duplicateCheck.score, 0.99);
});

test('a fresh high similarity still rejects a duplicate after query hydration', async () => {
  const result = await evaluateCandidate(candidate, {
    ...base,
    semanticScores: [0.1],
    semanticQuery: buildTopicSignature(candidate, 'economy').text,
    embedder: async () => [0.99],
  });
  assert.equal(result.reason, 'recent_duplicate');
  assert.equal(result.duplicateCheck.score, 0.99);
});

test('a rejected duplicate retains its matched publication and the exact scored signature', async () => {
  const completeCandidate = { ...candidate, summary: body, fullText: body };
  const result = await planDailyQueue({
    date: base.referenceDate, categories: ['economy'], history: base.history,
    fetchPortalRankingsImpl: async () => ({ candidates: [completeCandidate], allFailed: false }),
    fetchArticleBodyImpl: async () => body,
    embeddingMatrixImpl: async () => [[0.99]],
    performanceReport: {},
  });
  const rejected = result.candidates[0];
  assert.ok(rejected.rejectionReasons.includes('economy:recent_duplicate'));
  assert.equal(rejected.duplicateCheck.matchedPublicationKey, 'other-event');
  assert.equal(rejected.duplicateCheck.signature.text, hydratedSignature.text);
});
