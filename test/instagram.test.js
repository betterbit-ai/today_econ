const test = require('node:test');
const assert = require('node:assert/strict');
const { getAccountInsights, publishCarousel, publishReel, publishStory, getMediaInsights } = require('../src/instagram');

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

test('publishes a carousel in the required container order', async () => {
  const calls = [];
  let mediaCreateCount = 0;
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body?.toString() || '' });
    if (String(url).endsWith('/1784/media') && options.method === 'POST') {
      mediaCreateCount += 1;
      return jsonResponse({ id: mediaCreateCount <= 2 ? `child-${mediaCreateCount}` : 'carousel-1' });
    }
    if (/child-|carousel-1/.test(String(url)) && (options.method || 'GET') === 'GET') {
      return jsonResponse({ status_code: 'FINISHED' });
    }
    if (String(url).endsWith('/1784/media_publish')) return jsonResponse({ id: 'post-1' });
    if (String(url).includes('/post-1?')) {
      return jsonResponse({ id: 'post-1', permalink: 'https://instagram.com/p/abc', timestamp: '2026-07-15T00:00:00Z' });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await publishCarousel({
    imageUrls: ['https://example.com/1.png', 'https://example.com/2.png'],
    caption: '테스트 캡션',
    userId: '1784',
    token: 'secret',
    fetchImpl,
  });

  assert.equal(result.id, 'post-1');
  assert.equal(calls.filter(call => call.method === 'POST').length, 4);
  assert.match(calls[4].body, /media_type=CAROUSEL/);
  assert.match(calls[4].body, /children=child-1%2Cchild-2/);
  assert.ok(calls.every(call => !call.url.includes('secret')));
});

test('collects supported metrics individually if the bulk request fails', async () => {
  const fetchImpl = async url => {
    const parsed = new URL(url);
    const metric = parsed.searchParams.get('metric');
    if (metric.includes(',')) return jsonResponse({ error: { message: 'unsupported metric combination' } }, 400);
    if (metric === 'reach') return jsonResponse({ data: [{ name: 'reach', values: [{ value: 120 }] }] });
    return jsonResponse({ error: { message: 'unsupported' } }, 400);
  };
  const metrics = await getMediaInsights({ mediaId: 'post-1', token: 'secret', metrics: ['reach', 'views'], fetchImpl });
  assert.equal(metrics.reach.value, 120);
  assert.equal(metrics.reach.status, 'ok');
  assert.equal(metrics.views.status, 'unavailable');
});

test('publishes a Reel through a video container before media_publish', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body?.toString() || '' });
    if (String(url).endsWith('/1784/media') && options.method === 'POST') return jsonResponse({ id: 'reel-container' });
    if (String(url).includes('/reel-container?') && (options.method || 'GET') === 'GET') return jsonResponse({ status_code: 'FINISHED' });
    if (String(url).endsWith('/1784/media_publish')) return jsonResponse({ id: 'reel-post' });
    if (String(url).includes('/reel-post?')) return jsonResponse({ id: 'reel-post', permalink: 'https://instagram.com/reel/abc', media_type: 'REELS' });
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await publishReel({
    videoUrl: 'https://github.com/example/reel.mp4',
    caption: '릴스 테스트 캡션',
    userId: '1784',
    token: 'secret',
    fetchImpl,
  });

  assert.equal(result.id, 'reel-post');
  assert.match(calls[0].body, /media_type=REELS/);
  assert.match(calls[0].body, /video_url=https%3A%2F%2Fgithub.com%2Fexample%2Freel.mp4/);
  assert.match(calls[0].body, /share_to_feed=true/);
  assert.ok(calls.every(call => !call.url.includes('secret')));
});

test('publishes a video Story through its own container after the Reel', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || 'GET', body: options.body?.toString() || '' });
    if (String(url).endsWith('/1784/media') && options.method === 'POST') return jsonResponse({ id: 'story-container' });
    if (String(url).includes('/story-container?') && (options.method || 'GET') === 'GET') return jsonResponse({ status_code: 'FINISHED' });
    if (String(url).endsWith('/1784/media_publish')) return jsonResponse({ id: 'story-post' });
    if (String(url).includes('/story-post?')) return jsonResponse({ id: 'story-post', media_type: 'STORIES', timestamp: '2026-07-17T00:00:00Z' });
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await publishStory({
    videoUrl: 'https://github.com/example/today-econ-reel.mp4',
    userId: '1784',
    token: 'secret',
    fetchImpl,
  });

  assert.equal(result.id, 'story-post');
  assert.equal(result.format, 'story');
  assert.match(calls[0].body, /media_type=STORIES/);
  assert.match(calls[0].body, /video_url=https%3A%2F%2Fgithub.com%2Fexample%2Ftoday-econ-reel.mp4/);
  assert.ok(calls.every(call => !call.url.includes('secret')));
});

test('treats media_publish success as Story success even when optional metadata lookup fails', async () => {
  const fetchImpl = async (url, options = {}) => {
    if (String(url).endsWith('/1784/media') && options.method === 'POST') return jsonResponse({ id: 'story-container' });
    if (String(url).includes('/story-container?')) return jsonResponse({ status_code: 'FINISHED' });
    if (String(url).endsWith('/1784/media_publish')) return jsonResponse({ id: 'story-post' });
    if (String(url).includes('/story-post?')) return jsonResponse({ error: { message: 'metadata temporarily unavailable' } }, 503);
    throw new Error(`Unexpected request: ${url}`);
  };

  const result = await publishStory({
    videoUrl: 'https://github.com/example/diem-story.mp4',
    userId: '1784',
    token: 'secret',
    fetchImpl,
  });

  assert.equal(result.id, 'story-post');
  assert.equal(result.containerId, 'story-container');
  assert.equal(result.format, 'story');
  assert.match(result.metadataWarning, /metadata temporarily unavailable/u);
});

test('keeps account-level metrics explicit when Instagram does not return them', async () => {
  const metrics = await getAccountInsights({
    userId: '1784',
    token: 'secret',
    metrics: ['reach', 'profile_views'],
    fetchImpl: async () => jsonResponse({ error: { message: 'permission denied' } }, 403),
  });
  assert.equal(metrics.reach.status, 'unavailable');
  assert.equal(metrics.profile_views.status, 'unavailable');
  assert.match(metrics.reach.reason, /permission denied/);
});

test('reads follower_count from the profile while collecting the remaining account insight metrics', async () => {
  const calls = [];
  const metrics = await getAccountInsights({
    userId: '1784',
    token: 'secret',
    metrics: ['follower_count', 'profile_views'],
    fetchImpl: async url => {
      const parsed = new URL(url);
      calls.push(parsed);
      if (parsed.searchParams.get('fields') === 'follower_count') return jsonResponse({ follower_count: 321 });
      return jsonResponse({ data: [{ name: 'profile_views', total_value: { value: 17 } }] });
    },
  });
  assert.equal(metrics.follower_count.value, 321);
  assert.equal(metrics.profile_views.value, 17);
  assert.equal(calls.length, 2);
});

test('falls back to followers_count when the Instagram profile rejects follower_count', async () => {
  const fields = [];
  const metrics = await getAccountInsights({
    userId: '1784',
    token: 'secret',
    metrics: ['follower_count', 'profile_views'],
    fetchImpl: async url => {
      const parsed = new URL(url);
      const field = parsed.searchParams.get('fields');
      if (field) fields.push(field);
      if (field === 'follower_count') {
        return jsonResponse({ error: { message: 'nonexisting field follower_count' } }, 400);
      }
      if (field === 'followers_count') return jsonResponse({ followers_count: 321 });
      return jsonResponse({ data: [{ name: 'profile_views', total_value: { value: 17 } }] });
    },
  });

  assert.deepEqual(fields, ['follower_count', 'followers_count']);
  assert.equal(metrics.follower_count.value, 321);
  assert.equal(metrics.profile_views.value, 17);
});
