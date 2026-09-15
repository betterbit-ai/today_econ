const crypto = require('crypto');

const GITHUB_API = 'https://api.github.com';

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function createAppJwt({ appId, privateKey, now = () => new Date() } = {}) {
  if (!appId || !privateKey) throw new Error('[DIEM MCP GitHub] appId and privateKey are required.');
  const issuedAt = Math.floor(now().getTime() / 1000) - 30;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 9 * 60, iss: String(appId) }));
  const signingInput = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

function responseError(response, payload) {
  const error = new Error(`[DIEM MCP GitHub] ${response.status}: ${payload?.message || response.statusText}`);
  error.status = response.status;
  error.payload = payload;
  return error;
}

class GitHubAppClient {
  constructor({
    owner,
    repo,
    appId,
    installationId,
    privateKey,
    fetchImpl = fetch,
    now = () => new Date(),
    apiBaseUrl = GITHUB_API,
    defaultBranch = 'main',
  } = {}) {
    if (!owner || !repo || !appId || !installationId || !privateKey) {
      throw new Error('[DIEM MCP GitHub] owner, repo, appId, installationId, and privateKey are required.');
    }
    this.owner = owner;
    this.repo = repo;
    this.appId = appId;
    this.installationId = installationId;
    this.privateKey = privateKey;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.apiBaseUrl = apiBaseUrl.replace(/\/$/u, '');
    this.defaultBranch = defaultBranch;
    this.installationCredential = null;
  }

  async request(path, { method = 'GET', body, token } = {}) {
    const accessToken = token || await this.installationToken();
    const response = await this.fetchImpl(`${this.apiBaseUrl}/repos/${this.owner}/${this.repo}/${path.replace(/^\//u, '')}`, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'diem-mcp',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
    if (!response.ok) throw responseError(response, payload);
    return payload;
  }

  async installationToken() {
    const cached = this.installationCredential;
    if (cached && cached.expiresAt.getTime() - this.now().getTime() > 60_000) return cached.token;
    const jwt = createAppJwt({ appId: this.appId, privateKey: this.privateKey, now: this.now });
    const response = await this.fetchImpl(`${this.apiBaseUrl}/app/installations/${this.installationId}/access_tokens`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
        'User-Agent': 'diem-mcp',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: '{}',
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = { raw: text }; }
    if (!response.ok) throw responseError(response, payload);
    if (!payload?.token || !payload?.expires_at) throw new Error('[DIEM MCP GitHub] Installation token response is invalid.');
    this.installationCredential = { token: payload.token, expiresAt: new Date(payload.expires_at) };
    return payload.token;
  }

  async listFiles(prefix = '') {
    const tree = await this.request(`git/trees/${this.defaultBranch}?recursive=1`);
    return (tree.tree || [])
      .filter(item => item.type === 'blob' && item.path?.startsWith(prefix))
      .map(item => item.path)
      .sort();
  }

  async readFile(filePath) {
    const payload = await this.request(`contents/${filePath}`);
    if (!payload?.content || payload.encoding !== 'base64') throw new Error(`[DIEM MCP GitHub] File response is invalid: ${filePath}`);
    return Buffer.from(payload.content.replace(/\n/gu, ''), 'base64').toString('utf8');
  }

  async refSha(branch) {
    try {
      const payload = await this.request(`git/ref/heads/${branch}`);
      return payload?.object?.sha || null;
    } catch (error) {
      if (error.status === 404) return null;
      throw error;
    }
  }

  async createBlob(content) {
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
    const payload = await this.request('git/blobs', {
      method: 'POST',
      body: { content: buffer.toString('base64'), encoding: 'base64' },
    });
    if (!payload?.sha) throw new Error('[DIEM MCP GitHub] Blob creation response is invalid.');
    return payload.sha;
  }

  async commitFiles({ branch, files = [], message, requestId } = {}) {
    if (!branch || !message || !requestId || files.length < 1) throw new Error('[DIEM MCP GitHub] branch, message, requestId, and files are required.');
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const baseSha = await this.refSha(branch) || await this.refSha(this.defaultBranch);
        if (!baseSha) throw new Error('[DIEM MCP GitHub] Default branch ref is missing.');
        if (!(await this.refSha(branch))) {
          await this.request('git/refs', { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: baseSha } });
        }
        const baseCommit = await this.request(`git/commits/${baseSha}`);
        const tree = [];
        for (const file of files) {
          const blobSha = await this.createBlob(file.content);
          tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blobSha });
        }
        const createdTree = await this.request('git/trees', { method: 'POST', body: { base_tree: baseCommit.tree.sha, tree } });
        const commit = await this.request('git/commits', {
          method: 'POST',
          body: { message, tree: createdTree.sha, parents: [baseSha] },
        });
        await this.request(`git/refs/heads/${branch}`, {
          method: 'PATCH',
          body: { sha: commit.sha, force: false },
        });
        return { commitSha: commit.sha, branch, files: files.map(file => file.path), requestId };
      } catch (error) {
        lastError = error;
        if (error.status !== 409 || attempt === 1) throw error;
      }
    }
    throw lastError;
  }

  async createPullRequest({ branch, title, body }) {
    const payload = await this.request('pulls', {
      method: 'POST',
      body: { title, body, head: branch, base: this.defaultBranch },
    });
    if (!payload?.html_url) throw new Error('[DIEM MCP GitHub] Pull request response is invalid.');
    return { number: payload.number, url: payload.html_url, branch, title, body };
  }
}

module.exports = {
  GITHUB_API,
  GitHubAppClient,
  createAppJwt,
};
