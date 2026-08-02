const { allLedgerPublications } = require('./ledger');

function validInstant(value) {
  const instant = value instanceof Date ? value : new Date(value || '');
  return Number.isNaN(instant.getTime()) ? null : instant;
}

function elapsedHours(since, now) {
  if (!since) return 0;
  return Math.max(0, (now.getTime() - since.getTime()) / 3600000);
}

function latestInstant(values = []) {
  return values
    .map(validInstant)
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime())[0] || null;
}

function publishedReelInstant(publication = {}) {
  const published = publication.reel?.status === 'published'
    || (publication.status === 'published' && Boolean(publication.reel?.externalId));
  if (!published) return null;
  return validInstant(
    publication.reel?.updatedAt
      || publication.reel?.publishedAt
      || publication.publishedAt
  );
}

function latestWatchdogInstant(ledgers = []) {
  return latestInstant(ledgers.flatMap(ledger => (
    allLedgerPublications(ledger)
      .flatMap(publication => publication.notifications || [])
      .filter(notification => notification.stage === 'daily_watchdog')
      .map(notification => notification.sentAt)
  )));
}

function assessPublicationHealth(ledgers = [], {
  now = new Date(),
  dailyFloorAfterHours = 20,
  overdueAfterHours = 24,
  alertCooldownHours = 24,
} = {}) {
  const current = validInstant(now) || new Date();
  const lastPublished = latestInstant(ledgers.flatMap(ledger => (
    allLedgerPublications(ledger).map(publishedReelInstant)
  )));
  const monitoringStarted = latestInstant(ledgers.map(ledger => ledger.createdAt).filter(Boolean).sort().slice(0, 1));
  const baseline = lastPublished || monitoringStarted || current;
  const hoursSinceLastPublished = elapsedHours(baseline, current);
  const lastWatchdog = latestWatchdogInstant(ledgers);
  const hoursSinceWatchdog = lastWatchdog ? elapsedHours(lastWatchdog, current) : null;
  const overdue = hoursSinceLastPublished >= overdueAfterHours;

  return {
    lastPublishedAt: lastPublished?.toISOString() || null,
    monitoringStartedAt: monitoringStarted?.toISOString() || null,
    hoursSinceLastPublished: Number(hoursSinceLastPublished.toFixed(2)),
    dailyFloorDue: hoursSinceLastPublished >= dailyFloorAfterHours,
    overdue,
    watchdogAlertDue: overdue && (!lastWatchdog || hoursSinceWatchdog >= alertCooldownHours),
    lastWatchdogAt: lastWatchdog?.toISOString() || null,
    thresholds: {
      dailyFloorAfterHours,
      overdueAfterHours,
      alertCooldownHours,
    },
  };
}

module.exports = {
  assessPublicationHealth,
  latestWatchdogInstant,
  publishedReelInstant,
};
