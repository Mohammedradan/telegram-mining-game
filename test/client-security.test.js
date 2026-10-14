// Regression guard: server-mode achievement rewards must not trust browser-only stats.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

test('server-mode achievement claims are disabled in the UI', () => {
  assert.match(html, /btn\.disabled = claimed \|\| !met \|\| serverMode;/);
  assert.match(html, /serverMode && met\) \? '🔒 يتطلب تحققًا'/);
});

test('claimAchievement rejects server-mode claims before granting gold', () => {
  const start = html.indexOf('function claimAchievement(id)');
  const end = html.indexOf('// 🛠️ ترقيات المغامرة الدائمة', start);
  assert.ok(start >= 0 && end > start, 'achievement claim function should exist');
  const fn = html.slice(start, end);
  const guard = fn.indexOf('if (serverMode)');
  const award = fn.indexOf('state.gold += a.reward');
  assert.ok(guard >= 0, 'server-mode guard should exist');
  assert.ok(award > guard, 'server-mode guard must run before reward mutation');
  assert.match(fn.slice(guard, award), /return;/, 'server-mode guard must exit without granting reward');
});
