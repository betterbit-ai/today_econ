#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BITS_PER_SAMPLE = 16;
const DURATION_SECONDS = 7;
const FRAME_COUNT = SAMPLE_RATE * DURATION_SECONDS;
const OUTPUT_ROOT = path.join(__dirname, '..', 'assets', 'audio', 'diem');
const MANIFEST_PATH = path.join(OUTPUT_ROOT, 'manifest.json');

const TRACKS = Object.freeze([
  {
    id: 'economy-steady',
    category: 'economy',
    mood: 'steady',
    filename: 'economy-steady.wav',
    bpm: 94,
    root: 110,
    chord: [1, 1.189207, 1.498307, 2],
    pattern: [0, 2, 1, 3, 0, 1, 2, 1],
    brightness: 0.26,
    pulse: 0.34,
    seed: 1101,
  },
  {
    id: 'economy-bright',
    category: 'economy',
    mood: 'bright',
    filename: 'economy-bright.wav',
    bpm: 108,
    root: 130.8128,
    chord: [1, 1.259921, 1.498307, 1.887749],
    pattern: [0, 1, 2, 3, 2, 1, 3, 1],
    brightness: 0.42,
    pulse: 0.28,
    seed: 1308,
  },
  {
    id: 'economy-tech',
    category: 'economy',
    mood: 'tech',
    filename: 'economy-tech.wav',
    bpm: 116,
    root: 123.4708,
    chord: [1, 1.122462, 1.498307, 1.781797],
    pattern: [0, 3, 1, 2, 3, 1, 2, 0],
    brightness: 0.52,
    pulse: 0.46,
    seed: 1234,
  },
  {
    id: 'issue-newsroom',
    category: 'issue',
    mood: 'newsroom',
    filename: 'issue-newsroom.wav',
    bpm: 92,
    root: 98,
    chord: [1, 1.189207, 1.414214, 1.781797],
    pattern: [0, 2, 1, 0, 3, 1, 2, 0],
    brightness: 0.22,
    pulse: 0.38,
    seed: 9802,
  },
  {
    id: 'issue-documentary',
    category: 'issue',
    mood: 'documentary',
    filename: 'issue-documentary.wav',
    bpm: 78,
    root: 87.3071,
    chord: [1, 1.189207, 1.498307, 1.681793],
    pattern: [0, 1, 2, 1, 3, 2, 1, 0],
    brightness: 0.16,
    pulse: 0.2,
    seed: 8730,
  },
  {
    id: 'issue-restrained',
    category: 'issue',
    mood: 'restrained',
    filename: 'issue-restrained.wav',
    bpm: 100,
    root: 103.8262,
    chord: [1, 1.122462, 1.414214, 1.681793],
    pattern: [0, 2, 0, 1, 3, 1, 2, 1],
    brightness: 0.2,
    pulse: 0.3,
    seed: 1038,
  },
]);

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function envelope(time, duration, attack = 0.015, release = 0.24) {
  if (time < 0 || time >= duration) return 0;
  const attackGain = Math.min(1, time / attack);
  const releaseGain = Math.min(1, (duration - time) / release);
  return attackGain * releaseGain;
}

function softClip(value) {
  return Math.tanh(value * 1.2) / Math.tanh(1.2);
}

function writeWav(filePath, left, right) {
  const dataSize = FRAME_COUNT * CHANNELS * (BITS_PER_SAMPLE / 8);
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(CHANNELS, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS_PER_SAMPLE / 8), 28);
  buffer.writeUInt16LE(CHANNELS * (BITS_PER_SAMPLE / 8), 32);
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const offset = 44 + frame * 4;
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[frame])) * 32767), offset);
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[frame])) * 32767), offset + 2);
  }
  fs.writeFileSync(filePath, buffer);
}

function renderTrack(track) {
  const left = new Float32Array(FRAME_COUNT);
  const right = new Float32Array(FRAME_COUNT);
  const random = mulberry32(track.seed);
  const beatSeconds = 60 / track.bpm;
  const stepSeconds = beatSeconds / 2;
  const phaseOffsets = [0, 0.7, 1.9, 2.8];
  let filteredNoise = 0;

  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const time = frame / SAMPLE_RATE;
    const globalFade = Math.min(1, time / 0.18, (DURATION_SECONDS - time) / 0.45);
    const step = Math.floor(time / stepSeconds);
    const stepTime = time - step * stepSeconds;
    const noteIndex = track.pattern[step % track.pattern.length];
    const frequency = track.root * track.chord[noteIndex];

    const pad = track.chord.reduce((sum, ratio, index) => {
      const detune = index % 2 === 0 ? 0.997 : 1.003;
      const oscillator = Math.sin(2 * Math.PI * track.root * ratio * detune * time + phaseOffsets[index]);
      const overtone = Math.sin(2 * Math.PI * track.root * ratio * 2 * time + phaseOffsets[index] / 2) * track.brightness;
      return sum + oscillator + overtone;
    }, 0) / (track.chord.length * 1.45);

    const pluckEnvelope = envelope(stepTime, Math.min(stepSeconds * 0.82, 0.32), 0.008, 0.2);
    const pluck = (
      Math.sin(2 * Math.PI * frequency * time) +
      0.38 * Math.sin(2 * Math.PI * frequency * 2 * time) +
      0.16 * Math.sin(2 * Math.PI * frequency * 3 * time)
    ) * pluckEnvelope;

    const beatTime = time % beatSeconds;
    const kickEnvelope = envelope(beatTime, 0.16, 0.003, 0.14);
    const kickFrequency = 48 + 42 * Math.exp(-beatTime * 28);
    const kick = Math.sin(2 * Math.PI * kickFrequency * time) * kickEnvelope * track.pulse;

    const halfBeatTime = time % (beatSeconds / 2);
    const noise = random() * 2 - 1;
    filteredNoise += 0.08 * (noise - filteredNoise);
    const tick = filteredNoise * envelope(halfBeatTime, 0.055, 0.002, 0.045) * (0.08 + track.brightness * 0.06);

    const slowMovement = 0.9 + 0.1 * Math.sin(2 * Math.PI * time / DURATION_SECONDS);
    const mono = softClip((pad * 0.28 * slowMovement) + (pluck * 0.21) + kick + tick) * globalFade * 0.72;
    const pan = 0.12 * Math.sin(2 * Math.PI * time / (beatSeconds * 4) + noteIndex);
    left[frame] = mono * (1 - pan);
    right[frame] = mono * (1 + pan);
  }

  writeWav(path.join(OUTPUT_ROOT, track.filename), left, right);
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function main() {
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
  for (const track of TRACKS) renderTrack(track);

  const current = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const byId = new Map(TRACKS.map(track => [track.id, track]));
  current.tracks = current.tracks.map(entry => {
    const definition = byId.get(entry.id);
    if (!definition) throw new Error(`Manifest contains unknown track: ${entry.id}`);
    const filePath = path.join(OUTPUT_ROOT, definition.filename);
    return { ...entry, sha256: sha256(filePath) };
  });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
  console.log(`Generated ${TRACKS.length} original DIEM tracks at ${SAMPLE_RATE} Hz.`);
}

if (require.main === module) main();

module.exports = { DURATION_SECONDS, SAMPLE_RATE, TRACKS, renderTrack };
