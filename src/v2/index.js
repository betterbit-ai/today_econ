#!/usr/bin/env node

const config = require('../../config');
const {
  rebuildEditorialHistory,
  saveLedger,
} = require('./ledger');
const { notifyTransitions } = require('./operations');
const { planPhase, runPersistedPhase } = require('./orchestrator');
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
    else throw new Error(`[DIEM] Unknown option: ${token}`);
  }
  return { command, options };
}

function helpText() {
  return [
    'DIEM V2 pipeline',
    '',
    '  node src/v2/index.js plan [--date YYYY-MM-DD] [--force]',
    '  node src/v2/index.js prepare [--date YYYY-MM-DD] [--category economy|issue]',
    '  node src/v2/index.js publish [--date YYYY-MM-DD] [--category economy|issue] [--publish]',
    '  node src/v2/index.js retry [--date YYYY-MM-DD] [--category economy|issue] [--publish]',
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
    await runPersistedPhase({ phase: 'prepare', date, category: options.category });
    const published = await runPersistedPhase({
      phase: 'publish',
      date,
      category: options.category,
      publish: options.publish || config.publishInstagram,
    });
    rebuildEditorialHistory({ referenceDate: nextDate(date) });
    console.log(`[DIEM] ${date} retry complete${published.skipped ? ' (publishing disabled)' : ''}.`);
    return published.ledger;
  }
  console.log(helpText());
  return null;
}

if (require.main === module) {
  runCommand(parseArgs()).catch(error => {
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
