const path = require('path');
const { spawn } = require('child_process');
const { assessDuplicate } = require('./topic');

const DEFAULT_MODEL = 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2';

function executeJsonProcess(command, args = [], {
  input = '',
  maxBuffer = 1024 * 1024 * 4,
  timeout = 60000,
  env = process.env,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const append = (current, chunk) => {
      const next = current + chunk.toString('utf8');
      if (Buffer.byteLength(next, 'utf8') > maxBuffer) {
        child.kill('SIGKILL');
        finish(new Error(`[DIEM Similarity] helper exceeded ${maxBuffer} bytes`));
      }
      return next;
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(new Error(`[DIEM Similarity] helper timed out after ${timeout}ms`));
    }, timeout);

    child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
    child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
    child.on('error', error => finish(error));
    child.on('close', (code, signal) => {
      if (code === 0) return finish(null, { stdout, stderr });
      const detail = stderr.trim() || `exit code ${code}${signal ? ` (${signal})` : ''}`;
      return finish(new Error(`Command failed: ${command} ${args.join(' ')}\n${detail}`));
    });
    child.stdin.on('error', error => finish(error));
    child.stdin.end(input);
  });
}

async function computeEmbeddingSimilarities(query, corpus, {
  pythonPath = process.env.PYTHON_PATH || 'python3',
  scriptPath = path.join(__dirname, '..', '..', 'scripts', 'topic_similarity.py'),
  model = DEFAULT_MODEL,
  execFileImpl,
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
  execFileImpl,
} = {}) {
  if (!Array.isArray(queries) || queries.length === 0 || !Array.isArray(corpus) || corpus.length === 0) return [];
  const input = JSON.stringify({ queries, corpus, model }).normalize('NFC');
  const processRunner = execFileImpl || executeJsonProcess;
  const { stdout } = await processRunner(pythonPath, [scriptPath], {
    input,
    maxBuffer: 1024 * 1024 * 4,
    timeout: 60000,
    env: { ...process.env, TOKENIZERS_PARALLELISM: 'false', HF_HUB_OFFLINE: '1' },
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
  referenceDate,
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
        allowMaterialFollowUp: Boolean(candidate?.materialFollowUp) && entry.date !== referenceDate,
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
        allowMaterialFollowUp: Boolean(candidate?.materialFollowUp) && entry.date !== referenceDate,
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
  executeJsonProcess,
  evaluateAgainstHistory,
};
