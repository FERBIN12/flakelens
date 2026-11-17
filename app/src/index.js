/**
 * FlakeLens Forge entry points.
 *
 *  - ingestJUnit:     web trigger. CI POSTs a JUnit XML report here after each test run.
 *  - listFlakyTests:  Rovo action + MCP tool. Ranked flaky / regressed tests for a CI project.
 *  - explainTest:     Rovo action + MCP tool. Verdict and run-by-run evidence for one test.
 *  - listRecentRuns:  Rovo action + MCP tool. Last stored CI runs with pass/fail counts.
 *  - fileFlakyIssue:  Rovo action. Creates (or comments on) one Jira issue per flaky test, with evidence.
 *
 * All analysis lives in src/core (plain JS, unit tested with `npm test`); this file only adapts Forge inputs/outputs.
 */
import api, { route } from '@forge/api';
import { timingSafeEqual } from 'node:crypto';
import { forgeStore } from './store.js';
import { ingestRun, flakyReport, findTest, resetProject, runsKey, issueKey, safe, PROJECTS_KEY } from './core/ingest.js';
import { issueSummary, issueDescription } from './core/issue.js';

const json = (statusCode, obj) => ({
  statusCode,
  headers: { 'Content-Type': ['application/json'] },
  body: JSON.stringify(obj),
});

/** Header lookup that tolerates any casing (Forge passes each header as an array of strings). */
function header(req, name) {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (k.toLowerCase() === want) return Array.isArray(v) ? v[0] : v;
  }
  return undefined;
}

/** Query parameter lookup (Forge passes each as an array of strings). */
function qp(req, name) {
  const v = (req.queryParameters || {})[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Web trigger URLs are public, so every upload must carry the secret set with `forge variables set --encrypt`. */
function authorised(req) {
  const expected = process.env.FLAKELENS_INGEST_TOKEN || '';
  if (expected.length < 16) return false; // refuse to run open if the secret was never configured
  const auth = header(req, 'authorization') || '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : qp(req, 'token') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function ingestJUnit(req) {
  const method = (req.method || 'POST').toUpperCase();
  if (method !== 'POST' && method !== 'DELETE') return json(405, { error: 'POST a JUnit XML report' });
  if (!authorised(req)) return json(401, { error: 'missing or wrong token' });
  // DELETE ?project=name wipes one CI project's stored history (same token as uploads).
  if (method === 'DELETE') {
    if (!qp(req, 'project')) return json(400, { error: 'project is required' });
    return json(200, await resetProject(forgeStore, qp(req, 'project')));
  }
  try {
    const result = await ingestRun(forgeStore, {
      project: qp(req, 'project'),
      commit: qp(req, 'commit'),
      branch: qp(req, 'branch'),
      runId: qp(req, 'run'),
      url: qp(req, 'url'),
      xml: req.body || '',
    });
    return json(200, result);
  } catch (err) {
    return json(400, { error: String(err.message || err) });
  }
}

/** Rovo may omit the project; fall back to the only/first project we know. */
async function resolveProject(payload) {
  if (payload && payload.project) return safe(payload.project);
  const projects = (await forgeStore.get(PROJECTS_KEY)) || [];
  return projects[0] || 'default';
}

export async function listFlakyTests(payload) {
  const project = await resolveProject(payload);
  const limit = Math.max(1, Math.min(50, parseInt(payload && payload.limit, 10) || 10));
  const report = await flakyReport(forgeStore, project, limit);
  const projects = (await forgeStore.get(PROJECTS_KEY)) || [];
  return { ...report, knownProjects: projects };
}

export async function explainTest(payload) {
  const project = await resolveProject(payload);
  const found = await findTest(forgeStore, project, payload && payload.test);
  if (found.match) return { project, ...found.match };
  if (found.candidates) return { project, message: 'Several tests match; ask the user which one.', candidates: found.candidates };
  return { project, message: `No test matching "${payload && payload.test}" in project ${project}.` };
}

export async function listRecentRuns(payload) {
  const project = await resolveProject(payload);
  const runs = (await forgeStore.get(runsKey(project))) || [];
  const limit = Math.max(1, Math.min(30, parseInt(payload && payload.limit, 10) || 10));
  return { project, runs: runs.slice(-limit).reverse() };
}

export async function fileFlakyIssue(payload) {
  const project = await resolveProject(payload);
  const jiraProject = String((payload && payload.jiraProject) || '').trim().toUpperCase();
  if (!jiraProject) return { error: 'Ask the user for the Jira project key to file into.' };
  const found = await findTest(forgeStore, project, payload && payload.test);
  if (!found.match) return found.candidates ? { message: 'Several tests match; ask which one.', candidates: found.candidates } : { error: 'No such test.' };
  const t = found.match;
  if (t.verdict === 'healthy') return { message: `${t.id} looks healthy (${t.reason}); not filing an issue.` };

  const jira = api.asUser();
  const mapKey = issueKey(project, t.id);
  const existing = await forgeStore.get(mapKey);
  if (existing && existing.key) {
    // Same test already has an issue: add the new evidence as a comment instead of filing a duplicate.
    const res = await jira.requestJira(route`/rest/api/3/issue/${existing.key}/comment`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: issueDescription(t, project) }),
    });
    if (res.ok) return { action: 'commented', issue: existing.key, verdict: t.verdict, reason: t.reason };
    if (res.status !== 404) return { error: `Jira comment failed: HTTP ${res.status} ${await res.text()}` };
  }

  let lastErr = '';
  for (const issuetype of ['Bug', 'Task']) {
    const res = await jira.requestJira(route`/rest/api/3/issue`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          project: { key: jiraProject },
          summary: issueSummary(t),
          description: issueDescription(t, project),
          issuetype: { name: issuetype },
          labels: ['flakelens', t.verdict === 'broken' ? 'regression' : 'flaky-test'],
        },
      }),
    });
    if (res.ok) {
      const created = await res.json();
      await forgeStore.set(mapKey, { key: created.key, ts: Date.now() });
      return { action: 'created', issue: created.key, issuetype, verdict: t.verdict, reason: t.reason };
    }
    lastErr = `HTTP ${res.status} ${await res.text()}`;
  }
  return { error: `Jira create failed: ${lastErr}` };
}
