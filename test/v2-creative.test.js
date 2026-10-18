const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { editorialRuntime } = require('../src/v2/editorial-provider');
const { creativeBrief, reviewRenderedCreative, assertCreativeBinding } = require('../src/v2/creative');
const { createGeneratedFallback, reviewedGeneratedFallback, buildImageQueries } = require('../src/v2/image-selector');
const { getMood, selectMusic } = require('../src/v2/music');
const { numericSemanticViolations } = require('../src/v2/editorial');

test('production pins Opus without a fallback and preserves execution evidence', async () => {
  const runtime = editorialRuntime({ settings: { editorialProvider: 'claude' }, createClaude: options => async request => {
    options.onMetadata({ modelIds: [request.model], turns: 1 }); return '{}';
  } });
  assert.equal(runtime.primaryModel, 'claude-opus-5-5');
  assert.equal(runtime.fallbackModel, null);
  await runtime.callModel({ model: runtime.primaryModel });
  assert.equal(runtime.evidence().execution[0].modelIds[0], 'claude-opus-5-5');
  await assert.rejects(runtime.callModel({ model: 'openai/gpt-oss-120b' }), /unexpected/u);
});

test('negative news dominates bright words and policy statements use restrained music', () => {
  assert.equal(getMood('주가 상승 기대에도 급락 위기'), 'serious');
  const b = creativeBrief({ title: '간부전 환자가 치료 후 회복' }, { title: { text: '환자 회복' }, caption: { text: '장기 손상 사례가 보고됐다.' } });
  assert.equal(b.mood, 'serious'); assert.equal(b.sensitive, true);
  const music = selectMusic({ newsOnly: true, mood: 'serious', publicationKey: 'coherence-test' });
  assert.doesNotMatch(music.title || '', /fright|love|summer lounge/iu);
  assert.equal(selectMusic({ newsOnly: true, mood: 'serious', manifest: { tracks: [{ id: 'bright', mood: 'bright' }] } }).mode, 'silent');
});

test('generated pixels require review and a rejected pair can advance to other assets', async () => {
  const candidate = { title: '은행 금리 정책', newsFrame: { subject: '은행 금리', eventKind: 'interest_rate' } };
  assert.equal(await reviewedGeneratedFallback(candidate, {}, { required: true }), null);
  let calls = 0; const rejected = new Set();
  const image = await reviewedGeneratedFallback(candidate, {}, { required: true, reviewImages: async ({ images }) => {
    calls++;
    assert.ok(images.every(i => i.reviewUrl.startsWith('data:image/png;base64,')));
    if (calls === 1) { images.forEach(i => rejected.add(i.id)); return { ok: false }; }
    assert.ok(images.every(i => !rejected.has(i.id)));
    return { ok: true, selectedId: images[0].id, model: 'qwen/qwen3.8-27b' };
  } });
  assert.equal(calls, 2); assert.equal(image.finalReview.ok, true);
  assert.equal(image.reviewUrl, undefined);
});

test('final cover review sends a bounded public summary, blocks mismatch and binds exact artifacts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-creative-'));
  try {
    const coverPath = path.join(root, 'cover.png'); fs.writeFileSync(coverPath, 'test pixels');
    const article = { title: '국무회의 공개 발언', summary: '공개 기사 요약', fullText: 'SOURCE_BODY_MUST_REMAIN_LOCAL' };
    const editorial = { title: { text: '국무회의\n공개 발언' }, caption: { text: '공개 범위에 관한 발언이다.' } };
    const brief = creativeBrief(article, editorial);
    const reviewImages = async ({ candidate, images }) => {
      assert.equal(candidate.fullText, undefined); assert.ok(candidate.summary.length <= 600);
      assert.doesNotMatch(JSON.stringify(candidate), /SOURCE_BODY_MUST_REMAIN_LOCAL/u);
      return { ok: true, selectedId: images[0].id, model: 'test-review' };
    };
    const review = await reviewRenderedCreative({ article, brief, coverPath, reviewImages });
    const reelPath = path.join(root, 'reel.mp4'); fs.writeFileSync(reelPath, 'approved video');
    const reelHash = require('crypto').createHash('sha256').update(fs.readFileSync(reelPath)).digest('hex');
    review.reviewedReelSha256 = reelHash;
    const publication = { candidate: article, editorial, creativeReview: review, artifacts: { coverPath, reelPath, coverSha256: review.reviewedArtifactSha256, reelSha256: reelHash } };
    assert.doesNotThrow(() => assertCreativeBinding(publication));
    publication.release = { videoUrl: 'https://example.com/old.mp4', reelSha256: 'old' };
    assert.throws(() => assertCreativeBinding(publication), /Release does not match/u);
    publication.release = { tag: 'old', reelSha256: 'old' };
    assert.throws(() => assertCreativeBinding(publication), /Release does not match/u);
    delete publication.release;
    fs.writeFileSync(reelPath, 'changed video');
    assert.throws(() => assertCreativeBinding(publication), /bytes changed/u);
    fs.unlinkSync(reelPath);
    assert.throws(() => assertCreativeBinding(publication), /no matching/u);
    publication.release = { videoUrl: 'https://example.com/reel.mp4', reelSha256: reelHash };
    assert.doesNotThrow(() => assertCreativeBinding(publication));
    publication.release.reelSha256 = 'mismatch';
    assert.throws(() => assertCreativeBinding(publication), /Release does not match/u);
    publication.release.reelSha256 = reelHash;
    assert.throws(() => assertCreativeBinding({ ...publication, editorial: { ...editorial, title: { text: '다른 사건' } } }), /no longer matches/u);
    await assert.rejects(reviewRenderedCreative({ article, brief, coverPath, reviewImages: async () => ({ ok: false, reason: 'unrelated gavel' }) }), /mismatch/u);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a validated editorial keyword participates in search and lexical third-country is not a quantity', () => {
  const queries = buildImageQueries({ title: '대통령 발언', newsFrame: { subject: '대통령', eventKind: 'political_statement' }, editorialCaption: '대통령이 회의 공개에 관해 발언했다.', imageKeyword: 'government briefing podium' });
  assert.equal(queries[0], 'government briefing podium');
  assert.deepEqual(numericSemanticViolations(['선박을 제3국에 등록했다.'], { fullText: '선박을 제3국에 등록했다.' }), []);
});

test('the real production adapter shares a twelve-call process cap across candidate runtimes', async () => {
  let calls = 0;
  const options = { settings: { editorialProvider: 'claude' }, budget: { requests: 0 }, createClaude: () => async () => { calls++; return '{}'; } };
  for (let i = 0; i < 12; i++) await editorialRuntime(options).callModel({ model: 'claude-opus-5-5' });
  await assert.rejects(editorialRuntime(options).callModel({ model: 'claude-opus-5-5' }), /budget exhausted/u);
  assert.equal(calls, 12);
});

test('political statements select briefing assets and never rotate into court imagery', () => {
 const political = { title: '대통령 국무회의 공개 발언', newsFrame: { eventKind: 'political_statement', subject: '대통령 발언' } };
 assert.equal(createGeneratedFallback(political).id, 'diem-generated:government-briefing-01-openai');
 assert.equal(createGeneratedFallback({ title: '대통령 “개혁 내세워 내부공격”', newsFrame: {eventKind:'general', subject:'대통령 능력'} }).id, 'diem-generated:government-briefing-01-openai');
 assert.equal(createGeneratedFallback({...political, generatedAssetId: 'legislation-01'}), null);
 assert.equal(createGeneratedFallback({title:'법원 판결', newsFrame:{eventKind:'legislation'}, generatedAssetId:'government-briefing-01-openai'}), null);
});

test('retrial document stories use evidence review assets instead of court verdict symbolism', () => {
 const article = {title:'재심 쟁점 된 국정원 문건 수원고법원장 발언', newsFrame:{eventKind:'general',subject:'형사소송법'}};
 assert.equal(createGeneratedFallback({...article,editorialCaption:'북한 소재지 증거 문건은 재심 쟁점이다.'}).id,'diem-generated:legal-document-review-01-openai');
 assert.equal(createGeneratedFallback({title:'대통령 “금리 인하 검토”',newsFrame:{eventKind:'political_statement'},editorialCaption:'금리 정책에 관한 발언이다.'}).id,'diem-generated:government-briefing-01-openai');
 assert.equal(createGeneratedFallback({...article,generatedAssetId:'legislation-01'}),null);
});

test('final image context recheck uses the same validated copy as initial selection', () => {
 const article={title:'코스피 급락',newsFrame:{eventKind:'general',subject:'건강 정책'}};
 const editorial={title:{text:'코스피 급락'},caption:{text:'코스피 지수가 하락했다.'}};
 const image=createGeneratedFallback({...article,editorialTitle:editorial.title.text,editorialCaption:editorial.caption.text});
 assert.equal(image.generatedTopic,'markets');
 const result=require('../src/v2/quality-gate').validatePreparedQuality({article,editorial,image});
 assert.equal(result.image.finalReview.ok,true);
});

test('the real overseas-income tax case selects tax review imagery instead of generic law assets', () => {
 const article=require('./fixtures/editorial/tax-assessment-2026-10-18.json');
 const image=createGeneratedFallback(article);
 assert.equal(image.id,'diem-generated:tax-assessment-01-openai');
 assert.equal(image.generatedTopic,'finance');
 assert.equal(createGeneratedFallback({...article,generatedAssetId:'legislation-01'}),null);
 assert.equal(createGeneratedFallback({title:'대통령 “세금 폭탄 비판”',newsFrame:{eventKind:'political_statement'}}).id,'diem-generated:government-briefing-01-openai');
 assert.equal(createGeneratedFallback({title:'법원 살인 사건 항소심 선고',newsFrame:{eventKind:'legislation'},generatedAssetId:'tax-assessment-01-openai'}),null);
});
