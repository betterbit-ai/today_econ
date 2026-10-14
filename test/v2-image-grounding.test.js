const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { buildNewsFrame } = require('../src/v2/topic');
const { buildImageQueries, createGeneratedFallback, generatedFallbackTopic, selectLicensedImage } = require('../src/v2/image-selector');
const { validatePreparedQuality } = require('../src/v2/quality-gate');

function ledger(day) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'publications', '2026', '10', `2026-10-${day}.json`), 'utf8').normalize('NFC'));
}

test('October 8 history in a political film critique cannot select transit art', () => {
  const publication = ledger('08').publicationHistory.find(item => item.candidate?.title.includes('인센티브 계약'));
  assert.ok(publication);
  assert.equal(publication.image.generatedTopic, 'transit'); // Preserve the incident as evidence.
  assert.notEqual(generatedFallbackTopic({ title: publication.candidate.title }), 'transit');
  assert.equal(generatedFallbackTopic(publication.candidate), 'legislation');
  assert.equal(createGeneratedFallback(publication.candidate).generatedTopic, 'legislation');
  assert.equal(createGeneratedFallback({ ...publication.candidate, generatedAssetId: 'transit-02' }), null);
});

test('locked frame keeps headline, editorial, summary and image-keyword distractions out of searches', () => {
  const candidate = {
    title: '역사적인 지하철 계약, 반도체도 언급',
    editorialTitle: '전세 대출 급등',
    summary: '미국 전쟁과 병원 보험료를 비교했다.',
    imageKeyword: 'subway train platform',
    newsFrame: { subject: '삼성전자 반도체', eventKind: 'semiconductor', eventLabel: '칩 생산' },
  };
  assert.equal(generatedFallbackTopic(candidate), 'technology');
  const queries = buildImageQueries(candidate).join(' ');
  assert.match(queries, /semiconductor|microchip/iu);
  assert.doesNotMatch(queries, /subway|transit|estate|loan|healthcare|war/iu);
});

test('October 9 card-discount failure maps a locked card issuer to existing finance art', () => {
  const day = ledger('09');
  const rejected = [...day.candidates, ...day.candidateRuns.flatMap(run => run.candidates || [])]
    .find(item => item.title.includes('할인 오류에 카드사'));
  assert.ok(rejected.rejectionReasons.some(reason => /image_context_unavailable/u.test(reason)));
  const candidate = { ...rejected, newsFrame: buildNewsFrame(rejected, 'economy') };
  assert.equal(candidate.newsFrame.subject, '카드사');
  assert.equal(generatedFallbackTopic(candidate), 'finance');
  assert.match(buildImageQueries(candidate).join(' '), /credit card|payment/iu);
  const image = createGeneratedFallback(candidate);
  assert.equal(image.generatedTopic, 'finance');
  assert.equal(image.suitability.topicMatch.ok, true);
});

test('October 14 unmapped car-quality and parent-complaint events stay closed', async () => {
  // Keep the original incidents stable while automatic runs advance the live ledger.
  const incidents = require('./fixtures/2026-10-14-unmapped-incidents.json');
  for (const candidate of Object.values(incidents)) {
    assert.equal(generatedFallbackTopic(candidate), null);
    assert.equal(createGeneratedFallback(candidate), null);
    await assert.rejects(() => selectLicensedImage(candidate, {
      generatedFallbackEnabled: true,
      fetchImpl: async () => new Response('{}', { status: 500 }),
    }), /unmapped|typography fallback is disabled/iu);
  }
});

test('operator asset selection cannot override topic grounding or revive unmapped stories', () => {
  const candidate = { title: '서울 아파트', newsFrame: { subject: '서울 아파트', eventKind: 'housing_policy' } };
  assert.equal(createGeneratedFallback({ ...candidate, generatedAssetId: 'transit-02' }), null);
  assert.equal(createGeneratedFallback({ ...candidate, generatedAssetId: 'missing-asset' }), null);
  assert.equal(createGeneratedFallback({ title: '새 지역 사건', generatedAssetId: 'housing-01' }), null);
  assert.equal(createGeneratedFallback({ ...candidate, generatedAssetId: 'housing-01' }).generatedTopic, 'housing');
});

test('final generated-image review independently verifies manifest topic and hash', () => {
  const article = { title: '서울 아파트 정책', newsFrame: { subject: '서울 아파트', eventKind: 'housing_policy' } };
  const safe = createGeneratedFallback(article);
  const foreignTopic = createGeneratedFallback({ title: '지하철 운행 변경' });
  const input = { article, editorial: {} };
  assert.equal(validatePreparedQuality({ ...input, image: safe }).image.finalReview.ok, true);
  assert.equal(validatePreparedQuality({ ...input, image: { ...safe, id: safe.id.replace('diem-generated:', 'diem-library:') } }).image.finalReview.ok, true);
  const multiTopic = createGeneratedFallback({ title: '신용카드 결제 정책', generatedAssetId: 'markets-04-openai-01' });
  assert.equal(validatePreparedQuality({ article: { title: '신용카드 결제 정책' }, image: { ...multiTopic, generatedTopic: 'markets' } }).image.finalReview.ok, true);
  const wrong = validatePreparedQuality({ ...input, image: { ...foreignTopic, generatedTopic: 'housing' } });
  assert.equal(wrong.image.finalReview.ok, false);
  assert.ok(wrong.errors.some(error => error.includes('generated_asset_topic_mismatch')));
  const corrupted = validatePreparedQuality({ ...input, image: { ...safe, localSha256: 'wrong-hash' } });
  assert.equal(corrupted.image.finalReview.ok, false);
  assert.ok(corrupted.errors.some(error => error.includes('generated_asset_hash_mismatch')));
});

test('topic-validated operator assets still obey recent id and hash reuse guards', () => {
  const candidate = { title: '서울 아파트 정책', generatedAssetId: 'housing-01', newsFrame: { subject: '서울 아파트', eventKind: 'housing_policy' } };
  const first = createGeneratedFallback(candidate);
  assert.equal(createGeneratedFallback(candidate, { recentImages: [{ id: first.id }] }), null);
  assert.equal(createGeneratedFallback(candidate, { recentImages: [{ localSha256: first.localSha256 }] }), null);
});

test('ASCII visual abbreviations require boundaries instead of matching unrelated words', () => {
  for (const subject of ['VISA 비자 발급', 'fair 시민 행사']) {
    const candidate = { title: subject, newsFrame: { subject, eventKind: 'general', eventLabel: '' } };
    assert.equal(generatedFallbackTopic(candidate), null);
    assert.doesNotMatch(buildImageQueries(candidate).join(' '), /artificial intelligence|stock market/iu);
  }
  assert.equal(generatedFallbackTopic({ newsFrame: { subject: 'ISA 계좌', eventKind: 'general' } }), 'finance');
  assert.equal(generatedFallbackTopic({ newsFrame: { subject: '피지컬AI 반도체', eventKind: 'general' } }), 'technology');
});
