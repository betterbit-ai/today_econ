const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { CATEGORIES } = require('./constants');
const { normalizeNfc } = require('./text');

const CARD_WIDTH = 1080;
const CARD_HEIGHT = 1920;
const CARD_STYLES = Object.freeze(['diem-dark', 'bright-magazine']);
const CARD_ROLES = Object.freeze(['hook', 'stat', 'list', 'cta']);

// Instagram keeps the lower fifth of a Reel under the caption and action rail, so copy stays
// inside a fixed safe area. The measured limits below are used for the overflow gate.
const SAFE = Object.freeze({ top: 150, bottom: 1560, left: 88, right: 992 });

const FONT_STACK = 'Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif';

function escapeHtml(value = '') {
  return normalizeNfc(String(value))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lines(value = '') {
  return String(value)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function metaLabel(date, category) {
  const normalized = String(date || '').replaceAll('-', '.');
  if (!/^\d{4}\.\d{2}\.\d{2}$/u.test(normalized)) throw new Error('[DIEM Cards] date must be YYYY-MM-DD');
  if (!Object.values(CATEGORIES).includes(category)) throw new Error('[DIEM Cards] category must be economy or issue');
  return `${normalized} · ${category === CATEGORIES.ECONOMY ? 'ECONOMY' : 'ISSUE'}`;
}

function progressMarkup(index, total) {
  const segments = Array.from({ length: total }, (_, position) => (
    `<span class="seg${position === index ? ' seg-on' : position < index ? ' seg-past' : ''}"></span>`
  )).join('');
  return `<div class="progress" data-progress="${index + 1}/${total}">${segments}</div>`;
}

function titleMarkup(card, className = '') {
  if (!card.title) return '';
  return `<h1 class="title ${className}" data-fit-title>${lines(card.title)
    .map(line => `<span class="title-line">${escapeHtml(line)}</span>`)
    .join('')}</h1>`;
}

function cardBody(card) {
  const kicker = card.kicker ? `<div class="kicker">${escapeHtml(card.kicker)}</div>` : '<div class="kicker kicker-empty"></div>';
  const sub = card.sub ? `<p class="sub">${escapeHtml(card.sub)}</p>` : '';
  let main = '';
  switch (card.role) {
    case 'hook':
      main = [titleMarkup(card, 'title-hook'), sub].join('');
      break;
    case 'stat': {
      const bullets = (card.bullets || []).map(bullet => `<li>${escapeHtml(bullet)}</li>`).join('');
      main = [
        `<div class="stat" data-stat><span class="stat-value" data-fit-value>${escapeHtml(card.value || '')}</span>${
          card.valueLabel ? `<span class="stat-label">${escapeHtml(card.valueLabel)}</span>` : ''
        }</div>`,
        titleMarkup(card, 'title-support'),
        bullets ? `<ul class="bullets">${bullets}</ul>` : '',
      ].join('');
      break;
    }
    case 'list': {
      const rows = (card.rows || []).map(row => `
        <li class="row">
          <span class="row-label">${escapeHtml(row.label || '')}</span>
          <span class="row-value" data-fit-row>${escapeHtml(row.value || '')}</span>
          ${row.note ? `<span class="row-note">${escapeHtml(row.note)}</span>` : ''}
        </li>`).join('');
      main = [titleMarkup(card, 'title-support'), `<ul class="rows">${rows}</ul>`, sub].join('');
      break;
    }
    case 'cta':
      main = [titleMarkup(card, 'title-cta'), sub, '<div class="save-chip">저장 SAVE</div>'].join('');
      break;
    default:
      throw new Error(`[DIEM Cards] Unsupported card role: ${card.role}`);
  }
  return { kicker, main };
}

function styleSheet(style, accent) {
  if (style === 'bright-magazine') {
    return `
      body { background: #f2ece0; color: #0e0f12; }
      .backdrop { position: absolute; inset: 0; background: linear-gradient(180deg, #fbf8f0 0%, #f4eee1 54%, #ece4d2 100%); }
      .backdrop::after { content: ''; position: absolute; inset: 0; opacity: .45; background-image:
        repeating-linear-gradient(0deg, rgba(14,15,18,.04) 0 1px, transparent 1px 8px); }
      .grid { position: absolute; inset: 0; opacity: .55; background-image:
        linear-gradient(rgba(14,15,18,.055) 1px, transparent 1px),
        linear-gradient(90deg, rgba(14,15,18,.045) 1px, transparent 1px);
        background-size: 96px 96px; mask-image: linear-gradient(to bottom, #000 0%, transparent 46%); }
      .band { position: absolute; left: 0; right: 0; top: 0; height: 300px; background: ${accent};
        border-bottom: 6px solid #0e0f12; }
      .brandrow { position: absolute; left: ${SAFE.left}px; top: 112px; z-index: 4; display: flex; align-items: center; gap: 20px; }
      .brandmark { background: #0e0f12; color: #fdfaf2; font-size: 34px; font-weight: 900; letter-spacing: .2em; padding: 14px 20px 12px; }
      .brandsub { font-size: 26px; font-weight: 800; letter-spacing: .18em; color: #0e0f12; }
      .cutnum { position: absolute; right: ${CARD_WIDTH - SAFE.right}px; top: 150px; z-index: 4;
        font-size: 168px; font-weight: 900; line-height: .82; letter-spacing: -.07em; color: #0e0f12; opacity: .2; }
      .seg { background: rgba(14,15,18,.18); }
      .seg-on { background: #0e0f12; }
      .seg-past { background: rgba(14,15,18,.45); }
      .panel { position: absolute; left: 72px; right: 72px; top: 470px; bottom: 356px; background: #fffdf7;
        border: 6px solid #0e0f12; box-shadow: 18px 18px 0 ${accent}; z-index: 2; }
      .content { position: absolute; left: 72px; right: 72px; top: 470px; bottom: 356px; z-index: 3;
        padding: 58px 62px 96px; display: flex; flex-direction: column; justify-content: space-between; }
      .kicker { align-self: flex-start; background: ${accent}; color: #0e0f12; font-size: 30px; font-weight: 900;
        letter-spacing: .1em; padding: 14px 22px 11px; border: 4px solid #0e0f12; text-transform: uppercase; }
      .title { color: #0e0f12; }
      .title-line:first-child { color: ${accent}; }
      .sub { color: #34383f; }
      .stat-value { color: #0e0f12; }
      .stat-label { background: ${accent}; color: #0e0f12; border: 4px solid #0e0f12; }
      .bullets li { color: #1b1f26; }
      .bullets li::before { background: ${accent}; border: 3px solid #0e0f12; width: 22px; height: 22px; top: 13px; }
      .rows { border: 5px solid #0e0f12; background: #f7f1e3; }
      .row { border-top: 4px solid #0e0f12; padding: 28px 30px; }
      .row:first-child { border-top: none; }
      .row-label { color: #3c414a; }
      .row-value { color: #0e0f12; }
      .row-note { color: #55595f; }
      .save-chip { color: #fdfaf2; background: #0e0f12; }
      .footer { background: #0e0f12; height: 118px; }
      .footer-meta { color: #fdfaf2; }
      .footer-handle { color: ${accent}; }
    `;
  }
  return `
    body { background: #05070d; color: #f7f9fc; }
    .backdrop { position: absolute; inset: 0; background:
      radial-gradient(1000px 720px at 82% 6%, ${accent}3d, transparent 60%),
      radial-gradient(760px 620px at 4% 82%, #4d7cfe26, transparent 66%),
      linear-gradient(162deg, #0f1930 0%, #080c16 52%, #04060b 100%); }
    .grid { position: absolute; inset: 0; opacity: .08; background-image:
      linear-gradient(rgba(247,249,252,.4) 1px, transparent 1px),
      linear-gradient(90deg, rgba(247,249,252,.3) 1px, transparent 1px);
      background-size: 120px 120px; mask-image: linear-gradient(to bottom, transparent 2%, #000 26%, #000 76%, transparent 98%); }
    .band { display: none; }
    .brandrow { position: absolute; left: ${SAFE.left}px; top: 116px; display: flex; align-items: center; gap: 18px; z-index: 3; }
    .brandmark { font-size: 30px; font-weight: 900; letter-spacing: .34em; color: rgba(247,249,252,.55); }
    .brandsub { display: none; }
    .cutnum { position: absolute; right: 62px; top: 176px; z-index: 2;
      font-size: 320px; font-weight: 900; line-height: .8; letter-spacing: -.08em; color: #f7f9fc; opacity: .085; }
    .seg { background: rgba(247,249,252,.18); }
    .seg-on { background: ${accent}; }
    .seg-past { background: rgba(247,249,252,.5); }
    .panel { display: none; }
    .content { position: absolute; left: ${SAFE.left}px; right: ${CARD_WIDTH - SAFE.right}px; top: ${SAFE.top}px; bottom: ${CARD_HEIGHT - SAFE.bottom}px; z-index: 3;
      display: flex; flex-direction: column; justify-content: center; padding: 4px 0 120px; }
    .main > .kicker:not(.kicker-empty) { margin-bottom: 34px; }
    .kicker { align-self: flex-start; color: ${accent}; font-size: 30px; font-weight: 800; letter-spacing: .2em;
      padding-left: 20px; border-left: 6px solid ${accent}; text-transform: uppercase; }
    .title { color: #f7f9fc; }
    .title-line:first-child { color: ${accent}; }
    .sub { color: #b8c6e2; }
    .stat-value { color: ${accent}; }
    .stat-label { color: #f7f9fc; }
    .bullets li { color: #dbe4f6; }
    .bullets li::before { background: ${accent}; width: 18px; height: 18px; top: 15px; }
    .rows { border-top: 2px solid rgba(247,249,252,.22); }
    .row { border-bottom: 1px solid rgba(247,249,252,.16); padding: 28px 0; }
    .row-label { color: #93a6c8; }
    .row-value { color: #f7f9fc; }
    .row-note { color: #8fa2c4; }
    .save-chip { color: #05070d; background: ${accent}; }
    .footer { background: transparent; height: 128px; }
    .footer-meta { color: #7f92b6; }
    .footer-handle { color: #f7f9fc; }
  `;
}

function buildCardHtml({
  card = {},
  style = 'diem-dark',
  accent = '#4d7cfe',
  date,
  category,
  index = 0,
  total = 4,
} = {}) {
  if (!CARD_STYLES.includes(style)) throw new Error(`[DIEM Cards] Unsupported style: ${style}`);
  if (!CARD_ROLES.includes(card.role)) throw new Error(`[DIEM Cards] Unsupported card role: ${card.role}`);
  const cut = String(index + 1).padStart(2, '0');
  const body = cardBody(card);
  // The dark poster stacks the label directly above the statement; the bright magazine keeps it
  // pinned to the top of its framed panel.
  const contentMarkup = style === 'bright-magazine'
    ? `<div class="top">${body.kicker}</div><div class="main" data-card-main>${body.main}</div>`
    : `<div class="main" data-card-main>${body.kicker}${body.main}</div>`;
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${CARD_WIDTH}, initial-scale=1">
  <title>DIEM Card</title>
  <link rel="stylesheet" as="style" crossorigin href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.css" />
  <style>
    * { box-sizing: border-box; }
    html, body { width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; margin: 0; overflow: hidden; }
    body { font-family: ${FONT_STACK}; -webkit-font-smoothing: antialiased; font-feature-settings: "tnum" on; }
    .card { position: relative; width: ${CARD_WIDTH}px; height: ${CARD_HEIGHT}px; overflow: hidden; isolation: isolate; }
    .progress { position: absolute; top: 94px; left: ${SAFE.left}px; right: ${CARD_WIDTH - SAFE.right}px; display: flex; gap: 12px; z-index: 5; }
    .seg { display: block; flex: 1; height: 8px; border-radius: 4px; }
    .title { margin: 0; font-weight: 900; letter-spacing: -.045em; line-height: 1.05; word-break: keep-all; }
    .title-line { display: block; }
    .title-line + .title-line { margin-top: 12px; }
    .title-hook { font-size: 132px; }
    .title-support { font-size: 78px; line-height: 1.16; margin-top: 34px; }
    .title-cta { font-size: 112px; }
    .top { width: 100%; display: flex; flex-direction: column; align-items: flex-start; }
    .main { width: 100%; }
    .kicker-empty { display: none; }
    .sub { margin: 34px 0 0; font-size: 40px; line-height: 1.44; font-weight: 650; letter-spacing: -.02em; word-break: keep-all; }
    .stat { display: flex; flex-direction: column; align-items: flex-start; }
    .stat-value { font-size: 196px; font-weight: 900; line-height: .96; letter-spacing: -.055em; word-break: keep-all; }
    .stat-label { margin-top: 26px; font-size: 40px; font-weight: 800; letter-spacing: -.02em; padding: 10px 20px; }
    .bullets { margin: 40px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 22px; }
    .bullets li { position: relative; padding-left: 44px; font-size: 40px; font-weight: 650; line-height: 1.4; letter-spacing: -.02em; word-break: keep-all; }
    .bullets li::before { content: ''; position: absolute; left: 0; border-radius: 50%; }
    .rows { margin: 0; padding: 0; list-style: none; }
    .row { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 6px 24px; }
    .row-label { font-size: 36px; font-weight: 700; letter-spacing: -.01em; }
    .row-value { font-size: 58px; font-weight: 900; letter-spacing: -.035em; white-space: nowrap; }
    .row-note { grid-column: 1 / -1; font-size: 29px; font-weight: 600; line-height: 1.3; }
    .save-chip { margin-top: 54px; width: fit-content; max-width: 100%; font-size: 32px; font-weight: 900; letter-spacing: .14em; padding: 22px 38px; border-radius: 999px; }
    .footer { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center;
      justify-content: space-between; padding: 0 ${SAFE.left}px; z-index: 5; }
    .footer-meta { font-size: 26px; font-weight: 700; letter-spacing: .16em; }
    .footer-handle { font-size: 28px; font-weight: 800; letter-spacing: .03em; }
    ${styleSheet(style, accent)}
  </style>
</head>
<body>
  <main class="card" data-card="diem" data-card-style="${style}" data-card-role="${card.role}" data-card-index="${index + 1}">
    <div class="backdrop"></div>
    <div class="grid"></div>
    <div class="band"></div>
    <div class="brandrow"><span class="brandmark">DIEM</span><span class="brandsub">MAGAZINE · ${escapeHtml(metaLabel(date, category))}</span></div>
    <div class="cutnum">${cut}</div>
    ${progressMarkup(index, total)}
    <div class="panel"></div>
    <section class="content" data-card-content>${contentMarkup}</section>
    <div class="footer" data-card-footer><span class="footer-meta">${escapeHtml(metaLabel(date, category))}</span><span class="footer-handle">@diem.magazine</span></div>
  </main>
</body>
</html>`;
}

function fitContent(page) {
  return page.evaluate(() => {
    const safeTop = 150;
    const safeBottom = 1560;
    const safeLeft = 88;
    const safeRight = 992;
    const content = document.querySelector('[data-card-content]');
    const style = getComputedStyle(content);
    const innerLeft = content.getBoundingClientRect().left + parseFloat(style.paddingLeft) - 4;
    const innerRight = content.getBoundingClientRect().right - parseFloat(style.paddingRight) + 4;

    const shrink = (node, minSize, step, { width = true } = {}) => {
      if (!node) return;
      let size = parseFloat(getComputedStyle(node).fontSize);
      const overflows = () => {
        const rect = node.getBoundingClientRect();
        if (width && (rect.right > Math.max(innerRight, safeRight + 1) || rect.left < Math.min(innerLeft, safeLeft - 1))) return true;
        return node.scrollWidth > node.clientWidth + 2;
      };
      let guard = 0;
      while (overflows() && size > minSize && guard < 80) {
        size -= step;
        node.style.fontSize = `${size}px`;
        guard += 1;
      }
    };

    document.querySelectorAll('[data-fit-title]').forEach(title => {
      const original = parseFloat(getComputedStyle(title).fontSize);
      let size = original;
      let guard = 0;
      while (size > original * 0.5 && guard < 90) {
        title.style.fontSize = `${size}px`;
        const tooWide = [...title.querySelectorAll('.title-line')]
          .some(line => line.getBoundingClientRect().width > (innerRight - innerLeft) + 1);
        const tooTall = title.getBoundingClientRect().bottom > safeBottom;
        if (!tooWide && !tooTall) break;
        size -= 4;
        guard += 1;
      }
    });
    document.querySelectorAll('[data-fit-value]').forEach(node => shrink(node, 110, 6));
    document.querySelectorAll('[data-fit-row]').forEach(node => shrink(node, 34, 3));

    const blocks = [...document.querySelectorAll('.title-line, .stat-value, .stat-label, .sub, .bullets li, .row, .save-chip, .kicker')];
    const contentRect = content.getBoundingClientRect();
    return {
      horizontalOverflow: blocks.some(node => {
        const box = node.getBoundingClientRect();
        return box.right > safeRight + 2 || box.left < safeLeft - 2;
      }),
      verticalOverflow: blocks.some(node => {
        const box = node.getBoundingClientRect();
        return box.top < safeTop - 2 || box.bottom > safeBottom + 2;
      }),
      contentTop: Math.round(contentRect.top),
      contentBottom: Math.round(contentRect.bottom),
      titleSizes: [...document.querySelectorAll('[data-fit-title]')].map(node => Math.round(parseFloat(getComputedStyle(node).fontSize))),
    };
  });
}

async function renderDiemCards({
  cards = [],
  style = 'diem-dark',
  accent,
  date,
  category,
  outputDir,
  chromiumImpl = chromium,
} = {}) {
  if (!Array.isArray(cards) || cards.length < 3 || cards.length > 4) {
    throw new Error('[DIEM Cards] A multi-cut Reel requires three or four cards.');
  }
  if (!CARD_STYLES.includes(style)) throw new Error(`[DIEM Cards] Unsupported style: ${style}`);
  fs.mkdirSync(outputDir, { recursive: true });
  const browser = await chromiumImpl.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: CARD_WIDTH, height: CARD_HEIGHT } });
    const paths = [];
    for (let index = 0; index < cards.length; index += 1) {
      const html = buildCardHtml({
        card: cards[index],
        style,
        accent: accent || (style === 'bright-magazine' ? '#ff4b2b' : '#4d7cfe'),
        date,
        category,
        index,
        total: cards.length,
      });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const layout = await fitContent(page);
      if (layout.horizontalOverflow || layout.verticalOverflow) {
        throw new Error(`[DIEM Cards] Card ${index + 1} exceeds the text safe area.`);
      }
      const outputPath = path.join(outputDir, `card-${index + 1}.png`);
      await page.screenshot({ path: outputPath, type: 'png' });
      paths.push(outputPath);
    }
    return paths;
  } finally {
    await browser.close();
  }
}

module.exports = {
  CARD_HEIGHT,
  CARD_ROLES,
  CARD_STYLES,
  CARD_WIDTH,
  SAFE,
  buildCardHtml,
  renderDiemCards,
};
