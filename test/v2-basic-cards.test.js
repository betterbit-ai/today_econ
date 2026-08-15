const assert = require('node:assert/strict');
const test = require('node:test');

const {
  BASIC_CARD_HEIGHT,
  BASIC_CARD_WIDTH,
  buildBasicCardHtml,
  validateBasicLesson,
} = require('../src/v2/basic-cards');

const lesson = {
  totalDurationSeconds: 19,
  scenes: [
    { role: 'cover', durationSeconds: 3, label: '오늘의 질문', title: 'ISA는\n어떤 세금을 줄일까?', body: '절세 계좌라는데, 어떤 세금을 줄여준다는 걸까요?', claimIds: [] },
    { role: 'definition', durationSeconds: 4, label: '쉬운 정의', title: '세금은\n순이익부터 계산', body: '계좌 안 이익과 손실을 합친 뒤 남은 금액을 봐요.', claimIds: ['isa-netting'], visual: { type: 'flow', items: ['이익', '손실', '순이익'] } },
    { role: 'mechanism', durationSeconds: 5, label: '숫자로 보기', title: '비과세 한도는\n유형마다 달라요', body: '일반형은 200만원, 서민·농어민형은 400만원이에요.', claimIds: ['isa-limits'], visual: { type: 'comparison', items: ['일반형|200만원', '서민·농어민형|400만원'] } },
    { role: 'caution', durationSeconds: 4, label: '헷갈리지 않기', title: '한도를 넘으면\n전부 과세될까?', body: '초과한 순이익에만 지방세 포함 9.9%로 분리과세돼요.', claimIds: ['isa-limits'], visual: { type: 'formula', items: ['초과 순이익', '× 9.9%'] } },
    { role: 'summary', durationSeconds: 3, label: '오늘의 한 줄', title: '손익통산 뒤\n세제 혜택', body: '가입 전에는 최신 한도와 조건을 확인해 주세요.', claimIds: ['isa-netting', 'isa-freshness'] },
  ],
};

test('validates the fixed five-card educational lesson contract', () => {
  const result = validateBasicLesson(lesson, new Set(['isa-netting', 'isa-limits', 'isa-freshness']));
  assert.equal(result.ok, true, result.errors.join('; '));

  const invalid = structuredClone(lesson);
  invalid.scenes[2].claimIds = ['missing-claim'];
  invalid.scenes[4].durationSeconds = 2;
  assert.equal(validateBasicLesson(invalid, new Set(['isa-netting'])).ok, false);
});

test('rejects translated editor stage directions and formal AI cadence', () => {
  const invalid = structuredClone(lesson);
  invalid.scenes[0].body = '절세 계좌라는 말보다, 세금이 계산되는 순서를 먼저 봅니다.';
  const result = validateBasicLesson(invalid, new Set(['isa-netting', 'isa-limits', 'isa-freshness']));
  assert.equal(result.ok, false);
  assert.match(result.errors.join('; '), /translated contrast/u);
  assert.match(result.errors.join('; '), /editor stage direction/u);
  assert.match(result.errors.join('; '), /해요체/u);
});

test('renders a recognizably educational card rather than a news cover', () => {
  const html = buildBasicCardHtml({
    item: { id: 'isa-tax', sequence: 1, series: 'DIEM Basic' },
    scene: lesson.scenes[1],
    sceneIndex: 1,
  });

  assert.match(html, new RegExp(`width:${BASIC_CARD_WIDTH}px; height:${BASIC_CARD_HEIGHT}px`, 'u'));
  assert.match(html, /DIEM BASIC/u);
  assert.match(html, /경제기초 01/u);
  assert.match(html, /02 \/ 05/u);
  assert.match(html, /#f5f0e6/iu);
  assert.match(html, /#315efb/iu);
  assert.match(html, /#24c68b/iu);
  assert.match(html, /data-basic-layout="flow"/u);
  assert.doesNotMatch(html, /Economy|Issue|2026\./u);
  assert.doesNotMatch(html, /background-photo|<img/u);
});
