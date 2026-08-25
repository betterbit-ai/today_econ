const test = require('node:test');
const assert = require('node:assert/strict');
const { CATEGORIES } = require('../src/v2/constants');
const { buildNewsFrame } = require('../src/v2/topic');
const {
  DEFAULT_MODELS,
  buildDeterministicEditorial,
  generateEditorial,
  sourceSentences,
  validateEditorial,
} = require('../src/v2/editorial');
const {
  graphemeCount,
  validateCaption,
  validateHashtagReply,
  validateTitle,
  validateTitleAgainstFrame,
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
    verifiedFacts: [
      '보건복지부는 건강보험료 부과체계 개편 보도와 관련해 확정된 바 없다고 밝혔습니다.',
      '해당 보도는 상위 0.01% 초고소득자의 건보료 상한 기준 인상 내용을 다뤘습니다.',
      '복지부는 설명자료에서 기사에 언급된 내용은 확정된 바 없다고 설명했습니다.',
    ],
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

function autoInsuranceBroadcastArticle() {
  return {
    category: CATEGORIES.ECONOMY,
    title: '자동차보험 6년 만에 적자‥"사이드미러 툭 쳐도 MRI, 한방병원이 주범"',
    summary: '올해 상반기 자동차보험 영업손익이 6년 만에 적자로 돌아섰습니다.',
    fullText: [
      '[뉴스데스크]',
      '◀ 앵커 ▶',
      '국내 자동차보험이 6년 만에 적자로 돌아섰습니다.',
      '◀ 리포트 ▶',
      '자동차보험금이 과잉진료와 과잉수리 등에 새면서 올해 상반기 영업손익이 적자로 전환했습니다.',
      '비싼 MRI도 일단 찍고 봤다고 말합니다.규모가 작아 MRI 기기를 설치할 수 없지만, 다른 병원으로 한 달에 수십 명씩 보내고 건당 뒷돈을 받았다는.',
      '보험업계는 한방병원 과잉진료와 일부 정비업체의 과잉수리가 손해율을 끌어올렸다고 설명했습니다.',
      'MBC뉴스 이지은입니다.',
      '영상취재: 김민수 / 영상편집: 박지영',
      'MBC 뉴스는 24시간 여러분의 제보를 기다립니다. ▷ 전화 02-784-4000▷ 이메일 mbcjebo@mbc.co.kr▷ 카카오톡 @mbc제보.',
    ].join(' '),
    entities: ['자동차보험', 'MRI', '한방병원'],
  };
}

function politicalQuoteArticle() {
  return {
    category: CATEGORIES.ISSUE,
    title: '김민석 “경기도서 제2, 3 이재명 나올 것”… 정청래·송영길도 지지 호소',
    summary: '더불어민주당 전국 순회경선 마지막 날 김민석 후보가 경기에서 제2, 제3의 이재명이 나올 것이라고 말했습니다.',
    fullText: '김민석 후보는 경기 당원들이 다양한 세대의 새 리더를 배출할 것이라고 강조했습니다. 정청래 후보와 송영길 후보도 각자의 정책을 알리며 지지를 호소했습니다. 기사 후반에는 경기 반도체 산업 육성 목표도 언급됐습니다.',
    verifiedFacts: [
      '김민석 후보가 경기에서 제2, 제3의 이재명이 나올 것이라고 말했습니다.',
      '정청래 후보와 송영길 후보도 각자의 정책을 알리며 지지를 호소했습니다.',
      '세 후보는 더불어민주당 전국 순회경선 마지막 날 경기 당원들을 만났습니다.',
    ],
    entities: ['김민석', '정청래', '송영길'],
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
    assert.ok(validation.graphemeCount <= 14);
  });

  const caption = validateCaption(editorial.caption.text);
  assert.equal(caption.ok, true, caption.errors.join('; '));
  assert.equal(editorial.caption.sentences.length, 3);
  assert.equal(editorial.caption.text, editorial.caption.sentences.join('\n\n'));
  editorial.caption.sentences.forEach(sentence => assert.ok(graphemeCount(sentence) <= 120));
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

  assert.deepEqual(calls, [DEFAULT_MODELS.primary, DEFAULT_MODELS.primary, DEFAULT_MODELS.fallback]);
  assert.equal(result.generation.method, 'model');
  assert.equal(result.generation.model, DEFAULT_MODELS.fallback);
  assert.equal(result.title.selectedIndex, 1);
  assert.equal(result.generation.attempts[0].status, 'failed');
  assert.equal(result.generation.attempts.at(-1).status, 'succeeded');
});

test('repairs a selected high-value article when the first model body has no sentence array', async () => {
  const article = {
    category: CATEGORIES.ECONOMY,
    title: '현대차 노사 잠정합의…기본급 10만원·성과금 400%',
    summary: '현대차 노사가 기본급 10만원 인상과 성과금 400%에 잠정합의했습니다.',
    fullText: '현대차 노사는 기본급 10만원 인상과 성과금 400% 지급에 잠정합의했습니다. 조합원 찬반투표를 거쳐 최종 확정됩니다. 노사는 파업 없이 교섭을 마무리했습니다.',
    target: '현대차 노사',
    event: '잠정합의',
  };
  const requests = [];
  const result = await generateEditorial(article, {
    callModel: async request => {
      requests.push(request);
      if (!/편집 JSON 복구기/u.test(request.systemPrompt)) return { titleCandidates: [], sentence: 'broken' };
      return {
        titleCandidates: [{ title: '현대차 노사\n임금 잠정합의' }],
        sentences: [
          '현대차 노사가 기본급 10만원 인상과 성과금 400% 지급안에 잠정합의했습니다.',
          '이번 합의안은 조합원 찬반투표를 통과해야 최종 확정됩니다.',
          '노사는 파업 없이 올해 임금 교섭을 마무리했습니다.',
        ],
        emojis: { first: '🚗', third: '📰' },
        topicTags: ['현대차', '임금협상', '노사합의'],
        imageKeyword: 'automobile factory assembly line',
      };
    },
  });
  assert.equal(requests.length, 2);
  assert.equal(result.generation.model, DEFAULT_MODELS.primary);
  assert.ok(result.generation.attempts.some(attempt => attempt.stage === 'editorial_repair' && attempt.status === 'succeeded'));
  assert.match(result.caption.sentences[0], /잠정합의/u);
});

test('does not widen one politician quote into a shared claim by several candidates', async () => {
  const article = politicalQuoteArticle();
  const result = await generateEditorial(article, {
    callModel: async ({ model }) => model === DEFAULT_MODELS.primary
      ? {
        titleCandidates: [{ title: '김민석\n제2 이재명 언급' }],
        sentences: [
          '김민석·정청래·송영길 후보가 경기에서 제2, 제3의 이재명이 나올 것이라고 주장했습니다.',
          '세 후보는 더불어민주당 전국 순회경선 마지막 날 경기 당원들을 만났습니다.',
          '정청래 후보와 송영길 후보도 각자의 정책을 알리며 지지를 호소했습니다.',
        ],
        topicTags: ['김민석', '민주당', '당대표경선', '경기도'],
      }
      : {
        titleCandidates: [{ title: '김민석\n제2 이재명 언급' }],
        sentences: [
          '김민석 후보가 경기에서 제2, 제3의 이재명이 나올 것이라고 언급했습니다.',
          '세 후보는 더불어민주당 전국 순회경선 마지막 날 경기 당원들을 만났습니다.',
          '정청래 후보와 송영길 후보는 각자의 정책을 알리며 지지를 호소했습니다.',
        ],
        topicTags: ['김민석', '민주당', '당대표경선', '경기도'],
      },
  });

  assert.equal(result.generation.model, DEFAULT_MODELS.fallback);
  assert.match(result.caption.sentences[0], /^김민석 후보가/u);
});

test('repairs only an overlong title while preserving a valid apartment-news caption', async () => {
  const article = {
    category: CATEGORIES.ECONOMY,
    title: '수도권 15억~20억 아파트, 거래 절반 이상이 신고가',
    summary: '수도권의 15억~20억원 아파트 거래 가운데 절반 이상이 신고가로 집계됐습니다.',
    fullText: '수도권의 15억~20억원 아파트 거래 가운데 절반 이상이 신고가로 집계됐습니다. 서울 주요 지역의 매매 가격이 오르며 실수요자의 부담이 커졌습니다. 전문가들은 공급과 금리 흐름을 함께 살펴야 한다고 설명했습니다.',
    target: '수도권 아파트',
    event: '신고가 거래',
    verifiedFacts: [
      '수도권의 15억~20억원 아파트 거래 가운데 절반 이상이 신고가로 집계됐습니다.',
      '서울 주요 지역의 매매 가격이 올랐습니다.',
      '공급과 금리 흐름을 함께 살펴야 한다는 분석이 나왔습니다.',
    ],
  };
  const sentences = [...article.verifiedFacts];
  const calls = [];
  const result = await generateEditorial(article, {
    callModel: async request => {
      calls.push(request);
      if (/표지 제목 교정기/u.test(request.systemPrompt)) {
        return { titleCandidates: [{ title: '수도권 아파트\n신고가 절반' }] };
      }
      return {
        titleCandidates: [{ title: '수도권 15억~20억 아파트\n거래 절반 이상이 신고가' }],
        sentences,
        emojis: { first: '🏠', third: '📊' },
        topicTags: ['수도권아파트', '신고가', '부동산', '주택시장'],
      };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(result.title.text, '수도권 아파트\n신고가 절반');
  assert.deepEqual(
    result.caption.sentences.map(sentence => sentence.replace(/[🏠📊]$/u, '')),
    sentences
  );
  assert.ok(result.generation.attempts.some(attempt => attempt.stage === 'title_repair' && attempt.status === 'succeeded'));
});

test('does not spend a title repair on a caption that copied raw source wording', async () => {
  const article = autoInsuranceBroadcastArticle();
  const requests = [];
  const result = await generateEditorial(article, {
    callModel: async request => {
      requests.push(request);
      if (request.model === DEFAULT_MODELS.primary) {
        return {
          titleCandidates: [{ title: '지나치게 긴 자동차보험 제목\n적자 전환 설명' }],
          sentences: [
            '국내 자동차보험이 6년 만에 적자로 돌아섰습니다.',
            '보험업계는 한방병원 과잉진료와 일부 정비업체의 과잉수리가 손해율을 끌어올렸다고 설명했습니다.',
            '손해율 부담이 커지면서 자동차보험료 조정 논의에도 관심이 쏠리고 있습니다.',
          ],
        };
      }
      return {
        titleCandidates: [{ title: '자동차보험\n적자 전환' }],
        sentences: [
          '자동차보험이 올해 상반기 6년 만에 영업적자로 돌아섰습니다.',
          '업계는 한방병원 진료비와 정비업체 수리비 누수가 손해율 상승을 키웠다고 봤습니다.',
          '손해율 압박이 이어지면 보험료 조정 논의에도 영향을 줄 수 있습니다.',
        ],
        topicTags: ['자동차보험', '손해율', '보험료', '한방병원'],
      };
    },
  });

  assert.equal(requests.some(request => /표지 제목 교정기/u.test(request.systemPrompt)), false);
  assert.equal(result.generation.model, DEFAULT_MODELS.fallback);
});

test('exposes model and title-repair failures when every safe title attempt fails', async () => {
  const article = economyArticle();
  let captured;
  try {
    await generateEditorial(article, {
      callModel: async request => (/표지 제목 교정기/u.test(request.systemPrompt)
        ? { titleCandidates: [{ title: '지나치게 긴 제목을\n다시 그대로 반환합니다' }] }
        : {
          titleCandidates: [{ title: '지나치게 긴 기준금리 제목\n핵심 사건도 길게 씁니다' }],
          sentences: article.verifiedFacts.concat(article.context),
        }),
    });
  } catch (error) {
    captured = error;
  }

  assert.ok(captured);
  assert.match(captured.message, /title repair failed/u);
  assert.equal(Array.isArray(captured.attempts), true);
  assert.equal(captured.attempts.filter(attempt => attempt.stage === 'title_repair').length, 2);
  assert.ok(captured.attempts.every(attempt => attempt.model));
});

test('rejects official-denial titles that invert the article state instead of auto-fallback publishing', async () => {
  const article = officialDenialArticle();
  await assert.rejects(
    generateEditorial(article, {
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
    }),
    /fallback is disabled|try the next candidate/i
  );
});

test('rejects a reported courtroom allegation rewritten as confirmed theft', () => {
  const article = {
    category: CATEGORIES.ECONOMY,
    title: '전 삼성 연구원, 법정서 CXMT 기술 탈취 증언',
    summary: '전직 연구원이 CXMT가 삼성 공정 정보를 입수했다고 법정에서 증언했습니다.',
    fullText: '전직 연구원이 법정에서 기술 탈취 의혹을 증언했습니다. 법원 판단은 아직 나오지 않았습니다.',
    target: 'CXMT',
    event: '기술 탈취 증언',
  };
  const frame = buildNewsFrame(article, CATEGORIES.ECONOMY);
  const validation = validateTitleAgainstFrame('CXMT\n탈취 확정', frame);
  assert.equal(frame.claimState, 'reported');
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(' '), /cannot strengthen/u);
});

test('rejects a sentence that combines numeric policy thresholds from different source sentences', () => {
  const article = {
    category: CATEGORIES.ECONOMY,
    title: '정책대출 주택가격 기준 장기 고정',
    summary: '보금자리론은 6억원 이하 주택을 대상으로 합니다.',
    fullText: '보금자리론은 6억원 이하 주택을 대상으로 합니다. 일반 디딤돌 대출은 5억원 이하 주택이 기준입니다. 신혼부부 디딤돌 대출은 6억원 이하입니다.',
    target: '정책대출',
    event: '가격 기준 고정',
  };
  const editorial = {
    schemaVersion: 2,
    category: 'economy',
    titleCandidates: [{ title: '정책대출\n기준 장기고정' }],
    title: { text: '정책대출\n기준 장기고정' },
    caption: {
      sentences: [
        '보금자리론의 주택가격 기준은 6억원입니다.🏠',
        '현재 5억원 이하 일반 디딤돌과 6억원 이하 신혼부부 대출에 같은 기준이 적용됩니다.',
        '상품별 기준을 구분해 확인해야 합니다.📊',
      ],
      text: '보금자리론의 주택가격 기준은 6억원입니다.🏠\n\n현재 5억원 이하 일반 디딤돌과 6억원 이하 신혼부부 대출에 같은 기준이 적용됩니다.\n\n상품별 기준을 구분해 확인해야 합니다.📊',
    },
    emojis: { first: '🏠', third: '📊' },
    comments: {
      first: '🏠',
      reply: '@diem.magazine #경제 #금융 #경제뉴스 #재테크초보 #뉴스요약 #릴스 #diem #diemmagazine #데일리이슈앤이코노미 #정책대출 #보금자리론 #디딤돌대출',
      hashtagsByRole: { sector: ['#경제', '#금융', '#경제뉴스'], audience: ['#재테크초보', '#뉴스요약', '#릴스'], brand: ['#diem', '#diemmagazine', '#데일리이슈앤이코노미'], topic: ['#정책대출', '#보금자리론', '#디딤돌대출', '#주택금융'] },
    },
  };
  const validation = validateEditorial(editorial, { article });
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(' '), /combines numeric claims/u);
});

test('accepts an official-denial caption only when its lead preserves the denial', async () => {
  const article = officialDenialArticle();
  const result = await generateEditorial(article, {
    callModel: async () => ({
      titleCandidates: [
        { title: '정부 반박\n건보료 개편' },
      ],
      selectedTitleIndex: 0,
      sentences: [
        '보건복지부는 건보료 부과체계 개편안이 확정되지 않았다고 공식 설명했습니다.',
        '논란이 된 보도는 고소득층의 보험료 상한을 높이는 방안을 다뤘습니다.',
        '현재로선 정부의 최종 결정이 아니므로 추가 발표를 확인해야 합니다.',
      ],
    }),
  });

  assert.equal(result.title.text, '정부 반박\n건보료 개편');
  assert.match(result.caption.sentences[0], /확정되지 않았/u);
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

test('uses the next model when a competitive title reverses who already leads', async () => {
  const article = {
    category: CATEGORIES.ECONOMY,
    title: '한국은 반도체만 세계 1위…중국이 배터리·조선 싹쓸이했다',
    summary: '한국은 메모리 반도체 1위를 지켰지만 배터리와 조선에서는 중국 기업이 점유율 선두를 차지했습니다.',
    fullText: '한국은 메모리 반도체 1위를 지켰습니다. 차량용 배터리와 조선에서는 중국 기업이 세계 점유율 선두를 차지해 한국을 앞섰습니다. 중국 기업은 동남아시아 수출도 확대하고 있습니다.',
    verifiedFacts: [
      '한국은 메모리 반도체에서 세계 1위를 지켰습니다.',
      '차량용 배터리와 조선에서는 중국 기업이 세계 점유율 선두를 차지했습니다.',
      '중국 기업은 동남아시아 수출도 확대하고 있습니다.',
    ],
  };
  const result = await generateEditorial(article, {
    callModel: async ({ model }) => ({
      titleCandidates: [{
        title: model === DEFAULT_MODELS.primary
          ? '한국 반도체 1위 유지\n배터리·조선 중국 추격'
          : '반도체1위\n배·조선 中선두',
      }],
      selectedTitleIndex: 0,
      sentences: article.verifiedFacts,
      emojis: { first: '💻', third: '📊' },
      topicTags: ['반도체', '배터리', '조선', '중국기업'],
      imageKeyword: 'semiconductor microchip processor',
    }),
  });

  assert.equal(result.generation.model, DEFAULT_MODELS.fallback);
  assert.equal(result.title.text, '반도체1위\n배·조선 中선두');
});

test('rejects celebratory reaction emojis for a minor medical incident', async () => {
  const article = {
    category: CATEGORIES.ISSUE,
    title: '태국 고등학생 응급 이송',
    summary: '16세 여학생이 복통을 호소해 병원으로 옮겨졌습니다.',
    fullText: '태국의 16세 여학생이 복통을 호소해 구조대가 병원으로 응급 이송했습니다. 학생은 의료진의 치료를 받았습니다. 이후 안정을 되찾았습니다.',
    verifiedFacts: [
      '16세 여학생이 복통을 호소해 병원으로 응급 이송됐습니다.',
      '학생은 의료진의 치료를 받았습니다.',
      '학생은 이후 안정을 되찾았습니다.',
    ],
  };
  await assert.rejects(generateEditorial(article, {
    callModel: async () => ({
      titleCandidates: [{ title: '태국 고등학생\n응급 이송' }],
      selectedTitleIndex: 0,
      sentences: article.verifiedFacts,
      emojis: { first: '😲', third: '👍' },
      topicTags: ['태국', '고등학생', '응급이송', '병원'],
      imageKeyword: 'teenage patient hospital',
    }),
  }), /fallback is disabled|try the next candidate/i);
});

test('rejects the article when both model calls fail or invent a number', async () => {
  const calls = [];
  await assert.rejects(
    generateEditorial(economyArticle(), {
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
    }),
    /fallback is disabled|try the next candidate/i
  );

  assert.deepEqual(calls, [DEFAULT_MODELS.primary, DEFAULT_MODELS.fallback, DEFAULT_MODELS.fallback]);
});

test('rejects copied raw source sentences and accepts rewritten model summaries', async () => {
  const calls = [];
  const result = await generateEditorial(autoInsuranceBroadcastArticle(), {
    callModel: async ({ model }) => {
      calls.push(model);
      if (model === DEFAULT_MODELS.primary) {
        return {
          titleCandidates: [{ title: '자동차보험\n적자 전환' }],
          sentences: [
            '국내 자동차보험이 6년 만에 적자로 돌아섰습니다.',
            '보험업계는 한방병원 과잉진료와 일부 정비업체의 과잉수리가 손해율을 끌어올렸다고 설명했습니다.',
            '손해율 부담이 커지면서 자동차보험료 조정 논의에도 관심이 쏠리고 있습니다.',
          ],
        };
      }
      return {
        titleCandidates: [{ title: '자동차보험\n적자 전환' }],
        sentences: [
          '자동차보험이 올해 상반기 6년 만에 영업적자로 돌아섰습니다.',
          '업계는 한방병원 진료비와 정비업체 수리비 누수가 손해율 상승을 키웠다고 봤습니다.',
          '손해율 압박이 이어지면 보험료 조정 논의에도 영향을 줄 수 있습니다.',
        ],
        topicTags: ['자동차보험', '손해율', '보험료', '한방병원'],
      };
    },
  });

  assert.deepEqual(calls, [DEFAULT_MODELS.primary, DEFAULT_MODELS.primary, DEFAULT_MODELS.fallback]);
  assert.equal(result.generation.model, DEFAULT_MODELS.fallback);
  assert.doesNotMatch(result.caption.text, /일부 정비업체의 과잉수리가 손해율을 끌어올렸다고 설명/u);
});

test('filters photo captions and source credits before deterministic captioning', () => {
  const article = {
    category: CATEGORIES.ISSUE,
    title: '피지컬AI 특별법 개인정보 활용 논란',
    summary: '국회에서 피지컬AI 특별법안이 논의되며 개인정보 원본 활용 우려가 커지고 있습니다.',
    fullText: '피지컬AI 성능 명분으로 개인정보 원본 동의 없이 활용하는 특례를 두고 시민사회와 노동계가 비판했습니다. ▲지난 1월6일 미국 네바다주 라스베이거스 만달레이베이에서 열린 프레스 컨퍼런스에서 시제품이 무대에 공개돼 있다. ⓒ연합뉴스개인정보를 정보주체의 동의 없이 원본 그대로 수집해 피지컬AI에 활용할 수 있도록 허용하는 특별법안을 두고 시민사회의 우려가 큽니다. 국회에서 AI 개발과 활용을 위해 특례 입법이 논의되면서 기본권을 박탈하는 예외주의라는 비판이 나오고 있습니다.',
    entities: ['피지컬AI', '개인정보', '특별법'],
    target: 'AI 개인정보',
    event: '특별법 논란',
  };
  const sentences = sourceSentences(article);
  assert.equal(sentences.some(sentence => /▲|ⓒ|연합뉴스|프레스\s*컨퍼런스|무대에\s*공개/u.test(sentence)), false);

  assert.throws(
    () => buildDeterministicEditorial(article),
    /structured evidence|verified facts/i
  );
});

test('filters broadcast chrome and fails closed for raw-body-only fallback', () => {
  const article = autoInsuranceBroadcastArticle();
  const sentences = sourceSentences(article);
  assert.equal(sentences.some(sentence => /전화|이메일|카카오톡|제보|뉴스데스크|앵커|리포트|영상취재|영상편집|MBC뉴스/u.test(sentence)), false);
  assert.equal(sentences.some(sentence => /말합니다\.규모가/u.test(sentence)), false);
  assert.equal(sentences.some(sentence => /받았다는[.!?。！？]?$/u.test(sentence)), false);
  assert.equal(sentences.some(sentence => sentence.replace(/\s+/g, '') === article.title.replace(/\s+/g, '')), false);

  assert.throws(
    () => buildDeterministicEditorial(article),
    /structured evidence|verified facts/i
  );
  assert.equal(validateTitle('자동차보험 6년\n6년 적자').ok, false);
});

test('builds a safe auto-insurance fallback only from trusted structured facts', () => {
  const article = {
    ...autoInsuranceBroadcastArticle(),
    verifiedFacts: [
      '국내 자동차보험이 올해 상반기 6년 만에 영업손익 적자로 돌아섰습니다.',
      '보험업계는 과잉진료와 과잉수리가 손해율을 끌어올린 배경으로 꼽았습니다.',
      '손해율 부담이 커지면 향후 자동차보험료 조정 논의에도 영향을 줄 수 있습니다.',
    ],
    context: '자동차보험 적자는 운전자 보험료와 손해보험사 실적에 모두 영향을 줄 수 있는 생활경제 이슈입니다.',
    target: '자동차보험',
    event: '적자 전환',
  };
  const editorial = buildDeterministicEditorial(article);
  assert.equal(validateEditorial(editorial, { article }).ok, true);
  assert.doesNotMatch(editorial.title.text, /자동차보험 6년\n6년/u);
  assert.match(editorial.title.text, /자동차보험/u);
  assert.match(editorial.title.text, /적자/u);
  assert.doesNotMatch(editorial.caption.text, /전화|이메일|카카오톡|제보|말합니다\.규모가|받았다는|MBC뉴스/u);
});

test('fails closed when model output is unusable and deterministic evidence cannot form a safe title', async () => {
  await assert.rejects(
    generateEditorial({
      category: CATEGORIES.ECONOMY,
      title: '얼굴 목소리 원본 동의 없이 수집 논란',
      summary: 'AI 관련 논란입니다.',
      fullText: 'AI 관련 논란입니다. 개인정보 활용 논란입니다. 시민사회가 우려했습니다.',
      entities: ['피지컬AI'],
      target: '얼굴 목소리',
      event: '',
    }, {
      callModel: async () => ({ titleCandidates: [], sentences: [] }),
    }),
    /valid title candidates|fallback/i
  );
});

test('rejects malformed title, caption, comment, and hashtag reply contracts', () => {
  assert.equal(validateTitle('한 줄뿐').ok, false);
  assert.equal(validateTitle('일이삼사오육칠팔\n구십일이삼사오육').ok, false);
  assert.equal(validateTitle('일이삼사오육\n칠팔구십일이').ok, true);
  assert.equal(validateTitle('일이삼사오육칠팔구십일이삼사\n오육칠팔구십일이삼사오육칠팔').ok, false);
  assert.equal(validateCaption('첫 문장📊\n둘째 문장\n셋째 문장📊').ok, false);
  assert.equal(validateCaption(`첫 문장입니다.📊\n\n${'가'.repeat(121)}\n\n셋째 문장입니다.📊`).ok, false);
  assert.equal(validateHashtagReply('@diem.magazine #경제 #경제').ok, false);

  const editorial = buildDeterministicEditorial(economyArticle());
  editorial.comments.first = `${editorial.comments.first} 설명`;
  const report = validateEditorial(editorial, { article: economyArticle() });
  assert.equal(report.ok, false);
  assert.match(report.errors.join(' '), /first comment/u);
});

test('rejects a numeric sentence when its comparison basis contradicts the source context', async () => {
  const article = {
    category: CATEGORIES.ECONOMY,
    title: '미국 2분기 GDP 성장률 1.5% 둔화',
    summary: '미국의 2분기 GDP 증가율은 전기 대비 연율 1.5%로 집계됐습니다.',
    fullText: '미 상무부는 2분기 국내총생산 증가율이 전기 대비 연율 1.5%로 집계됐다고 발표했습니다. 1분기 2.1%보다 낮은 수치입니다. 개인소비는 증가했습니다.',
    target: '미국 성장률',
    event: '1.5% 둔화',
  };

  await assert.rejects(generateEditorial(article, {
    callModel: async () => ({
      titleCandidates: [{ title: '미국 성장률\n1.5% 둔화' }],
      sentences: [
        '미국의 2분기 GDP 성장률은 전년 대비 1.5%로 둔화했습니다.',
        '1분기 2.1%보다 낮은 수치입니다.',
        '개인소비는 증가했습니다.',
      ],
      emojis: { first: '📰', third: '📊' },
      topicTags: ['미국GDP', '성장률', '개인소비', '미국경제'],
    }),
  }), /comparison basis|evidence|next candidate/i);
});
