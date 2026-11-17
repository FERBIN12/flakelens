#!/usr/bin/env bash
# Build the demo-shop git history used in the FlakeLens demo, in a fresh directory:
#   commit 1  base shop (cart, coupons, inventory service with 3 genuinely nondeterministic tests)
#   commit 2  add a free-shipping threshold (+1 test, nothing broken)
#   commit 3  "refactor" coupon math that really breaks SAVE10 (a regression, not a flake)
# Usage: make_demo_history.sh <target-dir>
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
dest=${1:?usage: make_demo_history.sh <target-dir>}
mkdir -p "$dest"; cp -r "$here/../demo-shop/." "$dest/"; cd "$dest"
g() { git -c user.name="FlakeLens demo" -c user.email="demo@example.invalid" "$@"; }
git init -q -b main; g add -A; g commit -qm "Cart, coupons and inventory service"
cat >> src/cart.js <<'JS'
export function shipping(amount) {
  return amount >= 50 ? 0 : 5.99;
}
JS
cat >> test/cart.test.js <<'JS'
import { shipping } from '../src/cart.js';
test('free shipping from 50', () => { assert.equal(shipping(50), 0); assert.equal(shipping(49.99), 5.99); });
JS
g add -A; g commit -qm "Add free shipping threshold"
sed -i.bak 's/amount \* 0.9 \* 100/amount * 0.8 * 100/' src/cart.js && rm -f src/cart.js.bak
g add -A; g commit -qm "Refactor coupon math"
git log --oneline
