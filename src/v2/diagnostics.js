const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Groq = require('groq-sdk');
const config = require('../../config');
const { instagramRequest, sanitizeInstagramErrorMessage } = require('../instagram');
const { resolveInstagramToken } = require('../token-vault');
const { instagramErrorDisposition, serializeInstagramError } = require('./instagram');
const { assertVisionModelAvailable, classifyVisionError, createGroqVisionReviewer } = require('./groq');

const SHADOW_IDS = Object.freeze(['finance-01', 'finance-02']);

function loadShadowImages(assetRoot = path.join(process.cwd(), 'assets', 'fallback', 'generated')) {
  const root = path.resolve(assetRoot);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  return SHADOW_IDS.map(id => {
    const asset = manifest.assets?.find(item => item.id === id);
    if (!asset) throw new Error('[DIEM Diagnose] shadow asset is missing: ' + id);
    const file = path.resolve(root, asset.file);
    if (path.dirname(file) !== root) throw new Error('[DIEM Diagnose] shadow asset path escapes library');
    const bytes = fs.readFileSync(file);
    if (bytes.length < 1 || bytes.length > 8 * 1024 * 1024) throw new Error('[DIEM Diagnose] shadow asset size invalid');
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new Error('[DIEM Diagnose] shadow asset hash mismatch: ' + id);
    }
    return { id, reviewUrl: 'data:image/png;base64,' + bytes.toString('base64') };
  });
}

async function diagnoseDiem({
  settings = config,
  assetRoot,
  runId = process.env.GITHUB_RUN_ID || crypto.randomUUID(),
  now = new Date(),
  intervalMs = 65_000,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
  resolveTokenImpl = resolveInstagramToken,
  instagramRequestImpl = instagramRequest,
  createClientImpl = apiKey => new Groq({ apiKey, timeout: 30_000, maxRetries: 0 }),
  verifyModelImpl = assertVisionModelAvailable,
  createReviewerImpl = createGroqVisionReviewer,
} = {}) {
  const report = {
    schemaVersion: 1, readOnly: true, runId: String(runId), collectedAt: now.toISOString(),
    githubSha: process.env.GITHUB_SHA || null,
    instagram: { status: 'unavailable' },
    model: { status: 'unavailable', id: settings.groqVisionModel },
    vision: { probeType: 'project_owned_fixture', consecutiveSuccesses: 0, successfulRunIds: [], runs: [] },
  };
  let token;
  const secrets = [settings.groqApiKey, settings.instagramAccessToken, settings.instagramTokenEncryptionKey];
  const safeMessage = error => sanitizeInstagramErrorMessage(error.message || String(error), { secrets });
  try {
    token = resolveTokenImpl();
    secrets.push(token);
    if (!settings.instagramUserId) throw new Error('[DIEM Diagnose] INSTAGRAM_USER_ID is unavailable');
    const account = await instagramRequestImpl({
      path: settings.instagramUserId, token, version: settings.instagramApiVersion,
      method: 'GET', params: { fields: 'id,username,media_count' },
    });
    if (String(account.id) !== String(settings.instagramUserId)) throw new Error('[DIEM Diagnose] connected account mismatch');
    report.instagram = { status: 'ok', accountId: String(account.id), username: account.username || null };
  } catch (error) {
    report.instagram = {
      status: 'failed', message: safeMessage(error),
      disposition: instagramErrorDisposition(error),
      errorDetails: serializeInstagramError(error, { secrets }),
    };
  }

  let client;
  try {
    if (!settings.groqApiKey) throw new Error('[DIEM Diagnose] GROQ_API_KEY is unavailable');
    client = createClientImpl(settings.groqApiKey);
    await verifyModelImpl(client, settings.groqVisionModel);
    report.model.status = 'ok';
  } catch (error) {
    report.model = { ...report.model, status: 'failed', reason: classifyVisionError(error), message: safeMessage(error) };
  }
  if (report.model.status === 'ok') {
    try {
      const images = loadShadowImages(assetRoot);
      const reviewer = createReviewerImpl({ client, model: settings.groqVisionModel });
      // A diagnostic fixture, never a news candidate or evidence of an actual event.
      const candidate = {
        title: '생활비 예산과 가계 지출 관리',
        summary: '개인 예산 기록에 사용하는 계산기, 빈 재무 문서와 동전의 상징적 이미지.',
        newsFrame: { subject: '생활비 예산', eventKind: 'household_cost', eventLabel: '예산 기록과 지출 관리' },
      };
      for (let index = 0; index < 5; index += 1) {
        if (index > 0 && intervalMs > 0) await sleepImpl(intervalMs);
        const id = String(runId) + ':vision:' + (index + 1);
        const collectedAt = new Date().toISOString();
        try {
          const review = await reviewer({ candidate, query: 'personal budgeting documents calculator coins', images });
          const passed = review.ok === true && images.some(image => image.id === review.selectedId);
          report.vision.runs.push({
            id, collectedAt, status: passed ? 'ok' : 'rejected',
            selectedId: passed ? review.selectedId : null,
            reason: sanitizeInstagramErrorMessage(review.reason || '', { secrets }),
          });
          if (passed) {
            report.vision.consecutiveSuccesses += 1;
            report.vision.successfulRunIds.push(id);
          } else report.vision.consecutiveSuccesses = 0;
        } catch (error) {
          report.vision.runs.push({ id, collectedAt, status: 'failed', reason: classifyVisionError(error), message: safeMessage(error) });
          report.vision.consecutiveSuccesses = 0;
          // Avoid repeatedly calling a model or transport that is already broken.
          break;
        }
      }
    } catch (error) {
      report.vision.message = safeMessage(error);
    }
  }
  report.status = report.instagram.status === 'ok' && report.model.status === 'ok'
    && report.vision.consecutiveSuccesses === 5 ? 'ok' : 'failed';
  return report;
}

module.exports = { diagnoseDiem, loadShadowImages };
