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
    for (let attempt = 1; attempt <= retries; attempt += 1) {
      try {
        const response = await groq.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: String(systemPrompt || '').normalize('NFC') },
            { role: 'user', content: String(userPrompt || '').normalize('NFC') },
          ],
          temperature: 0.25,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        });
        return response.choices?.[0]?.message?.content || '';
      } catch (error) {
        if (!isRetryable(error) || attempt >= retries) throw error;
        const retryDelay = retryAfterMs(error);
        if (retryDelay !== null && retryDelay > maxRetryDelayMs) throw error;
        await sleep(retryDelay ?? 1000 * attempt);
      }
    }
    throw new Error('[DIEM Groq] retry loop ended unexpectedly.');
  };
}

module.exports = {
  createGroqCaller,
  headerValue,
  isRetryable,
  retryAfterMs,
};
