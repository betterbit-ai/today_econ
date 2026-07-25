const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { BRAND, CATEGORIES } = require('./constants');
const { normalizeNfc, validateTitle } = require('./text');

const COVER_WIDTH = 1080;
const COVER_HEIGHT = 1920;

function escapeHtml(value = '') {
  return normalizeNfc(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function coverMeta(date, category) {
  const normalizedDate = String(date || '').replaceAll('-', '.');
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(normalizedDate)) {
    throw new Error('[DIEM Cover] date must be YYYY-MM-DD or YYYY.MM.DD');
  }
  if (!Object.values(CATEGORIES).includes(category)) {
    throw new Error('[DIEM Cover] category must be economy or issue');
  }
  return `${normalizedDate} | ${category === CATEGORIES.ECONOMY ? 'Economy' : 'Issue'}`;
}

function imageMime(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.gif') return 'image/gif';
  return 'image/jpeg';
}

function resolveImageData({ imagePath, imageDataUri } = {}) {
  if (typeof imageDataUri === 'string' && /^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(imageDataUri)) {
    return imageDataUri;
  }
  if (imagePath && fs.existsSync(imagePath)) {
    const buffer = fs.readFileSync(imagePath);
    if (buffer.length > 0) return `data:${imageMime(imagePath)};base64,${buffer.toString('base64')}`;
  }
  return '';
}

function buildCoverHtml({
  title,
  date,
  category,
  imageDataUri = '',
} = {}) {
  const titleText = Array.isArray(title) ? title.join('\n') : String(title || '');
  const validation = validateTitle(titleText);
  if (!validation.ok) throw new Error(`[DIEM Cover] ${validation.errors.join('; ')}`);
  const meta = coverMeta(date, category);
  const hasPhoto = /^data:image\//i.test(imageDataUri);
  const background = hasPhoto
    ? `<img class="background-photo" alt="" src="${escapeHtml(imageDataUri)}">`
    : '<div class="typography-backdrop" data-no-photo="true"></div>';
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${COVER_WIDTH}, initial-scale=1">
  <title>DIEM Cover</title>
  <link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.css" />
  <style>
    :root {
      --diem-bg: ${BRAND.colors.background};
      --diem-blue: ${BRAND.colors.blue};
      --diem-white: ${BRAND.colors.white};
      --diem-muted: ${BRAND.colors.muted};
    }
    * { box-sizing: border-box; }
    html, body { width: ${COVER_WIDTH}px; height: ${COVER_HEIGHT}px; margin: 0; overflow: hidden; }
    body { background: var(--diem-bg); font-family: Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; }
    .cover { position: relative; width: ${COVER_WIDTH}px; height: ${COVER_HEIGHT}px; overflow: hidden; background: var(--diem-bg); isolation: isolate; }
    .background-photo { position: absolute; inset: -28px; width: calc(100% + 56px); height: calc(100% + 56px); object-fit: cover; transform: scale(1.025); z-index: -4; }
    .typography-backdrop { position: absolute; inset: 0; z-index: -4; background:
      radial-gradient(circle at 77% 18%, rgba(77,124,254,.31), transparent 34%),
      linear-gradient(145deg, #101a31 0%, var(--diem-bg) 58%, #05070d 100%); }
    .shade { position: absolute; inset: 0; z-index: -3; background:
      linear-gradient(180deg, rgba(8,12,22,.45) 0%, rgba(8,12,22,.35) 35%, rgba(8,12,22,.88) 75%, rgba(8,12,22,.96) 100%),
      linear-gradient(90deg, rgba(8,12,22,.68), rgba(8,12,22,.15) 75%); }
    .grid { position: absolute; inset: 0; z-index: -2; opacity: .09; background-image:
      linear-gradient(rgba(247,249,252,.32) 1px, transparent 1px),
      linear-gradient(90deg, rgba(247,249,252,.24) 1px, transparent 1px);
      background-size: 120px 120px; mask-image: linear-gradient(to bottom, transparent 6%, #000 38%, transparent 92%); }
    .content { position: absolute; inset: 0; padding: 140px 92px 240px; display: flex; flex-direction: column; justify-content: flex-end; }
    .meta { color: #b8c6e2; font-size: 32px; line-height: 1; font-weight: 600; letter-spacing: .12em; white-space: nowrap; margin-bottom: 24px; text-shadow: 0 2px 10px rgba(0,0,0,0.8); }
    .title { margin: 0 0 36px 0; font-size: 118px; line-height: 1.05; font-weight: 900; letter-spacing: -.035em; text-shadow: 0 4px 24px rgba(0,0,0,0.85); }
    .title-line { display: block; width: max-content; max-width: 896px; white-space: nowrap; overflow: visible; }
    .title-line-1 { color: var(--diem-blue); }
    .title-line-2 { color: var(--diem-white); margin-top: 20px; }
    .brand { color: #ffffff; opacity: 0.95; font-size: 32px; font-weight: 600; letter-spacing: 0.05em; text-shadow: 0 2px 12px rgba(0,0,0,0.8); }
  </style>
</head>
<body>
  <main class="cover" data-cover="diem" data-has-photo="${hasPhoto}">
    ${background}
    <div class="shade"></div>
    <div class="grid"></div>
    <div class="content">
      <div class="meta" data-cover-meta>${escapeHtml(meta)}</div>
      <h1 class="title" aria-label="${escapeHtml(validation.lines.join(' '))}">
        <span class="title-line title-line-1" data-title-line="1">${escapeHtml(validation.lines[0])}</span>
        <span class="title-line title-line-2" data-title-line="2">${escapeHtml(validation.lines[1])}</span>
      </h1>
      <div class="brand" data-cover-brand>@diem.magazine</div>
    </div>
  </main>
</body>
</html>`;
}

function validateCoverLayout(layout = {}) {
  const errors = [];
  if (layout.width !== COVER_WIDTH || layout.height !== COVER_HEIGHT) errors.push('cover must be exactly 1080x1920');
  if (layout.lineCount !== 2) errors.push('cover must render exactly two explicit title lines');
  if (layout.firstLineColor !== 'rgb(77, 124, 254)') errors.push('first title line must use DIEM blue');
  if (layout.secondLineColor !== 'rgb(247, 249, 252)') errors.push('second title line must use DIEM white');
  if (layout.overflow) console.warn('[DIEM Cover] Warning: cover title or meta exceeds the text safe area');
  return { ok: errors.length === 0, errors };
}

async function renderDiemCover({
  editorial,
  title,
  date,
  category,
  imagePath,
  imageDataUri,
  outputPath = path.resolve('diem-cover.png'),
  chromiumImpl = chromium,
} = {}) {
  const titleValue = title || editorial?.title?.text || editorial?.title?.lines;
  const resolvedImage = resolveImageData({ imagePath, imageDataUri });
  const html = buildCoverHtml({
    title: titleValue,
    date,
    category: category || editorial?.category,
    imageDataUri: resolvedImage,
  });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const browser = await chromiumImpl.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: COVER_WIDTH, height: COVER_HEIGHT } });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const cover = document.querySelector('[data-cover]');
      const lines = [...document.querySelectorAll('[data-title-line]')];
      const meta = document.querySelector('[data-cover-meta]');
      const brand = document.querySelector('[data-cover-brand]');
      const coverRect = cover.getBoundingClientRect();
      const overflow = [...lines, meta, brand].filter(Boolean).some(node => {
        const rect = node.getBoundingClientRect();
        return node.scrollWidth > node.clientWidth + 1
          || rect.left < coverRect.left
          || rect.right > coverRect.right
          || rect.top < coverRect.top
          || rect.bottom > coverRect.bottom;
      });
      return {
        width: Math.round(coverRect.width),
        height: Math.round(coverRect.height),
        lineCount: lines.length,
        firstLineColor: getComputedStyle(lines[0]).color,
        secondLineColor: getComputedStyle(lines[1]).color,
        overflow,
      };
    });
    const validation = validateCoverLayout(layout);
    if (!validation.ok) throw new Error(`[DIEM Cover] ${validation.errors.join('; ')}`);
    await page.screenshot({ path: outputPath, type: 'png' });
    return { outputPath, usedPhoto: Boolean(resolvedImage), layout };
  } finally {
    await browser.close();
  }
}

module.exports = {
  COVER_HEIGHT,
  COVER_WIDTH,
  buildCoverHtml,
  coverMeta,
  escapeHtml,
  renderDiemCover,
  resolveImageData,
  validateCoverLayout,
};
