const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.join(__dirname, '..');

test('ships exactly two category publishing workflows on staggered six-hour schedules', () => {
  const workflowRoot = path.join(ROOT, '.github', 'workflows');
  const files = fs.readdirSync(workflowRoot).filter(file => /\.ya?ml$/u.test(file)).sort();
  assert.deepEqual(files, ['diem_economy.yml', 'diem_issue.yml']);

  const schedules = [
    ['diem_economy.yml', 'economy', '0 4,10,16,22 * * *'],
    ['diem_issue.yml', 'issue', '0 1,7,13,19 * * *'],
  ];
  for (const [file, category, cron] of schedules) {
    const content = fs.readFileSync(path.join(workflowRoot, file), 'utf8');
    assert.match(content, new RegExp(`cron:\\s*['"]${cron.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}['"]`));
    assert.doesNotMatch(content, /cron:\s*['"]0 \*\/4 \* \* \*['"]/u);
    assert.match(content, new RegExp(`select --category ${category}`));
    assert.match(content, new RegExp(`prepare --category ${category}`));
    assert.match(content, new RegExp(`publish --category ${category}`));
    assert.match(content, /ref:\s*\$\{\{ github\.ref_name \}\}/u);
    assert.match(content, /id:\s*embedding-cache/u);
    assert.match(content, /steps\.embedding-cache\.outputs\.cache-hit != 'true'/u);
    assert.match(content, /HF_HUB_OFFLINE:\s*'0'/u);
    assert.match(content, /PUBLISH_INSTAGRAM_STORY:\s*'true'/u);
    assert.doesNotMatch(content, /retry-all|inputs:\s*\n\s+phase:/u);
    assert.doesNotMatch(content, /DIEM_PIPELINE_ENABLED/u);
  }
});
