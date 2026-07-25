const assert = require('node:assert/strict');
const test = require('node:test');

const { createDailyLedger, updatePublication } = require('../src/v2/ledger');
const {
  applyPlan,
  hasFrozenQueue,
  planPhase,
  runCategoryStep,
} = require('../src/v2/orchestrator');
const { transitionEvents } = require('../src/v2/operations');
const { nextDate } = require('../src/v2/index');

function plannedResult(date = '2026-07-25') {
  const selected = category => ({
    ok: true,
    selected: {
      title: `${category} 기사`,
      url: `https://example.com/${category}`,
      fullText: '검증된 기사 본문입니다.'.repeat(10),
      category,
    },
    corroboration: [{ url: `https://other.example/${category}` }],
    duplicateCheck: { duplicate: false, signature: { text: `${category} 서명` } },
  });
  return {
    date,
    popularityFallback: null,
    candidates: [],
    publications: {
      economy: selected('economy'),
      issue: selected('issue'),
    },
  };
}

test('18:30 planning freezes both fields in one daily queue', async () => {
  let calls = 0;
  const result = await planPhase({
    date: '2026-07-25',
    loadLedgerImpl: () => null,
    listLedgersImpl: () => [],
    planDailyQueueImpl: async () => {
      calls += 1;
      return plannedResult();
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.ledger.publications.economy.candidate.title, 'economy 기사');
  assert.equal(result.ledger.publications.issue.candidate.title, 'issue 기사');
  assert.equal(hasFrozenQueue(result.ledger), true);
});

test('21:00 reuses the frozen queue without selecting new news', async () => {
  const frozen = applyPlan(createDailyLedger('2026-07-25'), plannedResult());
  const result = await planPhase({
    date: '2026-07-25',
    loadLedgerImpl: () => frozen,
    listLedgersImpl: () => [],
    planDailyQueueImpl: async () => {
      throw new Error('must not reselect');
    },
  });
  assert.equal(result.reused, true);
  assert.equal(result.ledger.publications.issue.publicationKey, 'diem:2026-07-25:issue');
});

test('one field generation failure does not mutate the other field', async () => {
  const ledger = applyPlan(createDailyLedger('2026-07-25'), plannedResult());
  const failed = await runCategoryStep(ledger, 'economy', {
    phase: 'prepare',
    preparePublicationImpl: async () => {
      throw new Error('renderer failed');
    },
  });
  assert.equal(failed.publications.economy.status, 'retry_pending');
  assert.equal(failed.publications.economy.generation.attempts, 1);
  assert.equal(failed.publications.issue.status, 'planned');
  assert.equal(failed.publications.issue.generation, undefined);
});

test('manual retry skips an already published Reel and repairs comments only', async () => {
  let ledger = applyPlan(createDailyLedger('2026-07-25'), plannedResult());
  ledger = updatePublication(ledger, 'economy', {
    status: 'published',
    reel: { status: 'published', attempts: 1, externalId: 'reel-1' },
    comment: { status: 'retry_pending', attempts: 1, externalId: null },
  });
  let called = 0;
  const result = await runCategoryStep(ledger, 'economy', {
    phase: 'publish',
    token: 'token',
    publishPublicationImpl: async current => {
      called += 1;
      return updatePublication(current, 'economy', {
        comment: { status: 'published', attempts: 2, externalId: 'comment-1' },
        reply: { status: 'published', attempts: 1, externalId: 'reply-1' },
      });
    },
  });
  assert.equal(called, 1);
  assert.equal(result.publications.economy.reel.externalId, 'reel-1');
  assert.equal(result.publications.economy.comment.status, 'published');
});

test('transition events are independent and mark retries recovered', () => {
  const before = {
    publicationKey: 'diem:2026-07-25:economy',
    category: 'economy',
    status: 'published',
    candidate: { title: '금리 기사' },
    reel: { status: 'published', permalink: 'https://instagram.com/reel/1' },
    comment: { status: 'retry_pending', attempts: 1 },
    reply: { status: 'planned', attempts: 0 },
  };
  const after = structuredClone(before);
  after.comment = { status: 'published', attempts: 2, externalId: 'comment-1' };
  const events = transitionEvents(before, after);
  assert.equal(events.length, 1);
  assert.equal(events[0].stage, 'comment');
  assert.equal(events[0].status, 'recovered');
});

test('published history is rebuilt against the next KST day', () => {
  assert.equal(nextDate('2026-07-25'), '2026-07-26');
  assert.equal(nextDate('2026-12-31'), '2027-01-01');
});
