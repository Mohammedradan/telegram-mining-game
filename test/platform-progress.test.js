// V19.3 — مراجعة تقدّم المهام والمغامرات عند الخسارة (R1–R4)، على الخادم الحقيقي لا على الورق.
//
// الثغرة المقيسة قبل الإصلاح (بالكود نفسه، انظر docs/PHASE-B-PLAN-AR.md §B0):
//   • مهمة «أكمل 3 جولات مغامرة» (200 ذهب يومياً و600 أسبوعياً) كانت تكتمل بـ3 خسائر سريعة، بلا إتمام أي جولة.
//   • مهام المغامرة كانت تأخذ `ores` المجموع كاملاً بينما المحفظة تأخذ `awarded` (نصف الخسارة الصادقة، صفر غيرها)،
//     فيتقدّم عدّاد «اجمع 40 نحاساً» بمقدار الضعف عمّا دخل المخزن فعلاً.
//   • إنجاز «أول مغامرة» كان يعدّ المحاولات ويسمّيها إتماماً.
//   • مبارزة الساحة كانت تُغذّي إحصاءات المغامرة ومهامها ومغامراتها، فتختلط التجربتان.
//
// هذا الملف يثبت الإصلاح من طرف الخادم: نُشغّل جولات حقيقية (إدخالات مسجّلة يعيدها الخادم بنفسه)، ونقرأ
// ما استقرّ في المستخدم فعلاً: المهام اليومية والأسبوعية، مهام المغامرة، الإنجازات، والإحصاءات.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { createStore } = require('../db');
const R = require('../public/platform-rules');
const solution = require('./fixtures/platform-solution.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-progress-'));
const file = path.join(dir, 'game.db'), url = process.env.TEST_DATABASE_URL || '';
const ports = [3241, 3242];
let children = [], store;
const runId = `${process.pid}_${Date.now()}`;
const user = (name) => `progress_${runId}_${name}`;
const headers = (name) => ({ 'X-Guest-Id': user(name), 'Content-Type': 'application/json' });
const uidOf = (name) => `guest_${user(name)}`;

async function launch(port) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', BOT_TOKEN: '', BOT_MODE: 'polling', STARS_ENABLED: 'false', DATABASE_URL: url, DATABASE_FILE: file },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child); let output = '';
  child.stdout.on('data', (b) => { output += b; }); child.stderr.on('data', (b) => { output += b; });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return child; } catch (_) { /* لم يفتح بعد */ }
    if (child.exitCode !== null) throw new Error(output);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(output);
}
async function stop(child) { if (child?.exitCode === null) { const done = new Promise((r) => child.once('exit', r)); child.kill('SIGTERM'); await done; } }
async function post(name, route, body = {}, port = ports[0], method = 'POST') {
  const res = await fetch(`http://127.0.0.1:${port}/api/platform/${route}`, { method, headers: headers(name), ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json() };
}

// نفس مفاتيح اليوم/الأسبوع التي يستخدمها الخادم (server.js: dayStr / currentWeekKey)
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
function weekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400e3 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

async function patchUser(name, fn) {
  await store.withUsers([uidOf(name)], async () => {
    const u = await store.getUser(uidOf(name));
    fn(u);
    await store.putUser(u);
  });
}
// تثبيت مجموعة مهام معروفة (بدل سحب اليوم العشوائي) كي يقيس الاختبار أثر الجولة نفسها فقط
async function fixMissions(name, daily, weekly) {
  await post(name, 'start', {}); // يضمن وجود صف المستخدم قبل تثبيت مهامه
  await patchUser(name, (u) => {
    u.sync.missions = { day: dayKey(), items: daily.map((key) => ({ key, progress: 0, claimed: false })), bonusClaimed: false };
    u.sync.weeklyMissions = { week: weekKey(), items: weekly.map((key) => ({ key, progress: 0, claimed: false })), bonusClaimed: false };
  });
}
// حقن جولة بإدخالاتها الحقيقية: التذكرة والمنجم والهدف والوضع من الخادم، والبذرة من معرّف الجولة
async function inject(name, { zone = 0, goal = 0, mode = 'mine', inputs, seconds }) {
  await post(name, 'start', { zone, goal, mode });
  const id = crypto.randomUUID();
  const row = {
    id, user_id: uidOf(name), version: R.VERSION, status: 'playing',
    started_at: Math.floor(Date.now() - seconds * 1000 - 2000),
    config_json: JSON.stringify({ zone, goal, mode, loadout: {} }),
  };
  await store.withUsers([row.user_id], async () => {
    const active = await store.activePlatformRun(row.user_id);
    if (active) { active.status = 'expired'; await store.savePlatformRun(active); }
    await store.savePlatformRun(row);
  });
  return { id, inputs };
}
const pack = (masks) => {
  const out = [];
  let mask = 0, frames = 0;
  for (const m of masks) { if (m === mask) { frames += 1; continue; } if (frames) out.push({ mask, frames }); mask = m; frames = 1; }
  if (frames) out.push({ mask, frames });
  return out;
};
// خسارة صادقة: يمشي ويعدّن ويقفز حتى يتجاوز أول راية (920)، ثم يقف ساكناً حتى نهاية الساعة → status = lost، 150 ثانية.
function honestLossTape(zone = 0) {
  const masks = [];
  for (let t = 0; t < 246; t++) masks.push(R.INPUT.RIGHT | R.INPUT.MINE | (t % 18 < 6 ? R.INPUT.JUMP : 0));
  while (masks.length < R.MAX_TICKS) masks.push(0);
  return pack(masks);
}
// خسارة بلا راية: يعدّن قليلاً ثم يقف → status = lost عند الساعة، لكن checkpoint = البداية ⇒ لا استحقاق
function noCheckpointTape(zone = 1) {
  const masks = [];
  for (let t = 0; t < 200; t++) masks.push(R.INPUT.RIGHT | R.INPUT.MINE);
  while (masks.length < R.MAX_TICKS) masks.push(0);
  return pack(masks);
}
// مبارزة كاملة بذكاء اللاعب المنتبه نفسه المستخدم في اختبارات الساحة
function duelTape(seed, zone = 0) {
  const cfg = { zone, mode: 'duel' };
  const s = R.create('miner', seed, cfg);
  const masks = [];
  let ticks = 0;
  while (s.status === 'playing' && ticks < 60 * 100) {
    const rival = s.enemies[0], p = s.player;
    const dx = rival.x + rival.w / 2 - (p.x + p.w / 2), dist = Math.abs(dx);
    const incoming = rival.state === 'windup' || rival.state === 'charge' || s.waves.length > 0;
    const safe = rival.state === 'recover' || rival.state === 'retreat' || rival.state === 'stagger';
    let m = 0;
    if (incoming && p.grounded && p.guard.stamina > 6 && p.guard.broken <= 0) m |= R.INPUT.DEFEND;
    else if (safe) { if (dist > 40) m |= dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT; else m |= p.heavyCooldown <= 0 ? R.INPUT.HEAVY : R.INPUT.ATTACK; }
    else if (dist > 66) m |= dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
    if (s.waves.length) m |= R.INPUT.JUMP;
    R.step(s, m); masks.push(m); ticks += 1;
  }
  return { inputs: pack(masks), state: s };
}

before(async () => {
  await launch(ports[0]); await launch(ports[1]);
  const oldFile = process.env.DATABASE_FILE, oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_FILE = file; process.env.DATABASE_URL = url; store = createStore();
  if (oldFile === undefined) delete process.env.DATABASE_FILE; else process.env.DATABASE_FILE = oldFile;
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});
after(async () => { await Promise.all(children.map(stop)); await store?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('R1: an honest loss no longer advances the "complete runs" missions, but keeps real activity missions', async () => {
  const name = 'honest-loss';
  await fixMissions(name, ['runs', 'gems', 'score'], ['runs', 'gems']);
  const { id, inputs } = await inject(name, { zone: 0, inputs: honestLossTape(), seconds: R.MAX_TICKS / R.FPS });
  const res = await post(name, 'finish', { id, inputs });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.won, false, 'the tape really loses');
  const daily = Object.fromEntries(res.body.profile.missions.items.map((i) => [i.key, i]));
  const weekly = Object.fromEntries(res.body.profile.weeklyMissions.items.map((i) => [i.key, i]));
  assert.equal(daily.runs.progress, 0, 'R1: three deaths are not three completed runs');
  assert.equal(weekly.runs.progress, 0, 'R1: the weekly completion mission is gated the same way');
  assert.equal(daily.gems.progress, res.body.gems, 'gems are real activity and still count');
  assert.equal(daily.score.progress, res.body.score, 'score is real activity and still counts');
  assert.ok(daily.play_time === undefined || daily.play_time.progress > 0);
  const adv = res.body.profile.state.adventure;
  assert.equal(adv.runs, 1, 'the attempt itself is still recorded as a played run');
  assert.equal(adv.gems, res.body.gems);
});

test('R1: a won run still completes the daily and weekly run missions', async () => {
  const name = 'winner';
  await fixMissions(name, ['runs', 'gems'], ['runs']);
  const id = crypto.randomUUID();
  const sol = solution(R.seedFromId(id), 'miner');
  await post(name, 'start', { zone: 0, goal: 0, mode: 'mine' });
  await store.withUsers([uidOf(name)], async () => {
    const active = await store.activePlatformRun(uidOf(name));
    if (active) { active.status = 'expired'; await store.savePlatformRun(active); }
    await store.savePlatformRun({ id, user_id: uidOf(name), version: R.VERSION, status: 'playing', started_at: Math.floor(Date.now() - 60_000), config_json: JSON.stringify({ zone: 0, goal: 0, mode: 'mine', loadout: {} }) });
  });
  const res = await post(name, 'finish', { id, inputs: sol.inputs });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.won, true, 'the fixture really wins');
  const daily = Object.fromEntries(res.body.profile.missions.items.map((i) => [i.key, i]));
  const weekly = Object.fromEntries(res.body.profile.weeklyMissions.items.map((i) => [i.key, i]));
  assert.equal(daily.runs.progress, 1);
  assert.equal(weekly.runs.progress, 1);
});

test('R2: quest ore counters receive what entered the wallet, not what was gathered', async () => {
  const name = 'ore-half';
  const { id, inputs } = await inject(name, { zone: 0, inputs: honestLossTape(), seconds: R.MAX_TICKS / R.FPS });
  const res = await post(name, 'finish', { id, inputs });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const gathered = res.body.oresGathered, awarded = res.body.ores;
  assert.ok(gathered.copper > 0, 'the run really gathered copper');
  assert.equal(awarded.copper, Math.floor(gathered.copper / 2), 'an honest loss banks half (rules/oreAward)');
  const wallet = res.body.profile.state.ores;
  const quests = Object.fromEntries(res.body.profile.quests.items.map((i) => [i.id, i]));
  assert.equal(quests.copper_40.value, awarded.copper, 'R2: the copper quest counter equals the wallet, not the bag');
  assert.equal(quests.copper_40.value, wallet.copper);
  assert.ok(quests.copper_40.value < gathered.copper, 'and it is strictly smaller than what the player gathered');
});

test('R2: a loss that never reached a checkpoint banks nothing and advances no ore counter', async () => {
  const name = 'ore-none';
  const { id, inputs } = await inject(name, { zone: 1, inputs: noCheckpointTape(), seconds: R.MAX_TICKS / R.FPS });
  const res = await post(name, 'finish', { id, inputs });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.ok(Object.values(res.body.oresGathered).reduce((a, b) => a + b, 0) > 0, 'the run did gather ore');
  assert.deepEqual(res.body.ores, { copper: 0, iron: 0, gold: 0, crystal: 0, lava: 0 }, 'but no checkpoint ⇒ nothing banked');
  const quests = Object.fromEntries(res.body.profile.quests.items.map((i) => [i.id, i]));
  assert.equal(quests.copper_40.value, 0, 'R2: so no quest counter moves either');
  assert.equal(quests.iron_30.value, 0);
});

test('R3: the first-run achievement is named as an attempt and no longer claims completion', async () => {
  const name = 'first-attempt';
  const { id, inputs } = await inject(name, { zone: 1, inputs: noCheckpointTape(), seconds: R.MAX_TICKS / R.FPS });
  const res = await post(name, 'finish', { id, inputs });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const ach = Object.fromEntries(res.body.profile.achievements.items.map((i) => [i.id, i]));
  assert.equal(ach.first_run.name, 'أول محاولة');
  assert.doesNotMatch(ach.first_run.desc, /أكمل/);
  assert.equal(ach.first_run.done, true, 'an attempt still counts for the onboarding reward');
  assert.equal(ach.first_run.gold, 25, 'and its value did not change');
});

test('R4: a duel moves the arena track only — never the adventure stats, quests or mining missions', async () => {
  const name = 'duel';
  await fixMissions(name, ['runs', 'arena'], ['runs', 'arena']);
  const id = crypto.randomUUID();
  const duel = duelTape(R.seedFromId(id), 0);
  assert.equal(duel.state.status, 'won', 'the duel tape wins');
  const seconds = duel.state.tick / R.FPS;
  await post(name, 'start', { zone: 0, goal: 0, mode: 'duel' });
  await store.withUsers([uidOf(name)], async () => {
    const active = await store.activePlatformRun(uidOf(name));
    if (active) { active.status = 'expired'; await store.savePlatformRun(active); }
    await store.savePlatformRun({ id, user_id: uidOf(name), version: R.VERSION, status: 'playing', started_at: Math.floor(Date.now() - seconds * 1000 - 2000), config_json: JSON.stringify({ zone: 0, goal: 0, mode: 'duel', loadout: {} }) });
  });
  // صورة كاملة للمستخدم قبل المبارزة: كل حقل مغامرة وكل محفظة وكل عدّاد — لا نكتفي بالإحصاءات الثلاثة
  const before = await (async () => { const u = await store.getUser(uidOf(name)); return JSON.parse(JSON.stringify({
    adventure: u.state.adventure, ores: u.state.ores || {}, xp: u.state.xp || 0, gold: u.state.gold || 0,
    quests: u.sync.quests || {}, mines: u.state.mines, duelGold: u.sync.duelGold || 0, platformGold: u.sync.platformGold || 0,
  })); })();
  const res = await post(name, 'finish', { id, inputs: duel.inputs });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.won, true);
  const after = await store.getUser(uidOf(name));
  // 1) كل عدّاد مغامرة كما كان بالحرف (runs/gems/playSec/defeated/bestScore/rewardEarned/bossWins/zones)
  assert.deepEqual(after.state.adventure, before.adventure, 'R4: not a single adventure counter moved');
  // 2) المحفظة: المبارزة لا تنتج خاماً (لا صخور فيها)، فلا يدخل المخزن شيء
  assert.deepEqual(after.state.ores || {}, before.ores, 'R4: no ore reached the wallet from a duel');
  // 3) عدّادات مهام المغامرة وسجل الانتصارات في المناجم لم تتغيّر
  assert.deepEqual(after.sync.quests, before.quests, 'R4: quest counters (rocks/enemies/ores/bosses) are untouched');
  assert.deepEqual(after.state.mines, before.mines, 'R4: mine wins are untouched');
  // 4) ذهب المبارزة يذهب إلى سقفه المستقل، لا إلى ذهب المناجم اليومي
  assert.ok((after.sync.duelGold || 0) > before.duelGold, 'the duel paid into its own daily bucket');
  assert.equal(after.sync.platformGold || 0, before.platformGold, 'and not into the mining daily bucket');
  const adv = res.body.profile.state.adventure;
  assert.equal(adv.runs, 0, 'R4: a duel is not an adventure run');
  assert.equal(adv.gems, 0);
  assert.equal(adv.playSec, 0);
  const quests = Object.fromEntries(res.body.profile.quests.items.map((i) => [i.id, i]));
  assert.equal(quests.guards_50.value, 0, 'R4: duel kills do not feed the mining quest');
  const daily = Object.fromEntries(res.body.profile.missions.items.map((i) => [i.key, i]));
  assert.equal(daily.runs.progress, 0, 'R4: and a won duel is not a completed mining run');
  assert.equal(daily.arena.progress, 1, 'the arena mission still counts the duel win');
  assert.equal(res.body.profile.arena.record.wins, 1, 'the server-side arena record still moves');
  // 5) إنجازات المغامرة لا تُفتح بمبارزة: «أول محاولة» و«جامع الكنوز» و«صانع الذهب» كما كانت
  const ach = Object.fromEntries(res.body.profile.achievements.items.map((i) => [i.id, i]));
  assert.equal(ach.first_run.done, false, 'R4: a duel win is not a mining attempt');
  assert.equal(ach.collector.value, 0, 'R4: no gems credited to the adventure total');
  assert.equal(ach.earner.value, 0, 'R4: duel gold is not adventure earnings');
  // 6) ما تبقّى مشتركاً بحكم التصميم (وليس إحصاء مغامرة): الخبرة العامة ومجموع الذهب الكلي
  assert.ok((after.state.xp || 0) > before.xp, 'XP is the shared global track and a won duel still grants it (by design)');
  assert.ok(after.state.gold > before.gold, 'and the duel gold is real gold in the wallet (by design)');
});
