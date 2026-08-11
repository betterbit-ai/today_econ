const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validateImageQuality } = require('../src/v2/quality-gate');
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
