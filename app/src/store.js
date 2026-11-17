/**
 * Forge Key-Value Store adapter implementing the tiny store interface used by src/core/ingest.js.
 * KVS needs the storage:app scope (see manifest.yml). Values are JSON-serialised by KVS itself.
 */
import { kvs, WhereConditions } from '@forge/kvs';

export const forgeStore = {
  get: (key) => kvs.get(key),
  set: (key, value) => kvs.set(key, value),
  delete: (key) => kvs.delete(key),
  /** Page through every key that starts with `prefix` (KVS returns at most 100 per page). */
  async listByPrefix(prefix) {
    const out = [];
    let cursor;
    do {
      let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(100);
      if (cursor) q = q.cursor(cursor);
      const page = await q.getMany();
      out.push(...page.results);
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  },
};
