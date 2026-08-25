const { validateEditorial } = require('./editorial');
const { assessImageSuitability } = require('./image-selector');

function validateImageQuality(image = {}) {
  const errors = [];
  if (!['web', 'generated', 'typographic'].includes(image.kind)) {
    errors.push('image must be a licensed web image, DIEM-generated asset, or DIEM-owned typographic art');
    return { ok: false, errors };
  }
  if (!image.license?.name) errors.push('image license evidence is missing');
  if (image.reuseGuard?.allowed === false) errors.push('image violates the seven-day reuse guard');

  if (image.kind === 'typographic') {
    if (image.source !== 'diem-original') errors.push('typographic art must be project-owned');
    if (!image.fallbackTheme || !image.visualFingerprint) {
      errors.push('typographic art must record a topic-grounded theme and stable fingerprint');
    }
    if (image.identity?.depicted === true) errors.push('typographic art cannot claim to depict a named person');
  }

  if (image.kind === 'generated') {
    if (image.source !== 'diem-generated') errors.push('generated fallback must be a project-owned DIEM asset');
    if (!image.assetPath || !image.localSha256 || !image.generatedTopic) {
      errors.push('generated fallback must record its asset path, hash, and topic');
    }
    if (image.identity?.depicted === true) errors.push('generated fallback cannot claim to depict a named person');
    if (image.suitability?.personScreening?.safe !== true) errors.push('generated fallback must have person-free safety evidence');
  }

  if (image.kind === 'web') {
    if (!['context', 'portrait'].includes(image.visualRole)) {
      errors.push('web image must record whether it is contextual or a verified portrait');
    }
    if (image.suitability?.ok !== true) errors.push('web image lacks positive topic-suitability evidence');
    if (image.visualRole === 'context' && image.suitability?.personScreening?.safe !== true) {
      errors.push('web image lacks positive unrelated-person screening evidence');
    }
    if (image.visualRole === 'portrait' && image.identity?.verified !== true) {
      errors.push('portrait image must have verified named-person identity');
    }
  }

  return { ok: errors.length === 0, errors };
}

function validatePreparedQuality({ article = {}, editorial = {}, image = {}, handle } = {}) {
  const editorialResult = validateEditorial(editorial, { article, handle });
  const imageResult = validateImageQuality(image);
  const finalImageReview = image.kind === 'web' && image.query && image.description
    ? assessImageSuitability(image, image.query, {
      ...article,
      editorialTitle: editorial.title?.text || editorial.title || '',
    }, {
      selectionRole: image.visualRole || 'context',
      requirePersonFreeEvidence: image.visualRole !== 'portrait',
    })
    : null;
  const errors = [
    ...editorialResult.errors.map(error => `editorial: ${error}`),
    ...imageResult.errors.map(error => `image: ${error}`),
    ...(finalImageReview && !finalImageReview.ok
      ? [`image: final context review failed (${finalImageReview.reason})`]
      : []),
  ];
  return {
    ok: errors.length === 0,
    errors,
    editorial: editorialResult,
    image: { ...imageResult, finalReview: finalImageReview },
  };
}

function assertPreparedQuality(input = {}) {
  const result = validatePreparedQuality(input);
  if (!result.ok) throw new Error(`[DIEM Quality] ${result.errors.join('; ')}`);
  return result;
}

module.exports = {
  assertPreparedQuality,
  validateImageQuality,
  validatePreparedQuality,
};
