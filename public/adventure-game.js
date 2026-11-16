// ================= 🎮 لعبة مغامرة المنجم التفاعلية =================
const advCanvas = document.getElementById('game-canvas');
const advCtx = advCanvas.getContext('2d');
const ADV = { duration: 60, playerW: 78, playerH: 34 };
const adv = {
  running: false, paused: false, score: 0, combo: 0, maxCombo: 0, lives: 3, timeLeft: ADV.duration,
  objects: [], particles: [], playerX: 180, targetX: 180, prevX: 180, elapsed: 0, spawnIn: 0,
  lastTs: 0, raf: 0, best: Number(localStorage.getItem('mining_adventure_best') || 0),
  caught: 0, missed: 0, gemsCaught: 0, missionIndex: 0, shake: 0, flash: 0,
  banner: '', bannerUntil: 0, phase: 0, lockNoticePhase: -1, zoneSpawnCount: 0, muted: false, audio: null, shieldCharges: 0,
  mode: 'solo', rng: null, raceLastSend: 0, gameMode: 'classic', gameDifficulty: 'normal',
  skillCharges: 1, nextEventAt: 18, eventUntil: -1, eventType: null,
  boss: null, bossCharge: 0, bossDefeated: false,
  fx: { magnetUntil: -1, slowUntil: -1, starUntil: -1, feverUntil: -1, shield: false },
};
// مناطق متدرجة بصرياً مع تصاعد كثافة التحدي في حلقة اللعب الحالية.
const ADV_MINE_ZONES = [
  { name: 'كهف البداية', icon: '🪨', hint: 'اجمع الموارد وتعلّم الإيقاع', top: '#312e81', glow: '#f59e0b', floor: '#1c1917' },
  { name: 'كهف الكريستال', icon: '💎', hint: 'الجواهر أثمن بـ25% — تحرّك بدقة', top: '#164e63', glow: '#22d3ee', floor: '#083344' },
  { name: 'منجم الحمم', icon: '🌋', hint: 'في المغامرة الفردية، كل خامس كنز يصبح صخرة خطرة', top: '#7f1d1d', glow: '#fb7185', floor: '#450a0a' },
];
// فتح المناطق تدريجياً بناءً على إحصاءات المغامرة المحفوظة محلياً.
// هذا تقدم للعب الفردي فقط؛ لا يمنح مكافآت سحابية ولا يغيّر عدالة السباقات.
const ADV_ZONE_REQUIREMENTS = [
  { gems: 0, runs: 0, bosses: 0 },
  { gems: 25, runs: 3, bosses: 0 },
  { gems: 75, runs: 0, bosses: 1 },
];
// الخادم يحتسب المناطق من جولات تحقق منها (state.adventure.zones)؛ ما فُتح محلياً قبل ذلك
// يبقى متاحاً للّعب (تقدّم تجميلي/صعوبة لا ذهب فيه) حتى لا يفقد اللاعبون القدامى مناطقهم.
const advServer = { zones: 0, runs: 0 };
function getUnlockedAdventureZones() {
  const gems = Math.max(0, Number(advStats.totalGems) || 0);
  const runs = Math.max(0, Number(advStats.runs) || 0);
  const bosses = Math.max(0, Number(advStats.bossWins) || 0);
  let unlocked = 1;
  if (gems >= ADV_ZONE_REQUIREMENTS[1].gems || runs >= ADV_ZONE_REQUIREMENTS[1].runs) unlocked = 2;
  if (gems >= ADV_ZONE_REQUIREMENTS[2].gems || bosses >= ADV_ZONE_REQUIREMENTS[2].bosses) unlocked = 3;
  return Math.max(unlocked, Math.min(ADV_MINE_ZONES.length, Math.floor(advServer.zones) || 1));
}
// اعتماد إحصاءات المغامرة الخادمية: السجل المحلي لا ينقص (قد يسبق الخادم بجولات قديمة أو مرفوضة)
function adoptServerAdventure(a, raceTotals) {
  if (a && typeof a === 'object') {
    advServer.zones = Math.max(1, Math.floor(Number(a.zones) || 1));
    advServer.runs = Math.max(0, Math.floor(Number(a.runs) || 0));
    const lift = (key, value) => { const v = Math.max(0, Number(value) || 0); if (v > (Number(advStats[key]) || 0)) advStats[key] = v; };
    lift('runs', a.runs); lift('totalGems', a.gems); lift('maxCombo', a.maxCombo); lift('bestSurvival', a.bestSurvival);
    lift('bossWins', a.bossWins); lift('rewardEarned', a.rewardEarned);
    if (Number(a.bestScore) > adv.best) {
      adv.best = Math.floor(Number(a.bestScore));
      try { localStorage.setItem('mining_adventure_best', String(adv.best)); } catch (e) {}
    }
  }
  if (raceTotals && Number(raceTotals.wins) > (Number(advStats.raceWins) || 0)) advStats.raceWins = Math.floor(Number(raceTotals.wins));
  saveAdvStats();
  if (typeof renderAchievements === 'function') renderAchievements();
  if (typeof updateAdvSettingsUI === 'function') updateAdvSettingsUI();
  if (typeof updateAdventureUI === 'function' && !adv.running) updateAdventureUI();
}
function getAdventureZoneUnlockHint(zoneIndex) {
  if (zoneIndex === 1) return 'التقط 25 جوهرة أو أكمل 3 جولات لفتح كهف الكريستال';
  if (zoneIndex === 2) return 'اجمع 75 جوهرة أو اهزم الزعيم مرة لفتح منجم الحمم';
  return '';
}

const advKeys = {};

// ⚙️ خيارات اللعب: أوضاع + صعوبة + شكل (محفوظة على الجهاز)
let advSettings = { mode: 'classic', difficulty: 'normal', skin: 'miner' };
let advStats = { runs: 0, totalGems: 0, maxCombo: 0, bestSurvival: 0, raceWins: 0, rewardEarned: 0, bossWins: 0 };
let advClaimed = {};
try { advSettings = { ...advSettings, ...JSON.parse(localStorage.getItem('mining_adventure_settings') || '{}') }; } catch (e) {}
try { advStats = { ...advStats, ...JSON.parse(localStorage.getItem('mining_adventure_stats') || '{}') }; } catch (e) {}
try { advClaimed = JSON.parse(localStorage.getItem('mining_adventure_claimed') || '{}'); } catch (e) {}
const saveAdvSettings = () => { try { localStorage.setItem('mining_adventure_settings', JSON.stringify(advSettings)); } catch (e) {} };
const saveAdvStats = () => { try { localStorage.setItem('mining_adventure_stats', JSON.stringify(advStats)); localStorage.setItem('mining_adventure_claimed', JSON.stringify(advClaimed)); } catch (e) {} };

const ADV_MODES = {
  classic: { label: 'كلاسيك', duration: 60, spawnScale: 1, fallScale: 1, rewardScale: 1 },
  blitz: { label: 'البرق', duration: 30, spawnScale: 0.7, fallScale: 1.28, rewardScale: 1.15 },
  survival: { label: 'البقاء', duration: Infinity, spawnScale: 0.88, fallScale: 1.05, rewardScale: 1.4 },
  boss: { label: 'الزعيم', duration: 75, spawnScale: 0.95, fallScale: 1.05, rewardScale: 1.1 },
};
const ADV_DIFFS = {
  easy: { label: 'سهل', lives: 1, fallScale: 0.85, scoreScale: 0.85 },
  normal: { label: 'عادي', lives: 0, fallScale: 1, scoreScale: 1 },
  hard: { label: 'صعب', lives: -1, fallScale: 1.2, scoreScale: 1.4 },
};
const advModeCfg = () => ADV_MODES[adv.gameMode || advSettings.mode] || ADV_MODES.classic;
const advDiffCfg = () => ADV_DIFFS[adv.gameDifficulty || advSettings.difficulty] || ADV_DIFFS.normal;

const ADV_SKINS = [
  { id: 'miner', icon: '⛏️', name: 'المعدّن', colors: ['#f59e0b', '#b45309'], unlock: 0 },
  { id: 'rocket', icon: '🚀', name: 'الصاروخ', colors: ['#818cf8', '#4338ca'], unlock: 200 },
  { id: 'truck', icon: '🛻', name: 'الشاحنة', colors: ['#34d399', '#065f46'], unlock: 400 },
  { id: 'dragon', icon: '🐉', name: 'التنين', colors: ['#e879f9', '#86198f'], unlock: 700 },
];
const advSkin = () => ADV_SKINS.find((s) => s.id === advSettings.skin) || ADV_SKINS[0];

function updateAdvSettingsUI() {
  document.querySelectorAll('[data-adv-mode]').forEach((b) => {
    const on = b.dataset.advMode === advSettings.mode;
    b.classList.toggle('border-amber-400', on); b.classList.toggle('bg-amber-500/15', on); b.classList.toggle('text-amber-300', on);
  });
  document.querySelectorAll('[data-adv-diff]').forEach((b) => {
    const on = b.dataset.advDiff === advSettings.difficulty;
    b.classList.toggle('border-amber-400', on); b.classList.toggle('bg-amber-500/15', on); b.classList.toggle('text-amber-300', on);
  });
  const skins = document.getElementById('adv-skins');
  if (skins) {
    skins.innerHTML = '';
    for (const skin of ADV_SKINS) {
      const unlocked = adv.best >= skin.unlock;
      const btn = document.createElement('button');
      btn.className = `border rounded-xl py-2 text-[10px] font-bold ${advSettings.skin === skin.id ? 'border-amber-400 bg-amber-500/15 text-amber-300' : 'border-slate-700 bg-slate-950/50'} ${unlocked ? '' : 'opacity-45'}`;
      btn.innerHTML = `<span class="text-xl block">${skin.icon}</span>${unlocked ? skin.name : `🔒 ${skin.unlock}`}`;
      btn.onclick = () => setAdventureSkin(skin.id);
      skins.appendChild(btn);
    }
  }
}
function setAdventureMode(mode) {
  if (adv.running) { haptic('error'); return; }
  advSettings.mode = mode; saveAdvSettings(); updateAdvSettingsUI(); haptic('light');
}
function setAdventureDifficulty(diff) {
  if (adv.running) { haptic('error'); return; }
  advSettings.difficulty = diff; saveAdvSettings(); updateAdvSettingsUI(); haptic('light');
}
function setAdventureSkin(id) {
  const skin = ADV_SKINS.find((s) => s.id === id);
  if (!skin || adv.best < skin.unlock) { haptic('error'); return; }
  advSettings.skin = id; saveAdvSettings(); updateAdvSettingsUI(); drawAdventure(); haptic('success');
}

// 🏅 الإنجازات
const ADV_ACHIEVEMENTS = [
  { id: 'first_run', icon: '🎬', name: 'أول مغامرة', desc: 'أكمل جولة واحدة', reward: 25, met: () => advStats.runs >= 1, progress: () => `${Math.min(1, advStats.runs)}/1` },
  { id: 'score500', icon: '💎', name: 'نتيجة 500', desc: 'حقق أفضل نتيجة 500+', reward: 75, met: () => adv.best >= 500, progress: () => `${Math.min(500, Math.floor(adv.best))}/500` },
  { id: 'combo20', icon: '🔥', name: 'سلسلة 20', desc: 'حقق أعلى سلسلة ×20', reward: 75, met: () => advStats.maxCombo >= 20, progress: () => `${Math.min(20, advStats.maxCombo)}/20` },
  { id: 'collector', icon: '🧲', name: 'جامع الكنوز', desc: 'التقط 300 جوهرة إجمالاً', reward: 100, met: () => advStats.totalGems >= 300, progress: () => `${Math.min(300, advStats.totalGems)}/300` },
  { id: 'survivor', icon: '💀', name: 'الناجي', desc: 'حقق 300 نقطة في وضع البقاء', reward: 100, met: () => advStats.bestSurvival >= 300, progress: () => `${Math.min(300, Math.floor(advStats.bestSurvival))}/300` },
  { id: 'boss', icon: '👹', name: 'قاتل الزعماء', desc: 'اهزم زعيم المنجم مرة واحدة', reward: 100, met: () => advStats.bossWins >= 1, progress: () => `${Math.min(1, advStats.bossWins)}/1` },
  { id: 'racer', icon: '⚔️', name: 'بطل السباقات', desc: 'افُز بسباق مباشر واحد', reward: 50, met: () => advStats.raceWins >= 1, progress: () => `${Math.min(1, advStats.raceWins)}/1` },
  { id: 'earner', icon: '🪙', name: 'صانع الذهب', desc: 'اكسب 500 ذهب من المغامرات', reward: 100, met: () => advStats.rewardEarned >= 500, progress: () => `${Math.min(500, advStats.rewardEarned)}/500` },
];
// متصلاً بالخادم: القائمة والتقدّم والاستلام كلها من الخادم (إحصاءات تحقق منها هو)؛ دون خادم: القائمة المحلية القديمة
const serverAchievements = () => (serverMode && profile?.achievements && Array.isArray(profile.achievements.items)) ? profile.achievements : null;
function renderAchievements() {
  const box = document.getElementById('adv-achievements');
  if (!box) return;
  box.innerHTML = '';
  const cloud = serverAchievements();
  const counter = document.getElementById('ach-count');
  if (counter) counter.innerText = cloud ? `${cloud.items.filter((i) => i.claimed).length}/${cloud.items.length}` : '';
  const rows = cloud
    ? cloud.items.map((a) => ({ id: a.id, icon: a.icon, name: a.name, desc: a.desc, reward: a.gold, xp: a.xp, claimed: a.claimed, met: a.done, progress: `${fmt(a.value)}/${fmt(a.target)}` }))
    : ADV_ACHIEVEMENTS.map((a) => ({ id: a.id, icon: a.icon, name: a.name, desc: a.desc, reward: a.reward, xp: 0, claimed: Boolean(advClaimed[a.id]), met: a.met(), progress: a.progress() }));
  for (const a of rows) {
    const row = document.createElement('div');
    row.className = `flex justify-between items-center border p-2 rounded-lg ${a.claimed ? 'bg-emerald-500/10 border-emerald-700/40' : a.met ? 'bg-amber-500/10 border-amber-700/40' : 'bg-slate-950/50 border-slate-800'}`;
    const info = document.createElement('div');
    info.innerHTML = `<div class="font-bold text-[11px]">${a.icon} ${a.name} <span class="text-slate-400 font-normal">(${a.progress})</span></div><div class="text-[9px] text-slate-400">${a.desc} — مكافأة ${a.reward} 🪙${a.xp ? ` + ${a.xp} خبرة` : ''}</div>`;
    const btn = document.createElement('button');
    btn.className = 'bg-amber-500 disabled:opacity-40 text-slate-950 font-bold px-2.5 py-1.5 rounded-lg text-[10px] shrink-0';
    btn.textContent = a.claimed ? '✓ استُلمت' : a.met ? `استلم ${a.reward}` : '🔒';
    btn.disabled = a.claimed || !a.met;
    btn.onclick = () => claimAchievement(a.id);
    row.append(info, btn);
    box.appendChild(row);
  }
}
function claimAchievement(id) {
  const cloud = serverAchievements();
  if (cloud) {
    // الخادم يتحقق من الإنجاز من إحصاءاته هو؛ هنا عرض متفائل يؤكده (أو يصححه) الرد التالي
    const a = cloud.items.find((x) => x.id === id);
    if (!a || a.claimed || !a.done) { haptic('error'); return; }
    a.claimed = true;
    state.gold += a.gold; state.totalEarned += a.gold;
    enqueueOp({ type: 'achievement', id, expected: a.gold });
    haptic('success');
    advBeep(880, 0.15, 'triangle', 0.06, 1320);
    renderAchievements();
    updateUI();
    save();
    return;
  }
  const a = ADV_ACHIEVEMENTS.find((x) => x.id === id);
  if (!a || advClaimed[id] || !a.met()) { haptic('error'); return; }
  advClaimed[id] = true;
  state.gold += a.reward;
  state.totalEarned += a.reward;
  saveAdvStats();
  haptic('success');
  advBeep(880, 0.15, 'triangle', 0.06, 1320);
  renderAchievements();
  updateUI();
  save();
}

// 🛠️ ترقيات المغامرة الدائمة (الأسعار مطابقة للخادم — يُتحقق منها هناك)
const ADV_UPGRADE_DEFS = {
  magnet: { icon: '🧲', name: 'مغناطيس مطوّر', desc: 'مدة جذب أطول ونطاق أوسع', base: 150, growth: 1.7, max: 5 },
  cart: { icon: '🛒', name: 'عربة أوسع', desc: 'عربة أكبر تلتقط بسهولة', base: 200, growth: 1.7, max: 5 },
  speed: { icon: '👢', name: 'حذاء سريع', desc: 'حركة أسرع واستجابة أعلى', base: 150, growth: 1.6, max: 5 },
  shield: { icon: '🛡️', name: 'درع البداية', desc: 'ابدأ كل جولة محمياً (مستوى 3: درعان)', base: 250, growth: 1.8, max: 3 },
  heart: { icon: '❤️', name: 'قلب إضافي', desc: 'قلب بداية إضافي لكل مستوى', base: 300, growth: 1.8, max: 3 },
  clock: { icon: '⏳', name: 'رمال أطول', desc: 'إبطاء الزمن يدوم أكثر', base: 150, growth: 1.6, max: 5 },
  luck: { icon: '🍀', name: 'حظ المعدّن', desc: 'قدرات خاصة تسقط أكثر', base: 200, growth: 1.7, max: 5 },
  skill: { icon: '🧨', name: 'شحنات التفجير', desc: 'قنبلة إضافية تدمر كل خطر على الشاشة', base: 250, growth: 1.8, max: 3 },
};
const advUpLevel = (key) => state.adventureUpgrades?.[key] || 0;
function advUpgradeCost(key) {
  const def = ADV_UPGRADE_DEFS[key];
  const lvl = advUpLevel(key);
  if (lvl >= def.max) return null;
  let c = def.base;
  for (let i = 0; i < lvl; i++) c = Math.floor(c * def.growth);
  return c;
}
function buyAdvUpgrade(key) {
  const cost = advUpgradeCost(key);
  if (cost === null || state.gold < cost) { haptic('error'); return; }
  state.gold -= cost;
  state.adventureUpgrades[key] = advUpLevel(key) + 1;
  enqueueOp({ type: 'buy_adv', key });
  if (key === 'cart') ADV.playerW = 78 + advUpLevel('cart') * 8;
  haptic('success');
  advBeep(880, 0.12, 'triangle', 0.06, 1320);
  updateUI();
  updateAdvUpgradesUI();
  save();
}
function updateAdvUpgradesUI() {
  const list = document.getElementById('adv-upgrades-list');
  if (!list) return;
  list.innerHTML = '';
  for (const [key, def] of Object.entries(ADV_UPGRADE_DEFS)) {
    const lvl = advUpLevel(key);
    const cost = advUpgradeCost(key);
    const row = document.createElement('div');
    row.className = 'flex justify-between items-center bg-slate-950/50 border border-slate-800 p-2 rounded-lg';
    const info = document.createElement('div');
    info.className = 'flex items-center gap-2 min-w-0';
    const icon = document.createElement('span'); icon.className = 'text-xl'; icon.textContent = def.icon;
    const texts = document.createElement('div');
    const name = document.createElement('div'); name.className = 'font-bold text-[11px]';
    name.textContent = `${def.name} ${lvl ? `· مستوى ${lvl}/${def.max}` : ''}`;
    const desc = document.createElement('div'); desc.className = 'text-[9px] text-slate-400'; desc.textContent = def.desc;
    texts.append(name, desc); info.append(icon, texts);
    const btn = document.createElement('button');
    btn.className = 'buy-btn bg-amber-500 text-slate-950 font-bold px-2.5 py-1.5 rounded-lg text-[10px] shrink-0';
    btn.disabled = cost === null || state.gold < cost;
    btn.textContent = cost === null ? '✓ أقصى' : `🪙 ${cost.toLocaleString('en-US')}`;
    btn.onclick = () => buyAdvUpgrade(key);
    row.append(info, btn);
    list.appendChild(row);
  }
}

const ADV_MISSIONS = [
  { text: '🎯 مهمة: التقط 15 جوهرة', reward: 25, progress: () => `${Math.min(15, adv.gemsCaught)}/15`, done: () => adv.gemsCaught >= 15 },
  { text: '🎯 مهمة: حقق سلسلة ×10', reward: 30, progress: () => `${Math.min(10, adv.maxCombo)}/10`, done: () => adv.maxCombo >= 10 },
  { text: '🎯 مهمة: اجمع 300 نقطة', reward: 50, progress: () => `${Math.min(300, Math.floor(adv.score))}/300`, done: () => adv.score >= 300 },
];
const advFxActive = (k) => adv.elapsed < adv.fx[k];
// مولّد عشوائي ببذرة (نفس التساقط للمتسابقين) + مصدر موحد للأرقام
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const advRandom = () => adv.rng ? adv.rng() : Math.random();
function advBanner(text, sec = 1.6) { adv.banner = text; adv.bannerUntil = adv.elapsed + sec; }

// 🔊 مؤثرات صوتية مولّدة (WebAudio — بلا ملفات) بنغمة تصعد مع السلسلة
function advBeep(freq, dur = 0.08, type = 'sine', vol = 0.05, slideTo = null) {
  if (adv.muted) return;
  try {
    adv.audio = adv.audio || new (window.AudioContext || window.webkitAudioContext)();
    const ac = adv.audio, t = ac.currentTime;
    const osc = ac.createOscillator(), gain = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain); gain.connect(ac.destination);
    osc.start(t); osc.stop(t + dur);
  } catch (e) {}
}
function toggleAdventureMute() {
  adv.muted = !adv.muted;
  document.getElementById('adv-mute-btn').innerText = adv.muted ? '🔇' : '🔊';
}

function checkAdventureMission() {
  const m = ADV_MISSIONS[adv.missionIndex];
  if (!m || !m.done()) return;
  adv.score += m.reward;
  advBanner(`✅ أنجزت المهمة! +${m.reward} نقطة`, 1.8);
  advBeep(880, 0.18, 'triangle', 0.07, 1320);
  haptic('success');
  adv.missionIndex += 1;
}

function advSize() {
  const rect = advCanvas.getBoundingClientRect();
  return { w: rect.width || 360, h: rect.height || 330 };
}
function resizeAdventureCanvas() {
  const rect = advCanvas.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  advCanvas.width = Math.max(200, rect.width) * dpr;
  advCanvas.height = Math.max(200, rect.height) * dpr;
  advCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawAdventure();
}

function updateAdventureUI() {
  const legacyBack = document.getElementById('legacy-back');
  if (legacyBack) legacyBack.hidden = Boolean(adv.mode === 'race' && typeof race !== 'undefined' && race.inRace);
  document.getElementById('adv-score').innerText = Math.floor(adv.score);
  document.getElementById('adv-time').innerText = adv.gameMode === 'survival' && adv.running ? '∞' : Math.max(0, Math.ceil(adv.timeLeft));
  document.getElementById('adv-lives').innerText = '❤️'.repeat(Math.max(0, adv.lives)) || '💀';
  document.getElementById('adv-best').innerText = Math.floor(adv.best);
  const mult = Math.min(3, 1 + Math.floor(adv.combo / 10));
  const effects = [
    advFxActive('magnetUntil') ? `🧲 ${Math.ceil(adv.fx.magnetUntil - adv.elapsed)}ث` : '',
    adv.fx.shield ? `🛡️×${Math.max(1, adv.shieldCharges)}` : '',
    advFxActive('slowUntil') ? `⏳ ${Math.ceil(adv.fx.slowUntil - adv.elapsed)}ث` : '',
    advFxActive('starUntil') ? `⭐ ${Math.ceil(adv.fx.starUntil - adv.elapsed)}ث` : '',
    advFxActive('feverUntil') ? `🌟 حمّى ${Math.ceil(adv.fx.feverUntil - adv.elapsed)}ث` : '',
  ].filter(Boolean).join(' · ');
  document.getElementById('adv-combo').innerText = !adv.running ? 'حرّك العربة والتقط الجواهر!'
    : effects || (adv.combo >= 2 ? `🔥 سلسلة ×${adv.combo} — مضاعِف النقاط ×${mult}` : 'التقط الجواهر لبناء سلسلة!');
  const m = ADV_MISSIONS[adv.missionIndex];
  document.getElementById('adv-mission').innerText = m ? `${m.text} (${m.progress()}) — مكافأة +${m.reward}` : '🏆 أنجزت كل مهام هذه الجولة!';
  document.getElementById('adv-pause-btn').disabled = !adv.running;
  document.getElementById('adv-pause-btn').innerText = adv.paused ? '▶ أكمال' : '⏸ إيقاف';
  const skillBtn = document.getElementById('adv-skill-btn');
  skillBtn.disabled = !adv.running || adv.paused || adv.skillCharges <= 0;
  skillBtn.innerText = `🧨 ×${adv.skillCharges}`;
  const bossBtn = document.getElementById('adv-boss-btn');
  const inBoss = adv.gameMode === 'boss';
  bossBtn.classList.toggle('hidden', !inBoss);
  bossBtn.disabled = !adv.running || adv.paused || !inBoss || adv.bossCharge < 20;
  bossBtn.innerText = `🎯 هجوم ${Math.floor(adv.bossCharge)}/20`;
}

const ADV_POWERUPS = [
  { kind: 'magnet', icon: '🧲' }, { kind: 'shield', icon: '🛡️' },
  { kind: 'slow', icon: '⏳' }, { kind: 'star', icon: '⭐' }, { kind: 'heart', icon: '❤️' },
];
function spawnAdventureObject() {
  const { w } = advSize();
  const roll = advRandom();
  let data;
  const eventActive = adv.elapsed < adv.eventUntil;
  if (eventActive && adv.eventType === 'rain' && roll < 0.68) data = advRandom() < 0.6 ? { type: 'gem', icon: '💎', points: 10, hazard: false } : { type: 'coin', icon: '🪙', points: 5, hazard: false };
  else if (eventActive && adv.eventType === 'storm' && roll < 0.58) data = advRandom() < 0.7 ? { type: 'rock', icon: '🪨', points: 0, hazard: true } : { type: 'bomb', icon: '💣', points: -15, hazard: true };
  else if (roll < 0.02) data = { type: 'chest', icon: '🧰', points: 40, hazard: false };
  else if (roll < 0.05) data = { type: 'golden', icon: '🌟💎', points: 50, hazard: false };
  else if (roll < 0.12) data = { type: 'crystal', icon: '💠', points: 15, hazard: false, pattern: 'zigzag' };
  else if (roll < 0.38) data = { type: 'gem', icon: '💎', points: 10, hazard: false };
  else if (roll < 0.68) data = { type: 'coin', icon: '🪙', points: 5, hazard: false };
  else if (roll < 0.78 + advUpLevel('luck') * 0.008) { const p = ADV_POWERUPS[Math.floor(advRandom() * ADV_POWERUPS.length)]; data = { type: 'power', kind: p.kind, icon: p.icon, points: 0, hazard: false }; }
  else if (roll < 0.92) data = { type: 'rock', icon: '🪨', points: 0, hazard: true };
  else data = { type: 'bomb', icon: '💣', points: -15, hazard: true };
  // كهف الكريستال يكافئ التقاط الكنوز؛ منجم الحمم يزيد المخاطر في الفردي فقط.
  if (adv.phase === 1 && !data.hazard && ['gem', 'crystal', 'golden', 'chest'].includes(data.type)) {
    data = { ...data, points: Math.ceil(data.points * 1.25) };
  }
  if (adv.phase === 2 && adv.mode !== 'race' && !eventActive && ['gem', 'crystal', 'golden', 'chest', 'coin'].includes(data.type)) {
    adv.zoneSpawnCount += 1;
    if (adv.zoneSpawnCount % 5 === 0) data = { type: 'rock', icon: '🌋', points: 0, hazard: true };
  }
  const feverBoost = advFxActive('feverUntil') && !data.hazard && advRandom() < 0.5;
  if (feverBoost) data = { type: 'gem', icon: '💎', points: 10, hazard: false };
  const startX = 24 + advRandom() * Math.max(20, w - 48);
  adv.objects.push({
    ...data, x: startX, baseX: startX, age: 0, y: -25,
    r: data.type === 'golden' || data.type === 'chest' ? 23 : data.type === 'gem' ? 19 : 17,
    vy: (125 + adv.elapsed * 2.6 + advRandom() * 75) * advModeCfg().fallScale * advDiffCfg().fallScale * (data.type === 'chest' ? 0.62 : 1),
    vx: (advRandom() - 0.5) * 28, spin: advRandom() * Math.PI, nearMissed: false,
  });
}

// 🧨 مهارة التفجير: تدمر كل الأخطار الظاهرة وتمنح نقاط أمان
function useAdventureSkill() {
  if (!adv.running || adv.paused || adv.skillCharges <= 0) { haptic('error'); return; }
  adv.skillCharges -= 1;
  const hazards = adv.objects.filter((o) => o.hazard);
  adv.objects = adv.objects.filter((o) => !o.hazard);
  adv.score += hazards.length * 2;
  adv.shake = 0.3; adv.flash = 0.18;
  advBanner(`🧨 دُمّر ${hazards.length} خطر!`, 1.2);
  advBeep(120, 0.3, 'sawtooth', 0.09, 45);
  if (navigator.vibrate) navigator.vibrate([40, 30, 60]);
  haptic('success');
  updateAdventureUI();
  drawAdventure();
}

// 🎯 هجوم مضاد على الزعيم — يُشحن من نقاط الالتقاط
function bossAttack() {
  if (!adv.running || adv.paused || adv.gameMode !== 'boss' || !adv.boss || adv.bossCharge < 20) { haptic('error'); return; }
  adv.bossCharge -= 20;
  const dmg = 12 + Math.floor(advRandom() * 7);
  adv.boss.hp -= dmg;
  adv.boss.hitFlash = 0.3;
  adv.particles.push({ x: adv.boss.x, y: adv.boss.y + 28, text: `🎯 -${dmg}`, color: '#e879f9', life: 0.9 });
  advBeep(180, 0.18, 'square', 0.07, 70);
  adv.shake = Math.max(adv.shake, 0.18);
  haptic('success');
  if (adv.boss.hp <= 0) {
    adv.bossDefeated = true;
    adv.score += 150;
    advBanner('👹 سقط الزعيم! +150 نقطة', 2);
    advBeep(880, 0.3, 'triangle', 0.08, 1760);
    endAdventure();
    return;
  }
  updateAdventureUI();
  drawAdventure();
}

function spawnBossRock() {
  if (!adv.boss) return;
  const { w } = advSize();
  adv.objects.push({
    type: 'rock', icon: '☄️', points: 0, hazard: true, x: adv.boss.x, baseX: adv.boss.x, age: 0, y: 82,
    r: 19, vy: 235 + adv.elapsed * 2, vx: Math.max(-170, Math.min(170, (adv.playerX - adv.boss.x) / 1.15)),
    spin: 0, nearMissed: false,
  });
  adv.particles.push({ x: adv.boss.x, y: adv.boss.y + 24, text: '🎯 يستهدفك!', color: '#f87171', life: 0.8 });
  advBeep(240, 0.12, 'sawtooth', 0.04, 120);
  void w;
}

function startAdventure(mode = 'solo', seed = null, duration = null) {
  // A server-started race must reveal the cart, and suspend the platform RAF.
  window.PlatformGame?.showLegacy?.();
  if (mode === 'race') switchPlayPanel('adventure');
  for (const key of Object.keys(advKeys)) delete advKeys[key];
  resizeAdventureCanvas();
  adv.mode = mode;
  adv.rng = mode === 'race' && seed !== null ? mulberry32(seed) : null;
  // مدة السباق يقررها الخادم (يختم النتيجة بنفسه عند انتهائها)؛ الفردي يستخدم مدة الوضع
  const raceDuration = mode === 'race' && Number.isFinite(Number(duration)) && Number(duration) > 0 ? Number(duration) : null;
  // السباق دائماً كلاسيك/عادي للعدالة — الفردي يستخدم خيارات اللاعب
  adv.gameMode = mode === 'race' ? 'classic' : advSettings.mode;
  adv.gameDifficulty = mode === 'race' ? 'normal' : advSettings.difficulty;
  const { w } = advSize();
  ADV.playerW = 78 + advUpLevel('cart') * 8; // 🛒 عربة أوسع حسب الترقية
  adv.shieldCharges = advUpLevel('shield') >= 3 ? 2 : advUpLevel('shield') >= 1 ? 1 : 0;
  Object.assign(adv, { running: true, paused: false, score: 0, combo: 0, maxCombo: 0,
    lives: Math.max(1, 3 + advUpLevel('heart') + advDiffCfg().lives),
    timeLeft: raceDuration || advModeCfg().duration, objects: [], particles: [], playerX: w / 2, targetX: w / 2, prevX: w / 2,
    elapsed: 0, spawnIn: 0, zoneSpawnCount: 0, lastTs: performance.now(), caught: 0, missed: 0, gemsCaught: 0,
    missionIndex: 0, shake: 0, flash: 0, banner: '', bannerUntil: 0, phase: 0, lockNoticePhase: -1,
    skillCharges: 1 + advUpLevel('skill'), nextEventAt: 18, eventUntil: -1, eventType: null,
    boss: adv.gameMode === 'boss'
      ? { hp: adv.gameDifficulty === 'easy' ? 90 : adv.gameDifficulty === 'hard' ? 170 : 120,
          maxHp: adv.gameDifficulty === 'easy' ? 90 : adv.gameDifficulty === 'hard' ? 170 : 120,
          x: w / 2, y: 58, attackAt: 4, hitFlash: 0 }
      : null,
    bossCharge: 0, bossDefeated: false,
    fx: { magnetUntil: -1, slowUntil: -1, starUntil: -1, feverUntil: -1, shield: adv.shieldCharges > 0 } });
  if (adv.gameMode === 'boss') advBanner('👹 اهزم الزعيم قبل انتهاء الوقت! اجمع نقاطاً لشحن هجومك', 2.4);
  advBanner('⛏️ اجمع الجواهر وتفادَ الخطر!', 1.6);
  try { adv.audio = adv.audio || new (window.AudioContext || window.webkitAudioContext)(); adv.audio.resume?.(); } catch (e) {}
  advBeep(660, 0.12, 'triangle', 0.06, 990);
  document.getElementById('game-overlay').style.display = 'none';
  cancelAnimationFrame(adv.raf);
  adv.raf = requestAnimationFrame(adventureLoop);
  haptic('success');
  updateAdventureUI();
}

function toggleAdventurePause() {
  if (!adv.running) return;
  setAdventurePaused(!adv.paused);
}
function setAdventurePaused(paused) {
  if (!adv.running) return;
  adv.paused = paused;
  for (const key of Object.keys(advKeys)) delete advKeys[key];
  if (paused) cancelAnimationFrame(adv.raf);
  const overlay = document.getElementById('game-overlay');
  document.getElementById('game-overlay-title').innerText = paused ? '⏸ توقف مؤقت' : 'مغامرة المنجم';
  document.getElementById('game-overlay-text').innerHTML = paused ? 'خذ نفساً… المغامرة بانتظارك.' : '';
  document.getElementById('game-overlay-btn').innerText = paused ? '▶ أكمال اللعب' : '▶ العب الآن';
  document.getElementById('game-overlay-btn').setAttribute('onclick', paused ? 'toggleAdventurePause()' : 'startAdventure()');
  overlay.style.display = paused ? 'flex' : 'none';
  if (!paused) { adv.lastTs = performance.now(); cancelAnimationFrame(adv.raf); adv.raf = requestAnimationFrame(adventureLoop); }
  updateAdventureUI();
}

function adventureLoop(ts) {
  if (!adv.running || adv.paused) return;
  const dt = Math.min(0.033, (ts - adv.lastTs) / 1000 || 0.016);
  adv.lastTs = ts;
  stepAdventure(dt);
  drawAdventure();
  // بث تقدم السباق للخصم (10 مرات/ثانية كحد أقصى)
  if (adv.mode === 'race' && race.inRace && ts - adv.raceLastSend > 100) {
    adv.raceLastSend = ts;
    raceSend({ type: 'progress', score: Math.floor(adv.score), lives: adv.lives, xRatio: adv.playerX / Math.max(1, advSize().w) });
  }
  if (adv.running) adv.raf = requestAnimationFrame(adventureLoop);
}

function stepAdventure(dt) {
  const { w, h } = advSize();
  const playerY = h - 48;
  adv.elapsed += dt;
  if (Number.isFinite(adv.timeLeft)) adv.timeLeft -= dt;

  // 🎲 أحداث عشوائية داخل الجولة
  if (adv.elapsed >= adv.nextEventAt) {
    adv.eventType = advRandom() < 0.5 ? 'rain' : 'storm';
    adv.eventUntil = adv.elapsed + 5;
    adv.nextEventAt = adv.elapsed + 20;
    advBanner(adv.eventType === 'rain' ? '🌧️ وابل جواهر! اجمع كل ما تقدر' : '☄️ عاصفة صخور! ركّز على التفادي', 2);
    advBeep(adv.eventType === 'rain' ? 980 : 180, 0.22, 'triangle', 0.06, adv.eventType === 'rain' ? 1480 : 90);
  }

  // حركة لوحة المفاتيح
  const speed = 420 + advUpLevel('speed') * 45;
  if (advKeys.ArrowLeft || advKeys.ArrowRight) {
    adv.targetX += ((advKeys.ArrowRight ? 1 : 0) - (advKeys.ArrowLeft ? 1 : 0)) * speed * dt;
  }
  adv.targetX = Math.max(ADV.playerW / 2, Math.min(w - ADV.playerW / 2, adv.targetX));
  adv.prevX = adv.playerX;
  adv.playerX += (adv.targetX - adv.playerX) * Math.min(1, dt * (18 + advUpLevel('speed') * 1.2));
  adv.shake = Math.max(0, adv.shake - dt);
  adv.flash = Math.max(0, adv.flash - dt);

  // مراحل صعوبة معلنة
  const targetPhase = adv.elapsed >= 40 ? 2 : adv.elapsed >= 20 ? 1 : 0;
  const unlockedZones = getUnlockedAdventureZones();
  const newPhase = Math.min(targetPhase, unlockedZones - 1);
  if (targetPhase > newPhase && adv.lockNoticePhase !== targetPhase) {
    adv.lockNoticePhase = targetPhase;
    advBanner(`🔒 ${ADV_MINE_ZONES[targetPhase].name}: ${getAdventureZoneUnlockHint(targetPhase)}`, 3.2);
    advBeep(180, 0.18, 'square', 0.035, 120);
  }
  if (newPhase !== adv.phase) {
    adv.phase = newPhase;
    const zone = ADV_MINE_ZONES[newPhase];
    advBanner(`${zone.icon} وصلت إلى ${zone.name} — ${zone.hint}`, 2.2);
    advBeep(newPhase === 2 ? 160 : 440, 0.2, 'sawtooth', 0.05, newPhase === 2 ? 75 : 880);
  }

  // 👹 حركة الزعيم وهجومه المستهدف الدوري
  if (adv.boss && adv.gameMode === 'boss') {
    adv.boss.x = w / 2 + Math.sin(adv.elapsed * 0.8) * Math.max(30, w / 2 - 62);
    adv.boss.y = 58 + Math.sin(adv.elapsed * 1.7) * 8;
    adv.boss.hitFlash = Math.max(0, adv.boss.hitFlash - dt);
    if (adv.elapsed >= adv.boss.attackAt) {
      spawnBossRock();
      adv.boss.attackAt = adv.elapsed + Math.max(2.5, 4.2 - adv.elapsed * 0.018);
    }
  }

  // توليد عناصر أسرع تدريجياً (وأسرع في المرحلة الأخيرة)
  adv.spawnIn -= dt;
  const spawnEvery = Math.max(0.2, (0.68 - adv.elapsed * 0.006 - adv.phase * 0.05) * advModeCfg().spawnScale * (adv.elapsed < adv.eventUntil ? 0.62 : 1));
  if (adv.spawnIn <= 0) { spawnAdventureObject(); adv.spawnIn = spawnEvery * (0.75 + advRandom() * 0.5); }

  const fallDt = dt * (advFxActive('slowUntil') ? 0.5 : 1); // ⏳ إبطاء زمني
  for (const obj of [...adv.objects]) {
    // 🧲 مغناطيس يجذب الكنوز نحو العربة
    if (advFxActive('magnetUntil') && !obj.hazard) {
      const dx = adv.playerX - obj.x;
      const magnetRadius = 150 + advUpLevel('magnet') * 25;
      if (Math.abs(dx) < magnetRadius && obj.y > h - 190 - advUpLevel('magnet') * 12) obj.x += Math.max(-260 * fallDt, Math.min(260 * fallDt, dx * 6 * fallDt));
    }
    obj.age = (obj.age || 0) + fallDt;
    obj.y += obj.vy * fallDt;
    obj.x += obj.vx * fallDt;
    if (obj.pattern === 'zigzag') obj.x = Math.max(obj.r, Math.min(w - obj.r, obj.baseX + Math.sin(obj.age * 4.2) * 38));
    obj.spin += dt * 2;
    if (obj.x < obj.r || obj.x > w - obj.r) obj.vx *= -1;

    const hitPlayer = obj.y + obj.r >= playerY && obj.y - obj.r <= playerY + ADV.playerH
      && Math.abs(obj.x - adv.playerX) <= ADV.playerW / 2 + obj.r * 0.55;
    if (hitPlayer) {
      collectAdventureObject(obj);
      adv.objects.splice(adv.objects.indexOf(obj), 1);
      continue;
    }
    // مرور خطر قريب بلا إصابة = مكافأة جرأة
    if (obj.hazard && !obj.nearMissed && obj.y - obj.r > playerY + ADV.playerH) {
      obj.nearMissed = true;
      if (Math.abs(obj.x - adv.playerX) <= ADV.playerW / 2 + obj.r + 22) {
        adv.score += 2;
        adv.particles.push({ x: adv.playerX, y: playerY - 14, text: '😱 قريب! +2', color: '#7dd3fc', life: 0.7 });
      }
    }
    if (obj.y - obj.r > h) {
      if (!obj.hazard) { adv.missed += 1; if (adv.combo > 0) adv.combo = 0; } // إسقاط كنز يكسر السلسلة
      adv.objects.splice(adv.objects.indexOf(obj), 1);
    }
  }

  for (const p of [...adv.particles]) {
    p.y -= 45 * dt; p.life -= dt;
    if (p.life <= 0) adv.particles.splice(adv.particles.indexOf(p), 1);
  }
  updateAdventureUI();
  if (adv.timeLeft <= 0 || adv.lives <= 0) endAdventure();
}

function applyAdventurePower(kind, x, yTop) {
  const notes = {
    magnet: '🧲 مغناطيس 8 ثوانٍ!', shield: '🛡️ درع يحميك مرة!', slow: '⏳ أبطأنا الزمن!',
    star: '⭐ نقاط مضاعفة 8 ثوانٍ!', heart: '❤️ قلب إضافي!',
  };
  if (kind === 'magnet') adv.fx.magnetUntil = adv.elapsed + 8 + advUpLevel('magnet') * 1.5;
  if (kind === 'shield') { adv.shieldCharges = Math.min(2, adv.shieldCharges + 1); adv.fx.shield = true; }
  if (kind === 'slow') adv.fx.slowUntil = adv.elapsed + 5 + advUpLevel('clock');
  if (kind === 'star') adv.fx.starUntil = adv.elapsed + 8;
  if (kind === 'heart') adv.lives = Math.min(5, adv.lives + 1);
  adv.particles.push({ x, y: yTop, text: notes[kind], color: '#e879f9', life: 1 });
  advBeep(740, 0.1, 'triangle', 0.06, 1180);
  setTimeout(() => advBeep(990, 0.12, 'triangle', 0.05, 1320), 70);
}

function collectAdventureObject(obj) {
  const { h } = advSize();
  const yTop = h - 58;
  if (obj.type === 'power') { applyAdventurePower(obj.kind, obj.x, yTop); haptic('success'); return; }
  if (obj.hazard) {
    if (adv.fx.shield) {
      adv.shieldCharges = Math.max(0, adv.shieldCharges - 1);
      adv.fx.shield = adv.shieldCharges > 0;
      adv.particles.push({ x: obj.x, y: yTop, text: '🛡️ أنقذك الدرع!', color: '#7dd3fc', life: 1 });
      advBeep(300, 0.12, 'square', 0.05, 500);
      haptic('success');
      return;
    }
    adv.lives -= 1;
    adv.combo = 0;
    adv.shake = 0.35; adv.flash = 0.3;
    if (obj.type === 'bomb') adv.score = Math.max(0, adv.score - 15);
    adv.particles.push({ x: obj.x, y: yTop, text: obj.type === 'bomb' ? '💥 -1 قلب' : '🪨 -1 قلب', color: '#f87171', life: 0.9 });
    advBeep(140, 0.22, 'sawtooth', 0.08, 60);
    haptic('error');
    if (navigator.vibrate) navigator.vibrate(90);
  } else {
    adv.caught += 1;
    if (obj.type === 'gem' || obj.type === 'golden') adv.gemsCaught += 1;
    adv.combo += 1;
    adv.maxCombo = Math.max(adv.maxCombo, adv.combo);
    const comboMult = Math.min(3, 1 + Math.floor((adv.combo - 1) / 10));
    const totalMult = Math.min(6, comboMult * (advFxActive('starUntil') ? 2 : 1) * (advFxActive('feverUntil') ? 2 : 1));
    const gained = Math.round(obj.points * totalMult * advDiffCfg().scoreScale);
    adv.score += gained;
    if (adv.gameMode === 'boss' && adv.boss) adv.bossCharge = Math.min(60, adv.bossCharge + gained);
    adv.particles.push({ x: obj.x, y: yTop, text: `+${gained}`, color: obj.type === 'golden' ? '#fde68a' : '#fbbf24', life: 0.8 });
    advBeep(Math.min(950, 520 + adv.combo * 16), 0.06, 'sine', 0.045);
    haptic('light');
    // 🌟 حمّى الذهب عند سلسلة 15
    if (adv.combo === 15 && !advFxActive('feverUntil')) {
      adv.fx.feverUntil = adv.elapsed + 8;
      advBanner('🌟 حمّى الذهب! نقاط مضاعفة وجواهر أكثر', 2);
      advBeep(880, 0.25, 'triangle', 0.07, 1760);
    }
    checkAdventureMission();
  }
}

function drawAdventure() {
  if (!advCtx) return;
  const { w, h } = advSize();
  const playerY = h - 48;
  advCtx.clearRect(0, 0, w, h);
  if (adv.shake > 0) { advCtx.save(); advCtx.translate((Math.random() - 0.5) * 10 * adv.shake * 3, (Math.random() - 0.5) * 7 * adv.shake * 3); }
  const zone = ADV_MINE_ZONES[Math.min(adv.phase, ADV_MINE_ZONES.length - 1)];
  const sky = advCtx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, zone.top);
  sky.addColorStop(1, '#020617');
  advCtx.fillStyle = sky;
  advCtx.fillRect(0, 0, w, h);
  if (advFxActive('feverUntil')) { advCtx.fillStyle = 'rgba(245,158,11,0.10)'; advCtx.fillRect(0, 0, w, h); }
  // صواعد كهف متحركة (Parallax يعطي إحساس العمق)
  advCtx.fillStyle = zone.glow + '22';
  const caveOff = (adv.elapsed * 18) % 46;
  for (let x = -46; x < w + 46; x += 46) {
    advCtx.beginPath();
    advCtx.moveTo(x + caveOff - 46, 0); advCtx.lineTo(x + 23 + caveOff - 46, 28 + (x % 3) * 5); advCtx.lineTo(x + 46 + caveOff - 46, 0);
    advCtx.closePath(); advCtx.fill();
  }
  // نجوم/غبار المنجم
  advCtx.fillStyle = 'rgba(251,191,36,0.16)';
  for (let i = 0; i < 22; i++) {
    const x = (i * 67 + 25) % w, y = (i * 41 + 18) % Math.max(40, h - 70);
    advCtx.fillRect(x, y, 2, 2);
  }
  // أرضية المنجم
  advCtx.fillStyle = zone.floor;
  advCtx.fillRect(0, h - 22, w, 22);
  advCtx.fillStyle = zone.glow;
  advCtx.fillRect(0, h - 22, w, 2);

  // الأجسام المتساقطة
  const emojiFont = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", serif';
  advCtx.textAlign = 'center'; advCtx.textBaseline = 'middle';
  for (const obj of adv.objects) {
    advCtx.save();
    advCtx.translate(obj.x, obj.y);
    advCtx.rotate(Math.sin(obj.spin) * 0.18);
    advCtx.font = `${obj.r * 2}px ${emojiFont}`;
    advCtx.fillText(obj.icon, 0, 0);
    advCtx.restore();
  }

  // 👹 الزعيم وشريط صحته
  if (adv.boss && adv.gameMode === 'boss') {
    advCtx.save();
    advCtx.font = `46px ${emojiFont}`;
    advCtx.textAlign = 'center'; advCtx.textBaseline = 'middle';
    if (adv.boss.hitFlash > 0) { advCtx.shadowColor = '#ef4444'; advCtx.shadowBlur = 22; }
    advCtx.fillText('👹', adv.boss.x, adv.boss.y);
    advCtx.shadowBlur = 0;
    const bw = Math.min(210, w - 70), bx = (w - bw) / 2;
    advCtx.fillStyle = 'rgba(15,23,42,0.85)'; advCtx.fillRect(bx, 12, bw, 11);
    advCtx.fillStyle = '#ef4444'; advCtx.fillRect(bx, 12, bw * Math.max(0, adv.boss.hp / adv.boss.maxHp), 11);
    advCtx.font = 'bold 9px Tajawal, sans-serif'; advCtx.fillStyle = '#fecaca';
    advCtx.fillText(`الزعيم ${Math.max(0, Math.ceil(adv.boss.hp))}/${adv.boss.maxHp}`, w / 2, 31);
    advCtx.restore();
  }

  // 👥 شبح الخصم في السباق المباشر
  if (adv.mode === 'race' && race.inRace && race.opponent) {
    const gx = race.opponent.xRatio * w;
    advCtx.save();
    advCtx.globalAlpha = 0.45;
    advCtx.fillStyle = '#6366f1';
    advCtx.beginPath();
    advCtx.roundRect(gx - ADV.playerW / 2, playerY, ADV.playerW, ADV.playerH, 10);
    advCtx.fill();
    advCtx.font = `24px ${emojiFont}`;
    advCtx.fillText('🧑‍🚀', gx, playerY + 15);
    advCtx.globalAlpha = 0.9;
    advCtx.font = 'bold 10px Tajawal, sans-serif';
    advCtx.fillStyle = '#c7d2fe';
    advCtx.fillText(`${race.opponent.name} · ${Math.floor(race.opponent.score)}`, gx, playerY - 10);
    advCtx.restore();
  }

  // عربة المعدّن (تميل مع اتجاه الحركة + أيقونة درع عند تفعيله)
  const px = adv.playerX - ADV.playerW / 2;
  const tilt = Math.max(-0.16, Math.min(0.16, (adv.playerX - adv.prevX) * 0.03));
  advCtx.save();
  advCtx.translate(adv.playerX, playerY + ADV.playerH / 2);
  advCtx.rotate(tilt);
  const skin = advSkin();
  const grad = advCtx.createLinearGradient(-ADV.playerW / 2, 0, ADV.playerW / 2, ADV.playerH);
  grad.addColorStop(0, skin.colors[0]); grad.addColorStop(1, skin.colors[1]);
  advCtx.fillStyle = grad;
  advCtx.beginPath();
  advCtx.roundRect(-ADV.playerW / 2, -ADV.playerH / 2, ADV.playerW, ADV.playerH, 10);
  advCtx.fill();
  advCtx.font = `29px ${emojiFont}`;
  advCtx.fillText(skin.icon, 0, 2);
  if (adv.fx.shield) { advCtx.font = `17px ${emojiFont}`; advCtx.fillText('🛡️', ADV.playerW / 2 - 8, -ADV.playerH / 2 + 4); }
  if (advFxActive('magnetUntil')) { advCtx.font = `15px ${emojiFont}`; advCtx.fillText('🧲', -ADV.playerW / 2 + 8, -ADV.playerH / 2 + 4); }
  advCtx.fillStyle = '#111827';
  advCtx.beginPath(); advCtx.arc(-ADV.playerW / 2 + 15, ADV.playerH / 2 + 5, 6, 0, Math.PI * 2); advCtx.fill();
  advCtx.beginPath(); advCtx.arc(ADV.playerW / 2 - 15, ADV.playerH / 2 + 5, 6, 0, Math.PI * 2); advCtx.fill();
  advCtx.restore();

  // نقاط عائمة
  advCtx.font = 'black 15px Tajawal, sans-serif';
  for (const p of adv.particles) {
    advCtx.globalAlpha = Math.max(0, Math.min(1, p.life));
    advCtx.fillStyle = p.color;
    advCtx.fillText(p.text, p.x, p.y);
  }
  advCtx.globalAlpha = 1;
  if (adv.shake > 0) advCtx.restore();
  // وميض أحمر عند الإصابة + إعلان منتصف الشاشة
  if (adv.flash > 0) { advCtx.fillStyle = `rgba(239,68,68,${adv.flash * 0.7})`; advCtx.fillRect(0, 0, w, h); }
  if (adv.banner && adv.elapsed < adv.bannerUntil) {
    advCtx.save();
    advCtx.globalAlpha = Math.max(0, Math.min(1, adv.bannerUntil - adv.elapsed));
    advCtx.font = 'black 19px Tajawal, sans-serif';
    advCtx.textAlign = 'center';
    advCtx.fillStyle = '#fde68a';
    advCtx.shadowColor = 'rgba(0,0,0,0.8)'; advCtx.shadowBlur = 8;
    advCtx.fillText(adv.banner, w / 2, 74);
    advCtx.restore();
  }
}

function endAdventure() {
  if (!adv.running) return;
  adv.running = false;
  adv.paused = false;
  cancelAnimationFrame(adv.raf);
  const finalScore = Math.floor(adv.score);
  const inRace = adv.mode === 'race' && race.inRace;
  if (inRace) window.PlatformGame?.showPlatform?.(); // restore the side-scroller after a race
  const rewardCap = adv.gameMode === 'survival' ? 150 : 100;
  const victoryBonus = adv.bossDefeated ? 150 : 0;
  const claimed = inRace ? 0 : Math.min(rewardCap, Math.floor(finalScore / 5 * advModeCfg().rewardScale)) + victoryBonus; // السباق للمجد لا للذهب (حتى لا يُزرع)
  // السقف اليومي المشترك: الخادم يقصّ الدفع، فنعرض ما سيدفعه فعلاً بدل رقم ثم تصحيحه عند المزامنة
  const room = classicRoom(), reward = Math.min(claimed, room), cut = claimed > reward;
  if (reward > 0 && classicPurse()) { const d = classicPurse(); profile.dailyGold = { day: d.day, cap: d.cap, used: d.used + reward, remaining: Math.max(0, d.remaining - reward) }; }
  const unlockedZonesBeforeRun = getUnlockedAdventureZones();
  if (adv.bossDefeated) advStats.bossWins += 1;
  if (inRace) raceSendFinish(finalScore);
  advStats.runs += 1;
  advStats.totalGems += adv.gemsCaught;
  advStats.maxCombo = Math.max(advStats.maxCombo, adv.maxCombo);
  if (adv.gameMode === 'survival') advStats.bestSurvival = Math.max(advStats.bestSurvival, finalScore);
  advStats.rewardEarned += reward;
  saveAdvStats();
  const unlockedZonesAfterRun = getUnlockedAdventureZones();
  const zoneProgressText = unlockedZonesAfterRun > unlockedZonesBeforeRun
    ? `🎉 فتحت ${ADV_MINE_ZONES[unlockedZonesAfterRun - 1].name}! ستلعب فيها من الجولة القادمة.`
    : unlockedZonesAfterRun < ADV_MINE_ZONES.length
      ? `🗺️ المناطق المفتوحة: ${unlockedZonesAfterRun}/${ADV_MINE_ZONES.length}. التالي: ${getAdventureZoneUnlockHint(unlockedZonesAfterRun)}.`
      : `🗺️ جميع مناطق المغامرة مفتوحة!`;
  if (finalScore > adv.best) {
    adv.best = finalScore;
    try { localStorage.setItem('mining_adventure_best', String(adv.best)); } catch (e) {}
  }
  if (reward > 0) {
    state.gold += reward;
    state.totalEarned += reward;
  }
  // كل جولة تُبلَّغ للخادم (حتى السباقات وجولات بلا جائزة): هو من يحتسب الإحصاءات والمناطق والجائزة
  enqueueOp({
    type: 'run', mode: adv.gameMode, difficulty: adv.gameDifficulty, score: finalScore, gems: adv.gemsCaught,
    combo: adv.maxCombo, duration: Math.floor(adv.elapsed), boss: adv.bossDefeated, race: inRace, expected: reward,
  });
  const overlay = document.getElementById('game-overlay');
  document.getElementById('game-overlay-title').innerText = adv.bossDefeated ? '🏆 قتلت الزعيم!' : adv.lives <= 0 ? '💀 انتهت المغامرة!' : adv.gameMode === 'boss' ? '👹 هرب الزعيم هذه المرة!' : '⏰ انتهى الوقت!';
  const accuracy = adv.caught + adv.missed ? Math.round(adv.caught / (adv.caught + adv.missed) * 100) : 0;
  const rank = finalScore >= 900 ? '🏆 معدّن أسطوري' : finalScore >= 600 ? '👑 خبير مناجم' : finalScore >= 350 ? '💪 معدّن محترف' : finalScore >= 150 ? '⛏️ معدّن صاعد' : '🌱 مبتدئ';
  renderAchievements();
  updateAdvSettingsUI();
  document.getElementById('game-overlay-text').innerHTML =
    `نتيجتك: <b class="text-amber-400">${finalScore}</b> نقطة ${reward ? `— حصلت على <b class="text-amber-400">+${reward} 🪙</b>` : ''}<br>` +
    (cut ? `<span class="text-sky-300">سقف الذهب اليوم مشترك مع المناجم وبيع الخامات: ${reward ? `دُفع لك الباقي فقط (${reward} من ${claimed})` : `لا ذهب إضافي اليوم (كان ${claimed})`} — يتجدّد ${classicResetTime()}</span><br>` : '') +
    `🎯 التقطت ${adv.caught} · دقة ${accuracy}٪ · أعلى سلسلة ×${adv.maxCombo}<br>` +
    `الوضع: ${advModeCfg().label} · الصعوبة: ${advDiffCfg().label}<br>` +
    `لقبك: <b class="text-fuchsia-300">${rank}</b> · أفضل نتيجة: ${Math.floor(adv.best)}<br>` +
    `<span class="text-cyan-300">${zoneProgressText}</span>`;
  if (inRace) {
    document.getElementById('game-overlay-title').innerText = '🏁 انتهى سباقك!';
    document.getElementById('game-overlay-text').innerHTML =
      `نتيجتك: <b class="text-amber-400">${finalScore}</b> نقطة<br>بانتظار انتهاء الخصم لإعلان الفائز…`;
  }
  const btn = document.getElementById('game-overlay-btn');
  btn.innerText = inRace ? '⏳ بانتظار الخصم…' : '🔁 العب مرة أخرى';
  btn.setAttribute('onclick', 'startAdventure()');
  overlay.style.display = 'flex';
  haptic(claimed > 0 ? 'success' : 'error');
  updateUI();
  save();
  updateAdventureUI();
  drawAdventure();
}

// تحكم باللمس/الفأرة على الكانفس
function moveAdventureTo(clientX) {
  const rect = advCanvas.getBoundingClientRect();
  adv.targetX = Math.max(ADV.playerW / 2, Math.min(rect.width - ADV.playerW / 2, clientX - rect.left));
}
advCanvas.addEventListener('pointerdown', (e) => { advCanvas.setPointerCapture?.(e.pointerId); moveAdventureTo(e.clientX); });
advCanvas.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') moveAdventureTo(e.clientX); });
window.addEventListener('keydown', (e) => {
  if (!document.getElementById('tab-play').classList.contains('active')
      || !document.getElementById('play-panel-adventure').classList.contains('active')
      || document.getElementById('legacy-adventure').hidden
      || /INPUT|TEXTAREA|SELECT/.test(e.target?.tagName || '') || e.target?.isContentEditable) return;
  if (!['ArrowLeft', 'ArrowRight', ' '].includes(e.key)) return;
  e.preventDefault();
  if (e.key === ' ' && e.repeat) return;
  advKeys[e.key] = true;
  if (e.key === ' ' && adv.running) useAdventureSkill();
  else if (e.key === ' ' && !adv.running) startAdventure();
});
window.addEventListener('keyup', (e) => { advKeys[e.key] = false; });
window.addEventListener('resize', resizeAdventureCanvas);
document.addEventListener('visibilitychange', () => { if (document.hidden && adv.running && !adv.paused) setAdventurePaused(true); });
