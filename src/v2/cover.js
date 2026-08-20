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

function coverMeta(date, category, contentType = 'hot_news', seriesNumber) {
  const normalizedDate = String(date || '').replaceAll('-', '.');
  if (!/^\d{4}\.\d{2}\.\d{2}$/.test(normalizedDate)) {
    throw new Error('[DIEM Cover] date must be YYYY-MM-DD or YYYY.MM.DD');
  }
  if (!Object.values(CATEGORIES).includes(category)) {
    throw new Error('[DIEM Cover] category must be economy or issue');
  }
  if (contentType === 'diem_basic') {
    const sequence = Number.isInteger(seriesNumber) && seriesNumber > 0
      ? ` | ${String(seriesNumber).padStart(2, '0')}`
      : '';
    return `DIEM Basic${sequence}`;
  }
  const label = category === CATEGORIES.ECONOMY ? 'Economy' : 'Issue';
  return `${normalizedDate} | ${label}`;
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

const TYPOGRAPHY_THEMES = new Set([
  'climate',
  'credit-score',
  'civic-advertising',
  'democratic-history',
  'fund-note',
  'health',
  'home-security',
  'housing',
  'legislation',
  'markets',
  'occupational-heat',
  'political-election',
  'political-meeting',
  'public-interest',
  'rate-reset',
  'tax-account',
  'technology',
  'weather-emergency',
  'work',
]);

function normalizedTypographyTheme(category, fallbackTheme = '') {
  if (TYPOGRAPHY_THEMES.has(fallbackTheme)) return fallbackTheme;
  return category === CATEGORIES.ECONOMY ? 'markets' : 'public-interest';
}

function typographyMotif(theme) {
  const motifs = {
    legislation: {
      id: 'assembly-document',
      body: `<path d="M170 410L430 250L690 410Z"/><path d="M205 430H655M225 690H635"/>
        <path d="M250 450V670M340 450V670M430 450V670M520 450V670M610 450V670"/>
        <rect x="625" y="170" width="285" height="390" rx="28"/><path d="M680 265H850M680 335H850M680 405H805"/>`,
    },
    'occupational-heat': {
      id: 'sun-rooftop-workers',
      body: `<circle cx="770" cy="270" r="112"/><path d="M770 82V24M770 516V458M582 270H524M1016 270H958M636 136L594 94M944 444L902 402M904 136L946 94"/>
        <path d="M92 730L315 555L505 675L695 510L970 730"/><path d="M178 790H910"/>
        <path d="M350 505C390 465 458 465 498 505M374 505V556M474 505V556"/>`,
    },
    markets: {
      id: 'market-candles',
      body: `<path d="M120 760L300 615L448 680L615 430L760 520L950 260"/>
        <path d="M220 290V640M190 380H250V535H190ZM420 265V610M390 340H450V485H390ZM700 195V500M670 260H730V410H670ZM870 120V390M840 180H900V310H840Z"/>`,
    },
    'tax-account': {
      id: 'account-ledger-tax-shield',
      body: `<rect x="140" y="190" width="520" height="570" rx="42"/><path d="M220 310H575M220 405H575M220 500H440"/>
        <path d="M760 265L925 325V500C925 620 855 700 760 745C665 700 595 620 595 500V325Z"/>
        <path d="M700 485H820M760 425V545"/>`,
    },
    'fund-note': {
      id: 'fund-basket-versus-note',
      body: `<path d="M120 360H505L455 720H180Z"/><path d="M195 360L265 235M430 360L360 235"/>
        <circle cx="250" cy="500" r="62"/><rect x="335" y="440" width="95" height="120" rx="20"/>
        <rect x="620" y="205" width="340" height="535" rx="34"/><path d="M690 330H885M690 430H885M690 530H835M690 635H790"/>`,
    },
    'rate-reset': {
      id: 'fixed-lock-and-reset-dial',
      body: `<rect x="130" y="420" width="330" height="300" rx="38"/><path d="M205 420V330C205 210 385 210 385 330V420"/>
        <circle cx="760" cy="470" r="235"/><path d="M760 235V305M760 635V705M525 470H595M925 470H995"/>
        <path d="M760 470L875 355M895 265L905 365L805 355"/>`,
    },
    'credit-score': {
      id: 'score-gauge-and-rate-steps',
      body: `<path d="M135 555A300 300 0 0 1 735 555"/><path d="M435 555L625 345"/><circle cx="435" cy="555" r="38"/>
        <path d="M650 760H945V650H855V540H765V430H675"/><path d="M170 705H430M170 790H525"/>`,
    },
    technology: {
      id: 'circuit-chip',
      body: `<rect x="300" y="210" width="480" height="480" rx="72"/><rect x="405" y="315" width="270" height="270" rx="34"/>
        <path d="M300 320H155M300 450H90M300 580H170M780 320H925M780 450H990M780 580H910M420 210V70M540 210V28M660 210V70M420 690V830M540 690V872M660 690V830"/>`,
    },
    housing: {
      id: 'city-homes',
      body: `<path d="M100 770H980M180 770V410L360 275L540 410V770M610 770V240H900V770"/>
        <path d="M260 510H340V590H260ZM405 510H485V590H405ZM680 330H750V410H680ZM790 330H860V410H790ZM680 475H750V555H680ZM790 475H860V555H790Z"/>`,
    },
    health: {
      id: 'health-pulse',
      body: `<path d="M105 515H315L385 350L505 690L590 460L650 515H975"/>
        <path d="M540 805C360 675 225 555 225 365C225 225 390 155 540 310C690 155 855 225 855 365C855 555 720 675 540 805Z"/>`,
    },
    climate: {
      id: 'climate-horizon',
      body: `<circle cx="790" cy="250" r="140"/><path d="M105 585C230 505 350 505 475 585S720 665 975 585M105 690C230 610 350 610 475 690S720 770 975 690"/>
        <path d="M215 380C280 310 375 315 425 390C500 310 620 330 645 430"/>`,
    },
    work: {
      id: 'people-work',
      body: `<circle cx="350" cy="310" r="92"/><circle cx="730" cy="310" r="92"/>
        <path d="M165 720C180 535 275 450 350 450S520 535 535 720M545 720C560 535 655 450 730 450S900 535 915 720"/>
        <rect x="400" y="600" width="280" height="205" rx="28"/>`,
    },
    'public-interest': {
      id: 'public-signal',
      body: `<circle cx="540" cy="410" r="225"/><circle cx="540" cy="410" r="130"/><circle cx="540" cy="410" r="34"/>
        <path d="M140 760H650M140 830H850M140 900H560"/>`,
    },
    'weather-emergency': {
      id: 'storm-rain-flood',
      body: `<path d="M210 385C240 260 395 220 480 315C545 205 740 225 775 370C890 375 940 455 910 555H175C120 465 145 395 210 385Z"/>
        <path d="M270 615L215 740M445 615L390 740M620 615L565 740M795 615L740 740"/>
        <path d="M115 835C250 770 365 770 500 835S750 900 965 835"/>`,
    },
    'home-security': {
      id: 'front-door-delivery',
      body: `<rect x="210" y="145" width="515" height="650" rx="24"/><path d="M285 795V245H650V795M575 500H615"/>
        <rect x="700" y="595" width="245" height="200" rx="20"/><path d="M700 660H945M822 595V795"/>
        <path d="M125 850H970"/>`,
    },
    'civic-advertising': {
      id: 'city-billboard',
      body: `<rect x="145" y="170" width="790" height="430" rx="34"/><path d="M205 245H875M205 500H650"/>
        <path d="M415 600V775M665 600V775M300 775H780"/>
        <path d="M215 860H865M290 810V910M790 810V910"/>`,
    },
    'political-election': {
      id: 'ballot-podium',
      body: `<rect x="175" y="505" width="730" height="315" rx="34"/><path d="M280 505L335 300H745L800 505"/>
        <rect x="380" y="160" width="320" height="235" rx="22"/><path d="M430 225H650M430 295H595"/>
        <path d="M330 650H750M410 730H670"/>`,
    },
    'political-meeting': {
      id: 'conference-table-podium',
      body: `<path d="M165 690L330 455H750L915 690Z"/><path d="M245 690V820M835 690V820M355 690V780M725 690V780"/>
        <rect x="415" y="175" width="250" height="225" rx="26"/><path d="M470 245H610M470 315H570"/>
        <path d="M255 520H355M725 520H825M540 455V400"/>`,
    },
    'democratic-history': {
      id: 'memorial-flower',
      body: `<path d="M540 755V325M540 420C430 360 355 285 370 175C480 175 540 245 540 355M540 500C650 440 725 365 710 255C600 255 540 325 540 435"/>
        <path d="M180 805H900M255 885H825"/><circle cx="540" cy="205" r="72"/>`,
    },
  };
  return motifs[theme] || motifs['public-interest'];
}

function typographyVariantDecoration(variant) {
  const decorations = [
    '<circle cx="150" cy="220" r="46"/><circle cx="920" cy="650" r="82"/><path d="M90 895H380"/>',
    '<path d="M120 120V420M190 80V360M890 610V910M960 545V845"/><circle cx="190" cy="80" r="9"/><circle cx="890" cy="910" r="9"/>',
    '<path d="M35 560L285 310M760 940L1030 670M70 680L250 500M850 820L1010 660"/>',
    '<rect x="70" y="110" width="220" height="145" rx="24"/><rect x="790" y="690" width="220" height="145" rx="24"/><path d="M180 255V345M900 600V690"/>',
  ];
  return decorations[Math.floor(variant / 2) % decorations.length];
}

function typographicBackdrop(category, {
  fallbackTheme,
  fallbackVariant = 0,
  visualFingerprint = '',
} = {}) {
  const theme = normalizedTypographyTheme(category, fallbackTheme);
  const variant = Math.max(0, Math.min(63, Number.parseInt(fallbackVariant, 10) || 0));
  const motif = typographyMotif(theme);
  const shiftX = ((variant % 8) - 3.5) * 18;
  const shiftY = ((Math.floor(variant / 8) % 8) - 3.5) * 12;
  const rotation = ((variant * 7) % 19) - 9;
  const lineWidth = 4 + (variant % 4);
  const mirrored = variant % 2 === 1;
  const scale = 0.9 + ((Math.floor(variant / 8) % 4) * 0.025);
  const motifTransform = mirrored ? 'translate(1080 0) scale(-1 1)' : '';
  const decoration = typographyVariantDecoration(variant);
  const fingerprint = visualFingerprint || `diem-art:${theme}:v${variant}`;
  const art = `<svg class="typography-art" data-typographic-art="${escapeHtml(theme)}" data-typographic-variant="${variant}" data-visual-fingerprint="${escapeHtml(fingerprint)}" data-art-motif="${motif.id}" viewBox="0 0 1080 1120" aria-hidden="true">
      <defs><linearGradient id="diem-art-glow" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4D7CFE" stop-opacity=".9"/><stop offset="1" stop-color="#6EE7F9" stop-opacity=".14"/></linearGradient></defs>
      <g transform="translate(${shiftX} ${shiftY}) rotate(${rotation} 540 480) scale(${scale})" fill="none" stroke="url(#diem-art-glow)" stroke-width="${lineWidth}" stroke-linecap="round" stroke-linejoin="round" opacity=".7">
        <g transform="${motifTransform}">${motif.body}</g>
        <g opacity=".26">${decoration}</g>
      </g>
    </svg>`;
  return `<div class="typography-backdrop typography-backdrop-${category}" data-no-photo="true">
    <div class="diem-watermark" data-diem-watermark>DIEM</div>
    ${art}
  </div>`;
}

function buildCoverHtml({
  title,
  date,
  category,
  contentType = 'hot_news',
  seriesNumber,
  imageDataUri = '',
  fallbackTheme,
  fallbackVariant = 0,
  visualFingerprint = '',
} = {}) {
  const titleText = Array.isArray(title) ? title.join('\n') : String(title || '');
  const validation = validateTitle(titleText);
  if (!validation.ok) throw new Error(`[DIEM Cover] ${validation.errors.join('; ')}`);
  const meta = coverMeta(date, category, contentType, seriesNumber);
  const hasPhoto = /^data:image\//i.test(imageDataUri);
  const background = hasPhoto
    ? `<img class="background-photo" alt="" src="${escapeHtml(imageDataUri)}">`
    : typographicBackdrop(category, { fallbackTheme, fallbackVariant, visualFingerprint });
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
    .typography-backdrop-economy { background: radial-gradient(circle at 68% 20%, rgba(77,124,254,.35), transparent 36%), linear-gradient(145deg, #0f1a33 0%, var(--diem-bg) 62%, #05070d 100%); }
    .typography-backdrop-issue { background: radial-gradient(circle at 72% 17%, rgba(77,124,254,.25), transparent 32%), linear-gradient(150deg, #111a2c 0%, var(--diem-bg) 60%, #05070d 100%); }
    .typography-art { position: absolute; left: 0; top: 40px; width: 1080px; height: 1120px; filter: drop-shadow(0 20px 60px rgba(14,38,94,.42)); }
    .diem-watermark { position: absolute; top: 110px; left: 74px; color: var(--diem-white); opacity: .07; font-size: 190px; line-height: 1; font-weight: 900; letter-spacing: -.055em; }
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
    .title-line { display: block; width: max-content; max-width: 896px; white-space: pre-wrap; word-break: keep-all; overflow: visible; }
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
  contentType,
  seriesNumber,
  imagePath,
  imageDataUri,
  fallbackTheme,
  fallbackVariant,
  visualFingerprint,
  outputPath = path.resolve('diem-cover.png'),
  chromiumImpl = chromium,
} = {}) {
  const titleValue = title || editorial?.title?.text || editorial?.title?.lines;
  const resolvedImage = resolveImageData({ imagePath, imageDataUri });
  const html = buildCoverHtml({
    title: titleValue,
    date,
    category: category || editorial?.category,
    contentType: contentType || editorial?.contentType || 'hot_news',
    seriesNumber,
    imageDataUri: resolvedImage,
    fallbackTheme,
    fallbackVariant,
    visualFingerprint,
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
      lines.forEach(line => {
        let fontSize = 118;
        while (line.getBoundingClientRect().height > fontSize * 1.2 && fontSize > 60) {
          fontSize -= 2;
          line.style.fontSize = `${fontSize}px`;
        }
      });
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
