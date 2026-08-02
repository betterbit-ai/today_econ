const assert = require('node:assert/strict');
const test = require('node:test');

const { createDailyLedger, updatePublication } = require('../src/v2/ledger');
const { assessPublicationHealth } = require('../src/v2/publication-health');

function publishedLedger(updatedAt = '2026-08-01T00:00:00.000Z') {
  let ledger = createDailyLedger('2026-08-01', new Date(updatedAt));
  ledger = updatePublication(ledger, 'economy', {
    status: 'published',
    reel: { status: 'published', externalId: 'reel-1', updatedAt },
  });
  return ledger;
}

test('starts the daily floor before the next four-hour run would cross 24 hours', () => {
  const ledger = publishedLedger();
  const early = assessPublicationHealth([ledger], {
    now: new Date('2026-08-01T19:59:00.000Z'),
  });
  const due = assessPublicationHealth([ledger], {
    now: new Date('2026-08-01T20:00:00.000Z'),
  });

  assert.equal(early.dailyFloorDue, false);
  assert.equal(early.overdue, false);
  assert.equal(due.dailyFloorDue, true);
  assert.equal(due.overdue, false);
  assert.equal(due.lastPublishedAt, '2026-08-01T00:00:00.000Z');
});

test('alerts after 24 hours and suppresses another watchdog alert for one day', () => {
  const ledger = publishedLedger();
  const overdue = assessPublicationHealth([ledger], {
    now: new Date('2026-08-02T01:00:00.000Z'),
  });
  assert.equal(overdue.overdue, true);
  assert.equal(overdue.watchdogAlertDue, true);

  ledger.publications.issue.notifications = [{
    key: 'watchdog',
    stage: 'daily_watchdog',
    status: 'no_publish',
    sentAt: '2026-08-02T00:30:00.000Z',
  }];
  const suppressed = assessPublicationHealth([ledger], {
    now: new Date('2026-08-02T01:00:00.000Z'),
  });
  assert.equal(suppressed.watchdogAlertDue, false);
});
