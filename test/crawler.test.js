const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchArticleBody, fetchArticleDocument, fetchOgImage } = require('../src/crawler');

test('rejects the publisher-wide social image as a story background', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(
    '<meta property="og:image" content="https://static.mk.co.kr/facebook_mknews.jpg">',
    { status: 200 }
  );
  try {
    assert.equal(await fetchOgImage('https://example.com/article'), null);
  } finally {
    global.fetch = originalFetch;
  }
});

test('collapses real whitespace when extracting article text', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response('<article>\n  대출\t\t규제   완화\n논의 </article>', { status: 200 });
  try {
    const text = await fetchArticleBody('https://example.com/article');
    assert.equal(text, '대출 규제 완화 논의');
  } finally {
    global.fetch = originalFetch;
  }
});

test('removes byline and Google recommendation chrome from the article body', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(`
    <article>
      <div class="reporter">류영상 기자 입력 : 2026.07.17 21:56</div>
      <div class="google-promo">구글 검색 선호 추가 알아보기 Google 검색에서 매일경제 기사를 더 자주 볼 수 있습니다.</div>
      <p>청약통장 가입자는 한 달 새 10만명 감소했다.</p>
      <p>분양가 상승으로 통장을 해지하는 가입자가 늘었다.</p>
    </article>`, { status: 200 });
  try {
    const text = await fetchArticleBody('https://example.com/article');
    assert.match(text, /청약통장 가입자/);
    assert.doesNotMatch(text, /류영상|기자 입력|Google|구글 검색|알아보기/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('preserves paragraph boundaries so adjacent facts remain separate sentences', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(`
    <article>
      <p>연금보험 신계약 건수는 전년 동기 대비 78.1% 급증했다.</p>
      <p>20대 이하 가입 증가율은 97.5%에 달했다.</p>
    </article>`, { status: 200 });
  try {
    const text = await fetchArticleBody('https://example.com/article');
    assert.match(text, /급증했다\.\s+20대/);
    assert.doesNotMatch(text, /급증했다\.20대/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('extracts the article publication timestamp with the body', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(`
    <meta property="article:published_time" content="2026-07-29T10:15:00+09:00">
    <article><p>코스피 급락으로 장중 사이드카가 발동했습니다.</p></article>
  `, { status: 200 });
  try {
    const article = await fetchArticleDocument('https://example.com/article');
    assert.equal(article.publishedAt, '2026-07-29T10:15:00+09:00');
    assert.match(article.fullText, /사이드카/);
  } finally {
    global.fetch = originalFetch;
  }
});
