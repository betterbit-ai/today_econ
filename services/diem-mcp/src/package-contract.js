const crypto = require('crypto');

const DAILY_PACKAGE_SCHEMA_VERSION = 3;
const MAX_EVIDENCE_CHARS = 12_000;
const EXPLAIN_ROLES = Object.freeze(['what_happened', 'reader_impact', 'what_to_watch']);
const ROLE_PATTERNS = Object.freeze({
  what_happened: /(결정|확정|발표|시행|통과|개정|폐지|동결|인상|인하|상승|하락|발생|중단|재개|판결)/u,
  reader_impact: /(부담|지원|지급|환급|세금|보험료|임금|월급|소득|금리|대출|예금|적금|전세|월세|주거|고용|해고|근로|통근|안전|위험|권리|신청|대상|자격|이용|생활비|가격|비용)/u,
  what_to_watch: /(예정|앞으로|다음|향후|시행|적용|결정일|발표일|투표|심사|확정|조건|남은|불확실|여부|까지|부터|후속|추가|재개|확인)/u,
});

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

function candidatePackContentHash(pack = {}) {
  const content = structuredClone(pack);
  delete content.createdAt;
  delete content.expiresAt;
  delete content.integrity;
  return sha256(JSON.stringify(content).normalize('NFC'));
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
  if (item.schemaVersion !== DAILY_PACKAGE_SCHEMA_VERSION) errors.push('schemaVersion must be 3');
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
  for (const field of ['classificationConfidence', 'classificationReasons', 'publicInterestAnchor', 'rejectionReason']) {
    if (!Object.hasOwn(frame, field)) errors.push(`newsFrame.${field} is required`);
  }
  if (!['high', 'medium'].includes(frame.classificationConfidence)) {
    errors.push('newsFrame.classificationConfidence must be high or medium');
  }
  if (!Array.isArray(frame.classificationReasons) || frame.classificationReasons.length < 1) {
    errors.push('newsFrame.classificationReasons must contain at least one reason');
  }
  if (frame.rejectionReason !== null) errors.push('publishable newsFrame.rejectionReason must be null');
  const editorial = item.editorial || {};
  if (editorial.schemaVersion !== 3) errors.push('editorial.schemaVersion must be 3');
  if (!editorial.title?.text || !Array.isArray(editorial.title?.lines) || ![2, 3].includes(editorial.title.lines.length)) {
    errors.push('editorial needs a two-or-three-line title');
  }
  if (!normalizeNfc(editorial.caption?.text || editorial.caption).trim()) errors.push('editorial caption is required');
  if (!['flash', 'explain'].includes(editorial.reelFormat)) errors.push('editorial reelFormat must be flash or explain');
  if (!editorial.formatDecision || editorial.formatDecision.format !== editorial.reelFormat) {
    errors.push('editorial formatDecision must match reelFormat');
  }
  if (editorial.reelFormat === 'explain' && (!Array.isArray(editorial.scenes) || editorial.scenes.length !== 3)) {
    errors.push('explain editorial needs three scenes');
  }
  if (editorial.reelFormat === 'explain' && Array.isArray(editorial.scenes) && editorial.scenes.length === 3) {
    if (editorial.formatDecision?.eligible !== true) errors.push('explain formatDecision must be eligible');
    const sceneClaimRefs = new Set();
    editorial.scenes.forEach((scene, index) => {
      const role = EXPLAIN_ROLES[index];
      if (scene.role !== role) errors.push(`explain scene ${index + 1} must use role ${role}`);
      if (!Array.isArray(scene.claimRefs) || scene.claimRefs.length !== 1) {
        errors.push(`explain scene ${index + 1} needs one claimRef`);
      }
      if (!Array.isArray(scene.sourceSpans) || scene.sourceSpans.length !== 1) {
        errors.push(`explain scene ${index + 1} needs one sourceSpan`);
      }
      const claimRef = scene.claimRefs?.[0];
      const sourceSpan = normalizeEvidence(scene.sourceSpans?.[0]);
      const claim = claims.find(entry => entry.id === claimRef);
      if (!claim) errors.push(`explain scene ${index + 1} claimRef is unknown`);
      if (claimRef && sceneClaimRefs.has(claimRef)) errors.push('explain scenes require distinct claimRefs');
      if (claimRef) sceneClaimRefs.add(claimRef);
      const claimSourceSpans = Array.isArray(claim?.sourceSpans) ? claim.sourceSpans : [];
      if (claim && !claimSourceSpans.map(normalizeEvidence).includes(sourceSpan)) {
        errors.push(`explain scene ${index + 1} sourceSpan does not match its claim`);
      }
      if (!ROLE_PATTERNS[role].test(normalizeNfc(scene.body)) || !ROLE_PATTERNS[role].test(sourceSpan)) {
        errors.push(`explain scene ${index + 1} does not satisfy ${role}`);
      }
    });
  }
  if (item.analytics?.featureSchemaVersion !== 3) errors.push('analytics.featureSchemaVersion must be 3');
  if (item.analytics?.strategyVersion !== 'discovery-funnel-v3') {
    errors.push('analytics.strategyVersion must be discovery-funnel-v3');
  }
  const expectedDuration = editorial.reelFormat === 'explain' ? 13 : 6;
  if (item.analytics?.reelDurationSeconds !== expectedDuration) {
    errors.push(`analytics.reelDurationSeconds must be ${expectedDuration}`);
  }

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
  if (item.review?.mode !== 'assisted' || item.review?.status !== 'model-reviewed') {
    errors.push('review must be a model-reviewed assisted run');
  }
  if (!/^[a-f0-9]{64}$/u.test(item.integrity?.contentSha256 || '')
    || item.integrity.contentSha256 !== dailyPackageContentHash(item)) {
    errors.push('content hash mismatch');
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  DAILY_PACKAGE_SCHEMA_VERSION,
  candidatePackContentHash,
  dailyPackageContentHash,
  validateSubmissionPackage,
};
