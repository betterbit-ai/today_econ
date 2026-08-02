const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { CATEGORIES } = require('../src/v2/constants');
const {
  buildHashtagReply,
  graphemeCount,
  validateCaption,
  validateHashtagReply,
  validateTitle,
  validateTitleAgainstFrame,
} = require('../src/v2/text');
const { isSameKstDate, kstDate, kstDateLabel } = require('../src/v2/time');
const {
  assessDiemEditorialValue,
  assessDuplicate,
  buildNewsFrame,
  buildTopicSignature,
  classifyCandidate,
  isSensitiveTopic,
  normalizeTopicAliases,
} = require('../src/v2/topic');
const {
  createDailyLedger,
  historyFromLedgers,
  imageRecordFromPublication,
  loadLedger,
  publicationKey,
  saveLedger,
  updatePublication,
  updateStep,
  validateLedger,
} = require('../src/v2/ledger');

test('preserves fallback art identity separately from the final rendered cover hash', () => {
  const record = imageRecordFromPublication({
    publicationKey: 'diem:2026-08-02:issue:run-2200',
    category: 'issue',
    status: 'published',
    image: {
      kind: 'typographic',
      id: 'diem-art:occupational-heat:v11',
      source: 'diem-original',
      localSha256: 'final-cover-sha-changes-with-title',
      fallbackTheme: 'occupational-heat',
      fallbackVariant: 11,
      artVariantId: 'diem-art:occupational-heat:v11',
      visualFingerprint: 'diem-art:occupational-heat:v11',
    },
  }, '2026-08-02');

  assert.equal(record.image.localSha256, 'final-cover-sha-changes-with-title');
  assert.equal(record.image.fallbackTheme, 'occupational-heat');
  assert.equal(record.image.fallbackVariant, 11);
  assert.equal(record.image.visualFingerprint, 'diem-art:occupational-heat:v11');
});

test('uses Asia/Seoul for publication dates around the UTC boundary', () => {
  const instant = new Date('2026-07-25T15:30:00.000Z');
  assert.equal(kstDate(instant), '2026-07-26');
  assert.equal(kstDateLabel(instant), '2026.07.26');
  assert.equal(isSameKstDate('2026-07-26T01:00:00+09:00', instant), true);
});

test('validates a two-line DIEM title by grapheme count', () => {
  const valid = validateTitle('금리 다시\n내려간다');
  assert.equal(valid.ok, true);
  assert.equal(valid.lines.length, 2);
  assert.ok(valid.graphemeCount <= 14);
  assert.equal(validateTitle('모르면 손해\n금리 비밀').ok, false);
  assert.equal(validateTitle('한 줄뿐인 제목').ok, false);
  assert.equal(validateTitle('자동차보험 6년\n6년 적자').ok, false);
  assert.equal(validateTitle('6년\n자동차보험 적자').ok, false);
  assert.equal(validateTitle('개인투자자\n절망 시대').ok, false);
  assert.equal(validateTitle('코스피 반등\n기대↑').ok, false);
  assert.equal(validateTitle('보완수사권\n완전 통과').ok, false);
});

test('validates exactly three short caption sentences and emoji positions', () => {
  const caption = [
    '한국은행이 기준금리를 동결했습니다.🏦',
    '물가와 가계대출 흐름을 더 지켜보기로 했습니다.',
    '다음 결정은 새 물가 지표에 따라 달라질 수 있습니다.📊',
  ].join('\n\n');
  const result = validateCaption(caption);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.sentences.length, 3);
  assert.ok(result.sentences.every(sentence => graphemeCount(sentence) <= 120));
  assert.equal(validateCaption(caption.replace('흐름을', '흐름을📉')).ok, false);
  assert.equal(validateCaption(`첫 문장입니다.📊\n\n${'가'.repeat(121)}\n\n셋째 문장입니다.🔎`).ok, false);
  assert.equal(validateCaption('자료사진 설명이 들어간 문장입니다.📰\n\nⓒ연합뉴스개인정보를 원문 그대로 수집했다는 내용입니다.\n\n셋째 문장입니다.🔎').ok, false);
  assert.equal(validateCaption('▷ 전화 02-784-4000▷ 이메일 mbcjebo@mbc.co.kr▷ 카카오톡 @mbc제보.📊\n\n둘째 문장입니다.\n\n셋째 문장입니다.🔎').ok, false);
  assert.equal(validateCaption('첫 문장입니다.📊\n\n비싼 MRI도 일단 찍고 봤다고 말합니다.규모가 작아 MRI를 보냈다는.\n\n셋째 문장입니다.🔎').ok, false);
  assert.equal(validateCaption('첫 문장입니다.📊\n\n둘째 문장입니다.\n\n기사 파편을 받았다는.🔎').ok, false);
});

test('builds a mention plus 12-15 unique dot-free hashtags', () => {
  const result = buildHashtagReply({
    category: CATEGORIES.ECONOMY,
    handle: '@diem.magazine',
    topicTags: ['한국은행', '기준금리', '물가', '가계대출', '한국은행'],
  });
  const validation = validateHashtagReply(result.full, { handle: 'diem.magazine' });
  assert.equal(validation.ok, true, validation.errors.join('; '));
  assert.ok(validation.hashtags.includes('#diem'));
  assert.ok(!validation.hashtags.some(tag => tag.includes('.')));
  assert.equal(new Set(validation.hashtags).size, validation.hashtags.length);
});

test('classifies allowed economy and issue topics and excludes low-value items', () => {
  assert.equal(classifyCandidate({ title: '한국은행 기준금리 동결' }).category, CATEGORIES.ECONOMY);
  assert.equal(classifyCandidate({ title: '청년 주거 지원 정책 시행' }).category, CATEGORIES.ISSUE);
  assert.equal(classifyCandidate({
    title: '"내 얼굴·목소리 원본, 동의 없이 수집·활용" 피지컬AI 특별법 논란',
    summary: '국회에서 피지컬AI 특별법안이 논의되며 개인정보 원본을 정보주체 동의 없이 활용할 수 있다는 우려가 나온다.',
  }).category, CATEGORIES.ISSUE);
  assert.equal(classifyCandidate({ title: '증권사 임원 인사 발표' }).category, null);
  assert.equal(isSensitiveTopic({ title: '대형 화재로 인명 피해' }), true);
});

test('classifies real-world finance, public transport, and disaster shorthand', () => {
  assert.equal(classifyCandidate({
    title: '마통 6일간 1.8조 늘었다…주담대 11개월만에 최대폭',
  }).category, CATEGORIES.ECONOMY);
  assert.equal(classifyCandidate({
    title: '9월부터 KTX·SRT 통합…요금 10% 내리고 운행횟수·좌석 늘어나',
  }).category, CATEGORIES.ECONOMY);
  assert.equal(classifyCandidate({
    title: '기상관측 사상 첫 42도 돌파…중대본 2단계 격상',
  }).category, CATEGORIES.ISSUE);
});

test('builds claim-state frames that prevent misleading denial and acronym-date titles', () => {
  const denialArticle = {
    category: CATEGORIES.ISSUE,
    title: '보건복지부, 건강보험료 상하한선 기준 개선 확정되지 않아',
    summary: '보건복지부는 연합뉴스 기사에서 언급된 내용은 확정된 바 없다고 밝혔습니다.',
  };
  const denialFrame = buildNewsFrame(denialArticle, CATEGORIES.ISSUE);
  assert.equal(denialFrame.claimState, 'official_denial');
  assert.equal(validateTitleAgainstFrame('보건복지부\n0.01% 확정', denialFrame).ok, false);
  assert.equal(validateTitleAgainstFrame('정부 반박\n건보료 개편', denialFrame).ok, true);

  const slowdownFrame = buildNewsFrame({
    category: CATEGORIES.ECONOMY,
    title: '미국 2분기 GDP 성장률 1.5%로 둔화',
    summary: '미국의 성장률은 1분기 2.1%에서 2분기 1.5%로 낮아졌습니다.',
  }, CATEGORIES.ECONOMY);
  assert.equal(validateTitleAgainstFrame('미국 GDP\n성장률 증가', slowdownFrame).ok, false);
  assert.equal(validateTitleAgainstFrame('미국 GDP\n성장률 둔화', slowdownFrame).ok, true);

  const pensionArticle = {
    category: CATEGORIES.ECONOMY,
    title: '국민연금 리밸런싱 재개…유가증권시장 684억 순매수',
    summary: '국민연금은 7월 리밸런싱을 재개하며 올해 처음 순매수를 기록했습니다. 다만 세부 운용 방향이 모두 확정된 바는 없다는 시장 설명도 나왔습니다.',
  };
  const pensionFrame = buildNewsFrame(pensionArticle, CATEGORIES.ECONOMY);
  assert.notEqual(pensionFrame.claimState, 'official_denial');
  assert.equal(validateTitleAgainstFrame('국민연금\n순매수', pensionFrame).ok, true);

  const ipoArticle = {
    category: CATEGORIES.ECONOMY,
    title: 'CXMT, 내일 중국 증시 데뷔…올해 아시아 증시 최대 IPO',
    summary: '중국 창신메모리테크놀로지(CXMT)가 27일 과창판에서 첫 거래에 나섭니다.',
    entities: ['CXMT', 'IPO'],
  };
  const ipoFrame = buildNewsFrame(ipoArticle, CATEGORIES.ECONOMY);
  assert.equal(ipoFrame.eventKind, 'ipo');
  assert.equal(validateTitleAgainstFrame('CXMT 내일\n27일', ipoFrame).ok, false);
  assert.equal(validateTitleAgainstFrame('CXMT IPO\n27일 상장', ipoFrame).ok, true);
  assert.equal(validateTitleAgainstFrame('자동차보험 6년\n6년 적자', buildNewsFrame({
    category: CATEGORIES.ECONOMY,
    title: '자동차보험 6년 만에 적자‥사이드미러 툭 쳐도 MRI, 한방병원이 주범',
    summary: '올해 상반기 자동차보험 영업손익이 6년 만에 적자로 돌아섰습니다.',
  }, CATEGORIES.ECONOMY)).ok, false);
  assert.equal(validateTitleAgainstFrame('얼굴 목소리\n흐름정리', buildNewsFrame({
    category: CATEGORIES.ISSUE,
    title: '피지컬AI 특별법 개인정보 활용 논란',
  }, CATEGORIES.ISSUE)).ok, false);

  const industryArticle = {
    category: CATEGORIES.ECONOMY,
    title: '한국은 반도체만 세계 1위…중국이 배터리·조선 싹쓸이했다',
    summary: '한국은 메모리 반도체 1위를 지켰지만 차량용 배터리와 조선에서는 중국 기업이 점유율 선두를 차지했다.',
  };
  const industryFrame = buildNewsFrame(industryArticle, CATEGORIES.ECONOMY);
  assert.equal(industryFrame.competitiveState, 'china_leads_battery_shipbuilding');
  assert.equal(validateTitleAgainstFrame('한국 반도체 1위 유지\n배터리·조선 중국 추격', industryFrame).ok, false);
  assert.equal(validateTitleAgainstFrame('반도체1위\n배·조선 中선두', industryFrame).ok, true);

  const portfolioSale = {
    category: CATEGORIES.ECONOMY,
    title: "'1500% 수익 신화' 20대男 몰락에…반도체 폭등 '환호' 터졌다",
    summary: '헤지펀드 SA가 보유한 상장 주식을 시타델에 매각하면서 반대매매 우려가 완화됐습니다. 이전에 SK하이닉스 ADR 상장에 참여한 이력이 있습니다.',
  };
  const saleFrame = buildNewsFrame(portfolioSale, CATEGORIES.ECONOMY);
  assert.equal(saleFrame.eventKind, 'asset_sale');
  assert.equal(validateTitleAgainstFrame('시타델 인수\n반도체 IPO', saleFrame).ok, false);
});

test('canonicalizes related criminal-procedure coverage as the same event even when headlines change angle', () => {
  const first = buildTopicSignature({
    title: "'보완수사권 폐지' 국회 본회의 통과",
    summary: '형사소송법 개정안이 국회를 통과했습니다.',
  }, CATEGORIES.ISSUE);
  const second = buildTopicSignature({
    title: "법 통과 '직전'에야 국회 도착한 검토자료",
    summary: '형소법 개정안의 공소기각 선고 사유 검토 자료가 법안 통과 1시간 전 제출됐습니다.',
  }, CATEGORIES.ISSUE);

  assert.equal(first.eventKey, 'criminal_procedure_amendment');
  assert.equal(second.eventKey, 'criminal_procedure_amendment');
  const legacyFirst = {
    category: CATEGORIES.ISSUE,
    target: '보완수사권 폐지 국회',
    event: '폐지',
    text: 'issue | 보완수사권 폐지 국회 | 폐지',
  };
  assert.equal(assessDuplicate(second, legacyFirst, { semanticScore: 0.22 }).duplicate, true);
});

test('normalizes auto-insurance loss articles to a concrete subject and event', () => {
  const article = {
    category: CATEGORIES.ECONOMY,
    title: '자동차보험 6년 만에 적자‥"사이드미러 툭 쳐도 MRI, 한방병원이 주범"',
    summary: '올해 상반기 자동차보험 영업손익이 6년 만에 적자로 돌아섰습니다.',
  };
  const frame = buildNewsFrame(article, CATEGORIES.ECONOMY);
  const signature = buildTopicSignature(article, CATEGORIES.ECONOMY);
  assert.equal(frame.subject, '자동차보험');
  assert.equal(frame.eventKind, 'auto_insurance_loss');
  assert.equal(signature.target, '자동차보험');
  assert.equal(signature.event, '적자 전환');
});

test('scores DIEM editorial value instead of accepting every broad issue keyword', () => {
  const denial = assessDiemEditorialValue({
    title: '보건복지부, 건강보험료 상하한선 기준 개선 확정되지 않아',
    summary: '연합뉴스 보도와 관련해 확정된 바 없다고 설명자료를 냈습니다.',
  }, CATEGORIES.ISSUE);
  assert.equal(denial.ok, false);
  assert.equal(denial.reason, 'official_denial_without_confirmed_change');

  const narrowClimate = assessDiemEditorialValue({
    title: '과수원 꽃눈에 천연 패딩…이상기후 냉해 막는 이 기술',
    summary: '농가가 과수원 꽃눈 냉해를 막기 위해 새 재배 기술을 시험했습니다.',
  }, CATEGORIES.ISSUE);
  assert.equal(narrowClimate.ok, false);
  assert.equal(narrowClimate.reason, 'narrow_or_local_issue');

  const foreignHumanInterest = assessDiemEditorialValue({
    title: "태국 고등학생 '귀신 분장' 응급 이송…병원도 경악",
    summary: "태국 야소톤주의 16세 여학생이 학교 행사에서 귀신 '피까' 분장을 한 채 복통을 호소해 구조대가 병원으로 옮겼고 사진이 SNS에서 화제가 됐습니다.",
  }, CATEGORIES.ISSUE);
  assert.equal(foreignHumanInterest.ok, false);
  assert.equal(foreignHumanInterest.reason, 'sensational_anecdote_without_public_interest');

  const housing = assessDiemEditorialValue({
    title: '청년 주거 지원 월세 보조금 50만원 확대',
    summary: '정부는 전국 청년 가구의 주거 부담을 낮추기 위한 정책 확대안을 발표했습니다.',
  }, CATEGORIES.ISSUE);
  assert.equal(housing.ok, true);

  const privacyAiAsEconomy = assessDiemEditorialValue({
    title: '"내 얼굴·목소리 원본, 동의 없이 수집·활용" 피지컬AI 특별법 논란',
    summary: '국회에서 피지컬AI 특별법안이 논의되며 개인정보 원본을 정보주체 동의 없이 활용할 수 있다는 우려가 나온다.',
  }, CATEGORIES.ECONOMY);
  assert.equal(privacyAiAsEconomy.ok, false);
  assert.match(privacyAiAsEconomy.reason, /economy_core_topic_missing|privacy_rights_policy_not_economy/u);
});

test('applies automatic and gray-zone duplicate thresholds', () => {
  const current = { target: '한국은행 기준금리', event: '금리 동결', text: '경제 | 한국은행 기준금리 | 금리 동결' };
  const same = { target: '한국은행 기준금리', event: '금리 동결', text: '경제 | 기준금리 한국은행 | 동결 결정' };
  const differentEvent = { target: '한국은행 기준금리', event: '총재 인터뷰', text: '경제 | 한국은행 기준금리 | 총재 인터뷰' };
  assert.equal(assessDuplicate(current, same, { semanticScore: 0.8 }).duplicate, true);
  assert.equal(assessDuplicate(current, same, { semanticScore: 0.72 }).duplicate, true);
  assert.equal(assessDuplicate(current, differentEvent, { semanticScore: 0.72 }).duplicate, false);
  assert.equal(assessDuplicate(current, same, { semanticScore: 0.8, allowMaterialFollowUp: true }).repeatOverride, true);
});

test('normalizes common Korean news aliases before gray-zone matching', () => {
  assert.equal(
    normalizeTopicAliases('주택용 전기료 유지 한전'),
    '가정용 전기요금 동결 한국전력'
  );
  assert.equal(
    normalizeTopicAliases('다음 해 최저임금 최종 액수 확정 최저임금위'),
    '내년도 최저임금 금액 확정 최저임금위원회'
  );
  const current = buildTopicSignature({
    title: '전기요금 동결',
    target: '가정용 전기요금',
    event: '요금 동결',
  }, CATEGORIES.ECONOMY);
  const previous = buildTopicSignature({
    title: '주택용 전기료 유지',
    target: '주택용 전기료',
    event: '요금 유지',
  }, CATEGORIES.ECONOMY);
  assert.equal(assessDuplicate(current, previous, { semanticScore: 0.72 }).duplicate, true);
});

test('creates, atomically stores, and reloads a two-category daily ledger', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'diem-ledger-'));
  const file = path.join(root, '2026-07-25.json');
  let ledger = createDailyLedger('2026-07-25', new Date('2026-07-25T09:30:00.000Z'));
  const signature = buildTopicSignature({ title: '한국은행 기준금리 동결', event: '금리 동결' }, CATEGORIES.ECONOMY);
  ledger = updatePublication(ledger, CATEGORIES.ECONOMY, {
    status: 'published',
    candidate: { title: '한국은행 기준금리 동결' },
    duplicateCheck: { signature },
    audio: { trackId: 'economy-steady' },
    image: {
      kind: 'web',
      id: 'pexels:rate',
      originalUrl: 'https://www.pexels.com/photo/rate/',
      downloadUrl: 'https://images.pexels.com/photos/rate/photo.jpeg',
      localSha256: 'rate-image-sha',
    },
  });
  ledger = updateStep(ledger, CATEGORIES.ECONOMY, 'reel', {
    status: 'published',
    externalId: 'ig-1',
    incrementAttempt: true,
  }, new Date('2026-07-25T09:31:00.000Z'));
  saveLedger(ledger, file);
  const loaded = loadLedger('2026-07-25', file);
  assert.equal(loaded.schemaVersion, 3);
  assert.equal(loaded.publications.economy.publicationKey, publicationKey('2026-07-25', 'economy'));
  assert.equal(loaded.publications.economy.reel.attempts, 1);
  assert.equal(fs.existsSync(`${file}.tmp`), false);

  const future = createDailyLedger('2026-07-26');
  const history = historyFromLedgers([loaded, future], '2026-07-26', 7);
  assert.equal(history.length, 1);
  assert.equal(history[0].audioTrackId, 'economy-steady');
  assert.equal(history[0].image.id, 'pexels:rate');
  assert.equal(history[0].image.localSha256, 'rate-image-sha');
});

test('new ledgers track Story independently while legacy ledgers without Story remain readable', () => {
  const ledger = createDailyLedger('2026-07-30');
  assert.deepEqual(ledger.publications.economy.story, {
    status: 'planned', attempts: 0, externalId: null, error: null, updatedAt: null,
  });
  const legacy = structuredClone(ledger);
  delete legacy.publications.economy.story;
  delete legacy.publications.issue.story;
  assert.equal(validateLedger(legacy).ok, true);
});

test('archives completed intraday runs and includes same-day publications in hot-news history', () => {
  const {
    archivePublication,
    historyFromLedgers,
    startPublicationRun,
  } = require('../src/v2/ledger');
  let ledger = createDailyLedger('2026-07-29');
  ledger = startPublicationRun(ledger, 'economy', 'run-0900');
  ledger = updatePublication(ledger, 'economy', {
    status: 'published',
    candidate: { title: '코스피 사이드카 발동' },
    duplicateCheck: { signature: { target: '코스피', event: '사이드카 발동', text: 'economy | 코스피 | 사이드카 발동' } },
    reel: { status: 'published', attempts: 1, externalId: 'reel-1' },
  });
  ledger = archivePublication(ledger, 'economy');
  ledger = startPublicationRun(ledger, 'economy', 'run-1300');

  assert.equal(ledger.publicationHistory.length, 1);
  assert.equal(ledger.publicationHistory[0].publicationKey, 'diem:2026-07-29:economy:run-0900');
  assert.equal(ledger.publications.economy.publicationKey, 'diem:2026-07-29:economy:run-1300');
  const history = historyFromLedgers([ledger], '2026-07-29', 7, { includeReferenceDate: true });
  assert.equal(history.length, 1);
  assert.equal(history[0].publicationKey, 'diem:2026-07-29:economy:run-0900');
});

test('keeps an externally published image in reuse history even after the top-level status changes', () => {
  let ledger = createDailyLedger('2026-07-28');
  ledger = updatePublication(ledger, 'issue', {
    status: 'no_publish',
    image: { id: 'pexels:already-seen', localSha256: 'seen-sha' },
    reel: { status: 'no_publish', attempts: 1, externalId: 'deleted-reel-id' },
  });
  const history = historyFromLedgers([ledger], '2026-07-29', 7);
  assert.equal(history.length, 1);
  assert.equal(history[0].image.id, 'pexels:already-seen');
  assert.equal(history[0].signature, null);
});

test('the image and topic history window is exactly seven KST calendar dates', () => {
  const ledgers = Array.from({ length: 8 }, (_, index) => {
    const day = String(22 + index).padStart(2, '0');
    let ledger = createDailyLedger(`2026-07-${day}`);
    ledger = updatePublication(ledger, 'issue', {
      status: 'published',
      candidate: { title: `${day}일 시사 기사` },
      duplicateCheck: { signature: { target: `${day}일`, event: '발표', text: `issue | ${day}일 | 발표` } },
      image: { id: `pexels:${day}`, localSha256: `sha-${day}` },
      reel: { status: 'published', attempts: 1, externalId: `reel-${day}` },
    });
    return ledger;
  });

  const history = historyFromLedgers(ledgers, '2026-07-29', 7, { includeReferenceDate: true });
  assert.equal(history.length, 7);
  assert.equal(history.some(item => item.date === '2026-07-22'), false);
  assert.equal(history.some(item => item.date === '2026-07-23'), true);
  assert.equal(history.some(item => item.date === '2026-07-29'), true);
});
