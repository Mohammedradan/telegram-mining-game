'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { replayDeepDig } = require('../lib/deep-dig-replay');

test('Deep Dig replay is deterministic for the same seed, equipment, and inputs', () => {
  const frames = Array.from({ length: 180 }, (_, i) => ({
    dt: 1 / 60,
    dx: 0,
    dy: i < 150 ? 1 : 0,
  }));
  const a = replayDeepDig({ seed: 123456, frames }, { pickaxe: 2, bag: 1 });
  const b = replayDeepDig({ seed: 123456, frames }, { pickaxe: 2, bag: 1 });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.deepEqual(a.result, b.result);
  assert.deepEqual(a.summary, b.summary);
  assert.ok(Math.abs(a.duration - 3) < 1e-9);
});

test('Deep Dig replay rejects client-supplied invalid or oversized input', () => {
  assert.equal(replayDeepDig({ seed: 0, frames: [{ dt: 1 / 60, dx: 0, dy: 0 }] }).ok, false);
  assert.equal(replayDeepDig({ seed: 1, frames: [{ dt: 0.2, dx: 0, dy: 0 }] }).reason, 'invalid_frame');
  assert.equal(replayDeepDig({ seed: 1, frames: [{ dt: 1 / 60, dx: 2, dy: 0 }] }).reason, 'invalid_frame');
  assert.equal(replayDeepDig({ seed: 1, frames: [{ dt: 1 / 60, dx: 0, dy: 0, ascend: true }] }).reason, 'invalid_ascend');
  assert.equal(replayDeepDig({ seed: 1, frames: new Array(120001).fill({ dt: 0, dx: 0, dy: 0 }) }).reason, 'invalid_replay');
});

test('Deep Dig replay returns only a server-derived neutral run state', () => {
  const out = replayDeepDig({ seed: 7, frames: [{ dt: 0, dx: 0, dy: 0 }] });
  assert.equal(out.ok, true);
  assert.equal(out.result, null);
  assert.equal(out.status, 'running');
});
