const { BRAND, CATEGORIES } = require('./constants');

const CLICKBAIT_PATTERNS = [
  /모르면\s*손해/u,
  /결국\s*터졌다/u,
  /대체\s*왜/u,
  /충격/u,
  /소름/u,
  /무조건/u,
];
const URL_PATTERN = /https?:\/\/\S+/iu;
const HASHTAG_PATTERN = /#[0-9A-Za-z가-힣_]+/gu;
const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;
const DATE_TOKEN = /(오늘|내일|모레|어제|\d{1,2}일|\d{1,2}월)/u;
const TITLE_EVENT_TOKEN = /(IPO|기업공개|상장|첫\s*거래|증시\s*데뷔|데뷔|인상|인하|상승|하락|확대|축소|시행|폐지|확정|결정|발표|판결|규제|지원|증가|감소|돌파|합의|통과|개편|반박|부인|해명|미확정|아님|출시|거래)/iu;
const DENIAL_TITLE_TOKEN = /(확정\s*아님|미확정|반박|부인|해명|사실\s*아님|아니다|아냐|오보)/u;
const DENIAL_ALLOWED = /(확정\s*아님|미확정|확정되지\s*않)/u;

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
  if (graphemeCount(visible) > 24) errors.push('title must be at most 24 graphemes including spaces');
  if (CLICKBAIT_PATTERNS.some(pattern => pattern.test(normalized))) errors.push('title contains prohibited clickbait wording');
  if (/["“”‘’!?]{2,}|[!?]$/u.test(normalized)) errors.push('title contains unnecessary punctuation');
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

  if (frame.eventKind === 'ipo' && !/(IPO|기업공개|상장|첫\s*거래|증시\s*데뷔|데뷔)/iu.test(normalized)) {
    errors.push('IPO title must name the IPO, listing, first-trade, or market-debut event');
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
    if (graphemeCount(sentence) > 300) errors.push(`caption sentence ${index + 1} exceeds 300 graphemes`);
  });
  if (URL_PATTERN.test(normalized)) errors.push('caption cannot contain URLs');
  if (HASHTAG_PATTERN.test(normalized)) errors.push('caption cannot contain hashtags');
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
