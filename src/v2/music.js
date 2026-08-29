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

const SENSITIVE_LIFE_TERMS = Object.freeze([
  '\uC228\uC84C',
  '\uC228\uC9C4',
  '\uC2DC\uC2E0',
  '\uD53C\uC0B4',
  '\uC0B4\uC778',
  '\uC911\uD0DC',
  '\uC911\uC0C1',
  '\uC2E4\uC885',
  '\uC218\uC0C9',
  '\uC870\uB09C',
  '\uB9E4\uBAB0',
  '\uC775\uC0AC',
  '\uD654\uC7AC',
  '\uD3ED\uBC1C',
  '\uC0B0\uC0AC\uD0DC',
]);

const SENSITIVE_LIFE_PATTERNS = Object.freeze([
  /(\uAD6C\uC870\uB300|\uAD6C\uC870\s*\uC791\uC5C5|\uAD6C\uC870\s*\uC911|\uAD6C\uC870\uB410|\uAD6C\uC870\s*\uC694\uCCAD)/u,
  /(\uC0AC\uACE0|\uCD94\uB77D|\uD654\uC7AC|\uD3ED\uBC1C|\uBD95\uAD34|\uCE68\uC218|\uC0B0\uC0AC\uD0DC).{0,48}(\uC0AC\uB9DD|\uC2E4\uC885|\uC218\uC0C9|\uAD6C\uC870|\uC911\uD0DC|\uC911\uC0C1|\uBD80\uC0C1|\uD53C\uD574|\uB300\uD53C)/u,
  /(\uC0AC\uB9DD|\uC2E4\uC885|\uC218\uC0C9|\uAD6C\uC870|\uC911\uD0DC|\uC911\uC0C1).{0,48}(\uC0AC\uACE0|\uCD94\uB77D|\uD654\uC7AC|\uD3ED\uBC1C|\uBD95\uAD34|\uCE68\uC218|\uC0B0\uC0AC\uD0DC)/u,
]);

function topicText(input = {}) {
  if (typeof input === 'string') return input;
  return [
    input?.title,
    input?.summary,
    input?.fullText,
    input?.description,
    input?.context,
    ...(input?.tags || []),
    ...(input?.verifiedFacts || []),
  ].filter(Boolean).join(' ');
}

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
  const text = topicText(input)
    .replace(/(\uC555\uC218(?:\u00B7|\s)*\uC218\uC0C9|\uC218\uC0C9\uC601\uC7A5)/gu, '');
  return SENSITIVE_TERMS.some(term => text.includes(term))
    || SENSITIVE_LIFE_TERMS.some(term => text.includes(term))
    || SENSITIVE_LIFE_PATTERNS.some(pattern => pattern.test(text));
}

function getMood(text) {
  if (isSensitiveTopic(text)) return 'serious';
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
  const sensitiveTopic = sensitive || isSensitiveTopic(topic);
  const resolvedMood = sensitiveTopic ? 'serious' : mood;
  const eligibleManifest = sensitiveTopic
    ? {
      ...manifest,
      tracks: manifest.tracks.filter(track => (
        track.mood === 'serious' && track.sensitiveEligible === true
      )),
    }
    : manifest;

  const ranked = rankMusicTracks({
    history,
    previousTrackId,
    mood: resolvedMood,
    publicationKey,
    manifest: eligibleManifest,
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
      reason: sensitiveTopic
        ? 'sensitive topic has no verified somber audio asset'
        : 'no verified audio asset',
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
    sensitive: sensitiveTopic,
    reason: sensitiveTopic
      ? `${selected.useCount} recent uses; sensitive topic requires somber audio`
      : `${selected.useCount} recent uses; ${selected.moodMatch ? 'mood matched' : 'least-used rotation'}`,
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
