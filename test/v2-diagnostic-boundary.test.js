const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { parseArgs, runCommand } = require('../src/v2/index');

test('diagnostic CLI rejects publishing and output outside its ignored artifact directory', async () => {
  const request = parseArgs(['diagnose', '--read-only', '--output', '.diem-cache/diagnostics/report.json']);
  assert.equal(request.command, 'diagnose');
  assert.equal(request.options.readOnly, true);
  await assert.rejects(runCommand({ command: 'diagnose', options: { publish: true, readOnly: true } }), /prohibits --publish/);
  await assert.rejects(runCommand({ command: 'diagnose', options: {} }), /requires --read-only/);
  await assert.rejects(runCommand({ command: 'diagnose', options: { readOnly: true, output: 'data/publications/report.json' } }), /output must be under/);
});

test('manual diagnostic job has read permissions and cannot publish, commit ledgers, or notify Slack', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'diem_economy.yml'), 'utf8');
  const job = workflow.slice(workflow.indexOf('  read-only-diagnostics:'), workflow.indexOf('  retry-editorial-publication:'));
  assert.match(job, /inputs.operation == 'diagnose'/);
  assert.match(job, /contents: read/);
  assert.match(job, /PUBLISH_INSTAGRAM: 'false'/);
  assert.match(job, /diagnose --read-only/);
  assert.match(job, /upload-artifact@v4/);
  assert.doesNotMatch(job, /--publish|commit-diem-state|collect-insights|sendAnalyticsReport|SLACK_/);
});
