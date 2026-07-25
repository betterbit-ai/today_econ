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
} = require('./text');
const { isSensitiveTopic } = require('./topic');

const DEFAULT_MODELS = Object.freeze({
  primary: 'openai/gpt-oss-120b',
  fallback: 'qwen/qwen3.6-27b',
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

function buildDeterministicTitleCandidates(article = {}) {
  const category = article.category === CATEGORIES.ISSUE ? CATEGORIES.ISSUE : CATEGORIES.ECONOMY;
  const categoryLabel = category === CATEGORIES.ISSUE ? '시사브리핑' : '경제브리핑';
  const tokens = meaningfulTokens(article);
  const subject = fitWords(article.target || article.entities?.[0] || tokens[0], 7, category === CATEGORIES.ISSUE ? '오늘시사' : '오늘경제');
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
    const title = lines.join('\n').normalize('NFC');
    const validation = validateTitle(title);
    const key = title.replace(/\s+/gu, '');
    if (validation.ok && !candidates.some(candidate => candidate.title.replace(/\s+/gu, '') === key)) {
      candidates.push({
        title,
        lines: validation.lines,
        source: 'deterministic',
        score: 100 - candidates.length * 5,
      });
    }
    if (candidates.length === 5) break;
  }
  if (candidates.length !== 5) {
    throw new Error('[DIEM Editorial] Could not construct five valid title candidates from article evidence');
  }
  return candidates;
}

function ensureSentence(value = '', maximum = 120, emoji = '') {
  let text = cleanVisibleText(value).replace(/[.!?。！？]+$/u, '').trim();
  const suffix = emoji ? `.${emoji}` : '.';
  const allowed = maximum - graphemeCount(suffix);
  if (graphemeCount(text) > allowed) {
    const words = text.split(/\s+/u);
    const kept = [];
    for (const word of words) {
      const candidate = [...kept, word].join(' ');
      if (graphemeCount(candidate) > allowed) break;
      kept.push(word);
    }
    text = kept.join(' ').replace(/[,;:·—–-]+$/u, '').trim();
  }
  if (!text) text = '핵심 내용';
  return `${text}${suffix}`.normalize('NFC');
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
  const tags = uniqueHashtags(tokens.map(value => normalizeHashtag(value)))
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
  handle,
  generation,
}) {
  const sentences = [
    ensureSentence(sentenceDrafts[0], 120, emojis.first),
    ensureSentence(sentenceDrafts[1], 120),
    ensureSentence(sentenceDrafts[2], 120, emojis.third),
  ];
  const caption = sentences.join('\n\n').normalize('NFC');
  const selected = titleCandidates[selectedTitleIndex] || titleCandidates[0];
  const comments = buildCommentChain(article, emojis.first, handle);
  const editorial = {
    schemaVersion: 2,
    category: article.category,
    titleCandidates,
    title: {
      text: selected.title,
      lines: selected.lines,
      selectedIndex: titleCandidates.indexOf(selected),
      selectionReason: 'accuracy_format_clarity_curiosity',
    },
    caption: { sentences, text: caption },
    emojis,
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

function normalizeModelCandidates(values = []) {
  if (!Array.isArray(values) || values.length !== 5) return [];
  return values.map((candidate, index) => {
    const title = Array.isArray(candidate?.lines)
      ? candidate.lines.join('\n')
      : String(candidate?.title || candidate || '');
    const validation = validateTitle(title);
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
  return {
    systemPrompt: [
      'DIEM 경제·시사 매거진의 편집자다.',
      '제공된 근거 밖의 사실·전망·생활 영향을 만들지 않는다.',
      'titleCandidates는 정확히 5개이며 각 title은 줄바꿈 하나를 포함한 정확히 2줄, 공백 포함 총 14 grapheme 이하다.',
      'sentences는 정확히 3개다. 각 문장은 120 grapheme 이하이고 문장 내부 줄바꿈, URL, 해시태그, 이모지를 넣지 않는다.',
      '1문장은 사건, 2문장은 핵심 사실, 3문장은 근거에 명시된 배경·전망·의미 또는 다음 중요 사실이다.',
      'JSON만 응답한다: {"titleCandidates":[{"title":"첫줄\\n둘째줄","score":100} x5],"selectedTitleIndex":0,"sentences":["","",""],"topicTags":[""]}',
    ].join('\n'),
    userPrompt: JSON.stringify({
      category: article.category,
      title: article.title,
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
  for (const model of [primaryModel, fallbackModel]) {
    try {
      const raw = await callModel({ model, ...prompt });
      const parsed = parseModelResult(raw);
      const candidates = normalizeModelCandidates(parsed.titleCandidates);
      if (candidates.length !== 5 || candidates.some(candidate => !candidate.valid)) {
        throw new Error('model returned invalid title candidates');
      }
      if (new Set(candidates.map(candidate => candidate.title.replace(/\s+/gu, ''))).size !== 5) {
        throw new Error('model returned duplicate title candidates');
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
  if (!Array.isArray(editorial?.titleCandidates) || editorial.titleCandidates.length !== 5) {
    errors.push('editorial requires exactly five title candidates');
  } else {
    const titles = editorial.titleCandidates.map(candidate => candidate.title);
    titles.forEach((title, index) => {
      const validation = validateTitle(title);
      if (!validation.ok) errors.push(`title candidate ${index + 1}: ${validation.errors.join(', ')}`);
    });
    if (new Set(titles.map(title => normalizeNfc(title).replace(/\s+/gu, ''))).size !== 5) {
      errors.push('title candidates must be unique');
    }
  }
  const titleValidation = validateTitle(editorial?.title?.text || '');
  if (!titleValidation.ok) errors.push(...titleValidation.errors.map(error => `selected ${error}`));
  if (!editorial?.titleCandidates?.some(candidate => candidate.title === editorial?.title?.text)) {
    errors.push('selected title must be one of the five candidates');
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
  sourceSentences,
  validateEditorial,
};
