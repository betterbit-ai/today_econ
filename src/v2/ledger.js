const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { CATEGORIES, PUBLICATION_STATES } = require('./constants');
const { kstDate } = require('./time');
const { saveMarkdownReport } = require('./report');

function publicationKey(date, category) {
  if (!Object.values(CATEGORIES).includes(category)) throw new Error(`[DIEM Ledger] Invalid category: ${category}`);
  return `diem:${date}:${category}`;
}

function ledgerPath(date = kstDate(), root = config.publicationsRoot) {
  const [year, month] = date.split('-');
  return path.join(root, year, month, `${date}.json`);
}

function emptyStep() {
  return { status: 'planned', attempts: 0, externalId: null, error: null, updatedAt: null };
}

function emptyPublication(date, category) {
  return {
    publicationKey: publicationKey(date, category),
    category,
    status: 'planned',
    candidate: null,
    corroboration: null,
    duplicateCheck: null,
    editorial: null,
    image: null,
    audio: null,
    reel: emptyStep(),
    comment: emptyStep(),
    reply: emptyStep(),
    notifications: [],
  };
}

function createDailyLedger(date = kstDate(), now = new Date()) {
  return {
    schemaVersion: 2,
    brand: 'DIEM',
    date,
    timezone: 'Asia/Seoul',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    popularityFallback: null,
    candidates: [],
    publications: {
      [CATEGORIES.ECONOMY]: emptyPublication(date, CATEGORIES.ECONOMY),
      [CATEGORIES.ISSUE]: emptyPublication(date, CATEGORIES.ISSUE),
    },
  };
}

function validateLedger(ledger) {
  const errors = [];
  if (ledger?.schemaVersion !== 2) errors.push('schemaVersion must be 2');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ledger?.date || '')) errors.push('date must be YYYY-MM-DD');
  for (const category of Object.values(CATEGORIES)) {
    const publication = ledger?.publications?.[category];
    if (!publication) {
      errors.push(`missing ${category} publication`);
      continue;
    }
    if (publication.publicationKey !== publicationKey(ledger.date, category)) errors.push(`invalid ${category} publicationKey`);
    if (!PUBLICATION_STATES.includes(publication.status)) errors.push(`invalid ${category} status`);
    for (const step of ['reel', 'comment', 'reply']) {
      if (!PUBLICATION_STATES.includes(publication?.[step]?.status)) errors.push(`invalid ${category}.${step} status`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function saveLedger(ledger, filePath = ledgerPath(ledger.date)) {
  const validation = validateLedger(ledger);
  if (!validation.ok) throw new Error(`[DIEM Ledger] ${validation.errors.join('; ')}`);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const next = { ...ledger, updatedAt: new Date().toISOString() };
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2).normalize('NFC')}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
  saveMarkdownReport(next, filePath);
  return next;
}

function loadLedger(date = kstDate(), filePath = ledgerPath(date)) {
  if (!fs.existsSync(filePath)) return null;
  const ledger = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const validation = validateLedger(ledger);
  if (!validation.ok) throw new Error(`[DIEM Ledger] Invalid ledger ${filePath}: ${validation.errors.join('; ')}`);
  return ledger;
}

function updatePublication(ledger, category, patch = {}) {
  if (!ledger?.publications?.[category]) throw new Error(`[DIEM Ledger] Missing category: ${category}`);
  const next = structuredClone(ledger);
  next.publications[category] = {
    ...next.publications[category],
    ...patch,
    publicationKey: publicationKey(next.date, category),
  };
  return next;
}

function updateStep(ledger, category, step, patch = {}, now = new Date()) {
  if (!['reel', 'comment', 'reply'].includes(step)) throw new Error(`[DIEM Ledger] Invalid step: ${step}`);
  const current = ledger.publications[category][step];
  return updatePublication(ledger, category, {
    [step]: {
      ...current,
      ...patch,
      attempts: patch.incrementAttempt ? current.attempts + 1 : (patch.attempts ?? current.attempts),
      updatedAt: now.toISOString(),
    },
  });
}

function imageRecordFromPublication(publication = {}, date = '') {
  if (!publication.image) return null;
  return {
    date,
    publicationKey: publication.publicationKey,
    category: publication.category,
    status: publication.status,
    image: {
      kind: publication.image.kind || null,
      id: publication.image.id || null,
      source: publication.image.source || null,
      originalUrl: publication.image.originalUrl || null,
      downloadUrl: publication.image.downloadUrl || null,
      localSha256: publication.image.localSha256 || publication.image.sha256 || null,
      query: publication.image.query || null,
    },
  };
}

function historyFromLedgers(ledgers = [], referenceDate = kstDate(), days = 7) {
  const cutoff = new Date(`${referenceDate}T00:00:00+09:00`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  return ledgers
    .filter(ledger => {
      const date = new Date(`${ledger.date}T00:00:00+09:00`);
      return date >= cutoff && ledger.date < referenceDate;
    })
    .flatMap(ledger => Object.values(ledger.publications || {}))
    .filter(publication => publication.status === 'published' && publication.duplicateCheck?.signature)
    .map(publication => ({
      date: publication.publicationKey.split(':')[1],
      publicationKey: publication.publicationKey,
      category: publication.category,
      title: publication.candidate?.title || '',
      signature: publication.duplicateCheck.signature,
      audioTrackId: publication.audio?.trackId || null,
      image: imageRecordFromPublication(publication, publication.publicationKey.split(':')[1])?.image || null,
    }));
}

function listLedgers(root = config.publicationsRoot) {
  if (!fs.existsSync(root)) return [];
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.name)) files.push(target);
    }
  };
  walk(root);
  return files.sort().map(file => {
    const ledger = JSON.parse(fs.readFileSync(file, 'utf8'));
    const validation = validateLedger(ledger);
    if (!validation.ok) throw new Error(`[DIEM Ledger] Invalid ledger ${file}: ${validation.errors.join('; ')}`);
    return ledger;
  });
}

function saveEditorialHistory(history, filePath = config.editorialHistoryFile) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(history, null, 2).normalize('NFC')}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
  return history;
}

function rebuildEditorialHistory({
  publicationsRoot = config.publicationsRoot,
  historyFile = config.editorialHistoryFile,
  referenceDate = kstDate(),
  days = 7,
} = {}) {
  const history = historyFromLedgers(listLedgers(publicationsRoot), referenceDate, days);
  saveEditorialHistory(history, historyFile);
  return history;
}

module.exports = {
  createDailyLedger,
  emptyPublication,
  historyFromLedgers,
  imageRecordFromPublication,
  ledgerPath,
  listLedgers,
  loadLedger,
  publicationKey,
  rebuildEditorialHistory,
  saveEditorialHistory,
  saveLedger,
  updatePublication,
  updateStep,
  validateLedger,
};
