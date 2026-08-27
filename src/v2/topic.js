const { CATEGORIES } = require('./constants');
const { normalizeNfc } = require('./text');

const ECONOMY_CORE_TOPIC = /(금리|물가|환율|세금|부동산|주택|대출|예금|적금|금융|보험|자동차보험|손해보험|손해율|증시|고용|소득|임금|반도체|D램|HBM|자동차|유통|수출|관세|연금|IPO|기업공개|상장|공모주|공모가|주가|코스피|코스닥)/iu;
const TRADE_ECONOMY_CONTEXT = /(?:수입(?:액|품|업체|기업|시장|물가|가격|관세|규제|통관|증가|감소|급증|급감)|수출.{0,45}수입|수입.{0,45}(?:수출|무역|통관|관세|무역수지))/u;
const AI_ECONOMY_CONTEXT = /((인공지능|\bAI\b).{0,45}(투자|협력|실적|매출|상장|IPO|기업공개|증시|반도체|D램|HBM|데이터센터|수출|공장|생산|공급망|기업|산업|시장|주가)|(투자|협력|실적|매출|상장|IPO|기업공개|증시|반도체|D램|HBM|데이터센터|수출|공장|생산|공급망|기업|산업|시장|주가).{0,45}(인공지능|\bAI\b))/iu;
const PUBLIC_TRANSPORT_ECONOMY_CONTEXT = /((KTX|SRT|고속철도|철도|대중교통).{0,45}(요금|운임|할인|인하|인상|교통비)|(요금|운임|할인|인하|인상|교통비).{0,45}(KTX|SRT|고속철도|철도|대중교통))/iu;
const PRIVACY_RIGHTS_POLICY = /(개인정보|정보인권|프라이버시|기본권|동의\s*없이|원본\s*데이터|생체정보|얼굴|목소리|노동계|시민사회|특별법|법안|규제\s*특례)/u;
const ECONOMY_INCLUDE = ECONOMY_CORE_TOPIC;
const ISSUE_INCLUDE = /(정책|노동|고용|주거|교육|인구|복지|사회|외교|국제|전쟁|규제|법안|특별법|판결|기후|의료|보건|(?<!의)정부|국회|정당|당대표|선거|경선|전당대회|민주화운동|개인정보|정보인권|프라이버시|기본권|생체정보|KTX|SRT|고속철도|철도|대중교통|폭염|한파|태풍|산불|홍수|집중호우|재난|재해|중앙재난안전대책본부)/iu;
const PRIMARY_POLITICAL_EVENT = /(정당|더불어민주당|국민의힘|조국혁신당|당대표|전당대회|순회\s*경선|대표\s*경선|최고위원\s*경선|공직\s*선거|5[·.]?18\s*민주화운동)/u;
const POLITICAL_STATEMENT_ACTION = /(주장했|말했|밝혔|언급했|강조했|호소했|예고했|내세웠|약속했|“[^”]+”|‘[^’]+’)/u;
const ECONOMY_EXCLUDE = /(종목\s*추천|매수\s*추천|급등주|인사|선임|취임|업무협약|\bMOU\b|신제품\s*홍보|이벤트)/iu;
const ISSUE_EXCLUDE = /(정쟁|공방|막말|연예|스포츠|가십|화보|단독\s*사진)/u;
const SENSITIVE = /(사망|참사|재난|희생|피해자|전쟁|테러|폭발|화재|산불|침수|붕괴|실종|학대)/u;
const FOLLOW_UP = /(확정|최종|결정|판결|선고|시행|의결|기준금리|발표)/u;
const OFFICIAL_DENIAL = /(확정된?\s*바\s*없|확정되지\s*않|사실이\s*아니|사실\s*무근|부인했|반박했|해명자료|설명자료|오보|허위|잘못된\s*보도)/u;
const TENTATIVE = /(검토|논의|추진|계획|예정|가능성|전망|유력|가닥|방침|초안|보도했다|보도했)/u;
const DECIDED = /(확정|결정|의결|통과|시행|발표|인상|인하|선고|판결|도입|개편|확대|축소|폐지)/u;
const MEDICAL_SAFETY_SUBJECT = /(마운자로|위고비|GLP-?1|비만치료제|의약품|치료제|약물)/iu;
const MEDICAL_SAFETY_CONTEXT = /(임신|피임|모유\s*수유|복용|투약)/u;
const MEDICAL_AUTHORITY = /(의약품·?의료제품규제청|MHRA|식품의약품안전처|식약처|FDA|EMA|질병관리청|보건당국)/iu;
const MEDICAL_GUIDANCE_ACTION = /(경고|권고|안내|명시|주의가?\s*요구|피해야|사용하면\s*안|중단해야|투약을?\s*중단|복용을?\s*중단)/u;
const LIMITED_EVIDENCE = /(안전성\s*자료.{0,24}(?:충분하지|부족)|근거.{0,16}(?:충분하지|부족)|인과관계.{0,20}(?:확인되지|불분명)|영향을?\s*미칠\s*가능성)/u;
const IPO_EVENT = /(\bIPO\b|기업공개|상장|첫\s*거래|증시\s*데뷔|공모가|공모주)/iu;
const PRIMARY_IPO_EVENT = /(\bIPO\b|기업공개|공모가|공모주|증시\s*데뷔|첫\s*거래|신규\s*상장|상장\s*(?:예정|추진|확정|승인|신청|첫날|앞둠|나선다|한다|했다))/iu;
const BROAD_LIFE_IMPACT = /(전국|국민|청년|직장인|근로자|가구|부모|학생|환자|자영업|소상공인|임금|월급|대출|세금|보험|보험료|자동차보험|건강보험료|건보료|주거|교육|복지|의료|고용|물가|금리|환율|부동산|반도체|자동차|수출|관세|연금|KTX|SRT|고속철도|철도|대중교통|교통비|운임|폭염|한파|태풍|산불|홍수|집중호우|재난|재해)/iu;
const NARROW_OR_LOCAL = /(과수원|농가|농민|농촌|꽃눈|냉해|작물|재배|수확|축산|어촌|마을|지역축제|천연\s*패딩|곤충|반려동물|맛집|여행지)/u;
const NARROW_WITH_PUBLIC_POLICY = /(정부.{0,20}(지원|보조금|규제|법안|발표|시행)|국회|전국.{0,20}(지원|보조금|시행)|보험|세금|대출|주거|교육|복지|의료|노동|고용)/u;
const LOW_SIGNAL_NEWS = /(해프닝|온라인\s*화제|누리꾼|커뮤니티|목격담|인증샷|사진\s*한\s*장)/u;
const SENSATIONAL_ANECDOTE = /(귀신|분장|경악|황당|기이한|엽기|반전|정체|진풍경|SNS|온라인\s*화제|누리꾼|사진이?\s*퍼|응급\s*이송|긴급\s*이송|복통을?\s*호소|구조대가?\s*(?:출동|이송))/iu;
const SINGLE_PERSON_INCIDENT = /(\d{1,2}세|여학생|남학생|고등학생|중학생|초등학생|미성년|한\s*(?:남성|여성|학생|환자)|개인\s*(?:사연|사건))/u;
const PUBLIC_INTEREST_ANCHOR = /(법안|법률|정책|제도|규제|판결|정부.{0,24}(?:발표|결정|시행|확대|축소|지원)|국회|전국|국민|다수|집단|공중보건|감염병|유행|안전\s*(?:기준|대책|규정)|권리|차별|복지\s*(?:정책|제도)|교육\s*(?:정책|제도|과정)|한국\s*(?:사회|정부|국민)|중앙재난안전대책본부|재난\s*(?:대응|대책|경보)|대중교통|철도)/u;
const PRIVATE_PERSON_MARKER = /(?:\d{1,3}세\s*(?:여성|남성)|(?:여성|남성)\s*[A-Z]|[A-Z]\s*씨|피고인\s*[A-Z]?)/u;
const PRIVATE_CRIME_EVENT = /(계모임|곗돈|먹튀|사기|편취|횡령|절도|폭행|협박|성범죄|징역|실형|구속|범행|혐의)/u;
const PRIVATE_CRIME_OUTCOME = /(지방법원|지법|고등법원|고법|재판부|법정|판결|선고|징역|실형|유죄|무죄|구속)/u;
const SYSTEMIC_CRIME_ANCHOR = /((?<!의)정부|국회|법안|법률\s*개정|정책|제도|규제|대법원|헌법재판소|전원합의체|공직자|대통령|장관|국회의원|대규모|전국|다수\s*피해자|피해자\s*\d{2,}\s*명|집단\s*피해)/u;
const LOW_MISSION_FIT = /(주차\s*빌런|택시\s*승객.{0,20}알고\s*보니|성기\s*필러|음경.{0,12}(?:필러|확대)|연예인|유튜버.{0,30}(?:영상|사과|후폭풍)|CCTV\s*공개\s*후폭풍|북극곰.{0,30}(?:뱃고동|벌금)|재산분할.{0,16}(?:될까|상담|문의)|변호사에게\s*상담)/iu;
const LOW_MISSION_PUBLIC_OVERRIDE = /(정부.{0,24}(?:발표|결정|시행)|국회|법안|법률\s*개정|정책|제도\s*개편|규제|대법원|헌법재판소|공중보건|안전\s*(?:기준|대책|규정))/u;
const DISASTER_PRIMARY_EVENT = /(산사태|폭우|집중호우|침수|도로\s*붕괴|토사\s*붕괴|사망|재난|태풍|지진)/u;
const PUBLIC_HEARING_DISRUPTION = /(공청회|토론회|설명회).{0,120}(파행|난장판|아수라장|고성|욕설|몸싸움|충돌|난무)|(파행|난장판|아수라장|고성|욕설|몸싸움|충돌|난무).{0,120}(공청회|토론회|설명회)/u;
const OFFICIAL_ACTOR = /(정부|부처|복지부|보건복지부|기획재정부|금융위원회|금융감독원|국토교통부|고용노동부|교육부|대통령실|국회|공단|공사|위원회|당국|관계자)/u;
const OFFICIAL_RESPONSE = /(설명자료|해명자료|보도\s*설명|보도\s*해명|반박|부인|해명|오보|허위|사실\s*무근|보도와\s*관련|기사에서\s*언급된\s*내용)/u;
const TOPIC_ALIASES = Object.freeze([
  [/마통/gu, '마이너스통장 대출'],
  [/주담대/gu, '주택담보대출 대출'],
  [/\bKTX\b(?!\s*고속철도)/giu, 'KTX 고속철도'],
  [/\bSRT\b(?!\s*고속철도)/giu, 'SRT 고속철도'],
  [/중대본/gu, '중앙재난안전대책본부 재난 대응'],
  [/한전/gu, '한국전력'],
  [/주택용/gu, '가정용'],
  [/전기료/gu, '전기요금'],
  [/의과대학/gu, '의대'],
  [/입학정원/gu, '정원'],
  [/확대\s*인원/gu, '증원 규모'],
  [/다음\s*해/gu, '내년도'],
  [/최종\s*액수/gu, '금액'],
  [/최저임금위(?!원회)/gu, '최저임금위원회'],
  [/형소법/gu, '형사소송법'],
  [/형사소송법\s*개정안/gu, '형사소송법 개정'],
  [/유지/gu, '동결'],
  [/결정/gu, '확정'],
]);

function normalizeTopicAliases(value = '') {
  return TOPIC_ALIASES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    normalizeNfc(value)
  );
}

function inferReaderNeed(value = '') {
  const text = normalizeTopicAliases(value);
  if (/(아파트|주택|부동산|전세|월세|청약|보증금|주거)/u.test(text)) return 'housing';
  if (/(세금|과세|소득세|종부세|재산세|연말정산|세액공제)/u.test(text)) return 'tax';
  if (/(대출|금리|주담대|보금자리론|디딤돌|신용점수)/u.test(text)) return 'credit';
  if (/(월급|임금|퇴사|이직|실업급여|고용|일자리|노동|근로)/u.test(text)) return 'work';
  if (/(물가|식비|공깃밥|교통비|보험료|건보료|연금|지원금|소비쿠폰)/u.test(text)) return 'household_cost';
  if (/(주식|증시|코스피|코스닥|IPO|상장|반도체|환율|채권|ETF)/iu.test(text)) return 'market';
  return 'public_interest';
}

function candidateText(candidate = {}) {
  return normalizeTopicAliases(`${candidate.title || ''} ${candidate.summary || ''} ${(candidate.entities || []).join(' ')}`);
}

function primaryCandidateText(candidate = {}) {
  return normalizeTopicAliases(`${candidate.title || ''} ${String(candidate.summary || candidate.fullText || '').slice(0, 900)}`);
}

function isNarrowPrivateCrimeStory(candidate = {}) {
  const text = primaryCandidateText(candidate);
  return PRIVATE_PERSON_MARKER.test(text)
    && PRIVATE_CRIME_EVENT.test(text)
    && PRIVATE_CRIME_OUTCOME.test(text)
    && !SYSTEMIC_CRIME_ANCHOR.test(text);
}

function primaryPoliticalSpeaker(candidate = {}) {
  const title = normalizeNfc(candidate.title || '').trim();
  const headlineSpeaker = title.match(/^["'“‘]?([가-힣]{2,4})\s*(?=["'“‘,，])/u)?.[1];
  if (headlineSpeaker) return headlineSpeaker;
  const lead = normalizeNfc(String(candidate.summary || '').slice(0, 500));
  return lead.match(/([가-힣]{2,4})\s*후보가.{0,80}(?:주장|말|밝|언급|강조|호소|예고)/u)?.[1] || null;
}

function canonicalEventKey(text = '') {
  const normalized = normalizeTopicAliases(text);
  const criminalProcedureSubject = /(형사소송법|형소법)/u.test(normalized);
  const criminalProcedureDetail = /(보완수사권|공소기각|공소권\s*남용)/u.test(normalized);
  if (/보완수사권/u.test(normalized) || (criminalProcedureSubject && criminalProcedureDetail)) {
    return 'criminal_procedure_amendment';
  }
  if (/자동차보험/u.test(normalized) && /(적자|손해율)/u.test(normalized)) {
    return 'auto_insurance_loss';
  }
  return null;
}

function compactSubject(text = '', category = CATEGORIES.ISSUE) {
  const normalized = normalizeTopicAliases(text);
  if (PUBLIC_HEARING_DISRUPTION.test(normalized)) {
    return normalized.match(/([가-힣]{2,4})\s*(?:국방부\s*)?(?:장관|의원|대통령|총리)/u)?.[1]
      || (/국군사관학교/u.test(normalized) ? '국군사관학교' : '공청회');
  }
  if (/마운자로/u.test(normalized)) return '마운자로';
  if (/위고비/u.test(normalized)) return '위고비';
  if (/GLP-?1/iu.test(normalized)) return 'GLP-1 비만약';
  if (/(형사소송법|보완수사권|공소기각|공소권\s*남용)/u.test(normalized)) return '형사소송법';
  if (/(국내총생산|\bGDP\b|성장률)/iu.test(normalized)) return /미국|미\s*상무부/u.test(normalized) ? '미국 성장률' : '경제성장률';
  if (/(코스피|코스닥)/u.test(normalized)) return normalized.match(/(코스피|코스닥)/u)?.[0] || '한국 증시';
  if (/(시타델|시추에이셔널어웨어니스|\bSA\b)/iu.test(normalized) && /(매각|인수|보유\s*주식|포트폴리오|넘기)/u.test(normalized)) return 'SA 주식';
  if (/삼성전자/u.test(normalized) && /(실적|영업이익|매출)/u.test(normalized)) return '삼성 반도체';
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

function claimState(candidate = {}, text = primaryCandidateText(candidate), kind = eventKind(candidate, text)) {
  const title = normalizeNfc(candidate.title || '');
  const lead = normalizeNfc(`${candidate.summary || candidate.fullText || ''}`).slice(0, 500);
  if (isOfficialDenialCandidate(candidate, text)) return 'official_denial';
  if (kind === 'ipo') return 'scheduled';
  if (kind === 'medical_safety_advisory') return 'decided';
  if (kind === 'political_statement') return 'reported';
  if (/잠정\s*합의/u.test(title)) return 'tentative';
  if (kind === 'asset_sale' && /(매각|인수|넘겼|넘긴|넘기며|매수자로\s*선정)/u.test(text)) return 'decided';
  if (/(증언|주장|의혹|혐의)/u.test(`${title} ${lead}`) && !DECIDED.test(title)) return 'reported';
  if (DECIDED.test(text)) return 'decided';
  if (TENTATIVE.test(text)) return 'tentative';
  return 'reported';
}

function eventKind(candidate = {}, text = primaryCandidateText(candidate)) {
  const title = normalizeNfc(candidate.title || '');
  const politicalSpeaker = primaryPoliticalSpeaker(candidate);
  if (PUBLIC_HEARING_DISRUPTION.test(text)) return 'public_hearing_disruption';
  if (MEDICAL_SAFETY_SUBJECT.test(text)
    && MEDICAL_SAFETY_CONTEXT.test(text)
    && MEDICAL_AUTHORITY.test(text)
    && MEDICAL_GUIDANCE_ACTION.test(text)) return 'medical_safety_advisory';
  if (/(시타델|헤지펀드|포트폴리오|\bSA\b)/iu.test(text) && /(매각|인수|보유\s*주식|넘기)/u.test(text)) return 'asset_sale';
  if (PRIMARY_IPO_EVENT.test(title) || PRIMARY_IPO_EVENT.test(text)) return 'ipo';
  if (politicalSpeaker
    && POLITICAL_STATEMENT_ACTION.test(text)
    && (PRIMARY_POLITICAL_EVENT.test(text) || /(대통령|정치|정부|지지율|권력|정당|국회)/u.test(text))) {
    return 'political_statement';
  }
  if (/(국내총생산|\bGDP\b|성장률)/iu.test(text)) return 'gdp';
  if (/(코스피|코스닥|증시|주가)/u.test(text) && /(급등|급락|폭등|폭락|상승|하락|반등|반전)/u.test(text)) return 'market_move';
  if (/(형사소송법|형소법|보완수사권|법안|개정안)/u.test(text) && /(통과|개정|폐지|의결)/u.test(text)) return 'legislation';
  if (/(영업이익|순이익|실적|매출)/u.test(text)) return 'earnings';
  if (/(자동차보험|손해보험|손보사|손해율)/u.test(text) && /(적자|손해율|과잉진료|과잉수리)/u.test(text)) return 'auto_insurance_loss';
  if (/(건강보험료|건보료|보험료)/u.test(text)) return 'insurance_premium';
  if (/(기준금리|금리)/u.test(text)) return 'interest_rate';
  if (/(주거|전세|월세|주택)/u.test(text)) return 'housing_policy';
  if (/(반도체|D램|HBM|메모리)/iu.test(text)) return 'semiconductor';
  return 'general';
}

function frameEventLabel(text = '', kind = 'general') {
  if (kind === 'public_hearing_disruption') return '공청회 파행';
  if (kind === 'medical_safety_advisory') return /임신|피임/u.test(text) ? '임신 주의' : '복용 주의';
  if (kind === 'political_statement') {
    return /(제\s*2|제2|제\s*3|제3|차세대).{0,10}이재명|이재명.{0,10}(제\s*2|제2|제\s*3|제3|차세대)/u.test(text)
      ? '제2 이재명 언급'
      : '정치 발언';
  }
  if (kind === 'asset_sale') return /(매각|넘기)/u.test(text) ? '주식 매각' : '주식 인수';
  if (kind === 'ipo') return 'IPO 상장';
  if (kind === 'gdp') return /(둔화|하락|감소)/u.test(text) ? '성장률 둔화' : '성장률 변화';
  if (kind === 'market_move') return text.match(/(급등|급락|폭등|폭락|상승|하락|반등|반전)/u)?.[0] || '증시 변동';
  if (kind === 'legislation') return text.match(/(통과|개정|폐지|의결)/u)?.[0] || '법 개정';
  if (kind === 'earnings') return text.match(/(폭증|증가|감소|적자|흑자|영업이익|실적)/u)?.[0] || '실적 발표';
  if (kind === 'auto_insurance_loss') return '적자 전환';
  if (kind === 'interest_rate') return text.match(/(동결|인상|인하)/u)?.[0] || '금리 결정';
  return text.match(/(인상|인하|상승|하락|확대|축소|시행|폐지|확정|결정|판결|규제|지원|증가|감소|돌파|합의|통과|개편|전환|매각|인수)/u)?.[0] || '';
}

function frameTerms(subject, eventLabel, kind, text) {
  const subjectTerms = extractSignatureTokens(subject);
  const eventTerms = extractSignatureTokens(eventLabel);
  if (kind === 'asset_sale') {
    subjectTerms.push(...['SA', '시타델']);
    eventTerms.push(...['매각', '인수', '넘기']);
  } else if (kind === 'gdp') {
    subjectTerms.push(...['GDP', '성장률']);
    eventTerms.splice(0, eventTerms.length, ...eventTerms.filter(term => !['GDP', '성장률'].includes(term)));
    eventTerms.push(...(
      /둔화/u.test(eventLabel)
        ? ['둔화', '하락', '감소']
        : ['변화', '성장', '증가']
    ));
  } else if (kind === 'legislation') {
    subjectTerms.push(...['형사소송법', '형소법', '보완수사권']);
    eventTerms.push(...['통과', '개정', '폐지']);
  } else if (kind === 'market_move') {
    subjectTerms.push(...['코스피', '코스닥', '증시']);
  } else if (kind === 'medical_safety_advisory') {
    subjectTerms.push(...['마운자로', '위고비', 'GLP-1'].filter(term => normalizeNfc(text).includes(term)));
    eventTerms.splice(0, eventTerms.length, '피해야', '피하', '피해', '중단', '주의', '경고', '권고', '안내');
  } else if (kind === 'political_statement') {
    eventTerms.splice(
      0,
      eventTerms.length,
      '언급', '발언', '주장', '말해', '말했', '라고 했다', '밝혔', '전했',
      '호소', '강조', '비판', '평가', '전망', '지적', '진단', '예상',
      '내다', '꼬집', '경고', '설명', '분석'
    );
  } else if (kind === 'public_hearing_disruption') {
    eventTerms.splice(0, eventTerms.length, '공청회', '파행', '난장판', '아수라장', '고성', '욕설', '난무', '충돌');
  }
  return {
    subjectTerms: [...new Set(subjectTerms.filter(term => normalizeNfc(text).includes(term) || term.length >= 2))],
    eventTerms: [...new Set(eventTerms.filter(Boolean))],
  };
}

function buildNewsFrame(candidate = {}, category = classifyCandidate(candidate).category) {
  const text = primaryCandidateText(candidate);
  const evidenceText = normalizeTopicAliases(`${candidate.summary || ''} ${String(candidate.fullText || '').slice(0, 5000)}`);
  const kind = eventKind(candidate, text);
  const state = claimState(candidate, text, kind);
  const primaryActor = kind === 'political_statement' ? primaryPoliticalSpeaker(candidate) : null;
  const subject = primaryActor || compactSubject(text, category);
  const eventLabel = frameEventLabel(text, kind);
  const { subjectTerms, eventTerms } = frameTerms(subject, eventLabel, kind, text);
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
  } else if (IPO_EVENT.test(text)) {
    forbiddenTitleTerms.push('IPO', '기업공개', '공모주', '증시 데뷔');
  }
  if (kind === 'public_hearing_disruption' && /오라\s*그래/u.test(text)) {
    forbiddenTitleTerms.push('오라');
  }

  return {
    category,
    subject,
    primaryActor,
    attributionMode: primaryActor ? 'single_speaker_quote' : null,
    subjectTerms,
    eventKind: kind,
    eventLabel,
    eventTerms,
    eventKey: canonicalEventKey(text),
    claimState: state,
    evidenceState: LIMITED_EVIDENCE.test(evidenceText) ? 'limited' : 'established_or_not_stated',
    date,
    requiredTitleTerms,
    forbiddenTitleTerms,
    competitiveState: chinaLeadsBatteryShipbuilding ? 'china_leads_battery_shipbuilding' : null,
    competitiveLeader: chinaLeadsBatteryShipbuilding ? '중국' : null,
    competitiveSectors: chinaLeadsBatteryShipbuilding ? ['배터리', '조선'] : [],
    readerNeed: inferReaderNeed(text),
  };
}

function assessDiemEditorialValue(candidate = {}, category = classifyCandidate(candidate).category, frame = buildNewsFrame(candidate, category)) {
  const text = candidateText(candidate);
  const primaryLead = normalizeTopicAliases(`${candidate.title || ''} ${String(candidate.summary || '').slice(0, 420)}`);
  const signals = [];
  const penalties = [];
  const hasEconomyCore = ECONOMY_CORE_TOPIC.test(text)
    || TRADE_ECONOMY_CONTEXT.test(text)
    || AI_ECONOMY_CONTEXT.test(text)
    || PUBLIC_TRANSPORT_ECONOMY_CONTEXT.test(text);
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
  if (category === CATEGORIES.ISSUE && /(정책|노동|고용|주거|교육|인구|복지|의료|보건|규제|법안|판결|국제|철도|대중교통|폭염|한파|태풍|산불|홍수|집중호우|재난|재해)/u.test(text)) {
    score += 20;
    signals.push('issue_core_topic');
  }

  let hardReject = '';
  if (LOW_MISSION_FIT.test(primaryLead) && !LOW_MISSION_PUBLIC_OVERRIDE.test(primaryLead)) {
    score -= 80;
    penalties.push('low_mission_fit_anecdote');
    hardReject = 'low_mission_fit_anecdote';
  }
  if (category === CATEGORIES.ECONOMY && DISASTER_PRIMARY_EVENT.test(primaryLead)) {
    score -= 80;
    penalties.push('disaster_primary_event_not_economy');
    hardReject ||= 'disaster_primary_event_not_economy';
  }
  if (isNarrowPrivateCrimeStory(candidate)) {
    score -= 70;
    penalties.push('narrow_private_crime_story');
    hardReject = 'narrow_private_crime_story';
  }
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
  const text = primaryCandidateText(candidate);
  const primaryLead = normalizeTopicAliases(`${candidate.title || ''} ${String(candidate.summary || candidate.fullText || '').slice(0, 420)}`);
  if (LOW_MISSION_FIT.test(primaryLead) && !LOW_MISSION_PUBLIC_OVERRIDE.test(primaryLead)) {
    return { category: null, excluded: ['low_mission_fit_anecdote'] };
  }
  if (isNarrowPrivateCrimeStory(candidate)) {
    return { category: null, excluded: ['narrow_private_crime_story'] };
  }
  const excluded = [];
  if (ECONOMY_EXCLUDE.test(text)) excluded.push('economy_low_value');
  if (ISSUE_EXCLUDE.test(text)) excluded.push('issue_low_value');
  const economy = (ECONOMY_INCLUDE.test(text)
    || TRADE_ECONOMY_CONTEXT.test(text)
    || AI_ECONOMY_CONTEXT.test(text)
    || PUBLIC_TRANSPORT_ECONOMY_CONTEXT.test(text))
    && !ECONOMY_EXCLUDE.test(text);
  const issue = ISSUE_INCLUDE.test(text) && !ISSUE_EXCLUDE.test(text);
  if (DISASTER_PRIMARY_EVENT.test(primaryLead) && issue) {
    return { category: CATEGORIES.ISSUE, excluded: [], primaryEvent: 'public_safety' };
  }
  if (PRIMARY_POLITICAL_EVENT.test(primaryLead) && !ISSUE_EXCLUDE.test(primaryLead)) {
    return { category: CATEGORIES.ISSUE, excluded: [], primaryEvent: 'political' };
  }
  if (!economy && !issue) return { category: null, excluded: excluded.length ? excluded : ['category_not_allowed'] };
  if (economy && !issue) return { category: CATEGORIES.ECONOMY, excluded: [] };
  if (issue && !economy) return { category: CATEGORIES.ISSUE, excluded: [] };

  if (PRIVACY_RIGHTS_POLICY.test(text) && !AI_ECONOMY_CONTEXT.test(text)) {
    return { category: CATEGORIES.ISSUE, excluded: [], ambiguous: true };
  }

  const directEconomy = ECONOMY_CORE_TOPIC.test(text)
    || TRADE_ECONOMY_CONTEXT.test(text)
    || AI_ECONOMY_CONTEXT.test(text)
    || PUBLIC_TRANSPORT_ECONOMY_CONTEXT.test(text);
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
  const eventKey = canonicalEventKey(normalized);
  if (eventKey === 'criminal_procedure_amendment') {
    return {
      category,
      target: '형사소송법 개정',
      event: '수사·기소 제도 개정',
      entities: ['형사소송법', '보완수사권', '공소기각'].filter(token => normalized.includes(token)),
      eventKey,
      text: `${category} | 형사소송법 개정 | 수사 기소 제도`,
    };
  }
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
      eventKey: eventKey || 'auto_insurance_loss',
      text: normalizeTopicAliases([category, candidate.target || '자동차보험', candidate.event || event, entities.join(' ')]
        .filter(Boolean)
        .join(' | ')),
    };
  }
  const frame = buildNewsFrame(candidate, category);
  const tokens = extractSignatureTokens(`${candidate.title || ''} ${candidate.summary || ''}`);
  const entities = [...new Set([...(candidate.entities || []), ...tokens.filter(token => (
    /[A-Z]{2,}|\d|은행|전자|그룹|정부|위원회|부처|법|제도|정책/u.test(token)
  ))])].slice(0, 6);
  const eventTokens = tokens.filter(token => /(인상|인하|상승|하락|확대|축소|시행|폐지|확정|결정|발표|판결|규제|지원)/u.test(token));
  return {
    category,
    target: candidate.target || frame.subject || tokens.slice(0, 3).join(' '),
    event: candidate.event || frame.eventLabel || eventTokens.slice(0, 3).join(' ') || tokens.slice(3, 6).join(' '),
    entities,
    eventKey: eventKey || frame.eventKey || null,
    text: normalizeTopicAliases([category, candidate.target || frame.subject || tokens.slice(0, 3).join(' '), candidate.event || frame.eventLabel || eventTokens.join(' '), entities.join(' ')]
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
  if (current.eventKey && current.eventKey === previous.eventKey) return true;
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
  const currentEventKey = current.eventKey || canonicalEventKey(`${current.target || ''} ${current.event || ''} ${current.text || ''}`);
  const previousEventKey = previous.eventKey || canonicalEventKey(`${previous.target || ''} ${previous.event || ''} ${previous.text || ''}`);
  const sameCanonicalEvent = Boolean(currentEventKey && currentEventKey === previousEventKey);
  const score = sameCanonicalEvent
    ? 1
    : Number.isFinite(semanticScore)
    ? semanticScore
    : jaccardSimilarity(current.text || '', previous.text || '');
  let duplicate = sameCanonicalEvent || score >= automaticThreshold
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
      : sameCanonicalEvent
        ? 'canonical_event_key'
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
  inferReaderNeed,
  hasTargetAndEventOverlap,
  isOfficialDenialCandidate,
  isMaterialFollowUp,
  isSensitiveTopic,
  jaccardSimilarity,
  normalizeTopicAliases,
};
