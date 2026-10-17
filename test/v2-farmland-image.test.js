const test = require('node:test');
const assert = require('node:assert/strict');
const { buildNewsFrame } = require('../src/v2/topic');
const { generatedFallbackTopic, createGeneratedFallback, buildImageQueries } = require('../src/v2/image-selector');

function farmlandCandidate() {
  const candidate = {
    title: '“땅값 반토막났는데 농지조사까지… 거래도 대출도 막혀”',
    summary: '농지 소유와 이용 실태 조사가 진행되는 가운데 농지 거래와 담보 대출이 어려워졌다는 농가의 목소리를 전했다.',
  };
  return { ...candidate, newsFrame: buildNewsFrame(candidate, 'economy') };
}

test('the primary farmland event retains its subject and maps only to farmland artwork', () => {
  const candidate = farmlandCandidate();
  assert.equal(candidate.newsFrame.subject, '농지');
  assert.equal(generatedFallbackTopic(candidate), 'agriculture');
  assert.match(buildImageQueries(candidate).join(' '), /farmland|agricultur/iu);
  const image = createGeneratedFallback(candidate);
  assert.equal(image.generatedTopic, 'agriculture');
  assert.equal(image.suitability.topicMatch.ok, true);
  assert.equal(createGeneratedFallback({ ...candidate, generatedAssetId: 'housing-01' }), null);
});

test('incidental farmland words cannot change a locked market or political subject', () => {
  for (const [subject, eventKind, expected] of [
    ['코스피', 'market_move', 'markets'],
    ['국회 법안', 'legislation', 'legislation'],
  ]) {
    const candidate = { ...farmlandCandidate(), newsFrame: { subject, eventKind, eventLabel: '변동' } };
    assert.equal(generatedFallbackTopic(candidate), expected);
    assert.equal(createGeneratedFallback({ ...candidate, generatedAssetId: 'agriculture-01-openai' }), null);
  }
});
