const test = require('node:test');
const assert = require('node:assert/strict');
const { assessDiemEditorialValue, buildNewsFrame } = require('../src/v2/topic');
const { assessDailyFloor } = require('../src/v2/hotness');

const CRASH_SENTENCE = '코스피가 전일 대비 8% 넘게 폭락 중이다.';
function marketCandidate(overrides = {}) {
  return {
    title: '“물타기할 돈도 없다” 개미 패닉…7일새 시총 1170조 사라졌다',
    summary: `${CRASH_SENTENCE} 코스피와 코스닥 양대 시장에 서킷브레이커가 발동됐다. 주요 증권 커뮤니티에도 손실을 호소하는 반응이 나왔다.`,
    popularityScore: 98,
    publishedAt: '2026-10-15T05:00:00Z',
    ...overrides,
  };
}

test('observed broad-market crash retains its source span and passes the unchanged daily floor', () => {
  const candidate = marketCandidate();
  const value = assessDiemEditorialValue(candidate, 'economy');
  assert.equal(value.score, 95);
  assert.equal(value.ok, true);
  assert.equal(value.frame.claimState, 'reported');
  assert.equal(value.observedMarketEvidence.sourceSpan, CRASH_SENTENCE);
  assert.ok(value.signals.includes('incidental_reaction_not_primary'));
  assert.equal(value.signals.filter(signal => signal === 'reader_money_work_life_impact').length, 1);
  assert.equal(value.signals.filter(signal => signal === 'concrete_event_or_decision').length, 1);
  assert.equal(assessDailyFloor({ ...candidate, editorialValue: value }, { now: new Date('2026-10-15T06:00:00Z') }).ok, true);
});

test('actual index point changes and actual trading interruptions are concrete observations', () => {
  for (const summary of [
    '코스피는 전일 대비 484.3포인트 하락했다.',
    '코스피와 코스닥 양대 시장에 서킷브레이커가 발동됐다.',
    '코스닥 시장에 사이드카가 발동했다.',
  ]) {
    const value = assessDiemEditorialValue(marketCandidate({ title: '국내 증시 급락', summary }), 'economy');
    assert.equal(value.observedMarketEvidence.sourceSpan, summary);
    assert.ok(value.signals.includes('concrete_event_or_decision'));
    assert.equal(value.frame.claimState, 'reported');
  }
});

test('single-stock and speculative headlines cannot borrow actual market figures from the body', () => {
  for (const title of [
    '삼성전자 주가 8% 급락',
    '코스피 8% 급락 전망',
    '코스피 8% 급락 가능성',
    '코스피 8% 급락을 가정한 분석',
    '코스피 급락 때 종목 추천',
    '코스피 급락 루머 확산',
    '코스피 급락 소문 확산',
    '코스피가 8% 급락할 수도 있다',
    '코스피가 8% 급락할 것이란 우려',
  ]) {
    const value = assessDiemEditorialValue(marketCandidate({ title }), 'economy');
    assert.equal(value.observedMarketEvidence, null, title);
    assert.ok(value.penalties.includes('low_signal_click_story'), title);
    assert.ok(!value.signals.includes('incidental_reaction_not_primary'), title);
  }
});

test('a single source sentence must establish an actual broad-index event within the lead', () => {
  for (const summary of [
    '코스피가 8% 폭락할 가능성이 있다.',
    '코스피가 8% 폭락한다면 충격이 예상된다.',
    '코스피에 서킷브레이커 발동 가능성이 있다.',
    '코스피는 약세다. 삼성전자 주가가 8% 하락했다.',
    '코스피는 보합, 삼성전자는 8% 급락했다.',
    '코스피는 보합인 가운데 삼성전자는 8% 급락했다.',
    '코스피가 8% 급락할 수도 있다.',
    '코스피가 8% 급락할 것이란 우려가 나온다.',
    '코스피는 보합이지만 삼성전자 주가는 8% 급락했다.',
    '코스피가 8% 급락했다는 누리꾼의 글이 온라인 커뮤니티에서 확산됐다.',
    '코스피가 8% 급락했다는 글이 SNS에서 퍼졌다.',
    '코스피가 8% 급락했다고 전했다.',
    '코스피가 8% 급락했다며 게시글이 공유됐다.',
    `${'시장 상황을 살펴봤다. '.repeat(100)}${CRASH_SENTENCE}`,
  ]) {
    const value = assessDiemEditorialValue(marketCandidate({ title: '국내 증시 급락 경계', summary }), 'economy');
    assert.equal(value.observedMarketEvidence, null, summary);
  }
});

test('headline community reactions retain the low-signal penalty despite an observed market event', () => {
  const value = assessDiemEditorialValue(marketCandidate({ title: '코스피 8% 급락에 커뮤니티 화제' }), 'economy');
  assert.ok(value.observedMarketEvidence);
  assert.ok(value.penalties.includes('low_signal_click_story'));
  assert.ok(!value.signals.includes('incidental_reaction_not_primary'));
});

test('negated market moves and interruptions are not observed events', () => {
  for (const summary of [
    '코스피가 8% 폭락하지 않았다.',
    '코스피 8% 급락은 사실이 아니다.',
    '코스피 8% 급락은 없었다.',
    '코스피와 코스닥 시장에 서킷브레이커가 발동되지 않았다.',
  ]) {
    const value = assessDiemEditorialValue(marketCandidate({ title: '국내 증시 급락 보도 확인', summary }), 'economy');
    assert.equal(value.observedMarketEvidence, null, summary);
  }
});

test('relationship commentary and inconsistent frames cannot gain observed-market value', () => {
  const candidate = marketCandidate({ title: '연봉 1억인 남편 원해요…결정사 대표 일침' });
  const frame = { ...buildNewsFrame(candidate, 'economy'), eventKind: 'market_move', readerNeed: 'public_interest' };
  const value = assessDiemEditorialValue(candidate, 'economy', frame);
  assert.equal(value.observedMarketEvidence, null);
  assert.equal(value.ok, false);
  assert.ok(value.penalties.includes('inconsistent_reader_need_event_kind'));
  assert.equal(assessDiemEditorialValue(marketCandidate(), 'issue').observedMarketEvidence, null);
});
