const crypto = require('crypto');
const path = require('path');
const { WebClient } = require('@slack/web-api');
const config = require('../../config');
const { BASIC_RELEASE_TAG_PREFIX, createTemporaryRelease } = require('../github-assets');
const { generateEditorial } = require('./editorial');
const { createGroqCaller } = require('./groq');
const {
  allLedgerPublications,
  createDailyLedger,
  emptyPublication,
  listLedgers,
  loadLedger,
  saveLedger,
} = require('./ledger');
const { sendBasicDraftPreview } = require('./notifications');
const { preparePublication, publishPreparedPublication } = require('./publisher');
const { kstDate } = require('./time');

const BASIC_CONTENT_TYPE = 'diem_basic';
const BASIC_EXPERIMENT_LIMIT = 4;

function isoWeekKey(date) {
  const value = new Date(`${date}T12:00:00+09:00`);
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7);
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function basicPublications(ledgers = []) {
  return ledgers.flatMap(ledger => allLedgerPublications(ledger).map(publication => ({ ledger, publication })))
    .filter(({ publication }) => publication.contentType === BASIC_CONTENT_TYPE);
}

function selectBasicSource(ledgers = []) {
  const usedSourceKeys = new Set(basicPublications(ledgers).map(({ publication }) => publication.source?.publicationKey).filter(Boolean));
  const candidates = ledgers.flatMap(ledger => allLedgerPublications(ledger).map(publication => ({ ledger, publication })))
    .filter(({ publication }) => publication.category === 'economy')
    .filter(({ publication }) => publication.contentType !== BASIC_CONTENT_TYPE)
    .filter(({ publication }) => publication.status === 'published' || publication.reel?.status === 'published')
    .filter(({ publication }) => publication.candidate?.url && publication.candidate?.fullText)
    .filter(({ publication }) => !usedSourceKeys.has(publication.publicationKey))
    .sort((left, right) => String(right.publication.reel?.publishedAt || right.ledger.date)
      .localeCompare(String(left.publication.reel?.publishedAt || left.ledger.date)));
  if (!candidates.length) throw new Error('[DIEM Basic] No unused published economy source is available.');
  return candidates[0];
}

function basicPrompt(article = {}) {
  return {
    systemPrompt: [
      '당신은 재테크 초보자를 위한 DIEM 기초 편집자입니다.',
      '입력 뉴스에서 초보자가 반복해서 참고할 경제 개념 하나만 골라 쉬운 정의, 기사 또는 생활 사례, 흔한 오해나 주의점으로 설명하세요.',
      '특정 금융상품 추천, 수익 약속, 매수·매도 조언, 기사에 없는 전망은 금지합니다.',
      '제목은 정확히 두 줄이고 전체 공백 포함 14자 이하여야 합니다. 질문 또는 가장 중요한 차이 하나가 드러나야 합니다.',
      'sentences는 정확히 3개입니다. 첫 문장은 쉬운 정의, 둘째는 입력 근거에 있는 사례, 셋째는 흔한 오해나 재확인할 조건입니다.',
      '각 문장은 120자 이하이며 원문을 복사하지 말고 자연스러운 존댓말 매거진체로 새로 씁니다.',
      '첫째와 셋째 문장용 이모지는 각각 하나만 지정하고 둘째 문장에는 이모지를 넣지 않습니다.',
      '입력에 없는 숫자를 만들지 마세요. 시간이 지나 바뀔 수 있는 수치는 셋째 문장에서 재확인 필요성을 알리세요.',
      'imageKeyword는 사람 얼굴이 아닌 장소·기관·제품·사물을 찾을 수 있는 구체적인 영문 2~5단어입니다.',
      '오직 JSON으로 응답하세요.',
      '{"titleCandidates":[{"title":"첫줄\\n둘째줄","score":100}],"selectedTitleIndex":0,"sentences":["쉬운 정의","기사 또는 생활 사례","오해 또는 주의점"],"emojis":{"first":"📘","third":"🔎"},"topicTags":["경제공부","재테크초보","핵심개념","금융상식"],"imageKeyword":"central bank interest rate"}',
    ].join('\n'),
    userPrompt: JSON.stringify({
      sourceTitle: article.title,
      sourceUrl: article.url,
      verifiedFacts: article.verifiedFacts || article.facts || [],
      context: article.context || '',
      source: String(article.fullText || article.summary || '').slice(0, 9000),
    }).normalize('NFC'),
  };
}

async function generateBasicEditorial(article, options = {}) {
  const educationalArticle = {
    ...article,
    category: 'economy',
    newsFrame: { eventKind: 'educational', claimState: 'confirmed', subjectTerms: [], eventTerms: [] },
    topicTags: [...new Set([...(article.topicTags || []), '경제공부', '재테크초보', '금융상식'])],
  };
  const editorial = await generateEditorial(educationalArticle, { ...options, promptBuilder: basicPrompt });
  const validation = validateBasicEditorial(editorial, educationalArticle);
  if (!validation.ok) throw new Error(`[DIEM Basic Quality] ${validation.errors.join('; ')}`);
  return { ...editorial, contentType: BASIC_CONTENT_TYPE, educationalQuality: validation };
}

function validateBasicEditorial(editorial = {}, article = {}) {
  const errors = [];
  const sentences = editorial.caption?.sentences || [];
  const text = sentences.join(' ');
  if (sentences.length !== 3) errors.push('definition, example, and caution must be exactly three sentences');
  if (!/(뜻|의미|기준|정하|가리키|개념|비율|금리|가격|제도|방식)/u.test(sentences[0] || '')) {
    errors.push('first sentence must contain a plain-language definition');
  }
  if (!/(주의|확인|다를|달라|단정|바뀔|변동|재검증|아닙니다|수s*있)/u.test(sentences[2] || '')) {
    errors.push('third sentence must state a misconception, caution, or recheck condition');
  }
  if (/(매수|매도|사세요|투자해야|수익s*(?:보장|약속)|원금s*보장|무조건s*오른)/u.test(text)) {
    errors.push('investment recommendation or return promise is prohibited');
  }
  if (!article.url) errors.push('source URL is required');
  return {
    ok: errors.length === 0,
    errors,
    checks: ['plain_definition', 'source_grounded_example', 'misconception_or_recheck', 'no_investment_advice'],
  };
}

function hashShape(publication = {}) {
  return {
    schemaVersion: publication.schemaVersion,
    publicationKey: publication.publicationKey,
    contentType: publication.contentType,
    candidate: publication.candidate ? {
      title: publication.candidate.title,
      url: publication.candidate.url,
      publishedAt: publication.candidate.publishedAt,
    } : null,
    editorial: publication.editorial,
    image: publication.image ? {
      kind: publication.image.kind,
      id: publication.image.id,
      source: publication.image.source,
      license: publication.image.license,
      visualFingerprint: publication.image.visualFingerprint,
      localSha256: publication.image.localSha256,
    } : null,
    artifacts: publication.artifacts ? {
      coverSha256: publication.artifacts.coverSha256,
      reelSha256: publication.artifacts.reelSha256,
    } : null,
    source: publication.source,
    quality: publication.quality,
  };
}

function basicContentHash(publication = {}) {
  return crypto.createHash('sha256').update(JSON.stringify(hashShape(publication)).normalize('NFC')).digest('hex');
}

function replaceHistoryPublication(ledger, publication) {
  const next = structuredClone(ledger);
  next.schemaVersion = 3;
  next.publicationHistory = Array.isArray(next.publicationHistory) ? next.publicationHistory : [];
  const index = next.publicationHistory.findIndex(item => item.publicationKey === publication.publicationKey);
  if (index >= 0) next.publicationHistory[index] = structuredClone(publication);
  else next.publicationHistory.push(structuredClone(publication));
  return next;
}

function findBasicPublication(ledgers = [], publicationKey) {
  for (const ledger of ledgers) {
    const index = (ledger.publicationHistory || []).findIndex(publication => (
      publication.publicationKey === publicationKey && publication.contentType === BASIC_CONTENT_TYPE
    ));
    if (index >= 0) return { ledger, index, publication: ledger.publicationHistory[index] };
  }
  return null;
}

function actionUrl(repository = config.githubRepository) {
  return repository ? `https://github.com/${repository}/actions/workflows/diem_economy.yml` : '';
}

async function prepareBasicDraft({
  date = kstDate(),
  ledgers = listLedgers(),
  ledger = loadLedger(date) || createDailyLedger(date),
  callModel,
  preparePublicationImpl = preparePublication,
  createReleaseImpl = createTemporaryRelease,
  sendPreviewImpl = sendBasicDraftPreview,
  saveLedgerImpl = saveLedger,
  slackClient,
  now = new Date(),
} = {}) {
  const allLedgers = ledgers.some(item => item.date === ledger.date) ? ledgers : [...ledgers, ledger];
  const basics = basicPublications(allLedgers);
  const completedOrActive = basics.filter(({ publication }) => publication.status !== 'rejected');
  if (completedOrActive.length >= BASIC_EXPERIMENT_LIMIT) {
    throw new Error('[DIEM Basic] Four-draft experiment limit reached.');
  }

  const weekKey = isoWeekKey(date);
  const sameWeek = basics
    .map(({ publication }) => publication)
    .filter(publication => publication.experiment?.weekKey === weekKey)
    .sort((left, right) => Number(right.experiment?.regeneration || 0) - Number(left.experiment?.regeneration || 0));
  const active = sameWeek.find(publication => publication.status !== 'rejected');
  if (active) return ledger;
  const regeneration = sameWeek.length ? Math.max(...sameWeek.map(item => Number(item.experiment?.regeneration || 0))) : 0;
  if (sameWeek.length && regeneration > 1) throw new Error('[DIEM Basic] Weekly regeneration limit reached.');

  const { publication: sourcePublication, ledger: sourceLedger } = selectBasicSource(allLedgers);
  const slot = `basic-${weekKey.toLowerCase()}${sameWeek.length ? '-r1' : ''}`;
  const mini = structuredClone(ledger);
  mini.publications.economy = emptyPublication(date, 'economy', slot);
  mini.publications.economy.status = 'planned';
  mini.publications.economy.candidate = {
    ...sourcePublication.candidate,
    category: 'economy',
    contentType: BASIC_CONTENT_TYPE,
    newsFrame: { eventKind: 'educational', claimState: 'confirmed', subjectTerms: [], eventTerms: [] },
  };
  mini.publications.economy.duplicateCheck = sourcePublication.duplicateCheck || null;
  const modelCaller = callModel || (config.groqApiKey ? createGroqCaller({ apiKey: config.groqApiKey }) : undefined);
  const preparedLedger = await preparePublicationImpl(mini, 'economy', {
    callModel: modelCaller,
    generateEditorialImpl: (article, options) => generateBasicEditorial(article, options),
    history: allLedgers.flatMap(item => allLedgerPublications(item)),
  });
  const prepared = structuredClone(preparedLedger.publications.economy);
  const coverPath = path.resolve(prepared.artifacts?.coverPath || '');
  const reelPath = path.resolve(prepared.artifacts?.reelPath || '');
  const release = await createReleaseImpl({
    assetPaths: [
      { path: coverPath, filename: `${prepared.publicationKey.replaceAll(':', '-')}-cover.png`, contentType: 'image/png' },
      { path: reelPath, filename: `${prepared.publicationKey.replaceAll(':', '-')}.mp4`, contentType: 'video/mp4' },
    ],
    token: config.githubToken,
    repository: config.githubRepository,
    runId: prepared.publicationKey.replaceAll(':', '-'),
    targetCommitish: config.githubSha,
    tagPrefix: BASIC_RELEASE_TAG_PREFIX,
    releaseName: `DIEM Basic draft ${weekKey}`,
    releaseBody: 'Operator-reviewed DIEM Basic preview. This draft is not auto-published to Instagram.',
  });
  const preparedAt = now.toISOString();
  let draft = {
    ...prepared,
    schemaVersion: 1,
    contentType: BASIC_CONTENT_TYPE,
    status: 'draft',
    preparedAt,
    source: {
      publicationKey: sourcePublication.publicationKey,
      title: sourcePublication.candidate.title,
      url: sourcePublication.candidate.url,
      publishedAt: sourcePublication.candidate.publishedAt || sourcePublication.reel?.publishedAt || sourceLedger.date,
      checkedAt: preparedAt,
      recheckItems: ['기사 이후 제도·수치가 바뀌었는지 발행 직전 원문과 공식자료 재확인'],
    },
    quality: {
      ok: true,
      checks: ['쉬운 정의', '근거 기반 사례', '오해·주의점', '출처·기준일', '제7일 이미지 중복 방지'],
    },
    experiment: { weekKey, regeneration: sameWeek.length ? 1 : 0, sequence: completedOrActive.length + 1 },
    review: { status: 'pending', reason: null, reviewedAt: null },
    release: {
      id: release.releaseId,
      tag: release.tag,
      htmlUrl: release.htmlUrl || null,
      imageUrls: release.imageUrls || [],
      videoUrl: release.videoUrl,
      assets: release.assets || [],
      createdAt: release.createdAt,
    },
    reel: { ...prepared.reel, status: 'ready', externalId: null },
  };
  draft.approval = { contentHash: basicContentHash(draft), approvedAt: null, approvedBy: null };
  let saved = saveLedgerImpl(replaceHistoryPublication(ledger, draft));
  const client = slackClient || (config.slackBotToken ? new WebClient(config.slackBotToken) : null);
  if (sendPreviewImpl) {
    try {
      const receipt = await sendPreviewImpl({ publication: draft, client, channelId: config.slackChannelId, actionsUrl: actionUrl() });
      draft.preview = { status: 'sent', slackTs: receipt?.ts || null, sentAt: new Date().toISOString(), error: null };
    } catch (error) {
      draft.preview = { status: 'failed', slackTs: null, sentAt: new Date().toISOString(), error: error.message };
    }
    saved = saveLedgerImpl(replaceHistoryPublication(saved, draft));
  }
  return saved;
}

async function publishBasicDraft({
  publicationKey,
  ledgers = listLedgers(),
  token = config.instagramAccessToken,
  publishPreparedPublicationImpl = publishPreparedPublication,
  saveLedgerImpl = saveLedger,
  now = new Date(),
} = {}) {
  if (!publicationKey) throw new Error('[DIEM Basic] publication_key is required.');
  const found = findBasicPublication(ledgers, publicationKey);
  if (!found) throw new Error(`[DIEM Basic] Draft not found: ${publicationKey}`);
  const draft = structuredClone(found.publication);
  if (draft.reel?.externalId || draft.status === 'published') throw new Error('[DIEM Basic] Draft is already published.');
  if (!['draft', 'approved'].includes(draft.status)) throw new Error(`[DIEM Basic] Draft status is not publishable: ${draft.status}`);
  if (!draft.approval?.contentHash || basicContentHash(draft) !== draft.approval.contentHash) {
    throw new Error('[DIEM Basic] Draft content hash mismatch; prepare a new reviewed draft.');
  }
  if (!draft.release?.videoUrl) throw new Error('[DIEM Basic] Reviewed Reel preview URL is missing.');
  if (!token) throw new Error('[DIEM Basic] Instagram token is required.');

  const originalCurrent = structuredClone(found.ledger.publications.economy);
  const sandbox = structuredClone(found.ledger);
  sandbox.publications.economy = {
    ...draft,
    status: 'ready',
    review: { ...draft.review, status: 'approved', reviewedAt: now.toISOString() },
    approval: { ...draft.approval, approvedAt: now.toISOString(), approvedBy: 'workflow_dispatch' },
  };
  const publishedSandbox = await publishPreparedPublicationImpl(sandbox, 'economy', token);
  const published = {
    ...publishedSandbox.publications.economy,
    contentType: BASIC_CONTENT_TYPE,
    review: sandbox.publications.economy.review,
    approval: sandbox.publications.economy.approval,
  };
  const restored = structuredClone(found.ledger);
  restored.publications.economy = originalCurrent;
  return saveLedgerImpl(replaceHistoryPublication(restored, published));
}

async function retryBasicPublication({
  publicationKey,
  ledgers = listLedgers(),
  token = config.instagramAccessToken,
  publishPreparedPublicationImpl = publishPreparedPublication,
  saveLedgerImpl = saveLedger,
} = {}) {
  if (!publicationKey) throw new Error('[DIEM Basic] publication_key is required.');
  const found = findBasicPublication(ledgers, publicationKey);
  if (!found) throw new Error(`[DIEM Basic] Publication not found: ${publicationKey}`);
  const publication = structuredClone(found.publication);
  if (publication.reel?.status !== 'published' || !publication.reel?.externalId) {
    throw new Error('[DIEM Basic] Operational retry requires an already published Reel.');
  }
  const incomplete = ['story', 'comment', 'reply'].some(step => (
    !['published', 'no_publish'].includes(publication[step]?.status)
  ));
  if (!incomplete) throw new Error('[DIEM Basic] No independent Story or comment step needs recovery.');
  if (basicContentHash(publication) !== publication.approval?.contentHash) {
    throw new Error('[DIEM Basic] Published content hash mismatch; use manual operational review.');
  }
  const originalCurrent = structuredClone(found.ledger.publications.economy);
  const sandbox = structuredClone(found.ledger);
  sandbox.publications.economy = publication;
  const recoveredSandbox = await publishPreparedPublicationImpl(sandbox, 'economy', token);
  const recovered = { ...recoveredSandbox.publications.economy, contentType: BASIC_CONTENT_TYPE };
  const restored = structuredClone(found.ledger);
  restored.publications.economy = originalCurrent;
  return saveLedgerImpl(replaceHistoryPublication(restored, recovered));
}

function rejectBasicDraft(ledger, publicationKey, reason, now = new Date()) {
  const next = structuredClone(ledger);
  const index = (next.publicationHistory || []).findIndex(publication => (
    publication.publicationKey === publicationKey && publication.contentType === BASIC_CONTENT_TYPE
  ));
  if (index < 0) throw new Error(`[DIEM Basic] Draft not found: ${publicationKey}`);
  const draft = next.publicationHistory[index];
  if (draft.status === 'rejected') throw new Error('[DIEM Basic] Draft is already rejected.');
  if (!['draft', 'approved'].includes(draft.status)) throw new Error(`[DIEM Basic] Draft status cannot be rejected: ${draft.status}`);
  next.publicationHistory[index] = {
    ...draft,
    status: 'rejected',
    review: { status: 'rejected', reason: String(reason || '운영자 반려').normalize('NFC'), reviewedAt: now.toISOString() },
    experiment: { ...draft.experiment, regeneration: Number(draft.experiment?.regeneration || 0) + 1 },
  };
  return next;
}

module.exports = {
  BASIC_CONTENT_TYPE,
  BASIC_EXPERIMENT_LIMIT,
  basicContentHash,
  basicPrompt,
  findBasicPublication,
  generateBasicEditorial,
  isoWeekKey,
  prepareBasicDraft,
  publishBasicDraft,
  retryBasicPublication,
  rejectBasicDraft,
  selectBasicSource,
  validateBasicEditorial,
};
