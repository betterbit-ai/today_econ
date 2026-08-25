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

function createGroqVisionReviewer({ apiKey, client, model = 'qwen/qwen3.6-27b' } = {}) {
  const groq = client || (apiKey ? new Groq({ apiKey }) : null);
  if (!groq) throw new Error('[DIEM Vision] GROQ_API_KEY is required for image review.');
  return async function reviewImages({ candidate = {}, query = '', images = [] } = {}) {
    if (images.length < 1 || images.length > 3) throw new Error('[DIEM Vision] image shortlist must contain 1-3 candidates.');
    const content = [{
      type: 'text',
      text: [
        'You are the final visual safety editor for a Korean news magazine.',
        'Choose one image only if its ACTUAL pixels accurately represent the primary article event.',
        'Reject country mismatch, foreign flags or election symbols in Korean politics, unrelated people, and generic finance charts for non-market stories.',
        'Return JSON: {"ok":boolean,"selectedId":string|null,"reason":string,"evaluations":[{"id":string,"relevant":boolean,"countryMismatch":boolean,"foreignPoliticalSymbol":boolean,"unrelatedPerson":boolean,"reason":string}]}',
        JSON.stringify({ title: candidate.title, summary: String(candidate.summary || '').slice(0, 900), editorialTitle: candidate.editorialTitle, query, imageIds: images.map(image => image.id) }),
      ].join('\n').normalize('NFC'),
    }];
    for (const image of images) {
      content.push({ type: 'text', text: `IMAGE_ID=${image.id}` });
      content.push({ type: 'image_url', image_url: { url: image.downloadUrl } });
    }
    const response = await groq.chat.completions.create({
      model,
      messages: [{ role: 'user', content }],
      temperature: 0,
      max_tokens: 1000,
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(response.choices?.[0]?.message?.content || '{}');
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
  isRetryable,
  isJsonValidationFailure,
  retryAfterMs,
};
