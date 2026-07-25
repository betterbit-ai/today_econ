const { CATEGORIES } = require('./constants');
const { normalizeNfc } = require('./text');

const ECONOMY_INCLUDE = /(금리|물가|환율|세금|부동산|주택|대출|예금|적금|금융|증시|고용|소득|반도체|인공지능|\bAI\b|자동차|유통|수출|수입|관세|연금)/iu;
const ISSUE_INCLUDE = /(정책|노동|고용|주거|교육|인구|복지|사회|외교|국제|전쟁|규제|법안|판결|기후|의료|보건|정부|국회)/u;
const ECONOMY_EXCLUDE = /(종목\s*추천|매수\s*추천|급등주|인사|선임|취임|업무협약|\bMOU\b|신제품\s*홍보|이벤트)/iu;
const ISSUE_EXCLUDE = /(정쟁|공방|막말|연예|스포츠|가십|화보|단독\s*사진)/u;
const SENSITIVE = /(사망|참사|재난|희생|피해자|전쟁|테러|폭발|화재|산불|침수|붕괴|실종|학대)/u;
const FOLLOW_UP = /(확정|최종|결정|판결|선고|시행|의결|기준금리|발표)/u;
const TOPIC_ALIASES = Object.freeze([
  [/한전/gu, '한국전력'],
  [/주택용/gu, '가정용'],
  [/전기료/gu, '전기요금'],
  [/의과대학/gu, '의대'],
  [/입학정원/gu, '정원'],
  [/확대\s*인원/gu, '증원 규모'],
  [/다음\s*해/gu, '내년도'],
  [/최종\s*액수/gu, '금액'],
  [/최저임금위(?!원회)/gu, '최저임금위원회'],
  [/유지/gu, '동결'],
  [/결정/gu, '확정'],
]);

function normalizeTopicAliases(value = '') {
  return TOPIC_ALIASES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    normalizeNfc(value)
  );
}

function candidateText(candidate = {}) {
  return normalizeNfc(`${candidate.title || ''} ${candidate.summary || ''} ${(candidate.entities || []).join(' ')}`);
}

function classifyCandidate(candidate = {}) {
  const text = candidateText(candidate);
  const excluded = [];
  if (ECONOMY_EXCLUDE.test(text)) excluded.push('economy_low_value');
  if (ISSUE_EXCLUDE.test(text)) excluded.push('issue_low_value');
  const economy = ECONOMY_INCLUDE.test(text) && !ECONOMY_EXCLUDE.test(text);
  const issue = ISSUE_INCLUDE.test(text) && !ISSUE_EXCLUDE.test(text);
  if (!economy && !issue) return { category: null, excluded: excluded.length ? excluded : ['category_not_allowed'] };
  if (economy && !issue) return { category: CATEGORIES.ECONOMY, excluded: [] };
  if (issue && !economy) return { category: CATEGORIES.ISSUE, excluded: [] };

  const directEconomy = /(금리|물가|환율|세금|대출|예금|적금|증시|수출|수입|관세|연금)/u.test(text);
  return { category: directEconomy ? CATEGORIES.ECONOMY : CATEGORIES.ISSUE, excluded: [], ambiguous: true };
}

function extractSignatureTokens(value = '') {
  const stop = new Set(['오늘', '관련', '대한', '위해', '이번', '정부', '기자', '뉴스', '발표']);
  return [...new Set(
    normalizeTopicAliases(value)
      .replace(/[^0-9A-Za-z가-힣\s]/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2 && !stop.has(token))
  )].slice(0, 12);
}

function buildTopicSignature(candidate = {}, category = classifyCandidate(candidate).category) {
  const tokens = extractSignatureTokens(`${candidate.title || ''} ${candidate.summary || ''}`);
  const entities = [...new Set([...(candidate.entities || []), ...tokens.filter(token => (
    /[A-Z]{2,}|\d|은행|전자|그룹|정부|위원회|부처|법|제도|정책/u.test(token)
  ))])].slice(0, 6);
  const eventTokens = tokens.filter(token => /(인상|인하|상승|하락|확대|축소|시행|폐지|확정|결정|발표|판결|규제|지원)/u.test(token));
  return {
    category,
    target: candidate.target || tokens.slice(0, 3).join(' '),
    event: candidate.event || eventTokens.slice(0, 3).join(' ') || tokens.slice(3, 6).join(' '),
    entities,
    text: normalizeTopicAliases([category, candidate.target || tokens.slice(0, 3).join(' '), candidate.event || eventTokens.join(' '), entities.join(' ')]
      .filter(Boolean)
      .join(' | ')),
  };
}

function tokenSet(value = '') {
  return new Set(extractSignatureTokens(value));
}

function jaccardSimilarity(left, right) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter(token => b.has(token)).length;
  return intersection / new Set([...a, ...b]).size;
}

function hasTargetAndEventOverlap(current = {}, previous = {}) {
  return jaccardSimilarity(current.target, previous.target) > 0
    && jaccardSimilarity(current.event, previous.event) > 0;
}

function isMaterialFollowUp(candidate = {}) {
  const text = candidateText(candidate);
  return FOLLOW_UP.test(text) && /\d/u.test(text);
}

function assessDuplicate(current, previous, {
  semanticScore,
  automaticThreshold = 0.78,
  grayThreshold = 0.68,
  allowMaterialFollowUp = false,
} = {}) {
  const score = Number.isFinite(semanticScore)
    ? semanticScore
    : jaccardSimilarity(current.text || '', previous.text || '');
  let duplicate = score >= automaticThreshold
    || (score >= grayThreshold && hasTargetAndEventOverlap(current, previous));
  let repeatOverride = false;
  if (duplicate && allowMaterialFollowUp) {
    duplicate = false;
    repeatOverride = true;
  }
  return {
    duplicate,
    repeatOverride,
    score: Number(score.toFixed(4)),
    method: Number.isFinite(semanticScore) ? 'embedding' : 'deterministic_fallback',
    reason: repeatOverride
      ? 'material_follow_up'
      : score >= automaticThreshold
        ? 'automatic_threshold'
        : score >= grayThreshold
          ? (duplicate ? 'gray_target_event_overlap' : 'gray_distinct_event')
          : 'below_threshold',
  };
}

function isSensitiveTopic(candidate = {}) {
  return SENSITIVE.test(candidateText(candidate));
}

module.exports = {
  assessDuplicate,
  buildTopicSignature,
  candidateText,
  classifyCandidate,
  extractSignatureTokens,
  hasTargetAndEventOverlap,
  isMaterialFollowUp,
  isSensitiveTopic,
  jaccardSimilarity,
  normalizeTopicAliases,
};
