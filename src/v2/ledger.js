const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { CATEGORIES, PUBLICATION_STATES } = require('./constants');
const { kstDate } = require('./time');
const { saveMarkdownReport } = require('./report');

function publicationKey(date, category, slot) {
  if (!Object.values(CATEGORIES).includes(category)) throw new Error(`[DIEM Ledger] Invalid category: ${category}`);
  const base = `diem:${date}:${category}`;
  if (!slot) return base;
  const safeSlot = String(slot).normalize('NFC').replace(/[^A-Za-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!safeSlot) throw new Error('[DIEM Ledger] Publication slot must contain a stable identifier.');
  return `${base}:${safeSlot}`;
}

function ledgerPath(date = kstDate(), root = config.publicationsRoot) {
  const [year, month] = date.split('-');
  return path.join(root, year, month, `${date}.json`);
}

function emptyStep() {
  return { status: 'planned', attempts: 0, externalId: null, error: null, updatedAt: null };
}

function emptyPublication(date, category, slot) {
  return {
    publicationKey: publicationKey(date, category, slot),
    category,
    status: 'planned',
    candidate: null,
    corroboration: null,
    duplicateCheck: null,
    editorial: null,
    image: null,
    audio: null,
    reel: emptyStep(),
    story: emptyStep(),
    comment: emptyStep(),
    reply: emptyStep(),
    notifications: [],
  };
}

function createDailyLedger(date = kstDate(), now = new Date()) {
  return {
    schemaVersion: 3,
    brand: 'DIEM',
    date,
    timezone: 'Asia/Seoul',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    popularityFallback: null,
    candidates: [],
    candidateRuns: [],
    publicationHistory: [],
    publications: {
      [CATEGORIES.ECONOMY]: emptyPublication(date, CATEGORIES.ECONOMY),
      [CATEGORIES.ISSUE]: emptyPublication(date, CATEGORIES.ISSUE),
    },
  };
}

function validateLedger(ledger) {
  const errors = [];
  if (![2, 3].includes(ledger?.schemaVersion)) errors.push('schemaVersion must be 2 or 3');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ledger?.date || '')) errors.push('date must be YYYY-MM-DD');
  for (const category of Object.values(CATEGORIES)) {
    const publication = ledger?.publications?.[category];
    if (!publication) {
      errors.push(`missing ${category} publication`);
      continue;
    }
    if (!publication.publicationKey?.startsWith(publicationKey(ledger.date, category))) errors.push(`invalid ${category} publicationKey`);
    if (!PUBLICATION_STATES.includes(publication.status)) errors.push(`invalid ${category} status`);
    for (const step of ['reel', 'comment', 'reply']) {
      if (!PUBLICATION_STATES.includes(publication?.[step]?.status)) errors.push(`invalid ${category}.${step} status`);
    }
    if (publication.story && !PUBLICATION_STATES.includes(publication.story.status)) {
      errors.push(`invalid ${category}.story status`);
    }
  }
  if (ledger?.schemaVersion === 3 && !Array.isArray(ledger.publicationHistory)) errors.push('publicationHistory must be an array');
  for (const publication of ledger?.publicationHistory || []) {
    if (!Object.values(CATEGORIES).includes(publication.category)) errors.push('invalid archived publication category');
    if (!publication.publicationKey?.startsWith(publicationKey(ledger.date, publication.category))) errors.push('invalid archived publicationKey');
    if (!PUBLICATION_STATES.includes(publication.status)) errors.push('invalid archived publication status');
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
    publicationKey: patch.publicationKey || next.publications[category].publicationKey || publicationKey(next.date, category),
  };
  return next;
}

function archivePublication(ledger, category) {
  const publication = ledger?.publications?.[category];
  if (!publication) throw new Error(`[DIEM Ledger] Missing category: ${category}`);
  if (!publication.candidate && publication.status === 'planned') return structuredClone(ledger);
  const next = structuredClone(ledger);
  next.schemaVersion = 3;
  next.publicationHistory = Array.isArray(next.publicationHistory) ? next.publicationHistory : [];
  if (!next.publicationHistory.some(item => item.publicationKey === publication.publicationKey)) {
    next.publicationHistory.push(structuredClone(publication));
  }
  return next;
}

function startPublicationRun(ledger, category, slot) {
  if (!ledger?.publications?.[category]) throw new Error(`[DIEM Ledger] Missing category: ${category}`);
  const next = structuredClone(ledger);
  next.schemaVersion = 3;
  next.publicationHistory = Array.isArray(next.publicationHistory) ? next.publicationHistory : [];
  next.candidateRuns = Array.isArray(next.candidateRuns) ? next.candidateRuns : [];
  next.publications[category] = emptyPublication(next.date, category, slot);
  return next;
}

function allLedgerPublications(ledger = {}) {
  return [
    ...(ledger.publicationHistory || []),
    ...Object.values(ledger.publications || {}),
  ];
}

function updateStep(ledger, category, step, patch = {}, now = new Date()) {
  if (!['reel', 'story', 'comment', 'reply'].includes(step)) throw new Error(`[DIEM Ledger] Invalid step: ${step}`);
  const current = ledger.publications[category][step] || emptyStep();
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
      fallbackTheme: publication.image.fallbackTheme || null,
      fallbackVariant: Number.isInteger(publication.image.fallbackVariant)
        ? publication.image.fallbackVariant
        : null,
      artVariantId: publication.image.artVariantId || null,
      visualFingerprint: publication.image.visualFingerprint || null,
      assetPath: publication.image.assetPath || null,
      generatedTopic: publication.image.generatedTopic || null,
    },
  };
}

function historyFromLedgers(ledgers = [], referenceDate = kstDate(), days = 7, {
  includeReferenceDate = false,
} = {}) {
  const cutoff = new Date(`${referenceDate}T00:00:00+09:00`);
  cutoff.setUTCDate(cutoff.getUTCDate() - Math.max(0, days - (includeReferenceDate ? 1 : 0)));
  return ledgers
    .filter(ledger => {
      const date = new Date(`${ledger.date}T00:00:00+09:00`);
      return date >= cutoff && (includeReferenceDate ? ledger.date <= referenceDate : ledger.date < referenceDate);
    })
    .flatMap(ledger => allLedgerPublications(ledger).map(publication => ({ publication, ledgerDate: ledger.date })))
    .filter(({ publication }) => (
      publication.status === 'published'
      || publication.reel?.status === 'published'
      || Boolean(publication.reel?.externalId)
    ))
    .map(({ publication, ledgerDate }) => ({
      date: ledgerDate,
      publicationKey: publication.publicationKey,
      category: publication.category,
      title: publication.candidate?.title || '',
      signature: publication.duplicateCheck?.signature || null,
      audioTrackId: publication.audio?.trackId || null,
      image: imageRecordFromPublication(publication, ledgerDate)?.image || null,
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
  allLedgerPublications,
  archivePublication,
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
  startPublicationRun,
  updatePublication,
  updateStep,
  validateLedger,
};
