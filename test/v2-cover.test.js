const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BRAND, CATEGORIES } = require('../src/v2/constants');
const {
  COVER_HEIGHT,
  COVER_WIDTH,
  FOLLOW_CTA,
  buildCoverHtml,
  buildFollowCtaHtml,
  coverMeta,
  escapeHtml,
  renderDiemCover,
  resolveImageData,
  validateCoverLayout,
} = require('../src/v2/cover');

test('builds a truthful Korean follow sticker without inventing a fixed briefing time', () => {
  const html = buildFollowCtaHtml({ coverImageDataUri: 'data:image/png;base64,AAAA' });
  assert.match(html, /data-follow-cta="true"/u);
  assert.match(html, /중요한 경제·시사만 골라/u);
  assert.match(html, /매일 짧고 쉽게 전해드려요/u);
  assert.match(html, /\+ 팔로우/u);
  assert.match(html, /@diem\.magazine/u);
  assert.doesNotMatch(html, /아침|8시|놓치면|무조건/u);
  assert.equal(FOLLOW_CTA.action, '+ 팔로우');
});

test('builds one DIEM 9:16 cover with fixed meta and explicit line colors', () => {
  const html = buildCoverHtml({
    title: '기준금리\n인하 확정',
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
  assert.match(html, /data-typographic-art="markets"/u);
  assert.match(html, /data-typographic-variant="0"/u);
  assert.match(html, /typography-backdrop-economy/u);
  assert.match(html, /data-diem-watermark/u);
  assert.doesNotMatch(html, /today\.econ|subtitle|card2|mascot/u);
});

test('renders distinct article-grounded fallback art instead of one category-wide static background', () => {
  const legislation = buildCoverHtml({
    title: '보완수사권\n국회 통과',
    date: '2026-07-31',
    category: CATEGORIES.ISSUE,
    fallbackTheme: 'legislation',
    fallbackVariant: 7,
    visualFingerprint: 'diem-art:legislation:v7',
  });
  const heat = buildCoverHtml({
    title: '옥상 작업\n49.7도 폭염',
    date: '2026-08-02',
    category: CATEGORIES.ISSUE,
    fallbackTheme: 'occupational-heat',
    fallbackVariant: 11,
    visualFingerprint: 'diem-art:occupational-heat:v11',
  });

  assert.match(legislation, /data-typographic-art="legislation"/u);
  assert.match(legislation, /data-visual-fingerprint="diem-art:legislation:v7"/u);
  assert.match(legislation, /data-art-motif="assembly-document"/u);
  assert.match(heat, /data-typographic-art="occupational-heat"/u);
  assert.match(heat, /data-art-motif="sun-rooftop-workers"/u);
  assert.notEqual(legislation, heat);

  const adjacentHeatVariant = buildCoverHtml({
    title: '옥상 작업\n49.7도 폭염',
    date: '2026-08-03',
    category: CATEGORIES.ISSUE,
    fallbackTheme: 'occupational-heat',
    fallbackVariant: 10,
    visualFingerprint: 'diem-art:occupational-heat:v10',
  });
  assert.match(heat, /scale\(-1 1\)/u);
  assert.doesNotMatch(adjacentHeatVariant, /scale\(-1 1\)/u);
});

test('renders distinct production-incident motifs for weather, access, advertising, elections, and history', () => {
  const cases = [
    ['weather-emergency', 'storm-rain-flood'],
    ['home-security', 'front-door-delivery'],
    ['civic-advertising', 'city-billboard'],
    ['political-election', 'ballot-podium'],
    ['political-meeting', 'conference-table-podium'],
    ['democratic-history', 'memorial-flower'],
  ];
  for (const [theme, motif] of cases) {
    const html = buildCoverHtml({
      title: '사건 맥락\n안전한 표지',
      date: '2026-08-16',
      category: CATEGORIES.ISSUE,
      fallbackTheme: theme,
      visualFingerprint: `diem-art:${theme}:v1`,
    });
    assert.match(html, new RegExp(`data-typographic-art="${theme}"`, 'u'));
    assert.match(html, new RegExp(`data-art-motif="${motif}"`, 'u'));
  }
});

test('uses the exact category labels and rejects invalid date or category values', () => {
  assert.equal(coverMeta('2026.07.25', CATEGORIES.ECONOMY), '2026.07.25 | Economy');
  assert.equal(coverMeta('2026-07-25', CATEGORIES.ISSUE), '2026.07.25 | Issue');
  assert.equal(coverMeta('2026-07-25', CATEGORIES.ECONOMY, 'diem_basic'), 'DIEM Basic');
  assert.equal(coverMeta('2026-07-25', CATEGORIES.ECONOMY, 'diem_basic', 3), 'DIEM Basic | 03');
  assert.throws(() => coverMeta('2026.7.25', CATEGORIES.ECONOMY), /date/u);
  assert.throws(() => coverMeta('2026-07-25', 'sports'), /category/u);
});

test('DIEM Basic covers use four curriculum-specific project-owned motifs', () => {
  const cases = [
    ['tax-account', 'account-ledger-tax-shield'],
    ['fund-note', 'fund-basket-versus-note'],
    ['rate-reset', 'fixed-lock-and-reset-dial'],
    ['credit-score', 'score-gauge-and-rate-steps'],
  ];
  for (const [theme, motif] of cases) {
    const html = buildCoverHtml({
      title: '경제 개념\n핵심 차이',
      date: '2026-08-14',
      category: CATEGORIES.ECONOMY,
      contentType: 'diem_basic',
      seriesNumber: 1,
      fallbackTheme: theme,
      visualFingerprint: `diem-basic:${theme}:v1`,
    });
    assert.match(html, /DIEM Basic \| 01/u);
    assert.match(html, new RegExp(`data-typographic-art="${theme}"`, 'u'));
    assert.match(html, new RegExp(`data-art-motif="${motif}"`, 'u'));
    assert.doesNotMatch(html, /<img class="background-photo"/u);
  }
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
    title: '기준금리\n인하 확정',
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
