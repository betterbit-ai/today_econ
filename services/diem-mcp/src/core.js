const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { dailyPackageContentHash, validateSubmissionPackage } = require('./package-contract');
const { MCP_INSTRUCTIONS } = require('./instructions');
const { FileRequestStore } = require('./request-store');

const ALLOWED_WRITE_PREFIXES = Object.freeze([
  'content/diem-daily/',
  'data/cloud-editorial/decisions/',
  'data/cloud-editorial/canary/',
]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ASSET_TTL_MS = 2 * 60 * 60 * 1000;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeRequestId(value = '') {
  const requestId = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u.test(requestId)) {
    throw new Error('[DIEM MCP] requestId must contain 3-128 safe characters.');
  }
  return requestId;
}

function safeRepositoryPath(value = '') {
  const normalized = String(value || '').replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('[DIEM MCP] Repository path is invalid.');
  }
  if (!ALLOWED_WRITE_PREFIXES.some(prefix => normalized.startsWith(prefix))) {
    throw new Error('[DIEM MCP] Repository write path is not allowlisted.');
  }
  return normalized;
}

function imageMagicMime(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function assertImageBuffer(buffer, declaredMime = '') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1) throw new Error('[DIEM MCP] Generated image data is empty.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('[DIEM MCP] Generated image exceeds 8MB.');
  const detectedMime = imageMagicMime(buffer);
  if (!detectedMime) throw new Error('[DIEM MCP] Generated image has an unsupported or invalid signature.');
  if (declaredMime && declaredMime !== detectedMime) throw new Error('[DIEM MCP] Generated image MIME does not match its bytes.');
  return detectedMime;
}

function dailyPackagePaths(item) {
  const [year, month, day] = String(item.packageId).split('-');
  if (!year || !month || !day) throw new Error('[DIEM MCP] packageId must begin with YYYY-MM-DD.');
  const base = `content/diem-daily/${year}/${month}/${day}/${item.runId}/${item.category}`;
  return { base, packagePath: `${base}/package.json`, imagePath: `${base}/background.png` };
}

function instructions() {
  return MCP_INSTRUCTIONS;
}

class MockGitHubClient {
  constructor({ files = {} } = {}) {
    this.files = new Map(Object.entries(files));
    this.commits = [];
    this.pullRequests = [];
  }

  async listFiles(prefix = '') {
    return [...this.files.keys()].filter(file => file.startsWith(prefix)).sort();
  }

  async readFile(filePath) {
    if (!this.files.has(filePath)) throw new Error(`[Mock GitHub] file not found: ${filePath}`);
    return this.files.get(filePath);
  }

  async commitFiles({ branch, files, message, requestId }) {
    const commitSha = sha256(JSON.stringify({ branch, files: files.map(file => ({ path: file.path, sha256: sha256(file.content) })), message, requestId, sequence: this.commits.length })).slice(0, 40);
    for (const file of files) this.files.set(file.path, file.content);
    const commit = { commitSha, branch, files: files.map(file => file.path), message, requestId };
    this.commits.push(commit);
    return commit;
  }

  async createPullRequest({ branch, title, body }) {
    const number = this.pullRequests.length + 1;
    const pullRequest = {
      number,
      url: `https://github.example/pull/${number}`,
      branch,
      title,
      body,
    };
    this.pullRequests.push(pullRequest);
    return pullRequest;
  }
}

class DiemMcpCore {
  constructor({
    githubClient,
    assetRoot = path.join(process.cwd(), '.diem-mcp-assets'),
    now = () => new Date(),
    requestStore,
  } = {}) {
    if (!githubClient) throw new Error('[DIEM MCP] githubClient is required.');
    this.githubClient = githubClient;
    this.assetRoot = path.resolve(assetRoot);
    this.now = now;
    this.results = new Map();
    this.requestStore = requestStore || new FileRequestStore(path.join(this.assetRoot, 'request-results.json'));
    this.assets = new Map();
  }

  resultFor(key) {
    return this.results.get(key) || this.requestStore.get(key);
  }

  rememberResult(key, value) {
    this.results.set(key, value);
    this.requestStore.set(key, value);
    return value;
  }

  toolDefinitions() {
    return [
      'get_pending_candidate_pack',
      'get_editorial_context',
      'write_canary_proof',
      'submit_editorial_package',
      'ingest_generated_image',
      'write_image_canary_proof',
      'attach_image_to_package',
      'get_package_status',
    ];
  }

  async call(name, input = {}) {
    if (!this.toolDefinitions().includes(name)) throw new Error(`[DIEM MCP] Unsupported DIEM MCP tool: ${name}`);
    return this[name](input);
  }

  async get_pending_candidate_pack({ category = 'any', now = this.now().toISOString() } = {}) {
    if (!['any', 'economy', 'issue'].includes(category)) throw new Error('[DIEM MCP] category must be any, economy, or issue.');
    const at = new Date(now);
    if (!Number.isFinite(at.getTime())) throw new Error('[DIEM MCP] now must be a valid ISO timestamp.');
    const paths = await this.githubClient.listFiles('data/cloud-editorial/inbox/');
    const candidates = [];
    for (const filePath of paths) {
      try {
        const pack = JSON.parse(await this.githubClient.readFile(filePath));
        const expiry = new Date(pack.expiresAt);
        if (!Number.isFinite(expiry.getTime()) || expiry.getTime() <= at.getTime()) continue;
        candidates.push({ path: filePath, pack, expiry });
      } catch {
        // A malformed inbox file must not stop the next valid package from being found.
      }
    }
    candidates.sort((left, right) => right.expiry.getTime() - left.expiry.getTime() || right.path.localeCompare(left.path));
    const selected = candidates[0];
    if (!selected) return { status: 'no_candidate_pack', candidates: [], path: null };
    return {
      status: 'ready',
      path: selected.path,
      expiresAt: selected.pack.expiresAt,
      contentSha256: selected.pack.integrity?.contentSha256 || null,
      candidates: category === 'any'
        ? selected.pack.candidates
        : (selected.pack.candidates?.[category] || []),
      rejections: category === 'any'
        ? selected.pack.rejections || {}
        : (selected.pack.rejections?.[category] || []),
    };
  }

  async get_editorial_context({ days = 7 } = {}) {
    const safeDays = Number(days);
    if (!Number.isInteger(safeDays) || safeDays < 1 || safeDays > 14) throw new Error('[DIEM MCP] days must be an integer from 1 to 14.');
    const paths = await this.githubClient.listFiles('data/reports/');
    const performancePath = paths.find(file => file.endsWith('diem-performance.json')) || null;
    let performance = null;
    if (performancePath) {
      try { performance = JSON.parse(await this.githubClient.readFile(performancePath)); } catch { performance = null; }
    }
    return { days: safeDays, performance, publicationContext: [] };
  }

  async write_canary_proof({ requestId, note = 'ChatGPT scheduled MCP canary' } = {}) {
    const safeRequest = safeRequestId(requestId);
    const existing = this.resultFor(`canary:${safeRequest}`);
    if (existing) return existing;
    const safeNote = String(note || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
    if (safeNote.length < 1 || safeNote.length > 280) throw new Error('[DIEM MCP] canary note must contain 1-280 characters.');
    const canaryPath = safeRepositoryPath(`data/cloud-editorial/canary/${safeRequest}.json`);
    const branch = `diem/canary/${safeRequest}`;
    const content = {
      schemaVersion: 1,
      kind: 'chatgpt_mcp_canary',
      requestId: safeRequest,
      createdAt: this.now().toISOString(),
      note: safeNote,
      writeScope: 'data/cloud-editorial/canary only',
    };
    const commit = await this.githubClient.commitFiles({
      branch,
      files: [{ path: canaryPath, content: `${JSON.stringify(content, null, 2)}\n` }],
      message: `DIEM MCP canary ${safeRequest}`,
      requestId: safeRequest,
    });
    const pr = await this.githubClient.createPullRequest({
      branch,
      title: `DIEM canary: ${safeRequest}`,
      body: `Restricted ChatGPT MCP canary. Allowed file: \`${canaryPath}\`.\n\nRequest ID: ${safeRequest}`,
    });
    return this.rememberResult(`canary:${safeRequest}`, {
      status: 'submitted',
      requestId: safeRequest,
      branch,
      commitSha: commit.commitSha,
      pullRequestUrl: pr.url,
      paths: [canaryPath],
    });
  }

  async ingest_generated_image({ requestId, mimeType, dataBase64 } = {}) {
    const safeRequest = safeRequestId(requestId);
    const existing = this.resultFor(`image:${safeRequest}`);
    if (existing) return existing;
    let buffer;
    if (!dataBase64) throw new Error('[DIEM MCP] Generated image requires inline dataBase64.');
    buffer = Buffer.from(String(dataBase64), 'base64');
    const detectedMime = assertImageBuffer(buffer, mimeType);
    const extension = detectedMime === 'image/png' ? 'png' : detectedMime === 'image/jpeg' ? 'jpg' : 'webp';
    const assetId = `asset-${sha256(`${safeRequest}:${sha256(buffer)}`).slice(0, 24)}`;
    const target = path.join(this.assetRoot, `${assetId}.${extension}`);
    fs.mkdirSync(this.assetRoot, { recursive: true });
    fs.writeFileSync(target, buffer, { mode: 0o600 });
    const result = {
      assetId,
      sha256: sha256(buffer),
      mimeType: detectedMime,
      bytes: buffer.length,
      path: target,
      expiresAt: new Date(this.now().getTime() + ASSET_TTL_MS).toISOString(),
    };
    this.assets.set(assetId, { ...result, requestId: safeRequest });
    this.rememberResult(`asset:${assetId}`, { ...result, requestId: safeRequest });
    return this.rememberResult(`image:${safeRequest}`, result);
  }

  assetFor(assetId) {
    const safeAssetId = String(assetId || '').trim();
    const inMemory = this.assets.get(safeAssetId);
    const persisted = inMemory || this.requestStore.get(`asset:${safeAssetId}`);
    if (!persisted || persisted.assetId !== safeAssetId) throw new Error('[DIEM MCP] Generated image asset was not found.');
    if (new Date(persisted.expiresAt).getTime() <= this.now().getTime()) throw new Error('[DIEM MCP] Generated image asset expired.');
    const assetPath = path.resolve(String(persisted.path || ''));
    const rootPrefix = `${this.assetRoot}${path.sep}`;
    if (!assetPath.startsWith(rootPrefix) || !fs.existsSync(assetPath)) throw new Error('[DIEM MCP] Generated image asset was not found.');
    const buffer = fs.readFileSync(assetPath);
    const mimeType = assertImageBuffer(buffer, persisted.mimeType);
    if (sha256(buffer) !== persisted.sha256) throw new Error('[DIEM MCP] Generated image asset integrity check failed.');
    const asset = { ...persisted, path: assetPath, mimeType };
    this.assets.set(safeAssetId, asset);
    return asset;
  }

  async write_image_canary_proof({ requestId, assetId } = {}) {
    const safeRequest = safeRequestId(requestId);
    const existing = this.resultFor(`image-canary:${safeRequest}`);
    if (existing) return existing;
    const asset = this.assetFor(assetId);
    const extension = asset.mimeType === 'image/png' ? 'png' : asset.mimeType === 'image/jpeg' ? 'jpg' : 'webp';
    const imagePath = safeRepositoryPath(`data/cloud-editorial/canary/${safeRequest}.${extension}`);
    const manifestPath = safeRepositoryPath(`data/cloud-editorial/canary/${safeRequest}.json`);
    const branch = `diem/canary/${safeRequest}`;
    const manifest = {
      schemaVersion: 1,
      kind: 'chatgpt_image_handoff_canary',
      requestId: safeRequest,
      createdAt: this.now().toISOString(),
      asset: {
        assetId: asset.assetId,
        mimeType: asset.mimeType,
        bytes: asset.bytes,
        sha256: asset.sha256,
        path: imagePath,
      },
      writeScope: 'data/cloud-editorial/canary only',
    };
    const commit = await this.githubClient.commitFiles({
      branch,
      files: [
        { path: imagePath, content: fs.readFileSync(asset.path) },
        { path: manifestPath, content: `${JSON.stringify(manifest, null, 2)}\n` },
      ],
      message: `DIEM MCP image canary ${safeRequest}`,
      requestId: safeRequest,
    });
    const pr = await this.githubClient.createPullRequest({
      branch,
      title: `DIEM image canary: ${safeRequest}`,
      body: `Restricted ImageGen handoff canary. Allowed files: \`${imagePath}\` and \`${manifestPath}\`.\n\nRequest ID: ${safeRequest}`,
    });
    return this.rememberResult(`image-canary:${safeRequest}`, {
      status: 'submitted',
      requestId: safeRequest,
      branch,
      commitSha: commit.commitSha,
      pullRequestUrl: pr.url,
      paths: [imagePath, manifestPath],
      sha256: asset.sha256,
    });
  }

  async submit_editorial_package({ requestId, candidatePackSha256, package: item, assetId } = {}) {
    const safeRequest = safeRequestId(requestId);
    const existing = this.resultFor(`package:${safeRequest}`);
    if (existing) return existing;
    if (!/^[a-f0-9]{64}$/u.test(String(candidatePackSha256 || ''))) {
      throw new Error('[DIEM MCP] candidatePackSha256 must be a SHA-256 value.');
    }
    const packageCopy = structuredClone(item || {});
    if (assetId) {
      const asset = this.assetFor(assetId);
      packageCopy.visual ||= {};
      packageCopy.visual.kind = 'chatgpt-generated-editorial';
      packageCopy.visual.assetPath = 'background.png';
      packageCopy.visual.sha256 = asset.sha256;
      packageCopy.integrity ||= {};
      packageCopy.integrity.contentSha256 = dailyPackageContentHash(packageCopy);
    }
    const validation = validateSubmissionPackage(packageCopy, { now: this.now() });
    if (!validation.ok) throw new Error(`[DIEM MCP] Package validation failed: ${validation.errors.join('; ')}`);
    const paths = dailyPackagePaths(packageCopy);
    const files = [{ path: safeRepositoryPath(paths.packagePath), content: `${JSON.stringify(packageCopy, null, 2).normalize('NFC')}\n` }];
    if (assetId) {
      const asset = this.assetFor(assetId);
      files.push({ path: safeRepositoryPath(paths.imagePath), content: fs.readFileSync(asset.path) });
    }
    const branch = `diem/editorial/${packageCopy.runId}/${packageCopy.category}`;
    const commit = await this.githubClient.commitFiles({
      branch,
      files,
      message: `Prepare DIEM cloud editorial package ${packageCopy.packageId}`,
      requestId: safeRequest,
    });
    const pr = await this.githubClient.createPullRequest({
      branch,
      title: `DIEM editorial: ${packageCopy.packageId}`,
      body: `Candidate pack SHA-256: ${candidatePackSha256}\n\nRequest ID: ${safeRequest}`,
    });
    const result = {
      status: 'submitted',
      packageId: packageCopy.packageId,
      branch,
      commitSha: commit.commitSha,
      pullRequestUrl: pr.url,
      paths: files.map(file => file.path),
    };
    return this.rememberResult(`package:${safeRequest}`, result);
  }

  async attach_image_to_package(input = {}) {
    return this.submit_editorial_package(input);
  }

  async get_package_status({ packageId } = {}) {
    const safePackage = safeRequestId(packageId);
    const paths = await this.githubClient.listFiles('content/diem-daily/');
    const packagePath = paths.find(file => file.endsWith('/package.json') && file.includes(safePackage));
    return packagePath ? { status: 'ready', packageId: safePackage, path: packagePath } : { status: 'not_found', packageId: safePackage };
  }
}

module.exports = {
  ALLOWED_WRITE_PREFIXES,
  ASSET_TTL_MS,
  DiemMcpCore,
  MAX_IMAGE_BYTES,
  MockGitHubClient,
  assertImageBuffer,
  imageMagicMime,
  instructions,
  safeRepositoryPath,
};
