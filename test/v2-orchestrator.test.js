const assert = require('node:assert/strict');
const test = require('node:test');

const { createDailyLedger, updatePublication } = require('../src/v2/ledger');
const {
  applyPlan,
  hasFrozenQueue,
  planCategoryPhase,
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

test('named-person image verification failure reroutes to the next ranked candidate', async () => {
  let ledger = applyPlan(createDailyLedger('2026-08-05'), plannedResult('2026-08-05'));
  ledger.candidates = [
    { title: '배우 세금 기사', url: 'https://example.com/person-tax', sources: [], rejectionReasons: [] },
    { title: '기준금리 기사', url: 'https://example.com/rate', sources: [], rejectionReasons: [] },
  ];
  ledger = updatePublication(ledger, 'economy', {
    status: 'planned',
    candidate: { title: '배우 세금 기사', url: 'https://example.com/person-tax', fullText: '본문입니다.'.repeat(20), category: 'economy' },
    reel: plannedStep(),
    comment: plannedStep(),
    reply: plannedStep(),
  });

  const preparedUrls = [];
  const result = await runCategoryStep(ledger, 'economy', {
    phase: 'prepare',
    preparePublicationImpl: async current => {
      const url = current.publications.economy.candidate.url;
      preparedUrls.push(url);
      if (url.includes('person-tax')) {
        throw new Error('[DIEM Image] named-person identity could not be verified: 유연석');
      }
      return readyPublication(current, 'economy');
    },
    evaluateCandidateImpl: async candidate => ({
      ok: true,
      selected: { title: candidate.title, url: candidate.url, fullText: '검증 본문입니다.'.repeat(20), category: 'economy' },
      corroboration: null,
      duplicateCheck: { duplicate: false, signature: { text: '경제 | 기준금리' } },
    }),
  });

  assert.deepEqual(preparedUrls, ['https://example.com/person-tax', 'https://example.com/rate']);
  assert.equal(result.publications.economy.status, 'ready');
  assert.equal(result.publications.economy.candidate.url, 'https://example.com/rate');
  assert.ok(result.candidates[0].rejectionReasons.some(reason => reason.includes('economy:image_identity_unverified')));
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

test('category polling archives a completed run but does not select beyond the daily budget', async () => {
  let existing = createDailyLedger('2026-07-29');
  existing.publications.economy = {
    ...existing.publications.economy,
    status: 'published',
    candidate: { title: '오전 경제 기사', url: 'https://example.com/morning' },
    duplicateCheck: { signature: { text: 'economy | 오전 경제 | 발표' } },
    reel: { status: 'published', attempts: 1, externalId: 'reel-morning' },
    story: { status: 'published', attempts: 1, externalId: 'story-morning' },
    comment: { status: 'published', attempts: 1, externalId: 'comment-morning' },
    reply: { status: 'published', attempts: 1, externalId: 'reply-morning' },
  };
  let plannerOptions = null;
  const result = await planCategoryPhase({
    date: '2026-07-29',
    category: 'economy',
    slot: 'run-1300',
    now: new Date('2026-07-29T04:00:00.000Z'),
    loadLedgerImpl: () => existing,
    listLedgersImpl: () => [existing],
    planDailyQueueImpl: async options => {
      plannerOptions = options;
      return {
        date: options.date,
        popularityFallback: null,
        candidates: [{ title: '오후 경제 기사', url: 'https://example.com/afternoon', rejectionReasons: [] }],
        publications: {
          economy: {
            ok: true,
            selected: {
              title: '오후 경제 기사',
              url: 'https://example.com/afternoon',
              fullText: '검증된 경제 기사 본문입니다.'.repeat(10),
              hotness: { ok: true, score: 88 },
            },
            duplicateCheck: { duplicate: false, signature: { text: 'economy | 오후 경제 | 발표' } },
            corroboration: null,
          },
        },
      };
    },
  });

  assert.equal(plannerOptions, null);
  assert.equal(result.ledger.publicationHistory.length, 1);
  assert.equal(result.ledger.publications.economy.publicationKey, 'diem:2026-07-29:economy:run-1300');
  assert.equal(result.ledger.publications.economy.status, 'no_publish');
  assert.equal(result.ledger.publications.economy.reason, 'daily_publication_budget_exhausted');
  assert.equal(result.ledger.publications.issue.candidate, null);
});

test('economy polling owns the daily floor when the next run would cross 24 hours', async () => {
  let prior = createDailyLedger('2026-08-01', new Date('2026-08-01T00:00:00.000Z'));
  prior = updatePublication(prior, 'issue', {
    status: 'published',
    reel: { status: 'published', externalId: 'reel-yesterday', updatedAt: '2026-08-01T00:00:00.000Z' },
  });
  const current = createDailyLedger('2026-08-02', new Date('2026-08-01T18:00:00.000Z'));
  let plannerOptions;

  const result = await planCategoryPhase({
    date: '2026-08-02',
    category: 'economy',
    slot: 'run-0500',
    now: new Date('2026-08-01T18:00:00.000Z'),
    loadLedgerImpl: () => current,
    listLedgersImpl: () => [prior, current],
    planDailyQueueImpl: async options => {
      plannerOptions = options;
      return {
        date: options.date,
        selectionMode: 'daily_floor',
        popularityFallback: null,
        candidates: [],
        publications: {
          economy: {
            ok: false,
            status: 'no_publish',
            reason: 'no_candidate_passed_daily_floor_gates',
            selectionDiagnostics: { candidateCount: 0, rejectionCounts: {} },
          },
        },
      };
    },
  });

  assert.equal(plannerOptions.hotMode, false);
  assert.equal(plannerOptions.dailyFloorMode, true);
  assert.equal(result.ledger.selectionMode, 'daily_floor');
  assert.equal(result.ledger.publications.economy.selectionDiagnostics.publicationHealth.dailyFloorDue, true);
});

test('issue polling never owns the rolling daily floor', async () => {
  const current = createDailyLedger('2026-08-02', new Date('2026-08-02T00:00:00.000Z'));
  let plannerOptions;
  await planCategoryPhase({
    date: '2026-08-02',
    category: 'issue',
    slot: 'run-0900',
    now: new Date('2026-08-02T00:00:00.000Z'),
    loadLedgerImpl: () => current,
    listLedgersImpl: () => [current],
    planDailyQueueImpl: async options => {
      plannerOptions = options;
      return {
        date: options.date,
        selectionMode: 'hot',
        popularityFallback: null,
        candidates: [],
        publications: { issue: { ok: false, status: 'no_publish', reason: 'no_candidate_passed_hotness_gate' } },
      };
    },
  });

  assert.equal(plannerOptions.hotMode, true);
  assert.equal(plannerOptions.dailyFloorMode, false);
});

test('daily watchdog emits a reason even when consecutive runs are both no_publish', () => {
  const before = {
    publicationKey: 'diem:2026-08-02:economy:old-run',
    category: 'economy',
    status: 'no_publish',
    reason: 'no_candidate_passed_hotness_gate',
  };
  const after = {
    publicationKey: 'diem:2026-08-02:economy:new-run',
    category: 'economy',
    status: 'no_publish',
    reason: 'no_candidate_passed_daily_floor_gates',
    selectionDiagnostics: {
      candidateCount: 50,
      rejectionCounts: {
        category_not_allowed: 43,
        'not_hot:article_too_old': 4,
      },
      publicationHealth: {
        lastPublishedAt: '2026-08-01T00:00:00.000Z',
        hoursSinceLastPublished: 25,
        watchdogAlertDue: true,
      },
    },
  };

  const events = transitionEvents(before, after);
  assert.equal(events.length, 1);
  assert.equal(events[0].stage, 'daily_watchdog');
  assert.equal(events[0].status, 'no_publish');
  assert.match(events[0].reason, /2026-08-01 09:00 KST/);
  assert.match(events[0].reason, /25시간/);
  assert.match(events[0].reason, /분야 부적합 43건/);
});

test('routine hot-news misses remain quiet even when a new run is archived', () => {
  const before = { publicationKey: 'old', category: 'issue', status: 'no_publish' };
  const after = {
    publicationKey: 'new',
    category: 'issue',
    status: 'no_publish',
    reason: 'no_candidate_passed_hotness_gate',
  };
  assert.deepEqual(transitionEvents(before, after), []);
});

test('category polling recovers an unfinished run before selecting another article', async () => {
  let existing = createDailyLedger('2026-07-29');
  existing = updatePublication(existing, 'issue', {
    status: 'retry_pending',
    candidate: { title: '복구할 시사 기사', url: 'https://example.com/retry' },
    reel: { status: 'retry_pending', attempts: 1, externalId: null },
  });
  let plannerCalls = 0;
  const result = await planCategoryPhase({
    date: '2026-07-29',
    category: 'issue',
    slot: 'run-1700',
    loadLedgerImpl: () => existing,
    listLedgersImpl: () => [existing],
    planDailyQueueImpl: async () => { plannerCalls += 1; },
  });

  assert.equal(plannerCalls, 0);
  assert.equal(result.recovery, true);
  assert.equal(result.ledger.publications.issue.candidate.title, '복구할 시사 기사');
});

test('category polling repairs pending comments after the Reel was published', async () => {
  let existing = createDailyLedger('2026-07-29');
  existing = updatePublication(existing, 'economy', {
    status: 'published',
    candidate: { title: '댓글 복구 경제 기사', url: 'https://example.com/comment-recovery' },
    reel: { status: 'published', attempts: 1, externalId: 'reel-comment-recovery' },
    comment: { status: 'planned', attempts: 0, externalId: null },
    reply: { status: 'planned', attempts: 0, externalId: null },
  });
  let plannerCalls = 0;
  const result = await planCategoryPhase({
    date: '2026-07-29',
    category: 'economy',
    slot: 'run-2100',
    loadLedgerImpl: () => existing,
    listLedgersImpl: () => [existing],
    planDailyQueueImpl: async () => { plannerCalls += 1; },
  });

  assert.equal(plannerCalls, 0);
  assert.equal(result.recovery, true);
  assert.equal(result.ledger.publications.economy.reel.externalId, 'reel-comment-recovery');
  assert.equal(result.ledger.publications.economy.comment.status, 'planned');
});

test('category polling repairs a pending Story before selecting another article', async () => {
  let existing = createDailyLedger('2026-07-30');
  existing = updatePublication(existing, 'issue', {
    status: 'published',
    candidate: { title: 'Story 복구 시사 기사', url: 'https://example.com/story-recovery' },
    reel: { status: 'published', attempts: 1, externalId: 'reel-story-recovery' },
    story: { status: 'retry_pending', attempts: 1, externalId: null, error: 'temporary outage' },
    comment: { status: 'published', attempts: 1, externalId: 'comment-story-recovery' },
    reply: { status: 'published', attempts: 1, externalId: 'reply-story-recovery' },
  });
  let plannerCalls = 0;
  const result = await planCategoryPhase({
    date: '2026-07-30',
    category: 'issue',
    slot: 'run-2100',
    loadLedgerImpl: () => existing,
    listLedgersImpl: () => [existing],
    planDailyQueueImpl: async () => { plannerCalls += 1; },
  });

  assert.equal(plannerCalls, 0);
  assert.equal(result.recovery, true);
  assert.equal(result.ledger.publications.issue.story.status, 'retry_pending');
  assert.equal(result.ledger.publications.issue.reel.externalId, 'reel-story-recovery');
});

test('category polling records no_publish without selecting after the daily budget is spent', async () => {
  let existing = createDailyLedger('2026-08-23');
  existing = updatePublication(existing, 'economy', {
    publicationKey: 'diem:2026-08-23:economy:first',
    status: 'published',
    candidate: { title: '오늘 첫 경제 기사', url: 'https://example.com/first' },
    reel: { status: 'published', attempts: 1, externalId: 'reel-first' },
    story: { status: 'published', attempts: 1, externalId: 'story-first' },
    comment: { status: 'published', attempts: 1, externalId: 'comment-first' },
    reply: { status: 'published', attempts: 1, externalId: 'reply-first' },
  });
  let plannerCalls = 0;
  const result = await planCategoryPhase({
    date: '2026-08-23',
    category: 'economy',
    slot: 'run-second',
    loadLedgerImpl: () => existing,
    listLedgersImpl: () => [existing],
    planDailyQueueImpl: async () => { plannerCalls += 1; },
  });

  assert.equal(plannerCalls, 0);
  assert.equal(result.budgetExhausted, true);
  assert.equal(result.ledger.publications.economy.status, 'no_publish');
  assert.equal(result.ledger.publications.economy.reason, 'daily_publication_budget_exhausted');
  assert.equal(result.ledger.publications.economy.publicationBudget.published, 1);
  assert.equal(result.ledger.publicationHistory.at(-1).publicationKey, 'diem:2026-08-23:economy:first');

  const repeated = await planCategoryPhase({
    date: '2026-08-23',
    category: 'economy',
    slot: 'run-third',
    loadLedgerImpl: () => result.ledger,
    listLedgersImpl: () => [result.ledger],
    planDailyQueueImpl: async () => { plannerCalls += 1; },
  });
  assert.equal(repeated.reused, true);
  assert.equal(repeated.ledger.publications.economy.publicationKey, result.ledger.publications.economy.publicationKey);
  assert.equal(plannerCalls, 0);
});

test('Story recovery is publish work even when Reel and comments are already complete', async () => {
  let ledger = createDailyLedger('2026-07-30');
  ledger = updatePublication(ledger, 'economy', {
    status: 'published',
    candidate: { title: 'Story 재시도 경제 기사', url: 'https://example.com/story' },
    reel: { status: 'published', attempts: 1, externalId: 'reel-1' },
    story: { status: 'retry_pending', attempts: 1, externalId: null, error: 'retry' },
    comment: { status: 'published', attempts: 1, externalId: 'comment-1' },
    reply: { status: 'published', attempts: 1, externalId: 'reply-1' },
  });
  let calls = 0;
  const result = await runCategoryStep(ledger, 'economy', {
    phase: 'publish',
    token: 'token',
    publishPublicationImpl: async current => {
      calls += 1;
      return updatePublication(current, 'economy', {
        story: { status: 'published', attempts: 2, externalId: 'story-1', error: null },
      });
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.publications.economy.story.status, 'published');
});

test('Story transitions emit their own retry and recovery events', () => {
  const before = {
    publicationKey: 'diem:2026-07-30:economy:run-2100',
    category: 'economy',
    status: 'published',
    candidate: { title: '반도체 기사' },
    reel: { status: 'published', permalink: 'https://instagram.com/reel/1' },
    story: { status: 'retry_pending', attempts: 1, error: 'temporary outage' },
  };
  const after = structuredClone(before);
  after.story = { status: 'published', attempts: 2, externalId: 'story-1', error: null };
  const events = transitionEvents(before, after);
  assert.equal(events.length, 1);
  assert.equal(events[0].stage, 'story');
  assert.equal(events[0].status, 'recovered');
});
