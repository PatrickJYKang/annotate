import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

const MAX_RECOVERY_BYTES = 16 * 1024 * 1024;
export function validatePreference(key, value) {
  if (typeof key !== 'string' || !(key === 'annotate:locale' || /^react-resizable-panels:annotate:[\w:-]+$/.test(key))) throw new Error('Unknown preference.');
  if (value !== null && (typeof value !== 'string' || value.length > 16384)) throw new Error('Invalid preference.');
  if (key === 'annotate:locale' && value !== null && !['en', 'fr', 'es', 'zh-CN'].includes(value)) throw new Error('Invalid language.');
}

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(value));
    await handle.sync();
    await handle.close();
    await rename(temporary, file);
  } finally {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
  }
}

export class UserState {
  #root;
  #preferences = {};
  #tail = Promise.resolve();
  #errors = new Map();
  constructor(root) { this.#root = root; }
  async load() {
    try {
      const parsed = JSON.parse(await readFile(path.join(this.#root, 'preferences.json'), 'utf8'));
      for (const [key, value] of Object.entries(parsed)) {
        validatePreference(key, value);
        this.#preferences[key] = value;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Preserve a damaged settings file for inspection; never overwrite recovery.
        this.#preferences = {};
        await rename(path.join(this.#root, 'preferences.json'), path.join(this.#root, `preferences-damaged-${Date.now()}.json`));
      }
    }
  }
  snapshot() { return { ...this.#preferences }; }
  #enqueue(key, operation) {
    const result = this.#tail.then(async () => {
      await operation();
      this.#errors.delete(key);
    });
    this.#tail = result.catch((error) => { this.#errors.set(key, error); });
    return result;
  }
  setPreference(key, value) {
    validatePreference(key, value);
    return this.#enqueue('preferences', async () => {
      const next = { ...this.#preferences };
      if (value === null) delete next[key]; else next[key] = value;
      await atomicJson(path.join(this.#root, 'preferences.json'), next);
      this.#preferences = next;
    });
  }
  #recoveryPath(projectRoot, resource) {
    if (typeof resource !== 'string' || !/^analysis\/clips\/[^/\\]+\/annotations\/[^/\\]+\.json$/.test(resource)) throw new Error('Invalid recovery resource.');
    // Project root is resolved by the authorized native store, never supplied by a renderer.
    const key = createHash('sha256').update(JSON.stringify([projectRoot, resource])).digest('hex');
    return path.join(this.#root, 'recovery', `${key}.json`);
  }
  async readRecovery(projectRoot, resource) {
    await this.#tail;
    try { return JSON.parse(await readFile(this.#recoveryPath(projectRoot, resource), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  writeRecovery(projectRoot, resource, entry) {
    const file = this.#recoveryPath(projectRoot, resource);
    if (!entry || typeof entry !== 'object' || !entry.data || typeof entry.contentHash !== 'string' || !Number.isFinite(Date.parse(entry.updatedAt))) throw new Error('Invalid recovery record.');
    const encoded = JSON.stringify(entry);
    if (Buffer.byteLength(encoded) > MAX_RECOVERY_BYTES) throw new Error('Recovery record is too large.');
    const snapshot = JSON.parse(encoded);
    return this.#enqueue(file, () => atomicJson(file, snapshot));
  }
  async flush() {
    await this.#tail;
    if (this.#errors.size) throw new AggregateError([...this.#errors.values()], 'Some local settings or recovery copies could not be saved. Retry saving before closing.');
  }
}
