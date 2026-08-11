const fs = require('fs');
const path = require('path');

const RELEASE_TAG_PREFIX = 'instagram-assets-';
const BASIC_RELEASE_TAG_PREFIX = 'diem-basic-draft-';

function parseRepository(repository) {
  const [owner, repo] = String(repository || '').split('/');
  if (!owner || !repo) throw new Error('[GitHub Assets] GITHUB_REPOSITORY must be owner/repo.');
  return { owner, repo };
}

async function githubRequest(url, options = {}, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'today-econ-github-actions',
      ...(options.headers || {}),
    },
  });
  if (response.status === 204) return null;
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`[GitHub Assets] ${response.status}: ${payload?.message || text}`);
  }
  return payload;
}

async function createTemporaryRelease({
  imagePaths,
  assetPaths,
  token,
  repository,
  runId = Date.now().toString(),
  targetCommitish,
  tagPrefix = RELEASE_TAG_PREFIX,
  releaseName,
  releaseBody,
  fetchImpl = fetch,
}) {
  if (!token) throw new Error('[GitHub Assets] Missing GITHUB_TOKEN.');
  const assetsToUpload = Array.isArray(assetPaths)
    ? assetPaths.map(asset => typeof asset === 'string' ? { path: asset } : asset)
    : (Array.isArray(imagePaths) ? imagePaths.map((filePath, index) => ({ path: filePath, filename: `slide_${index + 1}.png`, contentType: 'image/png' })) : []);
  if (assetsToUpload.length < 1) throw new Error('[GitHub Assets] At least one public asset is required.');
  const { owner, repo } = parseRepository(repository);
  const tag = `${tagPrefix}${runId}-${Date.now()}`;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  const release = await githubRequest(`${apiBase}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: targetCommitish || undefined,
      name: releaseName || `Temporary Instagram assets ${runId}`,
      body: releaseBody || 'Temporary public image assets for Instagram ingestion. Automatically deleted after 72 hours.',
      draft: false,
      prerelease: true,
    }),
  }, token, fetchImpl);

  const uploadBase = release.upload_url.replace(/\{.*$/, '');
  const assets = [];
  try {
    for (let index = 0; index < assetsToUpload.length; index += 1) {
      const asset = assetsToUpload[index];
      const imagePath = asset.path;
      if (!fs.existsSync(imagePath)) throw new Error(`Image not found: ${imagePath}`);
      const filename = asset.filename || path.basename(imagePath);
      const contentType = asset.contentType || (path.extname(filename).toLowerCase() === '.mp4' ? 'video/mp4' : 'application/octet-stream');
      const uploaded = await githubRequest(`${uploadBase}?name=${encodeURIComponent(filename)}`, {
        method: 'POST',
        headers: { 'Content-Type': contentType },
        body: fs.readFileSync(imagePath),
      }, token, fetchImpl);
      assets.push({ name: filename, url: uploaded.browser_download_url, id: uploaded.id });
    }
  } catch (error) {
    await deleteTemporaryRelease({ releaseId: release.id, tag, token, repository, fetchImpl }).catch(() => {});
    throw error;
  }

  return {
    releaseId: release.id,
    tag,
    htmlUrl: release.html_url,
    createdAt: release.created_at,
    assets,
    imageUrls: assets.filter(asset => /\.png$/i.test(asset.name)).map(asset => asset.url),
    videoUrl: assets.find(asset => /\.mp4$/i.test(asset.name))?.url || null,
  };
}

async function deleteTemporaryRelease({ releaseId, tag, token, repository, fetchImpl = fetch }) {
  const { owner, repo } = parseRepository(repository);
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;
  if (releaseId) {
    await githubRequest(`${apiBase}/releases/${releaseId}`, { method: 'DELETE' }, token, fetchImpl);
  }
  if (tag) {
    try {
      await githubRequest(`${apiBase}/git/refs/tags/${encodeURIComponent(tag)}`, { method: 'DELETE' }, token, fetchImpl);
    } catch (error) {
      if (!/404/.test(error.message)) throw error;
    }
  }
}

async function cleanupExpiredReleases({ token, repository, maxAgeHours = 72, now = new Date(), fetchImpl = fetch }) {
  if (!token || !repository) return [];
  const { owner, repo } = parseRepository(repository);
  const releases = await githubRequest(
    `https://api.github.com/repos/${owner}/${repo}/releases?per_page=100`,
    {},
    token,
    fetchImpl
  );
  const cutoff = now.getTime() - maxAgeHours * 60 * 60 * 1000;
  const expired = releases.filter(release =>
    release.prerelease &&
    release.tag_name.startsWith(RELEASE_TAG_PREFIX) &&
    new Date(release.created_at).getTime() <= cutoff
  );
  for (const release of expired) {
    await deleteTemporaryRelease({
      releaseId: release.id,
      tag: release.tag_name,
      token,
      repository,
      fetchImpl,
    });
  }
  return expired.map(release => release.tag_name);
}

module.exports = {
  BASIC_RELEASE_TAG_PREFIX,
  RELEASE_TAG_PREFIX,
  cleanupExpiredReleases,
  createTemporaryRelease,
  deleteTemporaryRelease,
  parseRepository,
};
