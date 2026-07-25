const fs = require('fs');
const config = require('../config');
const { instagramRequest } = require('./instagram');
const { resolveInstagramToken, writeEncryptedToken } = require('./token-vault');

async function checkInstagramConnection({ fetchImpl = fetch, bootstrap = false } = {}) {
  const token = resolveInstagramToken();
  const profile = await instagramRequest({
    path: 'me',
    token,
    version: config.instagramApiVersion,
    params: { fields: 'id,user_id,username,account_type,media_count' },
    fetchImpl,
  });
  const returnedId = String(profile.user_id || profile.id || '');
  if (config.instagramUserId && returnedId !== String(config.instagramUserId)) {
    throw new Error(`[Instagram Check] Connected account ID ${returnedId} does not match INSTAGRAM_USER_ID.`);
  }
  if (config.instagramUsername && profile.username !== config.instagramUsername) {
    throw new Error(`[Instagram Check] Expected ${config.instagramUsername} but token belongs to ${profile.username}.`);
  }
  if (config.publishInstagramStory && String(profile.account_type || '').toUpperCase() !== 'BUSINESS') {
    throw new Error('[Instagram Check] Automatic Story publishing requires an Instagram Business account.');
  }
  if (bootstrap && config.instagramTokenEncryptionKey && !fs.existsSync(config.instagramTokenFile)) {
    writeEncryptedToken(token);
    console.log('[Instagram Check] Encrypted token vault initialized.');
  }
  console.log(`[Instagram Check] Connected to @${profile.username} (${returnedId}; ${profile.account_type || 'professional'}, ${profile.media_count ?? '?'} posts).`);
  return profile;
}

if (require.main === module) {
  checkInstagramConnection({ bootstrap: process.argv.includes('--bootstrap') }).catch(error => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { checkInstagramConnection };
