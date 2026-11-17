import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ingestRun, flakyReport, findTest, resetProject, safe, testKey } from '../src/core/ingest.js';
import { issueSummary, issueDescription } from '../src/core/issue.js';

function memStore() {
  const m = new Map();
  return {
    m,
    get: async (k) => (m.has(k) ? structuredClone(m.get(k)) : undefined),
    set: async (k, v) => void m.set(k, structuredClone(v)),
    delete: async (k) => void m.delete(k),
    listByPrefix: async (pre) => [...m.entries()].filter(([k]) => k.startsWith(pre)).map(([key, value]) => ({ key, value })),
  };
}
const xml = (upload, login = 'pass') => `<testsuite name="s">
  <testcase classname="api" name="login">${login === 'pass' ? '' : '<failure message="401"/>'}</testcase>
  <testcase classname="api" name="upload">${upload === 'pass' ? '' : '<failure message="TimeoutError"/>'}</testcase>
</testsuite>`;

test('keys are KVS-safe', () => {
  assert.match(testKey('my repo/x', 'a::b c'), /^[a-zA-Z0-9:._-]+$/);
  assert.equal(safe(''), 'default');
});

test('end to end: rerun on same commit exposes the flaky test, duplicates ignored', async () => {
  const s = memStore();
  await ingestRun(s, { project: 'web', commit: 'aaa', runId: '1', xml: xml('pass'), now: 1 });
  await ingestRun(s, { project: 'web', commit: 'bbb', runId: '2', xml: xml('fail'), now: 2 });
  const dup = await ingestRun(s, { project: 'web', commit: 'bbb', runId: '2', xml: xml('fail'), now: 3 });
  assert.equal(dup.duplicate, true);
  await ingestRun(s, { project: 'web', commit: 'bbb', runId: '3', xml: xml('pass'), now: 4 });
  const rep = await flakyReport(s, 'web');
  assert.equal(rep.testsTracked, 2);
  assert.equal(rep.runsStored, 3);
  assert.equal(rep.tests.length, 1);
  assert.equal(rep.tests[0].id, 'api::upload');
  assert.equal(rep.tests[0].verdict, 'flaky');
  assert.equal(rep.tests[0].lastFailureMessage, 'TimeoutError');

  const found = await findTest(s, 'web', 'UPLOAD');
  assert.equal(found.match.id, 'api::upload');
  assert.equal(found.match.recent.length, 3);
  assert.deepEqual((await findTest(s, 'web', 'api')).candidates.sort(), ['api::login', 'api::upload']);
  assert.deepEqual(await findTest(s, 'web', 'nope'), {});

  const d = issueDescription(found.match, 'web');
  assert.equal(issueSummary(found.match), 'Flaky test: api::upload');
  assert.ok(JSON.stringify(d).includes('same commit bbb'));
});

test('resetProject removes only that project', async () => {
  const s = memStore();
  await ingestRun(s, { project: 'a', runId: '1', xml: xml('pass') });
  await ingestRun(s, { project: 'b', runId: '1', xml: xml('pass') });
  const r = await resetProject(s, 'a');
  assert.equal(r.deletedKeys, 3);
  assert.deepEqual(await s.get('projects'), ['b']);
  assert.equal((await flakyReport(s, 'b')).testsTracked, 2);
});
