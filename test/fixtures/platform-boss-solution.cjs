// Optional upper route: legal input only, including the return jump onto the boss ledge.
const R = require('../../public/platform-rules');
module.exports = function bossSolution() {
  const state = R.create(), inputs = [];
  let stage = 'outbound';
  for (let i = 0; i < R.MAX_TICKS && state.status === 'playing'; i++) {
    const p = state.player;
    let mask = R.INPUT.RIGHT | R.INPUT.MINE;
    if (stage === 'outbound') {
      if ([[665, 740], [1140, 1220], [1470, 1550], [2020, 2110]].some(([a, b]) => p.x > a && p.x < b)) mask |= R.INPUT.JUMP;
      if (p.x >= 2370) stage = 'return';
    } else if (stage === 'return') {
      mask = R.INPUT.LEFT | R.INPUT.MINE | R.INPUT.JUMP;
      if (p.x <= 2185) stage = 'boss';
    } else if (stage === 'boss') {
      mask = R.INPUT.MINE | (p.facing < 0 ? R.INPUT.RIGHT : 0);
      if (state.bossDefeated) stage = 'exit';
    }
    if (stage === 'exit' && p.x >= 2360 && state.enemies[0].hp > 0) mask = R.INPUT.MINE;
    if (inputs.at(-1)?.mask === mask) inputs.at(-1).frames++;
    else inputs.push({ mask, frames: 1 });
    R.step(state, mask);
  }
  return { state, inputs };
};
