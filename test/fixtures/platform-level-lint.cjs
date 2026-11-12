// Geometry lint for a level: the clearance rules that keep a hand-made level winnable by a player (and by test/fixtures/platform-bot.cjs).
// It never judges taste, only things that make a level impossible or unfair:
//   * every obstacle owns a "zone" nobody else may touch — a gap [g0 - 70, g1 + 70] (run-up and landing), a low hazard
//     [x - 70, x + w + 70] (run-up and a short landing: a player can stop in mid-air), a tall hazard [x - 70, x + w + 30] (a place to wait);
//   * rocks sit on solid ground outside every zone (a rock inside a run-up or right after a landing is a trap);
//   * ledges are reachable by one jump (y 222..234), never hang over a gap, never sit in a zone (a head bump ruins the jump)
//     and never sit above a rock (standing on a rock under a low ledge traps the player);
//   * gems lie on the ground or on a ledge, guards walk on a ledge, bats fly above any jump (y <= 125), checkpoints stand on ground;
//   * a boss arena: the boss stays clear of its wake line and of the exit, and the arena flag is outside the boss's reach.
// `strict: false` keeps only the structural checks (used for mine 0, which predates these rules and is proven by the frozen V3 parity test).
const overlap = (a0, a1, b0, b1) => a0 < b1 && a1 > b0;

function lintLevel(level, { strict = true } = {}) {
  const bad = [];
  const ground = level.platforms.filter(p => p.y === 300 && p.h === 80).sort((a, b) => a.x - b.x);
  const ledges = level.platforms.filter(p => p.h === 20 && p.route !== 'upper');
  const gaps = [];
  for (let i = 1; i < ground.length; i++) gaps.push([ground[i - 1].x + ground[i - 1].w, ground[i].x]);
  const onGround = (x0, x1, pad = 0) => ground.some(g => x0 >= g.x + pad && x1 <= g.x + g.w - pad);
  const inGap = h => gaps.some(([g0, g1]) => h.x >= g0 - 10 && h.x + h.w <= g1 + 10);

  const zones = gaps.map(([g0, g1]) => [g0 - 70, g1 + 70, `gap ${g0}-${g1}`]);
  for (const [i, h] of level.hazards.entries()) {
    if (inGap(h)) continue; // a geyser rising out of a gap lives inside that gap's zone
    zones.push([h.x - 70, h.x + h.w + (h.h > 40 ? 30 : 70), `${h.kind}#${i}@${h.x}`]);
  }
  const rocks = level.rocks.map((r, i) => {
    const spans = level.rockSpans[i];
    return [Math.min(...spans.map(s => s[0])), Math.max(...spans.map(s => s[1])) + r.w, `rock ${i}`];
  });

  if (strict) {
    for (let i = 0; i < zones.length; i++) for (let j = i + 1; j < zones.length; j++) {
      if (overlap(zones[i][0], zones[i][1], zones[j][0], zones[j][1])) bad.push(`zones overlap: ${zones[i][2]} and ${zones[j][2]}`);
    }
    for (const [a, b, name] of rocks) for (const z of zones) if (overlap(a, b, z[0], z[1])) bad.push(`${name} [${a},${b}] sits inside ${z[2]}`);
    for (let i = 0; i < rocks.length; i++) for (let j = i + 1; j < rocks.length; j++) {
      if (overlap(rocks[i][0] - 60, rocks[i][1] + 60, rocks[j][0], rocks[j][1])) bad.push(`${rocks[i][2]} and ${rocks[j][2]} are too close`);
    }
  }
  for (const [a, b, name] of rocks) if (!onGround(a, b, 20)) bad.push(`${name} [${a},${b}] is not safely on the ground`);

  const arenaFrom = level.boss ? level.enemies.find(e => e.boss).wake - 120 : Infinity;
  for (const p of ledges) {
    const a = p.x, b = p.x + p.w;
    if (!onGround(a, b)) bad.push(`ledge [${a},${b}] hangs over a gap`);
    if (!strict) continue;
    for (const z of zones) if (overlap(a, b, z[0], z[1])) bad.push(`ledge [${a},${b}] y${p.y} sits inside ${z[2]}`);
    for (const [ra, rb, name] of rocks) if (overlap(a - 10, b + 10, ra, rb)) bad.push(`ledge [${a},${b}] is above ${name}`);
    if (b > arenaFrom) bad.push(`ledge [${a},${b}] is inside the boss arena`);
    if (p.y < 220 || p.y > 234) bad.push(`ledge y ${p.y} is out of one-jump reach`);
  }
  level.gems.forEach((g, i) => {
    const [a, b] = level.gemSpans[i], x0 = a - 9, x1 = b + 9;
    if (g.y === 276) { if (!onGround(x0, x1, strict ? 4 : 0)) bad.push(`gem ${i} [${a},${b}] is not on the ground`); }
    else if (!ledges.some(p => g.y === p.y - 23 && x0 >= p.x && x1 <= p.x + p.w)) bad.push(`gem ${i} [${a},${b}] y${g.y} is not on any ledge`);
  });
  for (const e of level.enemies) {
    if (e.boss) {
      if (e.minX < e.wake + 40) bad.push('the boss can walk onto its own wake line');
      if (e.maxX + e.w > level.exit.x - 20) bad.push('the boss arena reaches the exit');
      const flag = level.checkpoints.find(c => c.at >= e.wake - 160);
      if (!flag) bad.push('the arena has no checkpoint flag');
      else if (flag.at + 24 + 60 > e.minX) bad.push('the arena flag is within the boss reach');
    } else if (e.flying) {
      if (e.y > 125) bad.push(`bat ${e.id} flies too low (${e.y})`);
    } else if (!ledges.some(p => e.y + e.h === p.y && e.minX >= p.x && e.maxX + e.w <= p.x + p.w + (strict ? 0 : 20))) bad.push(`guard ${e.id} (${e.type}) is not on a ledge`);
  }
  for (const c of level.checkpoints) if (!onGround(c.at, c.at + 3, 10)) bad.push(`checkpoint ${c.at} is not on the ground`);
  if (level.rocks.length !== 3 || level.gems.length !== 10 || level.enemies.filter(e => !e.boss).length !== 6) {
    bad.push(`counts must stay 3 rocks / 10 gems / 6 guards (got ${level.rocks.length}/${level.gems.length}/${level.enemies.filter(e => !e.boss).length}) so the reward numbers never move`);
  }
  if (!onGround(level.exit.x, level.exit.x + level.exit.w)) bad.push('the exit is not on the ground');
  return bad;
}
module.exports = { lintLevel };
