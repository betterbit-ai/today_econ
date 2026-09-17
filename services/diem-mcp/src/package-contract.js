const crypto = require('crypto');

const DAILY_PACKAGE_SCHEMA_VERSION = 1;
const MAX_EVIDENCE_CHARS = 12_000;

function normalizeNfc(value = '') {
  return String(value || '').normalize('NFC');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function packageContentShape(item = {}) {
  const clean = structuredClone(item);
  delete clean._file;
  delete clean._directory;
  delete clean.integrity;
  return clean;
}

function dailyPackageContentHash(item = {}) {
  return sha256(JSON.stringify(packageContentShape(item)).normalize('NFC'));
}

function isSafeId(value) {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(String(value || ''));
}

function validDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function normalizeEvidence(value = '') {
  return normalizeNfc(value).replace(/\s+/gu, ' ').trim();
}

function validateSubmissionPackage(item = {}, { now = new Date() } = {}) {
  const errors = [];
  if (item.schemaVersion !== DAILY_PACKAGE_SCHEMA_VERSION) errors.push('schemaVersion must be 1');
  if (!isSafeId(item.packageId)) errors.push('packageId is invalid');
  if (!isSafeId(item.runId)) errors.push('runId is invalid');
  if (item.status !== 'ready') errors.push('package status must be ready');
  if (!['economy', 'issue'].includes(item.category)) errors.push('category must be economy or issue');

  const expiresAt = validDate(item.expiresAt);
  if (!expiresAt || expiresAt.getTime() <= now.getTime()) errors.push('package expiry must be in the future');
  if (!validDate(item.createdAt)) errors.push('createdAt must be a valid ISO timestamp');

  const source = item.source || {};
  const evidence = normalizeEvidence(source.evidenceText);
  if (!source.title || !/^https:\/\//u.test(source.url || '')) errors.push('source title and HTTPS URL are required');
  if (evidence.length < 80 || evidence.length > MAX_EVIDENCE_CHARS) errors.push('source evidenceText must contain 80-12000 characters');
  if (!/^[a-f0-9]{64}$/u.test(source.evidenceSha256 || '') || source.evidenceSha256 !== sha256(evidence)) {
    errors.push('source evidence hash mismatch');
  }

  const claims = Array.isArray(item.claims) ? item.claims : [];
  const claimIds = new Set();
  if (claims.length < 1 || claims.length > 8) errors.push('package needs 1-8 grounded claims');
  for (const claim of claims) {
    if (!isSafeId(claim?.id) || claimIds.has(claim.id)) errors.push('claim IDs must be safe and unique');
    claimIds.add(claim?.id);
    if (!normalizeNfc(claim?.text).trim()) errors.push(`claim ${claim?.id || '(missing)'} needs text`);
    if (!Array.isArray(claim?.sourceSpans) || claim.sourceSpans.length < 1
      || claim.sourceSpans.some(span => !evidence.includes(normalizeEvidence(span)))) {
      errors.push(`claim ${claim?.id || '(missing)'} needs source spans found in evidenceText`);
    }
  }

  const frame = item.newsFrame || {};
  if (!frame.subject || !frame.eventKind || !frame.claimState) errors.push('newsFrame needs subject, eventKind, and claimState');
  const editorial = item.editorial || {};
  if (!editorial.title?.text || !Array.isArray(editorial.title?.lines) || editorial.title.lines.length !== 2) {
    errors.push('editorial needs a two-line title');
  }
  if (!normalizeNfc(editorial.caption).trim()) errors.push('editorial caption is required');

  const visual = item.visual || {};
  if (!visual.visualFingerprint) errors.push('visual fingerprint is required');
  if (!['typographic', 'chatgpt-generated-editorial', 'diem-library', 'web'].includes(visual.kind)) errors.push('visual kind is unsupported');
  if (visual.kind === 'chatgpt-generated-editorial') {
    if (visual.peoplePolicy !== 'prohibited' || visual.photorealisticNewsPolicy !== 'prohibited') {
      errors.push('generated image must prohibit people and photorealistic news depiction');
    }
    if (visual.assetPath !== 'background.png' || !/^[a-f0-9]{64}$/u.test(visual.sha256 || '')) {
      errors.push('generated image must use background.png and a SHA-256');
    }
  }
  if (visual.kind === 'diem-library') {
    if (!/^[a-z][a-z0-9-]{2,80}$/u.test(visual.assetId || '') || !/^[a-f0-9]{64}$/u.test(visual.sha256 || '')) {
      errors.push('visual library needs an allowlisted assetId and SHA-256');
    }
    if (visual.peoplePolicy !== 'prohibited' || visual.photorealisticNewsPolicy !== 'prohibited') {
      errors.push('visual library asset must prohibit people and photorealistic news depiction');
    }
  }

  if (!item.generation?.provider || !item.generation?.model) errors.push('generation provider and model are required');
  if (!['shadow', 'assisted', 'auto'].includes(item.review?.mode) || item.review?.status !== 'model-reviewed') {
    errors.push('review must be a model-reviewed shadow, assisted, or auto run');
  }
  if (!/^[a-f0-9]{64}$/u.test(item.integrity?.contentSha256 || '')
    || item.integrity.contentSha256 !== dailyPackageContentHash(item)) {
    errors.push('content hash mismatch');
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  DAILY_PACKAGE_SCHEMA_VERSION,
  dailyPackageContentHash,
  validateSubmissionPackage,
};
