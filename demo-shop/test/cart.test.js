import { test } from 'node:test';
import assert from 'node:assert/strict';
import { total, applyCoupon } from '../src/cart.js';
test('total adds tax', () => assert.equal(total([{ price: 10, qty: 2 }]), 21.25));
test('empty cart is zero', () => assert.equal(total([]), 0));
test('SAVE10 takes 10 percent off', () => assert.equal(applyCoupon(100, 'SAVE10'), 90));
test('unknown coupon is ignored', () => assert.equal(applyCoupon(50, 'NOPE'), 50));
