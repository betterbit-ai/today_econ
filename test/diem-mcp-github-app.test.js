const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const { GitHubAppClient, createAppJwt } = require('../services/diem-mcp/src/github-app');

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('creates a signed GitHub App JWT without exposing the private key', () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const token = createAppJwt({ appId: '123', privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }), now: () => new Date('2026-09-16T00:00:00.000Z') });
  const [header, payload, signature] = token.split('.');
  assert.equal(JSON.parse(Buffer.from(header, 'base64url').toString('utf8')).alg, 'RS256');
  assert.equal(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).iss, '123');
  assert.ok(signature.length > 20);
});

test('commits allowlisted package files on a dedicated branch and opens a PR', async () => {
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const target = new URL(url);
    calls.push({ path: target.pathname, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (target.pathname.endsWith('/access_tokens')) return jsonResponse({ token: 'installation-token', expires_at: '2026-09-16T01:00:00.000Z' }, 201);
    if (target.pathname.endsWith('/git/ref/heads/main')) return jsonResponse({ object: { sha: 'base-commit' } });
    if (target.pathname.endsWith('/git/commits/base-commit')) return jsonResponse({ tree: { sha: 'base-tree' } });
    if (target.pathname.endsWith('/git/ref/heads/diem/editorial/run/economy') && (options.method || 'GET') === 'GET') {
      return jsonResponse({ message: 'Not Found' }, 404);
    }
    if (target.pathname.endsWith('/git/refs')) return jsonResponse({ ref: 'refs/heads/diem/editorial/run/economy' }, 201);
    if (target.pathname.endsWith('/git/blobs')) return jsonResponse({ sha: `blob-${calls.length}` }, 201);
    if (target.pathname.endsWith('/git/trees')) return jsonResponse({ sha: 'new-tree' }, 201);
    if (target.pathname.endsWith('/git/commits')) return jsonResponse({ sha: 'new-commit' }, 201);
    if (target.pathname.endsWith('/git/refs/heads/diem/editorial/run/economy') && options.method === 'PATCH') {
      return jsonResponse({ object: { sha: 'new-commit' } });
    }
    if (target.pathname.endsWith('/pulls')) return jsonResponse({ number: 17, html_url: 'https://github.example/pull/17' }, 201);
    throw new Error(`Unexpected request: ${target.pathname}`);
  };
  const client = new GitHubAppClient({
    owner: 'betterbit-ai',
    repo: 'today_econ',
    appId: '123',
    installationId: '456',
    privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }),
    fetchImpl,
    now: () => new Date('2026-09-16T00:00:00.000Z'),
  });

  const commit = await client.commitFiles({
    branch: 'diem/editorial/run/economy',
    requestId: 'request-001',
    message: 'Prepare package',
    files: [
      { path: 'content/diem-daily/2026/09/16/run/economy/package.json', content: '{"ok":true}\n' },
      { path: 'content/diem-daily/2026/09/16/run/economy/background.png', content: Buffer.from('png') },
    ],
  });
  const pr = await client.createPullRequest({ branch: 'diem/editorial/run/economy', title: 'DIEM package', body: 'body' });

  assert.equal(commit.commitSha, 'new-commit');
  assert.equal(pr.url, 'https://github.example/pull/17');
  assert.ok(calls.some(call => call.path.endsWith('/git/trees') && call.body.tree.length === 2));
  assert.ok(calls.some(call => call.path.endsWith('/pulls') && call.body.head === 'diem/editorial/run/economy'));
});
