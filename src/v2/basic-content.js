const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { BASIC_CONTENT_TYPE, basicContentHash } = require('./basic');
const { validateBasicKoreanVoice, validateBasicLesson } = require('./basic-cards');
const {
  allLedgerPublications,
  createDailyLedger,
  emptyPublication,
  listLedgers,
  loadLedger,
  saveLedger,
} = require('./ledger');
const { publishPreparedPublication } = require('./publisher');
const { notifyManualStoryShare } = require('./operations');
const {
  extractEmojiClusters,
  graphemeCount,
  validateCaption,
  validateHashtagReply,
  validateTitle,
} = require('./text');
const { kstDate } = require('./time');

const BASIC_CONTENT_ROOT = path.join(process.cwd(), 'content', 'diem-basic');
const BASIC_SCHEMA_VERSION = 2;

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath, fsImpl = fs) {
  return sha256Buffer(fsImpl.readFileSync(filePath));
}

function packageContentShape(item = {}) {
  const clean = structuredClone(item);
  delete clean._directory;
  delete clean._file;
  delete clean.integrity;
  return clean;
}

function packageContentHash(item = {}) {
  return sha256Buffer(JSON.stringify(packageContentShape(item)).normalize('NFC'));
}

function loadBasicCatalog({ contentRoot = BASIC_CONTENT_ROOT, fsImpl = fs } = {}) {
  const manifestPath = path.join(contentRoot, 'manifest.json');
  const manifest = JSON.parse(fsImpl.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== BASIC_SCHEMA_VERSION || !Array.isArray(manifest.items)) {
    throw new Error('[DIEM Basic] Invalid content manifest.');
  }
  const packages = manifest.items
    .map(entry => {
      const filePath = path.join(contentRoot, entry.file);
      const item = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
      return { ...item, _file: filePath, _directory: path.dirname(filePath) };
    })
    .sort((left, right) => Number(left.sequence) - Number(right.sequence));
  const manifestIds = manifest.items.map(entry => entry.id);
  const packageIds = packages.map(item => item.id);
  if (new Set(manifestIds).size !== manifestIds.length || manifestIds.join('|') !== packageIds.join('|')) {
    throw new Error('[DIEM Basic] Manifest IDs and package order do not match.');
  }
  return { manifest, packages, contentRoot };
}

function artifactPath(item, relativePath) {
  return path.resolve(item._directory || BASIC_CONTENT_ROOT, relativePath || '');
}

function expiryDate(value) {
  return new Date(`${value}T23:59:59+09:00`);
}

function validateBasicPackage(item = {}, {
  now = new Date(),
  verifyArtifacts = true,
  fsImpl = fs,
} = {}) {
  const errors = [];
  if (item.schemaVersion !== BASIC_SCHEMA_VERSION) errors.push('schemaVersion must be 2');
  if (!/^[a-z0-9-]+$/u.test(item.id || '')) errors.push('content ID must be stable kebab-case');
  if (!Number.isInteger(item.sequence) || item.sequence < 1) errors.push('sequence must be a positive integer');
  if (item.status !== 'ready') errors.push('package status must be ready');
  if (item.series !== 'DIEM Basic') errors.push('series must be DIEM Basic');
  if (item.category !== 'economy') errors.push('category must be economy');

  const title = validateTitle(item.editorial?.title?.text || '');
  if (!title.ok) errors.push(...title.errors.map(error => `title: ${error}`));
  const caption = validateCaption(item.editorial?.caption?.text || '');
  if (!caption.ok) errors.push(...caption.errors.map(error => `caption: ${error}`));
  if (JSON.stringify(caption.sentences) !== JSON.stringify(item.editorial?.caption?.sentences || [])) {
    errors.push('caption sentences must match caption text exactly');
  }
  const captionVoice = validateBasicKoreanVoice(caption.sentences, { scope: 'caption sentence' });
  if (!captionVoice.ok) errors.push(...captionVoice.errors.map(error => `caption: ${error}`));
  const firstComment = String(item.editorial?.comments?.first || '').trim();
  if (graphemeCount(firstComment) !== 1 || extractEmojiClusters(firstComment).length !== 1) {
    errors.push('first comment must be exactly one emoji');
  }
  const reply = validateHashtagReply(item.editorial?.comments?.reply || '', { handle: 'diem.magazine' });
  if (!reply.ok) errors.push(...reply.errors.map(error => `comments: ${error}`));
  if (reply.hashtags.length !== 15) errors.push('comments: hashtag reply must contain exactly 15 hashtags');
  if (JSON.stringify(reply.hashtags) !== JSON.stringify(item.editorial?.comments?.hashtags || [])) {
    errors.push('comments: stored hashtag array must match the reply');
  }

  const sources = Array.isArray(item.sources) ? item.sources : [];
  const officialPrimary = sources.filter(source => source.official === true && source.primary === true);
  if (new Set(officialPrimary.map(source => source.organization)).size < 2) {
    errors.push('at least two distinct official primary sources are required');
  }
  const sourceIds = new Set();
  for (const source of sources) {
    if (!source.id || sourceIds.has(source.id)) errors.push('source IDs must be present and unique');
    sourceIds.add(source.id);
    if (!/^https:\/\//u.test(source.url || '')) errors.push(`source ${source.id || '(missing)'} must use HTTPS`);
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(source.checkedAt || '')) errors.push(`source ${source.id || '(missing)'} needs checkedAt`);
  }
  const claims = Array.isArray(item.claims) ? item.claims : [];
  if (!claims.length) errors.push('at least one verified claim is required');
  for (const claim of claims) {
    if (!claim.id || !claim.text) errors.push('every claim needs an ID and exact text');
    if (!Array.isArray(claim.sourceIds) || claim.sourceIds.length === 0) {
      errors.push(`claim ${claim.id || '(missing)'} has no source mapping`);
      continue;
    }
    for (const sourceId of claim.sourceIds) {
      if (!sourceIds.has(sourceId)) errors.push(`claim ${claim.id || '(missing)'} references unknown source ${sourceId}`);
    }
  }
  const lesson = validateBasicLesson(item.lesson, new Set(claims.map(claim => claim.id)));
  if (!lesson.ok) errors.push(...lesson.errors.map(error => `lesson: ${error}`));

  if (item.visual?.kind !== 'typographic' || item.visual?.peoplePolicy !== 'prohibited') {
    errors.push('DIEM Basic visual must be project-owned typography with people prohibited');
  }
  if (!item.visual?.theme || !item.visual?.visualFingerprint) errors.push('visual theme and fingerprint are required');
  if (!item.audio?.trackId || !item.audio?.sha256 || !item.audio?.license) errors.push('verified audio metadata is required');
  if (item.audio?.mood !== 'bright') {
    errors.push('DIEM Basic requires a bright, light educational soundtrack');
  }
  if (item.review?.status !== 'approved') errors.push('review status must be approved');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(item.review?.checkedAt || '')) errors.push('review checkedAt is required');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(item.review?.expiresAt || '')) {
    errors.push('review expiresAt is required');
  } else if (now > expiryDate(item.review.expiresAt)) {
    errors.push(`needs_refresh: official-source review expired on ${item.review.expiresAt}`);
  }

  if (!item.artifacts?.coverPath || !item.artifacts?.reelPath) errors.push('cover and Reel artifact paths are required');
  if (!/^[a-f0-9]{64}$/u.test(item.artifacts?.coverSha256 || '')
    || !/^[a-f0-9]{64}$/u.test(item.artifacts?.reelSha256 || '')) {
    errors.push('artifact SHA-256 values are required');
  }
  const cardArtifacts = Array.isArray(item.artifacts?.cards) ? item.artifacts.cards : [];
  if (cardArtifacts.length !== 5) errors.push('exactly five card artifacts are required');
  if (new Set(cardArtifacts.map(card => card.path)).size !== cardArtifacts.length) {
    errors.push('card artifact paths must be unique');
  }
  cardArtifacts.forEach((card, index) => {
    if (card.path !== `cards/card-${String(index + 1).padStart(2, '0')}.png`) {
      errors.push(`card ${index + 1} path must use the fixed cards/card-NN.png contract`);
    }
    if (!/^[a-f0-9]{64}$/u.test(card.sha256 || '')) errors.push(`card ${index + 1} SHA-256 is required`);
    if (card.role !== item.lesson?.scenes?.[index]?.role) errors.push(`card ${index + 1} role must match its scene`);
    if (card.durationSeconds !== item.lesson?.scenes?.[index]?.durationSeconds) {
      errors.push(`card ${index + 1} duration must match its scene`);
    }
  });
  if (cardArtifacts[0]?.sha256 && item.artifacts?.coverSha256 !== cardArtifacts[0].sha256) {
    errors.push('cover must be byte-identical to the first lesson card');
  }
  if (!/^[a-f0-9]{64}$/u.test(item.integrity?.contentSha256 || '')) {
    errors.push('content SHA-256 is required');
  } else if (packageContentHash(item) !== item.integrity.contentSha256) {
    errors.push('content hash mismatch');
  }

  if (verifyArtifacts && item.artifacts?.coverPath && item.artifacts?.reelPath) {
    for (const [kind, relativePath, expected] of [
      ['cover', item.artifacts.coverPath, item.artifacts.coverSha256],
      ['reel', item.artifacts.reelPath, item.artifacts.reelSha256],
      ...cardArtifacts.map((card, index) => [`card ${index + 1}`, card.path, card.sha256]),
    ]) {
      const filePath = artifactPath(item, relativePath);
      if (!fsImpl.existsSync(filePath)) errors.push(`${kind} artifact is missing`);
      else if (expected && sha256File(filePath, fsImpl) !== expected) errors.push(`${kind} artifact hash mismatch`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function basicPublications(ledgers = []) {
  return ledgers.flatMap(ledger => allLedgerPublications(ledger).map(publication => ({ ledger, publication })))
    .filter(({ publication }) => publication.contentType === BASIC_CONTENT_TYPE);
}

function isDeletedBasicPublication(publication = {}) {
  return publication.moderation?.action === 'deleted' || Boolean(publication.moderation?.deletedAt);
}

function publishedBasicIds(ledgers = []) {
  return new Set(basicPublications(ledgers)
    .filter(({ publication }) => !isDeletedBasicPublication(publication))
    .filter(({ publication }) => publication.status === 'published' || publication.reel?.externalId)
    .map(({ publication }) => publication.basicContentId)
    .filter(Boolean));
}

function nextReadyBasicPackage(packages = [], ledgers = [], options = {}) {
  const published = publishedBasicIds(ledgers);
  const next = [...packages]
    .sort((left, right) => Number(left.sequence) - Number(right.sequence))
    .find(item => item.status === 'ready' && !published.has(item.id));
  if (!next) throw new Error('[DIEM Basic] No unpublished ready content package remains.');
  const validation = validateBasicPackage(next, options);
  if (!validation.ok) throw new Error(`[DIEM Basic] ${next.id} cannot publish: ${validation.errors.join('; ')}`);
  return next;
}

function replaceHistoryPublication(ledger, publication) {
  const next = structuredClone(ledger);
  next.schemaVersion = 3;
  next.publicationHistory = Array.isArray(next.publicationHistory) ? next.publicationHistory : [];
  const index = next.publicationHistory.findIndex(item => item.publicationKey === publication.publicationKey);
  if (index >= 0) next.publicationHistory[index] = structuredClone(publication);
  else next.publicationHistory.push(structuredClone(publication));
  return next;
}

function findBasicContentPublication(ledgers = [], contentId) {
  return basicPublications(ledgers)
    .filter(({ publication }) => publication.basicContentId === contentId)
    .sort((left, right) => String(right.ledger.date).localeCompare(String(left.ledger.date)))[0] || null;
}

function relativeArtifact(item, key) {
  return path.relative(process.cwd(), artifactPath(item, item.artifacts[key]));
}

function plannedStep() {
  return { status: 'planned', attempts: 0, externalId: null, error: null, updatedAt: null };
}

function stageBasicPackage(item, {
  date = kstDate(),
  now = new Date(),
  publicationKey,
} = {}) {
  const base = emptyPublication(date, 'economy', `basic-${item.id}`);
  if (publicationKey) base.publicationKey = publicationKey;
  const checkedAt = item.review.checkedAt;
  const publication = {
    ...base,
    schemaVersion: BASIC_SCHEMA_VERSION,
    contentType: BASIC_CONTENT_TYPE,
    basicContentId: item.id,
    basicSequence: item.sequence,
    status: 'ready',
    preparedAt: now.toISOString(),
    candidate: {
      title: item.curriculum.question,
      summary: item.curriculum.learningObjective,
      fullText: item.claims.map(claim => claim.text).join(' '),
      url: item.sources[0].url,
      publishedAt: `${checkedAt}T00:00:00+09:00`,
      category: 'economy',
      sourceMode: 'preauthored_official_sources',
      verifiedFacts: item.claims.map(claim => ({ text: claim.text, sourceIds: claim.sourceIds })),
      context: item.curriculum.learningObjective,
      topicTags: item.editorial.comments.hashtags,
    },
    duplicateCheck: {
      signature: {
        target: item.id,
        event: 'evergreen_financial_education',
        entities: item.curriculum.keywords,
      },
    },
    editorial: {
      ...structuredClone(item.editorial),
      category: 'economy',
      contentType: BASIC_CONTENT_TYPE,
      generation: { mode: 'preauthored_official_sources', model: null },
    },
    image: {
      kind: 'typographic',
      source: 'diem-original',
      license: { name: 'Project-owned original', url: null },
      fallbackTheme: item.visual.theme,
      fallbackVariant: item.visual.variant,
      artVariantId: item.visual.motif,
      visualFingerprint: item.visual.visualFingerprint,
      visualRole: 'educational_diagram',
      identity: { required: false, verified: true },
      localSha256: item.artifacts.coverSha256,
      reuseGuard: { allowed: true, reason: 'curriculum-specific committed motif' },
    },
    audio: structuredClone(item.audio),
    artifacts: {
      coverPath: relativeArtifact(item, 'coverPath'),
      coverSha256: item.artifacts.coverSha256,
      reelPath: relativeArtifact(item, 'reelPath'),
      reelSha256: item.artifacts.reelSha256,
      cards: item.artifacts.cards.map(card => ({
        ...card,
        path: path.relative(process.cwd(), artifactPath(item, card.path)),
      })),
      temporary: false,
    },
    source: {
      mode: 'curriculum_official_sources',
      checkedAt,
      expiresAt: item.review.expiresAt,
      organizations: item.sources.map(source => source.organization),
      sources: structuredClone(item.sources),
      claims: structuredClone(item.claims),
    },
    quality: {
      ok: true,
      checks: [
        'official_primary_sources',
        'claim_source_mapping',
        'three_sentence_contract',
        'five_card_lesson_contract',
        'nineteen_second_static_fades',
        'project_owned_no_people_visual',
        'committed_artifact_hashes',
        'review_freshness',
      ],
    },
    packageIntegrity: {
      contentSha256: item.integrity.contentSha256,
      coverSha256: item.artifacts.coverSha256,
      reelSha256: item.artifacts.reelSha256,
    },
    reel: { ...plannedStep(), status: 'ready' },
    story: plannedStep(),
    comment: plannedStep(),
    reply: plannedStep(),
  };
  publication.approval = {
    contentHash: basicContentHash(publication),
    approvedAt: item.review.checkedAt,
    approvedBy: item.review.reviewedBy,
  };
  return publication;
}

async function publishBasicPackage({
  date = kstDate(),
  contentId,
  contentRoot = BASIC_CONTENT_ROOT,
  ledgers = listLedgers(),
  ledger = loadLedger(date) || createDailyLedger(date),
  token = config.instagramAccessToken,
  verifyArtifacts = true,
  now = new Date(),
  publishPreparedPublicationImpl = publishPreparedPublication,
  notifyManualStoryShareImpl = notifyManualStoryShare,
  saveLedgerImpl = saveLedger,
} = {}) {
  if (!token) throw new Error('[DIEM Basic] Instagram token is required.');
  const allLedgers = ledgers.some(item => item.date === ledger.date) ? ledgers : [...ledgers, ledger];
  const { packages } = loadBasicCatalog({ contentRoot });
  let item;
  if (contentId) {
    item = packages.find(candidate => candidate.id === contentId);
    if (!item) throw new Error(`[DIEM Basic] Unknown content ID: ${contentId}`);
    if (publishedBasicIds(allLedgers).has(contentId)) throw new Error(`[DIEM Basic] ${contentId} is already published.`);
    const validation = validateBasicPackage(item, { now, verifyArtifacts });
    if (!validation.ok) throw new Error(`[DIEM Basic] ${contentId} cannot publish: ${validation.errors.join('; ')}`);
  } else {
    item = nextReadyBasicPackage(packages, allLedgers, { now, verifyArtifacts });
  }

  const existing = findBasicContentPublication(allLedgers, item.id);
  const deletedExisting = Boolean(existing && isDeletedBasicPublication(existing.publication));
  if (existing && !deletedExisting
    && (existing.publication.status === 'published' || existing.publication.reel?.externalId)) {
    throw new Error(`[DIEM Basic] ${item.id} is already published.`);
  }
  const targetLedger = existing?.ledger || ledger;
  const originalCurrent = structuredClone(targetLedger.publications.economy);
  const reissueNumber = basicPublications(allLedgers)
    .filter(({ publication }) => publication.basicContentId === item.id).length + 1;
  const reissuePublicationKey = deletedExisting
    ? `diem:${targetLedger.date}:economy:basic-${item.id}:reissue-${reissueNumber}`
    : existing?.publication.publicationKey;
  let staged = stageBasicPackage(item, {
    date: targetLedger.date,
    now,
    publicationKey: reissuePublicationKey,
  });
  if (existing && !deletedExisting) {
    staged = {
      ...staged,
      release: existing.publication.release || null,
      reel: { ...staged.reel, ...existing.publication.reel, status: 'ready' },
      story: { ...staged.story, ...existing.publication.story },
      comment: { ...staged.comment, ...existing.publication.comment },
      reply: { ...staged.reply, ...existing.publication.reply },
    };
    staged.approval.contentHash = basicContentHash(staged);
  }
  const persisted = saveLedgerImpl(replaceHistoryPublication(targetLedger, staged));
  const sandbox = structuredClone(persisted);
  sandbox.publications.economy = staged;
  const publishedSandbox = await publishPreparedPublicationImpl(sandbox, 'economy', token);
  let published = {
    ...publishedSandbox.publications.economy,
    contentType: BASIC_CONTENT_TYPE,
    basicContentId: item.id,
    basicSequence: item.sequence,
  };
  published = (await notifyManualStoryShareImpl(published, staged)).publication;
  const restored = structuredClone(persisted);
  restored.publications.economy = originalCurrent;
  return saveLedgerImpl(replaceHistoryPublication(restored, published));
}

module.exports = {
  BASIC_CONTENT_ROOT,
  BASIC_SCHEMA_VERSION,
  artifactPath,
  basicPublications,
  findBasicContentPublication,
  loadBasicCatalog,
  nextReadyBasicPackage,
  packageContentHash,
  publishBasicPackage,
  publishedBasicIds,
  sha256File,
  stageBasicPackage,
  validateBasicPackage,
};
