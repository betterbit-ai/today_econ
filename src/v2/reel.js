const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const DIEM_REEL = Object.freeze({
  width: 1080,
  height: 1920,
  durationSeconds: 7,
  contentSeconds: 5,
  followCtaSeconds: 2,
  transitionSeconds: 0.35,
  fps: 30,
  frameCount: 210,
  audioSampleRate: 48_000,
  audioVolume: 0.3,
});
const DIEM_BASIC_REEL = Object.freeze({
  width: 1080,
  height: 1920,
  durationSeconds: 19,
  sceneDurations: Object.freeze([3, 4, 5, 4, 3]),
  transitionSeconds: 0.35,
  fps: 30,
  frameCount: 570,
  audioSampleRate: 48_000,
  audioVolume: 0.26,
});

function resolveFfmpegPath() {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

async function runFfmpeg(args, {
  execFileImpl = execFileAsync,
  ffmpegPath = resolveFfmpegPath(),
} = {}) {
  try {
    return await execFileImpl(ffmpegPath, args, { maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    const details = error.stderr || error.stdout || error.message;
    throw new Error(`[DIEM Reel] ffmpeg failed: ${String(details).trim()}`);
  }
}

function buildDiemVideoFilter() {
  const { width, height } = DIEM_REEL;
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    'setsar=1',
    'format=yuv420p',
  ].join(',');
}

function buildDiemReelArgs({
  imagePath,
  followCtaImagePath,
  audioPath,
  outputPath,
} = {}) {
  const {
    durationSeconds,
    contentSeconds,
    followCtaSeconds,
    transitionSeconds,
    fps,
    frameCount,
    audioSampleRate,
    audioVolume,
  } = DIEM_REEL;
  const args = [
    '-y',
    '-loop', '1',
    '-framerate', String(fps),
    '-t', String(followCtaImagePath ? contentSeconds + transitionSeconds : durationSeconds),
    '-i', imagePath,
  ];
  if (followCtaImagePath) {
    args.push('-loop', '1', '-framerate', String(fps), '-t', String(followCtaSeconds), '-i', followCtaImagePath);
  }
  if (audioPath) {
    args.push('-stream_loop', '-1', '-i', audioPath);
  } else {
    args.push(
      '-f', 'lavfi',
      '-t', String(durationSeconds),
      '-i', `anullsrc=channel_layout=stereo:sample_rate=${audioSampleRate}`,
    );
  }
  const audioIndex = followCtaImagePath ? 2 : 1;
  const video = followCtaImagePath
    ? `[0:v]${buildDiemVideoFilter()},trim=duration=${contentSeconds + transitionSeconds},setpts=PTS-STARTPTS[content];[1:v]${buildDiemVideoFilter()},trim=duration=${followCtaSeconds},setpts=PTS-STARTPTS[cta];[content][cta]xfade=transition=fade:duration=${transitionSeconds}:offset=${contentSeconds}[v]`
    : `[0:v]${buildDiemVideoFilter()}[v]`;
  args.push(
    '-filter_complex',
    `${video};[${audioIndex}:a]atrim=duration=${durationSeconds},asetpts=N/SR/TB,volume=${audioVolume},afade=t=in:st=0:d=0.18,afade=t=out:st=6.55:d=0.45,aresample=${audioSampleRate}[a]`,
    '-map', '[v]',
    '-map', '[a]',
    '-frames:v', String(frameCount),
    '-t', String(durationSeconds),
    '-r', String(fps),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-profile:v', 'high',
    '-level', '4.0',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-keyint_min', '60',
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ar', String(audioSampleRate),
    '-ac', '2',
    '-movflags', '+faststart',
    outputPath,
  );
  return args;
}

function buildDiemBasicReelArgs({
  cardPaths = [],
  audioPath,
  outputPath,
} = {}) {
  if (cardPaths.length !== 5) throw new Error('[DIEM Basic Reel] Exactly five card paths are required.');
  const {
    durationSeconds,
    sceneDurations,
    transitionSeconds,
    fps,
    frameCount,
    audioSampleRate,
    audioVolume,
  } = DIEM_BASIC_REEL;
  const args = ['-y'];
  cardPaths.forEach((cardPath, index) => {
    const encodedDuration = sceneDurations[index] + (index < cardPaths.length - 1 ? transitionSeconds : 0);
    args.push('-loop', '1', '-framerate', String(fps), '-t', String(encodedDuration), '-i', cardPath);
  });
  if (audioPath) args.push('-stream_loop', '-1', '-i', audioPath);
  else args.push('-f', 'lavfi', '-t', String(durationSeconds), '-i', `anullsrc=channel_layout=stereo:sample_rate=${audioSampleRate}`);

  const videoInputs = cardPaths.map((_, index) => `[${index}:v]${buildDiemVideoFilter()},setpts=PTS-STARTPTS[v${index}]`);
  const offsets = sceneDurations.slice(0, -1).reduce((values, current) => {
    const previous = values.length ? values[values.length - 1] : 0;
    values.push(previous + current);
    return values;
  }, []);
  const transitions = offsets.map((offset, index) => {
    const left = index === 0 ? '[v0]' : `[x${index}]`;
    const right = `[v${index + 1}]`;
    const output = index === offsets.length - 1 ? '[v]' : `[x${index + 1}]`;
    return `${left}${right}xfade=transition=fade:duration=${transitionSeconds}:offset=${offset}${output}`;
  });
  const audioIndex = cardPaths.length;
  const audio = `[${audioIndex}:a]atrim=duration=${durationSeconds},asetpts=N/SR/TB,volume=${audioVolume},afade=t=in:st=0:d=0.25,afade=t=out:st=18.3:d=0.7,aresample=${audioSampleRate}[a]`;
  args.push(
    '-filter_complex', [...videoInputs, ...transitions, audio].join(';'),
    '-map', '[v]',
    '-map', '[a]',
    '-frames:v', String(frameCount),
    '-t', String(durationSeconds),
    '-r', String(fps),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-profile:v', 'high',
    '-level', '4.0',
    '-pix_fmt', 'yuv420p',
    '-g', '60',
    '-keyint_min', '60',
    '-sc_threshold', '0',
    '-c:a', 'aac',
    '-b:a', '96k',
    '-ar', String(audioSampleRate),
    '-ac', '2',
    '-movflags', '+faststart',
    outputPath,
  );
  return args;
}

async function createDiemReelVideo({
  imagePath,
  followCtaImagePath,
  outputPath = path.join(os.tmpdir(), `diem-reel-${Date.now()}.mp4`),
  audioPath = null,
  execFileImpl,
  fsImpl = fs,
  ffmpegPath,
} = {}) {
  if (!imagePath || !fsImpl.existsSync(imagePath)) {
    throw new Error(`[DIEM Reel] Image not found: ${imagePath || '(missing)'}`);
  }
  if (followCtaImagePath && !fsImpl.existsSync(followCtaImagePath)) {
    throw new Error(`[DIEM Reel] Follow CTA image not found: ${followCtaImagePath}`);
  }
  if (audioPath && !fsImpl.existsSync(audioPath)) {
    throw new Error(`[DIEM Reel] Audio not found: ${audioPath}`);
  }
  fsImpl.mkdirSync(path.dirname(outputPath), { recursive: true });
  const args = buildDiemReelArgs({ imagePath, followCtaImagePath, audioPath, outputPath });
  await runFfmpeg(args, { execFileImpl, ffmpegPath });
  return outputPath;
}

async function createDiemBasicReelVideo({
  cardPaths,
  outputPath = path.join(os.tmpdir(), `diem-basic-reel-${Date.now()}.mp4`),
  audioPath = null,
  execFileImpl,
  fsImpl = fs,
  ffmpegPath,
} = {}) {
  if (!Array.isArray(cardPaths) || cardPaths.length !== 5) {
    throw new Error('[DIEM Basic Reel] Exactly five cards are required.');
  }
  for (const cardPath of cardPaths) {
    if (!cardPath || !fsImpl.existsSync(cardPath)) throw new Error(`[DIEM Basic Reel] Card not found: ${cardPath || '(missing)'}`);
  }
  if (audioPath && !fsImpl.existsSync(audioPath)) throw new Error(`[DIEM Basic Reel] Audio not found: ${audioPath}`);
  fsImpl.mkdirSync(path.dirname(outputPath), { recursive: true });
  await runFfmpeg(buildDiemBasicReelArgs({ cardPaths, audioPath, outputPath }), { execFileImpl, ffmpegPath });
  return outputPath;
}

async function createDiemReelWithMusic({
  imagePath,
  followCtaImagePath,
  outputPath,
  music,
  execFileImpl,
  fsImpl = fs,
  ffmpegPath,
  createVideoImpl = createDiemReelVideo,
} = {}) {
  const candidates = music?.mode === 'track'
    ? (music.candidates || [{ trackId: music.trackId, path: music.path }]).slice(0, 2)
    : [];
  const attempts = [];

  for (const candidate of candidates) {
    try {
      const renderedPath = await createVideoImpl({
        imagePath,
        followCtaImagePath,
        outputPath,
        audioPath: candidate.path,
        execFileImpl,
        fsImpl,
        ffmpegPath,
      });
      attempts.push({ mode: 'track', trackId: candidate.trackId, status: 'succeeded' });
      return {
        outputPath: renderedPath,
        audio: {
          mode: 'track',
          trackId: candidate.trackId,
          category: candidate.category || music.category,
          mood: candidate.mood || music.mood,
          title: candidate.title || music.title,
          license: candidate.license || music.license,
          source: candidate.source || music.source,
          sha256: candidate.sha256 || music.sha256,
          reason: attempts.length > 1
            ? 'selected track mix failed; alternate track used'
            : music.reason,
          fallback: attempts.length > 1,
        },
        attempts,
      };
    } catch (error) {
      attempts.push({
        mode: 'track',
        trackId: candidate.trackId,
        status: 'failed',
        error: error.message,
      });
    }
  }

  const silentPath = await createVideoImpl({
    imagePath,
    followCtaImagePath,
    outputPath,
    audioPath: null,
    execFileImpl,
    fsImpl,
    ffmpegPath,
  });
  attempts.push({ mode: 'silent', trackId: null, status: 'succeeded' });
  return {
    outputPath: silentPath,
    audio: {
      mode: 'silent',
      trackId: null,
      reason: candidates.length ? 'audio mixing failed twice' : (music?.reason || 'silent selected'),
      fallback: candidates.length > 0,
    },
    attempts,
  };
}

async function createDiemBasicReelWithMusic({
  cardPaths,
  outputPath,
  music,
  execFileImpl,
  fsImpl = fs,
  ffmpegPath,
  createVideoImpl = createDiemBasicReelVideo,
} = {}) {
  const candidates = music?.mode === 'track'
    ? (music.candidates || [{ trackId: music.trackId, path: music.path }]).slice(0, 2)
    : [];
  const attempts = [];
  for (const candidate of candidates) {
    try {
      const renderedPath = await createVideoImpl({ cardPaths, outputPath, audioPath: candidate.path, execFileImpl, fsImpl, ffmpegPath });
      attempts.push({ mode: 'track', trackId: candidate.trackId, status: 'succeeded' });
      return {
        outputPath: renderedPath,
        audio: {
          mode: 'track',
          trackId: candidate.trackId,
          category: candidate.category || music.category,
          mood: candidate.mood || music.mood,
          title: candidate.title || music.title,
          license: candidate.license || music.license,
          source: candidate.source || music.source,
          sha256: candidate.sha256 || music.sha256,
          reason: attempts.length > 1 ? 'selected track mix failed; alternate track used' : music.reason,
          fallback: attempts.length > 1,
        },
        attempts,
      };
    } catch (error) {
      attempts.push({ mode: 'track', trackId: candidate.trackId, status: 'failed', error: error.message });
    }
  }
  const silentPath = await createVideoImpl({ cardPaths, outputPath, audioPath: null, execFileImpl, fsImpl, ffmpegPath });
  attempts.push({ mode: 'silent', trackId: null, status: 'succeeded' });
  return {
    outputPath: silentPath,
    audio: {
      mode: 'silent',
      trackId: null,
      reason: candidates.length ? 'audio mixing failed twice' : (music?.reason || 'silent selected'),
      fallback: candidates.length > 0,
    },
    attempts,
  };
}

module.exports = {
  DIEM_BASIC_REEL,
  DIEM_REEL,
  buildDiemBasicReelArgs,
  buildDiemReelArgs,
  buildDiemVideoFilter,
  createDiemBasicReelVideo,
  createDiemBasicReelWithMusic,
  createDiemReelVideo,
  createDiemReelWithMusic,
  runFfmpeg,
};
