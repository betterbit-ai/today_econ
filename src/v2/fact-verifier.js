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

function sourceIdentity(article = {}) {
  if (article.publisher) return `publisher:${normalizeNfc(article.publisher).trim().toLowerCase()}`;
  const value = article.url || article.link || '';
  try {
    const url = new URL(value);
    const naverOffice = url.pathname.match(/\/article\/(\d{3})\//u)?.[1];
    if (naverOffice) return `naver-office:${naverOffice}`;
  } catch {
    // Fall through to the domain identity below.
  }
  return sourceDomain(value);
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
  const first = sourceIdentity(primary);
  const second = sourceIdentity(secondary);
  return Boolean(first && second && first !== second);
}

function extraordinaryClaims(article = {}) {
  const text = normalizeNfc(`${article.title || ''} ${String(article.fullText || article.summary || '').slice(0, 1800)}`);
  const claims = [];
  for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*배/gu)) {
    if (Number(match[1]) >= 10) claims.push({ kind: 'multiplier', value: `${match[1]}배` });
  }
  if (/(코스피|코스닥|증시|주가|종목|상한가|하한가)/u.test(text)) {
    for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*%/gu)) {
      if (Number(match[1]) >= 15) claims.push({ kind: 'market_percentage', value: `${match[1]}%` });
    }
  }
  for (const match of text.matchAll(/(세계\s*1위|사상\s*(?:첫|최대|최고)|역대\s*(?:최대|최고)|최대\s*일일\s*(?:상승|하락))/gu)) {
    claims.push({ kind: 'superlative', value: match[1].replace(/\s+/gu, '') });
  }
  const seen = new Set();
  return claims.filter(claim => {
    const key = `${claim.kind}:${claim.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function verifyExtraordinaryClaims(primary = {}, secondary = {}) {
  const errors = [];
  const claims = extraordinaryClaims(primary);
  if (claims.length === 0) return { ok: true, errors, claims, corroboratedBy: null };
  if (!isIndependentSource(primary, secondary)) errors.push('extraordinary evidence must use an independent publisher');
  if (canonicalUrl(primary.url || primary.link) === canonicalUrl(secondary.url || secondary.link)) {
    errors.push('extraordinary evidence cannot reuse the primary URL');
  }
  if (isLikelySyndicatedCopy(primary, secondary)) errors.push('extraordinary evidence appears to be syndicated copy');
  const evidence = normalizeEvidence(`${secondary.title || ''} ${secondary.fullText || secondary.summary || ''}`);
  const missing = claims.filter(claim => !evidence.includes(normalizeEvidence(claim.value)));
  if (missing.length > 0) errors.push(`unconfirmed extraordinary claims: ${missing.map(claim => claim.value).join(', ')}`);
  const titleOverlap = jaccardSimilarity(primary.title || '', secondary.title || '');
  const primaryTokens = extractSignatureTokens(primary.title || '');
  const sharedCore = primaryTokens.filter(token => evidence.includes(normalizeEvidence(token)));
  if (titleOverlap < 0.25 && sharedCore.length < 2) errors.push('extraordinary evidence does not describe the same event');
  return {
    ok: errors.length === 0,
    errors,
    claims,
    corroboratedBy: errors.length === 0 ? {
      title: secondary.title,
      url: secondary.url || secondary.link,
      domain: sourceDomain(secondary.url || secondary.link),
      sourceIdentity: sourceIdentity(secondary),
      checkedAt: new Date().toISOString(),
    } : null,
  };
}

function findExtraordinaryEvidence(primary, candidates = []) {
  return candidates
    .filter(candidate => isIndependentSource(primary, candidate))
    .map(candidate => ({ candidate, result: verifyExtraordinaryClaims(primary, candidate) }))
    .find(entry => entry.result.ok) || null;
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
  extraordinaryClaims,
  findExtraordinaryEvidence,
  findIndependentEvidence,
  isIndependentSource,
  isLikelySyndicatedCopy,
  normalizeEvidence,
  sourceDomain,
  sourceIdentity,
  verifyExtraordinaryClaims,
  verifyCoreClaims,
};
