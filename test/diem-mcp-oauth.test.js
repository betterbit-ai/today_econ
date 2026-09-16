const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { OAuthStore, isChatgptClientId, isChatgptRedirectUri, pkceS256 } = require('../services/diem-mcp/src/oauth');

test('exchanges one PKCE authorization code and rotates refresh tokens', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-oauth-'));
  let now = new Date('2026-09-16T00:00:00.000Z');
  const store = new OAuthStore(path.join(root, 'state.json'), { now: () => now });
  const verifier = 'safe-pkce-verifier-value-for-diem-0123456789';
  const clientId = 'https://chatgpt.com/oauth/client.json';
  const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
  const resource = 'https://mcp.example.com/mcp';
  try {
    const code = store.createCode({ clientId, redirectUri, codeChallenge: pkceS256(verifier), resource, scope: 'diem:read diem:write' });
    const tokens = store.exchangeCode({ code, clientId, redirectUri, codeVerifier: verifier, resource });
    assert.match(tokens.access_token, /^at_/u);
    assert.equal(store.access(tokens.access_token, { resource, requiredScope: 'diem:write' }).scope, 'diem:read diem:write');
    assert.throws(() => store.exchangeCode({ code, clientId, redirectUri, codeVerifier: verifier, resource }), /invalid_grant/u);
    const refreshed = store.refresh({ refreshToken: tokens.refresh_token, clientId, resource });
    assert.match(refreshed.access_token, /^at_/u);
    assert.throws(() => store.refresh({ refreshToken: tokens.refresh_token, clientId, resource }), /invalid_grant/u);
    now = new Date('2026-09-17T00:00:00.000Z');
    assert.equal(store.access(tokens.access_token, { resource }), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('accepts only ChatGPT OAuth client metadata and callback URLs', () => {
  assert.equal(isChatgptClientId('https://chatgpt.com/oauth/client.json'), true);
  assert.equal(isChatgptClientId('https://example.com/oauth/client.json'), false);
  assert.equal(isChatgptRedirectUri('https://chatgpt.com/connector_platform_oauth_redirect'), true);
  assert.equal(isChatgptRedirectUri('https://chatgpt.com/connector/oauth/example'), true);
  assert.equal(isChatgptRedirectUri('https://chatgpt.com/other'), false);
});
