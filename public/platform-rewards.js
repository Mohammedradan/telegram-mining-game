(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlatformRewards = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function create({ fps, mines, duel, oreOrder, milestones, milestoneGold, emptyOres, milestoneOres }) {
    // Both gold and ore salvage require a checkpoint and a long attempt; abandoned or quick losses pay nothing.
    const RUN_REWARD = Object.freeze({
      base: 100,                 // Content cap: 40 + gems × 4 + rocks × 6
      completionBase: 20,        // Completion bonus in the first mine
      completionStep: 10,        // An extra 10 per deeper mine
      salvageDivisor: 4,         // A quarter of milestone value on an honest loss
      salvageCap: 10,            // Absolute salvage cap, well below any win
      salvageMinSeconds: 90,
      startCheckpoint: 64,       // No salvage before passing the starting checkpoint
    });

    const completionBonus = zone => RUN_REWARD.completionBase
      + RUN_REWARD.completionStep * Math.max(0, Math.min(mines.length - 1, Number(zone) || 0));
    const rewardCap = zone => RUN_REWARD.base + completionBonus(zone);

    function duelReward(zone) {
      return duel.reward + duel.rewardStep * Math.max(0, Math.min(mines.length - 1, Number(zone) || 0));
    }

    function rewardBreakdown(state) {
      if (state.mode === 'duel') {
        const potential = state.status === 'won' ? duelReward(state.zone) : 0;
        return { potential, milestoneGold: 0, finalGold: potential, salvage: 0, bonus: 0, total: potential };
      }
      const potential = Math.min(RUN_REWARD.base, 40 + state.collected * 4 + state.mined * 6);
      const milestoneEarned = Math.min(potential, (state.milestones?.length || 0) * milestoneGold);
      const bonus = completionBonus(state.zone);
      if (state.status === 'won') {
        const total = Math.min(rewardCap(state.zone), potential + bonus);
        const milestonePayout = Math.min(milestoneEarned, total);
        return { potential, milestoneGold: milestonePayout, finalGold: total - milestonePayout, salvage: 0, bonus: total - potential, total };
      }
      // Abandoned runs and losses before the checkpoint/time thresholds never pay milestones or salvage.
      const passedCheckpoint = Number(state.checkpoint) > RUN_REWARD.startCheckpoint;
      const honestAttempt = (Number(state.tick) || 0) >= RUN_REWARD.salvageMinSeconds * fps;
      const endedInLoss = state.status === 'lost';
      const salvage = endedInLoss && passedCheckpoint && honestAttempt && milestoneEarned > 0
        ? Math.min(RUN_REWARD.salvageCap, Math.floor(milestoneEarned / RUN_REWARD.salvageDivisor)) : 0;
      return { potential, milestoneGold: 0, finalGold: 0, salvage, bonus: 0, total: salvage };
    }

    const rewardFor = state => rewardBreakdown(state).total;
    const oreSummary = state => {
      const out = emptyOres();
      for (const key of oreOrder) out[key] = Math.max(0, Math.floor(state.ores?.[key] || 0));
      return out;
    };

    function oreAward(state) {
      const full = oreSummary(state);
      if (state.status === 'won') return full;
      const passed = Number(state.checkpoint) > RUN_REWARD.startCheckpoint;
      const honest = (Number(state.tick) || 0) >= RUN_REWARD.salvageMinSeconds * fps;
      if (state.status !== 'lost' || !passed || !honest) return emptyOres();
      const half = emptyOres();
      for (const key of oreOrder) half[key] = Math.floor((full[key] || 0) / 2);
      return half;
    }

    const milestoneList = (zone = 0) => milestones.map(item => ({
      id: item.id, label: item.label, gold: milestoneGold, ores: milestoneOres(zone, item.id),
    }));

    return { RUN_REWARD, completionBonus, rewardCap, duelReward, rewardBreakdown, rewardFor, oreSummary, oreAward, milestoneList };
  }

  return { create };
});
