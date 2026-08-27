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
  DIEM_BASIC_REEL,
  DIEM_REEL,
  buildDiemBasicReelArgs,
  buildDiemReelArgs,
  buildDiemVideoFilter,
  createDiemReelVideo,
  createDiemReelWithMusic,
} = require('../src/v2/reel');

test('ships verified tracks for each mood category', () => {
  const manifest = loadMusicManifest();
  const brightTracks = manifest.tracks.filter(track => track.mood === 'bright');
  const seriousTracks = manifest.tracks.filter(track => track.mood === 'serious');

  assert.ok(brightTracks.length >= 3);
  assert.ok(seriousTracks.length >= 4);
  assert.equal(new Set(manifest.tracks.map(track => track.id)).size, manifest.tracks.length);
  assert.ok(manifest.tracks.some(track => track.provider === 'mixkit' && track.processed === true));
  assert.ok(manifest.tracks.some(track => track.provider === 'pixabay' && track.processed === true));

  manifest.tracks.forEach(track => {
    assert.match(track.sha256, /^[a-f0-9]{64}$/);
    assert.equal(verifyTrackAsset(track).ok, true);
  });
  assert.equal(fs.existsSync(path.join(DEFAULT_AUDIO_ROOT, 'LICENSE.md')), true);
});

test('rotates the least-used track and excludes the previous track', () => {
  const manifest = {
    schemaVersion: 1,
    tracks: [
      { id: 'bright1', filename: 'bright1.mp3', mood: 'bright' },
      { id: 'bright2', filename: 'bright2.mp3', mood: 'bright' },
      { id: 'bright3', filename: 'bright3.mp3', mood: 'bright' },
    ],
  };
  const history = [
    { mood: 'bright', audioTrackId: 'bright2' },
    { mood: 'bright', audioTrackId: 'bright1' },
    { mood: 'bright', audioTrackId: 'bright2' },
  ];
  const ranked = rankMusicTracks({
    history,
    previousTrackId: 'bright1',
    mood: 'bright',
    publicationKey: 'diem:2026-07-25:economy',
    manifest,
  });
  assert.equal(ranked[0].id, 'bright3');
  assert.ok(ranked.every(track => track.id !== 'bright1'));
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

test('builds a seven-second Reel with a soft fade into the final follow sticker', () => {
  const args = buildDiemReelArgs({
    imagePath: '/tmp/cover.png',
    followCtaImagePath: '/tmp/follow-cta.png',
    audioPath: '/tmp/music.wav',
    outputPath: '/tmp/reel.mp4',
  });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.equal(args.filter(value => value === '-i').length, 3);
  assert.doesNotMatch(buildDiemVideoFilter(), /zoompan|cos\(2\*PI\*on/u);
  assert.match(filter, /scale=1080:1920/);
  assert.match(filter, /trim=duration=5\.35/u);
  assert.match(filter, /trim=duration=2/u);
  assert.match(filter, /xfade=transition=fade:duration=0\.35:offset=5/u);
  assert.doesNotMatch(filter, /\[content\]\[cta\]concat=/u);
  assert.match(filter, /\[2:a\]/u);
  assert.match(filter, /volume=0\.3/);
  assert.ok(args.includes('210'));
  assert.ok(args.includes('libx264'));
  assert.ok(args.includes('yuv420p'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('48000'));
  assert.ok(args.includes('+faststart'));
  assert.equal(args.at(-1), '/tmp/reel.mp4');

  const silentArgs = buildDiemReelArgs({
    imagePath: '/tmp/cover.png',
    followCtaImagePath: '/tmp/follow-cta.png',
    outputPath: '/tmp/silent.mp4',
  });
  assert.ok(silentArgs.includes('anullsrc=channel_layout=stereo:sample_rate=48000'));
});

test('builds a five-card nineteen-second educational Reel with only static fades', () => {
  const args = buildDiemBasicReelArgs({
    cardPaths: ['/tmp/01.png', '/tmp/02.png', '/tmp/03.png', '/tmp/04.png', '/tmp/05.png'],
    audioPath: '/tmp/music.wav',
    outputPath: '/tmp/basic.mp4',
  });
  const filter = args[args.indexOf('-filter_complex') + 1];
  assert.equal(args.filter(value => value === '-i').length, 6);
  assert.equal(DIEM_BASIC_REEL.durationSeconds, 19);
  assert.deepEqual(DIEM_BASIC_REEL.sceneDurations, [3, 4, 5, 4, 3]);
  assert.equal((filter.match(/xfade=transition=fade/g) || []).length, 4);
  assert.match(filter, /offset=3(?:\.0+)?/u);
  assert.match(filter, /offset=7(?:\.0+)?/u);
  assert.match(filter, /offset=12(?:\.0+)?/u);
  assert.match(filter, /offset=16(?:\.0+)?/u);
  assert.doesNotMatch(filter, /zoompan|rotate|crop=.*sin/u);
  assert.ok(args.includes('570'));
  assert.ok(args.includes('aac'));
  assert.ok(args.includes('48000'));
  assert.equal(args.at(-1), '/tmp/basic.mp4');
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
  const followCtaImagePath = path.join(directory, 'follow-cta.ppm');
  const outputPath = path.join(directory, 'reel.mp4');
  fs.writeFileSync(imagePath, Buffer.from('P6\n1 1\n255\n\x08\x0c\x16', 'binary'));
  fs.writeFileSync(followCtaImagePath, Buffer.from('P6\n1 1\n255\n\x08\x0c\x16', 'binary'));
  const music = selectMusic({
    category: 'economy',
    mood: 'steady',
    publicationKey: 'diem:2026-07-25:economy',
  });

  await createDiemReelVideo({
    imagePath,
    followCtaImagePath,
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
