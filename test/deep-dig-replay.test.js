'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { replayDeepDig, MAX_FRAMES } = require('../lib/deep-dig-replay');

const session = Object.freeze({ seed: 123456, equipment: { pickaxe: 2, bag: 1 } });

test('Deep Dig replay is deterministic for the same server session and inputs', () => {
  const frames = Array.from({ length: 180 }, (_, i) => ({
    dx: 0,
    dy: i < 150 ? 1 : 0,
  }));
  const a = replayDeepDig({ frames }, session);
  const b = replayDeepDig({ frames }, session);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.deepEqual(a.result, b.result);
  assert.deepEqual(a.summary, b.summary);
  assert.ok(Math.abs(a.duration - 3) < 1e-9);
});

test('Deep Dig replay does not accept a client-selected seed or equipment', () => {
  const frames = [{ dx: 0, dy: 0 }];
  const out = replayDeepDig({ seed: 1, equipment: { pickaxe: 99 }, frames }, session);
  const expected = replayDeepDig({ frames }, session);
  assert.equal(out.ok, true);
  assert.deepEqual(out.result, expected.result);
  assert.equal(replayDeepDig({ frames }, { seed: 0, equipment: {} }).reason, 'invalid_replay');
  assert.equal(replayDeepDig({ frames }, null).reason, 'invalid_payload');
});

test('Deep Dig replay rejects malformed directions, invalid rope actions, and oversized input', () => {
  assert.equal(replayDeepDig({ frames: [{ dx: 2, dy: 0 }] }, session).reason, 'invalid_frame');
  assert.equal(replayDeepDig({ frames: [{ dx: 0, dy: 0, ascend: 'yes' }] }, session).reason, 'invalid_frame');
  assert.equal(replayDeepDig({ frames: new Array(MAX_FRAMES + 1).fill({ dx: 0, dy: 0 }) }, session).reason, 'invalid_replay');
  assert.equal(replayDeepDig({ frames: [{ dx: 0, dy: 0, ascend: true }] }, session).reason, 'invalid_ascend');
});

test('Deep Dig replay derives its time from fixed simulation ticks, not client timing', () => {
  const out = replayDeepDig({ frames: [{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }] }, session);
  assert.equal(out.ok, true);
  assert.ok(Math.abs(out.duration - 2 / 60) < 1e-9);
});
