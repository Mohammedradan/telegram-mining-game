// A reproducible legal controller, not an injected score or physics override.
const R = require('../../public/platform-rules');
module.exports = function solution() {
  const state = R.create(), inputs = [];
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
