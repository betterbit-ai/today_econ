const { BRAND, CATEGORIES } = require('./constants');

const CLICKBAIT_PATTERNS = [
  /모르면\s*손해/u,
  /결국\s*터졌다/u,
  /대체\s*왜/u,
  /충격/u,
  /소름/u,
  /무조건/u,
];
const SENSATIONAL_TITLE_PATTERN = /(절망\s*시대|완전\s*통과|환호\s*터|대박|기대\s*[↑↓]|[↑↓])/u;
const URL_PATTERN = /https?:\/\/\S+/iu;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/iu;
const HASHTAG_PATTERN = /#[0-9A-Za-z가-힣_]+/gu;
const MENTION_PATTERN = /@[0-9A-Za-z가-힣_.]+/u;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const DATE_TOKEN = /(오늘|내일|모레|어제|\d{1,2}일|\d{1,2}월)/u;
const TITLE_EVENT_TOKEN = /(IPO|기업공개|상장|첫\s*거래|증시\s*데뷔|데뷔|인상|인하|상승|하락|둔화|확대|축소|시행|폐지|확정|결정|발표|판결|규제|지원|증가|감소|돌파|합의|통과|개편|전환|반박|부인|해명|미확정|아님|출시|거래)/iu;
const DENIAL_TITLE_TOKEN = /(확정\s*아님|미확정|반박|부인|해명|사실\s*아님|아니다|아냐|오보)/u;
const DENIAL_ALLOWED = /(확정\s*아님|미확정|확정되지\s*않)/u;
const GENERIC_TITLE_LINE = /^(흐름\s*정리|쟁점\s*정리|경제\s*브리핑|시사\s*브리핑|오늘\s*경제|오늘\s*시사)$/u;
const CAPTION_BOILERPLATE_PATTERN = /(▲|■|◇|◆|ⓒ|©|자료\s*사진|사진\s*=|프레스\s*컨퍼런스|무대에\s*공개|기념\s*촬영|제공\s*사진|연합뉴스|뉴스1|뉴시스|로이터|AP|EPA|게티이미지|뉴스데스크|앵커|리포트|영상취재|영상편집|MBC\s*뉴스|MBC뉴스|제보|전화|이메일|카카오톡)/iu;
const PHONE_OR_CONTACT_PATTERN = /(?:\b\d{2,4}-\d{3,4}-\d{4}\b|전화\s*\d|카카오톡|제보|이메일)/u;
const NUMERIC_TITLE_TOKEN = /\d+(?:[.,]\d+)?(?:\s*(?:%|퍼센트|조\s*원|억\s*원|만\s*원|원|만\s*명|명|개|배|년|개월|월|일))?/gu;
const STANDALONE_WEAK_TITLE_LINE = /^(?:오늘|내일|모레|어제|\d+(?:[.,]\d+)?(?:%|퍼센트|조원|억원|만원|원|만명|명|개|배|년|개월|월|일)?)$/iu;
const INCOMPLETE_FRAGMENT_ENDING = /(다는|라는|이라는|했다는|됐다는|받았다는|나왔다는|있다는|없다는|한다는|추진한다는|허용한다는)[.!?。！？]?(?:\p{Extended_Pictographic})?$/u;

function normalizeNfc(value = '') {
  return String(value ?? '').normalize('NFC');
}

function graphemes(value = '') {
  const text = normalizeNfc(value);
  if (typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter('ko', { granularity: 'grapheme' });
    return [...segmenter.segment(text)].map(item => item.segment);
  }
  return Array.from(text);
}

function graphemeCount(value = '') {
  return graphemes(value).length;
}

function extractEmojiClusters(value = '') {
  return graphemes(value).filter(cluster => EMOJI_PATTERN.test(cluster));
}

function stripEmojiClusters(value = '') {
  return graphemes(value).filter(cluster => !EMOJI_PATTERN.test(cluster)).join('');
}

function numericTitleTokens(value = '') {
  return normalizeNfc(value)
    .match(NUMERIC_TITLE_TOKEN)?.map(token => token.replace(/[\s,]/gu, '')) || [];
}

function sentencePunctuationCount(value = '') {
  const plain = stripEmojiClusters(value)
    .replace(EMAIL_PATTERN, 'EMAIL')
    .replace(/(\d)\.(\d)/gu, '$1§$2');
  return (plain.match(/[.!?。！？]/gu) || []).length;
}

function endsWithSingleEmoji(value = '') {
  const clusters = graphemes(String(value).trim());
  if (clusters.length === 0) return false;
  const emojis = clusters.filter(cluster => EMOJI_PATTERN.test(cluster));
  return emojis.length === 1 && EMOJI_PATTERN.test(clusters.at(-1));
}

function validateTitle(title) {
  const normalized = normalizeNfc(title).trim();
  const lines = normalized.split('\n');
  const visible = lines.join('');
  const errors = [];
  if (lines.length !== 2 || lines.some(line => !line.trim())) errors.push('title must contain exactly two non-empty lines');
  if (graphemeCount(visible) > 14) errors.push('title must be at most 14 graphemes including spaces');
  if (CLICKBAIT_PATTERNS.some(pattern => pattern.test(normalized))) errors.push('title contains prohibited clickbait wording');
  if (SENSATIONAL_TITLE_PATTERN.test(normalized)) errors.push('title contains sensational or mechanical shorthand');
  if (/["“”‘’!?]{2,}|[!?]$/u.test(normalized)) errors.push('title contains unnecessary punctuation');
  if (lines.some(line => GENERIC_TITLE_LINE.test(line.replace(/\s+/gu, '').trim()))) {
    errors.push('title contains generic filler wording');
  }
  if (lines.some(line => STANDALONE_WEAK_TITLE_LINE.test(line.replace(/\s+/gu, '').trim()))) {
    errors.push('title line cannot be only a date, duration, or number');
  }
  const numericTokens = numericTitleTokens(normalized);
  if (numericTokens.some((token, index) => numericTokens.indexOf(token) !== index)) {
    errors.push('title repeats the same numeric/date token');
  }
  return {
    ok: errors.length === 0,
    errors,
    normalized,
    lines,
    graphemeCount: graphemeCount(visible),
    recommendedLineLengths: lines.map(graphemeCount),
  };
}

function validateTitleAgainstFrame(title, frame = {}) {
  const basic = validateTitle(title);
  const errors = [...basic.errors];
  const normalized = basic.normalized || normalizeNfc(title).trim();
  const compact = normalized.replace(/\s+/gu, '');
  const strippedDenial = normalized.replace(DENIAL_ALLOWED, '');

  if (frame.claimState === 'official_denial') {
    if (!DENIAL_TITLE_TOKEN.test(normalized)) {
      errors.push('official-denial title must say the claim is unconfirmed, denied, or rebutted');
    }
    if (/(확정|결정|시행|인상|올린다|오른다)/u.test(strippedDenial)) {
      errors.push('official-denial title cannot present the denied claim as confirmed');
    }
  }
  if (frame.claimState !== 'official_denial' && DENIAL_TITLE_TOKEN.test(normalized)) {
    errors.push('title cannot label a reported, scheduled, or confirmed event as unconfirmed or denied');
  }

  if (frame.eventKind === 'ipo' && !/(IPO|기업공개|상장|첫\s*거래|증시\s*데뷔|데뷔)/iu.test(normalized)) {
    errors.push('IPO title must name the IPO, listing, first-trade, or market-debut event');
  }

  const forbiddenSearchText = frame.claimState === 'official_denial' ? strippedDenial : normalized;
  const forbiddenTerms = (frame.forbiddenTitleTerms || [])
    .filter(Boolean)
    .filter(term => forbiddenSearchText.includes(term));
  if (forbiddenTerms.length > 0) {
    errors.push(`title contains a tangential or contradicted event: ${forbiddenTerms.join(', ')}`);
  }

  if (['asset_sale', 'gdp', 'market_move', 'legislation', 'earnings', 'medical_safety_advisory', 'political_statement'].includes(frame.eventKind)) {
    const lower = normalized.toLowerCase();
    const hasSubject = (frame.subjectTerms || []).some(term => lower.includes(String(term).toLowerCase()));
    const hasEvent = (frame.eventTerms || []).some(term => lower.includes(String(term).toLowerCase()));
    if (!hasSubject) errors.push('title must name the primary subject');
    if (!hasEvent) errors.push('title must name the primary event');
  }

  if (DATE_TOKEN.test(normalized) && !TITLE_EVENT_TOKEN.test(normalized)) {
    errors.push('date-based title must include the actual event, not only a date');
  }

  if (/\b[A-Z]{2,}\b/u.test(normalized) && !TITLE_EVENT_TOKEN.test(normalized) && !/(반도체|D램|기업|정책|금리|주가|시장)/u.test(normalized)) {
    errors.push('acronym title must include an event or plain-language descriptor');
  }

  if (/^(?:[A-Z]{2,}|오늘|내일|모레|\d{1,2}일)+$/iu.test(compact)) {
    errors.push('title cannot be only an acronym and date');
  }

  if (frame.competitiveState === 'china_leads_battery_shipbuilding') {
    if (/(?:중국|中)\s*(?:이|은)?\s*추격/u.test(normalized)) {
      errors.push('competitive title cannot describe China as chasing when China already leads the named sectors');
    }
    if (!/((?:중국|中).{0,6}(?:선두|1위|우위|독주|앞서)|중국에.{0,6}(?:밀려|뒤져|뒤처져)|배터리.{0,12}조선.{0,12}(?:중국|中).{0,6}(?:선두|우위))/u.test(normalized)) {
      errors.push('competitive title must make the current leader and direction explicit');
    }
  }

  return {
    ...basic,
    ok: errors.length === 0,
    errors,
  };
}

function validateCaption(caption) {
  const normalized = normalizeNfc(caption).trim();
  const sentences = normalized.split('\n\n');
  const errors = [];
  if (sentences.length !== 3 || sentences.some(sentence => !sentence.trim())) {
    errors.push('caption must contain exactly three sentences separated by one blank line');
  }
  if (sentences.some(sentence => sentence.includes('\n'))) errors.push('caption sentences cannot contain internal line breaks');
  sentences.forEach((sentence, index) => {
    if (graphemeCount(sentence) > 120) errors.push(`caption sentence ${index + 1} exceeds 120 graphemes`);
  });
  if (URL_PATTERN.test(normalized)) errors.push('caption cannot contain URLs');
  if (EMAIL_PATTERN.test(normalized)) errors.push('caption cannot contain email addresses');
  if (PHONE_OR_CONTACT_PATTERN.test(normalized)) errors.push('caption cannot contain newsroom contact or tip-off text');
  if (MENTION_PATTERN.test(normalized)) errors.push('caption cannot contain account mentions');
  if (HASHTAG_PATTERN.test(normalized)) errors.push('caption cannot contain hashtags');
  if (CAPTION_BOILERPLATE_PATTERN.test(normalized)) errors.push('caption contains source boilerplate or photo caption text');
  sentences.forEach((sentence, index) => {
    if (sentencePunctuationCount(sentence) > 1) {
      errors.push(`caption sentence ${index + 1} contains multiple source sentences`);
    }
    if (INCOMPLETE_FRAGMENT_ENDING.test(sentence.trim())) {
      errors.push(`caption sentence ${index + 1} ends with an incomplete source fragment`);
    }
  });
  if (sentences[0] && !endsWithSingleEmoji(sentences[0])) errors.push('caption sentence 1 must end with exactly one emoji');
  if (sentences[1] && extractEmojiClusters(sentences[1]).length !== 0) errors.push('caption sentence 2 cannot contain emoji');
  if (sentences[2] && !endsWithSingleEmoji(sentences[2])) errors.push('caption sentence 3 must end with exactly one emoji');
  return { ok: errors.length === 0, errors, normalized, sentences };
}

function normalizeHandle(value = BRAND.primaryHandle) {
  return String(value || BRAND.primaryHandle).trim().replace(/^@+/, '').normalize('NFC');
}

function normalizeHashtag(value = '') {
  const clean = normalizeNfc(value).trim().replace(/^#+/, '').replace(/[.\s]/g, '');
  return clean ? `#${clean}` : '';
}

function uniqueHashtags(values = []) {
  return [...new Set(values.map(normalizeHashtag).filter(Boolean))];
}

function buildHashtagReply({
  category,
  handle,
  topicTags = [],
  audienceTags = ['재테크초보', '뉴스요약', '릴스'],
} = {}) {
  const sector = category === CATEGORIES.ISSUE
    ? ['시사', '정책', '오늘의뉴스']
    : ['경제', '금융', '경제뉴스'];
  const brand = BRAND.hashtags;
  const topic = topicTags.slice(0, 6);
  let hashtags = uniqueHashtags([...sector, ...audienceTags.slice(0, 3), ...brand, ...topic]).slice(0, 15);
  while (hashtags.length < 12) {
    const fill = category === CATEGORIES.ISSUE
      ? ['사회이슈', '시사브리핑', '데일리뉴스']
      : ['경제공부', '재테크', '경제브리핑'];
    hashtags = uniqueHashtags([...hashtags, ...fill]).slice(0, 15);
    if (hashtags.length < 12) break;
  }
  return {
    full: `@${normalizeHandle(handle)} ${hashtags.join(' ')}`.trim(),
    hashtags,
    compact: `@${normalizeHandle(handle)} ${uniqueHashtags([...sector.slice(0, 2), ...brand]).slice(0, 5).join(' ')}`.trim(),
  };
}

function validateHashtagReply(reply, { handle } = {}) {
  const normalized = normalizeNfc(reply).trim();
  const expectedMention = `@${normalizeHandle(handle)}`;
  const hashtags = normalized.match(HASHTAG_PATTERN) || [];
  const errors = [];
  if (!normalized.startsWith(expectedMention)) errors.push('hashtag reply must start with the configured account mention');
  if (hashtags.length < 12 || hashtags.length > 15) errors.push('hashtag reply must contain 12-15 hashtags');
  if (new Set(hashtags).size !== hashtags.length) errors.push('hashtag reply contains duplicate hashtags');
  if (hashtags.some(tag => /[.\s]/u.test(tag))) errors.push('hashtags cannot contain dots or spaces');
  return { ok: errors.length === 0, errors, normalized, hashtags };
}

module.exports = {
  buildHashtagReply,
  endsWithSingleEmoji,
  extractEmojiClusters,
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
};
