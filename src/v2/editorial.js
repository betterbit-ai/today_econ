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
const EVENT_WORDS = /(인상|인하|상승|하락|급등|급락|확대|축소|시행|폐지|확정|결정|발표|판결|규제|지원|증가|감소|돌파|합의|통과|전환)/u;
const NUMBER_TOKEN = /\d[\d,.]*(?:\s*(?:%|퍼센트|조\s*원|억\s*원|만\s*원|원|만\s*명|명|개|배|년|월|일))?/gu;
const COMPARISON_BASES = Object.freeze([
  { id: 'year_on_year', pattern: /전년(?:\s*동기)?\s*대비|전년보다|1년\s*전보다|지난해보다|작년보다/u },
  { id: 'quarter_on_quarter', pattern: /전기\s*대비|전\s*분기\s*대비|전분기보다|직전\s*분기보다/u },
  { id: 'month_on_month', pattern: /전월\s*대비|전월보다/u },
  { id: 'day_on_day', pattern: /전일\s*대비|전일보다|하루\s*전보다/u },
  { id: 'annualized', pattern: /연율/u },
  { id: 'cumulative', pattern: /누적/u },
]);
const INPUT_EMOJI = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3)/gu;
const PHOTO_CAPTION_BLOCK = /[▲■◇◆][^.!?。！？]{0,280}(?:공개돼\s*있다|촬영[^.!?。！？]*있다|기념\s*촬영|자료\s*사진|사진)[.!?。！？]?/gu;
const SOURCE_CREDIT = /[ⓒ©]\s*(?:연합뉴스|뉴스1|뉴시스|로이터|AP|EPA|게티이미지|공동취재단)?/giu;
const BROADCAST_CHROME_BLOCK = /(?:\[[^\]]{0,40}뉴스데스크[^\]]{0,40}\]|◀\s*(?:앵커|리포트)\s*▶|MBC\s*뉴스는\s*24시간[^.!?。！？]*[.!?。！？]?|▷\s*(?:전화|이메일|카카오톡)[^.!?。！？]*[.!?。！？]?)/gu;
const SPEAKER_LABEL = /\[[^\]]{0,60}(?:관계자|음성변조|기자|앵커|리포트)[^\]]{0,60}\]/gu;
const NEWSROOM_CREDIT = /(?:MBC뉴스\s*\S+입니다|영상취재\s*:[^.!?。！？]*|영상편집\s*:[^.!?。！？]*|취재\s*:[^.!?。！？]*|전화\s*\d{2,4}-\d{3,4}-\d{4}|이메일\s*\S+|카카오톡\s*@?\S+|제보를\s*기다립니다)[.!?。！？]?/gu;
const BOILERPLATE_SENTENCE = /(▲|■|◇|◆|ⓒ|©|자료\s*사진|사진\s*=|프레스\s*컨퍼런스|무대에\s*공개|기념\s*촬영|연합뉴스|뉴스1|뉴시스|로이터|AP|EPA|게티이미지|뉴스데스크|앵커|리포트|영상취재|영상편집|MBC\s*뉴스|MBC뉴스|제보|전화|이메일|카카오톡)/iu;
const EMAIL_TEXT = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const MENTION_TEXT = /@[0-9A-Za-z가-힣_.]+/u;
const INCOMPLETE_FRAGMENT_ENDING = /(다는|라는|이라는|했다는|됐다는|받았다는|나왔다는|있다는|없다는|한다는|추진한다는|허용한다는)[.!?。！？]?$/u;
const TOPIC_STOPWORDS = new Set([
  '오늘', '관련', '대한', '위해', '이번', '기사', '뉴스', '기자', '발표',
  '따르면', '그리고', '하지만', '것으로', '나타났다', '밝혔다', '만에',
]);

function cleanVisibleText(value = '') {
  return normalizeNfc(value)
    .replace(/https?:\/\/\S+/giu, '')
    .replace(/#[0-9A-Za-z가-힣_]+/gu, '')
    .replace(BROADCAST_CHROME_BLOCK, ' ')
    .replace(SPEAKER_LABEL, ' ')
    .replace(NEWSROOM_CREDIT, ' ')
    .replace(PHOTO_CAPTION_BLOCK, ' ')
    .replace(SOURCE_CREDIT, ' ')
    .replace(INPUT_EMOJI, '')
    .replace(/[\u200D\uFE0F\u{1F3FB}-\u{1F3FF}]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function sourceText(article = {}) {
  return cleanVisibleText([
    article.title,
    article.summary,
    article.fullText,
    article.body,
    article.context,
    ...(article.verifiedFacts || article.facts || []),
  ].filter(Boolean).join(' '));
}

function comparableNewsText(value = '') {
  return cleanVisibleText(value)
    .replace(/[^0-9A-Za-z가-힣]/gu, '')
    .toLowerCase();
}

function sentencePunctuationCount(value = '') {
  const plain = cleanVisibleText(value)
    .replace(EMAIL_TEXT, 'EMAIL')
    .replace(/(\d)\.(\d)/gu, '$1§$2');
  return (plain.match(/[.!?。！？]/gu) || []).length;
}

function splitSourceSentences(value = '') {
  return normalizeNfc(value)
    .replace(BROADCAST_CHROME_BLOCK, ' ')
    .replace(SPEAKER_LABEL, ' ')
    .replace(NEWSROOM_CREDIT, ' ')
    .replace(PHOTO_CAPTION_BLOCK, ' ')
    .replace(SOURCE_CREDIT, ' ')
    .replace(/([.!?。！？])(?=[가-힣A-Z0-9"“‘\[])/gu, '$1\n')
    .split(/(?<=[.!?。！？])\s+|\n+|(?=[▲■◇◆])|(?=[ⓒ©])/u);
}

function usableSourceSentence(value = '', article = {}) {
  const clean = cleanVisibleText(value);
  if (!clean) return false;
  if (BOILERPLATE_SENTENCE.test(clean)) return false;
  if (EMAIL_TEXT.test(clean) || MENTION_TEXT.test(clean)) return false;
  if (sentencePunctuationCount(clean) > 1) return false;
  if (INCOMPLETE_FRAGMENT_ENDING.test(clean.replace(/[.!?。！？]+$/u, ''))) return false;
  if (graphemeCount(clean) > 120) return false;
  const sentenceKey = comparableNewsText(clean);
  const titleKey = comparableNewsText(article.title || '');
  if (titleKey && sentenceKey && (sentenceKey === titleKey || sentenceKey.includes(titleKey) || titleKey.includes(sentenceKey))) {
    return false;
  }
  return true;
}

function sourceSentences(article = {}, { structuredOnly = false } = {}) {
  const preferred = [
    ...(article.verifiedFacts || article.facts || []),
    article.context,
  ].filter(Boolean);
  const body = structuredOnly ? [] : [article.fullText, article.body, article.summary]
    .filter(Boolean)
    .flatMap(splitSourceSentences);
  const seen = new Set();
  return [...preferred, ...body]
    .map(cleanVisibleText)
    .filter(Boolean)
    .filter(value => usableSourceSentence(value, article))
    .filter(value => {
      const key = value.replace(/\s+/gu, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function rawSourceSentences(article = {}) {
  const seen = new Set();
  return [article.fullText, article.body, article.summary]
    .filter(Boolean)
    .flatMap(splitSourceSentences)
    .map(cleanVisibleText)
    .filter(Boolean)
    .filter(value => usableSourceSentence(value, article))
    .filter(value => {
      const key = value.replace(/\s+/gu, '');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function copiedRawSourceViolations(sentences = [], article = {}) {
  const rawSentences = rawSourceSentences(article)
    .map(sentence => comparableNewsText(sentence))
    .filter(sentence => sentence.length >= 35);
  if (rawSentences.length < 1) return [];
  return sentences.flatMap((sentence, index) => {
    const normalized = comparableNewsText(sentence);
    if (normalized.length < 35) return [];
    const copied = rawSentences.find(raw => (
      normalized === raw
      || (raw.includes(normalized) && normalized.length / raw.length >= 0.65)
      || (normalized.includes(raw) && raw.length / normalized.length >= 0.65)
    ));
    return copied ? [{ index, sentence: cleanVisibleText(sentence).slice(0, 80) }] : [];
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
  const frame = articleFrame(article);
  const tokens = meaningfulTokens(article);
  const subject = fitWords(frame.subject || article.target || article.entities?.[0] || tokens[0], 9, '');
  const secondary = fitWords(article.entities?.[1] || tokens.find(token => token !== subject), 7, '');
  const explicitEvent = fitWords(article.event, 7, '') || cleanVisibleText(article.event).match(EVENT_WORDS)?.[0];
  const eventToken = explicitEvent
    || tokens.find(token => EVENT_WORDS.test(token) && token !== subject)
    || '';
  const event = fitWords(eventToken, 7, '');
  if (!subject || (!event && frame.claimState !== 'official_denial' && frame.eventKind !== 'ipo')) {
    throw new Error('[DIEM Editorial] Deterministic fallback lacks a concrete article subject/event for a safe title');
  }
  const number = (sourceText(article).match(NUMBER_TOKEN) || [])[0] || '';
  const numberLine = fitWords(
    `${number} ${event}`.trim(),
    Math.max(7, 14 - graphemeCount(subject)),
    event
  );
  const templates = [
    ...(frame.claimState === 'official_denial'
      ? [
        ['정부 반박', subject],
        [subject, '보도 반박'],
        ['공식 해명', subject],
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
    [number ? fitWords(number, 7, '') : secondary, subject],
    [secondary, event],
    [event, subject],
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
    .filter(tag => !/^#\d+(?:년|개월|월|일|명|개)$/u.test(tag))
    .filter(tag => !['#만에', '#쳐도', '#주범'].includes(tag))
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

function ungroundedNumericClaims(sentences, article) {
  const evidence = sourceText(article).replace(/[\s,]/gu, '');
  return sentences.flatMap(sentence => {
    const numbers = sentence.match(NUMBER_TOKEN) || [];
    return numbers
      .filter(number => !evidence.includes(number.replace(/[\s,]/gu, '')))
      .map(number => ({ number, sentence: cleanVisibleText(sentence).slice(0, 80) }));
  });
}

function numericClaimsAreGrounded(sentences, article) {
  return ungroundedNumericClaims(sentences, article).length === 0;
}

function comparisonBases(value = '') {
  const text = normalizeNfc(value);
  return COMPARISON_BASES.filter(({ pattern }) => pattern.test(text)).map(({ id }) => id);
}

function numericContextViolations(sentences = [], article = {}) {
  const evidenceSentences = [
    ...(article.verifiedFacts || article.facts || []),
    article.context,
    article.fullText,
    article.body,
    article.summary,
  ]
    .filter(Boolean)
    .flatMap(splitSourceSentences)
    .map(cleanVisibleText)
    .filter(Boolean);
  return sentences.flatMap((sentence, index) => {
    const cleanSentence = cleanVisibleText(sentence);
    const generatedBases = comparisonBases(cleanSentence);
    const numbers = cleanSentence.match(NUMBER_TOKEN) || [];
    return numbers.flatMap(number => {
      const normalizedNumber = number.replace(/[\s,]/gu, '');
      const matchingEvidence = evidenceSentences.filter(evidence => (
        evidence.replace(/[\s,]/gu, '').includes(normalizedNumber)
      ));
      if (matchingEvidence.length === 0) return [];
      const evidenceBases = matchingEvidence.map(comparisonBases);
      const preservesBasis = evidenceBases.some(bases => (
        generatedBases.every(base => bases.includes(base))
        && bases.every(base => generatedBases.includes(base))
      ));
      const isRateClaim = /%|퍼센트|성장률|증가율|감소율|상승률|하락률|GDP/iu.test(`${number} ${cleanSentence}`);
      const basisRequired = isRateClaim && evidenceBases.some(bases => bases.length > 0);
      if ((generatedBases.length > 0 || basisRequired) && !preservesBasis) {
        return [{
          index,
          number,
          generatedBases,
          evidenceBases: [...new Set(evidenceBases.flat())],
        }];
      }
      return [];
    });
  });
}

function numericBundleViolations(sentences = [], article = {}) {
  const evidenceSentences = [
    ...(article.verifiedFacts || article.facts || []),
    article.context,
    article.fullText,
    article.body,
    article.summary,
  ]
    .filter(Boolean)
    .flatMap(splitSourceSentences)
    .map(cleanVisibleText)
    .filter(Boolean);
  return sentences.flatMap((sentence, index) => {
    const cleanSentence = cleanVisibleText(sentence);
    if (!/(같은|동일(?:한|하게)?|모두.{0,20}적용)/u.test(cleanSentence)) return [];
    const numbers = [...new Set((cleanSentence.match(NUMBER_TOKEN) || [])
      .map(number => number.replace(/[\s,]/gu, '')))];
    if (numbers.length < 2) return [];
    const oneSourceSupportsBundle = evidenceSentences.some(evidence => {
      const compact = evidence.replace(/[\s,]/gu, '');
      return numbers.every(number => compact.includes(number));
    });
    return oneSourceSupportsBundle ? [] : [{ index, numbers }];
  });
}

function frameAlignmentViolations(sentences = [], frame = {}) {
  const first = cleanVisibleText(sentences[0] || '');
  const full = sentences.map(cleanVisibleText).join(' ');
  const violations = [];
  const officialDenial = frame.claimState === 'official_denial';
  const denialLanguage = /(확정된?\s*바\s*없|확정되지\s*않|확정하지\s*않|미확정|사실이\s*아니|반박|부인|해명)/u;
  if (officialDenial && !denialLanguage.test(first)) {
    violations.push('caption first sentence must preserve the official denial');
  }
  if (['reported', 'tentative'].includes(frame.claimState)
    && /(확정했|확정됐|확정되었|결정했|시행하기로\s*확정)/u.test(first)) {
    violations.push('caption cannot strengthen a reported or tentative event into a confirmed decision');
  }
  if (['asset_sale', 'gdp', 'market_move', 'legislation', 'earnings', 'medical_safety_advisory', 'political_statement'].includes(frame.eventKind)) {
    const firstLower = first.toLowerCase();
    if (!(frame.subjectTerms || []).some(term => firstLower.includes(String(term).toLowerCase()))) {
      violations.push('caption first sentence omits the primary subject');
    }
    if (!(frame.eventTerms || []).some(term => firstLower.includes(String(term).toLowerCase()))) {
      violations.push('caption first sentence omits the primary event');
    }
  }
  if (frame.attributionMode === 'single_speaker_quote' && frame.primaryActor) {
    const joinedActorPattern = new RegExp(`${frame.primaryActor}\\s*[·]`, 'u');
    if (joinedActorPattern.test(first)) {
      violations.push('caption cannot attribute a single-speaker quote to a joined list of politicians');
    }
  }
  const tangential = officialDenial
    ? []
    : (frame.forbiddenTitleTerms || []).filter(term => full.includes(term));
  if (tangential.length > 0) {
    violations.push(`caption centers a tangential event: ${tangential.join(', ')}`);
  }
  return violations;
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
  const facts = sourceSentences(article, { structuredOnly: true });
  if (facts.length < 3) {
    throw new Error('[DIEM Editorial] Deterministic fallback requires trusted structured evidence with three verified facts/context sentences');
  }
  const sentenceDrafts = [
    facts[0],
    facts[1],
    facts[2],
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
      '- 방송 기사에 포함된 [뉴스데스크], ◀ 앵커 ▶, ◀ 리포트 ▶, 영상취재/영상편집, MBC뉴스, 전화/이메일/카카오톡 제보 문구는 절대 본문이나 제목에 쓰지 않습니다.',
      '- 원문 문장 두 개가 붙은 문자열(예: "...말합니다.규모가...")은 그대로 쓰지 말고, 의미를 한 문장으로 다시 정리합니다.',
      '',
      '[2. 제목(title) 작성 규칙]',
      '- 단순 단어/키워드 나열(예: "빅테크 AI / 1400")은 절대 금지합니다.',
      '- 반드시 [핵심 주체 + 사건 + 기사 상태]가 드러나는 직관적인 훅(Hook) 형태로 작성하세요.',
      '- 표지만 읽어도 누구의 어떤 발언·결정·사건인지 이해돼야 합니다. "경기·이재명 차세대 / 예고"처럼 본문을 읽어야 뜻이 풀리는 압축 명사구는 금지합니다.',
      '- 한 사람의 발언을 여러 참석자의 공동 발언으로 넓히지 말고, 원문이 밝힌 발언 주체를 그대로 적으세요.',
      '- 기사 상태가 "부인/반박/해명/미확정"이면 제목에도 반드시 그 상태를 드러내고, 확정·결정·시행처럼 뒤집어 쓰지 마세요.',
      '- "미확정"은 공식 부인·반박 기사에서만 사용하세요. 검토·추진·예정 기사는 실제 상태어를 쓰고, 확정된 경고·권고를 미확정으로 바꾸지 마세요.',
      '- 의약품 안전 기사는 당국의 경고·권고가 발표된 사실과 의학적 인과 근거의 불확실성을 분리하세요. 제목은 실제 경고나 행동 지침을 쓰고, 근거 부족을 사건 전체의 미확정으로 표현하지 마세요.',
      '- IPO/상장 기사라면 제목에 반드시 IPO, 기업공개, 상장, 첫 거래, 증시 데뷔 중 하나를 넣으세요.',
      '- 알파벳 약어만 쓰지 말고 사건어 또는 쉬운 설명어를 함께 넣으세요. 날짜만 반복하는 제목은 금지합니다.',
      '- 선두·추격·우위가 핵심이면 누가 현재 앞서는지 명시하고, 이미 선두인 주체를 추격한다고 뒤집거나 추격 주체를 모호하게 쓰지 마세요.',
      '- 각 title은 줄바꿈(\'\\n\') 1개를 포함한 정확히 2줄이어야 하며, 두 줄 합계 공백 포함 최대 14자입니다.',
      '- 절망 시대, 완전 통과, 대박, 환호 터졌다 같은 과장어와 ↑·↓ 기호를 쓰지 마세요.',
      '- 제목·요약·본문 도입부가 말하는 하나의 주요 사건만 제목으로 삼고, 본문 뒤쪽의 이력·예정·부수 키워드를 주제로 바꾸지 마세요.',
      '- 원문이 뒷받침하는 구체적 숫자나 독자의 주거·세금·대출·직장·생활비 변화가 있으면 우선하되, 숫자·갈등·질문형을 억지로 만들지 마세요.',
      '- 특정 나이·연봉·가구를 가정해 금액을 계산하거나, 원문에 없는 손해·이득·긴급성을 만들지 마세요.',
      '- 좋은 예시:',
      '  "정부 반박\\n건보료 개편"',
      '  "CXMT IPO\\n27일 상장"',
      '  "청년 월세\\n지원 확대"',
      '',
      '[3. 본문(sentences) 작성 규칙]',
      '- 원문 문장을 절대 그대로 복사하지 말고, 에디터의 언어로 완전히 "새로 재작성(Re-writing)"하세요.',
      '- 기사 제목을 본문 문장 중 하나로 그대로 복사하지 마세요.',
      '- sentences는 정확히 3개의 문장으로 구성되며, 각 문장은 60~115자 내외로 매우 명확하고 깔끔해야 합니다.',
      '- 구체적 역할 구분:',
      '  1문장 (Hook): 이번 뉴스의 가장 결정적인 사건과 핵심 수치 요약',
      '  2문장 (Fact): 원문에 나온 가장 중요한 수치·대상·정책·기업·배경 근거',
      '  3문장 (Context): 기사나 검증 근거에 명시된 배경·전망·의미, 없으면 다음으로 중요한 사실',
      '- 기사에 없는 투자 조언, 생활 영향, 전망, 원인 분석을 새로 만들지 마세요.',
      '- 실제로 제공되지 않는 계산기, 정리본, 프로필 링크, 댓글 자료, 다음 편을 약속하지 마세요.',
      '- 어조: "~했습니다", "~로 나타났습니다", "~전망입니다" 등 격식있고 자연스러운 매거진체 하십시오.',
      '',
      '[4. 이모지 및 태그 규칙]',
      '- emojis.first는 1문장 끝, emojis.third는 3문장 끝에 가장 어울리는 직관적인 이모지 1개씩을 지정하세요.',
      '- 미성년자, 환자, 응급 이송, 사고 기사에는 👍, 😂, 🎉, 🔥, 🚀처럼 축하·재미·호응으로 읽히는 이모지를 쓰지 말고 📰처럼 중립적인 이모지를 사용하세요.',
      '- topicTags는 관련 핵심 해시태그 3~5개를 배열로 작성하세요. 반드시 띄어쓰기가 없는 단일 명사형 단어로만 작성해야 하며 문장이나 구문은 절대 금지합니다. (예: ["#주식", "#금리인하"])',
      '- imageKeyword는 기사의 핵심 대상과 사건이 사진으로 보이도록 구체적인 영문 2~5단어(예: "wedding couple cash gift", "semiconductor factory")로 지정하세요.',
      '- "government", "policy", "parliament", "law", "economy", "news" 같은 범용어만 쓰지 마세요. 정부 정책 기사라도 실제 대상이 결혼·연금·주택이면 그 대상을 사진 검색어로 쓰세요.',
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

function validateModelBody(parsed = {}, article = {}, frame = {}) {
  if (!Array.isArray(parsed.sentences) || parsed.sentences.length !== 3) {
    throw new Error('model returned invalid sentence structure');
  }
  const copiedRawSource = copiedRawSourceViolations(parsed.sentences, article);
  if (copiedRawSource.length > 0) {
    const sentenceNumbers = copiedRawSource.map(({ index }) => index + 1).join(', ');
    throw new Error(`model copied raw source wording in caption sentence ${sentenceNumbers}`);
  }
  if (!numericClaimsAreGrounded(parsed.sentences, article)) {
    const ungrounded = ungroundedNumericClaims(parsed.sentences, article)
      .map(item => `${item.number} in "${item.sentence}"`)
      .slice(0, 3)
      .join('; ');
    throw new Error(`model returned an ungrounded numeric claim: ${ungrounded}`);
  }
  const contextViolations = numericContextViolations(parsed.sentences, article);
  if (contextViolations.length > 0) {
    throw new Error(`model returned a comparison basis that conflicts with article evidence: ${JSON.stringify(contextViolations.slice(0, 3))}`);
  }
  const bundleViolations = numericBundleViolations(parsed.sentences, article);
  if (bundleViolations.length > 0) {
    throw new Error(`[DIEM Editorial] multiple numeric claims lack one shared source sentence: ${bundleViolations.map(item => item.numbers.join('+')).join(', ')}`);
  }
  const alignmentViolations = frameAlignmentViolations(parsed.sentences, frame);
  if (alignmentViolations.length > 0) {
    throw new Error(`model returned content outside the primary news frame: ${alignmentViolations.join('; ')}`);
  }
}

function titleRepairPrompt(article = {}, parsed = {}) {
  const frame = articleFrame(article);
  return {
    systemPrompt: [
      '당신은 DIEM 표지 제목 교정기입니다. 본문이나 사실을 다시 쓰지 말고 제목 후보만 교정하세요.',
      '각 후보는 줄바꿈 1개가 있는 정확히 2줄이며, 두 줄 합계 공백 포함 최대 14자입니다.',
      '짧게 만들더라도 핵심 주체와 실제 사건, 확정·예정·부인 같은 기사 상태를 반드시 보존하세요.',
      '표지만 읽고도 누구의 어떤 발언·결정·사건인지 이해돼야 하며, 해석이 필요한 압축 명사구는 다시 쓰세요.',
      '"미확정"은 공식 부인·반박 프레임에만 허용합니다. 확정된 경고·권고와 제한적인 의학 근거를 혼동하지 마세요.',
      '숫자를 쓰면 기사 근거에 있는 숫자만 사용하세요. 과장, 날짜만 있는 제목, 약어만 있는 제목은 금지합니다.',
      '오직 {"titleCandidates":[{"title":"첫줄\\n둘째줄","score":100}]} JSON만 출력하세요.',
    ].join('\n'),
    userPrompt: JSON.stringify({
      sourceTitle: article.title,
      newsFrame: frame,
      verifiedFacts: article.verifiedFacts || article.facts || [],
      acceptedCaptionSentences: parsed.sentences,
      rejectedTitleCandidates: parsed.titleCandidates || [],
    }).normalize('NFC'),
  };
}

function detailedEditorialError(attempts = [], suffix = 'try the next candidate') {
  const summary = attempts
    .filter(attempt => attempt.status === 'failed')
    .map(attempt => `${attempt.model}${attempt.stage ? `/${attempt.stage}` : ''}: ${attempt.error}`)
    .slice(-6)
    .join(' | ');
  const error = new Error(`[DIEM Editorial] Model attempts failed; ${suffix}${summary ? ` (${summary})` : ''}`);
  error.attempts = attempts;
  return error;
}

async function generateEditorial(article = {}, {
  callModel,
  primaryModel = DEFAULT_MODELS.primary,
  fallbackModel = DEFAULT_MODELS.fallback,
  handle,
  allowDeterministicFallback = false,
  promptBuilder = modelPrompt,
} = {}) {
  if (typeof callModel !== 'function') {
    if (allowDeterministicFallback) return buildDeterministicEditorial(article, { handle });
    throw new Error('[DIEM Editorial] LLM generation is required; deterministic fallback is disabled for automatic publishing');
  }
  const attempts = [];
  const prompt = promptBuilder(article);
  const frame = articleFrame(article);
  for (const model of [primaryModel, fallbackModel]) {
    try {
      const raw = await callModel({ model, ...prompt });
      const parsed = parseModelResult(raw);
      validateModelBody(parsed, article, frame);
      let candidates = normalizeModelCandidates(parsed.titleCandidates, frame).filter(c => c.valid);
      if (candidates.length < 1) {
        attempts.push({
          model,
          stage: 'title_generation',
          status: 'failed',
          error: 'model returned no valid title candidates for article frame',
        });
        try {
          const repairedRaw = await callModel({ model, ...titleRepairPrompt(article, parsed) });
          const repaired = parseModelResult(repairedRaw);
          candidates = normalizeModelCandidates(repaired.titleCandidates, frame).filter(candidate => candidate.valid);
          if (candidates.length < 1) throw new Error('title repair returned no valid title candidates for article frame');
          attempts.push({ model, stage: 'title_repair', status: 'succeeded' });
        } catch (repairError) {
          attempts.push({ model, stage: 'title_repair', status: 'failed', error: repairError.message });
          throw new Error(`title repair failed: ${repairError.message}`);
        }
      }
      if (!numericClaimsAreGrounded(candidates.map(candidate => candidate.title), article)) {
        const ungrounded = ungroundedNumericClaims(candidates.map(candidate => candidate.title), article)
          .map(item => item.number)
          .slice(0, 3)
          .join(', ');
        throw new Error(`model returned an ungrounded numeric title: ${ungrounded}`);
      }
      const augmentedArticle = { ...article, topicTags: parsed.topicTags || article.topicTags };
      attempts.push({ model, stage: 'editorial', status: 'succeeded' });
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
      if (!attempts.some(attempt => (
        attempt.model === model
        && attempt.status === 'failed'
        && attempt.error === error.message
      ))) {
        attempts.push({ model, stage: 'editorial', status: 'failed', error: error.message });
      }
    }
  }
  if (allowDeterministicFallback) {
    try {
      const fallback = buildDeterministicEditorial(article, { handle });
      fallback.generation.attempts = attempts;
      return fallback;
    } catch (error) {
      throw detailedEditorialError(attempts, `deterministic fallback rejected: ${error.message}`);
    }
  }
  throw detailedEditorialError(attempts, 'deterministic fallback is disabled; try the next candidate');
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
  if (/(미성년|\d{1,2}세|학생|환자|응급\s*이송|긴급\s*이송|사고|복통)/u.test(sourceText(article))) {
    const unsafeEmoji = new Set(['👍', '😂', '🤣', '🎉', '🥳', '🔥', '🚀', '😍']);
    if ([editorial?.emojis?.first, editorial?.emojis?.third].some(emoji => unsafeEmoji.has(emoji))) {
      errors.push('sensitive people or medical incident requires neutral, non-celebratory emoji');
    }
  }
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
  numericContextViolations(editorial?.caption?.sentences || [], article).forEach(({ index, number }) => {
    errors.push(`caption sentence ${index + 1} has a comparison basis unsupported for ${number}`);
  });
  numericBundleViolations(editorial?.caption?.sentences || [], article).forEach(({ index, numbers }) => {
    errors.push(`caption sentence ${index + 1} combines numeric claims without one shared source sentence: ${numbers.join(', ')}`);
  });
  errors.push(...frameAlignmentViolations(editorial?.caption?.sentences || [], frame));
  const copiedRawSource = copiedRawSourceViolations(editorial?.caption?.sentences || [], article);
  copiedRawSource.forEach(({ index }) => {
    errors.push(`caption sentence ${index + 1} copies raw source wording instead of summarizing`);
  });
  return { ok: errors.length === 0, errors };
}

module.exports = {
  DEFAULT_MODELS,
  buildCommentChain,
  buildDeterministicEditorial,
  buildDeterministicTitleCandidates,
  generateEditorial,
  modelPrompt,
  titleRepairPrompt,
  parseModelResult,
  selectEmojis,
  articleFrame,
  sourceSentences,
  numericContextViolations,
  validateEditorial,
};
