const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('adventure zones have explicit persistent progression requirements', () => {
  assert.match(html, /const ADV_ZONE_REQUIREMENTS = \[/);
  assert.match(html, /gems: 25, runs: 3, bosses: 0/);
  assert.match(html, /gems: 75, runs: 0, bosses: 1/);
  assert.match(html, /localStorage\.setItem\('mining_adventure_stats'/);
});

test('locked zones cannot become the active zone before their milestone', () => {
  assert.match(html, /const unlockedZones = getUnlockedAdventureZones\(\);\s+const newPhase = Math\.min\(targetPhase, unlockedZones - 1\);/);
  assert.match(html, /getAdventureZoneUnlockHint\(targetPhase\)/);
  assert.match(html, /adv\.lockNoticePhase !== targetPhase/);
});

test('zone progression does not modify the seeded race reward rules', () => {
  assert.match(html, /adv\.mode !== 'race'/);
  assert.match(html, /const reward = inRace \? 0/);
});

test('end-of-run summary tells players what zones they unlocked or how to unlock the next one', () => {
  assert.match(html, /const unlockedZonesBeforeRun = getUnlockedAdventureZones\(\);/);
  assert.match(html, /const unlockedZonesAfterRun = getUnlockedAdventureZones\(\);/);
  assert.match(html, /فتحت \$\{ADV_MINE_ZONES\[unlockedZonesAfterRun - 1\]\.name\}/);
  assert.match(html, /المناطق المفتوحة: \$\{unlockedZonesAfterRun\}\/\$\{ADV_MINE_ZONES\.length\}/);
  assert.match(html, /zoneProgressText/);
});

test('zone progression is computed on the server and only lifted (never lowered) by the device history', () => {
  assert.match(html, /const advServer = \{ zones: 0, runs: 0 \};/);
  assert.match(html, /return Math\.max\(unlocked, Math\.min\(ADV_MINE_ZONES\.length, Math\.floor\(advServer\.zones\) \|\| 1\)\);/);
  assert.match(html, /function adoptServerAdventure\(a, raceTotals\)/);
  assert.match(html, /advServer\.zones = Math\.max\(1, Math\.floor\(Number\(a\.zones\) \|\| 1\)\);/);
  assert.match(html, /adoptServerAdventure\(data\.state\.adventure, data\.race\)/);
});

test('every finished round is reported to the server with the facts it needs to verify it', () => {
  assert.match(html, /type: 'run', mode: adv\.gameMode, difficulty: adv\.gameDifficulty, score: finalScore, gems: adv\.gemsCaught,\s+combo: adv\.maxCombo, duration: Math\.floor\(adv\.elapsed\), boss: adv\.bossDefeated, race: inRace, expected: reward/);
});
