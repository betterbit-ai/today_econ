#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadDataset, safeError } = require('../src/v2/editorial-comparison');
const { createDailyLedger, updatePublication, historyFromLedgers, listLedgers } = require('../src/v2/ledger');
const config = require('../config');
const { createGroqVisionReviewer } = require('../src/v2/groq');
const { preparePublication } = require('../src/v2/publisher');

async function main() {
  const output = path.resolve(process.env.CREATIVE_PREVIEW_OUTPUT || '.diem-cache/creative-preview');
  fs.mkdirSync(output, { recursive: true });
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  const history = historyFromLedgers(listLedgers(), date, 7, { includeReferenceDate: true });
  const selected = ['housing-opening', 'president-quote', 'court-documents'];
  const report = { publicationAllowed: false, runId: process.env.GITHUB_RUN_ID || 'local', sha: process.env.GITHUB_SHA || null, cases: [] };
  const secrets = ['CLAUDE_CODE_OAUTH_TOKEN', 'GROQ_API_KEY', 'PEXELS_API_KEY', 'UNSPLASH_ACCESS_KEY'].map(k => process.env[k]).filter(Boolean);
  for (const id of selected) {
    const item = loadDataset().cases.find(c => c.id === id);
    let ledger = createDailyLedger(date);
    ledger = updatePublication(ledger, item.article.category, { status: 'planned', candidate: item.article,
      publicationKey: `preview:${id}`, duplicateCheck: { signature: { target: item.article.target, event: item.article.event, entities: item.article.entities } } });
    const visualEvidence = [];
    const nativeReview = createGroqVisionReviewer({ apiKey: config.groqApiKey, model: config.groqVisionModel });
    const reviewImages = async request => {
      try {
        const verdict = await nativeReview(request);
        visualEvidence.push({ ids: request.images.map(i => i.id), ...verdict });
        return verdict;
      } catch (error) {
        visualEvidence.push({ ids: request.images.map(i => i.id), error: safeError(error, secrets) });
        throw error;
      }
    };
    try {
      const prepared = await preparePublication(ledger, item.article.category, { artifactRoot: path.join(output, id), history, reviewImages });
      const p = prepared.publications[item.article.category];
      const cover = id + '.png', reel = id + '.mp4';
      fs.copyFileSync(path.resolve(p.artifacts.coverPath), path.join(output, cover));
      fs.copyFileSync(path.resolve(p.artifacts.reelPath), path.join(output, reel));
      report.cases.push({ id, status: 'ready_preview_only', sourceHash: item.inputSha256, editorial: p.editorial,
        visualEvidence, image: p.image, audio: p.audio, creativeReview: p.creativeReview, cover, reel });
    } catch (error) { report.cases.push({ id, status: 'blocked', visualEvidence, error: safeError(error, secrets) }); }
    console.log(JSON.stringify({ id, status: report.cases.at(-1).status, visualReviews: visualEvidence.length }));
    // Preserve partial evidence if a later fixture times out; never write publication ledgers.
    let serialized = JSON.stringify(report, null, 2);
    for (const secret of secrets) serialized = serialized.split(secret).join('[REDACTED]');
    fs.writeFileSync(path.join(output, 'report.json'), serialized);
  }
  const e = s => String(s || '').replace(/[&<>"']/gu, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>DIEM 정합성 미리보기</title><style>body{max-width:1100px;margin:32px auto;padding:16px;font:16px/1.7 sans-serif;background:#f3f5f8}article{background:white;padding:24px;margin:20px 0;border-radius:12px}video{width:min(100%,320px)}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Opus 원고·이미지·음악 실제 미리보기</h1><p>발행 없음 · 고정 과거 기사 · 실제 원고/사진/음원 포함 · 차단된 사례도 그대로 표시합니다.</p>' + report.cases.map(c => '<article><h2>' + e(c.id) + ' · ' + e(c.status) + '</h2>' + (c.reel ? '<video controls preload="metadata" src="' + c.reel + '" poster="' + c.cover + '"></video><h3>' + e(c.editorial.title.text) + '</h3><pre>' + e(c.editorial.caption.text) + '</pre><p>이미지: ' + e(c.image.id) + ' · 음악: ' + e(c.audio.title || c.audio.trackId || c.audio.mode) + '</p><p>' + e(c.creativeReview.reason) + '</p>' : '<pre>' + e(c.error) + '</pre>') + '</article>').join(''));
  console.log(JSON.stringify({ runId: report.runId, cases: report.cases.map(c => ({ id: c.id, status: c.status })) }));
}
main().catch(() => { process.stderr.write('creative preview failed before completion; no publication attempted\n'); process.exitCode = 1; });
