const { extractMaterialNumbers } = require('../quality');
const { canonicalUrl } = require('./popular-news');
const { extractSignatureTokens, jaccardSimilarity } = require('./topic');
const { normalizeNfc } = require('./text');

function sourceDomain(value = '') {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function normalizeEvidence(value = '') {
  return normalizeNfc(value).replace(/[\s,]/g, '').toLowerCase();
}

function extractDateTokens(text = '') {
  return normalizeNfc(text).match(/\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{4}년\s*\d{1,2}월(?:\s*\d{1,2}일)?|\d{1,2}월\s*\d{1,2}일/gu) || [];
}

function extractCoreClaims(article = {}) {
  const text = normalizeNfc(`${article.title || ''}\n${article.fullText || article.summary || ''}`);
  const numbers = [...new Set(extractMaterialNumbers(text))];
  const dates = [...new Set(extractDateTokens(text).map(normalizeEvidence))];
  const tokens = extractSignatureTokens(`${article.title || ''} ${String(article.fullText || article.summary || '').slice(0, 1200)}`);
  const entities = [...new Set([...(article.entities || []), ...tokens.filter(token => (
    /[A-Z]{2,}|\d|은행|전자|그룹|위원회|정부|부|청|법|제도|정책/u.test(token)
  ))])].slice(0, 10);
  return { numbers, dates, entities, tokens: tokens.slice(0, 12) };
}

function isIndependentSource(primary = {}, secondary = {}) {
  const first = sourceDomain(primary.url || primary.link);
  const second = sourceDomain(secondary.url || secondary.link);
  return Boolean(first && second && first !== second);
}

function isLikelySyndicatedCopy(primary = {}, secondary = {}) {
  const left = normalizeNfc(primary.fullText || primary.summary || '').slice(0, 3000);
  const right = normalizeNfc(secondary.fullText || secondary.summary || '').slice(0, 3000);
  if (!left || !right) return false;
  return jaccardSimilarity(left, right) >= 0.9;
}

function verifyCoreClaims(primary = {}, secondary = {}) {
  const errors = [];
  if (!isIndependentSource(primary, secondary)) errors.push('corroboration must use a different domain');
  if (canonicalUrl(primary.url || primary.link) === canonicalUrl(secondary.url || secondary.link)) errors.push('corroboration cannot reuse the primary URL');
  if (isLikelySyndicatedCopy(primary, secondary)) errors.push('corroboration appears to be syndicated copy');

  const claims = extractCoreClaims(primary);
  const secondaryBody = normalizeEvidence(secondary.fullText || secondary.summary || '');
  const secondaryEvidence = normalizeEvidence(`${secondary.title || ''} ${secondary.fullText || secondary.summary || ''}`);
  const factualEvidence = secondaryBody || secondaryEvidence;
  const missingNumbers = claims.numbers.filter(number => !factualEvidence.includes(number));
  const missingDates = claims.dates.filter(date => !factualEvidence.includes(date));
  const sharedEntities = claims.entities.filter(entity => secondaryEvidence.includes(normalizeEvidence(entity)));
  const titleOverlap = jaccardSimilarity(primary.title || '', secondary.title || '');

  if (claims.numbers.length > 0 && missingNumbers.length > 0) errors.push(`unconfirmed numbers: ${missingNumbers.join(', ')}`);
  if (claims.dates.length > 0 && missingDates.length > 0) errors.push(`unconfirmed dates: ${missingDates.join(', ')}`);
  if (claims.entities.length > 0 && sharedEntities.length === 0 && titleOverlap < 0.3) errors.push('no shared core entity or event');

  return {
    ok: errors.length === 0,
    errors,
    claims,
    corroboratedBy: errors.length === 0 ? {
      title: secondary.title,
      url: secondary.url || secondary.link,
      domain: sourceDomain(secondary.url || secondary.link),
      checkedAt: new Date().toISOString(),
    } : null,
  };
}

function findIndependentEvidence(primary, candidates = []) {
  return candidates
    .filter(candidate => isIndependentSource(primary, candidate))
    .map(candidate => ({ candidate, result: verifyCoreClaims(primary, candidate) }))
    .find(entry => entry.result.ok) || null;
}

module.exports = {
  extractCoreClaims,
  extractDateTokens,
  findIndependentEvidence,
  isIndependentSource,
  isLikelySyndicatedCopy,
  normalizeEvidence,
  sourceDomain,
  verifyCoreClaims,
};
