const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validateImageQuality, validatePreparedQuality } = require('../src/v2/quality-gate');
const { validateCaption, validateTitleAgainstFrame } = require('../src/v2/text');

const fixtures = JSON.parse(fs.readFileSync(
  path.join(__dirname, 'fixtures', 'editorial', 'quality-cases.json'),
  'utf8'
));

for (const fixture of fixtures) {
  test(`quality regression: ${fixture.name}`, () => {
    const result = fixture.kind === 'title'
      ? validateTitleAgainstFrame(fixture.value, fixture.frame)
      : fixture.kind === 'caption'
        ? validateCaption(fixture.value)
        : validateImageQuality(fixture.image);
    assert.equal(result.ok, fixture.expected);
  });
}

test('final prepared-quality review rejects a stored American ballot image for Korean politics', () => {
  const result = validatePreparedQuality({
    article: {
      title: '이재명 대통령, 당 지도부와 화합 만찬',
      summary: '이재명 대통령이 더불어민주당 지도부와 국정 협력을 논의했다.',
      category: 'issue',
    },
    editorial: {
      title: { text: '이재명\n당 지도부 식사' },
      caption: { text: '첫 문장입니다.📰\n\n둘째 문장입니다.\n\n셋째 문장입니다.📰' },
    },
    image: {
      kind: 'web',
      source: 'pexels',
      license: { name: 'Pexels License' },
      visualRole: 'context',
      query: 'South Korea election ballot box',
      description: 'A clear ballot box with an American flag on it, symbolizing voting and elections.',
      suitability: { ok: true, personScreening: { safe: true } },
    },
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.includes('foreign_political_symbol_mismatch')));
});
