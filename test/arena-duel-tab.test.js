// فصل تبويب الساحة عن تبويب اللعب — اختبار قبول على ثلاثة مستويات:
//  1) مسار الزر: لا تبديل تبويب ولا لمس لمشهد اللعب.
//  2) القماش: قماش اللعب لا يرسم حلبة النينجا أبدًا (الرسم اختياري بـ opts.arena فقط).
//  3) الخادم: جولة منجم مفتوحة وجولة مبارزة مفتوحة تتعايشان، وإنهاء إحداهما لا يُسقط الأخرى.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createStore } = require('../db');
const R = require('../public/platform-rules');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---------- 1) مسار زر «ابدأ المبارزة» ----------
test('«ابدأ المبارزة» لا يغادر تبويب الساحة: لا switchTab ولا showPlatform في المسار', () => {
  const html = read('public/index.html');
  const body = html.slice(html.indexOf('function startArenaDuel'), html.indexOf('function resumeActiveRun'));
  assert.ok(body.includes('game.startDuel'), 'the button starts the arena duel controller');
  assert.doesNotMatch(body, /switchTab\s*\(/, 'no tab switch');
  assert.doesNotMatch(body, /showPlatform/, 'never touches the play scene');
  assert.doesNotMatch(body, /switchPlayPanel/, 'never touches the play panel');
  assert.match(body, /classList\.add\('duel-live'\)/, 'it opens the in-arena fight layout');
  assert.match(body, /getElementById\('arena-pad'\)/, 'and shows the in-arena control pad');
});

test('a duel may start while a mining run is open — the mining run is never a precondition', () => {
  const game = read('public/platform-game.js');
  const start = game.slice(game.indexOf('startDuel(zone = 0)'), game.indexOf('busy:', game.indexOf('startDuel(zone = 0)')));
  assert.doesNotMatch(start, /running \|\| pending/, 'the mining run no longer blocks the arena duel');
  const runner = game.slice(game.indexOf('async function startArenaRun'), game.indexOf('async function duelFinish'));
  assert.doesNotMatch(runner, /if \(running \|\| pending\) return false;/, 'and the runner does not refuse either');
});

// ---------- 2) قماش اللعب لا يعرض الحلبة ----------
test('the play canvas stays a mine: the arena art is opt-in through opts.arena only', () => {
  const renderer = read('public/platform-renderer.js');
  assert.match(renderer, /const arenaMode = !!opts\.arena;/, 'no implicit arena when a duel simulation is drawn');
  assert.doesNotMatch(renderer, /arenaMode = !!opts\.arena \|\|/, 'the run mode is not part of the decision');
  const game = read('public/platform-game.js');
  // مسرح الساحة وحده هو من يطلب الحلبة
  const arenaCalls = game.match(/renderer\.draw\((arenaCanvas|canvas)[^;]*/g) || [];
  assert.ok(arenaCalls.some((c) => /arenaCanvas[\s\S]*arena: true/.test(c)), 'the arena stage asks for the arena art');
  const playDraw = arenaCalls.filter((c) => !c.includes('arenaCanvas'));
  assert.ok(playDraw.every((c) => !c.includes('arena: true')), 'the play canvas never asks for it');
});

// ---------- 3) الخادم: تعايش الوضعين ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arena-duel-tab-'));
const file = path.join(dir, 'game.db');
const url = process.env.TEST_DATABASE_URL || '';
const port = 3241;
let child, store;
const name = `arena_tab_${process.pid}_${Date.now()}`;
const headers = { 'X-Guest-Id': name, 'Content-Type': 'application/json' };
const post = async (route, body = {}) => {
  const res = await fetch(`http://127.0.0.1:${port}/api/platform/${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'development', BOT_TOKEN: '', BOT_MODE: 'polling', STARS_ENABLED: 'false', DATABASE_URL: url, DATABASE_FILE: file },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (b) => { output += b; });
  child.stderr.on('data', (b) => { output += b; });
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try { ready = (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch (_) {}
    if (child.exitCode !== null) throw new Error(output);
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) throw new Error(output);
  // مخزن مباشر على نفس القاعدة: لتهيئة تذكرة قديمة بما يكفي (حارس «أسرع من الزمن الحقيقي»)
  const oldFile = process.env.DATABASE_FILE, oldUrl = process.env.DATABASE_URL;
  process.env.DATABASE_FILE = file; process.env.DATABASE_URL = url; store = createStore();
  if (oldFile === undefined) delete process.env.DATABASE_FILE; else process.env.DATABASE_FILE = oldFile;
  if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
});
after(async () => {
  if (child && child.exitCode === null) {
    const done = new Promise((r) => child.once('exit', r));
    child.kill('SIGTERM');
    await done;
  }
  await store?.close();
});

// بوت مبارزة مرجعي حتمي: يصدّ عند الإنذار، ويهاجم بقوة أثناء الاستشفاء، ويقفز الموجات.
function duelInputs(seed, config, hero = 'miner') {
  const s = R.create(hero, seed, config);
  const inputs = [];
  let mask = 0, frames = 0;
  const push = (m) => { if (m === mask) { frames += 1; return; } if (frames) inputs.push({ mask, frames }); mask = m; frames = 1; };
  let ticks = 0;
  while (s.status === 'playing' && ticks < 60 * 100) {
    const rival = s.enemies[0], p = s.player;
    const dx = rival.x + rival.w / 2 - (p.x + p.w / 2), dist = Math.abs(dx);
    const incoming = rival.state === 'windup' || rival.state === 'charge' || s.waves.length > 0;
    const safe = rival.state === 'recover' || rival.state === 'retreat' || rival.state === 'stagger';
    let m = 0;
    if (incoming && p.grounded && p.guard.stamina > 6 && p.guard.broken <= 0) m |= R.INPUT.DEFEND;
    else if (safe) {
      if (dist > 40) m |= dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
      else m |= p.heavyCooldown <= 0 ? R.INPUT.HEAVY : R.INPUT.ATTACK;
    } else if (dist > 66) m |= dx > 0 ? R.INPUT.RIGHT : R.INPUT.LEFT;
    if (s.waves.length) m |= R.INPUT.JUMP;
    R.step(s, m); push(m); ticks += 1;
  }
  if (frames) inputs.push({ mask, frames });
  return { state: s, inputs };
}

test('a mining run and an arena duel stay open side by side and settle independently', async () => {
  const mine = await post('start', { zone: 0 });
  assert.equal(mine.status, 200, 'the mining run starts');
  const mineId = mine.body.id;

  // تشغيل نفس الطلب مرة أخرى للمنجم يعيد الجولة نفسها (لم تُستبدل)
  const mineAgain = await post('start', { zone: 0, resume: true });
  assert.equal(mineAgain.body.id, mineId, 'the mining ticket is stable');

  const duel = await post('start', { zone: 0, mode: 'duel' });
  assert.equal(duel.status, 200, 'the duel starts from the arena tab');
  assert.notEqual(duel.body.id, mineId, 'the duel gets its own ticket');
  assert.equal(duel.body.config.mode, 'duel', 'and its own mode');

  // جولة المنجم ما زالت مفتوحة ولم تُلغَ بالمبارزة
  const mineStill = await post('start', { zone: 0, resume: true });
  assert.equal(mineStill.body.id, mineId, 'starting the duel did not expire the mining run');
  assert.equal(mineStill.body.config.mode, 'mine', 'the mined run keeps its mode');

  // إنهاء المبارزة يُحتسب وحده: نُجهّز تذكرة مبارزة «قديمة بما يكفي» (حارس السرعة الخادمي)
  const hero = 'miner';
  // معرّف ثابت يجعل بذرة المبارزة قابلة لإعادة الإنتاج ولا يغيّر بين تشغيل وآخر.
  const id = '00000000-0000-4000-8000-000000000007';
  const seed = R.seedFromId(id);
  const loadout = R.normalizeLoadout();
  const cfg = R.normalizeConfig({ zone: 0, goal: 0, mode: 'duel', loadout });
  const play = duelInputs(seed, cfg, hero);
  assert.notEqual(play.state.status, 'playing', `the reference duel reaches a terminal state (tick ${play.state.tick})`);
  await store.withUsers([`guest_${name}`], async () => {
    await store.savePlatformRun({
      id, user_id: `guest_${name}`, version: R.VERSION, status: 'playing',
      started_at: Math.floor(Date.now() - (play.state.tick / 60) * 1000 - 3000),
      config_json: JSON.stringify({ zone: 0, goal: 0, mode: 'duel', loadout }),
    });
  });
  const finished = await post('finish', { id, inputs: play.inputs, hero });
  assert.equal(finished.status, 200, `the duel settles on the server (${JSON.stringify(finished.body)})`);
  assert.equal(finished.body.mode, 'duel', 'the receipt is a duel receipt');
  assert.equal(finished.body.won, play.state.status === 'won', 'the server replays the same outcome');

  // وبعد المبارزة ما زالت جولة المنجم مفتوحة كما هي
  const mineAfter = await post('start', { zone: 0, resume: true });
  assert.equal(mineAfter.body.id, mineId, 'the mining run survives the whole duel');
  assert.equal(mineAfter.body.config.mode, 'mine', 'and it is still a mining run');
});
