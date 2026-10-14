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
