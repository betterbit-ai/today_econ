const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  DEFAULT_AUDIO_ROOT,
  isSensitiveTopic,
  loadMusicManifest,
  rankMusicTracks,
  selectMusic,
  verifyTrackAsset,
} = require('../src/v2/music');
const {
  DIEM_REEL,
  buildDiemReelArgs,
  buildDiemVideoFilter,
  createDiemReelVideo,
  createDiemReelWithMusic,
} = require('../src/v2/reel');

test('ships three verified original tracks for each DIEM category', () => {
  const manifest = loadMusicManifest();
  assert.equal(manifest.source, 'original-procedural');
  assert.equal(manifest.durationSeconds, 7);
  assert.equal(manifest.sampleRate, 48000);
  for (const category of ['economy', 'issue']) {
    const tracks = manifest.tracks.filter(track => track.category === category);
    assert.equal(tracks.length, 3);
    assert.equal(new Set(tracks.map(track => track.id)).size, 3);
    tracks.forEach(track => {
      assert.match(track.sha256, /^[a-f0-9]{64}$/);
      assert.equal(verifyTrackAsset(track).ok, true);
    });
  }
  assert.equal(fs.existsSync(path.join(DEFAULT_AUDIO_ROOT, 'LICENSE.md')), true);
});

test('rotates the least-used track and excludes the previous track', () => {
  const manifest = loadMusicManifest();
  const history = [
    { category: 'economy', audioTrackId: 'economy-steady' },
    { category: 'economy', audioTrackId: 'economy-bright' },
    { category: 'economy', audioTrackId: 'economy-steady' },
  ];
  const ranked = rankMusicTracks({
    category: 'economy',
    history,
    previousTrackId: 'economy-bright',
    mood: 'tech',
    publicationKey: 'diem:2026-07-25:economy',
    manifest,
  });
  assert.equal(ranked[0].id, 'economy-tech');
  assert.ok(ranked.every(track => track.id !== 'economy-bright'));

  const selection = selectMusic({
    category: 'economy',
    history,
    previousTrackId: 'economy-bright',
    mood: 'tech',
    publicationKey: 'diem:2026-07-25:economy',
    manifest,
  });
  assert.equal(selection.trackId, 'economy-tech');
  assert.equal(selection.candidates.length, 2);
  assert.match(selection.sha256, /^[a-f0-9]{64}$/);
});

test('uses silence for sensitive topics', () => {
  assert.equal(isSensitiveTopic({ title: '산불 희생자 애도 기간 선포' }), true);
  const selection = selectMusic({
    category: 'issue',
    topic: { title: '지진 피해와 희생자 추모' },
    publicationKey: 'diem:2026-07-25:issue',
  });
  assert.equal(selection.mode, 'silent');
  assert.equal(selection.trackId, null);
  assert.match(selection.reason, /sensitive/);
});

test('builds a single-image seven-second loop-safe H.264/AAC command', () => {
  const args = buildDiemReelArgs({
    imagePath: '/tmp/cover.png',
    audioPath: '/tmp/music.wav',
    outputPath: '/tmp/reel.mp4',
  });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.equal(args.filter(value => value === '-i').length, 2);
  assert.ok(buildDiemVideoFilter().includes('cos(2*PI*on/209)'));
  assert.match(filter, /1080x1920/);
  assert.ok(args.includes('210'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('48000'));
  assert.ok(args.includes('+faststart'));
  assert.equal(args.at(-1), '/tmp/reel.mp4');

  const silentArgs = buildDiemReelArgs({
    imagePath: '/tmp/cover.png',
    outputPath: '/tmp/silent.mp4',
  });
  assert.ok(silentArgs.includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
});

test('tries one alternate track and then creates an AAC-silent Reel', async () => {
  const calls = [];
  const result = await createDiemReelWithMusic({
    imagePath: '/tmp/cover.png',
    outputPath: '/tmp/reel.mp4',
    music: {
      mode: 'track',
      candidates: [
        { trackId: 'economy-steady', path: '/tmp/one.wav' },
        { trackId: 'economy-bright', path: '/tmp/two.wav' },
        { trackId: 'economy-tech', path: '/tmp/three.wav' },
      ],
    },
    createVideoImpl: async options => {
      calls.push(options.audioPath);
      if (options.audioPath) throw new Error('audio mix failed');
      return options.outputPath;
    },
  });
  assert.deepEqual(calls, ['/tmp/one.wav', '/tmp/two.wav', null]);
  assert.equal(result.audio.mode, 'silent');
  assert.equal(result.audio.reason, 'audio mixing failed twice');
  assert.deepEqual(result.attempts.map(attempt => attempt.status), ['failed', 'failed', 'succeeded']);
});

test('stops after a successful alternate track', async () => {
  const calls = [];
  const result = await createDiemReelWithMusic({
    imagePath: '/tmp/cover.png',
    outputPath: '/tmp/reel.mp4',
    music: {
      mode: 'track',
      candidates: [
        { trackId: 'issue-newsroom', path: '/tmp/one.wav' },
        { trackId: 'issue-documentary', path: '/tmp/two.wav', sha256: 'abc' },
      ],
    },
    createVideoImpl: async options => {
      calls.push(options.audioPath);
      if (calls.length === 1) throw new Error('first track failed');
      return options.outputPath;
    },
  });
  assert.deepEqual(calls, ['/tmp/one.wav', '/tmp/two.wav']);
  assert.equal(result.audio.trackId, 'issue-documentary');
  assert.equal(result.audio.fallback, true);
  assert.match(result.audio.reason, /alternate/);
});

const hasMediaTools = ['ffmpeg', 'ffprobe'].every(command => (
  spawnSync(command, ['-version'], { stdio: 'ignore' }).status === 0
));

test('creates a Reel that passes ffprobe media requirements', { skip: !hasMediaTools }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-v2-media-'));
  const imagePath = path.join(directory, 'cover.ppm');
  const outputPath = path.join(directory, 'reel.mp4');
  fs.writeFileSync(imagePath, Buffer.from('P6\n1 1\n255\n\x08\x0c\x16', 'binary'));
  const music = selectMusic({
    category: 'economy',
    mood: 'steady',
    publicationKey: 'diem:2026-07-25:economy',
  });

  await createDiemReelVideo({
    imagePath,
    audioPath: music.path,
    outputPath,
  });
  const probe = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,sample_rate,channels',
    '-of', 'json',
    outputPath,
  ], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr);
  const media = JSON.parse(probe.stdout);
  const video = media.streams.find(stream => stream.codec_type === 'video');
  const audio = media.streams.find(stream => stream.codec_type === 'audio');
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.width, DIEM_REEL.width);
  assert.equal(video.height, DIEM_REEL.height);
  assert.equal(video.avg_frame_rate, '30/1');
  assert.equal(video.pix_fmt, 'yuv420p');
  assert.equal(audio.codec_name, 'aac');
  assert.equal(audio.sample_rate, '48000');
  assert.equal(audio.channels, 2);
  assert.ok(Math.abs(Number(media.format.duration) - 7) < 0.08, media.format.duration);
});
