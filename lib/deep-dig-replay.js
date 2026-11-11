'use strict';

// Replay accepts only inputs from the client. Seed and equipment are server-owned
// session data and must never be copied from the finish request.
const DeepDig = require('../public/deep-dig');

const MAX_FRAMES = 108000; // 30 minutes at the simulation's fixed 60 Hz
const MAX_SEED = 0xffffffff;

function replayDeepDig(payload, session) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      !session || typeof session !== 'object' || Array.isArray(session)) {
    return { ok: false, reason: 'invalid_payload' };
  }
  const seed = session.seed;
  const frames = payload.frames;
  if (!Number.isSafeInteger(seed) || seed < 1 || seed > MAX_SEED ||
      !Array.isArray(frames) || frames.length < 1 || frames.length > MAX_FRAMES) {
    return { ok: false, reason: 'invalid_replay' };
  }

  for (const frame of frames) {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame) ||
        !Number.isInteger(frame.dx) || frame.dx < -1 || frame.dx > 1 ||
        !Number.isInteger(frame.dy) || frame.dy < -1 || frame.dy > 1 ||
        (frame.ascend !== undefined && frame.ascend !== true && frame.ascend !== false)) {
      return { ok: false, reason: 'invalid_frame' };
    }
  }

  const game = DeepDig.create({ seed, equipment: DeepDig.normalizeEquipment(session.equipment) });
  for (const frame of frames) {
    if (game.status !== 'running') return { ok: false, reason: 'input_after_finish' };
    if (frame.ascend === true && !DeepDig.ascend(game)) return { ok: false, reason: 'invalid_ascend' };
    DeepDig.advance(game, DeepDig.DT, { dx: frame.dx, dy: frame.dy });
  }

  return {
    ok: true,
    status: game.status,
    result: game.result ? { ...game.result, kept: { ...game.result.kept }, lost: { ...game.result.lost } } : null,
    summary: DeepDig.summary(game),
    duration: frames.length * DeepDig.DT,
    frameCount: frames.length,
  };
}

module.exports = { replayDeepDig, MAX_FRAMES };
