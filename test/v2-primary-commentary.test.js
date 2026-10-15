const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyCandidate, buildNewsFrame, normalizeTopicAliases } = require('../src/v2/topic');

test('a matchmaker abbreviation cannot become a confirmed policy decision', () => {
  const title = '“연봉 1억인 남편 원해요”…20대 여성에 결정사 대표 일침';
  assert.doesNotMatch(normalizeTopicAliases(title), /확정/);
  assert.notEqual(buildNewsFrame({ title, summary: '결혼정보회사 대표가 일부 고객의 배우자 소득 기대를 지적했다.' }, 'economy').claimState, 'decided');
});

test('background salary statistics cannot promote relationship commentary into economy news', () => {
  const result = classifyCandidate({
    title: '“연봉 1억인 남편 원해요”…20대 여성에 결정사 대표 일침',
    summary: '결혼정보회사 대표가 일부 고객의 배우자 연봉 기대에 일침을 가했다. 국세청 근로소득과 신혼부부 대출 통계도 소개했다.',
  });
  assert.equal(result.category, null);
  assert.ok(result.excluded.includes('personal_relationship_commentary'));
});

test('real income statistics, household policy, business disputes and policy decisions remain eligible', () => {
  for (const candidate of [
    { title: '국세청 근로소득 통계, 평균 급여 발표', summary: '근로소득 신고 자료를 공개했다.' },
    { title: '정부, 신혼부부 주택 대출 지원 확대' },
    { title: '결혼정보회사 직원 임금 체불, 고용부 조사' },
  ]) assert.notEqual(classifyCandidate(candidate).category, null);
  assert.equal(buildNewsFrame({ title: '한국은행 기준금리 인하 결정' }, 'economy').claimState, 'decided');
  assert.match(normalizeTopicAliases('정부의 금리 결정사항'), /확정사항/);
});

test('company noun boundaries preserve official events and decision compounds', () => {
  for (const title of [
    '금리 결정사유 공개하라…금융위에 일침',
    '결혼정보회사 직원해고 논란, 고용부 임금체불 조사',
    '공정위, 결혼정보회사 배우자 조건 허위광고 규제 시행',
    '공정위, 결정사 배우자 조건 허위광고 조사 착수',
    '소비자원, 결혼정보회사 배우자 조건 허위광고 피해 조사',
  ]) assert.ok(!classifyCandidate({ title }).excluded.includes('personal_relationship_commentary'), title);
  const title = '결정사에 근로감독 실시, 임금체불 조사';
  assert.match(normalizeTopicAliases(title), /결혼정보회사에/);
  assert.notEqual(buildNewsFrame({ title }, 'economy').claimState, 'decided');
  assert.match(normalizeTopicAliases('금리 결정사유'), /확정사유/);
});
