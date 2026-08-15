const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { normalizeNfc } = require('./text');

const BASIC_CARD_WIDTH = 1080;
const BASIC_CARD_HEIGHT = 1920;
const BASIC_SCENE_ROLES = Object.freeze(['cover', 'definition', 'mechanism', 'caution', 'summary']);
const BASIC_SCENE_DURATIONS = Object.freeze([3, 4, 5, 4, 3]);
const BASIC_TOTAL_DURATION_SECONDS = 19;
const BASIC_AI_TELL_PATTERNS = Object.freeze([
  { pattern: /라는 말보다/u, label: 'translated contrast' },
  { pattern: /먼저 봅니다/u, label: 'editor stage direction' },
  { pattern: /살펴보겠습니다/u, label: 'editor stage direction' },
  { pattern: /정리해봅니다/u, label: 'editor stage direction' },
  { pattern: /오해부터 바로잡/u, label: 'editor stage direction' },
  { pattern: /핵심 구조를 이해/u, label: 'abstract editor explanation' },
  { pattern: /기억하세요/u, label: 'generic textbook command' },
  { pattern: /함께 보세요/u, label: 'generic textbook command' },
]);

function escapeHtml(value = '') {
  return normalizeNfc(String(value))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sceneTitleLines(title = '') {
  const lines = (Array.isArray(title) ? title : String(title).split('\n'))
    .map(line => normalizeNfc(String(line)).trim())
    .filter(Boolean);
  if (lines.length < 1 || lines.length > 2) return [];
  return lines;
}

function stripTerminalEmoji(value = '') {
  return normalizeNfc(String(value))
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]+$/gu, '')
    .trim();
}

function validateBasicKoreanVoice(values = [], { scope = 'copy' } = {}) {
  const errors = [];
  for (const [index, rawValue] of values.entries()) {
    const value = normalizeNfc(String(rawValue || '')).trim();
    if (!value) continue;
    for (const { pattern, label } of BASIC_AI_TELL_PATTERNS) {
      if (pattern.test(value)) errors.push(`${scope} ${index + 1} contains ${label}`);
    }
    if (!/요[.!?]?$/u.test(stripTerminalEmoji(value))) {
      errors.push(`${scope} ${index + 1} must use natural Korean 해요체`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function validateBasicLesson(lesson = {}, claimIds = new Set()) {
  const errors = [];
  const scenes = Array.isArray(lesson.scenes) ? lesson.scenes : [];
  if (scenes.length !== 5) errors.push('lesson must contain exactly five scenes');
  if (lesson.totalDurationSeconds !== BASIC_TOTAL_DURATION_SECONDS) {
    errors.push('lesson total duration must be 19 seconds');
  }
  scenes.forEach((scene, index) => {
    if (scene.role !== BASIC_SCENE_ROLES[index]) errors.push(`scene ${index + 1} role must be ${BASIC_SCENE_ROLES[index]}`);
    if (scene.durationSeconds !== BASIC_SCENE_DURATIONS[index]) {
      errors.push(`scene ${index + 1} duration must be ${BASIC_SCENE_DURATIONS[index]} seconds`);
    }
    if (!scene.label || !scene.body || sceneTitleLines(scene.title).length === 0) {
      errors.push(`scene ${index + 1} needs label, one or two title lines, and body`);
    }
    const mappedClaims = Array.isArray(scene.claimIds) ? scene.claimIds : [];
    if (index > 0 && mappedClaims.length === 0) errors.push(`scene ${index + 1} needs at least one claim mapping`);
    for (const claimId of mappedClaims) {
      if (!claimIds.has(claimId)) errors.push(`scene ${index + 1} references unknown claim ${claimId}`);
    }
  });
  const voice = validateBasicKoreanVoice(scenes.map(scene => scene.body), { scope: 'scene body' });
  errors.push(...voice.errors);
  const duration = scenes.reduce((sum, scene) => sum + Number(scene.durationSeconds || 0), 0);
  if (duration !== BASIC_TOTAL_DURATION_SECONDS) errors.push('scene durations must add up to 19 seconds');
  return { ok: errors.length === 0, errors };
}

function parseVisualItem(value = '') {
  const [label = '', detail = '', note = ''] = String(value).split('|').map(part => normalizeNfc(part.trim()));
  return { label, detail, note };
}

function visualBlock(visual = {}) {
  const type = visual.type || 'checklist';
  const items = (Array.isArray(visual.items) ? visual.items : []).map(parseVisualItem);
  if (!items.length) return '<div class="lesson-mark" aria-hidden="true"><span></span><span></span><span></span></div>';

  if (type === 'flow') {
    return `<div class="visual flow" data-basic-layout="flow">${items.map((item, index) => `
      <div class="flow-step"><b>${escapeHtml(item.label)}</b>${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}</div>
      ${index < items.length - 1 ? '<div class="flow-arrow" aria-hidden="true">→</div>' : ''}`).join('')}</div>`;
  }
  if (type === 'comparison') {
    return `<div class="visual comparison" data-basic-layout="comparison">${items.map((item, index) => `
      <div class="comparison-panel comparison-panel-${index + 1}"><span>${escapeHtml(item.label)}</span><b>${escapeHtml(item.detail)}</b>${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}</div>`).join('')}</div>`;
  }
  if (type === 'formula') {
    return `<div class="visual formula" data-basic-layout="formula">${items.map((item, index) => `
      <div class="formula-token"><span>${escapeHtml(item.label)}</span>${item.detail ? `<b>${escapeHtml(item.detail)}</b>` : ''}</div>
      ${index < items.length - 1 ? `<div class="formula-sign">${escapeHtml(visual.operators?.[index] || '+')}</div>` : ''}`).join('')}</div>`;
  }
  if (type === 'timeline') {
    return `<div class="visual timeline" data-basic-layout="timeline">${items.map(item => `
      <div class="timeline-step"><i></i><div><b>${escapeHtml(item.label)}</b>${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ''}</div></div>`).join('')}</div>`;
  }
  return `<div class="visual checklist" data-basic-layout="checklist">${items.map(item => `
    <div class="check-row"><i>✓</i><div><b>${escapeHtml(item.label)}</b>${item.detail ? `<span>${escapeHtml(item.detail)}</span>` : ''}</div></div>`).join('')}</div>`;
}

function buildBasicCardHtml({ item = {}, scene = {}, sceneIndex = 0 } = {}) {
  const titleLines = sceneTitleLines(scene.title);
  if (!titleLines.length) throw new Error('[DIEM Basic Card] title must contain one or two non-empty lines');
  const sequence = String(item.sequence || 0).padStart(2, '0');
  const page = String(sceneIndex + 1).padStart(2, '0');
  const role = scene.role || BASIC_SCENE_ROLES[sceneIndex] || 'definition';
  const titleHtml = titleLines.map((line, index) => `<span class="title-line title-line-${index + 1}">${escapeHtml(line)}</span>`).join('');
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${BASIC_CARD_WIDTH}, initial-scale=1">
  <title>DIEM Basic ${sequence} ${page}</title>
  <style>
    :root { --paper:#f5f0e6; --ink:#111827; --blue:#315efb; --mint:#24c68b; --soft:#ded7ca; --cream:#fffaf1; --red:#e85d4a; }
    * { box-sizing: border-box; }
    html, body { width:${BASIC_CARD_WIDTH}px; height:${BASIC_CARD_HEIGHT}px; margin:0; overflow:hidden; }
    body { font-family:Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; background:var(--paper); color:var(--ink); }
    .card { position:relative; width:${BASIC_CARD_WIDTH}px; height:${BASIC_CARD_HEIGHT}px; overflow:hidden; padding:78px 76px 72px; background:
      linear-gradient(rgba(49,94,251,.055) 1px, transparent 1px),
      linear-gradient(90deg, rgba(49,94,251,.055) 1px, transparent 1px),
      var(--paper); background-size:72px 72px; }
    .card::before { content:""; position:absolute; width:420px; height:420px; border-radius:50%; right:-170px; top:-160px; border:64px solid rgba(36,198,139,.13); }
    .card::after { content:""; position:absolute; width:310px; height:28px; right:76px; bottom:142px; background:var(--mint); opacity:.17; transform:rotate(-4deg); }
    .header { position:relative; z-index:2; display:flex; align-items:center; justify-content:space-between; }
    .series { display:flex; align-items:center; gap:18px; }
    .series-badge { background:var(--ink); color:#fff; border-radius:999px; padding:17px 27px 15px; font-size:29px; line-height:1; font-weight:900; letter-spacing:.08em; }
    .lesson-number { color:var(--blue); font-size:28px; font-weight:800; letter-spacing:.06em; }
    .page { font-size:27px; font-weight:800; letter-spacing:.08em; color:#6b7280; }
    .rule { height:5px; margin:31px 0 0; background:linear-gradient(90deg,var(--blue) 0 58%,var(--mint) 58% 72%,transparent 72%); }
    .content { position:relative; z-index:2; height:1504px; display:flex; flex-direction:column; }
    .lesson-copy { margin-top:${role === 'cover' ? '238px' : '118px'}; }
    .eyebrow { display:inline-flex; align-items:center; gap:12px; color:var(--blue); font-size:30px; font-weight:900; letter-spacing:.08em; }
    .eyebrow::before { content:""; width:18px; height:18px; border-radius:50%; background:var(--mint); box-shadow:0 0 0 8px rgba(36,198,139,.13); }
    h1 { margin:38px 0 0; font-size:${role === 'cover' ? '104px' : '82px'}; line-height:1.09; font-weight:950; letter-spacing:-.045em; word-break:keep-all; }
    .title-line { display:block; }
    .title-line-2 { color:var(--blue); margin-top:10px; }
    .body { max-width:850px; margin:42px 0 0; font-size:${role === 'cover' ? '45px' : '43px'}; line-height:1.48; font-weight:650; letter-spacing:-.02em; word-break:keep-all; }
    .visual-wrap { flex:1; display:flex; align-items:center; justify-content:center; min-height:430px; padding-top:52px; }
    .lesson-mark { width:640px; height:390px; position:relative; border:4px solid var(--ink); border-radius:52px; background:rgba(255,250,241,.72); transform:rotate(-2deg); box-shadow:24px 28px 0 rgba(49,94,251,.13); }
    .lesson-mark::before { content:"BASIC"; position:absolute; left:52px; top:50px; color:var(--blue); font-size:110px; font-weight:950; letter-spacing:-.06em; opacity:.14; }
    .lesson-mark span { position:absolute; left:72px; height:16px; border-radius:20px; background:var(--ink); opacity:.72; }
    .lesson-mark span:nth-child(1){top:205px;width:470px}.lesson-mark span:nth-child(2){top:260px;width:360px}.lesson-mark span:nth-child(3){top:315px;width:250px;background:var(--mint)}
    .visual { width:100%; border:4px solid var(--ink); border-radius:38px; background:rgba(255,250,241,.9); box-shadow:18px 20px 0 rgba(17,24,39,.09); }
    .flow { display:flex; align-items:center; justify-content:center; gap:18px; padding:55px 32px; }
    .flow-step { min-width:190px; padding:32px 22px; text-align:center; border:3px solid var(--ink); border-radius:24px; background:#fff; }
    .flow-step:last-of-type { background:var(--blue); color:#fff; border-color:var(--blue); }
    .flow-step b { display:block; font-size:39px; line-height:1.15; }
    .flow-step small { display:block; margin-top:12px; font-size:25px; line-height:1.25; }
    .flow-arrow { color:var(--mint); font-size:58px; font-weight:900; }
    .comparison { display:grid; grid-template-columns:repeat(2,1fr); gap:24px; padding:28px; }
    .comparison-panel { min-height:310px; padding:40px 34px; border-radius:27px; background:#fff; border:3px solid var(--soft); display:flex; flex-direction:column; justify-content:center; }
    .comparison-panel-2 { background:#e8fff5; border-color:var(--mint); }
    .comparison-panel span { font-size:31px; font-weight:850; color:var(--blue); }
    .comparison-panel b { margin-top:22px; font-size:54px; line-height:1.15; word-break:keep-all; }
    .comparison-panel small { margin-top:19px; font-size:27px; line-height:1.35; }
    .formula { min-height:310px; display:flex; align-items:center; justify-content:center; gap:10px; padding:45px 26px; }
    .formula-token { min-width:150px; min-height:150px; padding:28px 16px; border-radius:24px; background:#fff; border:3px solid var(--soft); text-align:center; display:flex; flex-direction:column; justify-content:center; }
    .formula-token span { font-size:26px; font-weight:800; color:#596174; }
    .formula-token b { margin-top:10px; font-size:39px; line-height:1.15; color:var(--blue); }
    .formula-sign { color:var(--mint); font-size:50px; font-weight:950; }
    .timeline { padding:38px 52px; }
    .timeline-step { position:relative; min-height:98px; display:flex; gap:27px; align-items:flex-start; }
    .timeline-step:not(:last-child)::before { content:""; position:absolute; left:14px; top:34px; bottom:-6px; width:4px; background:var(--soft); }
    .timeline-step i { position:relative; z-index:1; width:32px; height:32px; border-radius:50%; flex:none; background:var(--mint); border:7px solid var(--cream); box-shadow:0 0 0 3px var(--ink); }
    .timeline-step b { display:block; font-size:35px; }
    .timeline-step span { display:block; margin-top:7px; font-size:28px; line-height:1.3; }
    .checklist { padding:32px 42px; }
    .check-row { display:flex; align-items:center; gap:27px; min-height:96px; border-bottom:2px solid var(--soft); }
    .check-row:last-child { border-bottom:0; }
    .check-row i { width:48px; height:48px; display:grid; place-items:center; border-radius:50%; background:var(--mint); color:#fff; font-size:29px; font-style:normal; font-weight:900; }
    .check-row b { font-size:34px; }
    .check-row span { display:block; margin-top:5px; font-size:27px; color:#596174; }
    .footer { position:absolute; z-index:2; left:76px; right:76px; bottom:66px; display:flex; align-items:flex-end; justify-content:space-between; }
    .brand { font-size:29px; font-weight:850; letter-spacing:.03em; }
    .save-cue { display:${role === 'summary' ? 'flex' : 'none'}; align-items:center; gap:12px; padding:15px 21px; border-radius:999px; background:var(--ink); color:#fff; font-size:25px; font-weight:800; }
    .save-cue b { color:var(--mint); }
    .caution .eyebrow, .caution .title-line-2 { color:var(--red); }
    .caution .eyebrow::before { background:var(--red); box-shadow:0 0 0 8px rgba(232,93,74,.13); }
    .summary { background:
      linear-gradient(rgba(49,94,251,.055) 1px, transparent 1px),
      linear-gradient(90deg, rgba(49,94,251,.055) 1px, transparent 1px),
      linear-gradient(145deg,#f5f0e6 0%,#edf9f3 100%); background-size:72px 72px,72px 72px,auto; }
  </style>
</head>
<body>
  <main class="card ${escapeHtml(role)}" data-basic-card="true" data-basic-role="${escapeHtml(role)}">
    <header class="header"><div class="series"><span class="series-badge">DIEM BASIC</span><span class="lesson-number">경제기초 ${sequence}</span></div><span class="page">${page} / 05</span></header>
    <div class="rule"></div>
    <section class="content">
      <div class="lesson-copy"><div class="eyebrow">${escapeHtml(scene.label)}</div><h1>${titleHtml}</h1><p class="body">${escapeHtml(scene.body)}</p></div>
      <div class="visual-wrap">${visualBlock(scene.visual)}</div>
    </section>
    <footer class="footer"><span class="brand">@diem.magazine</span><span class="save-cue"><b>▣</b> 저장하고 다시 보기</span></footer>
  </main>
</body>
</html>`;
}

async function renderBasicLessonCards({ item, outputDirectory, chromiumImpl = chromium } = {}) {
  const claimIds = new Set((item.claims || []).map(claim => claim.id));
  const validation = validateBasicLesson(item.lesson, claimIds);
  if (!validation.ok) throw new Error(`[DIEM Basic Card] ${validation.errors.join('; ')}`);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const browser = await chromiumImpl.launch({ headless: true });
  const outputs = [];
  try {
    const page = await browser.newPage({ viewport: { width: BASIC_CARD_WIDTH, height: BASIC_CARD_HEIGHT } });
    for (let index = 0; index < item.lesson.scenes.length; index += 1) {
      const scene = item.lesson.scenes[index];
      await page.setContent(buildBasicCardHtml({ item, scene, sceneIndex: index }), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const layout = await page.evaluate(() => {
        const card = document.querySelector('[data-basic-card]');
        const nodes = [...document.querySelectorAll('h1, .body, .visual, .lesson-mark, .header, .footer')];
        const cardRect = card.getBoundingClientRect();
        const offenders = nodes.filter(node => {
          const rect = node.getBoundingClientRect();
          return node.scrollWidth > node.clientWidth + 1
            || rect.left < cardRect.left || rect.right > cardRect.right
            || rect.top < cardRect.top || rect.bottom > cardRect.bottom;
        }).map(node => ({
          className: node.className,
          scrollWidth: node.scrollWidth,
          clientWidth: node.clientWidth,
          scrollHeight: node.scrollHeight,
          clientHeight: node.clientHeight,
          rect: { left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom },
        }));
        return {
          width: Math.round(cardRect.width),
          height: Math.round(cardRect.height),
          overflow: offenders.length > 0,
          offenders,
        };
      });
      if (layout.width !== BASIC_CARD_WIDTH || layout.height !== BASIC_CARD_HEIGHT || layout.overflow) {
        throw new Error(`[DIEM Basic Card] scene ${index + 1} violates 1080x1920 safe layout: ${JSON.stringify(layout.offenders)}`);
      }
      const outputPath = path.join(outputDirectory, `card-${String(index + 1).padStart(2, '0')}.png`);
      await page.screenshot({ path: outputPath, type: 'png' });
      outputs.push({ path: outputPath, role: scene.role, durationSeconds: scene.durationSeconds });
    }
  } finally {
    await browser.close();
  }
  return outputs;
}

module.exports = {
  BASIC_CARD_HEIGHT,
  BASIC_CARD_WIDTH,
  BASIC_SCENE_DURATIONS,
  BASIC_SCENE_ROLES,
  BASIC_TOTAL_DURATION_SECONDS,
  buildBasicCardHtml,
  renderBasicLessonCards,
  validateBasicKoreanVoice,
  validateBasicLesson,
};
