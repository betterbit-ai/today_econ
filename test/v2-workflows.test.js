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
    assert.match(content, /PUBLISH_INSTAGRAM_STORY:\s*'false'/u);
    assert.match(content, /MANUAL_REEL_STORY_SHARE:\s*'true'/u);
    assert.match(content, /MAX_DAILY_PUBLICATIONS_PER_CATEGORY:\s*'3'/u);
    assert.match(content, /GROQ_VISION_MODEL:\s*qwen\/qwen3\.6-27b/u);
    assert.doesNotMatch(content, /retry-all|inputs:\s*\n\s+phase:/u);
    assert.doesNotMatch(content, /DIEM_PIPELINE_ENABLED/u);
  }

  const economy = fs.readFileSync(path.join(workflowRoot, 'diem_economy.yml'), 'utf8');
  assert.match(economy, /operation:[\s\S]*publish_basic[\s\S]*retry_basic/u);
  assert.match(economy, /retry_editorial/u);
  assert.match(economy, /editorial-retry --publication-key "\$EDITORIAL_PUBLICATION_KEY" --publish/u);
  assert.doesNotMatch(economy, /- prepare_basic|- reject_basic/u);
  assert.match(economy, /collect_insights/u);
  assert.match(economy, /inputs\.operation == 'collect_insights'/u);
  assert.match(economy, /node src\/v2\/index\.js performance-report/u);
  assert.match(economy, /cron:\s*['"]30 0 \* \* 0['"]/u);
  assert.doesNotMatch(economy, /basic-prepare/u);
  assert.match(economy, /basic-publish-stored --content-id "\$BASIC_CONTENT_ID" --publish/u);
  assert.match(economy, /basic-publish-stored --publish/u);
  assert.match(economy, /github\.event_name == 'workflow_dispatch' && inputs\.operation == 'publish_basic'/u);
  assert.match(economy, /github\.event_name == 'schedule' && github\.event\.schedule == '30 0 \* \* 0'/u);
  const basicJob = economy.slice(
    economy.indexOf('  publish-stored-diem-basic:'),
    economy.indexOf('  retry-diem-basic:'),
  );
  assert.doesNotMatch(basicJob, /GROQ|basic-prepare|select --category|playwright|ffmpeg|PEXELS|UNSPLASH/u);
  assert.match(economy, /git add data\/publications data\/analytics-state\.json data\/reports/u);
});
