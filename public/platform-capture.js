(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformCapture = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({ createSimulation, step, duel, input }) {
    const captureMask = sim => {
      const rival = (sim.enemies || []).find(enemy => !enemy.dead);
      if (!rival) return 0;
      const player = sim.player;
      const dx = rival.x + rival.w / 2 - (player.x + player.w / 2), distance = Math.abs(dx);
      const skillCost = duel.skill ? duel.skill.cost : Infinity;
      if (rival.state === 'windup') {
        const close = distance < 118, late = rival.timer <= 9;
        if (close && late) {
          if (rival.attack !== 'overhead') return input.DEFEND;
          return rival.ai && rival.ai.wideSlam ? input.JUMP : input.DODGE;
        }
        if (close) return 0;
        return dx > 0 ? input.RIGHT : input.LEFT;
      }
      if (rival.state === 'charge' && distance < 130) return input.JUMP;
      const wave = (sim.waves || []).find(item => !(item.delay > 0)
        && Math.abs((item.x + item.w / 2) - (player.x + player.w / 2)) < 90);
      if (wave && player.grounded) return input.JUMP;
      const safe = rival.state === 'recover' || rival.state === 'retreat' || rival.state === 'stagger';
      if (safe) {
        if (distance > 68) return dx > 0 ? input.RIGHT : input.LEFT;
        if (Number.isFinite(skillCost) && player.skillCooldown <= 0 && player.guard.stamina >= skillCost + 10) return input.SKILL;
        if (player.heavyCooldown <= 0) return input.HEAVY;
        return input.ATTACK;
      }
      if (distance > 70) return dx > 0 ? input.RIGHT : input.LEFT;
      return 0;
    };

    const captureHit = (kind, sim, view = {}) => {
      if (kind === 'boss') {
        const rival = (sim.enemies || [])[0];
        if (!rival || rival.state !== 'windup' || rival.attack !== 'overhead' || (rival.phase || 1) < 2) return false;
        const warning = (rival.ai && rival.ai.windup) || 46;
        return rival.timer <= warning - 12 && rival.timer >= 16;
      }
      const player = sim.player;
      if (!player || player.grounded || player.vy >= 0) return false;
      if (Number.isFinite(view.groundY) && view.groundY - player.y > 40) return false;
      const wave = (sim.waves || []).find(item => !(item.delay > 0));
      if (!wave) return false;
      const gap = Math.abs((wave.x + wave.w / 2) - (player.x + player.w / 2));
      return gap >= 45 && gap <= 95;
    };

    const captureSim = (kind, hero = 'miner', { zone = kind === 'boss' ? 3 : 2, loadout = null, attempts = 10, maxTicks = 6000 } = {}) => {
      for (let attempt = 0; attempt < attempts; attempt++) {
        const sim = createSimulation(hero, 2024 + attempt * 137, { zone, mode: 'duel', loadout });
        let groundY = NaN;
        for (let tick = 0; tick < maxTicks && sim.status === 'playing'; tick++) {
          if (sim.player.grounded) groundY = Number.isFinite(groundY) ? Math.max(groundY, sim.player.y) : sim.player.y;
          step(sim, captureMask(sim));
          if (captureHit(kind, sim, { groundY })) return sim;
        }
      }
      return null;
    };

    return Object.freeze({ mask: captureMask, hit: captureHit, sim: captureSim });
  }

  return { create };
});
