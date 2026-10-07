const fs = require('fs');

const STRATEGY_VERSION = 'discovery-funnel-v3';
const REQUIRED_CLASSIFICATION_REVIEWS = 40;
const REQUIRED_EXPLAIN_DRAFTS = 10;
const REQUIRED_VISION_SUCCESSES = 5;

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function uniqueEvidenceIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
}

function loadExplainCapabilityEvidence(filePath, fsImpl = fs) {
  if (!filePath || !fsImpl.existsSync(filePath)) return null;
  try {
    return JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function evaluateCapabilityGates(evidence) {
  if (!evidence) return { passed: false, reason: 'capability_evidence_missing' };
  const classificationIds = uniqueEvidenceIds(evidence.classificationShadow?.sampleIds);
  const explainIds = uniqueEvidenceIds(evidence.explainDrafts?.sampleIds);
  const visionRunIds = uniqueEvidenceIds(evidence.visionShadow?.successfulRunIds);
  const classificationPassed = (
    number(evidence.classificationShadow?.reviewed) >= REQUIRED_CLASSIFICATION_REVIEWS
    && classificationIds.length >= REQUIRED_CLASSIFICATION_REVIEWS
    && number(evidence.classificationShadow?.incidents) === 0
  );
  const explainPassed = (
    number(evidence.explainDrafts?.reviewed) >= REQUIRED_EXPLAIN_DRAFTS
    && explainIds.length >= REQUIRED_EXPLAIN_DRAFTS
    && number(evidence.explainDrafts?.incidents) === 0
  );
  const visionPassed = (
    number(evidence.visionShadow?.consecutiveSuccesses) >= REQUIRED_VISION_SUCCESSES
    && visionRunIds.length >= REQUIRED_VISION_SUCCESSES
    && number(evidence.visionShadow?.modelNotFound) === 0
    && number(evidence.visionShadow?.transportErrors) === 0
  );
  const passed = (
    evidence.schemaVersion === 1
    && evidence.strategyVersion === STRATEGY_VERSION
    && classificationPassed
    && explainPassed
    && visionPassed
  );
  return {
    passed,
    reason: passed ? 'capability_gates_passed' : 'capability_gates_incomplete',
    gates: {
      classificationPassed,
      explainPassed,
      visionPassed,
      classificationEvidenceCount: classificationIds.length,
      explainEvidenceCount: explainIds.length,
      visionEvidenceCount: visionRunIds.length,
    },
  };
}

function daysBetween(left, right) {
  const leftTime = new Date(`${left}T00:00:00+09:00`).getTime();
  const rightTime = new Date(`${right}T00:00:00+09:00`).getTime();
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return null;
  return Math.floor((rightTime - leftTime) / 86400000);
}

function evaluateExplainRollout({
  configured = false,
  category,
  date,
  history = [],
  evidence,
  minIntervalDays = 3,
  maxPerCategory = 5,
} = {}) {
  if (!configured) return { enabled: false, reason: 'explain_disabled' };
  const capability = evaluateCapabilityGates(evidence);
  if (!capability.passed) return { enabled: false, reason: capability.reason, capability };
  if (number(evidence.qualityIncidents) > 0 || history.some(entry => entry.qualityIncident)) {
    return { enabled: false, reason: 'quality_incident_rollback', capability };
  }
  const categoryExplains = history
    .filter(entry => entry.category === category && entry.reelFormat === 'explain')
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
  if (categoryExplains.length >= maxPerCategory) {
    return { enabled: false, reason: 'category_canary_cap_reached', capability };
  }
  const latest = categoryExplains.at(-1);
  if (latest) {
    const elapsed = daysBetween(latest.date, date);
    if (elapsed === null || elapsed < minIntervalDays) {
      return { enabled: false, reason: 'category_interval_not_elapsed', capability };
    }
  }
  return {
    enabled: true,
    reason: 'canary_eligible',
    capability,
    categoryExplainCount: categoryExplains.length,
  };
}

module.exports = {
  REQUIRED_CLASSIFICATION_REVIEWS,
  REQUIRED_EXPLAIN_DRAFTS,
  REQUIRED_VISION_SUCCESSES,
  STRATEGY_VERSION,
  evaluateCapabilityGates,
  evaluateExplainRollout,
  loadExplainCapabilityEvidence,
};
