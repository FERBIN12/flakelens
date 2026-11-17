import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, fastestWarehouse } from '../src/inventory.js';
test('lookup returns stock', async () => assert.equal(await new Inventory().lookup('mug'), 5));
// Flaky: assumes the "network" answers within 30 ms, but latency is up to 40 ms.
test('lookup is fast enough', async () => {
  const t0 = performance.now();
  await new Inventory().lookup('tee');
  assert.ok(performance.now() - t0 < 30, 'lookup took too long');
});
// Flaky: two concurrent reservations can lose an update (race in reserve()).
test('concurrent reservations are counted', async () => {
  const inv = new Inventory();
  await Promise.all([inv.reserve(), inv.reserve()]);
  assert.equal(inv.reserved, 2);
});
// Flaky: depends on which promise wins the race.
test('east warehouse is preferred', async () => assert.equal(await fastestWarehouse(['east', 'west']), 'east'));
