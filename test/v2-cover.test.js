const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BRAND, CATEGORIES } = require('../src/v2/constants');
const {
  COVER_HEIGHT,
  COVER_WIDTH,
  buildCoverHtml,
  coverMeta,
  escapeHtml,
  renderDiemCover,
  resolveImageData,
  validateCoverLayout,
} = require('../src/v2/cover');

test('builds one DIEM 9:16 cover with fixed meta and explicit line colors', () => {
  const html = buildCoverHtml({
    title: '기준금리\n0.25%',
    date: '2026-07-25',
    category: CATEGORIES.ECONOMY,
  });

  assert.match(html, /width: 1080px; height: 1920px/u);
  assert.match(html, /2026\.07\.25 \| Economy/u);
  assert.match(html, /@diem\.magazine/u);
  assert.equal((html.match(/data-title-line=/g) || []).length, 2);
  assert.match(html, new RegExp(`--diem-blue: ${BRAND.colors.blue}`, 'u'));
  assert.match(html, new RegExp(`--diem-white: ${BRAND.colors.white}`, 'u'));
  assert.match(html, /title-line-1 \{ color: var\(--diem-blue\)/u);
  assert.match(html, /title-line-2 \{ color: var\(--diem-white\)/u);
  assert.match(html, /data-no-photo="true"/u);
  assert.doesNotMatch(html, /today\.econ|subtitle|card2|mascot/u);
});

test('uses the exact category labels and rejects invalid date or category values', () => {
  assert.equal(coverMeta('2026.07.25', CATEGORIES.ECONOMY), '2026.07.25 | Economy');
  assert.equal(coverMeta('2026-07-25', CATEGORIES.ISSUE), '2026.07.25 | Issue');
  assert.throws(() => coverMeta('2026.7.25', CATEGORIES.ECONOMY), /date/u);
  assert.throws(() => coverMeta('2026-07-25', 'sports'), /category/u);
});

test('escapes all externally supplied title content before placing it in HTML', () => {
  const html = buildCoverHtml({
    title: '금리<인하\n정책&확정',
    date: '2026-07-25',
    category: CATEGORIES.ISSUE,
  });
  assert.match(html, /금리&lt;인하/u);
  assert.match(html, /정책&amp;확정/u);
  assert.doesNotMatch(html, /금리<인하/u);
  assert.equal(escapeHtml(`'\"<&>`), '&#39;&quot;&lt;&amp;&gt;');
});

test('only accepts local or base64 image data and otherwise selects typography fallback', () => {
  assert.equal(resolveImageData({ imageDataUri: 'https://example.com/photo.jpg' }), '');
  assert.equal(resolveImageData({ imagePath: '/definitely/missing/photo.jpg' }), '');
  assert.match(resolveImageData({ imageDataUri: 'data:image/png;base64,AAAA' }), /^data:image\/png/u);
});

test('validates 1080x1920, two-line, blue-white cover layout', () => {
  assert.equal(validateCoverLayout({
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    lineCount: 2,
    firstLineColor: 'rgb(77, 124, 254)',
    secondLineColor: 'rgb(247, 249, 252)',
    overflow: false,
  }).ok, true);
  const invalid = validateCoverLayout({
    width: 1080,
    height: 1350,
    lineCount: 3,
    firstLineColor: 'rgb(255, 255, 255)',
    secondLineColor: 'rgb(255, 255, 255)',
    overflow: true,
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors.length, 4);
});

test('renders a real 1080x1920 PNG and falls back safely when an image path is broken', {
  skip: process.env.RUN_PLAYWRIGHT_INTEGRATION !== 'true',
}, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-cover-'));
  const outputPath = path.join(directory, 'cover.png');
  const result = await renderDiemCover({
    title: '기준금리\n0.25%',
    date: '2026-07-25',
    category: CATEGORIES.ECONOMY,
    imagePath: path.join(directory, 'missing.jpg'),
    outputPath,
  });

  const png = fs.readFileSync(outputPath);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), COVER_WIDTH);
  assert.equal(png.readUInt32BE(20), COVER_HEIGHT);
  assert.equal(result.usedPhoto, false);
  assert.equal(result.layout.overflow, false);
});

test('profile asset is square, uses DIEM colors, and keeps the long name out of the mark', () => {
  const root = path.join(__dirname, '..');
  const svg = fs.readFileSync(path.join(root, 'assets', 'brand', 'diem-profile.svg'), 'utf8');
  const png = fs.readFileSync(path.join(root, 'assets', 'brand', 'diem-profile.png'));
  assert.match(svg, /width="1024" height="1024"/u);
  assert.match(svg, /#080C16/u);
  assert.match(svg, /#4D7CFE/u);
  assert.match(svg, /#F7F9FC/u);
  assert.match(svg, />\s*D<tspan[^>]+>I<\/tspan>EM\s*</u);
  assert.doesNotMatch(svg, /Daily Issue|today\.econ/u);
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
});
