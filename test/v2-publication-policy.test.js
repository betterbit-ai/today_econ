const assert = require('node:assert/strict');
const test = require('node:test');

const { createDailyLedger, updatePublication } = require('../src/v2/ledger');
const { assessDailyPublicationBudget, dailyPublishedCount } = require('../src/v2/publication-policy');

test('counts each published publication key once and closes the category budget', () => {
  let ledger = createDailyLedger('2026-08-23');
  ledger = updatePublication(ledger, 'economy', {
    publicationKey: 'diem:2026-08-23:economy:first',
    status: 'published',
    reel: { status: 'published', externalId: 'ig-first' },
  });
  ledger.publicationHistory.push(structuredClone(ledger.publications.economy));

  assert.equal(dailyPublishedCount(ledger, 'economy'), 1);
  assert.deepEqual(assessDailyPublicationBudget(ledger, 'economy', { limit: 1 }), {
    allowed: false,
    reason: 'daily_publication_budget_exhausted',
    category: 'economy',
    published: 1,
    limit: 1,
    remaining: 0,
  });
  assert.equal(assessDailyPublicationBudget(ledger, 'issue', { limit: 1 }).allowed, true);
});
