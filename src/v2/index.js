#!/usr/bin/env node

const config = require('../../config');
const { sendAnalyticsReport } = require('../slack');
const {
  findBasicPublication,
  prepareBasicDraft,
  publishBasicDraft,
  rejectBasicDraft,
  retryBasicPublication,
} = require('./basic');
const { recordModeration, saveExperimentReport } = require('./experiment-report');
const { savePerformanceReport } = require('./performance-loop');
const {
  rebuildEditorialHistory,
  saveLedger,
} = require('./ledger');
const { notifyTransitions } = require('./operations');
const { planCategoryPhase, planPhase, runPersistedPhase } = require('./orchestrator');
const { kstDate } = require('./time');

function parseArgs(argv = process.argv.slice(2)) {
  const [command = 'help', ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--force') options.force = true;
    else if (token === '--publish') options.publish = true;
    else if (token === '--date') options.date = rest[++index];
    else if (token === '--category') options.category = rest[++index];
    else if (token === '--slot') options.slot = rest[++index];
    else if (token === '--publication-key') options.publicationKey = rest[++index];
    else if (token === '--reason') options.reason = rest[++index];
    else if (token === '--action') options.action = rest[++index];
    else throw new Error(`[DIEM] Unknown option: ${token}`);
  }
  return { command, options };
}

function helpText() {
  return [
    'DIEM V2 pipeline',
    '',
    '  node src/v2/index.js select --category economy|issue [--date YYYY-MM-DD] [--slot RUN_ID]',
    '  node src/v2/index.js plan [--date YYYY-MM-DD] [--force]',
    '  node src/v2/index.js prepare [--date YYYY-MM-DD] [--category economy|issue]',
    '  node src/v2/index.js publish [--date YYYY-MM-DD] [--category economy|issue] [--publish]',
    '  node src/v2/index.js retry [--date YYYY-MM-DD] [--category economy|issue] [--publish]',
    '  node src/v2/index.js basic-prepare [--date YYYY-MM-DD]',
    '  node src/v2/index.js basic-publish --publication-key KEY --publish',
    '  node src/v2/index.js basic-reject --publication-key KEY --reason REASON',
    '  node src/v2/index.js basic-retry --publication-key KEY --publish',
    '  node src/v2/index.js basic-report',
    '  node src/v2/index.js performance-report',
    '  node src/v2/index.js moderate --publication-key KEY --action deleted|corrected --reason REASON',
    '',
    'Publishing requires PUBLISH_INSTAGRAM=true or --publish.',
  ].join('\n');
}

function nextDate(date) {
  const value = new Date(`${date}T12:00:00+09:00`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul' });
}

async function runCommand({ command, options }) {
  const date = options.date || kstDate();
  if (command === 'performance-report') {
    const report = savePerformanceReport();
    console.log(`[DIEM] performance report: ${report.status} (${report.publishedCount} published ledgers)`);
    return report;
  }
  if (command === 'basic-report') {
    const report = await saveExperimentReport();
    console.log(`[DIEM Basic] experiment report: ${report.status} (${report.completion.approvedBasicPublished}/4 published, ${report.completion.basicSevenDayObserved}/4 observed)`);
    return report;
  }
  if (command === 'moderate') {
    const ledger = recordModeration({
      publicationKey: options.publicationKey,
      action: options.action,
      reason: options.reason,
    });
    await saveExperimentReport();
    console.log(`[DIEM] moderation recorded: ${options.publicationKey} (${options.action})`);
    return ledger;
  }
  if (command === 'basic-prepare') {
    const ledger = await prepareBasicDraft({ date });
    const publication = (ledger.publicationHistory || []).find(item => (
      item.contentType === 'diem_basic' && item.experiment?.weekKey
    ));
    console.log(`[DIEM Basic] draft ready: ${publication?.publicationKey || 'existing weekly draft'}`);
    return ledger;
  }
  if (command === 'basic-publish') {
    if (!options.publicationKey) throw new Error('[DIEM Basic] basic-publish requires --publication-key.');
    if (!(options.publish || config.publishInstagram)) {
      throw new Error('[DIEM Basic] Publishing requires PUBLISH_INSTAGRAM=true or --publish.');
    }
    const ledger = await publishBasicDraft({ publicationKey: options.publicationKey });
    console.log(`[DIEM Basic] approved publication processed: ${options.publicationKey}`);
    return ledger;
  }
  if (command === 'basic-retry') {
    if (!options.publicationKey) throw new Error('[DIEM Basic] basic-retry requires --publication-key.');
    if (!(options.publish || config.publishInstagram)) {
      throw new Error('[DIEM Basic] Publishing requires PUBLISH_INSTAGRAM=true or --publish.');
    }
    const ledger = await retryBasicPublication({ publicationKey: options.publicationKey });
    console.log(`[DIEM Basic] independent steps retried: ${options.publicationKey}`);
    return ledger;
  }
  if (command === 'basic-reject') {
    if (!options.publicationKey) throw new Error('[DIEM Basic] basic-reject requires --publication-key.');
    if (!options.reason) throw new Error('[DIEM Basic] basic-reject requires --reason.');
    const ledgers = require('./ledger').listLedgers();
    const found = findBasicPublication(ledgers, options.publicationKey);
    if (!found) throw new Error(`[DIEM Basic] Draft not found: ${options.publicationKey}`);
    const ledger = saveLedger(rejectBasicDraft(found.ledger, options.publicationKey, options.reason));
    console.log(`[DIEM Basic] draft rejected: ${options.publicationKey}`);
    return ledger;
  }
  if (command === 'select') {
    if (!options.category) throw new Error('[DIEM] select requires --category economy|issue.');
    const result = await planCategoryPhase({
      date,
      category: options.category,
      slot: options.slot,
    });
    let ledger = saveLedger(result.ledger);
    if (!result.reused) {
      const before = result.previousLedger.publications[options.category];
      const notified = await notifyTransitions(ledger, options.category, before);
      ledger = saveLedger(notified.ledger);
    }
    rebuildEditorialHistory({ referenceDate: nextDate(date) });
    const publication = ledger.publications[options.category];
    console.log(`[DIEM] ${date} ${options.category} ${result.recovery ? 'recovery reused' : 'hot-news selected'}: ${publication.status}${publication.candidate ? ` (${publication.candidate.title})` : ''}`);
    return ledger;
  }
  if (command === 'plan') {
    const result = await planPhase({ date, force: options.force ?? true });
    let ledger = saveLedger(result.ledger);
    if (!result.reused) {
      for (const category of ['economy', 'issue']) {
        const notified = await notifyTransitions(
          ledger,
          category,
          result.previousLedger.publications[category]
        );
        ledger = saveLedger(notified.ledger);
      }
    }
    rebuildEditorialHistory({ referenceDate: nextDate(date) });
    console.log(`[DIEM] ${date} queue ${result.reused ? 'reused' : 'planned'}: ${Object.values(ledger.publications).map(item => `${item.category}=${item.status}`).join(', ')}`);
    return ledger;
  }
  if (command === 'prepare') {
    const result = await runPersistedPhase({ phase: 'prepare', date, category: options.category });
    console.log(`[DIEM] ${date} prepared: ${result.results.map(item => `${item.category}=${item.status}`).join(', ')}`);
    return result.ledger;
  }
  if (command === 'publish') {
    const result = await runPersistedPhase({
      phase: 'publish',
      date,
      category: options.category,
      publish: options.publish || config.publishInstagram,
    });
    if (result.skipped) console.log('[DIEM] Publishing is disabled; ready artifacts and ledger were preserved.');
    else console.log(`[DIEM] ${date} published: ${result.results.map(item => `${item.category}=${item.status}`).join(', ')}`);
    rebuildEditorialHistory({ referenceDate: nextDate(date) });
    return result.ledger;
  }
  if (command === 'retry') {
    const prepared = await runPersistedPhase({ phase: 'prepare', date, category: options.category });
    console.log(`[DIEM] ${date} retry:prepare: ${prepared.results.map(item => `${item.category}=${item.status}`).join(', ') || '(no results)'}`);
    const published = await runPersistedPhase({
      phase: 'publish',
      date,
      category: options.category,
      publish: options.publish || config.publishInstagram,
    });
    console.log(`[DIEM] ${date} retry:publish: ${published.results.map(item => `${item.category}=${item.status}`).join(', ') || '(no results)'}`);
    rebuildEditorialHistory({ referenceDate: nextDate(date) });
    console.log(`[DIEM] ${date} retry complete${published.skipped ? ' (publishing disabled)' : ''}.`);
    return published.ledger;
  }
  console.log(helpText());
  return null;
}

if (require.main === module) {
  const request = parseArgs();
  runCommand(request).catch(async error => {
    if (request.command.startsWith('basic-')) {
      await sendAnalyticsReport(`🚨 *DIEM 기초 작업 실패*\n작업: ${request.command}\n사유: ${String(error.message || error).replace(/\s+/gu, ' ').slice(0, 1000)}`).catch(() => null);
    }
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  helpText,
  nextDate,
  parseArgs,
  runCommand,
};
