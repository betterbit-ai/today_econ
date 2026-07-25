const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { assessDuplicate } = require('./topic');

const execFileAsync = promisify(execFile);
const DEFAULT_MODEL = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';

async function computeEmbeddingSimilarities(query, corpus, {
  pythonPath = process.env.PYTHON_PATH || 'python3',
  scriptPath = path.join(__dirname, '..', '..', 'scripts', 'topic_similarity.py'),
  model = DEFAULT_MODEL,
  execFileImpl = execFileAsync,
} = {}) {
  const matrix = await computeEmbeddingMatrix([query], corpus, {
    pythonPath,
    scriptPath,
    model,
    execFileImpl,
  });
  return matrix[0] || [];
}

async function computeEmbeddingMatrix(queries, corpus, {
  pythonPath = process.env.PYTHON_PATH || 'python3',
  scriptPath = path.join(__dirname, '..', '..', 'scripts', 'topic_similarity.py'),
  model = DEFAULT_MODEL,
  execFileImpl = execFileAsync,
} = {}) {
  if (!Array.isArray(queries) || queries.length === 0 || !Array.isArray(corpus) || corpus.length === 0) return [];
  const input = JSON.stringify({ queries, corpus, model }).normalize('NFC');
  const { stdout } = await execFileImpl(pythonPath, [scriptPath], {
    input,
    maxBuffer: 1024 * 1024 * 4,
    env: { ...process.env, TOKENIZERS_PARALLELISM: 'false' },
  });
  const result = JSON.parse(stdout);
  if (!Array.isArray(result.matrix) || result.matrix.length !== queries.length) {
    throw new Error('[DIEM Similarity] embedding helper returned an invalid result');
  }
  return result.matrix.map(row => {
    if (!Array.isArray(row) || row.length !== corpus.length) throw new Error('[DIEM Similarity] embedding helper returned an invalid row');
    return row.map(Number);
  });
}

async function evaluateAgainstHistory(signature, history = [], {
  embedder = computeEmbeddingSimilarities,
  candidate,
} = {}) {
  if (history.length === 0) return {
    duplicate: false,
    method: 'no_history',
    score: 0,
    matchedPublicationKey: null,
    repeatOverride: false,
    reason: 'no_history',
  };
  try {
    const scores = await embedder(signature.text, history.map(entry => entry.signature.text));
    const evaluations = history.map((entry, index) => ({
      entry,
      result: assessDuplicate(signature, entry.signature, {
        semanticScore: scores[index],
        allowMaterialFollowUp: Boolean(candidate?.materialFollowUp),
      }),
    })).sort((a, b) => b.result.score - a.result.score);
    const best = evaluations[0];
    return {
      ...best.result,
      matchedPublicationKey: best.entry.publicationKey,
      signature,
    };
  } catch (error) {
    const evaluations = history.map(entry => ({
      entry,
      result: assessDuplicate(signature, entry.signature, {
        allowMaterialFollowUp: Boolean(candidate?.materialFollowUp),
      }),
    })).sort((a, b) => b.result.score - a.result.score);
    const best = evaluations[0];
    return {
      ...best.result,
      matchedPublicationKey: best.entry.publicationKey,
      signature,
      method: 'deterministic_fallback',
      error: error.message,
    };
  }
}

module.exports = {
  DEFAULT_MODEL,
  computeEmbeddingMatrix,
  computeEmbeddingSimilarities,
  evaluateAgainstHistory,
};
