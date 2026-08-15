#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  packageContentHash,
  sha256File,
  validateBasicPackage,
} = require('../src/v2/basic-content');
const { renderBasicLessonCards } = require('../src/v2/basic-cards');
const { loadMusicManifest, verifyTrackAsset } = require('../src/v2/music');
const { createDiemBasicReelWithMusic } = require('../src/v2/reel');

const ROOT = path.join(process.cwd(), 'content', 'diem-basic');

function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--id') options.id = argv[++index];
    else throw new Error(`[DIEM Basic Build] Unknown option: ${argv[index]}`);
  }
  return options;
}

function loadEntries() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  return manifest.items.map(entry => ({
    ...entry,
    filePath: path.join(ROOT, entry.file),
  }));
}

async function buildPackage(entry) {
  const item = JSON.parse(fs.readFileSync(entry.filePath, 'utf8'));
  const directory = path.dirname(entry.filePath);
  const coverPath = path.join(directory, item.artifacts.coverPath);
  const reelPath = path.join(directory, item.artifacts.reelPath);
  const cardsDirectory = path.join(directory, 'cards');
  const manifest = loadMusicManifest();
  const track = manifest.tracks.find(candidate => candidate.id === item.audio.trackId);
  if (!track) throw new Error(`[DIEM Basic Build] Unknown audio track: ${item.audio.trackId}`);
  const verified = verifyTrackAsset(track);
  if (!verified.ok || verified.actualSha256 !== item.audio.sha256) {
    throw new Error(`[DIEM Basic Build] Audio verification failed for ${item.id}: ${verified.reason || 'package hash mismatch'}`);
  }

  const cards = await renderBasicLessonCards({ item, outputDirectory: cardsDirectory });
  fs.copyFileSync(cards[0].path, coverPath);
  const music = {
    mode: 'track',
    trackId: track.id,
    category: 'economy',
    mood: item.audio.mood,
    title: item.audio.title,
    path: verified.filePath,
    license: item.audio.license,
    source: item.audio.source,
    sha256: item.audio.sha256,
    reason: 'preauthored DIEM Basic soundtrack',
    candidates: [{
      trackId: track.id,
      category: 'economy',
      mood: item.audio.mood,
      title: item.audio.title,
      path: verified.filePath,
      license: item.audio.license,
      source: item.audio.source,
      sha256: item.audio.sha256,
    }],
  };
  const reel = await createDiemBasicReelWithMusic({
    cardPaths: cards.map(card => card.path),
    outputPath: reelPath,
    music,
  });
  if (reel.audio.mode !== 'track' || reel.audio.trackId !== item.audio.trackId) {
    throw new Error(`[DIEM Basic Build] Audio mixing fell back for ${item.id}.`);
  }

  item.artifacts.coverSha256 = sha256File(coverPath);
  item.artifacts.reelSha256 = sha256File(reelPath);
  item.artifacts.cards = cards.map(card => ({
    path: path.relative(directory, card.path),
    role: card.role,
    durationSeconds: card.durationSeconds,
    sha256: sha256File(card.path),
  }));
  item.integrity.contentSha256 = packageContentHash(item);
  fs.writeFileSync(entry.filePath, `${JSON.stringify(item, null, 2).normalize('NFC')}\n`, 'utf8');

  const validation = validateBasicPackage({ ...item, _file: entry.filePath, _directory: directory });
  if (!validation.ok) throw new Error(`[DIEM Basic Build] ${item.id}: ${validation.errors.join('; ')}`);
  console.log(`[DIEM Basic Build] ${item.id}: ${path.basename(coverPath)}, ${path.basename(reelPath)}`);
}

async function main() {
  const options = parseArgs();
  const entries = loadEntries().filter(entry => !options.id || entry.id === options.id);
  if (!entries.length) throw new Error(`[DIEM Basic Build] Content ID not found: ${options.id}`);
  for (const entry of entries) await buildPackage(entry);
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildPackage, loadEntries, parseArgs };
