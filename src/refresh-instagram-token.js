const config = require('../config');
const { resolveInstagramToken, writeEncryptedToken } = require('./token-vault');

async function refreshInstagramToken({ fetchImpl = fetch } = {}) {
  if (config.instagramTokenSource === 'repository_secret') {
    console.log('[Token Refresh] Repository Secret mode: encrypted vault rotation is skipped.');
    return { skipped: true, reason: 'repository_secret_mode' };
  }
  const currentToken = resolveInstagramToken();
  const url = new URL('https://graph.instagram.com/refresh_access_token');
  url.searchParams.set('grant_type', 'ig_refresh_token');
  url.searchParams.set('access_token', currentToken);
  const response = await fetchImpl(url, { headers: { 'User-Agent': 'today-econ-github-actions' } });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) {
    throw new Error(`[Token Refresh] ${response.status}: ${payload.error?.message || 'No refreshed token returned.'}`);
  }
  writeEncryptedToken(payload.access_token);
  console.log(`[Token Refresh] Encrypted token rotated successfully. Expires in ${payload.expires_in || 'unknown'} seconds.`);
  return { expiresIn: payload.expires_in, rotated: payload.access_token !== currentToken };
}

if (require.main === module) {
  refreshInstagramToken().catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { refreshInstagramToken };
