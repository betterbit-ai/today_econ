const { CATEGORIES } = require('./constants');
const { normalizeNfc } = require('./text');

const ECONOMY_CORE_TOPIC = /(금리|물가|환율|세금|부동산|주택|대출|예금|적금|금융|보험|자동차보험|손해보험|손해율|증시|고용|소득|임금|반도체|D램|HBM|자동차|유통|수출|수입|관세|연금|IPO|기업공개|상장|공모주|공모가|주가|코스피|코스닥)/iu;
const AI_ECONOMY_CONTEXT = /((인공지능|\bAI\b).{0,45}(투자|협력|실적|매출|상장|IPO|기업공개|증시|반도체|D램|HBM|데이터센터|수출|공장|생산|공급망|기업|산업|시장|주가)|(투자|협력|실적|매출|상장|IPO|기업공개|증시|반도체|D램|HBM|데이터센터|수출|공장|생산|공급망|기업|산업|시장|주가).{0,45}(인공지능|\bAI\b))/iu;
const PRIVACY_RIGHTS_POLICY = /(개인정보|정보인권|프라이버시|기본권|동의\s*없이|원본\s*데이터|생체정보|얼굴|목소리|노동계|시민사회|특별법|법안|규제\s*특례)/u;
const ECONOMY_INCLUDE = ECONOMY_CORE_TOPIC;
const ISSUE_INCLUDE = /(정책|노동|고용|주거|교육|인구|복지|사회|외교|국제|전쟁|규제|법안|특별법|판결|기후|의료|보건|정부|국회|개인정보|정보인권|프라이버시|기본권|생체정보)/u;
const ECONOMY_EXCLUDE = /(종목\s*추천|매수\s*추천|급등주|인사|선임|취임|업무협약|\bMOU\b|신제품\s*홍보|이벤트)/iu;
const ISSUE_EXCLUDE = /(정쟁|공방|막말|연예|스포츠|가십|화보|단독\s*사진)/u;
const SENSITIVE = /(사망|참사|재난|희생|피해자|전쟁|테러|폭발|화재|산불|침수|붕괴|실종|학대)/u;
const FOLLOW_UP = /(확정|최종|결정|판결|선고|시행|의결|기준금리|발표)/u;
const OFFICIAL_DENIAL = /(확정된?\s*바\s*없|확정되지\s*않|사실이\s*아니|사실\s*무근|부인했|반박했|해명자료|설명자료|오보|허위|잘못된\s*보도)/u;
const TENTATIVE = /(검토|논의|추진|계획|예정|가능성|전망|유력|가닥|방침|초안|보도했다|보도했)/u;
const DECIDED = /(확정|결정|의결|통과|시행|발표|인상|인하|선고|판결|도입|개편|확대|축소|폐지)/u;
const IPO_EVENT = /(\bIPO\b|기업공개|상장|첫\s*거래|증시\s*데뷔|공모가|공모주)/iu;
const BROAD_LIFE_IMPACT = /(전국|국민|청년|직장인|근로자|가구|부모|학생|환자|자영업|소상공인|임금|월급|대출|세금|보험|보험료|자동차보험|건강보험료|건보료|주거|교육|복지|의료|고용|물가|금리|환율|부동산|반도체|자동차|수출|관세|연금)/iu;
const NARROW_OR_LOCAL = /(과수원|농가|농민|농촌|꽃눈|냉해|작물|재배|수확|축산|어촌|마을|지역축제|천연\s*패딩|곤충|반려동물|맛집|여행지)/u;
const NARROW_WITH_PUBLIC_POLICY = /(정부.{0,20}(지원|보조금|규제|법안|발표|시행)|국회|전국.{0,20}(지원|보조금|시행)|보험|세금|대출|주거|교육|복지|의료|노동|고용)/u;
const LOW_SIGNAL_NEWS = /(해프닝|온라인\s*화제|누리꾼|커뮤니티|목격담|인증샷|사진\s*한\s*장)/u;
const SENSATIONAL_ANECDOTE = /(귀신|분장|경악|황당|기이한|엽기|반전|정체|진풍경|SNS|온라인\s*화제|누리꾼|사진이?\s*퍼|응급\s*이송|긴급\s*이송|복통을?\s*호소|구조대가?\s*(?:출동|이송))/iu;
const SINGLE_PERSON_INCIDENT = /(\d{1,2}세|여학생|남학생|고등학생|중학생|초등학생|미성년|한\s*(?:남성|여성|학생|환자)|개인\s*(?:사연|사건))/u;
const PUBLIC_INTEREST_ANCHOR = /(법안|법률|정책|제도|규제|판결|정부.{0,24}(?:발표|결정|시행|확대|축소|지원)|국회|전국|국민|다수|집단|공중보건|감염병|유행|안전\s*(?:기준|대책|규정)|권리|차별|복지\s*(?:정책|제도)|교육\s*(?:정책|제도|과정)|한국\s*(?:사회|정부|국민))/u;
const OFFICIAL_ACTOR = /(정부|부처|복지부|보건복지부|기획재정부|금융위원회|금융감독원|국토교통부|고용노동부|교육부|대통령실|국회|공단|공사|위원회|당국|관계자)/u;
const OFFICIAL_RESPONSE = /(설명자료|해명자료|보도\s*설명|보도\s*해명|반박|부인|해명|오보|허위|사실\s*무근|보도와\s*관련|기사에서\s*언급된\s*내용)/u;
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

function compactSubject(text = '', category = CATEGORIES.ISSUE) {
  const normalized = normalizeTopicAliases(text);
  if (/(건강보험료|건보료)/u.test(normalized)) return '건보료 개편';
  if (/(자동차보험)/u.test(normalized)) return '자동차보험';
  if (/(손해보험|손보사|손해율)/u.test(normalized)) return '손해보험';
  if (/(최저임금)/u.test(normalized)) return '최저임금';
  if (/(기준금리|한국은행)/u.test(normalized)) return '기준금리';
  if (/(전세|월세|주거|주택)/u.test(normalized)) return '주거 정책';
  if (/(국민연금|연금)/u.test(normalized)) return '연금 개편';
  if (/(개인정보|정보인권|프라이버시|피지컬AI|특별법)/u.test(normalized)) return 'AI 개인정보';
  if (/(CXMT|창신메모리)/iu.test(normalized)) return 'CXMT';
  if (/(삼성전자|SK하이닉스|D램|반도체)/u.test(normalized)) return '반도체';
  if (/(관세|수출|수입)/u.test(normalized)) return '관세';
  const tokens = extractSignatureTokens(normalized)
    .filter(token => !/^(오늘|내일|어제|\d{1,2}일|\d{1,2}월)$/u.test(token));
  return tokens.slice(0, 2).join(' ') || (category === CATEGORIES.ECONOMY ? '경제 이슈' : '시사 이슈');
}

function dateLabel(text = '') {
  const normalized = normalizeNfc(text);
  if (/내일/u.test(normalized)) return '내일';
  if (/오늘/u.test(normalized)) return '오늘';
  const match = normalized.match(/(?:오는\s*)?(\d{1,2}일)/u);
  return match ? match[1] : '';
}

function isOfficialDenialCandidate(candidate = {}, text = candidateText(candidate)) {
  const title = normalizeNfc(candidate.title || '');
  const summary = normalizeNfc(candidate.summary || '');
  const lead = normalizeNfc(`${title} ${summary}`).slice(0, 900);
  if (!OFFICIAL_DENIAL.test(lead)) return false;
  if (OFFICIAL_RESPONSE.test(lead)) return true;
  return OFFICIAL_ACTOR.test(lead)
    && /(보도|기사|언급|추진|개편|인상|시행).{0,80}(확정된?\s*바\s*없|확정되지\s*않|사실이\s*아니)/u.test(lead || text);
}

function claimState(candidate = {}, text = candidateText(candidate)) {
  if (isOfficialDenialCandidate(candidate, text)) return 'official_denial';
  if (IPO_EVENT.test(text) || /(예정|나선다|데뷔한다|시작한다)/u.test(text)) return 'scheduled';
  if (DECIDED.test(text)) return 'decided';
  if (TENTATIVE.test(text)) return 'tentative';
  return 'reported';
}

function eventKind(text = '') {
  if (IPO_EVENT.test(text)) return 'ipo';
  if (/(자동차보험|손해보험|손보사|손해율)/u.test(text) && /(적자|손해율|과잉진료|과잉수리)/u.test(text)) return 'auto_insurance_loss';
  if (/(건강보험료|건보료|보험료)/u.test(text)) return 'insurance_premium';
  if (/(기준금리|금리)/u.test(text)) return 'interest_rate';
  if (/(주거|전세|월세|주택)/u.test(text)) return 'housing_policy';
  if (/(반도체|D램|HBM|메모리)/iu.test(text)) return 'semiconductor';
  return 'general';
}

function buildNewsFrame(candidate = {}, category = classifyCandidate(candidate).category) {
  const text = candidateText(candidate);
  const state = claimState(candidate, text);
  const kind = eventKind(text);
  const subject = compactSubject(`${candidate.title || ''} ${candidate.summary || ''}`, category);
  const date = dateLabel(text);
  const requiredTitleTerms = [];
  const forbiddenTitleTerms = [];
  const chinaLeadsBatteryShipbuilding = /(배터리|이차전지|전기차).{0,80}(조선)|조선.{0,80}(배터리|이차전지|전기차)/iu.test(text)
    && /중국.{0,80}(?:싹쓸이|선두|1위|우위|앞섰|앞서|점유율\s*(?:선두|1위))/u.test(text);

  if (state === 'official_denial') {
    requiredTitleTerms.push('미확정', '반박', '부인', '해명', '사실 아님');
    forbiddenTitleTerms.push('확정', '결정', '시행', '인상');
  }
  if (kind === 'ipo') {
    requiredTitleTerms.push('IPO', '기업공개', '상장', '첫 거래', '증시 데뷔', '데뷔');
  }

  return {
    category,
    subject,
    eventKind: kind,
    claimState: state,
    date,
    requiredTitleTerms,
    forbiddenTitleTerms,
    competitiveState: chinaLeadsBatteryShipbuilding ? 'china_leads_battery_shipbuilding' : null,
    competitiveLeader: chinaLeadsBatteryShipbuilding ? '중국' : null,
    competitiveSectors: chinaLeadsBatteryShipbuilding ? ['배터리', '조선'] : [],
  };
}

function assessDiemEditorialValue(candidate = {}, category = classifyCandidate(candidate).category, frame = buildNewsFrame(candidate, category)) {
  const text = candidateText(candidate);
  const signals = [];
  const penalties = [];
  const hasEconomyCore = ECONOMY_CORE_TOPIC.test(text) || AI_ECONOMY_CONTEXT.test(text);
  let score = 0;

  if (BROAD_LIFE_IMPACT.test(text)) {
    score += 35;
    signals.push('reader_money_work_life_impact');
  }
  if (DECIDED.test(text) || IPO_EVENT.test(text)) {
    score += 25;
    signals.push('concrete_event_or_decision');
  }
  if (/(전국|국민|청년|직장인|근로자|가구|기업|시장|산업|정부|국회)/u.test(text)) {
    score += 15;
    signals.push('broad_audience_or_market_scope');
  }
  if (category === CATEGORIES.ECONOMY && hasEconomyCore) {
    score += 20;
    signals.push('economy_core_topic');
  }
  if (category === CATEGORIES.ISSUE && /(정책|노동|고용|주거|교육|인구|복지|의료|보건|규제|법안|판결|국제)/u.test(text)) {
    score += 20;
    signals.push('issue_core_topic');
  }

  let hardReject = '';
  if (frame.claimState === 'official_denial') {
    score -= 50;
    penalties.push('official_denial_without_confirmed_change');
    hardReject = 'official_denial_without_confirmed_change';
  }
  if (category === CATEGORIES.ECONOMY && PRIVACY_RIGHTS_POLICY.test(text) && !hasEconomyCore) {
    score -= 50;
    penalties.push('privacy_rights_policy_not_economy');
    hardReject ||= 'privacy_rights_policy_not_economy';
  }
  if (category === CATEGORIES.ECONOMY && !hasEconomyCore) {
    score -= 35;
    penalties.push('economy_core_topic_missing');
    hardReject ||= 'economy_core_topic_missing';
  }
  if (category === CATEGORIES.ISSUE && NARROW_OR_LOCAL.test(text) && !NARROW_WITH_PUBLIC_POLICY.test(text)) {
    score -= 40;
    penalties.push('narrow_or_local_issue');
    hardReject ||= 'narrow_or_local_issue';
  }
  if (LOW_SIGNAL_NEWS.test(text)) {
    score -= 35;
    penalties.push('low_signal_click_story');
  }
  if (category === CATEGORIES.ISSUE
    && SENSATIONAL_ANECDOTE.test(text)
    && SINGLE_PERSON_INCIDENT.test(text)
    && !PUBLIC_INTEREST_ANCHOR.test(text)) {
    score -= 60;
    penalties.push('sensational_anecdote_without_public_interest');
    hardReject ||= 'sensational_anecdote_without_public_interest';
  }
  if (/상위\s*0\.01%|초고소득자/u.test(text) && !/(세금|건강보험료|건보료|부과체계|제도|정책)/u.test(text)) {
    score -= 20;
    penalties.push('too_narrow_audience');
  }

  const ok = !hardReject && score >= 45;
  return {
    ok,
    score,
    signals,
    penalties,
    reason: ok ? 'passes_editorial_value_gate' : (hardReject || 'insufficient_reader_value'),
    frame,
  };
}

function classifyCandidate(candidate = {}) {
  const text = candidateText(candidate);
  const excluded = [];
  if (ECONOMY_EXCLUDE.test(text)) excluded.push('economy_low_value');
  if (ISSUE_EXCLUDE.test(text)) excluded.push('issue_low_value');
  const economy = (ECONOMY_INCLUDE.test(text) || AI_ECONOMY_CONTEXT.test(text)) && !ECONOMY_EXCLUDE.test(text);
  const issue = ISSUE_INCLUDE.test(text) && !ISSUE_EXCLUDE.test(text);
  if (!economy && !issue) return { category: null, excluded: excluded.length ? excluded : ['category_not_allowed'] };
  if (economy && !issue) return { category: CATEGORIES.ECONOMY, excluded: [] };
  if (issue && !economy) return { category: CATEGORIES.ISSUE, excluded: [] };

  if (PRIVACY_RIGHTS_POLICY.test(text) && !AI_ECONOMY_CONTEXT.test(text)) {
    return { category: CATEGORIES.ISSUE, excluded: [], ambiguous: true };
  }

  const directEconomy = ECONOMY_CORE_TOPIC.test(text) || AI_ECONOMY_CONTEXT.test(text);
  return { category: directEconomy ? CATEGORIES.ECONOMY : CATEGORIES.ISSUE, excluded: [], ambiguous: true };
}

function extractSignatureTokens(value = '') {
  const stop = new Set(['오늘', '관련', '대한', '위해', '이번', '정부', '기자', '뉴스', '발표', '만에', '주범', '쳐도']);
  return [...new Set(
    normalizeTopicAliases(value)
      .replace(/[^0-9A-Za-z가-힣\s]/g, ' ')
      .split(/\s+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2 && !stop.has(token))
      .filter(token => !/^\d+(?:년|개월|월|일|명|개)$/u.test(token))
  )].slice(0, 12);
}

function buildTopicSignature(candidate = {}, category = classifyCandidate(candidate).category) {
  const normalized = normalizeTopicAliases(`${candidate.title || ''} ${candidate.summary || ''} ${(candidate.entities || []).join(' ')}`);
  if (/(자동차보험)/u.test(normalized)) {
    const event = /(적자|손해율)/u.test(normalized)
      ? '적자 전환'
      : /(보험료|인상|인하)/u.test(normalized)
        ? '보험료 변화'
        : '보험 이슈';
    const entities = [...new Set([
      ...(candidate.entities || []),
      '자동차보험',
      ...(['MRI', '한방병원', '손해보험'].filter(token => normalized.includes(token))),
    ])].slice(0, 6);
    return {
      category,
      target: candidate.target || '자동차보험',
      event: candidate.event || event,
      entities,
      text: normalizeTopicAliases([category, candidate.target || '자동차보험', candidate.event || event, entities.join(' ')]
        .filter(Boolean)
        .join(' | ')),
    };
  }
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
  assessDiemEditorialValue,
  buildNewsFrame,
  buildTopicSignature,
  candidateText,
  classifyCandidate,
  extractSignatureTokens,
  hasTargetAndEventOverlap,
  isOfficialDenialCandidate,
  isMaterialFollowUp,
  isSensitiveTopic,
  jaccardSimilarity,
  normalizeTopicAliases,
};
