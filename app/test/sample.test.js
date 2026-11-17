import { test } from 'node:test';
import assert from 'node:assert/strict';
import bundle from '../src/sample/sample_runs.js';
import { loadSample, SAMPLE_PROJECT } from '../src/core/sample.js';
import { flakyReport } from '../src/core/ingest.js';

function memStore() {
  const m = new Map();
  return {
    get: async (k) => m.get(k), set: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); },
    listByPrefix: async (p) => [...m].filter(([k]) => k.startsWith(p)).map(([key, value]) => ({ key, value })),
  };
}

test('sample bundle loads once and shows flaky tests plus the coupon regression', async () => {
  const store = memStore();
  const first = await loadSample(store, bundle);
  assert.equal(first.loaded, bundle.runs.length);
  const again = await loadSample(store, bundle);
  assert.equal(again.loaded, 0, 'second load must skip duplicate run ids');
  const rep = await flakyReport(store, SAMPLE_PROJECT, 20);
  assert.equal(rep.runsStored, bundle.runs.length);
  assert.ok(rep.tests.some((t) => t.verdict === 'flaky'), 'expected at least one flaky test');
  assert.ok(rep.tests.some((t) => t.verdict === 'broken' && /SAVE10|coupon/i.test(t.id)), 'expected the coupon regression');
});
