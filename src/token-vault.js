const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');

function decodeKey(encodedKey = config.instagramTokenEncryptionKey) {
  if (!encodedKey) throw new Error('[Token Vault] Missing INSTAGRAM_TOKEN_ENCRYPTION_KEY.');
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32) throw new Error('[Token Vault] Encryption key must decode to exactly 32 bytes.');
  return key;
}

function encryptToken(token, encodedKey = config.instagramTokenEncryptionKey) {
  if (!token) throw new Error('[Token Vault] Cannot encrypt an empty token.');
  const key = decodeKey(encodedKey);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    updatedAt: new Date().toISOString(),
  };
}

function decryptToken(payload, encodedKey = config.instagramTokenEncryptionKey) {
  if (!payload || payload.version !== 1 || payload.algorithm !== 'aes-256-gcm') {
    throw new Error('[Token Vault] Unsupported encrypted token payload.');
  }
  const key = decodeKey(encodedKey);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function readEncryptedToken(filePath = config.instagramTokenFile, encodedKey = config.instagramTokenEncryptionKey) {
  if (!fs.existsSync(filePath)) return null;
  return decryptToken(JSON.parse(fs.readFileSync(filePath, 'utf8')), encodedKey);
}

function writeEncryptedToken(token, filePath = config.instagramTokenFile, encodedKey = config.instagramTokenEncryptionKey) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(encryptToken(token, encodedKey), null, 2)}\n`, { mode: 0o600 });
}

function resolveInstagramToken() {
  const source = config.instagramTokenSource || 'encrypted_vault';
  if (!['repository_secret', 'encrypted_vault'].includes(source)) {
    throw new Error('[Token Vault] Unsupported credential source.');
  }
  if (source === 'repository_secret') {
    if (!config.instagramAccessToken) throw new Error('[Token Vault] No Instagram access token is available.');
    return config.instagramAccessToken;
  }
  const encrypted = config.instagramTokenEncryptionKey
    ? readEncryptedToken(config.instagramTokenFile, config.instagramTokenEncryptionKey)
    : null;
  const token = encrypted || config.instagramAccessToken;
  if (!token) throw new Error('[Token Vault] No Instagram access token is available.');
  return token;
}

module.exports = {
  decodeKey,
  decryptToken,
  encryptToken,
  readEncryptedToken,
  resolveInstagramToken,
  writeEncryptedToken,
};
