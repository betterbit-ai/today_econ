const Groq = require('groq-sdk');

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

function retryAfterMs(error = {}) {
  const raw = headerValue(error.headers || error.response?.headers, 'retry-after');
  if (raw === null || raw === undefined || raw === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : Math.max(0, date.getTime() - Date.now());
}

function isRetryable(error = {}) {
  return Number(error.status) === 429
    || Number(error.status) >= 500
    || /rate|timeout|temporar/i.test(String(error.message || ''));
}

function isJsonValidationFailure(error = {}) {
  return Number(error.status) === 400
    && /json_validate_failed|Failed to validate JSON/iu.test(String(error.message || error.payload?.error?.message || ''));
}

function isMediaRetrievalFailure(error = {}) {
  return Number(error.status) === 400
    && /failed to retrieve media|received status code:\s*40[13]|image.*(?:403|401)/iu
      .test(String(error.message || error.payload?.error?.message || ''));
}

function parseJsonObject(value = '') {
  let text = String(value || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/iu);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return JSON.parse(text);
}

async function inlineVisionImages(images = [], {
  fetchImpl = fetch,
  maxImageBytes = 8 * 1024 * 1024,
} = {}) {
  return Promise.all(images.map(async image => {
    const response = await fetchImpl(image.downloadUrl, {
      headers: { 'User-Agent': 'DIEMNewsBot/2.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`[DIEM Vision] local image fetch failed: ${response.status}`);
    const contentType = String(response.headers?.get?.('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!/^image\/(?:jpeg|png|webp)$/u.test(contentType)) {
      throw new Error(`[DIEM Vision] unsupported local image type: ${contentType || 'unknown'}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length < 1 || buffer.length > maxImageBytes) {
      throw new Error(`[DIEM Vision] local image size outside 1-${maxImageBytes} bytes: ${buffer.length}`);
    }
    return {
      ...image,
      reviewUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
    };
  }));
}

function createGroqCaller({
  apiKey,
  client,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  maxRetryDelayMs = 60_000,
  retries = 2,
} = {}) {
  const groq = client || (apiKey ? new Groq({ apiKey }) : null);
  if (!groq) throw new Error('[DIEM Groq] GROQ_API_KEY is required for model generation.');

  return async function callModel({
    model,
    systemPrompt,
    userPrompt,
    maxTokens = 1800,
  } = {}) {
    const messages = [
      { role: 'system', content: String(systemPrompt || '').normalize('NFC') },
      { role: 'user', content: String(userPrompt || '').normalize('NFC') },
    ];
    const request = async ({ jsonMode = true } = {}) => groq.chat.completions.create({
      model,
      messages: jsonMode
        ? messages
        : [{
          role: 'system',
          content: `${messages[0].content}\nJSON mode recovery: return exactly one JSON object as plain text, with no markdown fence or commentary.`,
        }, messages[1]],
      temperature: jsonMode ? 0.25 : 0.1,
      max_tokens: maxTokens,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const response = await request({ jsonMode: true });
        return response.choices?.[0]?.message?.content || '';
      } catch (error) {
        if (isJsonValidationFailure(error)) {
          const recovered = await request({ jsonMode: false });
          return recovered.choices?.[0]?.message?.content || '';
        }
        if (!isRetryable(error) || attempt >= retries) throw error;
        const retryDelay = retryAfterMs(error);
        if (retryDelay !== null && retryDelay > maxRetryDelayMs) throw error;
        await sleep(retryDelay ?? 1000 * attempt);
      }
    }
    throw new Error('[DIEM Groq] retry loop ended unexpectedly.');
  };
}

function createGroqVisionReviewer({
  apiKey,
  client,
  model = 'qwen/qwen3.6-27b',
  fetchImpl = fetch,
  maxImageBytes = 8 * 1024 * 1024,
} = {}) {
  const groq = client || (apiKey ? new Groq({ apiKey }) : null);
  if (!groq) throw new Error('[DIEM Vision] GROQ_API_KEY is required for image review.');
  return async function reviewImages({ candidate = {}, query = '', images = [] } = {}) {
    if (images.length < 1 || images.length > 3) throw new Error('[DIEM Vision] image shortlist must contain 1-3 candidates.');
    const contentFor = (requestImages, { jsonMode = true } = {}) => {
      const content = [{
        type: 'text',
        text: [
          'You are the final visual safety editor for a Korean news magazine.',
          'Choose one image only if its ACTUAL pixels accurately represent the primary article event.',
          'Treat newsFrame subject, eventKind, and eventLabel as the locked primary event. Do not let incidental biography or background details replace it.',
          'Reject country mismatch, foreign flags or election symbols in Korean politics, unrelated people, and generic finance charts for non-market stories.',
          'Return JSON: {"ok":boolean,"selectedId":string|null,"reason":string,"evaluations":[{"id":string,"relevant":boolean,"countryMismatch":boolean,"foreignPoliticalSymbol":boolean,"unrelatedPerson":boolean,"reason":string}]}',
          ...(jsonMode ? [] : ['JSON recovery: return exactly one plain JSON object without markdown or commentary.']),
          JSON.stringify({
            title: candidate.title,
            summary: String(candidate.summary || '').slice(0, 600),
            editorialTitle: candidate.editorialTitle,
            newsFrame: candidate.newsFrame ? {
              subject: candidate.newsFrame.subject,
              eventKind: candidate.newsFrame.eventKind,
              eventLabel: candidate.newsFrame.eventLabel,
            } : null,
            query,
            imageIds: requestImages.map(image => image.id),
          }),
        ].join('\n').normalize('NFC'),
      }];
      for (const image of requestImages) {
        content.push({ type: 'text', text: `IMAGE_ID=${image.id}` });
        content.push({ type: 'image_url', image_url: { url: image.reviewUrl || image.downloadUrl } });
      }
      return content;
    };
    const request = (requestImages, { jsonMode = true } = {}) => groq.chat.completions.create({
      model,
      messages: [{ role: 'user', content: contentFor(requestImages, { jsonMode }) }],
      temperature: 0,
      max_tokens: 1000,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    });
    const requestWithJsonRecovery = async requestImages => {
      try {
        return await request(requestImages, { jsonMode: true });
      } catch (error) {
        if (!isJsonValidationFailure(error)) throw error;
        return request(requestImages, { jsonMode: false });
      }
    };
    let response;
    try {
      response = await requestWithJsonRecovery(images);
    } catch (error) {
      if (!isMediaRetrievalFailure(error)) throw error;
      const inlined = await inlineVisionImages(images, { fetchImpl, maxImageBytes });
      response = await requestWithJsonRecovery(inlined);
    }
    const parsed = parseJsonObject(response.choices?.[0]?.message?.content || '{}');
    const selected = (parsed.evaluations || []).find(item => item.id === parsed.selectedId);
    const safe = Boolean(parsed.ok && selected?.relevant
      && !selected.countryMismatch
      && !selected.foreignPoliticalSymbol
      && !selected.unrelatedPerson
      && images.some(image => image.id === parsed.selectedId));
    return {
      ok: safe,
      selectedId: safe ? parsed.selectedId : null,
      reason: parsed.reason || (safe ? 'vision_review_passed' : 'vision_review_rejected_all'),
      evaluations: Array.isArray(parsed.evaluations) ? parsed.evaluations : [],
      model,
    };
  };
}

module.exports = {
  createGroqCaller,
  createGroqVisionReviewer,
  headerValue,
  inlineVisionImages,
  isMediaRetrievalFailure,
  isRetryable,
  isJsonValidationFailure,
  retryAfterMs,
};
