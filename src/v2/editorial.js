const { BRAND, CATEGORIES } = require('./constants');
const {
  graphemeCount,
  graphemes,
  normalizeHandle,
  normalizeHashtag,
  normalizeNfc,
  uniqueHashtags,
  validateCaption,
  validateHashtagReply,
  validateTitle,
  validateTitleAgainstFrame,
} = require('./text');
const { buildNewsFrame, isSensitiveTopic } = require('./topic');

const DEFAULT_MODELS = Object.freeze({
  primary: 'openai/gpt-oss-120b',
  fallback: 'openai/gpt-oss-20b',
});

const SENTENCE_ENDING = /[.!?。！？]$/u;
const EVENT_WORDS = /(인상|인하|상승|하락|급등|급락|확대|축소|시행|폐지|확정|결정|발표|판결|규제|지원|증가|감소|돌파|합의|통과)/u;
const NUMBER_TOKEN = /\d[\d,.]*(?:\s*(?:%|퍼센트|조\s*원|억\s*원|만\s*원|원|만\s*명|명|개|배|년|월|일))?/gu;
const INPUT_EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)/gu;
const TOPIC_STOPWORDS = new Set([
  '오늘', '관련', '대한', '위해', '이번', '기사', '뉴스', '기자', '발표',
  '따르면', '그리고', '하지만', '것으로', '나타났다', '밝혔다',
]);

function cleanVisibleText(value = '') {
  return normalizeNfc(value)
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/#[0-9A-Za-z가-힣_]+/gu, '')
    .replace(INPUT_EMOJI, '')
    .replace(/[\u200D\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function sourceText(article = {}) {
  return normalizeNfc([
    article.title,
    article.summary,
    article.fullText,
    article.body,
    article.context,
    ...(article.verifiedFacts || article.facts || []),
  ].filter(Boolean).join(' '));
}

function sourceSentences(article = {}) {
  const preferred = [
    ...(article.verifiedFacts || article.facts || []),
    article.context,
  ].filter(Boolean);
  const body = [article.fullText, article.body, article.summary, article.title]
    .filter(Boolean)
    .flatMap(value => normalizeNfc(value).split(/(?<=[.!?。！？])\s+|\n+/u));
  const seen = new Set();
  return [...preferred, ...body]
    .map(cleanVisibleText)
    .filter(Boolean)
    .filter(value => !/^[▲■◇◆]/u.test(value.trim()) && !/^사진=/u.test(value.trim()))
    .filter(value => {
      const key = value.replace(/\s+/gu, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function fitWords(value, maximum = 7, fallback = '') {
  const words = cleanVisibleText(value)
    .replace(/[()[\]{}"'“”‘’!?…,:;·—–-]/gu, ' ')
    .split(/\s+/u)
    .filter(Boolean);
  let result = '';
  for (const word of words) {
    if (graphemeCount(word) > maximum) continue;
    const candidate = result ? `${result} ${word}` : word;
    if (graphemeCount(candidate) > maximum) break;
    result = candidate;
  }
  return result || fallback;
}

function meaningfulTokens(article = {}) {
  return cleanVisibleText(`${article.target || ''} ${article.event || ''} ${article.title || ''}`)
    .replace(/[^0-9A-Za-z가-힣.%\s]/gu, ' ')
    .split(/\s+/u)
    .map(value => value.trim())
    .filter(value => value.length >= 2 && !TOPIC_STOPWORDS.has(value));
}

function articleFrame(article = {}) {
  return article.newsFrame || buildNewsFrame(article, article.category);
}

function cleanTitleLines(lines, frame) {
  const title = lines.join('\n').normalize('NFC');
  const validation = validateTitleAgainstFrame(title, frame);
  return validation.ok
    ? {
      title: validation.normalized,
      lines: validation.lines,
      validation,
    }
    : null;
}

function buildDeterministicTitleCandidates(article = {}) {
  const category = article.category === CATEGORIES.ISSUE ? CATEGORIES.ISSUE : CATEGORIES.ECONOMY;
  const categoryLabel = category === CATEGORIES.ISSUE ? '시사브리핑' : '경제브리핑';
  const frame = articleFrame(article);
  const tokens = meaningfulTokens(article);
  const subject = fitWords(frame.subject || article.target || article.entities?.[0] || tokens[0], 9, category === CATEGORIES.ISSUE ? '오늘시사' : '오늘경제');
  const secondary = fitWords(article.entities?.[1] || tokens.find(token => token !== subject), 7, categoryLabel);
  const explicitEvent = cleanVisibleText(article.event).match(EVENT_WORDS)?.[0];
  const eventToken = explicitEvent
    || tokens.find(token => EVENT_WORDS.test(token) && token !== subject)
    || (category === CATEGORIES.ISSUE ? '쟁점정리' : '흐름정리');
  const event = fitWords(eventToken, 7, category === CATEGORIES.ISSUE ? '쟁점정리' : '흐름정리');
  const number = (sourceText(article).match(NUMBER_TOKEN) || [])[0] || '';
  const numberLine = fitWords(
    `${number} ${event}`.trim(),
    Math.max(7, 14 - graphemeCount(subject)),
    event
  );
  const templates = [
    ...(frame.claimState === 'official_denial'
      ? [
        [subject, '확정 아님'],
        ['정부 반박', subject],
        [subject, '미확정'],
      ]
      : []),
    ...(frame.eventKind === 'ipo'
      ? [
        [`${subject} IPO`, `${frame.date || '증시'} 상장`],
        [subject, 'IPO 상장'],
        [/CXMT|창신메모리/iu.test(sourceText(article)) ? '중국 D램' : secondary, 'IPO 상장'],
      ]
      : []),
    [subject, numberLine],
    [subject, event],
    [number ? fitWords(number, 7, categoryLabel) : secondary, subject],
    [secondary, event],
    [categoryLabel, subject],
    [event, subject],
    [subject, categoryLabel],
  ];
  const candidates = [];
  for (const lines of templates) {
    const cleaned = cleanTitleLines(lines, frame);
    if (!cleaned) continue;
    const key = cleaned.title.replace(/\s+/gu, '');
    if (!candidates.some(candidate => candidate.title.replace(/\s+/gu, '') === key)) {
      candidates.push({
        title: cleaned.title,
        lines: cleaned.lines,
        source: 'deterministic',
        score: 100 - candidates.length * 5,
      });
    }
    if (candidates.length === 5) break;
  }
  if (candidates.length < 1) {
    throw new Error('[DIEM Editorial] Could not construct any valid title candidates from article evidence');
  }
  return candidates;
}

function ensureSentence(value = '', emoji = '') {
  const text = cleanVisibleText(value).replace(/[.!?。！？]+$/u, '').trim();
  const suffix = emoji ? `.${emoji}` : '.';
  return `${text || '핵심 내용'}${suffix}`.normalize('NFC');
}

function selectEmojis(article = {}) {
  const text = sourceText(article);
  if (isSensitiveTopic(article) || /(산불|홍수|지진|붕괴|인명\s*피해)/u.test(text)) {
    return { first: '📰', third: '📰' };
  }
  if (article.category === CATEGORIES.ISSUE) {
    if (/(법안|국회|정부|정책|규제|판결)/u.test(text)) return { first: '🏛️', third: '📰' };
    if (/(국제|외교|전쟁)/u.test(text)) return { first: '🌐', third: '📰' };
    return { first: '📰', third: '🔎' };
  }
  if (/(부동산|주택|아파트|전세)/u.test(text)) return { first: '🏠', third: '📊' };
  if (/(금리|은행|대출|예금|적금)/u.test(text)) return { first: '🏦', third: '📊' };
  if (/(반도체|인공지능|\bAI\b|빅테크|기술)/iu.test(text)) return { first: '💻', third: '📊' };
  if (/(주식|증시|주가|채권)/u.test(text)) return { first: '📈', third: '📊' };
  if (/(세금|과세)/u.test(text)) return { first: '🧾', third: '📊' };
  return { first: '📊', third: '🔎' };
}

function topicTagValues(article = {}) {
  const explicit = [...(article.topicTags || []), ...(article.entities || [])];
  const tokens = [
    ...explicit,
    article.target,
    article.event,
    ...meaningfulTokens(article),
  ];
  const flatTokens = tokens.flatMap(token => String(token || '').split(/\s+/)).filter(Boolean);
  const tags = uniqueHashtags(flatTokens.map(value => normalizeHashtag(value)))
    .filter(tag => /^#[0-9A-Za-z가-힣_]+$/u.test(tag))
    .filter(tag => !/^#\d+$/u.test(tag))
    .filter(tag => graphemeCount(tag) <= 20)
    .slice(0, 6);
  const categoryFill = article.category === CATEGORIES.ISSUE
    ? ['정책변화', '사회변화', '시사쟁점', '국제정세']
    : ['금융시장', '생활경제', '경제정책', '시장동향'];
  return uniqueHashtags([...tags, ...categoryFill.map(normalizeHashtag)]).slice(0, Math.max(4, Math.min(6, tags.length || 4)));
}

function buildCommentChain(article, firstEmoji, handle = BRAND.primaryHandle) {
  const sector = article.category === CATEGORIES.ISSUE
    ? ['#시사', '#정책', '#오늘의뉴스']
    : ['#경제', '#금융', '#경제뉴스'];
  const audience = ['#재테크초보', '#뉴스요약', '#릴스'];
  const brand = [...BRAND.hashtags];
  const topic = topicTagValues(article).slice(0, 6);
  const hashtags = uniqueHashtags([...sector, ...audience, ...brand, ...topic]).slice(0, 15);
  const mention = `@${normalizeHandle(handle)}`;
  const reply = `${mention} ${hashtags.join(' ')}`;
  return {
    first: firstEmoji,
    reply,
    compactReply: `${mention} ${uniqueHashtags([...sector.slice(0, 2), ...brand]).slice(0, 5).join(' ')}`,
    hashtags,
    hashtagsByRole: { sector, audience, brand, topic },
  };
}

function numericClaimsAreGrounded(sentences, article) {
  const evidence = sourceText(article).replace(/[\s,]/gu, '');
  return sentences.every(sentence => {
    const numbers = sentence.match(NUMBER_TOKEN) || [];
    return numbers.every(number => evidence.includes(number.replace(/[\s,]/gu, '')));
  });
}

function assembleEditorial({
  article,
  titleCandidates,
  selectedTitleIndex = 0,
  sentenceDrafts,
  emojis = selectEmojis(article),
  imageKeyword,
  handle,
  generation,
}) {
  const frame = articleFrame(article);
  const sentences = [
    ensureSentence(sentenceDrafts[0], emojis.first),
    ensureSentence(sentenceDrafts[1]),
    ensureSentence(sentenceDrafts[2], emojis.third),
  ];
  const caption = sentences.join('\n\n').normalize('NFC');
  const validTitleCandidates = titleCandidates.filter(candidate => validateTitleAgainstFrame(candidate.title, frame).ok);
  if (validTitleCandidates.length < 1) {
    throw new Error('[DIEM Editorial] No title candidate matches the article claim state and event.');
  }
  const requested = titleCandidates[selectedTitleIndex] || titleCandidates[0];
  const selected = validateTitleAgainstFrame(requested.title, frame).ok
    ? requested
    : validTitleCandidates[0];
  const comments = buildCommentChain(article, emojis.first, handle);
  const editorial = {
    schemaVersion: 2,
    category: article.category,
    titleCandidates: validTitleCandidates,
    title: {
      text: selected.title,
      lines: selected.lines,
      selectedIndex: validTitleCandidates.indexOf(selected),
      selectionReason: 'accuracy_format_clarity_curiosity',
    },
    caption: { sentences, text: caption },
    emojis,
    imageKeyword,
    comments,
    generation,
  };
  const validation = validateEditorial(editorial, { article, handle });
  if (!validation.ok) throw new Error(`[DIEM Editorial] ${validation.errors.join('; ')}`);
  return editorial;
}

function buildDeterministicEditorial(article = {}, { handle } = {}) {
  if (!Object.values(CATEGORIES).includes(article.category)) {
    throw new Error('[DIEM Editorial] Article category must be economy or issue');
  }
  const facts = sourceSentences(article);
  if (facts.length === 0) throw new Error('[DIEM Editorial] Article evidence is required');
  const sentenceDrafts = [
    facts[0],
    facts[1] || facts[0],
    cleanVisibleText(article.context) || facts[2] || facts[1] || facts[0],
  ];
  return assembleEditorial({
    article,
    titleCandidates: buildDeterministicTitleCandidates(article),
    sentenceDrafts,
    handle,
    generation: { method: 'deterministic_fallback', model: null, attempts: [] },
  });
}

function parseModelResult(value) {
  if (value && typeof value === 'object') return value;
  let text = String(value || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

function normalizeModelCandidates(values = [], frame) {
  if (!Array.isArray(values) || values.length < 1) return [];
  return values.map((candidate, index) => {
    const title = Array.isArray(candidate?.lines)
      ? candidate.lines.join('\n')
      : String(candidate?.title || candidate || '');
    const validation = frame
      ? validateTitleAgainstFrame(title, frame)
      : validateTitle(title);
    return {
      title: validation.normalized,
      lines: validation.lines,
      source: 'model',
      score: Number(candidate?.score) || 100 - index * 5,
      valid: validation.ok,
    };
  });
}

function modelPrompt(article) {
  const frame = articleFrame(article);
  return {
    systemPrompt: [
      '당신은 인스타그램 시사·경제 매거진 DIEM의 전문 에디터입니다.',
      '발행 대상은 숏폼(릴스) 이용자로, 바쁜 현대인이 릴스 1개(카드뉴스 1장 + 캡션 3줄)만 보고도 뉴스 핵심을 100% 이해할 수 있도록 재작성해야 합니다.',
      '',
      '[1. 원문 필터링 규칙 (중요)]',
      '- 원문의 사진 설명(예: "기념촬영을 하고 있다", "건배하고 있다"), 단순 행사 동정, 식사/만찬 메뉴, 참석자 인사말 등 본질과 상관없는 부차적 사실은 완전히 배제합니다.',
      '- 기자 이름, [단독], [자료사진], [속보] 등 언론사 찌꺼기 텍스트를 완벽히 제거합니다.',
      '',
      '[2. 제목(title) 작성 규칙]',
      '- 단순 단어/키워드 나열(예: "빅테크 AI / 1400")은 절대 금지합니다.',
      '- 반드시 [핵심 주체 + 사건 + 기사 상태]가 드러나는 직관적인 훅(Hook) 형태로 작성하세요.',
      '- 기사 상태가 "확정 아님/부인/반박/해명"이면 제목에도 반드시 그 상태를 드러내고, 확정·결정·시행처럼 뒤집어 쓰지 마세요.',
      '- IPO/상장 기사라면 제목에 반드시 IPO, 기업공개, 상장, 첫 거래, 증시 데뷔 중 하나를 넣으세요.',
      '- 알파벳 약어만 쓰지 말고 사건어 또는 쉬운 설명어를 함께 넣으세요. 날짜만 반복하는 제목은 금지합니다.',
      '- 각 title은 줄바꿈(\'\\n\') 1개를 포함한 정확히 2줄이어야 하며, 전체 공백 포함 20자 내외(최대 24자)로 제한합니다.',
      '- 좋은 예시:',
      '  "건보료 개편\\n확정 아님"',
      '  "CXMT IPO\\n27일 상장"',
      '  "청년 월세\\n지원 확대"',
      '',
      '[3. 본문(sentences) 작성 규칙]',
      '- 원문 문장을 절대 그대로 복사하지 말고, 에디터의 언어로 완전히 "새로 재작성(Re-writing)"하세요.',
      '- sentences는 정확히 3개의 문장으로 구성되며, 각 문장은 80~120자 내외로 매우 명확하고 깔끔해야 합니다.',
      '- 구체적 역할 구분:',
      '  1문장 (Hook): 이번 뉴스의 가장 결정적인 사건과 핵심 수치 요약',
      '  2문장 (Fact): 삼성·SK·현대차 등 주요 기업들의 구체적인 협력/투자 내용',
      '  3문장 (Impact): 이 사건이 한국 AI 산업 및 시장에 가져올 전망이나 의미',
      '- 어조: "~했습니다", "~로 나타났습니다", "~전망입니다" 등 격식있고 자연스러운 매거진체 하십시오.',
      '',
      '[4. 이모지 및 태그 규칙]',
      '- emojis.first는 1문장 끝, emojis.third는 3문장 끝에 가장 어울리는 직관적인 이모지 1개씩을 지정하세요.',
      '- topicTags는 관련 핵심 해시태그 3~5개를 배열로 작성하세요. 반드시 띄어쓰기가 없는 단일 명사형 단어로만 작성해야 하며 문장이나 구문은 절대 금지합니다. (예: ["#주식", "#금리인하"])',
      '- imageKeyword는 기사의 메인 주제를 가장 잘 나타낼 수 있는 배경 이미지 검색용 영문 키워드 1~2개(예: "pokemon card", "semiconductor factory")를 지정하세요.',
      '',
      '[5. 출력 형식]',
      '- 오직 지정된 JSON 형식으로만 응답하며, 어떠한 서문이나 설명도 포함하지 마세요.',
      '{"titleCandidates":[{"title":"첫줄\\n둘째줄","score":100}],"selectedTitleIndex":0,"sentences":["1문장","2문장","3문장"],"emojis":{"first":"🔥","third":"🚀"},"topicTags":["#AI동맹", "#반도체", "#빅테크"],"imageKeyword":"server rack"}'
    ].join('\n'),
    userPrompt: JSON.stringify({
      category: article.category,
      title: article.title,
      newsFrame: frame,
      verifiedFacts: article.verifiedFacts || article.facts || [],
      context: article.context || '',
      source: sourceText(article).slice(0, 9000),
    }).normalize('NFC'),
  };
}

async function generateEditorial(article = {}, {
  callModel,
  primaryModel = DEFAULT_MODELS.primary,
  fallbackModel = DEFAULT_MODELS.fallback,
  handle,
} = {}) {
  if (typeof callModel !== 'function') return buildDeterministicEditorial(article, { handle });
  const attempts = [];
  const prompt = modelPrompt(article);
  const frame = articleFrame(article);
  for (const model of [primaryModel, fallbackModel]) {
    try {
      const raw = await callModel({ model, ...prompt });
      const parsed = parseModelResult(raw);
      const candidates = normalizeModelCandidates(parsed.titleCandidates, frame).filter(c => c.valid);
      if (candidates.length < 1) {
        throw new Error('model returned no valid title candidates for article frame');
      }
      if (!numericClaimsAreGrounded(candidates.map(candidate => candidate.title), article)) {
        throw new Error('model returned an ungrounded numeric title');
      }
      if (!Array.isArray(parsed.sentences) || parsed.sentences.length !== 3) {
        throw new Error('model returned invalid sentence structure');
      }
      const augmentedArticle = { ...article, topicTags: parsed.topicTags || article.topicTags };
      if (!numericClaimsAreGrounded(parsed.sentences, article)) {
        throw new Error('model returned an ungrounded numeric claim');
      }
      attempts.push({ model, status: 'succeeded' });
      return assembleEditorial({
        article: augmentedArticle,
        titleCandidates: candidates,
        selectedTitleIndex: Number.isInteger(parsed.selectedTitleIndex) ? parsed.selectedTitleIndex : 0,
        sentenceDrafts: parsed.sentences,
        emojis: (parsed.emojis && parsed.emojis.first && parsed.emojis.third) ? parsed.emojis : undefined,
        handle,
        generation: { method: 'model', model, attempts },
      });
    } catch (error) {
      attempts.push({ model, status: 'failed', error: error.message });
    }
  }
  const fallback = buildDeterministicEditorial(article, { handle });
  fallback.generation.attempts = attempts;
  return fallback;
}

function validateEditorial(editorial, { article = {}, handle } = {}) {
  const errors = [];
  const frame = articleFrame(article);
  if (!Array.isArray(editorial?.titleCandidates) || editorial.titleCandidates.length < 1) {
    errors.push('editorial requires at least one title candidate');
  } else {
    const titles = editorial.titleCandidates.map(candidate => candidate.title);
    titles.forEach((title, index) => {
      const validation = validateTitleAgainstFrame(title, frame);
      if (!validation.ok) errors.push(`title candidate ${index + 1}: ${validation.errors.join(', ')}`);
    });
    if (new Set(titles.map(title => normalizeNfc(title).replace(/\s+/gu, ''))).size !== titles.length) {
      errors.push('title candidates must be unique');
    }
  }
  const titleValidation = validateTitleAgainstFrame(editorial?.title?.text || '', frame);
  if (!titleValidation.ok) errors.push(...titleValidation.errors.map(error => `selected ${error}`));
  if (!editorial?.titleCandidates?.some(candidate => candidate.title === editorial?.title?.text)) {
    errors.push('selected title must be one of the title candidates');
  }
  const captionValidation = validateCaption(editorial?.caption?.text || '');
  if (!captionValidation.ok) errors.push(...captionValidation.errors);
  if (editorial?.caption?.text !== editorial?.caption?.sentences?.join('\n\n')) {
    errors.push('caption text must be serialized from its three structured sentences');
  }
  const firstEmoji = editorial?.emojis?.first;
  if (editorial?.comments?.first !== firstEmoji) errors.push('first comment must contain only the first sentence emoji');
  const replyValidation = validateHashtagReply(editorial?.comments?.reply || '', { handle });
  if (!replyValidation.ok) errors.push(...replyValidation.errors);
  const roles = editorial?.comments?.hashtagsByRole || {};
  if (roles.sector?.length !== 3) errors.push('hashtag reply requires three sector tags');
  if (roles.audience?.length < 2 || roles.audience?.length > 3) errors.push('hashtag reply requires two or three audience/format tags');
  if (roles.brand?.length !== 3 || BRAND.hashtags.some(tag => !roles.brand.includes(tag))) {
    errors.push('hashtag reply requires the three DIEM brand tags');
  }
  if (roles.topic?.length < 4 || roles.topic?.length > 6) errors.push('hashtag reply requires four to six topic tags');
  if (article && !numericClaimsAreGrounded(editorial?.caption?.sentences || [], article)) {
    errors.push('caption contains numeric claims absent from article evidence');
  }
  return { ok: errors.length === 0, errors };
}

module.exports = {
  DEFAULT_MODELS,
  buildCommentChain,
  buildDeterministicEditorial,
  buildDeterministicTitleCandidates,
  generateEditorial,
  modelPrompt,
  parseModelResult,
  selectEmojis,
  articleFrame,
  sourceSentences,
  validateEditorial,
};
