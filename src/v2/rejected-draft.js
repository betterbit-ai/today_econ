const crypto = require('crypto');

function credentialValues(env = process.env) {
  return Object.entries(env).filter(([key, value]) => /TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY/iu.test(key)
    && typeof value === 'string' && value.length >= 8).map(([, value]) => value);
}

function diagnosticText(value, maxBytes = 1000, { secrets = credentialValues() } = {}) {
  if (typeof value !== 'string') return null;
  // Redact before truncation so partial credentials cannot survive a byte limit.
  let text = value.normalize('NFC');
  for (const secret of secrets) if (typeof secret === 'string' && secret) text = text.split(secret.normalize('NFC')).join('[REDACTED]');
  text = text.replace(/(?:Bearer\s+)[^\s"'<>]+|\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,})/giu, '[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/giu, '[URL]')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  let bytes = 0;
  let result = '';
  for (const character of text) {
    const size = Buffer.byteLength(character);
    if (bytes + size > maxBytes) break;
    result += character; bytes += size;
  }
  return result;
}

function rejectedDraft(parsed, source = '', { secrets = credentialValues() } = {}) {
  const clean = (value, maxBytes) => diagnosticText(value, maxBytes, { secrets });
  const titleCandidates = Array.isArray(parsed?.titleCandidates) ? parsed.titleCandidates.slice(0, 3).flatMap(item => {
    const value = typeof item === 'string' ? item : typeof item?.title === 'string' ? item.title
      : Array.isArray(item?.lines) && item.lines.every(line => typeof line === 'string') ? item.lines.slice(0, 3).join('\n') : null;
    const title = clean(value, 160);
    return title === null ? [] : [{ title }];
  }) : [];
  const sentences = Array.isArray(parsed?.sentences)
    ? parsed.sentences.slice(0, 3).map(value => clean(value, 600)).filter(value => value !== null) : [];
  const result = {
    schemaVersion: 1, status: 'rejected_not_validated',
    sourceSha256: crypto.createHash('sha256').update(String(source).normalize('NFC')).digest('hex'),
    titleCandidates, sentences,
    ...(titleCandidates.length || sentences.length ? { textMayBeTruncated: true }
      : { unavailableReason: 'no_parsed_editorial_fields' }),
  };
  // JSON escaping can expand quotes/newlines even when each text field is byte-bounded.
  while (Buffer.byteLength(JSON.stringify(result)) >= 4096) {
    const fields = [...result.sentences.map((value, index) => ({ value, set: next => { result.sentences[index] = next; } })),
      ...result.titleCandidates.map(item => ({ value: item.title, set: next => { item.title = next; } }))];
    const longest = fields.sort((a, b) => b.value.length - a.value.length)[0];
    longest.set(longest.value.slice(0, Math.floor(longest.value.length / 2)));
  }
  return result;
}

module.exports = { rejectedDraft, diagnosticText };
