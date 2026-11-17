/**
 * Ingest logic, separated from Forge storage so it can be tested with an in-memory store.
 *
 * A "store" is any object with async get(key) / set(key, value) / listByPrefix(prefix) -> [{key, value}].
 * src/store.js provides the Forge KVS implementation; test/ uses a Map.
 */
import { createHash } from 'node:crypto';
import { parseJUnit } from './junit.js';
import { appendObservation, rankTests, classify } from './flake.js';

export const MAX_RUNS = 30;

/** Forge KVS keys allow only [a-zA-Z0-9:._-#] and <= 500 chars, so tests are keyed by a short hash of their id. */
export function testKey(project, testId) {
  return `proj:${safe(project)}:test:${createHash('sha1').update(testId).digest('hex').slice(0, 20)}`;
}
export const runsKey = (project) => `proj:${safe(project)}:runs`;
export const issueKey = (project, testId) => `proj:${safe(project)}:issue:${createHash('sha1').update(testId).digest('hex').slice(0, 20)}`;
export const PROJECTS_KEY = 'projects';

/** Project names come from CI query strings: keep them short and key-safe. */
export function safe(project) {
  const p = String(project || 'default').trim().replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 64);
  return p || 'default';
}

/**
 * Store one CI run.
 * @param {object} store
 * @param {{project?:string, commit?:string, branch?:string, runId?:string, url?:string, xml:string, now?:number}} input
 */
export async function ingestRun(store, { project, commit, branch, runId, url, xml, now = Date.now() }) {
  const proj = safe(project);
  const results = parseJUnit(xml);
  const run = {
    runId: String(runId || `run-${now}`).slice(0, 80),
    commit: commit ? String(commit).slice(0, 64) : '',
    branch: branch ? String(branch).slice(0, 100) : '',
    url: url ? String(url).slice(0, 300) : '',
    ts: now,
  };

  // Ignore a duplicate upload of the same run id so CI retries of the upload step do not double count.
  const runs = (await store.get(runsKey(proj))) || [];
  if (runs.some((r) => r.runId === run.runId)) {
    return { project: proj, runId: run.runId, duplicate: true, total: results.length };
  }

  let failed = 0;
  for (const t of results) {
    if (t.status === 'fail' || t.status === 'error') failed += 1;
    const key = testKey(proj, t.id);
    const rec = (await store.get(key)) || { id: t.id, history: [] };
    rec.history = appendObservation(rec.history, { runId: run.runId, commit: run.commit, ts: now, status: t.status, message: t.message });
    rec.lastTime = t.time;
    await store.set(key, rec);
  }

  const summary = { ...run, total: results.length, failed, skipped: results.filter((t) => t.status === 'skip').length };
  await store.set(runsKey(proj), [...runs, summary].slice(-MAX_RUNS));

  const projects = (await store.get(PROJECTS_KEY)) || [];
  if (!projects.includes(proj)) await store.set(PROJECTS_KEY, [...projects, proj]);

  return { project: proj, ...summary, duplicate: false };
}

/** Load every test history of a project as { testId: history }. */
export async function loadHistories(store, project) {
  const rows = await store.listByPrefix(`proj:${safe(project)}:test:`);
  const out = {};
  for (const { value } of rows) if (value && value.id) out[value.id] = value.history || [];
  return out;
}

/** Ranked flaky + broken tests for a project. */
export async function flakyReport(store, project, limit = 10) {
  const histories = await loadHistories(store, project);
  const ranked = rankTests(histories, { limit });
  const runs = (await store.get(runsKey(project))) || [];
  return { project: safe(project), testsTracked: Object.keys(histories).length, runsStored: runs.length, tests: ranked.map(compact) };
}

/**
 * Find one test by exact id or case-insensitive substring of its id.
 * Returns { match } or { candidates } when ambiguous, or {} when nothing matches.
 */
export async function findTest(store, project, query) {
  const histories = await loadHistories(store, project);
  const ids = Object.keys(histories);
  const q = String(query || '').toLowerCase();
  const exact = ids.find((id) => id.toLowerCase() === q);
  const hits = exact ? [exact] : ids.filter((id) => id.toLowerCase().includes(q));
  if (hits.length === 1) {
    const id = hits[0];
    return { match: { id, ...classify(histories[id]), recent: histories[id].slice(-10).map((o) => ({ runId: o.runId, commit: o.commit, status: o.status, message: o.message })) } };
  }
  return hits.length ? { candidates: hits.slice(0, 10) } : {};
}

/** Small JSON for agents: drop full history, keep the evidence. */
function compact(r) {
  return {
    id: r.id,
    verdict: r.verdict,
    score: r.score,
    runs: r.runs,
    failures: r.failures,
    flipRate: r.flipRate,
    reason: r.reason,
    lastFailureMessage: r.lastFailure ? r.lastFailure.message : '',
    firstBadRun: r.firstBad ? r.firstBad.runId : undefined,
  };
}

/** Delete every stored key of one CI project (runs, tests, issue links) and drop it from the project list. */
export async function resetProject(store, project) {
  const proj = safe(project);
  const rows = await store.listByPrefix(`proj:${proj}:`);
  for (const { key } of rows) await store.delete(key);
  const projects = (await store.get(PROJECTS_KEY)) || [];
  await store.set(PROJECTS_KEY, projects.filter((p) => p !== proj));
  return { project: proj, deletedKeys: rows.length };
}
