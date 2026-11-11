// Server-side deterministic replay for Deep Dig.
// The client may submit inputs, but never a bag, depth, score, or reward.
'use strict';

const DeepDig = require('../public/deep-dig');

const MAX_FRAMES = 120000;
const MAX_FRAME_DT = 0.1;
const MAX_DURATION_SECONDS = 1800;
const MAX_SEED = 0xffffffff;

function replayDeepDig(payload, equipment) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'invalid_payload' };
  }
  const seed = payload.seed;
  const frames = payload.frames;
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > MAX_SEED ||
      !Array.isArray(frames) || frames.length < 1 || frames.length > MAX_FRAMES) {
    return { ok: false, reason: 'invalid_replay' };
  }

  let duration = 0;
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) ||
        !Number.isFinite(frame.dt) || frame.dt < 0 || frame.dt > MAX_FRAME_DT ||
        !Number.isInteger(frame.dx) || frame.dx < -1 || frame.dx > 1 ||
        !Number.isInteger(frame.dy) || frame.dy < -1 || frame.dy > 1 ||
        (frame.ascend !== undefined && frame.ascend !== true && frame.ascend !== false)) {
      return { ok: false, reason: 'invalid_frame' };
    }
    duration += frame.dt;
    if (duration > MAX_DURATION_SECONDS) return { ok: false, reason: 'replay_too_long' };
  }

  const game = DeepDig.create({ seed, equipment: DeepDig.normalizeEquipment(equipment) });
  for (let i = 0; i < frames.length; i++) {
    if (game.status !== 'running') return { ok: false, reason: 'input_after_finish' };
    const frame = frames[i];
    if (frame.ascend && !DeepDig.ascend(game)) return { ok: false, reason: 'invalid_ascend' };
    DeepDig.advance(game, frame.dt, { dx: frame.dx, dy: frame.dy });
  }

  return {
    ok: true,
    status: game.status,
    result: game.result ? { ...game.result, kept: { ...game.result.kept }, lost: { ...game.result.lost } } : null,
    summary: DeepDig.summary(game),
    duration,
    frameCount: frames.length,
  };
}

module.exports = { replayDeepDig, MAX_FRAMES, MAX_FRAME_DT, MAX_DURATION_SECONDS };
