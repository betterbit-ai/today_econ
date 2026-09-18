const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const config = require('../../config');
const { assertPreparedQuality } = require('./quality-gate');
const {
  allLedgerPublications,
  createDailyLedger,
  emptyPublication,
  historyFromLedgers,
  listLedgers,
  loadLedger,
  saveLedger,
  updatePublication,
} = require('./ledger');
const { publishPreparedPublication } = require('./publisher');
const { selectMusic, getMood } = require('./music');
const { createDiemReelWithMusic } = require('./reel');
const { renderDiemCover } = require('./cover');
const { buildTopicSignature, classifyCandidate } = require('./topic');
const { generatedFallbackTopic, imageReuseKeys } = require('./image-selector');
const { validateEditorial } = require('./editorial');
const { normalizeNfc } = require('./text');
const { resolveVisualLibraryAsset } = require('./visual-library');

const DAILY_CONTENT_TYPE = 'diem_daily';
const DAILY_PACKAGE_SCHEMA_VERSION = 1;
const DAILY_CONTENT_ROOT = path.join(process.cwd(), 'content', 'diem-daily');
const MAX_DAILY_IMAGE_BYTES = 8 * 1024 * 1024;

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath, fsImpl = fs) {
  return sha256Buffer(fsImpl.readFileSync(filePath));
}

function safeId(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(String(value || ''))) {
    throw new Error(`[DIEM Daily] ${label} must contain only letters, numbers, underscores, or hyphens.`);
  }
  return String(value);
}

function packageContentShape(item = {}) {
  const clean = structuredClone(item);
  delete clean._file;
  delete clean._directory;
  delete clean.integrity;
  return clean;
}

function dailyPackageContentHash(item = {}) {
  return sha256Buffer(JSON.stringify(packageContentShape(item)).normalize('NFC'));
}

function safePackagePath(packagePath, root = DAILY_CONTENT_ROOT) {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(packagePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error('[DIEM Daily] Package path must stay inside the daily content root.');
  }
  return resolvedPath;
}

function loadDailyPackage(packagePath, {
  contentRoot = DAILY_CONTENT_ROOT,
  fsImpl = fs,
} = {}) {
  const filePath = safePackagePath(packagePath, contentRoot);
  const item = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
  return {
    ...item,
    _file: filePath,
    _directory: path.dirname(filePath),
  };
}

function evidenceText(item = {}) {
  return normalizeNfc(item.source?.evidenceText || '').replace(/\s+/gu, ' ').trim();
}

function sourceArticle(item = {}) {
  const source = item.source || {};
  const text = evidenceText(item);
  return {
    title: source.title,
    url: source.url,
    summary: text.slice(0, 800),
    fullText: text,
    category: item.category,
    publishedAt: source.publishedAt || null,
    observedAt: source.observedAt || null,
    newsFrame: item.newsFrame || {},
    verifiedFacts: (item.claims || []).map(claim => claim.text),
  };
}

function visualFilePath(item = {}) {
  if (item.visual?.kind === 'diem-library') {
    return resolveVisualLibraryAsset(item.visual.assetId).assetPath;
  }
  const relativePath = item.visual?.assetPath;
  if (!relativePath) return null;
  const base = path.resolve(item._directory || DAILY_CONTENT_ROOT);
  const resolved = path.resolve(base, relativePath);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error('[DIEM Daily] Visual asset path must stay inside its package directory.');
  }
  return resolved;
}

function fallbackThemeFor(item = {}) {
  return item.visual?.fallbackTheme || (item.category === 'economy' ? 'markets' : 'public-interest');
}

function imageForPackage(item = {}) {
  const visual = item.visual || {};
  const base = {
    visualFingerprint: visual.visualFingerprint,
    localSha256: visual.sha256 || null,
    identity: { required: false, verified: true, depicted: false },
    reuseGuard: { allowed: true, reason: 'package validator must recheck against publication history' },
  };
  if (visual.kind === 'typographic') {
    return {
      ...base,
      kind: 'typographic',
      source: 'diem-original',
      license: { name: 'Project-owned original', url: null },
      fallbackTheme: fallbackThemeFor(item),
      fallbackVariant: Number.isInteger(visual.fallbackVariant) ? visual.fallbackVariant : 0,
      visualRole: 'context',
    };
  }
  if (visual.kind === 'chatgpt-generated-editorial') {
    return {
      ...base,
      kind: 'chatgpt-generated-editorial',
      source: 'chatgpt',
      license: { name: 'ChatGPT-generated editorial illustration', url: null },
      assetPath: visual.assetPath,
      prompt: visual.prompt,
      peoplePolicy: visual.peoplePolicy,
      photorealisticNewsPolicy: visual.photorealisticNewsPolicy,
      visualRole: 'context',
    };
  }
  if (visual.kind === 'diem-library') {
    const asset = resolveVisualLibraryAsset(visual.assetId);
    if (visual.sha256 !== asset.sha256) throw new Error('[DIEM Daily] visual library asset hash mismatch.');
    const expectedTopic = generatedFallbackTopic(sourceArticle(item));
    if (!expectedTopic || !asset.topics.includes(expectedTopic)) {
      throw new Error(`[DIEM Daily] visual library asset does not match the article topic ${expectedTopic || '(unmapped)'}.`);
    }
    return {
      ...base,
      kind: 'generated',
      id: `diem-library:${asset.id}`,
      source: 'diem-generated',
      license: { name: 'Project-owned ChatGPT visual library asset', url: null },
      assetPath: path.relative(process.cwd(), asset.assetPath),
      localPath: asset.assetPath,
      localSha256: asset.sha256,
      generatedTopic: asset.topics[0],
      generatedEnergy: asset.energy,
      description: asset.description,
      visualRole: 'context',
      suitability: {
        ok: true,
        reason: 'chatgpt_selected_project_visual_library_asset',
        personScreening: { detected: false, personFreeEvidence: true, requiredPersonFreeEvidence: true, safe: true },
      },
    };
  }
  if (visual.kind === 'web') {
    return {
      ...base,
      kind: 'web',
      source: visual.source,
      license: visual.license,
      originalUrl: visual.originalUrl || null,
      downloadUrl: visual.downloadUrl || null,
      query: visual.query,
      description: visual.description,
      visualRole: visual.visualRole || 'context',
      suitability: visual.suitability,
    };
  }
  throw new Error(`[DIEM Daily] Unsupported visual kind: ${visual.kind || 'missing'}`);
}

function expiryDate(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function validateDailyPackage(item = {}, {
  now = new Date(),
  verifyArtifact = false,
  fsImpl = fs,
  handle = config.instagramUsername,
} = {}) {
  const errors = [];
  if (item.schemaVersion !== DAILY_PACKAGE_SCHEMA_VERSION) errors.push('schemaVersion must be 1');
  try { safeId(item.packageId, 'packageId'); } catch (error) { errors.push(error.message); }
  try { safeId(item.runId, 'runId'); } catch (error) { errors.push(error.message); }
  if (item.status !== 'ready') errors.push('package status must be ready');
  if (!['economy', 'issue'].includes(item.category)) errors.push('category must be economy or issue');

  const expiresAt = expiryDate(item.expiresAt);
  if (!expiresAt) errors.push('expiresAt must be a valid ISO timestamp');
  else if (expiresAt.getTime() <= now.getTime()) errors.push(`package expired at ${item.expiresAt}`);
  if (!expiryDate(item.createdAt)) errors.push('createdAt must be a valid ISO timestamp');

  const source = item.source || {};
  const text = evidenceText(item);
  if (!source.title) errors.push('source title is required');
  if (!/^https:\/\//u.test(source.url || '')) errors.push('source URL must use HTTPS');
  if (!text || text.length < 80) errors.push('source evidenceText must contain at least 80 characters');
  if (!/^[a-f0-9]{64}$/u.test(source.evidenceSha256 || '')) errors.push('source evidenceSha256 is required');
  else if (source.evidenceSha256 !== sha256Buffer(text)) errors.push('source evidence hash mismatch');

  const claims = Array.isArray(item.claims) ? item.claims : [];
  if (claims.length < 1) errors.push('at least one grounded claim is required');
  const claimIds = new Set();
  for (const claim of claims) {
    if (!claim.id || claimIds.has(claim.id)) errors.push('claim IDs must be present and unique');
    claimIds.add(claim.id);
    if (!claim.text) errors.push(`claim ${claim.id || '(missing)'} needs text`);
    if (!Array.isArray(claim.sourceSpans) || claim.sourceSpans.length < 1) {
      errors.push(`claim ${claim.id || '(missing)'} needs at least one source span`);
    } else if (claim.sourceSpans.some(span => !text.includes(normalizeNfc(span).replace(/\s+/gu, ' ').trim()))) {
      errors.push(`claim ${claim.id || '(missing)'} source span is absent from evidenceText`);
    }
  }

  const article = sourceArticle(item);
  const classified = item.category ? classifyCandidate(article) : {};
  if (classified.category !== item.category) {
    errors.push(`deterministic classification does not match ${item.category}`);
  }
  if (!item.newsFrame?.subject || !item.newsFrame?.eventKind || !item.newsFrame?.claimState) {
    errors.push('newsFrame needs subject, eventKind, and claimState');
  }
  const editorialResult = validateEditorial(item.editorial || {}, { article, handle });
  if (!editorialResult.ok) errors.push(...editorialResult.errors.map(error => `editorial: ${error}`));

  let image = null;
  try {
    image = imageForPackage(item);
    const visual = item.visual || {};
    if (!visual.visualFingerprint) errors.push('visual fingerprint is required');
    if (visual.kind === 'chatgpt-generated-editorial') {
      if (visual.peoplePolicy !== 'prohibited') errors.push('generated editorial image must prohibit people');
      if (visual.photorealisticNewsPolicy !== 'prohibited') errors.push('generated editorial image must prohibit photorealistic news depiction');
      if (!visual.assetPath || !/^[a-f0-9]{64}$/u.test(visual.sha256 || '')) {
        errors.push('generated editorial image needs assetPath and SHA-256');
      }
    }
    if (visual.kind === 'diem-library') {
      const asset = resolveVisualLibraryAsset(visual.assetId, { fsImpl });
      if (visual.sha256 !== asset.sha256) errors.push('visual library asset hash mismatch');
    }
    if (verifyArtifact && (visual.assetPath || visual.kind === 'diem-library')) {
      const assetPath = visualFilePath(item);
      if (!fsImpl.existsSync(assetPath)) errors.push('visual asset is missing');
      else if (fsImpl.statSync(assetPath).size > MAX_DAILY_IMAGE_BYTES) errors.push('visual asset exceeds 8MB');
      else if (visual.sha256 && sha256File(assetPath, fsImpl) !== visual.sha256) errors.push('visual asset hash mismatch');
    }
  } catch (error) {
    errors.push(error.message);
  }

  if (!item.generation?.provider || !item.generation?.model) errors.push('generation provider and model are required');
  if (!['shadow', 'assisted', 'auto'].includes(item.review?.mode)) errors.push('review mode must be shadow, assisted, or auto');
  if (item.review?.status !== 'model-reviewed') errors.push('review status must be model-reviewed');
  if (!/^[a-f0-9]{64}$/u.test(item.integrity?.contentSha256 || '')) errors.push('content SHA-256 is required');
  else if (dailyPackageContentHash(item) !== item.integrity.contentSha256) errors.push('content hash mismatch');

  return { ok: errors.length === 0, errors, article, image, editorial: editorialResult };
}

function stageDailyPackage(item, {
  date,
  now = new Date(),
} = {}) {
  const safeDate = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(safeDate)) throw new Error('[DIEM Daily] date must be YYYY-MM-DD.');
  const base = emptyPublication(safeDate, item.category, `daily-${safeId(item.packageId, 'packageId')}`);
  const article = sourceArticle(item);
  const signature = buildTopicSignature(article, item.category);
  const image = imageForPackage(item);
  return {
    ...base,
    schemaVersion: DAILY_PACKAGE_SCHEMA_VERSION,
    contentType: DAILY_CONTENT_TYPE,
    dailyPackageId: item.packageId,
    status: 'planned',
    preparedAt: null,
    candidate: {
      ...article,
      topicSignature: signature,
      sourceMode: 'chatgpt_cloud_package',
      verifiedFacts: (item.claims || []).map(claim => ({ text: claim.text, sourceSpans: claim.sourceSpans })),
    },
    duplicateCheck: { signature, source: 'cloud_package' },
    editorial: {
      ...structuredClone(item.editorial),
      category: item.category,
      contentType: DAILY_CONTENT_TYPE,
      generation: {
        mode: 'chatgpt_cloud_scheduled',
        provider: item.generation.provider,
        model: item.generation.model,
        reasoningEffort: item.generation.reasoningEffort || null,
        taskRunId: item.generation.taskRunId || null,
      },
    },
    image,
    source: {
      mode: 'chatgpt_cloud_package',
      packageId: item.packageId,
      runId: item.runId,
      evidenceSha256: item.source.evidenceSha256,
      claims: structuredClone(item.claims || []),
      selection: structuredClone(item.selection || {}),
      expiresAt: item.expiresAt,
    },
    quality: {
      ok: true,
      checks: ['package_schema', 'claim_source_mapping', 'title_contract', 'three_sentence_contract', 'package_integrity'],
    },
    packageIntegrity: {
      contentSha256: item.integrity.contentSha256,
      visualSha256: item.visual?.sha256 || null,
    },
    review: structuredClone(item.review),
    generation: { status: 'staged', attempts: 0, updatedAt: now.toISOString() },
  };
}

function artifactDirectory(ledger, category, root = path.join(process.cwd(), '.diem-cache')) {
  return path.join(root, ledger.date, category);
}

async function prepareDailyPackage(ledger, category, {
  package: item,
  now = new Date(),
  artifactRoot,
  history = [],
  renderCoverImpl = renderDiemCover,
  selectMusicImpl = selectMusic,
  createReelImpl = createDiemReelWithMusic,
} = {}) {
  if (item?.review?.mode === 'shadow') throw new Error('[DIEM Daily] shadow package cannot be prepared.');
  const validation = validateDailyPackage(item, { now, verifyArtifact: Boolean(item?.visual?.assetPath) });
  if (!validation.ok) throw new Error(`[DIEM Daily] package cannot be prepared: ${validation.errors.join('; ')}`);
  const publication = ledger?.publications?.[category];
  if (!publication) throw new Error(`[DIEM Daily] Missing ${category} publication.`);
  if (publication.dailyPackageId !== item.packageId) throw new Error('[DIEM Daily] Ledger publication does not match package ID.');
  if (publication.reel?.status === 'published') return ledger;

  const image = publication.image;
  if (image.id?.startsWith('diem-library:')) {
    const recentImageKeys = new Set((history || []).flatMap(imageReuseKeys));
    if (imageReuseKeys(image).some(key => recentImageKeys.has(key))) {
      throw new Error(`[DIEM Daily] visual library asset was used in the recent history: ${image.id}`);
    }
  }
  if (image.kind === 'chatgpt-generated-editorial') {
    throw new Error('[DIEM Daily] chatgpt-generated-editorial rendering is gated until ImageGen handoff is proven.');
  }
  const article = publication.candidate;
  assertPreparedQuality({ article, editorial: publication.editorial, image, handle: config.instagramUsername });
  const outputDir = artifactDirectory(ledger, category, artifactRoot);
  fs.mkdirSync(outputDir, { recursive: true });
  const coverPath = path.join(outputDir, `${category}-cover.png`);
  const followCtaPath = path.join(outputDir, `${category}-follow-cta.png`);
  const packageImagePath = item.visual?.assetPath || item.visual?.kind === 'diem-library'
    ? visualFilePath(item)
    : null;
  await renderCoverImpl({
    editorial: publication.editorial,
    date: ledger.date,
    category,
    contentType: DAILY_CONTENT_TYPE,
    imagePath: packageImagePath,
    fallbackTheme: image.fallbackTheme,
    fallbackVariant: image.fallbackVariant,
    visualFingerprint: image.visualFingerprint,
    followCtaOutputPath: followCtaPath,
    outputPath: coverPath,
  });
  if (!fs.existsSync(coverPath) || !fs.existsSync(followCtaPath)) {
    throw new Error('[DIEM Daily] Cover or follow CTA artifact was not rendered.');
  }
  const music = selectMusicImpl({
    history,
    publicationKey: publication.publicationKey,
    topic: article,
    mood: getMood(`${article.title} ${article.summary} ${article.fullText}`),
  });
  const reelPath = path.join(outputDir, `${category}-reel.mp4`);
  const reelResult = await createReelImpl({
    imagePath: coverPath,
    followCtaImagePath: followCtaPath,
    outputPath: reelPath,
    music,
  });
  if (!fs.existsSync(reelResult.outputPath || reelPath)) throw new Error('[DIEM Daily] Reel artifact was not rendered.');
  const preparedAt = now.toISOString();
  return updatePublication(ledger, category, {
    status: 'ready',
    audio: reelResult.audio,
    artifacts: {
      coverPath: path.relative(process.cwd(), coverPath),
      coverSha256: sha256File(coverPath),
      followCtaPath: path.relative(process.cwd(), followCtaPath),
      followCtaSha256: sha256File(followCtaPath),
      reelPath: path.relative(process.cwd(), reelResult.outputPath || reelPath),
      reelSha256: sha256File(reelResult.outputPath || reelPath),
      temporary: true,
    },
    reel: {
      ...publication.reel,
      status: 'ready',
      error: null,
      updatedAt: preparedAt,
    },
    generation: { ...publication.generation, status: 'prepared', updatedAt: preparedAt },
  });
}

function existingDailyPackage(ledgers = [], packageId) {
  for (const ledger of ledgers) {
    const publication = allLedgerPublications(ledger).find(item => item.dailyPackageId === packageId);
    if (publication) return { ledger, publication };
  }
  return null;
}

function stagePackageInLedger(ledger, item, { date, now } = {}) {
  const current = ledger.publications?.[item.category];
  if (!current) throw new Error(`[DIEM Daily] Missing ${item.category} publication.`);
  if (current.dailyPackageId === item.packageId) return ledger;
  if (current.candidate || !['planned', 'no_publish'].includes(current.status)) {
    throw new Error(`[DIEM Daily] ${item.category} already contains a different publication.`);
  }
  const next = structuredClone(ledger);
  next.publications[item.category] = stageDailyPackage(item, { date, now });
  return next;
}

function loadedPackage(packagePath, contentRoot) {
  const item = loadDailyPackage(packagePath, { contentRoot });
  return { item, packagePath: item._file };
}

async function prepareDailyPackageFromFile({
  packagePath,
  contentRoot = DAILY_CONTENT_ROOT,
  date,
  now = new Date(),
  ledger = loadLedger(date) || createDailyLedger(date, now),
  ledgers = listLedgers(),
  saveLedgerImpl = saveLedger,
  ...prepareOptions
} = {}) {
  const { item } = loadedPackage(packagePath, contentRoot);
  const validation = validateDailyPackage(item, { now, verifyArtifact: Boolean(item.visual?.assetPath) });
  if (!validation.ok) throw new Error(`[DIEM Daily] package validation failed: ${validation.errors.join('; ')}`);
  if (item.review?.mode === 'shadow') throw new Error('[DIEM Daily] shadow package cannot be prepared.');
  const known = existingDailyPackage(ledgers, item.packageId);
  if (known?.publication?.reel?.status === 'published') return known.ledger;
  const staged = stagePackageInLedger(ledger, item, { date, now });
  const persisted = saveLedgerImpl(staged);
  const history = prepareOptions.history || historyFromLedgers(
    [...ledgers.filter(entry => entry.date !== persisted.date), persisted],
    date,
    config.maxHistoryDays,
    { includeReferenceDate: true }
  );
  const prepared = await prepareDailyPackage(persisted, item.category, {
    ...prepareOptions,
    package: item,
    now,
    history,
  });
  return saveLedgerImpl(prepared);
}

async function publishDailyPackage({
  packagePath,
  contentRoot = DAILY_CONTENT_ROOT,
  date,
  now = new Date(),
  ledger = loadLedger(date) || createDailyLedger(date, now),
  ledgers = listLedgers(),
  token = config.instagramAccessToken,
  saveLedgerImpl = saveLedger,
  publishPreparedPublicationImpl = publishPreparedPublication,
} = {}) {
  if (!token) throw new Error('[DIEM Daily] Instagram token is required.');
  const { item } = loadedPackage(packagePath, contentRoot);
  const validation = validateDailyPackage(item, { now, verifyArtifact: Boolean(item.visual?.assetPath) });
  if (!validation.ok) throw new Error(`[DIEM Daily] package validation failed: ${validation.errors.join('; ')}`);
  if (item.review?.mode === 'shadow') throw new Error('[DIEM Daily] shadow package cannot be published.');
  const known = existingDailyPackage(ledgers, item.packageId);
  if (known?.publication?.reel?.status === 'published') return known.ledger;
  const staged = stagePackageInLedger(ledger, item, { date, now });
  const persisted = saveLedgerImpl(staged);
  if (persisted.publications[item.category].status !== 'ready') {
    throw new Error('[DIEM Daily] package must be prepared before publishing.');
  }
  const published = await publishPreparedPublicationImpl(persisted, item.category, token);
  return saveLedgerImpl(published);
}

module.exports = {
  DAILY_CONTENT_ROOT,
  DAILY_CONTENT_TYPE,
  DAILY_PACKAGE_SCHEMA_VERSION,
  MAX_DAILY_IMAGE_BYTES,
  dailyPackageContentHash,
  imageForPackage,
  loadDailyPackage,
  publishDailyPackage,
  prepareDailyPackage,
  prepareDailyPackageFromFile,
  stageDailyPackage,
  validateDailyPackage,
};
