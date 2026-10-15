const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const { diagnoseDiem, loadShadowImages } = require('../src/v2/diagnostics');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-diagnose-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assets = ['finance-01', 'finance-02'].map(id => {
    const bytes = Buffer.from(id);
    fs.writeFileSync(path.join(root, id + '.png'), bytes);
    return { id, file: id + '.png', sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
  });
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ assets }));
  return root;
}

test('diagnosis only reads Instagram and records five real reviewer outcomes', async t => {
  const root = fixture(t);
  const requests = [];
  const report = await diagnoseDiem({
    settings: { groqApiKey: 'groq-secret', groqVisionModel: 'vision-model', instagramUserId: 'account', instagramApiVersion: 'v23.0' },
    assetRoot: root, runId: 'run-123', intervalMs: 0,
    resolveTokenImpl: () => 'ig-secret',
    instagramRequestImpl: async request => { requests.push(request); return { id: 'account', username: 'diem.magazine' }; },
    verifyModelImpl: async (_client, model) => ({ id: model, active: true }),
    createClientImpl: () => ({}),
    createReviewerImpl: () => async ({ images }) => ({ ok: true, selectedId: images[0].id, reason: 'matches' }),
  });
  assert.equal(report.status, 'ok');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET');
  assert.equal(report.vision.consecutiveSuccesses, 5);
  assert.equal(new Set(report.vision.successfulRunIds).size, 5);
  assert.equal(report.readOnly, true);
  assert.equal(report.vision.probeType, 'project_owned_fixture');
  assert.doesNotMatch(JSON.stringify(report), /groq-secret|ig-secret|data:image/);
});

test('diagnosis preserves API restriction evidence without leaking credentials', async t => {
  const root = fixture(t);
  const error = Object.assign(new Error('User access is restricted token=ig-secret'), {
    status: 400, payload: { error: { code: 25, error_subcode: 2207050, error_user_msg: 'Bearer ig-secret', fbtrace_id: 'trace' } },
  });
  const report = await diagnoseDiem({
    settings: { groqApiKey: 'groq-secret', groqVisionModel: 'vision-model', instagramUserId: 'account' },
    assetRoot: root, runId: 'run', intervalMs: 0,
    resolveTokenImpl: () => 'ig-secret',
    instagramRequestImpl: async () => { throw error; },
    createClientImpl: () => ({}),
    verifyModelImpl: async () => ({ id: 'vision-model' }),
    createReviewerImpl: () => async () => ({ ok: false, reason: 'none' }),
  });
  assert.equal(report.status, 'failed');
  assert.equal(report.instagram.errorDetails.subcode, 2207050);
  assert.equal(report.instagram.disposition, 'manual_action_required');
  assert.equal(report.vision.consecutiveSuccesses, 0);
  assert.doesNotMatch(JSON.stringify(report), /ig-secret|groq-secret|payload/);
});

test('unavailable models never call Vision or claim successful shadow evidence', async t => {
  let reviews = 0;
  const report = await diagnoseDiem({
    settings: { groqApiKey: 'key', groqVisionModel: 'absent', instagramUserId: 'account' },
    resolveTokenImpl: () => 'token',
    instagramRequestImpl: async () => ({ id: 'account' }),
    createClientImpl: () => ({}),
    verifyModelImpl: async () => { throw Object.assign(new Error('model_not_found'), { code: 'model_not_found', status: 404 }); },
    createReviewerImpl: () => { reviews++; return async () => ({ ok: true }); },
  });
  assert.equal(reviews, 0);
  assert.equal(report.status, 'failed');
  assert.equal(report.model.status, 'failed');
  assert.equal(report.vision.consecutiveSuccesses, 0);
});

test('account verification distinguishes the professional user_id from the app-scoped id', async () => {
  const report = await diagnoseDiem({
    settings: { instagramUserId: 'professional-account', instagramUsername: 'diem.magazine' },
    resolveTokenImpl: () => 'secret',
    instagramRequestImpl: async request => {
      assert.equal(request.path, 'me');
      assert.match(request.params.fields, /user_id/);
      return { id: 'app-scoped-account', user_id: 'professional-account', username: 'diem.magazine' };
    },
  });
  assert.equal(report.instagram.status, 'ok');
  assert.equal(report.instagram.accountId, 'professional-account');
  assert.equal(report.instagram.appScopedId, 'app-scoped-account');
});

test('identity or username mismatch is actionable and preserves only selected account metadata', async () => {
  for (const profile of [
    { id: 'app', user_id: 'another-account', username: 'diem.magazine' },
    { id: 'app', user_id: 'account', username: 'another.username' },
  ]) {
    const report = await diagnoseDiem({
      settings: { instagramUserId: 'account', instagramUsername: 'diem.magazine' },
      resolveTokenImpl: () => 'secret',
      instagramRequestImpl: async () => ({ ...profile, access_token: 'must-not-be-recorded' }),
    });
    assert.equal(report.instagram.status, 'failed');
    assert.equal(report.instagram.disposition, 'manual_action_required');
    assert.equal(report.instagram.accountId, profile.user_id);
    assert.equal(report.instagram.username, profile.username);
    assert.doesNotMatch(JSON.stringify(report), /must-not-be-recorded|access_token/);
  }
});

test('shadow asset hash failure prevents review and path escape is rejected', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'finance-01.png'), 'tampered');
  assert.throws(() => loadShadowImages(root), /hash/);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  manifest.assets[0].file = '../outside.png';
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  assert.throws(() => loadShadowImages(root), /path/);
});
