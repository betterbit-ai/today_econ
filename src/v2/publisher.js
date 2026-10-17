const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { cleanupExpiredReleases, createTemporaryRelease } = require('../github-assets');
const { publishReel, publishStory, searchInstagramAudio } = require('../instagram');
const { generateEditorial } = require('./editorial');
const { evaluateExplainRollout, loadExplainCapabilityEvidence } = require('./explain-policy');
const { createGroqVisionReviewer } = require('./groq');
const { editorialRuntime } = require('./editorial-provider');
const { creativeBrief, reviewRenderedCreative, assertCreativeBinding } = require('./creative');
const {
  createGeneratedFallback,
  reviewedGeneratedFallback,
  downloadSelectedImage,
  extractPrimaryPersonIdentity,
  imageReuseKeys,
  selectLicensedImage,
} = require('./image-selector');
const { assertPreparedQuality } = require('./quality-gate');
const {
  applyIndependentStepOutcome,
  createTopLevelComment,
  listComments,
  reconcileExactComment,
  reconcileRecentReel,
  replyToComment,
  nextFailedStep,
} = require('./instagram');
const { allLedgerPublications, imageRecordFromPublication, updatePublication } = require('./ledger');
const { selectMusic, getMood } = require('./music');
const { DIEM_EXPLAIN_REEL, DIEM_REEL, createDiemReelWithMusic } = require('./reel');
const { renderDiemCover, renderDiemScenes } = require('./cover');
const { isSensitiveTopic } = require('./topic');
const { MANUAL_REEL_STORY_SHARE_REASON } = require('./constants');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function artifactDirectory(ledger, category, root = path.join(process.cwd(), '.diem-cache')) {
  return path.join(root, ledger.date, category);
}

function selectedArticle(publication) {
  const candidate = publication?.candidate;
  if (!candidate?.title || !candidate?.fullText) throw new Error('[DIEM Publisher] Selected article evidence is missing.');
  const signature = publication.duplicateCheck?.signature || candidate.topicSignature || {};
  return {
    ...candidate,
    category: publication.category,
    target: signature.target,
    event: signature.event,
    entities: signature.entities,
    verifiedFacts: candidate.verifiedFacts,
    context: candidate.context,
  };
}

function stripEphemeralImageFields(selection = {}) {
  const { localPath: _localPath, ...durable } = selection;
  return durable;
}

function currentLedgerImages(ledger, excludePublicationKey) {
  return allLedgerPublications(ledger)
    .filter(publication => publication.publicationKey !== excludePublicationKey)
    .filter(publication => publication.image)
    .filter(publication => (
      ['ready', 'publishing', 'published', 'retry_pending'].includes(publication.status)
      || ['ready', 'publishing', 'published', 'retry_pending'].includes(publication.reel?.status)
    ))
    .map(publication => imageRecordFromPublication(publication, ledger.date)?.image)
    .filter(Boolean);
}

function sharesRecentImageKey(image, recentImages = []) {
  const recentKeys = new Set(recentImages.flatMap(imageReuseKeys));
  return imageReuseKeys(image).some(key => recentKeys.has(key));
}

function recentImagesForSelection(ledger, publication, history = []) {
  const historicalImages = history
    .filter(entry => entry.publicationKey !== publication.publicationKey)
    .map(entry => entry.image || entry)
    .filter(Boolean);
  return [
    ...historicalImages,
    ...currentLedgerImages(ledger, publication.publicationKey),
  ];
}

async function preparePublication(ledger, category, {
  callModel,
  generateEditorialImpl = generateEditorial,
  selectImageImpl = selectLicensedImage,
  downloadImageImpl = downloadSelectedImage,
  renderCoverImpl = renderDiemCover,
  renderScenesImpl = renderDiemScenes,
  selectMusicImpl = selectMusic,
  createReelImpl = createDiemReelWithMusic,
  reviewImages,
  reviewCreative,
  artifactRoot,
  history = [],
} = {}) {
  const publication = ledger.publications[category];
  if (!publication) throw new Error(`[DIEM Publisher] Missing ${category} publication.`);
  if (publication.status === 'no_publish' || publication.reel?.status === 'published') return ledger;
  const article = selectedArticle(publication);
  const outputDir = artifactDirectory(ledger, category, artifactRoot);
  fs.mkdirSync(outputDir, { recursive: true });

  const runtime = editorialRuntime({ callModel });
  const explainPolicy = evaluateExplainRollout({
    configured: config.explainReelsEnabled,
    category,
    date: ledger.date,
    history,
    evidence: loadExplainCapabilityEvidence(config.explainCapabilityEvidenceFile),
    minIntervalDays: config.explainMinIntervalDays,
    maxPerCategory: config.explainCanaryMaxPerCategory,
  });
  const editorial = await generateEditorialImpl(article, {
    callModel: runtime.callModel,
    primaryModel: runtime.primaryModel,
    fallbackModel: runtime.fallbackModel,
    handle: config.instagramUsername,
    explainEnabled: explainPolicy.enabled,
  });
  editorial.formatRollout = explainPolicy;
  editorial.generation = { ...editorial.generation, ...runtime.evidence() };
  const brief = creativeBrief(article, editorial);
  editorial.creativeBrief = brief;

  const recentImages = recentImagesForSelection(ledger, publication, history);
  const imageCandidate = {
    ...article,
    imageKeyword: editorial.imageKeyword,
    editorialTitle: editorial.title.text,
    editorialCaption: editorial.caption.text,
  };
  const personIdentity = extractPrimaryPersonIdentity(imageCandidate);
  const imageReviewer = reviewImages || (
    selectImageImpl === selectLicensedImage && config.groqApiKey
      ? createGroqVisionReviewer({ apiKey: config.groqApiKey, model: config.groqVisionModel })
      : null
  );
  let imageSelection;
  let downloaded;
  for (let selectionAttempt = 1; selectionAttempt <= 5; selectionAttempt += 1) {
    imageSelection = await selectImageImpl(imageCandidate, {
      pexelsApiKey: config.pexelsApiKey,
      unsplashAccessKey: config.unsplashAccessKey,
      recentImages,
      reuseWindowDays: config.maxHistoryDays,
      reviewImages: imageReviewer,
      generatedFallbackEnabled: true,
      requireGeneratedReview: config.creativeReviewEnabled,
    });
    downloaded = imageSelection;
    if (imageSelection.kind !== 'web') break;
    try {
      downloaded = await downloadImageImpl(imageSelection, { outputDir });
      if (!sharesRecentImageKey(downloaded, recentImages)) break;
      recentImages.push({ ...imageSelection, localSha256: downloaded.sha256 });
      imageSelection = null;
      downloaded = null;
    } catch (error) {
      imageSelection = await reviewedGeneratedFallback(imageCandidate, {
        recentImages,
        reuseWindowDays: config.maxHistoryDays,
        attempts: [
          ...(imageSelection.attempts || []),
          { provider: imageSelection.source, query: imageSelection.query, error: error.message, stage: 'download' },
        ],
        reason: 'licensed image download failed',
      }, { reviewImages: imageReviewer, required: config.creativeReviewEnabled });
      if (!imageSelection) {
        throw new Error('[DIEM Image] licensed image download failed and no unused reviewed generated asset remains; typography fallback is disabled');
      }
      imageSelection.downloadError = error.message;
      downloaded = imageSelection;
      break;
    }
  }
  if (!imageSelection || !downloaded) {
    imageSelection = await reviewedGeneratedFallback(imageCandidate, {
      recentImages,
      reuseWindowDays: config.maxHistoryDays,
      reason: 'all licensed candidates matched a recent seven-day image hash',
    }, { reviewImages: imageReviewer, required: config.creativeReviewEnabled });
    if (!imageSelection) {
      throw new Error('[DIEM Image] all licensed and reviewed generated assets are exhausted; typography fallback is disabled');
    }
    downloaded = imageSelection;
  }
  if (imageSelection.kind === 'typographic' && imageSelection.reuseGuard?.allowed === false) {
    throw new Error('[DIEM Image] No unused topic-grounded fallback art remains inside the seven-day window.');
  }
  const claimsNamedPortrait = imageSelection.visualRole === 'portrait'
    || imageSelection.identity?.required === true;
  if (personIdentity?.critical && claimsNamedPortrait
    && !(imageSelection.kind === 'web' && imageSelection.identity?.verified)) {
    throw new Error(`[DIEM Image] named-person identity could not be verified: ${personIdentity.name}`);
  }
  const preparedQuality = assertPreparedQuality({
    article,
    editorial,
    image: imageSelection,
    handle: config.instagramUsername,
  });
  if (imageSelection.kind === 'web' && preparedQuality.image.finalReview) {
    imageSelection.finalReview = {
      ...(imageSelection.finalReview || {}),
      ok: preparedQuality.image.finalReview.ok,
      gate: 'prepared_quality_context_recheck',
      reason: preparedQuality.image.finalReview.reason,
    };
  }

  const coverPath = path.join(outputDir, `${category}-cover.png`);
  const sourceImagePath = downloaded.localPath || (imageSelection.kind === 'generated' ? imageSelection.localPath : null);
  await renderCoverImpl({
    editorial,
    date: ledger.date,
    category,
    contentType: editorial.contentType || article.contentType || publication.contentType || 'hot_news',
    imagePath: sourceImagePath,
    fallbackTheme: imageSelection.fallbackTheme,
    fallbackVariant: imageSelection.fallbackVariant,
    visualFingerprint: imageSelection.visualFingerprint,
    outputPath: coverPath,
  });
  const reelFormat = editorial.reelFormat || 'flash';
  const sceneImagePaths = reelFormat === 'explain'
    ? (renderCoverImpl === renderDiemCover
      ? await renderScenesImpl({ scenes: editorial.scenes, imagePath: sourceImagePath, outputDir })
      : [coverPath, coverPath, coverPath])
    : [];

  const mood = brief.mood;

  const music = selectMusicImpl({
    history,
    publicationKey: publication.publicationKey,
    topic: { title: brief.title, summary: brief.caption },
    mood,
    sensitive: brief.sensitive,
    newsOnly: true,
  });
  let creativeReview = null;
  if (config.creativeReviewEnabled || reviewCreative) {
    creativeReview = await (reviewCreative || reviewRenderedCreative)({ article, brief, coverPath, reviewImages: imageReviewer });
    if (creativeReview?.ok !== true) throw new Error('[DIEM Quality] final creative review was not affirmative');
  }
  const reelPath = path.join(outputDir, `${category}-reel.mp4`);
  const reelResult = await createReelImpl({
    imagePath: coverPath,
    sceneImagePaths,
    format: reelFormat,
    outputPath: reelPath,
    music,
  });
  if (creativeReview) creativeReview.reviewedReelSha256 = sha256File(reelResult.outputPath);
  const preparedAt = new Date().toISOString();

  return updatePublication(ledger, category, {
    status: 'ready',
    editorial,
    creativeReview,
    analytics: {
      ...(publication.analytics || {}),
      featureSchemaVersion: 3,
      strategyVersion: 'discovery-funnel-v3',
      reelDurationSeconds: reelFormat === 'explain'
        ? DIEM_EXPLAIN_REEL.durationSeconds
        : DIEM_REEL.durationSeconds,
    },
    image: {
      ...stripEphemeralImageFields(imageSelection),
      localSha256: downloaded.sha256 || sha256File(coverPath),
    },
    audio: reelResult.audio,
    artifacts: {
      coverPath: path.relative(process.cwd(), coverPath),
      coverSha256: sha256File(coverPath),
      scenePaths: sceneImagePaths.map(scenePath => path.relative(process.cwd(), scenePath)),
      reelPath: path.relative(process.cwd(), reelResult.outputPath),
      reelSha256: sha256File(reelResult.outputPath),
      temporary: true,
    },
    reel: {
      ...publication.reel,
      status: 'ready',
      error: null,
      updatedAt: preparedAt,
    },
  });
}

function resolveArtifact(value) {
  if (!value) return '';
  return path.isAbsolute(value) ? value : path.join(process.cwd(), value);
}

function replyList(parent = {}) {
  if (Array.isArray(parent.replies)) return parent.replies;
  if (Array.isArray(parent.replies?.data)) return parent.replies.data;
  return [];
}

function isHashtagCountError(error = {}) {
  return Number(error.status) === 400 && /(hashtag|too many|spam|태그)/iu.test(String(error.message || error.payload?.error?.message || ''));
}

async function publishCommentChain(publication, {
  token,
  version = config.instagramApiVersion,
  username = config.instagramUsername,
  listCommentsImpl = listComments,
  createCommentImpl = createTopLevelComment,
  replyImpl = replyToComment,
} = {}) {
  if (publication.reel?.status !== 'published' || !publication.reel.externalId) return publication;
  let next = structuredClone(publication);
  let comments = [];
  try {
    comments = await listCommentsImpl({ mediaId: next.reel.externalId, token, version });
  } catch {
    // A create attempt below records the actionable permission/API failure.
  }

  if (next.comment?.status !== 'published') {
    const reconciled = reconcileExactComment(comments, next.editorial.comments.first, { username });
    if (reconciled.status === 'ambiguous') {
      next.comment = {
        ...next.comment,
        status: 'manual_action_required',
        error: 'multiple matching top-level comments found',
        updatedAt: new Date().toISOString(),
      };
      return next;
    }
    if (reconciled.status === 'reconciled') {
      next.comment = {
        ...next.comment,
        status: 'published',
        externalId: String(reconciled.match.id),
        error: null,
        errorDetails: null,
        errorCode: null,
        updatedAt: new Date().toISOString(),
      };
    } else {
      try {
        const result = await createCommentImpl({
          mediaId: next.reel.externalId,
          message: next.editorial.comments.first,
          token,
          version,
        });
        next = applyIndependentStepOutcome(next, 'comment', { result });
      } catch (error) {
        return applyIndependentStepOutcome(next, 'comment', { error, secrets: [token] });
      }
    }
  }

  if (next.reply?.status === 'published' || next.comment?.status !== 'published') return next;
  const parent = comments.find(comment => String(comment.id) === String(next.comment.externalId));
  const reconciledReply = reconcileExactComment(replyList(parent), next.editorial.comments.reply, { username });
  if (reconciledReply.status === 'ambiguous') {
    next.reply = {
      ...next.reply,
      status: 'manual_action_required',
      error: 'multiple matching hashtag replies found',
      updatedAt: new Date().toISOString(),
    };
    return next;
  }
  if (reconciledReply.status === 'reconciled') {
    next.reply = {
      ...next.reply,
      status: 'published',
      externalId: String(reconciledReply.match.id),
      error: null,
      errorDetails: null,
      errorCode: null,
      updatedAt: new Date().toISOString(),
    };
    return next;
  }

  try {
    const result = await replyImpl({
      commentId: next.comment.externalId,
      message: next.editorial.comments.reply,
      token,
      version,
    });
    return applyIndependentStepOutcome(next, 'reply', { result });
  } catch (error) {
    if (isHashtagCountError(error)) {
      try {
        const result = await replyImpl({
          commentId: next.comment.externalId,
          message: next.editorial.comments.compactReply,
          token,
          version,
        });
        const compact = applyIndependentStepOutcome(next, 'reply', { result });
        compact.reply.usedCompactHashtags = true;
        compact.reply.originalHashtags = next.editorial.comments.hashtags;
        return compact;
      } catch (compactError) {
        return applyIndependentStepOutcome(next, 'reply', { error: compactError, secrets: [token] });
      }
    }
    return applyIndependentStepOutcome(next, 'reply', { error, secrets: [token] });
  }
}

function pendingStoryStep(value = {}) {
  return {
    status: 'planned',
    attempts: 0,
    externalId: null,
    error: null,
    updatedAt: null,
    ...value,
  };
}

function releaseAssetFilename(publication = {}) {
  return `${publication.publicationKey.replaceAll(':', '-')}.mp4`;
}

function storedReleaseVideoUrl(publication = {}) {
  if (publication.release?.videoUrl) return publication.release.videoUrl;
  if (publication.release?.tag && config.githubRepository) {
    return `https://github.com/${config.githubRepository}/releases/download/${encodeURIComponent(publication.release.tag)}/${encodeURIComponent(releaseAssetFilename(publication))}`;
  }
  return '';
}

async function ensureTemporaryRelease(publication, reelPath, {
  cleanupReleasesImpl,
  createReleaseImpl,
} = {}) {
  const existingUrl = storedReleaseVideoUrl(publication);
  if (existingUrl) {
    return {
      ...publication,
      release: { ...publication.release, videoUrl: existingUrl },
    };
  }
  if (!reelPath || !fs.existsSync(reelPath)) {
    throw new Error('[DIEM Publisher] Story source video is unavailable and no active temporary Release URL was recorded.');
  }
  await cleanupReleasesImpl({
    token: config.githubToken,
    repository: config.githubRepository,
    maxAgeHours: 72,
  }).catch(() => []);
  const uploadedReelSha256 = sha256File(reelPath);
  const release = await createReleaseImpl({
    assetPaths: [{ path: reelPath, filename: releaseAssetFilename(publication), contentType: 'video/mp4' }],
    token: config.githubToken,
    repository: config.githubRepository,
    runId: publication.publicationKey.replaceAll(':', '-'),
    targetCommitish: config.githubSha,
  });
  return {
    ...publication,
    release: {
      reelSha256: uploadedReelSha256,
      id: release.releaseId,
      tag: release.tag,
      videoUrl: release.videoUrl,
      createdAt: release.createdAt,
      deleteAfter: new Date(Date.now() + 72 * 3600000).toISOString(),
    },
  };
}

async function publishIndependentStory(publication, {
  videoUrl,
  token,
  publishStoryImpl,
} = {}) {
  const story = pendingStoryStep(publication.story);
  if (['published', 'manual_action_required', 'no_publish'].includes(story.status)) return publication;
  if (!config.publishInstagramStory) {
    if (config.manualReelStoryShare) {
      return {
        ...publication,
        story: {
          ...story,
          status: 'manual_action_required',
          error: MANUAL_REEL_STORY_SHARE_REASON,
          manualShareUrl: publication.reel?.permalink || null,
          mode: 'native_reel_share',
          updatedAt: new Date().toISOString(),
        },
      };
    }
    return {
      ...publication,
      story: { ...story, status: 'no_publish', error: 'story_disabled', updatedAt: new Date().toISOString() },
    };
  }

  const attempts = story.attempts + 1;
  try {
    if (!videoUrl) throw new Error('public Story video URL is missing');
    const result = await publishStoryImpl({
      videoUrl,
      userId: config.instagramUserId,
      token,
      version: config.instagramApiVersion,
    });
    return {
      ...publication,
      story: {
        ...story,
        status: 'published',
        attempts,
        externalId: String(result.id),
        containerId: result.containerId || null,
        permalink: result.permalink || null,
        error: null,
        errorDetails: null,
        errorCode: null,
        updatedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    const failed = nextFailedStep(story, error, { secrets: [token] });
    if (error.ambiguousExternalState) failed.status = 'manual_action_required';
    return { ...publication, story: failed };
  }
}

async function publishPreparedPublication(ledger, category, token, {
  cleanupReleasesImpl = cleanupExpiredReleases,
  createReleaseImpl = createTemporaryRelease,
  reconcileReelImpl = reconcileRecentReel,
  publishReelImpl = publishReel,
  publishStoryImpl = publishStory,
  searchInstagramAudioImpl = searchInstagramAudio,
  publishCommentsImpl = publishCommentChain,
} = {}) {
  let publication = structuredClone(ledger.publications[category]);
  if (!publication) throw new Error(`[DIEM Publisher] Missing ${category} publication.`);
  if (publication.status === 'no_publish') return ledger;
  publication.story = pendingStoryStep(publication.story);
  const reelPath = resolveArtifact(publication.artifacts?.reelPath);
  if (publication.reel.status !== 'published') {
    if (publication.status !== 'ready') throw new Error(`[DIEM Publisher] ${category} is not ready.`);
    if (!fs.existsSync(reelPath) && !storedReleaseVideoUrl(publication)) {
      throw new Error(`[DIEM Publisher] Prepared Reel is missing and no recorded Release asset is available: ${reelPath}`);
    }

    let reconciliation;
    try {
      reconciliation = await reconcileReelImpl({
        userId: config.instagramUserId,
        token,
        version: config.instagramApiVersion,
        expectedCaption: publication.editorial.caption.text,
        publicationDate: ledger.date,
      });
    } catch (error) {
      publication.reel = nextFailedStep(publication.reel, error, { secrets: [token] });
      publication.status = publication.reel.status;
      return updatePublication(ledger, category, publication);
    }
    if (reconciliation.status === 'ambiguous') {
      publication.reel = {
        ...publication.reel,
        status: 'manual_action_required',
        error: 'multiple matching Reels found during reconciliation',
        updatedAt: new Date().toISOString(),
      };
      return updatePublication(ledger, category, { ...publication, status: 'manual_action_required' });
    }
    if (reconciliation.status === 'reconciled') {
      publication.reel = {
        ...publication.reel,
        status: 'published',
        externalId: String(reconciliation.match.id),
        permalink: reconciliation.match.permalink || null,
        publishedAt: reconciliation.match.timestamp || reconciliation.match.publishedAt || new Date().toISOString(),
        reconciled: true,
        error: null,
        errorDetails: null,
        errorCode: null,
        updatedAt: new Date().toISOString(),
      };
      publication.status = 'published';
    } else {
      // Preauthored Basic packages already have their own immutable 5-card/19s approval contract.
      if (config.creativeReviewEnabled && publication.contentType !== 'diem_basic') assertCreativeBinding(publication);
      publication = await ensureTemporaryRelease(publication, reelPath, {
        cleanupReleasesImpl,
        createReleaseImpl,
      });
      try {
        const result = await publishReelImpl({
          videoUrl: publication.release.videoUrl,
          caption: publication.editorial.caption.text,
          userId: config.instagramUserId,
          token,
          version: config.instagramApiVersion,
        });

        publication.reel = {
          ...publication.reel,
          status: 'published',
          attempts: (publication.reel.attempts || 0) + 1,
          externalId: String(result.id),
          containerId: result.containerId || null,
          permalink: result.permalink || null,
          publishedAt: result.timestamp || new Date().toISOString(),
          error: null,
          errorDetails: null,
          errorCode: null,
          updatedAt: new Date().toISOString(),
        };
        publication.status = 'published';
      } catch (error) {
        publication.reel = nextFailedStep(publication.reel, error, { secrets: [token] });
        publication.status = publication.reel.status;
        return updatePublication(ledger, category, publication);
      }
    }
  }

  if (publication.reel.status === 'published'
    && !['published', 'manual_action_required', 'no_publish'].includes(publication.story?.status)) {
    if (!config.publishInstagramStory) {
      publication = await publishIndependentStory(publication, { token, publishStoryImpl });
    } else {
      let releaseReady = true;
      try {
        publication = await ensureTemporaryRelease(publication, reelPath, {
          cleanupReleasesImpl,
          createReleaseImpl,
        });
      } catch (error) {
        releaseReady = false;
        publication.story = nextFailedStep(pendingStoryStep(publication.story), error, { secrets: [token] });
      }
      if (releaseReady) {
        publication = await publishIndependentStory(publication, {
          videoUrl: storedReleaseVideoUrl(publication),
          token,
          publishStoryImpl,
        });
      }
    }
  }

  publication = await publishCommentsImpl(publication, { token });
  return updatePublication(ledger, category, publication);
}

module.exports = {
  artifactDirectory,
  isHashtagCountError,
  preparePublication,
  publishCommentChain,
  publishIndependentStory,
  publishPreparedPublication,
  selectedArticle,
  sha256File,
  stripEphemeralImageFields,
  sharesRecentImageKey,
};
