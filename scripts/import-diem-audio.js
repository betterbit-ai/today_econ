#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const AUDIO_ROOT = path.join(__dirname, '..', 'assets', 'audio', 'diem');
const MANIFEST_PATH = path.join(AUDIO_ROOT, 'manifest.json');
const ALLOWED_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.wav']);
const ALLOWED_MOODS = new Set(['bright', 'serious']);

function parseArgs(argv = process.argv.slice(2)) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function sanitizeId(value = '') {
  return String(value)
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-z가-힣_-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64);
}

function sha256File(filePath, fsImpl = fs) {
  return crypto.createHash('sha256').update(fsImpl.readFileSync(filePath)).digest('hex');
}

function loadManifest(manifestPath = MANIFEST_PATH, fsImpl = fs) {
  return JSON.parse(fsImpl.readFileSync(manifestPath, 'utf8'));
}

function saveManifest(manifest, manifestPath = MANIFEST_PATH, fsImpl = fs) {
  fsImpl.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function importDiemAudio({
  inputPath,
  id,
  mood,
  title,
  license,
  source,
  category,
  audioRoot = AUDIO_ROOT,
  manifestPath = MANIFEST_PATH,
  fsImpl = fs,
} = {}) {
  if (!inputPath) throw new Error('Usage: npm run diem:audio:import -- <file> --mood bright|serious --license "..." --source "..." [--id ...] [--title ...]');
  const resolvedInput = path.resolve(inputPath);
  if (!fsImpl.existsSync(resolvedInput)) throw new Error(`Audio file not found: ${resolvedInput}`);
  const extension = path.extname(resolvedInput).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported audio extension: ${extension || '(none)'}. Use mp3, m4a, aac, or wav.`);
  }
  if (!ALLOWED_MOODS.has(mood)) throw new Error('Mood must be "bright" or "serious".');
  if (!license || license === true) throw new Error('License is required. Example: --license "Pixabay Content License"');
  if (!source || source === true) throw new Error('Source URL or provenance is required. Example: --source "https://..."');

  const trackId = sanitizeId(id || path.basename(resolvedInput, extension));
  if (!trackId) throw new Error('Track id is empty after sanitization.');
  const manifest = loadManifest(manifestPath, fsImpl);
  if (manifest.tracks.some(track => track.id === trackId)) {
    throw new Error(`Track id already exists: ${trackId}`);
  }

  fsImpl.mkdirSync(audioRoot, { recursive: true });
  const filename = `${trackId}${extension}`;
  const destination = path.join(audioRoot, filename);
  if (fsImpl.existsSync(destination)) throw new Error(`Destination already exists: ${destination}`);
  fsImpl.copyFileSync(resolvedInput, destination);
  const sha256 = sha256File(destination, fsImpl);

  const entry = {
    id: trackId,
    filename,
    mood,
    sha256,
    ...(category ? { category } : {}),
    ...(title ? { title } : {}),
    license,
    source,
  };
  manifest.tracks.push(entry);
  saveManifest(manifest, manifestPath, fsImpl);
  return { entry, destination };
}

function main() {
  const args = parseArgs();
  const inputPath = args._[0];
  const result = importDiemAudio({
    inputPath,
    id: args.id,
    mood: args.mood,
    title: args.title,
    license: args.license,
    source: args.source,
    category: args.category,
  });
  console.log(`Imported DIEM audio: ${result.entry.id}`);
  console.log(`File: ${path.relative(process.cwd(), result.destination)}`);
  console.log(`SHA-256: ${result.entry.sha256}`);
}

if (require.main === module) main();

module.exports = {
  ALLOWED_EXTENSIONS,
  ALLOWED_MOODS,
  importDiemAudio,
  parseArgs,
  sanitizeId,
};
