function isUnattemptedPublication(publication = {}) {
  const reel = publication.reel || {};
  return ['planned', 'ready', 'draft', 'approved'].includes(publication.status)
    && [undefined, null, 'planned', 'ready', 'draft'].includes(reel.status)
    && Number(reel.attempts || 0) === 0
    && !reel.externalId && !reel.containerId && !reel.publishedAt && !reel.ambiguousExternalState;
}

function isPublished(publication = {}) {
  return publication.status === 'published'
    || publication.reel?.status === 'published'
    || Boolean(publication.reel?.externalId);
}

function dailyPublishedCount(ledger = {}, category) {
  const publications = [
    ...(ledger.publicationHistory || []),
    ...Object.values(ledger.publications || {}),
  ];
  const keys = new Set();
  for (const publication of publications) {
    if (publication?.category !== category || !isPublished(publication)) continue;
    keys.add(publication.publicationKey);
  }
  return keys.size;
}

function assessDailyPublicationBudget(ledger = {}, category, { limit = 1 } = {}) {
  const published = dailyPublishedCount(ledger, category);
  return {
    allowed: published < limit,
    reason: published < limit ? 'daily_publication_budget_available' : 'daily_publication_budget_exhausted',
    category,
    published,
    limit,
    remaining: Math.max(0, limit - published),
  };
}

module.exports = {
  isUnattemptedPublication,
  assessDailyPublicationBudget,
  dailyPublishedCount,
  isPublished,
};
