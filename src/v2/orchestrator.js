const config = require('../../config');
const { resolveInstagramToken } = require('../token-vault');
const { CATEGORIES } = require('./constants');
const {
  createDailyLedger,
  listLedgers,
  loadLedger,
  saveLedger,
  updatePublication,
} = require('./ledger');
const { notifyTransitions } = require('./operations');
const { planDailyQueue } = require('./planner');
const { preparePublication, publishPreparedPublication } = require('./publisher');
const { kstDate } = require('./time');

const CATEGORY_ORDER = [CATEGORIES.ECONOMY, CATEGORIES.ISSUE];

function selectedCategories(category) {
  if (!category) return CATEGORY_ORDER;
  if (!CATEGORY_ORDER.includes(category)) throw new Error(`[DIEM] Unknown category: ${category}`);
  return [category];
}

function hasFrozenQueue(ledger) {
  return CATEGORY_ORDER.every(category => (
    Boolean(ledger.publications[category].candidate)
    || ledger.publications[category].status === 'no_publish'
  ));
}

function applyPlan(ledger, plan) {
  let next = structuredClone(ledger);
  next.popularityFallback = plan.popularityFallback;
  next.candidates = plan.candidates;
  for (const category of CATEGORY_ORDER) {
    const result = plan.publications[category];
    if (result?.ok) {
      next.publications[category] = {
        publicationKey: next.publications[category]?.publicationKey || `${category}:${new Date().toISOString()}`,
        category,
        status: 'planned',
        reason: null,
        candidate: result.selected,
        corroboration: result.corroboration,
        duplicateCheck: result.duplicateCheck,
        reel: { status: 'planned', attempts: 0, externalId: null, error: null, updatedAt: null },
        comment: { status: 'planned', attempts: 0, externalId: null, error: null, updatedAt: null },
        reply: { status: 'planned', attempts: 0, externalId: null, error: null, updatedAt: null },
      };
      next.updatedAt = new Date().toISOString();
      continue;
    }
    next = updatePublication(next, category, {
      status: 'no_publish',
      reason: result?.reason || 'no_candidate_passed_quality_gates',
      reel: { ...next.publications[category]?.reel, status: 'no_publish' },
      comment: { ...next.publications[category]?.comment, status: 'no_publish' },
      reply: { ...next.publications[category]?.reply, status: 'no_publish' },
    });
  }
  return next;
}

async function planPhase({
  date = kstDate(),
  force = false,
  loadLedgerImpl = loadLedger,
  listLedgersImpl = listLedgers,
  planDailyQueueImpl = planDailyQueue,
  historyBuilder,
} = {}) {
  const existing = loadLedgerImpl(date);
  if (existing && hasFrozenQueue(existing) && !force) {
    return { ledger: existing, previousLedger: structuredClone(existing), reused: true };
  }
  const ledger = existing || createDailyLedger(date);
  const history = historyBuilder
    ? historyBuilder(listLedgersImpl(), date)
    : require('./ledger').historyFromLedgers(listLedgersImpl(), date, config.maxHistoryDays);
  const plan = await planDailyQueueImpl({ date, history });
  return { ledger: applyPlan(ledger, plan), previousLedger: structuredClone(ledger), reused: false };
}

function failedGenerationPublication(publication, error, now = new Date()) {
  const attempts = Math.max(0, Number(publication.generation?.attempts) || 0) + 1;
  const status = attempts >= 3 ? 'manual_action_required' : 'retry_pending';
  return {
    ...publication,
    status,
    generation: {
      status,
      attempts,
      error: error.message,
      updatedAt: now.toISOString(),
    },
  };
}

function failedPublishPublication(publication, error, now = new Date()) {
  const attempts = Math.max(0, Number(publication.reel?.attempts) || 0) + 1;
  const status = attempts >= 3 ? 'manual_action_required' : 'retry_pending';
  return {
    ...publication,
    status,
    reel: {
      ...publication.reel,
      status,
      attempts,
      error: error.message,
      updatedAt: now.toISOString(),
    },
  };
}

async function runCategoryStep(ledger, category, {
  phase,
  history = [],
  token,
  preparePublicationImpl = preparePublication,
  publishPublicationImpl = publishPreparedPublication,
} = {}) {
  const publication = ledger.publications[category];
  if (!publication || publication.status === 'no_publish') return ledger;

  if (phase === 'prepare') {
    if (['published', 'manual_action_required'].includes(publication.status)) return ledger;
    
    // In CI environments, the status might be 'ready' or 'retry_pending' in the JSON, 
    // but the actual artifact files (.diem-cache/...) might have been lost when the runner spun down.
    // We must verify the physical file exists before skipping the prepare step.
    const reelPath = publication.artifacts?.reelPath ? require('path').resolve(process.cwd(), publication.artifacts.reelPath) : null;
    const hasReel = reelPath && require('fs').existsSync(reelPath);
    
    if (publication.status === 'ready' && hasReel) return ledger;
    if (publication.reel?.status === 'retry_pending' && hasReel) return ledger;
    try {
      return await preparePublicationImpl(ledger, category, { history });
    } catch (error) {
      return updatePublication(ledger, category, failedGenerationPublication(publication, error));
    }
  }

  if (phase === 'publish') {
    const commentsIncomplete = publication.reel?.status === 'published'
      && (publication.comment?.status !== 'published' || publication.reply?.status !== 'published');
    if (publication.status !== 'ready' && !commentsIncomplete) return ledger;
    try {
      return await publishPublicationImpl(ledger, category, token);
    } catch (error) {
      return updatePublication(ledger, category, failedPublishPublication(publication, error));
    }
  }
  throw new Error(`[DIEM] Unsupported category phase: ${phase}`);
}

async function runPersistedPhase({
  phase,
  date = kstDate(),
  category,
  publish = config.publishInstagram,
  token,
  loadLedgerImpl = loadLedger,
  saveLedgerImpl = saveLedger,
  listLedgersImpl = listLedgers,
  notifyTransitionsImpl = notifyTransitions,
  ...stepDependencies
} = {}) {
  let ledger = loadLedgerImpl(date);
  if (!ledger) throw new Error(`[DIEM] No frozen queue exists for ${date}. Run plan first.`);
  if (phase === 'publish' && !publish) return { ledger, skipped: true, reason: 'publishing_disabled', results: [] };
  const categories = selectedCategories(category);
  const hasPublishWork = categories.some(selectedCategory => {
    const publication = ledger.publications[selectedCategory];
    return publication?.status === 'ready'
      || (publication?.reel?.status === 'published'
        && (publication.comment?.status !== 'published' || publication.reply?.status !== 'published'));
  });
  const resolvedToken = phase === 'publish' && hasPublishWork ? (token || resolveInstagramToken()) : null;
  const history = require('./ledger').historyFromLedgers(listLedgersImpl(), date, config.maxHistoryDays);
  const results = [];

  for (const selectedCategory of categories) {
    const before = structuredClone(ledger.publications[selectedCategory]);
    ledger = await runCategoryStep(ledger, selectedCategory, {
      phase,
      history,
      token: resolvedToken,
      ...stepDependencies,
    });
    ledger = saveLedgerImpl(ledger);
    const notified = await notifyTransitionsImpl(ledger, selectedCategory, before);
    ledger = saveLedgerImpl(notified.ledger);
    results.push({
      category: selectedCategory,
      status: ledger.publications[selectedCategory].status,
      notificationErrors: notified.errors,
    });
  }
  return { ledger, skipped: false, results };
}

module.exports = {
  CATEGORY_ORDER,
  applyPlan,
  failedGenerationPublication,
  failedPublishPublication,
  hasFrozenQueue,
  planPhase,
  runCategoryStep,
  runPersistedPhase,
  selectedCategories,
};
