const test = require('node:test');
const assert = require('node:assert/strict');
const incident = require('./fixtures/2026-10-17-housing-image-incident.json');
const { generatedFallbackTopic, createGeneratedFallback, buildImageQueries } = require('../src/v2/image-selector');

test('October 17 housing subject cannot become legal artwork because its canonical label includes policy', () => {
  const candidate = incident.candidate;
  assert.equal(incident.observedImage.generatedTopic, 'legislation'); // Preserve the original incident.
  assert.equal(candidate.newsFrame.subject, '주거 정책');
  assert.equal(generatedFallbackTopic(candidate), 'housing');
  assert.match(buildImageQueries(candidate).join(' '), /apartment|house/iu);
  assert.doesNotMatch(buildImageQueries(candidate).join(' '), /gavel|legislation|parliament/iu);
  assert.equal(createGeneratedFallback(candidate).generatedTopic, 'housing');
  assert.equal(createGeneratedFallback({ ...candidate, generatedAssetId: 'legislation-01' }), null);
});

test('an explicit legal or market event keeps priority over the housing subject label', () => {
  for (const [eventKind, expected] of [['legislation', 'legislation'], ['market_move', 'markets']]) {
    const candidate = { ...incident.candidate, newsFrame: { ...incident.candidate.newsFrame, eventKind } };
    assert.equal(generatedFallbackTopic(candidate), expected);
    assert.equal(createGeneratedFallback({ ...candidate, generatedAssetId: 'housing-01' }), null);
  }
});
