const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const OAUTH_STORE_VERSION = 1;
const ACCESS_TOKEN_TTL_MS = 30 * 60 * 1000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const AUTHORIZATION_CODE_TTL_MS = 10 * 60 * 1000;

function emptyState() {
  return { version: OAUTH_STORE_VERSION, codes: {}, accessTokens: {}, refreshTokens: {} };
}

function randomToken(prefix) {
  return `${prefix}_${crypto.randomBytes(32).toString('base64url')}`;
}

function pkceS256(value = '') {
  return crypto.createHash('sha256').update(String(value)).digest('base64url');
}

function equalValue(left, right) {
  const first = Buffer.from(String(left));
  const second = Buffer.from(String(right));
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}

function cleanExpired(state, now) {
  for (const [code, value] of Object.entries(state.codes)) if (new Date(value.expiresAt).getTime() <= now.getTime()) delete state.codes[code];
  for (const [token, value] of Object.entries(state.accessTokens)) if (new Date(value.expiresAt).getTime() <= now.getTime()) delete state.accessTokens[token];
  for (const [token, value] of Object.entries(state.refreshTokens)) if (new Date(value.expiresAt).getTime() <= now.getTime()) delete state.refreshTokens[token];
  return state;
}

class OAuthStore {
  constructor(filePath, { now = () => new Date(), fsImpl = fs } = {}) {
    this.filePath = path.resolve(filePath);
    this.now = now;
    this.fs = fsImpl;
  }

  read() {
    if (!this.fs.existsSync(this.filePath)) return emptyState();
    try {
      const state = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'));
      if (state?.version !== OAUTH_STORE_VERSION) return emptyState();
      return cleanExpired(state, this.now());
    } catch {
      return emptyState();
    }
  }

  write(state) {
    this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    this.fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    this.fs.renameSync(temporary, this.filePath);
  }

  createCode({ clientId, redirectUri, codeChallenge, resource, scope }) {
    const now = this.now();
    const state = this.read();
    const code = randomToken('code');
    state.codes[code] = {
      clientId,
      redirectUri,
      codeChallenge,
      resource,
      scope,
      expiresAt: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS).toISOString(),
    };
    this.write(state);
    return code;
  }

  issueTokens({ clientId, resource, scope }) {
    const now = this.now();
    const state = this.read();
    const accessToken = randomToken('at');
    const refreshToken = randomToken('rt');
    const access = { clientId, resource, scope, expiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_MS).toISOString() };
    const refresh = { clientId, resource, scope, expiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS).toISOString() };
    state.accessTokens[accessToken] = access;
    state.refreshTokens[refreshToken] = refresh;
    this.write(state);
    return { access_token: accessToken, token_type: 'Bearer', expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000), refresh_token: refreshToken, scope };
  }

  exchangeCode({ code, clientId, redirectUri, codeVerifier, resource }) {
    const state = this.read();
    const record = state.codes[code];
    if (!record) throw new Error('invalid_grant');
    delete state.codes[code];
    this.write(state);
    if (record.clientId !== clientId || record.redirectUri !== redirectUri || record.resource !== resource || !equalValue(record.codeChallenge, pkceS256(codeVerifier))) {
      throw new Error('invalid_grant');
    }
    return this.issueTokens({ clientId, resource, scope: record.scope });
  }

  refresh({ refreshToken, clientId, resource }) {
    const state = this.read();
    const record = state.refreshTokens[refreshToken];
    if (!record || record.clientId !== clientId || record.resource !== resource) throw new Error('invalid_grant');
    delete state.refreshTokens[refreshToken];
    this.write(state);
    return this.issueTokens({ clientId, resource, scope: record.scope });
  }

  access(token, { resource, requiredScope } = {}) {
    const record = this.read().accessTokens[token];
    if (!record || (resource && record.resource !== resource)) return null;
    const scopes = new Set(String(record.scope || '').split(/\s+/u).filter(Boolean));
    if (requiredScope && !scopes.has(requiredScope)) return null;
    return record;
  }
}

function isChatgptRedirectUri(value = '') {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com' && url.pathname.startsWith('/connector');
  } catch {
    return false;
  }
}

function isChatgptClientId(value = '') {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com' && url.pathname.startsWith('/oauth/');
  } catch {
    return false;
  }
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function authorizationForm(query = {}) {
  const hidden = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`)
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Authorize DIEM Editorial MCP</title><body><main><h1>Authorize DIEM Editorial MCP</h1><p>This grants the connected ChatGPT app access only to DIEM candidate and package tools. It cannot publish Instagram content.</p><form method="post" action="/oauth/authorize">${hidden}<label>Authorization password <input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Authorize DIEM editorial tools</button></form></main></body></html>`;
}

module.exports = {
  ACCESS_TOKEN_TTL_MS,
  OAuthStore,
  authorizationForm,
  equalValue,
  isChatgptClientId,
  isChatgptRedirectUri,
  pkceS256,
};
