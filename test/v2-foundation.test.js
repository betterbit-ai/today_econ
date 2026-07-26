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
  loadLedger,
  publicationKey,
  saveLedger,
  updatePublication,
  updateStep,
} = require('../src/v2/ledger');

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
  assert.equal(classifyCandidate({ title: '증권사 임원 인사 발표' }).category, null);
  assert.equal(isSensitiveTopic({ title: '대형 화재로 인명 피해' }), true);
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
  assert.equal(validateTitleAgainstFrame('건보료 개편\n확정 아님', denialFrame).ok, true);

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

  const housing = assessDiemEditorialValue({
    title: '청년 주거 지원 월세 보조금 50만원 확대',
    summary: '정부는 전국 청년 가구의 주거 부담을 낮추기 위한 정책 확대안을 발표했습니다.',
  }, CATEGORIES.ISSUE);
  assert.equal(housing.ok, true);
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
  });
  ledger = updateStep(ledger, CATEGORIES.ECONOMY, 'reel', {
    status: 'published',
    externalId: 'ig-1',
    incrementAttempt: true,
  }, new Date('2026-07-25T09:31:00.000Z'));
  saveLedger(ledger, file);
  const loaded = loadLedger('2026-07-25', file);
  assert.equal(loaded.publications.economy.publicationKey, publicationKey('2026-07-25', 'economy'));
  assert.equal(loaded.publications.economy.reel.attempts, 1);
  assert.equal(fs.existsSync(`${file}.tmp`), false);

  const future = createDailyLedger('2026-07-26');
  const history = historyFromLedgers([loaded, future], '2026-07-26', 7);
  assert.equal(history.length, 1);
  assert.equal(history[0].audioTrackId, 'economy-steady');
});
