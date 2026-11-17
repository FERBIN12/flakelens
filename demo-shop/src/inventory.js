// Simulated inventory service with network-like latency (random 0-40 ms) and a shared counter.
export class Inventory {
  constructor() { this.reserved = 0; this.stock = new Map([['mug', 5], ['tee', 3]]); }
  async lookup(sku) {
    await new Promise((r) => setTimeout(r, Math.random() * 40));
    return this.stock.get(sku) ?? 0;
  }
  // Read-modify-write across an await: concurrent callers can lose updates (a real race).
  async reserve() {
    const seen = this.reserved;
    await new Promise((r) => setTimeout(r, Math.random() * 5));
    this.reserved = seen + 1;
  }
}
export async function fastestWarehouse(names) {
  // Resolves with whichever warehouse answers first: order is not deterministic.
  return Promise.race(names.map((n) => new Promise((r) => setTimeout(() => r(n), Math.random() * 10))));
}
