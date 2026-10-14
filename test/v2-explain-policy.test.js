const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  evaluateExplainRollout,
  loadExplainCapabilityEvidence,
} = require('../src/v2/explain-policy');

function passedEvidence() {
  return {
    schemaVersion: 1,
    strategyVersion: 'discovery-funnel-v3',
    classificationShadow: {
      reviewed: 40,
      incidents: 0,
      sampleIds: Array.from({ length: 40 }, (_, index) => `candidate-${index + 1}`),
    },
    explainDrafts: {
      reviewed: 10,
      incidents: 0,
      sampleIds: Array.from({ length: 10 }, (_, index) => `draft-${index + 1}`),
    },
    visionShadow: {
      consecutiveSuccesses: 5,
      modelNotFound: 0,
      transportErrors: 0,
      successfulRunIds: Array.from({ length: 5 }, (_, index) => `vision-${index + 1}`),
    },
    qualityIncidents: 0,
  };
}

test('fails closed until all three explain capability gates are proven', () => {
  const missingEvidence = evaluateExplainRollout({
    configured: true,
    category: 'economy',
    date: '2026-10-06',
    evidence: null,
  });
  assert.equal(missingEvidence.enabled, false);
  assert.equal(missingEvidence.reason, 'capability_evidence_missing');

  const incomplete = passedEvidence();
  incomplete.visionShadow.consecutiveSuccesses = 4;
  const result = evaluateExplainRollout({
    configured: true,
    category: 'economy',
    date: '2026-10-06',
    evidence: incomplete,
  });
  assert.equal(result.enabled, false);
  assert.equal(result.reason, 'capability_gates_incomplete');
});

test('enforces a three-day category interval and five-post canary cap', () => {
  const recent = evaluateExplainRollout({
    configured: true,
    category: 'economy',
    date: '2026-10-06',
    evidence: passedEvidence(),
    history: [{ date: '2026-10-04', category: 'economy', reelFormat: 'explain' }],
  });
  assert.equal(recent.enabled, false);
  assert.equal(recent.reason, 'category_interval_not_elapsed');

  const atInterval = evaluateExplainRollout({
    configured: true,
    category: 'economy',
    date: '2026-10-06',
    evidence: passedEvidence(),
    history: [{ date: '2026-10-03', category: 'economy', reelFormat: 'explain' }],
  });
  assert.equal(atInterval.enabled, true);

  const capped = evaluateExplainRollout({
    configured: true,
    category: 'issue',
    date: '2026-10-20',
    evidence: passedEvidence(),
    history: Array.from({ length: 5 }, (_, index) => ({
      date: `2026-10-${String(index + 1).padStart(2, '0')}`,
      category: 'issue',
      reelFormat: 'explain',
    })),
  });
  assert.equal(capped.enabled, false);
  assert.equal(capped.reason, 'category_canary_cap_reached');
});

test('rolls explain back after any quality incident', () => {
  const evidence = passedEvidence();
  evidence.qualityIncidents = 1;
  const result = evaluateExplainRollout({
    configured: true,
    category: 'economy',
    date: '2026-10-06',
    evidence,
  });
  assert.equal(result.enabled, false);
  assert.equal(result.reason, 'quality_incident_rollback');
});

test('loads evidence from disk and treats a missing or malformed file as unavailable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-explain-gates-'));
  const filePath = path.join(root, 'evidence.json');
  assert.equal(loadExplainCapabilityEvidence(filePath), null);
  fs.writeFileSync(filePath, '{not-json');
  assert.equal(loadExplainCapabilityEvidence(filePath), null);
  fs.writeFileSync(filePath, JSON.stringify(passedEvidence()));
  assert.equal(loadExplainCapabilityEvidence(filePath).classificationShadow.reviewed, 40);
});
