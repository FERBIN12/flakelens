import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseJUnit, decodeEntities } from '../src/core/junit.js';
import { appendObservation, classify, flipRate, rankTests, MAX_HISTORY } from '../src/core/flake.js';

const fixture = readFileSync(new URL('./fixtures/run_mixed.xml', import.meta.url), 'utf8');

test('parses every testcase with outcome, time and first message line', () => {
  const r = parseJUnit(fixture);
  assert.equal(r.length, 4);
  assert.deepEqual(r.map((t) => t.status), ['pass', 'fail', 'error', 'skip']);
  assert.equal(r[0].id, 'tests.test_api::test_login');
  assert.equal(r[1].message, 'TimeoutError: upload took > 2s');
  assert.equal(r[1].time, 2.5);
  assert.equal(r[2].message, 'psql: could not connect <host>');
  assert.equal(r[3].message, 'slow');
});

test('rejects non-JUnit input', () => {
  assert.throws(() => parseJUnit('{"not":"xml"}'), /no <testcase>/);
});

test('falls back to suite name when classname is missing', () => {
  const r = parseJUnit('<testsuite name="jest"><testcase name="adds"></testcase></testsuite>');
  assert.equal(r[0].id, 'jest::adds');
  assert.equal(r[0].status, 'pass');
});

test('decodes numeric entities', () => {
  assert.equal(decodeEntities('a&#60;b&#x3E;c'), 'a<b>c');
});

const obs = (i, status, commit = `c${i}`) => ({ runId: `r${i}`, commit, ts: i, status, message: status === 'pass' ? '' : 'boom' });
const build = (statuses, commits) => statuses.reduce((h, s, i) => appendObservation(h, obs(i, s, commits ? commits[i] : undefined)), []);

test('same-commit pass+fail is flaky even with one failure', () => {
  const c = classify(build(['pass', 'pass', 'fail', 'pass'], ['a', 'b', 'b', 'c']));
  assert.equal(c.verdict, 'flaky');
  assert.equal(c.mixedCommits[0].commit, 'b');
  assert.match(c.reason, /same commit b/);
});

test('frequent flipping across commits is flaky', () => {
  const c = classify(build(['pass', 'fail', 'pass', 'fail', 'pass', 'pass', 'fail', 'pass']));
  assert.equal(c.verdict, 'flaky');
  assert.ok(c.flipRate >= 0.3);
  assert.ok(c.score > 0);
});

test('a trailing failure streak after passes is a regression, with first bad run', () => {
  const c = classify(build(['pass', 'pass', 'pass', 'fail', 'fail', 'fail']));
  assert.equal(c.verdict, 'broken');
  assert.equal(c.firstBad.runId, 'r3');
});

test('stable tests are healthy; one-off failure is not called flaky', () => {
  assert.equal(classify(build(['pass', 'pass', 'pass'])).verdict, 'healthy');
  assert.equal(classify(build(['pass', 'pass', 'fail', 'pass', 'pass', 'pass', 'pass'])).verdict, 'healthy');
});

test('skips are not stored and history is capped', () => {
  let h = appendObservation([], obs(0, 'skip'));
  assert.equal(h.length, 0);
  for (let i = 0; i < MAX_HISTORY + 10; i += 1) h = appendObservation(h, obs(i, 'pass'));
  assert.equal(h.length, MAX_HISTORY);
  assert.equal(h[0].runId, 'r10');
  assert.equal(flipRate([]), 0);
});

test('ranking puts flaky first, then broken, hides healthy', () => {
  const ranked = rankTests({
    ok: build(['pass', 'pass', 'pass']),
    reg: build(['pass', 'fail', 'fail', 'fail']),
    flake: build(['pass', 'fail', 'pass', 'fail'], ['x', 'x', 'y', 'y']),
  });
  assert.deepEqual(ranked.map((r) => r.id), ['flake', 'reg']);
});

test('node reporter: file basename replaces generic classname, no full path kept', () => {
  const r = parseJUnit('<testsuites><testcase name="t1" classname="test" file="/ci/work/repo/test/cart.test.js"/></testsuites>');
  assert.equal(r[0].id, 'cart.test.js::t1');
  assert.ok(!JSON.stringify(r).includes('/ci/work'));
});

test('assertion headline ending in ":" gets the values line appended', () => {
  const r = parseJUnit(`<testcase name="x"><failure message="Expected values to be strictly equal:&#10;&#10;'west' !== 'east'&#10;"/></testcase>`);
  assert.equal(r[0].message, "Expected values to be strictly equal: 'west' !== 'east'");
});
