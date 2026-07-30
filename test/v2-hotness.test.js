const assert = require('node:assert/strict');
const test = require('node:test');

const { assessHotness } = require('../src/v2/hotness');

const NOW = new Date('2026-07-29T04:00:00.000Z'); // 13:00 KST

test('accepts a fresh highly ranked article as hot', () => {
  const result = assessHotness({
    title: '한국은행 기준금리 인하 결정',
    popularityScore: 82,
    publishedAt: '2026-07-29T10:30:00+09:00',
    editorialValue: { score: 80 },
  }, { now: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.freshnessSource, 'article_published_at');
  assert.ok(result.score >= 70);
});

test('rejects an old article even when its daily rank remains high', () => {
  const result = assessHotness({
    title: '증시 주요 뉴스',
    popularityScore: 100,
    publishedAt: '2026-07-28T08:00:00+09:00',
    editorialValue: { score: 90 },
  }, { now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'article_too_old');
});

test('uses the stricter rank fallback when article time is unavailable', () => {
  const accepted = assessHotness({
    title: '청년 주거 지원 확대',
    popularityScore: 94,
    observedAt: NOW.toISOString(),
    editorialValue: { score: 70 },
  }, { now: NOW });
  const rejected = assessHotness({
    title: '청년 주거 지원 확대',
    popularityScore: 89,
    observedAt: NOW.toISOString(),
    editorialValue: { score: 70 },
  }, { now: NOW });

  assert.equal(accepted.ok, true);
  assert.equal(accepted.freshnessSource, 'ranking_observed_at');
  assert.equal(accepted.usedPublishedAtFallback, true);
  assert.equal(rejected.ok, false);
});

test('allows a fresh market emergency with the urgent threshold', () => {
  const result = assessHotness({
    title: '코스피 급락에 사이드카 발동',
    popularityScore: 55,
    publishedAt: '2026-07-29T08:30:00+09:00',
    editorialValue: { score: 55 },
  }, { now: NOW });

  assert.equal(result.ok, true);
  assert.equal(result.urgent, true);
  assert.ok(result.urgencyBonus > 0);
});

test('never treats RSS ordering as a verified hotness signal', () => {
  const result = assessHotness({
    title: '기준금리 긴급 인하',
    popularityScore: 100,
    popularitySignalReliable: false,
    publishedAt: '2026-07-29T03:00:00.000Z',
    editorialScore: 100,
  }, { now: new Date('2026-07-29T04:00:00.000Z') });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'popularity_signal_unavailable');
  assert.equal(result.popularitySignalReliable, false);
});

test('parses timezone-less Korean publisher timestamps as KST and does not promote emergency transport', () => {
  const result = assessHotness({
    title: "태국 고등학생 '귀신 분장' 응급 이송",
    summary: '16세 여학생이 복통을 호소해 구조대가 병원으로 긴급 이송했습니다.',
    popularityScore: 85.86,
    publishedAt: '2026-07-30 10:41:52',
    observedAt: '2026-07-30T10:28:23.387Z',
    editorialValue: { score: 80 },
  }, { now: new Date('2026-07-30T10:28:23.387Z') });

  assert.equal(result.freshnessSource, 'article_published_at');
  assert.ok(result.ageHours > 8 && result.ageHours < 9, `unexpected age: ${result.ageHours}`);
  assert.equal(result.urgent, false);
  assert.equal(result.urgencyBonus, 0);
});
