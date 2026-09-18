const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VISUAL_LIBRARY_ROOT = path.join(__dirname, '..', '..', 'assets', 'fallback', 'generated');
const MANIFEST_FILE = 'manifest.json';

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeAssetId(value = '') {
  const assetId = String(value || '').trim();
  if (!/^[a-z][a-z0-9-]{2,80}$/u.test(assetId)) {
    throw new Error('[DIEM Visual Library] assetId must contain 3-81 lowercase safe characters.');
  }
  return assetId;
}

function pngDimensions(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') {
    throw new Error('[DIEM Visual Library] asset must be a PNG file.');
  }
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function resolveVisualLibraryAsset(assetId, {
  root = VISUAL_LIBRARY_ROOT,
  fsImpl = fs,
} = {}) {
  const safeId = safeAssetId(assetId);
  const libraryRoot = path.resolve(root);
  const manifestPath = path.join(libraryRoot, MANIFEST_FILE);
  let manifest;
  try {
    manifest = JSON.parse(fsImpl.readFileSync(manifestPath, 'utf8'));
  } catch {
    throw new Error('[DIEM Visual Library] manifest is unavailable.');
  }
  const asset = (manifest.assets || []).find(item => item?.id === safeId);
  if (!asset || !Array.isArray(asset.topics) || asset.topics.length < 1 || !/^[a-f0-9]{64}$/u.test(asset.sha256 || '')) {
    throw new Error('[DIEM Visual Library] asset is not allowlisted by the manifest.');
  }
  if (path.basename(asset.file || '') !== asset.file || !asset.file.endsWith('.png')) {
    throw new Error('[DIEM Visual Library] asset file is invalid.');
  }
  const assetPath = path.resolve(libraryRoot, asset.file);
  if (!assetPath.startsWith(`${libraryRoot}${path.sep}`) || !fsImpl.existsSync(assetPath)) {
    throw new Error('[DIEM Visual Library] asset file is missing.');
  }
  const buffer = fsImpl.readFileSync(assetPath);
  if (sha256(buffer) !== asset.sha256) throw new Error('[DIEM Visual Library] asset hash mismatch.');
  const { width, height } = pngDimensions(buffer);
  if (width < 900 || height < 1600 || Math.abs((width / height) - (9 / 16)) >= 0.002) {
    throw new Error('[DIEM Visual Library] asset must be a 9:16 editorial canvas.');
  }
  return {
    id: asset.id,
    file: asset.file,
    sha256: asset.sha256,
    topics: [...asset.topics],
    energy: asset.energy || 'calm',
    description: asset.description || '',
    assetPath,
    width,
    height,
  };
}

module.exports = {
  MANIFEST_FILE,
  VISUAL_LIBRARY_ROOT,
  pngDimensions,
  resolveVisualLibraryAsset,
  safeAssetId,
};
