const DEFAULT_METRICS = [
  'views',
  'reach',
  'likes',
  'comments',
  'saved',
  'shares',
  'total_interactions',
  'ig_reels_avg_watch_time',
  'ig_reels_video_view_total_time',
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function instagramRequest({
  path,
  token,
  version = 'v23.0',
  method = 'GET',
  params = {},
  fetchImpl = fetch,
  retries = 3,
}) {
  const base = String(path).startsWith('ig_audio')
    ? `https://graph.facebook.com/${version}/${String(path).replace(/^\//, '')}`
    : `https://graph.instagram.com/${version}/${String(path).replace(/^\//, '')}`;
  const body = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) body.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  });
  const url = method === 'GET' && body.size ? `${base}?${body}` : base;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const response = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(method === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }),
      },
      ...(method === 'GET' ? {} : { body }),
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    if (response.ok) return payload;

    const message = payload.error?.message || payload.raw || response.statusText;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === retries) {
      const error = new Error(`[Instagram] ${response.status}: ${message}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    await sleep(1000 * 2 ** (attempt - 1));
  }
  throw new Error('[Instagram] request retry loop ended unexpectedly');
}

async function waitForContainer({ id, token, version, fetchImpl = fetch, attempts = 20, delayMs = 3000 }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const status = await instagramRequest({
      path: id,
      token,
      version,
      params: { fields: 'status_code,status' },
      fetchImpl,
    });
    if (!status.status_code || status.status_code === 'FINISHED' || status.status_code === 'PUBLISHED') return status;
    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new Error(`[Instagram] Container ${id} failed: ${status.status || status.status_code}`);
    }
    await sleep(delayMs);
  }
  throw new Error(`[Instagram] Container ${id} was not ready before timeout.`);
}

async function publishCarousel({ imageUrls, caption, userId, token, version = 'v23.0', fetchImpl = fetch }) {
  if (!token || !userId) throw new Error('[Instagram] Missing access token or user ID.');
  if (!Array.isArray(imageUrls) || imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error('[Instagram] A carousel requires 2-10 public image URLs.');
  }
  if (!caption || caption.length > 2200) throw new Error('[Instagram] Caption must be 1-2200 characters.');

  const childIds = [];
  for (const imageUrl of imageUrls) {
    const child = await instagramRequest({
      path: `${userId}/media`,
      token,
      version,
      method: 'POST',
      params: { image_url: imageUrl, is_carousel_item: true },
      fetchImpl,
    });
    await waitForContainer({ id: child.id, token, version, fetchImpl });
    childIds.push(child.id);
  }

  const carousel = await instagramRequest({
    path: `${userId}/media`,
    token,
    version,
    method: 'POST',
    params: {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption,
    },
    fetchImpl,
  });
  await waitForContainer({ id: carousel.id, token, version, fetchImpl });

  const published = await instagramRequest({
    path: `${userId}/media_publish`,
    token,
    version,
    method: 'POST',
    params: { creation_id: carousel.id },
    fetchImpl,
  });
  const media = await instagramRequest({
    path: published.id,
    token,
    version,
    params: { fields: 'id,permalink,timestamp,media_type,media_product_type,username' },
    fetchImpl,
  });
  return { ...media, id: published.id, containerId: carousel.id, childIds };
}

async function publishReel({ videoUrl, caption, userId, token, version = 'v23.0', shareToFeed = true, fetchImpl = fetch }) {
  if (!token || !userId) throw new Error('[Instagram] Missing access token or user ID.');
  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) throw new Error('[Instagram] A Reel requires one public video URL.');
  if (!caption || caption.length > 2200) throw new Error('[Instagram] Caption must be 1-2200 characters.');

  const params = {
    media_type: 'REELS',
    video_url: videoUrl,
    caption,
    share_to_feed: shareToFeed,
  };

  const reel = await instagramRequest({
    path: `${userId}/media`,
    token,
    version,
    method: 'POST',
    params,
    fetchImpl,
  });
  await waitForContainer({ id: reel.id, token, version, fetchImpl, attempts: 30, delayMs: 4000 });

  const published = await instagramRequest({
    path: `${userId}/media_publish`,
    token,
    version,
    method: 'POST',
    params: { creation_id: reel.id },
    fetchImpl,
  });
  const media = await instagramRequest({
    path: published.id,
    token,
    version,
    params: { fields: 'id,permalink,timestamp,media_type,media_product_type,username' },
    fetchImpl,
  });
  return { ...media, id: published.id, containerId: reel.id };
}

async function publishStory({ imageUrl, videoUrl, userId, token, version = 'v23.0', fetchImpl = fetch }) {
  if (!token || !userId) throw new Error('[Instagram] Missing access token or user ID.');
  const hasImage = imageUrl && /^https?:\/\//i.test(imageUrl);
  const hasVideo = videoUrl && /^https?:\/\//i.test(videoUrl);
  if (!hasImage && !hasVideo) throw new Error('[Instagram] A Story requires one public image or video URL.');

  const story = await instagramRequest({
    path: `${userId}/media`,
    token,
    version,
    method: 'POST',
    params: {
      media_type: 'STORIES',
      ...(hasVideo ? { video_url: videoUrl } : { image_url: imageUrl }),
    },
    fetchImpl,
  });
  await waitForContainer({ id: story.id, token, version, fetchImpl, attempts: hasVideo ? 30 : 20, delayMs: hasVideo ? 4000 : 3000 });

  let published;
  try {
    published = await instagramRequest({
      path: `${userId}/media_publish`,
      token,
      version,
      method: 'POST',
      params: { creation_id: story.id },
      fetchImpl,
    });
  } catch (error) {
    if (!error.status || Number(error.status) >= 500) error.ambiguousExternalState = true;
    throw error;
  }
  let media = {};
  let metadataWarning = null;
  try {
    media = await instagramRequest({
      path: published.id,
      token,
      version,
      params: { fields: 'id,permalink,timestamp,media_type,media_product_type,username' },
      fetchImpl,
    });
  } catch (error) {
    metadataWarning = error.message;
  }
  return { ...media, id: published.id, containerId: story.id, format: 'story', metadataWarning };
}

function insightValue(item) {
  const first = item?.total_value?.value ?? (Array.isArray(item.values) ? item.values[0]?.value : item.value);
  const value = typeof first === 'number' ? first : Number(first);
  return Number.isFinite(value)
    ? { value, status: 'ok' }
    : { value: null, status: 'unavailable', reason: 'metric returned no numeric value' };
}

async function getMediaInsights({ mediaId, token, version = 'v23.0', metrics = DEFAULT_METRICS, fetchImpl = fetch }) {
  const toObject = (data, requested = metrics) => {
    const result = Object.fromEntries(requested.map(metric => [metric, { value: null, status: 'unavailable', reason: 'metric not returned by Instagram' }]));
    for (const item of data || []) result[item.name] = insightValue(item);
    return result;
  };
  try {
    const response = await instagramRequest({
      path: `${mediaId}/insights`,
      token,
      version,
      params: { metric: metrics.join(',') },
      fetchImpl,
    });
    return toObject(response.data);
  } catch (bulkError) {
    const collected = toObject([], metrics);
    for (const metric of metrics) {
      try {
        const response = await instagramRequest({
          path: `${mediaId}/insights`,
          token,
          version,
          params: { metric },
          fetchImpl,
        });
        Object.assign(collected, toObject(response.data, [metric]));
      } catch (error) {
        console.warn(`[Instagram] Insight metric unavailable (${metric}): ${error.message}`);
        collected[metric] = { value: null, status: 'unavailable', reason: error.message };
      }
    }
    return collected;
  }
}

async function getAccountInsights({ userId, token, version = 'v23.0', metrics = [], fetchImpl = fetch }) {
  const unavailable = Object.fromEntries(metrics.map(metric => [metric, {
    value: null,
    status: 'unavailable',
    reason: 'account-level metric requires a separate Instagram permission/endpoint',
  }]));
  if (!userId || metrics.length === 0) return unavailable;
  const toObject = (data, requested = metrics) => Object.assign(
    Object.fromEntries(requested.map(metric => [metric, unavailable[metric]])),
    Object.fromEntries((data || []).map(item => [item.name, insightValue(item)])),
  );
  const collected = { ...unavailable };
  const insightMetrics = metrics.filter(metric => metric !== 'follower_count');
  if (metrics.includes('follower_count')) {
    const followerFields = ['follower_count', 'followers_count'];
    let lastError;
    for (const field of followerFields) {
      try {
        const profile = await instagramRequest({
          path: userId,
          token,
          version,
          params: { fields: field },
          fetchImpl,
        });
        const value = profile[field];
        if (Number.isFinite(Number(value))) {
          collected.follower_count = insightValue({ value: Number(value) });
          lastError = null;
          break;
        }
        lastError = new Error(`${field} returned no numeric value`);
      } catch (error) {
        lastError = error;
      }
    }
    if (lastError) {
      collected.follower_count = { ...unavailable.follower_count, reason: lastError.message };
    }
  }
  if (insightMetrics.length === 0) return collected;
  try {
    const response = await instagramRequest({
      path: `${userId}/insights`,
      token,
      version,
      params: { metric: insightMetrics.join(','), period: 'day', metric_type: 'total_value' },
      fetchImpl,
    });
    return { ...collected, ...toObject(response.data, insightMetrics) };
  } catch (bulkError) {
    for (const metric of insightMetrics) {
      try {
        const response = await instagramRequest({
          path: `${userId}/insights`,
          token,
          version,
          params: { metric, period: 'day', metric_type: 'total_value' },
          fetchImpl,
        });
        Object.assign(collected, toObject(response.data, [metric]));
      } catch (error) {
        collected[metric] = { ...unavailable[metric], reason: error.message };
      }
    }
    return collected;
  }
}

async function searchInstagramAudio({ query, userId, token, version = 'v23.0', fetchImpl = fetch }) {
  if (!token || !userId) throw new Error('[Instagram] Missing access token or user ID for audio search.');
  const response = await instagramRequest({
    path: 'ig_audio',
    token,
    version,
    method: 'GET',
    params: { audio_type: 'music', search_query: query, user_id: userId },
    fetchImpl,
  });
  return response.data || [];
}

module.exports = {
  DEFAULT_METRICS,
  getAccountInsights,
  getMediaInsights,
  instagramRequest,
  publishCarousel,
  publishReel,
  publishStory,
  searchInstagramAudio,
  waitForContainer,
};
