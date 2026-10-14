const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { FILES } = require('../scripts/export-profile-funnel-assets');

test('ships three upload-ready 1080x1350 profile funnel PNGs', () => {
  const root = path.join(__dirname, '..', 'content', 'profile-funnel');
  for (const svgName of FILES) {
    const pngPath = path.join(root, svgName.replace(/\.svg$/u, '.png'));
    const png = fs.readFileSync(pngPath);
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(png.readUInt32BE(16), 1080);
    assert.equal(png.readUInt32BE(20), 1350);
    assert.ok(png.length > 20_000);
  }
});
