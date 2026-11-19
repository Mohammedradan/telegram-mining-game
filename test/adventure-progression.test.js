const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const adventure = fs.readFileSync(path.join(__dirname, '..', 'public', 'adventure-game.js'), 'utf8');

test('adventure zones have explicit persistent progression requirements', () => {
  assert.match(adventure, /const ADV_ZONE_REQUIREMENTS = \[/);
  assert.match(adventure, /gems: 25, runs: 3, bosses: 0/);
  assert.match(adventure, /gems: 75, runs: 0, bosses: 1/);
  assert.match(adventure, /localStorage\.setItem\('mining_adventure_stats'/);
});

test('locked zones cannot become the active zone before their milestone', () => {
  assert.match(adventure, /const unlockedZones = getUnlockedAdventureZones\(\);\s+const newPhase = Math\.min\(targetPhase, unlockedZones - 1\);/);
  assert.match(adventure, /getAdventureZoneUnlockHint\(targetPhase\)/);
  assert.match(adventure, /adv\.lockNoticePhase !== targetPhase/);
});

test('zone progression does not modify the seeded race reward rules', () => {
  assert.match(adventure, /adv\.mode !== 'race'/);
  assert.match(adventure, /const claimed = inRace \? 0/, 'a race still claims nothing');
  assert.match(adventure, /const room = classicRoom\(\), reward = Math\.min\(claimed, room\), cut = claimed > reward;/, 'and what is paid can only be lower than what is claimed (the shared daily cap), so a race pays 0');
});

test('end-of-run summary tells players what zones they unlocked or how to unlock the next one', () => {
  assert.match(adventure, /const unlockedZonesBeforeRun = getUnlockedAdventureZones\(\);/);
  assert.match(adventure, /const unlockedZonesAfterRun = getUnlockedAdventureZones\(\);/);
  assert.match(adventure, /فتحت \$\{ADV_MINE_ZONES\[unlockedZonesAfterRun - 1\]\.name\}/);
  assert.match(adventure, /المناطق المفتوحة: \$\{unlockedZonesAfterRun\}\/\$\{ADV_MINE_ZONES\.length\}/);
  assert.match(adventure, /zoneProgressText/);
});

test('zone progression is computed on the server and only lifted (never lowered) by the device history', () => {
  assert.match(adventure, /const advServer = \{ zones: 0, runs: 0 \};/);
  assert.match(adventure, /return Math\.max\(unlocked, Math\.min\(ADV_MINE_ZONES\.length, Math\.floor\(advServer\.zones\) \|\| 1\)\);/);
  assert.match(adventure, /function adoptServerAdventure\(a, raceTotals\)/);
  assert.match(adventure, /advServer\.zones = Math\.max\(1, Math\.floor\(Number\(a\.zones\) \|\| 1\)\);/);
  assert.match(html, /adoptServerAdventure\(data\.state\.adventure, data\.race\)/);
});

test('every finished round is reported to the server with the facts it needs to verify it', () => {
  assert.match(adventure, /type: 'run', mode: adv\.gameMode, difficulty: adv\.gameDifficulty, score: finalScore, gems: adv\.gemsCaught,\s+combo: adv\.maxCombo, duration: Math\.floor\(adv\.elapsed\), boss: adv\.bossDefeated, race: inRace, expected: reward/);
});
