const fs = require('fs');
const path = require('path');

const config = require('../../config');

const WATCHDOG_DELAY_MS = 45 * 60 * 1000;
const STATE_SCHEMA_VERSION = 1;

function emptyCloudEditorialState() {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    expectedRuns: [],
  };
}

function normalizeState(state = {}) {
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    expectedRuns: Array.isArray(state.expectedRuns) ? structuredClone(state.expectedRuns) : [],
  };
}

function safeRunId(value = '') {
  const runId = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u.test(runId)) {
    throw new Error('[DIEM Cloud State] runId must contain 3-128 safe characters.');
  }
  return runId;
}

function iso(value, label) {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`[DIEM Cloud State] ${label} must be a valid timestamp.`);
  return parsed.toISOString();
}

function recordCandidatePack(state = {}, {
  runId,
  candidatePackSha256,
  createdAt = new Date().toISOString(),
} = {}) {
  const next = normalizeState(state);
  const safeRun = safeRunId(runId);
  if (!/^[a-f0-9]{64}$/u.test(String(candidatePackSha256 || ''))) {
    throw new Error('[DIEM Cloud State] candidatePackSha256 must be a SHA-256 value.');
  }
  const timestamp = iso(createdAt, 'createdAt');
  const existing = next.expectedRuns.find(run => run.runId === safeRun);
  if (existing) return next;
  next.expectedRuns.push({
    runId: safeRun,
    candidatePackSha256,
    createdAt: timestamp,
    status: 'scheduled_task_expected',
    packageId: null,
    submittedAt: null,
    missedAlertedAt: null,
  });
  return next;
}

function recordPackageSubmission(state = {}, {
  runId,
  packageId,
  submittedAt = new Date().toISOString(),
} = {}) {
  const next = normalizeState(state);
  const run = next.expectedRuns.find(entry => entry.runId === safeRunId(runId));
  if (!run) throw new Error('[DIEM Cloud State] Candidate pack run was not found.');
  run.packageId = String(packageId || '').trim();
  if (!run.packageId) throw new Error('[DIEM Cloud State] packageId is required.');
  run.submittedAt = iso(submittedAt, 'submittedAt');
  run.status = 'package_submitted';
  return next;
}

function assessScheduledTaskWatchdog(state = {}, {
  now = new Date(),
  delayMs = WATCHDOG_DELAY_MS,
} = {}) {
  const next = normalizeState(state);
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new Error('[DIEM Cloud State] now must be a valid timestamp.');
  const alerts = [];
  for (const run of next.expectedRuns) {
    if (run.status !== 'scheduled_task_expected' || run.missedAlertedAt) continue;
    const createdAt = new Date(run.createdAt);
    if (instant.getTime() - createdAt.getTime() < delayMs) continue;
    run.status = 'scheduled_task_missed';
    run.missedAlertedAt = instant.toISOString();
    alerts.push({
      runId: run.runId,
      candidatePackSha256: run.candidatePackSha256,
      reason: 'scheduled_task_missed',
      createdAt: run.createdAt,
      alertedAt: run.missedAlertedAt,
    });
  }
  return { state: next, alerts };
}

function defaultStatePath(root = config.cloudEditorialRoot) {
  return path.join(root, 'state.json');
}

function loadCloudEditorialState(filePath = defaultStatePath(), fsImpl = fs) {
  if (!fsImpl.existsSync(filePath)) return emptyCloudEditorialState();
  return normalizeState(JSON.parse(fsImpl.readFileSync(filePath, 'utf8')));
}

function saveCloudEditorialState(state, filePath = defaultStatePath(), fsImpl = fs) {
  const normalized = normalizeState(state);
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  fsImpl.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2).normalize('NFC')}\n`, 'utf8');
  fsImpl.renameSync(temporary, filePath);
  return normalized;
}

module.exports = {
  STATE_SCHEMA_VERSION,
  WATCHDOG_DELAY_MS,
  assessScheduledTaskWatchdog,
  defaultStatePath,
  emptyCloudEditorialState,
  loadCloudEditorialState,
  recordCandidatePack,
  recordPackageSubmission,
  saveCloudEditorialState,
};
