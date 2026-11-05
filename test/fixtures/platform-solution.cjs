// A reproducible legal controller, not an injected score or physics override.
// `config` = { zone, loadout } selects the mine and the equipment the run is verified under (default: mine 0, no gear).
// Mine 0 keeps its hand-written route (the V3-parity and API tests were written against it); every other mine, and the boss arenas,
// are played by the generic bot in platform-bot.cjs, which also wins mine 0 (see platform-worlds.test.js).
const R = require('../../public/platform-rules');
const bot = require('./platform-bot.cjs');
module.exports = function solution(seed, hero = 'miner', config) {
  if (R.create(hero, seed, config).zone !== 0) return bot(seed, hero, config);
  const state = R.create(hero, seed, config), inputs = [];
  for (let i = 0; i < R.MAX_TICKS && state.status === 'playing'; i++) {
    const p = state.player;
    let mask = R.INPUT.RIGHT;
    if (state.rocks.some(r => r.hp > 0 && r.x >= p.x && r.x - p.x < 80)) mask |= R.INPUT.MINE;
    if ([[665, 740], [1140, 1220], [1470, 1550], [2020, 2110]].some(([a, b]) => p.x > a && p.x < b)) mask |= R.INPUT.JUMP;
    if (inputs.at(-1)?.mask === mask) inputs.at(-1).frames++;
    else inputs.push({ mask, frames: 1 });
    R.step(state, mask);
  }
  return { state, inputs };
};
