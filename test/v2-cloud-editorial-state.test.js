const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assessScheduledTaskWatchdog,
  recordCandidatePack,
  recordPackageSubmission,
} = require('../src/v2/cloud-editorial-state');

const CREATED_AT = '2026-09-16T00:00:00.000Z';

test('alerts once after an expected cloud editorial package is overdue', () => {
  let state = recordCandidatePack({}, {
    runId: '2026-09-16-0730',
    candidatePackSha256: 'a'.repeat(64),
    createdAt: CREATED_AT,
  });
  let assessment = assessScheduledTaskWatchdog(state, { now: new Date('2026-09-16T00:44:59.000Z') });
  assert.equal(assessment.alerts.length, 0);

  assessment = assessScheduledTaskWatchdog(state, { now: new Date('2026-09-16T00:45:01.000Z') });
  assert.equal(assessment.alerts.length, 1);
  assert.equal(assessment.alerts[0].reason, 'scheduled_task_missed');
  state = assessment.state;

  assessment = assessScheduledTaskWatchdog(state, { now: new Date('2026-09-16T01:30:00.000Z') });
  assert.equal(assessment.alerts.length, 0);
});

test('does not alert after the expected package is submitted', () => {
  let state = recordCandidatePack({}, {
    runId: '2026-09-16-0730',
    candidatePackSha256: 'b'.repeat(64),
    createdAt: CREATED_AT,
  });
  state = recordPackageSubmission(state, {
    runId: '2026-09-16-0730',
    packageId: '2026-09-16-0730-economy-rate',
    submittedAt: '2026-09-16T00:10:00.000Z',
  });
  const assessment = assessScheduledTaskWatchdog(state, { now: new Date('2026-09-16T01:00:00.000Z') });
  assert.equal(assessment.alerts.length, 0);
});
