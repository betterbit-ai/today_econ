const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { CATEGORIES } = require('./constants');

const DEFAULT_AUDIO_ROOT = path.join(__dirname, '..', '..', 'assets', 'audio', 'diem');
const SENSITIVE_TERMS = Object.freeze([
  '재난',
  '참사',
  '사망',
  '희생자',
  '장례',
  '애도',
  '지진',
  '산불',
  '침수',
  '붕괴',
  '전쟁',
  '테러',
]);

function loadMusicManifest({
  manifestPath = path.join(DEFAULT_AUDIO_ROOT, 'manifest.json'),
  fsImpl = fs,
} = {}) {
  const manifest = JSON.parse(fsImpl.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.tracks)) {
    throw new Error('[DIEM Music] Invalid manifest.');
  }
  for (const category of Object.values(CATEGORIES)) {
    if (manifest.tracks.filter(track => track.category === category).length !== 3) {
      throw new Error(`[DIEM Music] ${category} must have exactly three tracks.`);
    }
  }
  return manifest;
}

function sha256File(filePath, fsImpl = fs) {
  return crypto.createHash('sha256').update(fsImpl.readFileSync(filePath)).digest('hex');
}

function verifyTrackAsset(track, {
  audioRoot = DEFAULT_AUDIO_ROOT,
  fsImpl = fs,
} = {}) {
  const filePath = path.join(audioRoot, track.filename);
  if (!fsImpl.existsSync(filePath)) {
    return { ok: false, filePath, reason: 'missing audio asset' };
  }
  const actualSha256 = sha256File(filePath, fsImpl);
  if (!track.sha256 || actualSha256 !== track.sha256) {
    return { ok: false, filePath, actualSha256, reason: 'audio hash mismatch' };
  }
  return { ok: true, filePath, actualSha256 };
}

function isSensitiveTopic(input = {}) {
  if (input === true || input?.sensitive === true) return true;
  const text = typeof input === 'string'
    ? input
    : [input?.title, input?.summary, ...(input?.tags || [])].filter(Boolean).join(' ');
  return SENSITIVE_TERMS.some(term => String(text).includes(term));
}

function historyTrackId(entry) {
  return entry?.audioTrackId || entry?.trackId || entry?.audio?.trackId || null;
}

function stableNumber(value) {
  const hash = crypto.createHash('sha256').update(String(value || '')).digest();
  return hash.readUInt32BE(0);
}

function rankMusicTracks({
  category,
  history = [],
  previousTrackId,
  mood,
  publicationKey = '',
  manifest = loadMusicManifest(),
} = {}) {
  if (!Object.values(CATEGORIES).includes(category)) {
    throw new Error(`[DIEM Music] Invalid category: ${category}`);
  }
  const categoryTracks = manifest.tracks.filter(track => track.category === category);
  const categoryHistory = history.filter(entry => !entry?.category || entry.category === category);
  const lastTrackId = previousTrackId || historyTrackId(categoryHistory.at(-1));
  const useCounts = new Map(categoryTracks.map(track => [track.id, 0]));
  for (const entry of categoryHistory) {
    const trackId = historyTrackId(entry);
    if (useCounts.has(trackId)) useCounts.set(trackId, useCounts.get(trackId) + 1);
  }
  const eligible = categoryTracks.filter(track => track.id !== lastTrackId);
  const pool = eligible.length ? eligible : categoryTracks;
  return pool
    .map(track => ({
      ...track,
      useCount: useCounts.get(track.id) || 0,
      moodMatch: mood && track.mood === mood ? 1 : 0,
      tieBreaker: stableNumber(`${publicationKey}:${track.id}`),
    }))
    .sort((left, right) => (
      left.useCount - right.useCount ||
      right.moodMatch - left.moodMatch ||
      left.tieBreaker - right.tieBreaker ||
      left.id.localeCompare(right.id)
    ));
}

function selectMusic({
  category,
  history = [],
  previousTrackId,
  mood,
  publicationKey,
  sensitive = false,
  topic = {},
  manifest = loadMusicManifest(),
  audioRoot = DEFAULT_AUDIO_ROOT,
  fsImpl = fs,
} = {}) {
  if (sensitive || isSensitiveTopic(topic)) {
    return {
      mode: 'silent',
      trackId: null,
      category,
      reason: 'sensitive topic',
      candidates: [],
    };
  }

  const ranked = rankMusicTracks({
    category,
    history,
    previousTrackId,
    mood,
    publicationKey,
    manifest,
  });
  const candidates = ranked.map(track => {
    const verification = verifyTrackAsset(track, { audioRoot, fsImpl });
    return {
      ...track,
      mode: 'track',
      path: verification.filePath,
      verified: verification.ok,
      verificationError: verification.ok ? null : verification.reason,
      actualSha256: verification.actualSha256 || null,
    };
  });
  const usable = candidates.filter(track => track.verified);
  if (!usable.length) {
    return {
      mode: 'silent',
      trackId: null,
      category,
      reason: 'no verified audio asset',
      candidates,
    };
  }
  const selected = usable[0];
  return {
    mode: 'track',
    trackId: selected.id,
    category,
    mood: selected.mood,
    title: selected.title,
    path: selected.path,
    license: selected.license,
    source: manifest.source,
    sha256: selected.sha256,
    reason: `${selected.useCount} recent uses; ${selected.moodMatch ? 'mood matched' : 'least-used rotation'}`,
    candidates: usable.slice(0, 2).map(track => ({
      trackId: track.id,
      category: track.category,
      path: track.path,
      mood: track.mood,
      title: track.title,
      license: track.license,
      source: manifest.source,
      sha256: track.sha256,
    })),
  };
}

module.exports = {
  DEFAULT_AUDIO_ROOT,
  SENSITIVE_TERMS,
  isSensitiveTopic,
  loadMusicManifest,
  rankMusicTracks,
  selectMusic,
  sha256File,
  verifyTrackAsset,
};
