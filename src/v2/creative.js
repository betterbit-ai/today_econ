const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const fileHash = filename => crypto.createHash('sha256').update(fs.readFileSync(path.resolve(filename))).digest('hex');
const { getMood, isSensitiveTopic } = require('./music');
const briefHash = brief => crypto.createHash('sha256').update(JSON.stringify(brief)).digest('hex');

function creativeBrief(article = {}, editorial = {}) {
  const title = editorial.title?.text || '';
  const caption = editorial.caption?.text || '';
  const core = `${article.title || ''} ${title} ${caption}`.normalize('NFC');
  const sensitive = isSensitiveTopic(core) || /식중독|간부전|장기\s*손상|중증/u.test(core);
  return { schemaVersion: 1, title, caption,
    sourceSha256: crypto.createHash('sha256').update(String(article.fullText || '').normalize('NFC')).digest('hex'),
    imageKeyword: editorial.imageKeyword || null,
    mood: sensitive || /대통령|의원|법원|재판|정치|과세|세금/u.test(core) ? 'serious' : getMood(core), sensitive };
}

async function reviewRenderedCreative({ article, brief, coverPath, reviewImages }) {
  if (typeof reviewImages !== 'function') throw new Error('[DIEM Quality] final visual reviewer unavailable');
  const pixels = fs.readFileSync(coverPath);
  if (pixels.length > 8 * 1024 * 1024) throw new Error('[DIEM Quality] rendered cover exceeds review limit');
  // Reuse the existing public-title/600-character-summary Vision contract.
  // The source body stays local; no new destination or full-article payload.
  const candidate = { title: article.title, newsFrame: article.newsFrame,
    editorialTitle: brief.title,
    summary: `${String(article.summary || '').slice(0, 180)} 최종 본문: ${brief.caption}`.slice(0, 600) };
  const result = await reviewImages({ candidate, query: 'final rendered news cover: image must match the exact headline and caption',
    images: [{ id: 'rendered-cover', reviewUrl: 'data:image/png;base64,' + pixels.toString('base64') }] });
  if (result?.ok !== true || result.selectedId !== 'rendered-cover') {
    throw new Error('[DIEM Quality] final creative image mismatch: ' + String(result?.reason || 'no affirmative visual review').slice(0, 350));
  }
  return { ...result, reviewedArtifactSha256: crypto.createHash('sha256').update(pixels).digest('hex'),
    sourceSha256: brief.sourceSha256,
    briefSha256: briefHash(brief),
    audioReview: 'deterministic_mood_and_track_metadata_only', reviewedAt: new Date().toISOString() };
}

function assertCreativeBinding(publication) {
  const review = publication.creativeReview || {};
  if (review.ok !== true || !review.reviewedArtifactSha256
    || review.reviewedArtifactSha256 !== publication.artifacts?.coverSha256
    || !review.reviewedReelSha256
    || review.reviewedReelSha256 !== publication.artifacts?.reelSha256
    || review.briefSha256 !== briefHash(creativeBrief(publication.candidate, publication.editorial))) {
    throw new Error('[DIEM Quality] creative approval is missing or no longer matches this cover and editorial');
  }
  if ((publication.release?.videoUrl || publication.release?.tag) && publication.release.reelSha256 !== review.reviewedReelSha256) {
    throw new Error('[DIEM Quality] stored Release does not match reviewed Reel');
  }
  const { coverPath, reelPath } = publication.artifacts || {};
  if (coverPath && fs.existsSync(path.resolve(coverPath)) && fileHash(coverPath) !== review.reviewedArtifactSha256) {
    throw new Error('[DIEM Quality] reviewed cover bytes changed');
  }
  if (reelPath && fs.existsSync(path.resolve(reelPath))) {
    if (fileHash(reelPath) !== review.reviewedReelSha256) throw new Error('[DIEM Quality] reviewed Reel bytes changed');
  } else if (!publication.release?.videoUrl || publication.release.reelSha256 !== review.reviewedReelSha256) {
    throw new Error('[DIEM Quality] reviewed Reel has no matching local or Release evidence');
  }
}

module.exports = { creativeBrief, reviewRenderedCreative, assertCreativeBinding };
