const { normalizeNfc } = require('./text');

const URGENT_NEWS = /사이드카|서킷브레이커|거래정지|매매정지|긴급\s*(?:정책|결정|회의|명령|조치|대책|브리핑|금리)|비상\s*(?:계엄|회의|대책|조치|경영)|기준금리\s*(?:인상|인하|동결)|환율[^.!?]{0,20}(?:급등|급락)|(?:코스피|코스닥|증시)[^.!?]{0,20}(?:폭락|폭등|급락|급등)/u;

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function parsedInstant(value) {
  if (!value) return null;
  const normalized = String(value).trim();
  const kstLocal = normalized.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/u);
  const instant = value instanceof Date
    ? value
    : new Date(kstLocal ? `${kstLocal[1]}T${kstLocal[2]}+09:00` : normalized);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function hoursBetween(earlier, later) {
  return Math.max(0, (later.getTime() - earlier.getTime()) / 3600000);
}

function freshnessScore(ageHours) {
  if (!Number.isFinite(ageHours)) return 0;
  if (ageHours <= 2) return 100;
  if (ageHours <= 4) return 90;
  if (ageHours <= 6) return 80;
  if (ageHours <= 12) return 70;
  if (ageHours <= 24) return 25;
  return 0;
}

function assessHotness(candidate = {}, {
  now = new Date(),
  regularPopularityMinimum = 70,
  regularMaximumAgeHours = 12,
  regularScoreMinimum = 70,
  urgentPopularityMinimum = 50,
  urgentMaximumAgeHours = 6,
  urgentScoreMinimum = 65,
  unknownTimePopularityMinimum = 90,
  unknownTimeEditorialMinimum = 60,
} = {}) {
  const current = parsedInstant(now) || new Date();
  const parsedPublished = parsedInstant(candidate.publishedAt);
  const observed = parsedInstant(candidate.observedAt);
  const publishedIsFuture = parsedPublished
    && (parsedPublished.getTime() > current.getTime() + 300000
      || (observed && parsedPublished.getTime() > observed.getTime() + 300000));
  const published = publishedIsFuture ? null : parsedPublished;
  const popularity = clamp(candidate.popularityScore);
  const editorial = clamp(candidate.editorialValue?.score ?? candidate.editorialScore);
  const urgent = URGENT_NEWS.test(normalizeNfc(`${candidate.title || ''} ${candidate.summary || ''} ${candidate.fullText || ''}`));
  const urgencyBonus = urgent ? 10 : 0;
  const freshnessSource = published ? 'article_published_at' : 'ranking_observed_at';
  const freshnessInstant = published || observed || current;
  const ageHours = hoursBetween(freshnessInstant, current);
  const freshness = published ? freshnessScore(ageHours) : (ageHours <= 4 ? 70 : 0);
  const score = Number(Math.min(100, popularity * 0.55 + freshness * 0.3 + editorial * 0.15 + urgencyBonus).toFixed(2));

  let ok;
  let reason;
  if (candidate.popularitySignalReliable === false) {
    ok = false;
    reason = 'popularity_signal_unavailable';
  } else if (!published) {
    ok = ageHours <= 4
      && popularity >= unknownTimePopularityMinimum
      && editorial >= unknownTimeEditorialMinimum;
    reason = ok
      ? 'hot_without_article_timestamp'
      : ageHours > 4
        ? 'ranking_observation_too_old'
        : popularity < unknownTimePopularityMinimum
          ? 'published_at_missing_and_rank_too_low'
          : 'published_at_missing_and_editorial_value_too_low';
  } else if (urgent) {
    ok = popularity >= urgentPopularityMinimum
      && ageHours <= urgentMaximumAgeHours
      && score >= urgentScoreMinimum;
    reason = ok
      ? 'urgent_hot_news'
      : ageHours > urgentMaximumAgeHours
        ? 'article_too_old'
        : popularity < urgentPopularityMinimum
          ? 'popularity_below_urgent_threshold'
          : 'hot_score_below_urgent_threshold';
  } else {
    ok = popularity >= regularPopularityMinimum
      && ageHours <= regularMaximumAgeHours
      && score >= regularScoreMinimum;
    reason = ok
      ? 'regular_hot_news'
      : ageHours > regularMaximumAgeHours
        ? 'article_too_old'
        : popularity < regularPopularityMinimum
          ? 'popularity_below_threshold'
          : 'hot_score_below_threshold';
  }

  return {
    ok,
    reason,
    score,
    popularityScore: popularity,
    freshnessScore: freshness,
    editorialValueScore: editorial,
    ageHours: Number(ageHours.toFixed(2)),
    publishedAt: published ? candidate.publishedAt : null,
    observedAt: candidate.observedAt || current.toISOString(),
    freshnessSource,
    usedPublishedAtFallback: !published,
    publishedAtInvalidReason: publishedIsFuture ? 'published_at_in_future' : null,
    urgent,
    urgencyBonus,
    popularitySignalReliable: candidate.popularitySignalReliable !== false,
    thresholds: urgent
      ? { popularity: urgentPopularityMinimum, maximumAgeHours: urgentMaximumAgeHours, score: urgentScoreMinimum }
      : published
        ? { popularity: regularPopularityMinimum, maximumAgeHours: regularMaximumAgeHours, score: regularScoreMinimum }
        : { popularity: unknownTimePopularityMinimum, maximumAgeHours: 4, editorial: unknownTimeEditorialMinimum },
  };
}

module.exports = {
  URGENT_NEWS,
  assessHotness,
  freshnessScore,
};
