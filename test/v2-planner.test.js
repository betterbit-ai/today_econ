const assert = require('node:assert/strict');
const test = require('node:test');

const { planDailyQueue, rssCandidates } = require('../src/v2/planner');

function articleBody(kind, secondary = false) {
  if (/금리/.test(kind)) {
    return secondary
      ? '7월 25일 열린 통화정책 회의에서 한국은행은 기준금리를 연 2.50%로 유지했다. 최근 물가와 가계대출 증가세를 함께 살핀 결정이며 다음 회의에서도 관련 지표를 확인한다.'
      : '한국은행은 7월 25일 기준금리를 2.50%로 동결했다. 물가와 가계대출 흐름을 더 확인할 필요가 있다고 밝혔으며 다음 회의 전까지 새 경제 지표를 점검한다.';
  }
  return secondary
    ? '7월 25일 정부가 청년 가구의 주거 부담을 낮추기 위한 지원 정책 확대안을 발표했다. 대상 기준과 신청 절차는 다음 달 확정하며 관계 부처가 세부 내용을 공개한다.'
    : '정부는 7월 25일 청년 주거 지원 정책을 확대한다고 발표했다. 지원 대상과 시행 기준은 다음 달 확정되며 관계 부처가 세부 신청 조건을 추가로 안내한다.';
}

test('plans one independently verified candidate per category without AI reranking', async () => {
  const sources = {
    economy: [
      { portal: 'naver', rank: 1, normalizedScore: 100, title: '한국은행 기준금리 2.50% 동결', url: 'https://a.example/economy' },
      { portal: 'daum', rank: 2, normalizedScore: 90, title: '한국은행 기준금리 2.50% 동결 결정', url: 'https://b.example/economy' },
    ],
    issue: [
      { portal: 'naver', rank: 3, normalizedScore: 80, title: '청년 주거 지원 정책 확대', url: 'https://a.example/issue' },
      { portal: 'daum', rank: 4, normalizedScore: 70, title: '청년 주거 정책 지원 확대 발표', url: 'https://b.example/issue' },
    ],
  };
  const candidates = [
    { title: sources.economy[0].title, url: sources.economy[0].url, popularityScore: 105, crossPortal: true, sources: sources.economy },
    { title: sources.issue[0].title, url: sources.issue[0].url, popularityScore: 85, crossPortal: true, sources: sources.issue },
  ];
  const result = await planDailyQueue({
    date: '2026-07-25',
    fetchPortalRankingsImpl: async () => ({ candidates, allFailed: false, errors: {} }),
    fetchArticleBodyImpl: async url => articleBody(url.includes('economy') ? '금리' : '주거', url.includes('b.example')),
    embedder: async () => [],
  });
  assert.equal(result.publications.economy.ok, true);
  assert.equal(result.publications.issue.ok, true);
  assert.equal(result.publications.economy.selected.url, 'https://a.example/economy');
  assert.equal(result.publications.issue.selected.url, 'https://a.example/issue');
});

test('marks only the exhausted category no_publish', async () => {
  const candidates = [{
    title: '한국은행 기준금리 2.50% 동결',
    url: 'https://a.example/economy',
    popularityScore: 100,
    sources: [
      { portal: 'naver', normalizedScore: 100, title: '한국은행 기준금리 2.50% 동결', url: 'https://a.example/economy' },
      { portal: 'daum', normalizedScore: 90, title: '기준금리 2.50% 동결', url: 'https://b.example/economy' },
    ],
  }];
  const result = await planDailyQueue({
    date: '2026-07-25',
    fetchPortalRankingsImpl: async () => ({ candidates, allFailed: false, errors: {} }),
    fetchArticleBodyImpl: async url => articleBody('금리', url.includes('b.example')),
    embedder: async () => [],
  });
  assert.equal(result.publications.economy.ok, true);
  assert.equal(result.publications.issue.status, 'no_publish');
});

test('uses the legacy RSS order only when both portals fail', async () => {
  const fallback = rssCandidates([
    { title: '첫 기사', link: 'https://rss.example/1', summary: '요약' },
    { title: '둘째 기사', link: 'https://rss.example/2', summary: '요약' },
  ], '2026-07-25');
  assert.equal(fallback[0].popularityScore, 100);
  assert.equal(fallback[1].popularityScore, 1);

  const result = await planDailyQueue({
    date: '2026-07-25',
    fetchPortalRankingsImpl: async () => ({ candidates: [], allFailed: true, errors: { naver: 'down', daum: 'down' } }),
    fetchNewsImpl: async () => [],
  });
  assert.equal(result.popularityFallback.used, true);
  assert.equal(result.publications.economy.status, 'no_publish');
  assert.equal(result.publications.issue.status, 'no_publish');
});

test('allows standalone Naver ranking candidates to pass when independent corroboration is absent', async () => {
  const candidates = [
    { title: '한국은행 기준금리 2.50% 동결 확정', url: 'https://n.news.naver.com/article/009/0000001', popularityScore: 100, crossPortal: false, sources: [{ portal: 'naver', title: '한국은행 기준금리 2.50% 동결 확정', url: 'https://n.news.naver.com/article/009/0000001' }] },
    { title: '청년 주거 지원 월세 보조금 50만원 확대', url: 'https://n.news.naver.com/article/009/0000002', popularityScore: 90, crossPortal: false, sources: [{ portal: 'naver', title: '청년 주거 지원 월세 보조금 50만원 확대', url: 'https://n.news.naver.com/article/009/0000002' }] },
  ];
  const result = await planDailyQueue({
    date: '2026-07-25',
    fetchPortalRankingsImpl: async () => ({ candidates, allFailed: false, errors: {} }),
    fetchArticleBodyImpl: async url => (url.endsWith('0000001')
      ? articleBody('금리')
      : articleBody('주거')),
    embedder: async () => [],
  });
  assert.equal(result.publications.economy.ok, true);
  assert.equal(result.publications.economy.corroboration, null);
  assert.equal(result.publications.issue.ok, true);
  assert.equal(result.publications.issue.corroboration, null);
});

test('skips official-denial and narrow issue candidates before selecting a useful issue', async () => {
  const candidates = [
    {
      title: '보건복지부, 건강보험료 상하한선 기준 개선 확정되지 않아',
      url: 'https://n.news.naver.com/article/001/denial',
      popularityScore: 100,
      sources: [{ portal: 'naver', title: '보건복지부, 건강보험료 상하한선 기준 개선 확정되지 않아', url: 'https://n.news.naver.com/article/001/denial' }],
    },
    {
      title: '과수원 꽃눈에 천연 패딩…이상기후 냉해 막는 이 기술',
      url: 'https://n.news.naver.com/article/001/climate',
      popularityScore: 95,
      sources: [{ portal: 'naver', title: '과수원 꽃눈에 천연 패딩…이상기후 냉해 막는 이 기술', url: 'https://n.news.naver.com/article/001/climate' }],
    },
    {
      title: '청년 주거 지원 월세 보조금 50만원 확대',
      url: 'https://n.news.naver.com/article/001/housing',
      popularityScore: 90,
      sources: [{ portal: 'naver', title: '청년 주거 지원 월세 보조금 50만원 확대', url: 'https://n.news.naver.com/article/001/housing' }],
    },
  ];
  const bodies = {
    denial: '보건복지부는 건강보험료 상하한선 개편 보도와 관련해 확정된 바 없다고 설명자료를 냈습니다. 연합뉴스 보도에서 언급된 내용은 확정된 바 없으며 향후 건강보험정책심의위원회에서 논의될 수 있다고 밝혔습니다.',
    climate: '농가가 이상기후에 따른 과수원 꽃눈 냉해를 막기 위해 천연 패딩 기술을 시험했습니다. 과수원과 작물 재배 현장에서 활용되는 기술이며 전국 정책이나 생활비 변화는 발표되지 않았습니다.',
    housing: '정부는 전국 청년 가구의 주거 부담을 낮추기 위해 월세 보조금 지원을 50만원까지 확대한다고 발표했습니다. 지원 대상과 신청 절차는 다음 달 확정되며 청년 주거 정책의 핵심 대책으로 추진됩니다.',
  };
  const result = await planDailyQueue({
    date: '2026-07-25',
    fetchPortalRankingsImpl: async () => ({ candidates, allFailed: false, errors: {} }),
    fetchArticleBodyImpl: async url => bodies[url.split('/').at(-1)],
    embedder: async () => [],
  });

  assert.equal(result.publications.issue.ok, true);
  assert.equal(result.publications.issue.selected.url, 'https://n.news.naver.com/article/001/housing');
  assert.ok(result.candidates[0].rejectionReasons.some(reason => reason.includes('low_editorial_value:official_denial_without_confirmed_change')));
  assert.ok(result.candidates[1].rejectionReasons.some(reason => reason.includes('low_editorial_value:narrow_or_local_issue')));
  assert.equal(result.publications.issue.selected.editorialValue.ok, true);
});

test('reclassifies hydrated article text before accepting an economy candidate', async () => {
  const candidates = [
    {
      title: '"내 얼굴·목소리 원본, 동의 없이 수집·활용" 피지컬AI 특별법 논란',
      url: 'https://n.news.naver.com/article/001/privacy-ai',
      popularityScore: 100,
      sources: [{
        portal: 'naver',
        title: '"내 얼굴·목소리 원본, 동의 없이 수집·활용" 피지컬AI 특별법 논란',
        url: 'https://n.news.naver.com/article/001/privacy-ai',
      }],
    },
    {
      title: '한국은행 기준금리 2.50% 동결',
      url: 'https://n.news.naver.com/article/001/rate',
      popularityScore: 90,
      sources: [{
        portal: 'naver',
        title: '한국은행 기준금리 2.50% 동결',
        url: 'https://n.news.naver.com/article/001/rate',
      }],
    },
  ];
  const bodies = {
    'privacy-ai': '국회에서 피지컬AI 특별법안이 논의되며 개인정보 원본을 정보주체 동의 없이 활용할 수 있다는 우려가 나왔습니다. 노동계와 정보인권단체는 얼굴과 목소리 원본 활용이 기본권 침해로 이어질 수 있다고 비판했습니다.',
    rate: articleBody('금리'),
  };
  const result = await planDailyQueue({
    date: '2026-07-26',
    fetchPortalRankingsImpl: async () => ({ candidates, allFailed: false, errors: {} }),
    fetchArticleBodyImpl: async url => bodies[url.split('/').at(-1)],
    embedder: async () => [],
  });

  assert.equal(result.publications.economy.ok, true);
  assert.equal(result.publications.economy.selected.url, 'https://n.news.naver.com/article/001/rate');
  assert.ok(result.candidates[0].rejectionReasons.some(reason => /economy:(assigned_to_issue|low_editorial_value)/u.test(reason)));
});
