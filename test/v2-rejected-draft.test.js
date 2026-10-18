const test = require('node:test');
const assert = require('node:assert/strict');
const { rejectedDraft, diagnosticText } = require('../src/v2/rejected-draft');
const { generateEditorial, numericSemanticViolations } = require('../src/v2/editorial');
const { createDailyLedger, updatePublication } = require('../src/v2/ledger');
const { runCategoryStep } = require('../src/v2/orchestrator');

const article = { category: 'economy', title: '한국은행 기준금리 동결',
  fullText: '한국은행은 기준금리를 동결했다. 물가 흐름을 더 지켜보기로 했다. 다음 회의에서 지표를 살펴볼 계획이다.' };

test('rejected copy is field-allowlisted, byte-bounded, NFC normalized and redacted before truncation', () => {
  const secret = 'private-test-credential-123456';
  const parsed = { sentences: [secret + '\n"'.repeat(2000), 'https://private.invalid/?token=hidden Bearer private-header-value', '금리 ' + '가'.repeat(3000), secret],
    titleCandidates: [{ title: secret + '제목'.repeat(1000), secret }, { lines: ['첫줄', '둘째줄'] }, { title: 'ghp_abcdefghijklmno' }, { title: secret }],
    headers: { Authorization: secret }, session: secret, result: secret, raw: secret, reasoning: secret };
  const result = rejectedDraft(parsed, article.fullText, { secrets: [secret] });
  const serialized = JSON.stringify(result);
  assert.equal(result.status, 'rejected_not_validated');
  assert.equal(result.sentences.length, 3); assert.equal(result.titleCandidates.length, 3);
  assert.ok(Buffer.byteLength(serialized) < 4096);
  assert.ok(result.sentences.every(s => Buffer.byteLength(s) <= 600));
  assert.ok(result.titleCandidates.every(s => Buffer.byteLength(s.title) <= 160));
  assert.doesNotMatch(serialized, /private-test|private-header|private.invalid|ghp_|Authorization|reasoning|session/);
  assert.match(serialized, /REDACTED/); assert.match(serialized, /금리/);
  assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(result.titleCandidates[0]), ['title']);
  assert.equal(diagnosticText(secret + ' Bearer private-header-value', 1000, {secrets:[secret]}), '[REDACTED] [REDACTED]');
});

test('malformed or nonstring fields never fall back to raw response storage', () => {
  for (const input of ['provider raw private response', { sentences: [{ password: 'secret' }], titleCandidates: [{ title: { secret: 'value' } }] }, null]) {
    const result = rejectedDraft(input, article.fullText);
    assert.equal(result.unavailableReason, 'no_parsed_editorial_fields');
    assert.deepEqual(result.sentences, []); assert.deepEqual(result.titleCandidates, []);
    assert.doesNotMatch(JSON.stringify(result), /private response|password|value/);
  }
});

test('body and repair rejection evidence survives actual generation and candidate exhaustion without changing the call budget', async () => {
  let calls = 0;
  const previous = process.env.DIEM_TEST_SECRET;
  process.env.DIEM_TEST_SECRET = 'private-draft-test-token';
  const drafts = [];
  try {
    let ledger = createDailyLedger('2026-10-18');
    ledger = updatePublication(ledger, 'economy', {status:'planned',candidate:article});
    ledger.candidates = [article];
    const result = await runCategoryStep(ledger, 'economy', {phase:'prepare',preparePublicationImpl:async()=>{
      return generateEditorial(article, {primaryModel:'claude-opus-5-5',fallbackModel:null,callModel:async request=>{
        calls++;
        if(calls===1) assert.match(request.systemPrompt,/같은 원문 문장\/절/);
        else { assert.deepEqual(JSON.parse(request.userPrompt).allowedNumbers,[]);assert.match(request.systemPrompt,/모든 숫자 표현을 생략/); }
        const draft={titleCandidates:[{title:'한국은행\n금리 동결'}],sentences:[`private-draft-test-token 한국은행은 기준금리를 ${calls===1?'99':'88'}%로 동결했다.`, '물가 흐름을 살폈다.', 'private-draft-test-token']};
        drafts.push(draft); return draft;
      }});
    }});
    assert.equal(calls,2);
    assert.equal(result.publications.economy.status,'no_publish');
    const attempts=result.publications.economy.generation.candidateFailures[0].modelAttempts;
    const rejected=attempts.filter(a=>a.rejectedDraft);
    assert.equal(rejected.filter(a=>a.stage!=='editorial').length,2);
    assert.match(rejected[0].rejectedDraft.sentences[0],/99%/);
    assert.match(rejected[1].rejectedDraft.sentences[0],/88%/);
    assert.ok(rejected.every(a=>a.rejectedDraft.status==='rejected_not_validated'));
    assert.doesNotMatch(JSON.stringify(result),/private-draft-test-token/);
    assert.equal(result.publications.economy.editorial,null);
  } finally {if(previous===undefined) delete process.env.DIEM_TEST_SECRET; else process.env.DIEM_TEST_SECRET=previous;}
});

test('invalid JSON records only unavailable evidence while keeping the two-call failure path', async () => {
  let calls=0;
  await assert.rejects(generateEditorial(article,{primaryModel:'claude-opus-5-5',fallbackModel:null,callModel:async()=>{calls++;return 'RAW_PRIVATE_RESPONSE';}}),error=>{
    const evidence=error.attempts.filter(a=>a.rejectedDraft);
    assert.equal(evidence.length,2);
    assert.ok(evidence.every(a=>a.rejectedDraft.unavailableReason==='no_parsed_editorial_fields'));
    assert.doesNotMatch(JSON.stringify(evidence),/RAW_PRIVATE_RESPONSE/);
    return true;
  });
  assert.equal(calls,2);
});

test('numeric owner, duration and denominator guards are unchanged; known NPU lexical limitation remains explicit', () => {
  const source={fullText:'리벨리온은 SKT의 상용 AI 서비스 4개의 핵심 기능에 적용되고 있다. 올해 6월부터 네 기능에 순차적으로 NPU를 도입했다.'};
  assert.deepEqual(numericSemanticViolations(['리벨리온은 SKT의 상용 AI 서비스 4개의 핵심 기능에 적용되고 있다.'],source),[]);
  assert.ok(numericSemanticViolations(['리벨리온 NPU는 SKT의 상용 AI 서비스 4개의 핵심 기능에 적용되고 있다.'],source).length);
  assert.ok(numericSemanticViolations(['다른회사는 SKT의 상용 AI 서비스 4개에 적용됐다.'],source).length);
  assert.ok(numericSemanticViolations(['리벨리온은 SKT의 상용 AI 서비스 5개에 적용됐다.'],source).length);
  assert.ok(numericSemanticViolations(['주담대 금리 9개월 만에 최고'],{fullText:'주담대 금리는 3년 9개월 만에 최고였다.'}).length);
  assert.ok(numericSemanticViolations(['청년 미신청률 45%'],{fullText:'미신청 가구 중 20대 이하가 45%였다.'}).length);
});

test('final caption contract failures retain the assembled draft and never record editorial success', async () => {
 let calls=0;
 await assert.rejects(generateEditorial(article,{primaryModel:'claude-opus-5-5',fallbackModel:null,callModel:async()=>{calls++;return {
  titleCandidates:[{title:'한국은행\n기준금리 동결'}],
  sentences:['한국은행이 금리를 유지하기로 했다고 밝혔습니다.','물가 동향을 관찰하기로 했습니다. @private','추후 회의에서 지표를 점검할 계획입니다.']
 };}}),error=>{
  assert.match(error.message,/account mentions/);
  const attempt=error.attempts.find(a=>a.stage==='editorial'&&a.status==='failed');
  assert.equal(attempt.rejectedDraft.status,'rejected_not_validated');
  assert.match(attempt.rejectedDraft.sentences[1],/@private/);
  assert.equal(error.attempts.some(a=>a.stage==='editorial'&&a.status==='succeeded'),false);
  return true;
 });
 assert.equal(calls,1);
});
