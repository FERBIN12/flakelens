// Tiny shopping-cart module used as a realistic test subject for the FlakeLens demo.
export function total(items, { taxRate = 0.0625 } = {}) {
  const sub = items.reduce((s, i) => s + i.price * i.qty, 0);
  return Math.round(sub * (1 + taxRate) * 100) / 100;
}
export function applyCoupon(amount, code) {
  if (code === 'SAVE10') return Math.round(amount * 0.9 * 100) / 100;
  return amount;
}
