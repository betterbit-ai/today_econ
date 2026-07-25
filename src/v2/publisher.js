const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { cleanupExpiredReleases, createTemporaryRelease } = require('../github-assets');
const { publishReel, publishStory, searchInstagramAudio } = require('../instagram');
const { generateEditorial } = require('./editorial');
const { createGroqCaller } = require('./groq');
const { downloadSelectedImage, selectLicensedImage } = require('./image-selector');
const {
  applyIndependentStepOutcome,
  createTopLevelComment,
  listComments,
  reconcileExactComment,
  reconcileRecentReel,
  replyToComment,
} = require('./instagram');
const { updatePublication } = require('./ledger');
const { selectMusic } = require('./music');
const { createDiemReelWithMusic } = require('./reel');
const { renderDiemCover } = require('./cover');
const { isSensitiveTopic } = require('./topic');

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

async function preparePublication(ledger, category, {
  callModel,
  selectImageImpl = selectLicensedImage,
  downloadImageImpl = downloadSelectedImage,
  renderCoverImpl = renderDiemCover,
  selectMusicImpl = selectMusic,
  createReelImpl = createDiemReelWithMusic,
  artifactRoot,
  history = [],
} = {}) {
  const publication = ledger.publications[category];
  if (!publication) throw new Error(`[DIEM Publisher] Missing ${category} publication.`);
  if (publication.status === 'no_publish' || publication.reel?.status === 'published') return ledger;
  const article = selectedArticle(publication);
  const outputDir = artifactDirectory(ledger, category, artifactRoot);
  fs.mkdirSync(outputDir, { recursive: true });

  const modelCaller = callModel || (config.groqApiKey ? createGroqCaller({ apiKey: config.groqApiKey }) : undefined);
  const editorial = await generateEditorial(article, {
    callModel: modelCaller,
    primaryModel: config.groqPrimaryModel,
    fallbackModel: config.groqFallbackModel,
    handle: config.instagramUsername,
  });

  let imageSelection = await selectImageImpl(article, {
    pexelsApiKey: config.pexelsApiKey,
    unsplashAccessKey: config.unsplashAccessKey,
  });
  let downloaded = imageSelection;
  if (imageSelection.kind === 'web') {
    try {
      downloaded = await downloadImageImpl(imageSelection, { outputDir });
    } catch (error) {
      imageSelection = {
        ...imageSelection,
        kind: 'typographic',
        source: 'diem-original',
        downloadError: error.message,
        selectionReason: 'licensed image download failed; typography fallback used',
      };
      downloaded = imageSelection;
    }
  }

  const coverPath = path.join(outputDir, `${category}-cover.png`);
  await renderCoverImpl({
    editorial,
    date: ledger.date,
    category,
    imagePath: downloaded.localPath,
    outputPath: coverPath,
  });

  // const music = selectMusicImpl({
  //   category,
  //   history,
  //   publicationKey: publication.publicationKey,
  //   topic: article,
  //   sensitive: isSensitiveTopic(article),
  // });
  const music = null; // Audio disabled by user feedback
  const reelPath = path.join(outputDir, `${category}-reel.mp4`);
  const reelResult = await createReelImpl({
    imagePath: coverPath,
    outputPath: reelPath,
    music,
  });
  const preparedAt = new Date().toISOString();

  return updatePublication(ledger, category, {
    status: 'ready',
    editorial,
    image: {
      ...stripEphemeralImageFields(imageSelection),
      localSha256: downloaded.sha256 || sha256File(coverPath),
    },
    audio: reelResult.audio,
    artifacts: {
      coverPath: path.relative(process.cwd(), coverPath),
      coverSha256: sha256File(coverPath),
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
        return applyIndependentStepOutcome(next, 'comment', { error });
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
        return applyIndependentStepOutcome(next, 'reply', { error: compactError });
      }
    }
    return applyIndependentStepOutcome(next, 'reply', { error });
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
  if (publication.reel.status !== 'published') {
    if (publication.status !== 'ready') throw new Error(`[DIEM Publisher] ${category} is not ready.`);
    const reelPath = resolveArtifact(publication.artifacts?.reelPath);
    if (!fs.existsSync(reelPath)) throw new Error(`[DIEM Publisher] Prepared Reel is missing: ${reelPath}`);

    const reconciliation = await reconcileReelImpl({
      userId: config.instagramUserId,
      token,
      version: config.instagramApiVersion,
      expectedCaption: publication.editorial.caption.text,
      publicationDate: ledger.date,
    });
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
        reconciled: true,
        error: null,
        updatedAt: new Date().toISOString(),
      };
      publication.status = 'published';
    } else {
      await cleanupReleasesImpl({
        token: config.githubToken,
        repository: config.githubRepository,
        maxAgeHours: 72,
      }).catch(() => []);
      const release = await createReleaseImpl({
        assetPaths: [{ path: reelPath, filename: `${publication.publicationKey.replaceAll(':', '-')}.mp4`, contentType: 'video/mp4' }],
        token: config.githubToken,
        repository: config.githubRepository,
        runId: publication.publicationKey.replaceAll(':', '-'),
        targetCommitish: config.githubSha,
      });
      publication.release = {
        id: release.releaseId,
        tag: release.tag,
        createdAt: release.createdAt,
        deleteAfter: new Date(Date.now() + 72 * 3600000).toISOString(),
      };
      try {
        const searchQueries = ['lofi beat', 'vlog music', 'news background', 'corporate upbeat'];
        const query = searchQueries[Math.floor(Math.random() * searchQueries.length)];
        let audioConfiguration = undefined;
        try {
          const audioResults = await searchInstagramAudioImpl({
            query,
            userId: config.instagramUserId,
            token,
            version: config.instagramApiVersion,
          });
          if (audioResults && audioResults.length > 0) {
            audioConfiguration = {
              audio_id: String(audioResults[0].id || audioResults[0].ig_artist?.id), // some endpoints use different keys, but id is standard
              audio_volume: 100,
              video_volume: 0,
            };
          }
        } catch (audioError) {
          console.error('[DIEM Publisher] Audio search failed, falling back to silent Reel:', audioError.message);
        }

        const result = await publishReelImpl({
          videoUrl: release.videoUrl,
          caption: publication.editorial.caption.text,
          userId: config.instagramUserId,
          audioConfiguration,
          token,
          version: config.instagramApiVersion,
        });

        let storyResult = null;
        try {
          storyResult = await publishStoryImpl({
            videoUrl: release.videoUrl,
            userId: config.instagramUserId,
            token,
            version: config.instagramApiVersion,
          });
        } catch (storyError) {
          console.error('[DIEM Publisher] Story publish failed:', storyError.message);
        }

        publication.reel = {
          ...publication.reel,
          status: 'published',
          attempts: (publication.reel.attempts || 0) + 1,
          externalId: String(result.id),
          containerId: result.containerId || null,
          permalink: result.permalink || null,
          error: null,
          updatedAt: new Date().toISOString(),
        };
        if (storyResult) {
          publication.story = {
            status: 'published',
            externalId: String(storyResult.id),
            updatedAt: new Date().toISOString(),
          };
        }
        publication.status = 'published';
      } catch (error) {
        const attempts = (publication.reel.attempts || 0) + 1;
        publication.reel = {
          ...publication.reel,
          status: attempts >= 3 ? 'manual_action_required' : 'retry_pending',
          attempts,
          error: error.message,
          updatedAt: new Date().toISOString(),
        };
        publication.status = publication.reel.status;
        return updatePublication(ledger, category, publication);
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
  publishPreparedPublication,
  selectedArticle,
  sha256File,
  stripEphemeralImageFields,
};
