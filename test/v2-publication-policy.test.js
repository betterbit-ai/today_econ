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

test('allows one publication per category and closes before a second', () => {
  let ledger = createDailyLedger('2026-08-26');
  ledger = updatePublication(ledger, 'issue', {
    publicationKey: 'diem:2026-08-26:issue:1',
    status: 'published',
    reel: { status: 'published', externalId: 'ig-issue-1' },
  });
  assert.equal(dailyPublishedCount(ledger, 'issue'), 1);
  assert.deepEqual(assessDailyPublicationBudget(ledger, 'issue', { limit: 1 }), {
    allowed: false,
    reason: 'daily_publication_budget_exhausted',
    category: 'issue',
    published: 1,
    limit: 1,
    remaining: 0,
  });
});

test('two-per-category budget allows the second and blocks the third while deduplicating history', () => {
 let ledger = createDailyLedger('2026-10-18');
 ledger = updatePublication(ledger, 'economy', {publicationKey:'first',status:'published',reel:{externalId:'ig-first',status:'published'}});
 ledger.publicationHistory.push(structuredClone(ledger.publications.economy));
 assert.equal(assessDailyPublicationBudget(ledger,'economy',{limit:2}).remaining,1);
 assert.equal(assessDailyPublicationBudget(ledger,'economy',{limit:2}).allowed,true);
 ledger = updatePublication(ledger,'economy',{publicationKey:'second',status:'published',reel:{externalId:'ig-second',status:'published'}});
 assert.equal(assessDailyPublicationBudget(ledger,'economy',{limit:2}).allowed,false);
 assert.equal(assessDailyPublicationBudget(ledger,'economy',{limit:2}).published,2);
 assert.equal(assessDailyPublicationBudget(ledger,'issue',{limit:2}).remaining,2);
});
