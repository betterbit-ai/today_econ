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
  fps: 30,
  frameCount: 210,
  audioSampleRate: 48_000,
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
  const { width, height, frameCount, fps } = DIEM_REEL;
  const lastFrame = frameCount - 1;
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    `zoompan=z='1+0.012*(1-cos(2*PI*on/${lastFrame}))/2':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`,
    'setsar=1',
    'format=yuv420p',
  ].join(',');
}

function buildDiemReelArgs({
  imagePath,
  audioPath,
  outputPath,
} = {}) {
  const { durationSeconds, fps, frameCount, audioSampleRate } = DIEM_REEL;
  const args = [
    '-y',
    '-loop', '1',
    '-framerate', String(fps),
    '-t', String(durationSeconds),
    '-i', imagePath,
  ];
  if (audioPath) {
    args.push('-stream_loop', '-1', '-i', audioPath);
  } else {
    args.push(
      '-f', 'lavfi',
      '-t', String(durationSeconds),
      '-i', `anullsrc=channel_layout=stereo:sample_rate=${audioSampleRate}`,
    );
  }
  args.push(
    '-filter_complex',
    `[0:v]${buildDiemVideoFilter()}[v];[1:a]atrim=duration=${durationSeconds},asetpts=N/SR/TB,volume=0.16,afade=t=in:st=0:d=0.18,afade=t=out:st=6.55:d=0.45,aresample=${audioSampleRate}[a]`,
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
  outputPath = path.join(os.tmpdir(), `diem-reel-${Date.now()}.mp4`),
  audioPath = null,
  execFileImpl,
  fsImpl = fs,
  ffmpegPath,
} = {}) {
  if (!imagePath || !fsImpl.existsSync(imagePath)) {
    throw new Error(`[DIEM Reel] Image not found: ${imagePath || '(missing)'}`);
  }
  if (audioPath && !fsImpl.existsSync(audioPath)) {
    throw new Error(`[DIEM Reel] Audio not found: ${audioPath}`);
  }
  fsImpl.mkdirSync(path.dirname(outputPath), { recursive: true });
  const args = buildDiemReelArgs({ imagePath, audioPath, outputPath });
  await runFfmpeg(args, { execFileImpl, ffmpegPath });
  return outputPath;
}

async function createDiemReelWithMusic({
  imagePath,
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

module.exports = {
  DIEM_REEL,
  buildDiemReelArgs,
  buildDiemVideoFilter,
  createDiemReelVideo,
  createDiemReelWithMusic,
  runFfmpeg,
};
