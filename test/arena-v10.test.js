// V10: معدات الساحة (فأس/درع/مثقاب) + أربعة أنماط خصوم + زعيم بمرحلتين.
// الاختبارات هنا تعمل على المحرك الحقيقي، وأحدها يعمل على خادم حقيقي للتأكد أن
// المعدات تُقرأ من حفظ اللاعب على الخادم لا من جسم الطلب.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createStore } = require('../db');
const R = require('../public/platform-rules');

const ROOT = path.join(__dirname, '..');
const DUEL = (zone = 0) => ({ zone, mode: 'duel' });

// ---------- 1) أثر كل معدّة بالأرقام ----------
test('V10 gear: axe raises chain damage and guard-break, armor raises breath, drill shortens the skill', () => {
  const at = (lv) => R.create('miner', 7, { ...DUEL(0), loadout: { pickaxe: lv, armor: lv, drill: lv } }).player;
  const L0 = at(0), L2 = at(2), L5 = at(5);
  // الفأس: ضرر السلسلة 1 → 3 (+2 بحد أقصى) وكسر دفاع +8 إطارات بحد أقصى
  assert.deepEqual([L0.damage, L2.damage, L5.damage], [1, 2, 3], 'axe adds chain damage, capped at +2');
  assert.deepEqual([L0.guardBreakBonus, L2.guardBreakBonus, L5.guardBreakBonus], [0, 4, 8], 'axe adds stagger (guard break) ticks, capped');
  // الدرع: نَفَس المهارة +10 لكل مستوى (سقف 200) واستعادة +1 عند المستوى 2+ فقط
  assert.deepEqual([L0.guard.maxStamina, L2.guard.maxStamina, L5.guard.maxStamina], [150, 170, 200], 'armor raises the skill breath');
  assert.deepEqual([L0.guard.regen, L2.guard.regen, L5.guard.regen], [1, 2, 2], 'armor speeds recovery, capped at +1');
  // المثقاب: مهلة ظل الساكورا 150 → 130 → 100 (بحد أدنى 100) ومهلة المراوغة
  assert.deepEqual([L0.skillMaxCooldown, L2.skillMaxCooldown, L5.skillMaxCooldown], [150, 130, 100], 'drill shortens the shadow blossom cooldown');
  assert.deepEqual([L0.dodgeCooldown, L2.dodgeCooldown, L5.dodgeCooldown], [46, 40, 31], 'and the dodge cooldown');
  // لا قيم تكسر التوازن خارج الحدود
  for (const p of [L0, L2, L5]) {
    assert.ok(p.damage <= 3 && p.guardBreakBonus <= 8 && p.guard.maxStamina <= 200 && p.skillMaxCooldown >= 100 && p.dodgeCooldown >= 30);
  }
  // وبطاقة الواجهة تقرأ نفس الأرقام
  const gear = R.combatGear('miner', { pickaxe: 5, armor: 5, drill: 5 });
  assert.match(gear[0].effect, /\+2 ضرر/, 'the card shows the chain damage bonus');
  assert.match(gear[1].effect, /200/, 'the card shows the breath pool');
  assert.match(gear[2].effect, /100/, 'the card shows the skill cooldown');
});

test('V10 gear never leaks into the mining run (byte-identical mine simulation)', () => {
  const crypto2 = require('node:crypto');
  const s = R.create('miner', 12345, { zone: 1, mode: 'mine', loadout: { pickaxe: 5, boots: 3, bag: 2, magnet: 2, drill: 5, robot: 3, luck: 2, armor: 5 } });
  assert.equal(s.player.guardBreakBonus, 0, 'no arena guard-break outside the arena');
  assert.equal(s.player.guard.regen, 1, 'breath recovery stays legacy in the mine');
  assert.equal(s.player.skillMaxCooldown, 140, 'the mining skill cooldown keeps the old formula');
  assert.equal(s.player.skill, null, 'no shadow blossom in a mining run');
  const masks = [R.INPUT.RIGHT, R.INPUT.RIGHT, R.INPUT.MINE, R.INPUT.MINE, R.INPUT.JUMP, R.INPUT.LEFT, R.INPUT.MINE, R.INPUT.ATTACK, 0, R.INPUT.RIGHT];
  for (let t = 0; t < 1200; t++) R.step(s, masks[t % masks.length]);
  const digest = crypto2.createHash('sha1').update(JSON.stringify({
    tick: s.tick, status: s.status, hp: s.player.hearts, x: Math.round(s.player.x * 100), y: Math.round(s.player.y * 100),
    collected: s.collected, mined: s.mined, ores: s.ores, rocks: s.rocks.map((r) => r.hp),
    enemies: s.enemies.map((e) => [e.hp, e.x]),
  })).digest('hex');
  // بصمة مثبّتة من V8/V9: نفس المحاكاة حرفياً حتى مع أقصى معدات الساحة
  assert.equal(digest, '15fa46127cdf75d13f7566c3651156f21b9f68ec', 'the mining simulation is unchanged');
});

// ---------- 2) أنماط الخصوم ----------
test('V10 archetypes: four distinct fighters with four readable openings', () => {
  const a = [0, 1, 2, 3].map((z) => R.create('miner', 7, DUEL(z)).enemies[0]);
  assert.deepEqual(a.map((r) => r.style), ['balanced', 'swift', 'wind', 'heavy'], 'one style per zone');
  assert.equal(new Set(a.map((r) => r.name)).size, 4, 'four different fighters');
  assert.equal(new Set(a.map((r) => r.ai.phases[0].join(','))).size, 4, 'each opens the fight differently');
  // السريع: ضربتان متتابعتان معلنتان
  assert.equal(a[1].ai.doubleSlash, true);
  // الريح: موجتان بفجوة معلنة
  assert.equal(a[2].ai.doubleWave, true);
  assert.ok(a[2].ai.wave.gap > 0, 'the second wave has a declared gap');
  // الثقيل: زعيم مدرّع بمدى صدمة أوسع
  assert.equal(a[3].armored, true);
  assert.equal(a[3].boss, true);
  assert.ok(a[3].ai.slamRadius > 74, 'the boss slam is wider than a normal overhead');
  // العمق يزيد الصحة ولا يغيّر النمط
  assert.ok(R.create('miner', 7, DUEL(4)).enemies[0].maxHp > a[0].maxHp, 'deeper = tougher');
  assert.equal(R.create('miner', 7, DUEL(5)).enemies[0].style, 'swift', 'deep zones cycle the styles (zone % 4)');
});

test('V10 boss: two phases, an enrage event, and a punish window that the engine really enforces', () => {
  const s = R.create('miner', 7, DUEL(3));
  const b = s.enemies[0];
  const hp0 = b.hp;
  // الدرع: الضرر لا يقع إلا في نافذة الاستشفاء
  s.player.x = b.x - 40;
  R.step(s, R.INPUT.ATTACK);
  for (let i = 0; i < 10; i++) R.step(s, 0);
  assert.equal(b.hp, hp0, 'an armored boss ignores hits outside its recovery window');
  // المرحلة الثانية عند نصف الصحة: حدث اهتياج + صدمة ثانية معلنة
  b.hp = Math.floor(b.maxHp * 0.4);
  let enrage = false, follow = false;
  for (let i = 0; i < 600 && s.status === 'playing'; i++) {
    R.step(s, R.INPUT.DEFEND);
    for (const e of s.events) {
      if (e.type === 'boss_enrage' && e.phase === 2) enrage = true;
      if (e.type === 'boss_slam' && e.follow) follow = true;
    }
  }
  assert.equal(enrage, true, 'the boss announces its second phase');
  assert.equal(follow, true, 'and its second phase adds a follow-up slam');
  // الصدمة الواسعة أرضية (تُقفز)، والكاسرة العادية بكامل الطول (تُراوغ)
  const rules = fs.readFileSync(path.join(ROOT, 'public/platform-rules.js'), 'utf8');
  assert.match(rules, /ai\.wideSlam\s*\n?\s*\? \{ x: cx - radius, y: 300 - 44, w: radius \* 2, h: 44 \}/, 'the wide slam is ground-height and jumpable');
  assert.match(rules, /: \{ x: cx - radius, y: 300 - 96, w: radius \* 2, h: 96 \}/, 'the normal unblockable stays full height');
});

// ---------- 3) الحتمية وإعادة التشغيل ----------
test('V10 determinism: every archetype replays identically on the server path', () => {
  for (const zone of [0, 1, 2, 3]) {
    const seed = 4242 + zone;
    const s = R.create('miner', seed, DUEL(zone));
    const inputs = [];
    let mask = 0, frames = 0;
    const push = (m) => { if (m === mask) { frames++; return; } if (frames) inputs.push({ mask, frames }); mask = m; frames = 1; };
    for (let t = 0; t < 900 && s.status === 'playing'; t++) {
      const rival = s.enemies[0], p = s.player;
      const dx = rival.x + rival.w / 2 - (p.x + p.w / 2);
      let m = 0;
      if (rival.state === 'windup' || rival.state === 'charge') m |= R.INPUT.DEFEND;
      else if (Math.abs(dx) > 50) m |= dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
      else m |= R.INPUT.ATTACK;
      R.step(s, m); push(m);
    }
    if (frames) inputs.push({ mask, frames });
    const replay = R.replay(inputs, 'miner', seed, DUEL(zone));
    assert.equal(replay.ok, true, `zone ${zone}: the recorded stream is valid`);
    assert.deepEqual(
      [replay.state.tick, replay.state.status, replay.state.player.hearts, replay.state.enemies.map((e) => e.hp).join()],
      [s.tick, s.status, s.player.hearts, s.enemies.map((e) => e.hp).join()],
      `zone ${zone}: server replay == client simulation`);
  }
});

// ---------- 4) المهارة لا تتكرر بلا حدود ----------
test('V10 skill: mashing the key cannot exceed the cooldown rate', () => {
  const s = R.create('miner', 7, { ...DUEL(0), loadout: { drill: 5 } });
  s.player.x = 300; s.enemies[0].x = 340;
  let casts = 0;
  for (let t = 0; t < 600; t++) {
    const before = s.player.skillCooldown;
    R.step(s, R.INPUT.SKILL);
    if (s.player.skillCooldown > before) casts++;
    s.player.guard.stamina = s.player.guard.maxStamina; // نَفَس غير محدود: المهلة وحدها هي الحاجز
  }
  const maxCasts = Math.ceil(600 / s.player.skillMaxCooldown) + 1;
  assert.ok(casts <= maxCasts, `casts ${casts} must respect the ${s.player.skillMaxCooldown}-frame cooldown (max ${maxCasts})`);
});

// ---------- 5) واجهة الساحة تعرض المعدات ----------
test('V10 UI: the arena shows the gear card and fills it from the shared rules', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.match(html, /id="arena-gear"[^>]*aria-label="معداتك في المبارزة"/, 'the arena tab has a gear card');
  assert.ok(html.indexOf('id="arena-gear"') < html.indexOf('id="arena-ladder"'), 'it sits before the rival ladder, i.e. before the duel starts');
  assert.match(html, /function renderArenaGear\(\)/, 'and it is rendered by a real function');
  assert.match(html, /RULES\.combatGear\(hero, st\.equipment\)/, 'from the equipment the player actually owns');
  assert.match(html, /renderArenaGear\(\);\n\s+const box = document\.getElementById\('arena-ladder'\)/, 'and it refreshes with the ladder');
});

// ---------- 6) الخادم هو المرجع ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-gear-'));
const file = path.join(dir, 'game.db'), url = process.env.TEST_DATABASE_URL || '';
const port = 3251;
let child, store;
const runId = `${process.pid}_${Date.now()}`;
const guest = `gear_${runId}`;
const headers = { 'X-Guest-Id': guest, 'Content-Type': 'application/json' };

before(async () => {
  process.env.DATABASE_FILE = file; process.env.DATABASE_URL = url; store = createStore();
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', BOT_TOKEN: '', BOT_MODE: 'polling', STARS_ENABLED: 'false', DATABASE_URL: url, DATABASE_FILE: file },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => { output += b; });
  child.stderr.on('data', (b) => { output += b; });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch (_) {}
    if (child.exitCode !== null) throw new Error(output);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(output);
});
after(async () => {
  if (child?.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill('SIGTERM'); await done; }
  try { await store?.close?.(); } catch (_) {}
});

const post = async (route, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/platform/${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

test('V10 server: a forged loadout in the request body is ignored — the saved state wins', async () => {
  // الخادم يبني اللقطة من حفظ اللاعب (أصفار هنا) ويجب أن يتجاهل ما يرسله العميل
  const forged = await post('start', { zone: 0, mode: 'duel', loadout: { pickaxe: 5, armor: 5, drill: 5 } });
  assert.equal(forged.status, 200, 'the duel ticket opens');
  assert.deepEqual(forged.body.config.loadout, { pickaxe: 0, boots: 0, bag: 0, magnet: 0, drill: 0, robot: 0, luck: 0, armor: 0 },
    'the ticket carries the server-side loadout, not the client claim');
  // نرفع المعدات في الحفظ ثم نفتح جولة جديدة بعد إسقاط الجولة السابقة
  const uid = `guest_${guest}`;
  await store.withUsers([uid], async () => {
    const runs = await store.activePlatformRuns(uid);
    for (const r of runs) { r.status = 'expired'; await store.savePlatformRun(r); }
  });
  await store.withUsers([uid], async () => {
    const u = await store.getUser(uid);
    u.state.equipment = { ...u.state.equipment, pickaxe: 5, armor: 5, drill: 5 };
    await store.putUser(u);
  });
  const upgraded = await post('start', { zone: 0, mode: 'duel', resume: false });
  assert.equal(upgraded.status, 200);
  assert.equal(upgraded.body.config.loadout.pickaxe, 5, 'the server reflects the saved axe');
  assert.equal(upgraded.body.config.loadout.armor, 5, 'and the saved armor');
  const sim = R.create('miner', R.seedFromId(upgraded.body.id), upgraded.body.config);
  assert.equal(sim.player.damage, 3, 'so the simulation built from that ticket has the axe damage');
  assert.equal(sim.player.skillMaxCooldown, 100, 'and the drill cooldown');
  assert.equal(sim.player.guard.maxStamina, 200, 'and the armor breath');
});

// ---------- 7) الرحلة الكاملة عبر الخادم: معدات ← مبارزة ← خسارة/فوز ← مكافأة ← عودة ← تعدين ----------
// كل خطوة تمرّ على HTTP الحقيقي، والنتيجة والمكافأة تُقرأ من إعادة تشغيل الخادم لا من العميل.
const journeyGuest = `journey_${runId}`;
const journeyHeaders = { 'X-Guest-Id': journeyGuest, 'Content-Type': 'application/json' };
const jpost = async (route, body) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/platform/${route}`, { method: 'POST', headers: journeyHeaders, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
// الخادم يستقبل الإدخالات كمقاطع {mask, frames} — ندمج الإطارات المتتالية المتطابقة.
const toSegments = (masks) => {
  const out = [];
  for (const mask of masks) {
    const last = out[out.length - 1];
    if (last && last.mask === mask) last.frames++; else out.push({ mask, frames: 1 });
  }
  return out;
};
// يُسبق وقت بدء الجولة بمدة لعبها حتى لا يرفض الخادم جولة أسرع من الزمن الحقيقي.
// savePlatformRun لا يحدّث started_at عند التضارب (بالتصميم)، فالتعديل هنا على قاعدة الاختبار مباشرة.
const backdate = (id, ticks) => {
  const ms = Math.ceil((ticks / R.FPS) * 1000) + 2000;
  if (url) return false; // Postgres: يُتخطّى هذا الاختبار (نفس سلوك اختبارات القاعدة الأخرى)
  const Database = require('better-sqlite3');
  const db = new Database(file);
  try { db.prepare('UPDATE platform_runs SET started_at = started_at - ? WHERE id = ?').run(ms, String(id)); }
  finally { db.close(); }
  return true;
};

test('V10 journey: gear → duel loss → duel win → reward → exit/return → mining untouched', { skip: Boolean(url) ? 'needs sqlite to backdate the run clock' : false }, async () => {
  const uid = `guest_${journeyGuest}`;
  // (1) أول طلب يُنشئ الحفظ، ثم تُرقَّى المعدات فيه (الفأس/الدرع/المثقاب إلى 2)
  const first = await jpost('start', { zone: 0, mode: 'duel', resume: false });
  assert.equal(first.status, 200, 'the first request creates the save');
  await store.withUsers([uid], async () => {
    for (const r of await store.activePlatformRuns(uid)) { r.status = 'expired'; await store.savePlatformRun(r); }
  });
  await store.withUsers([uid], async () => {
    const u = await store.getUser(uid);
    u.state.equipment = { ...u.state.equipment, pickaxe: 2, armor: 2, drill: 2 };
    await store.putUser(u);
  });
  // (2) دخول الساحة: التذكرة تحمل المعدات المحفوظة وتغيّر محاكاة القتال
  const ticket = await jpost('start', { zone: 0, mode: 'duel', resume: false });
  assert.equal(ticket.status, 200, 'the duel ticket opens');
  assert.equal(ticket.body.config.loadout.pickaxe, 2, 'the ticket carries the upgraded axe');
  assert.equal(ticket.body.config.mode, 'duel', 'and the duel mode');
  const sim = R.create('miner', R.seedFromId(ticket.body.id), ticket.body.config);
  assert.equal(sim.player.damage, 2, 'the upgraded axe changes the fight simulation');

  // (3) خسارة نظيفة: لاعب لا يتحرك حتى نهاية الزمن (ساعة الجولة صادقة)
  const idle = [];
  for (let t = 0; t < R.MAX_TICKS && sim.status === 'playing'; t++) { idle.push(0); R.step(sim, 0); }
  assert.equal(sim.status, 'lost', 'standing still loses the duel when the clock runs out');
  await backdate(ticket.body.id, sim.tick);
  const loss = await jpost('finish', { id: ticket.body.id, inputs: toSegments(idle) });
  assert.equal(loss.status, 200, 'the loss is accepted');
  assert.equal(loss.body.won, false, 'and recorded as a loss');
  assert.equal(loss.body.arena.losses, 1, 'the server arena record moves');
  assert.equal(loss.body.mineWins, 0, 'a duel never counts as a mine win');

  // (4) مبارزة ثانية تُلعَب حتى الفوز بإدخالات حقيقية إطاراً بإطار
  const win = await jpost('start', { zone: 0, mode: 'duel', resume: false });
  assert.equal(win.status, 200);
  const wsim = R.create('miner', R.seedFromId(win.body.id), win.body.config);
  // نفس سياسة البوت المتقن المشتركة، ونفس لقطة «توقّف الضربة»: المحاكاة لا تتقدّم أثناءها
  // والإدخال المُلتقَط يُطبَّق بعدها، فالإطارات المسجّلة تساوي إطارات المحاكاة تماماً.
  const { BOTS } = require('../scripts/duel-bots.cjs');
  const inputs = [];
  let freeze = 0, pending = 0;
  for (let t = 0; t < R.MAX_TICKS && wsim.status === 'playing'; t++) {
    if (freeze > 0) { pending |= BOTS.expert(wsim); freeze--; continue; }
    const mask = BOTS.expert(wsim) | pending;
    pending = 0;
    inputs.push(mask);
    R.step(wsim, mask);
    for (const ev of wsim.events || []) if (ev.type === 'hit' || ev.type === 'hurt') freeze = Math.max(freeze, ev.type === 'hit' ? 2 : 3);
  }
  assert.equal(wsim.status, 'won', 'a real recorded input sequence wins zone 0 with gear 2');
  await backdate(win.body.id, wsim.tick);
  await store.withUsers([uid], async () => {
    const u = await store.getUser(uid);
    u.sync.lastRewardAt.adventure = 0; // إزالة تبريد المكافأة القصير بين الجولتين
    await store.putUser(u);
  });
  const won = await jpost('finish', { id: win.body.id, inputs: toSegments(inputs) });
  assert.equal(won.status, 200, 'the win is accepted');
  assert.equal(won.body.won, true, 'and recorded as a win');
  assert.equal(won.body.duel.rivalHp, 0, 'the receipt reads the rival HP from the server replay');
  assert.equal(won.body.arena.wins, 1, 'the arena record counts one win');
  assert.equal(won.body.mineWins, 0, 'still no mine win from the arena');
  assert.ok(won.body.gold > 0, 'the duel pays gold from its own cap');
  const after = await store.withUsers([uid], async () => {
    const u = await store.getUser(uid);
    return { gold: Number(u.state.gold) || 0, duelGold: Number(u.sync.duelGold) || 0,
      mines: JSON.stringify(u.state.mines), arena: { ...(u.sync.arena?.record || {}) } };
  });
  assert.ok(after.duelGold > 0, 'the duel reward is drawn from the duel cap');
  assert.equal(after.arena.wins, 1, 'the win is persisted in the save');

  // (5) عودة للتعدين: جولة منجم تُفتح وتُستأنف بنفس المعرّف، والمعدات لا تتسرّب للقتال
  const mine = await jpost('start', { zone: 0, mode: 'mine', resume: false });
  assert.equal(mine.status, 200, 'a mining round still starts after the arena');
  assert.equal(mine.body.config.mode, 'mine', 'and it is a mining round, not a duel');
  const again = await jpost('start', { zone: 0, mode: 'mine', resume: true });
  assert.equal(again.body.id, mine.body.id, 'resuming returns the same mining run (no reset, no lost progress)');
  const msim = R.create('miner', R.seedFromId(mine.body.id), mine.body.config);
  assert.equal(msim.player.guardBreakBonus, 0, 'no arena-only bonus leaks into the mine');
  for (let t = 0; t < 240; t++) R.step(msim, R.INPUT.RIGHT);
  assert.ok(msim.tick >= 240, 'the mine simulation runs unchanged');
  const finalState = await store.withUsers([uid], async () => {
    const u = await store.getUser(uid);
    return { mines: JSON.stringify(u.state.mines), gold: Number(u.state.gold) || 0 };
  });
  assert.equal(finalState.mines, after.mines, 'the mining progress ladder is untouched by arena play');
  assert.ok(finalState.gold >= after.gold, 'gold never goes down');
});
