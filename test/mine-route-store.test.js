'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const MineRouteStore = require('../public/mine-route-store.js');

const memory = () => {
  const values = new Map();
  return { values, getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { values.set(key, String(value)); } };
};

test('route-only local progress resumes the active mine and partial rockslide clearance', () => {
  const storage = memory(), route = MineRouteStore.create(storage);
  assert.deepEqual(route.load(5), { index: 0, unlocked: 0, breaks: 0 });
  assert.equal(route.save({ index: 2, unlocked: 3, breaks: 2 }, 5), true);
  assert.deepEqual(route.load(5), { index: 2, unlocked: 3, breaks: 2 });
  const saved = JSON.parse(storage.values.get(MineRouteStore.KEY));
  assert.deepEqual(Object.keys(saved).sort(), ['breaks', 'index', 'unlocked']);
  assert.equal('gold' in saved, false);
  assert.equal('ore' in saved, false);
});

test('tampered route values are bounded and unlocked progress cannot trail the current cave', () => {
  const storage = memory(), route = MineRouteStore.create(storage);
  storage.setItem(MineRouteStore.KEY, JSON.stringify({ index: 99, unlocked: -4, breaks: 999, gold: 1e30 }));
  assert.deepEqual(route.load(5), { index: 5, unlocked: 5, breaks: 3 });
  route.save({ index: -5, unlocked: 99, breaks: -1 }, 5);
  assert.deepEqual(route.load(5), { index: 0, unlocked: 5, breaks: 0 });
});

test('malformed JSON, denied storage, and unavailable storage fail closed to fresh route progress', () => {
  const storage = memory(), route = MineRouteStore.create(storage);
  storage.setItem(MineRouteStore.KEY, '{not json');
  assert.deepEqual(route.load(5), { index: 0, unlocked: 0, breaks: 0 });
  const denied = MineRouteStore.create({ getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  assert.deepEqual(denied.load(5), { index: 0, unlocked: 0, breaks: 0 });
  assert.equal(denied.save({ index: 4, unlocked: 4, breaks: 3 }, 5), false);
  const absent = MineRouteStore.create(null);
  assert.equal(absent.save({ index: 1, unlocked: 1, breaks: 0 }, 5), false);
});
