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

function plannedStep() {
  return { status: 'planned', attempts: 0, externalId: null, error: null, updatedAt: null };
}

function readyPublication(ledger, category) {
  return updatePublication(ledger, category, {
    status: 'ready',
    editorial: {
      title: { text: '좋은 경제\n핵심 요약' },
      caption: { text: '좋은 경제 기사입니다.📊\n\n핵심 근거가 정리됐습니다.\n\n다음 흐름을 지켜볼 내용입니다.🔎' },
      comments: { first: '📊', reply: '@diem.magazine #경제 #금융 #경제뉴스 #재테크초보 #뉴스요약 #릴스 #diem #diemmagazine #데일리이슈앤이코노미 #기준금리 #물가 #대출' },
    },
    reel: { ...plannedStep(), status: 'ready' },
  });
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

test('editorial generation failure reroutes the category to the next ranked candidate', async () => {
  let ledger = applyPlan(createDailyLedger('2026-07-27'), plannedResult('2026-07-27'));
  ledger.candidates = [
    { title: '나쁜 경제 기사', url: 'https://example.com/bad-economy', sources: [], rejectionReasons: [] },
    { title: '좋은 경제 기사', url: 'https://example.com/good-economy', sources: [], rejectionReasons: [] },
    { title: '시사 기사', url: 'https://example.com/issue', sources: [], rejectionReasons: [] },
  ];
  ledger = updatePublication(ledger, 'economy', {
    status: 'planned',
    candidate: { title: '나쁜 경제 기사', url: 'https://example.com/bad-economy', fullText: '본문입니다.'.repeat(20), category: 'economy' },
    reel: plannedStep(),
    comment: plannedStep(),
    reply: plannedStep(),
  });

  const preparedUrls = [];
  const evaluatedUrls = [];
  const result = await runCategoryStep(ledger, 'economy', {
    phase: 'prepare',
    preparePublicationImpl: async current => {
      const url = current.publications.economy.candidate.url;
      preparedUrls.push(url);
      if (url.includes('bad-economy')) {
        throw new Error('[DIEM Editorial] Model attempts failed and deterministic fallback is disabled; try the next candidate');
      }
      return readyPublication(current, 'economy');
    },
    evaluateCandidateImpl: async candidate => {
      evaluatedUrls.push(candidate.url);
      if (candidate.url.includes('good-economy')) {
        return {
          ok: true,
          selected: { title: candidate.title, url: candidate.url, fullText: '좋은 본문입니다.'.repeat(20), category: 'economy' },
          corroboration: null,
          duplicateCheck: { duplicate: false, signature: { text: '경제 | 좋은 경제 기사' } },
        };
      }
      return { ok: false, reason: 'assigned_to_issue' };
    },
  });

  assert.deepEqual(preparedUrls, ['https://example.com/bad-economy', 'https://example.com/good-economy']);
  assert.deepEqual(evaluatedUrls, ['https://example.com/good-economy']);
  assert.equal(result.publications.economy.status, 'ready');
  assert.equal(result.publications.economy.candidate.url, 'https://example.com/good-economy');
  assert.equal(result.publications.economy.generation.status, 'rerouted');
  assert.equal(result.publications.economy.generation.candidateFailures.length, 1);
  assert.ok(result.candidates[0].rejectionReasons.some(reason => reason.includes('economy:editorial_generation_failed')));
  assert.equal(result.publications.issue.status, 'planned');
});

test('editorial generation failure marks no_publish after candidate exhaustion', async () => {
  let ledger = applyPlan(createDailyLedger('2026-07-27'), plannedResult('2026-07-27'));
  ledger.candidates = [
    { title: '나쁜 경제 기사', url: 'https://example.com/bad-economy', sources: [], rejectionReasons: [] },
  ];
  ledger = updatePublication(ledger, 'economy', {
    status: 'planned',
    candidate: { title: '나쁜 경제 기사', url: 'https://example.com/bad-economy', fullText: '본문입니다.'.repeat(20), category: 'economy' },
    reel: plannedStep(),
    comment: plannedStep(),
    reply: plannedStep(),
  });

  const result = await runCategoryStep(ledger, 'economy', {
    phase: 'prepare',
    preparePublicationImpl: async () => {
      throw new Error('[DIEM Editorial] LLM generation is required; deterministic fallback is disabled for automatic publishing');
    },
  });

  assert.equal(result.publications.economy.status, 'no_publish');
  assert.equal(result.publications.economy.reason, 'no_candidate_passed_editorial_generation');
  assert.equal(result.publications.economy.reel.status, 'no_publish');
  assert.equal(result.publications.economy.generation.candidateFailures.length, 1);
  assert.ok(result.candidates[0].rejectionReasons.some(reason => reason.includes('economy:editorial_generation_failed')));
  assert.equal(result.publications.issue.status, 'planned');
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
