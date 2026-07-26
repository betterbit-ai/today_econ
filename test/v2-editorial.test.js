const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORIES } = require('../src/v2/constants');
const {
  DEFAULT_MODELS,
  buildDeterministicEditorial,
  generateEditorial,
  validateEditorial,
} = require('../src/v2/editorial');
const {
  graphemeCount,
  validateCaption,
  validateHashtagReply,
  validateTitle,
} = require('../src/v2/text');

function economyArticle() {
  return {
    category: CATEGORIES.ECONOMY,
    title: '한국은행, 기준금리 0.25%포인트 인하 확정',
    summary: '한국은행이 물가 둔화를 고려해 금리를 낮췄습니다.',
    verifiedFacts: [
      '한국은행은 기준금리를 0.25%포인트 인하했습니다.',
      '새 기준금리는 다음 달부터 적용됩니다.',
    ],
    context: '한국은행은 물가 둔화를 인하 배경으로 설명했습니다.',
    entities: ['한국은행', '기준금리'],
    target: '기준금리',
    event: '0.25%포인트 인하',
  };
}

function officialDenialArticle() {
  return {
    category: CATEGORIES.ISSUE,
    title: '보건복지부, “건강보험료 상하한선 기준 개선 확정되지 않아”',
    summary: '보건복지부는 건강보험료의 상한선과 하한선을 동시에 높이는 부과 체계 개편을 추진한다는 보도와 관련해 확정된 바 없다고 밝혔습니다.',
    fullText: '보건복지부는 건강보험료의 상한선과 하한선을 동시에 높이는 부과 체계 개편을 추진한다는 보도와 관련해 확정된 바 없다고 밝혔습니다. 연합뉴스는 상위 0.01% 초고소득자의 건보료 상한 기준을 인상하는 내용을 보도했습니다. 보건복지부는 설명자료를 내고 연합뉴스 기사에서 언급된 내용은 확정된 바 없다고 밝혔습니다.',
    entities: ['보건복지부', '건강보험료'],
    target: '건강보험료 상하한선',
    event: '확정되지 않아',
  };
}

function ipoArticle() {
  return {
    category: CATEGORIES.ECONOMY,
    title: 'CXMT, 내일 중국 증시 데뷔…올해 아시아 증시 최대 IPO',
    summary: '중국 창신메모리테크놀로지(CXMT)가 27일 과창판에서 첫 거래에 나서며 중국 본토 증시에 데뷔합니다.',
    fullText: '삼성전자와 SK하이닉스, 미국 마이크론이 과점하는 글로벌 D램 반도체 시장에 도전하고 있는 중국 창신메모리테크놀로지(CXMT)가 27일 과창판에서 첫 거래에 나서며 중국 본토 증시에 데뷔합니다. CXMT는 기업공개(IPO)를 통해 공모가 8.66위안에 신주 66억8천800만주를 발행해 579억2천만 위안을 조달했습니다. 이는 올해 아시아 증시 최대 IPO입니다.',
    entities: ['CXMT', 'IPO'],
    target: 'CXMT',
    event: 'IPO 상장',
  };
}

test('deterministic fallback produces five short titles and the exact DIEM caption contract', () => {
  const editorial = buildDeterministicEditorial(economyArticle());

  assert.ok(editorial.titleCandidates.length >= 1);
  assert.equal(new Set(editorial.titleCandidates.map(candidate => candidate.title)).size, editorial.titleCandidates.length);
  editorial.titleCandidates.forEach(candidate => {
    const validation = validateTitle(candidate.title);
    assert.equal(validation.ok, true, validation.errors.join('; '));
    assert.equal(validation.lines.length, 2);
    assert.ok(validation.graphemeCount <= 24);
  });

  const caption = validateCaption(editorial.caption.text);
  assert.equal(caption.ok, true, caption.errors.join('; '));
  assert.equal(editorial.caption.sentences.length, 3);
  assert.equal(editorial.caption.text, editorial.caption.sentences.join('\n\n'));
  editorial.caption.sentences.forEach(sentence => assert.ok(graphemeCount(sentence) <= 300));
  assert.equal(editorial.comments.first, editorial.emojis.first);

  const reply = validateHashtagReply(editorial.comments.reply);
  assert.equal(reply.ok, true, reply.errors.join('; '));
  assert.ok(reply.hashtags.length >= 12 && reply.hashtags.length <= 15);
  assert.equal(new Set(reply.hashtags).size, reply.hashtags.length);
  assert.deepEqual(editorial.comments.hashtagsByRole.brand, [
    '#diem',
    '#diemmagazine',
    '#데일리이슈앤이코노미',
  ]);
  assert.equal(validateEditorial(editorial, { article: economyArticle() }).ok, true);
});

test('normalizes decomposed Korean and keeps emojis only at sentence one and three endings', () => {
  const article = economyArticle();
  article.verifiedFacts = article.verifiedFacts.map(value => value.normalize('NFD'));
  article.context = article.context.normalize('NFD');
  const editorial = buildDeterministicEditorial(article);

  assert.equal(editorial.caption.text, editorial.caption.text.normalize('NFC'));
  assert.match(editorial.caption.sentences[0], /🏦$/u);
  assert.doesNotMatch(editorial.caption.sentences[1], /\p{Extended_Pictographic}/u);
  assert.match(editorial.caption.sentences[2], /📊$/u);
  assert.equal(editorial.comments.first, '🏦');
});

test('sensitive current-affairs stories use the neutral news emoji', () => {
  const editorial = buildDeterministicEditorial({
    category: CATEGORIES.ISSUE,
    title: '정부가 산불 피해 지원 대책을 확정했다',
    verifiedFacts: [
      '정부는 산불 피해 지역 지원 대책을 확정했습니다.',
      '지원 신청은 다음 주부터 시작됩니다.',
    ],
    context: '정부는 피해 복구 상황을 매일 점검한다고 밝혔습니다.',
    entities: ['정부', '산불피해'],
    target: '피해지원',
    event: '대책 확정',
  });

  assert.deepEqual(editorial.emojis, { first: '📰', third: '📰' });
  assert.equal(editorial.comments.first, '📰');
});

test('uses the fallback model after an invalid primary response', async () => {
  const calls = [];
  const result = await generateEditorial(economyArticle(), {
    callModel: async ({ model }) => {
      calls.push(model);
      if (model === DEFAULT_MODELS.primary) return { titleCandidates: [], sentences: [] };
      return {
        titleCandidates: [
          { title: '기준금리\n0.25%' },
          { title: '금리인하\n오늘확정' },
          { title: '한국은행\n금리인하' },
          { title: '0.25%\n금리인하' },
          { title: '기준금리\n인하확정' },
        ],
        selectedTitleIndex: 1,
        sentences: economyArticle().verifiedFacts.concat(economyArticle().context),
        topicTags: ['한국은행', '기준금리', '금리인하', '통화정책'],
      };
    },
  });

  assert.deepEqual(calls, [DEFAULT_MODELS.primary, DEFAULT_MODELS.fallback]);
  assert.equal(result.generation.method, 'model');
  assert.equal(result.generation.model, DEFAULT_MODELS.fallback);
  assert.equal(result.title.selectedIndex, 1);
  assert.equal(result.generation.attempts[0].status, 'failed');
  assert.equal(result.generation.attempts[1].status, 'succeeded');
});

test('rejects official-denial titles that invert the article state', async () => {
  const article = officialDenialArticle();
  const result = await generateEditorial(article, {
    callModel: async () => ({
      titleCandidates: [
        { title: '보건복지부\n0.01% 확정' },
      ],
      sentences: [
        '보건복지부는 건강보험료 상하한선 개편 보도와 관련해 확정된 바 없다고 밝혔습니다.',
        '연합뉴스는 상위 0.01% 초고소득자의 건보료 상한 기준 인상 내용을 보도했습니다.',
        '복지부는 설명자료를 통해 기사에서 언급된 내용은 확정된 바 없다고 밝혔습니다.',
      ],
    }),
  });

  assert.equal(result.generation.method, 'deterministic_fallback');
  assert.match(result.title.text, /(확정 아님|미확정|반박)/u);
  assert.doesNotMatch(result.title.text, /0\.01%\s*확정/u);
});

test('rejects acronym-date IPO titles that omit the actual listing event', async () => {
  const article = ipoArticle();
  const result = await generateEditorial(article, {
    callModel: async ({ model }) => {
      if (model === DEFAULT_MODELS.primary) {
        return {
          titleCandidates: [
            { title: 'CXMT 내일\n27일' },
          ],
          sentences: [
            'CXMT가 27일 중국 과창판에서 첫 거래에 나서며 본토 증시에 데뷔합니다.',
            '이번 IPO 공모가는 8.66위안이며 약 579억2천만 위안을 조달했습니다.',
            '삼성전자·SK하이닉스가 있는 D램 시장에서 중국 메모리 기업의 자금 조달이 주목받고 있습니다.',
          ],
        };
      }
      return {
        titleCandidates: [
          { title: 'CXMT IPO\n27일 상장' },
        ],
        selectedTitleIndex: 0,
        sentences: [
          'CXMT가 27일 중국 과창판에서 첫 거래에 나서며 본토 증시에 데뷔합니다.',
          '이번 IPO 공모가는 8.66위안이며 약 579억2천만 위안을 조달했습니다.',
          '삼성전자·SK하이닉스가 있는 D램 시장에서 중국 메모리 기업의 자금 조달이 주목받고 있습니다.',
        ],
      };
    },
  });

  assert.equal(result.generation.method, 'model');
  assert.equal(result.generation.model, DEFAULT_MODELS.fallback);
  assert.equal(result.title.text, 'CXMT IPO\n27일 상장');
});

test('falls back deterministically when both model calls fail or invent a number', async () => {
  const calls = [];
  const editorial = await generateEditorial(economyArticle(), {
    callModel: async ({ model }) => {
      calls.push(model);
      if (model === DEFAULT_MODELS.primary) throw new Error('429 free tier limit');
      return {
        titleCandidates: [
          '기준금리\n0.25%',
          '금리인하\n오늘확정',
          '한국은행\n금리인하',
          '0.25%\n금리인하',
          '기준금리\n인하확정',
        ],
        sentences: [
          '한국은행이 기준금리를 9.9% 인하했습니다.',
          '새 기준금리는 다음 달부터 적용됩니다.',
          '한국은행은 물가 둔화를 배경으로 설명했습니다.',
        ],
      };
    },
  });

  assert.deepEqual(calls, [DEFAULT_MODELS.primary, DEFAULT_MODELS.fallback]);
  assert.equal(editorial.generation.method, 'deterministic_fallback');
  assert.equal(editorial.generation.attempts.length, 2);
  assert.doesNotMatch(editorial.caption.text, /9\.9%/u);
});

test('rejects malformed title, caption, comment, and hashtag reply contracts', () => {
  assert.equal(validateTitle('한 줄뿐').ok, false);
  assert.equal(validateTitle('일이삼사오육칠팔\n구십일이삼사오육').ok, true);
  assert.equal(validateTitle('일이삼사오육칠팔구십일이삼사\n오육칠팔구십일이삼사오육칠팔').ok, false);
  assert.equal(validateCaption('첫 문장📊\n둘째 문장\n셋째 문장📊').ok, false);
  assert.equal(validateCaption(`첫 문장📊\n\n${'가'.repeat(301)}\n\n셋째 문장📊`).ok, false);
  assert.equal(validateHashtagReply('@diem.magazine #경제 #경제').ok, false);

  const editorial = buildDeterministicEditorial(economyArticle());
  editorial.comments.first = `${editorial.comments.first} 설명`;
  const report = validateEditorial(editorial, { article: economyArticle() });
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /first comment/u);
});
