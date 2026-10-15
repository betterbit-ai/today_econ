const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config');
const { decryptToken, encryptToken, readEncryptedToken, writeEncryptedToken, resolveInstagramToken } = require('../src/token-vault');
const { refreshInstagramToken } = require('../src/refresh-instagram-token');

test('encrypts and decrypts a token with authenticated encryption', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const payload = encryptToken('IG-secret-token', key);
  assert.notEqual(payload.ciphertext, 'IG-secret-token');
  assert.equal(decryptToken(payload, key), 'IG-secret-token');
  assert.throws(() => decryptToken(payload, Buffer.alloc(32, 8).toString('base64')));
});

test('writes only ciphertext and reads the original token', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'today-econ-vault-'));
  const filePath = path.join(directory, 'token.enc');
  const key = Buffer.alloc(32, 9).toString('base64');
  writeEncryptedToken('plain-token', filePath, key);
  assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /plain-token/);
  assert.equal(readEncryptedToken(filePath, key), 'plain-token');
});

test('refreshes a token and persists the rotated value encrypted', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'today-econ-refresh-'));
  const original = {
    source: config.instagramTokenSource,
    accessToken: config.instagramAccessToken,
    key: config.instagramTokenEncryptionKey,
    file: config.instagramTokenFile,
  };
  config.instagramAccessToken = 'old-token';
  config.instagramTokenSource = 'encrypted_vault';
  config.instagramTokenEncryptionKey = Buffer.alloc(32, 3).toString('base64');
  config.instagramTokenFile = path.join(directory, 'token.enc');
  try {
    const result = await refreshInstagramToken({
      fetchImpl: async url => {
        assert.equal(new URL(url).searchParams.get('access_token'), 'old-token');
        return new Response(JSON.stringify({ access_token: 'new-token', expires_in: 5184000 }), { status: 200 });
      },
    });
    assert.equal(result.rotated, true);
    assert.equal(readEncryptedToken(config.instagramTokenFile, config.instagramTokenEncryptionKey), 'new-token');
  } finally {
    config.instagramTokenSource = original.source;
    config.instagramAccessToken = original.accessToken;
    config.instagramTokenEncryptionKey = original.key;
    config.instagramTokenFile = original.file;
  }
});

test('repository Secret mode ignores even an unreadable old vault and never falls back to it', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-stale-vault-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const original = { mode: config.instagramTokenSource, token: config.instagramAccessToken, key: config.instagramTokenEncryptionKey, file: config.instagramTokenFile };
  t.after(() => Object.assign(config, { instagramTokenSource: original.mode, instagramAccessToken: original.token, instagramTokenEncryptionKey: original.key, instagramTokenFile: original.file }));
  config.instagramTokenSource = 'repository_secret';
  config.instagramAccessToken = 'verified-new-secret';
  config.instagramTokenEncryptionKey = 'invalid-old-key';
  config.instagramTokenFile = path.join(directory, 'token.enc');
  fs.writeFileSync(config.instagramTokenFile, 'corrupt old vault');
  assert.equal(resolveInstagramToken(), 'verified-new-secret');
  config.instagramAccessToken = '';
  assert.throws(resolveInstagramToken, /No Instagram access token/);
  config.instagramTokenSource = 'unsupported';
  assert.throws(resolveInstagramToken, /Unsupported credential source/);
});

test('repository Secret mode cannot refresh into a public encrypted file', async t => {
  const previous = config.instagramTokenSource;
  t.after(() => { config.instagramTokenSource = previous; });
  config.instagramTokenSource = 'repository_secret';
  const result = await refreshInstagramToken({ fetchImpl: async () => assert.fail('no token refresh request in Secret-only mode') });
  assert.equal(result.skipped, true);
});
