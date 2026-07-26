const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { importDiemAudio, sanitizeId } = require('../scripts/import-diem-audio');

test('sanitizes user-provided audio ids for durable manifest entries', () => {
  assert.equal(sanitizeId('DIEM News Beat 01!'), 'diem-news-beat-01');
  assert.equal(sanitizeId('경제_밝은 루프'), '경제_밝은-루프');
});

test('imports a user audio file with rights metadata and sha256', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-audio-import-'));
  const audioRoot = path.join(directory, 'audio');
  const manifestPath = path.join(audioRoot, 'manifest.json');
  fs.mkdirSync(audioRoot, { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify({ schemaVersion: 1, tracks: [] }));
  const inputPath = path.join(directory, 'source.mp3');
  fs.writeFileSync(inputPath, Buffer.from('not-a-real-mp3-but-hashable'));

  const result = importDiemAudio({
    inputPath,
    id: 'daily-market-pulse',
    mood: 'bright',
    title: 'Daily Market Pulse',
    license: 'Test License',
    source: 'https://example.com/audio',
    audioRoot,
    manifestPath,
  });

  assert.equal(result.entry.id, 'daily-market-pulse');
  assert.equal(result.entry.filename, 'daily-market-pulse.mp3');
  assert.equal(result.entry.mood, 'bright');
  assert.equal(result.entry.license, 'Test License');
  assert.match(result.entry.sha256, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(path.join(audioRoot, 'daily-market-pulse.mp3')), true);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(manifest.tracks, [result.entry]);
});
