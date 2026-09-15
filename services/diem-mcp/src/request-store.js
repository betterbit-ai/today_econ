const fs = require('fs');
const path = require('path');

const REQUEST_STORE_SCHEMA_VERSION = 1;

function emptyStore() {
  return { schemaVersion: REQUEST_STORE_SCHEMA_VERSION, results: {} };
}

class FileRequestStore {
  constructor(filePath, { fsImpl = fs } = {}) {
    this.filePath = path.resolve(filePath);
    this.fs = fsImpl;
  }

  read() {
    if (!this.fs.existsSync(this.filePath)) return emptyStore();
    try {
      const parsed = JSON.parse(this.fs.readFileSync(this.filePath, 'utf8'));
      if (parsed?.schemaVersion !== REQUEST_STORE_SCHEMA_VERSION || typeof parsed.results !== 'object') return emptyStore();
      return parsed;
    } catch {
      return emptyStore();
    }
  }

  get(key) {
    return this.read().results[key] || null;
  }

  set(key, value) {
    const state = this.read();
    state.results[key] = value;
    this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    this.fs.writeFileSync(temporary, `${JSON.stringify(state, null, 2).normalize('NFC')}\n`, { encoding: 'utf8', mode: 0o600 });
    this.fs.renameSync(temporary, this.filePath);
    return value;
  }
}

module.exports = {
  FileRequestStore,
  REQUEST_STORE_SCHEMA_VERSION,
};
