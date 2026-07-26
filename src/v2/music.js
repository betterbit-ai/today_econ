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

function getMood(text) {
  const brightKeywords = /(상승|최고|호조|흑자|회복|기대|성공|합의|지원|완화|급등|돌파|잭팟|수혜|혁신|통과)/u;
  const seriousKeywords = /(하락|최저|부진|적자|침체|위기|실패|결렬|규제|제재|급락|붕괴|재난|참사|사망|희생|경고|우려|타격|피해)/u;
  if (brightKeywords.test(text)) return 'bright';
  if (seriousKeywords.test(text)) return 'serious';
  return 'serious'; // default to serious for economy/news if ambiguous
}

function historyTrackId(entry) {
  return entry?.audioTrackId || entry?.trackId || entry?.audio?.trackId || null;
}

function stableNumber(value) {
  const hash = crypto.createHash('sha256').update(String(value || '')).digest();
  return hash.readUInt32BE(0);
}

function rankMusicTracks({
  history = [],
  previousTrackId,
  mood,
  publicationKey = '',
  manifest = loadMusicManifest(),
} = {}) {
  const moodTracks = mood ? manifest.tracks.filter(track => track.mood === mood) : manifest.tracks;
  const poolTracks = moodTracks.length > 0 ? moodTracks : manifest.tracks;

  const historyTracks = history.filter(entry => !mood || entry.mood === mood);
  const lastTrackId = previousTrackId || historyTrackId(historyTracks.at(-1));

  const useCounts = new Map(poolTracks.map(track => [track.id, 0]));
  for (const entry of historyTracks) {
    const trackId = historyTrackId(entry);
    if (useCounts.has(trackId)) useCounts.set(trackId, useCounts.get(trackId) + 1);
  }

  const eligible = poolTracks.filter(track => track.id !== lastTrackId);
  const pool = eligible.length ? eligible : poolTracks;
  return pool
    .map(track => ({
      ...track,
      useCount: useCounts.get(track.id) || 0,
      tieBreaker: stableNumber(`${publicationKey}:${track.id}`),
    }))
    .sort((left, right) => (
      left.useCount - right.useCount ||
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
    source: selected.source || manifest.source,
    sha256: selected.sha256,
    reason: `${selected.useCount} recent uses; ${selected.moodMatch ? 'mood matched' : 'least-used rotation'}`,
    candidates: usable.slice(0, 2).map(track => ({
      trackId: track.id,
      category: track.category,
      path: track.path,
      mood: track.mood,
      title: track.title,
      license: track.license,
      source: track.source || manifest.source,
      sha256: track.sha256,
    })),
  };
}

module.exports = {
  DEFAULT_AUDIO_ROOT,
  SENSITIVE_TERMS,
  isSensitiveTopic,
  getMood,
  loadMusicManifest,
  rankMusicTracks,
  selectMusic,
  sha256File,
  verifyTrackAsset,
};
