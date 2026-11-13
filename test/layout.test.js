// حارس انحدار لتخطيط الواجهة: عمود بعرض هاتف على الشاشات الكبيرة،
// وتمرير داخلي للتبويبات وارتفاع فعلي لمنفذ العرض على الشاشات الصغيرة.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const shellLink = /<link[^>]+href="(\/app-shell\.css(?:\?[^"]*)?)"/.exec(html);
const style = shellLink
  ? fs.readFileSync(path.join(__dirname, '..', 'public', shellLink[1].replace(/^\//, '').replace(/[?#].*$/, '')), 'utf8')
  : html.slice(html.indexOf('<style>'), html.indexOf('</style>'));

test('the extracted app shell stylesheet is linked and loaded from the local public asset', () => {
  assert.ok(shellLink, 'index.html must link the extracted app-shell.css');
  assert.ok(style.length > 10000, 'the extracted stylesheet must contain the application styles');
});

test('large screens: the app is a centered phone-width column, background covers the root', () => {
  assert.match(style, /body\s*\{[^}]*max-width:\s*520px;[^}]*margin:\s*0 auto;/s);
  // Tailwind CDN يحقن body { margin: 0 } بعد <style> فيدفع العمود لأقصى اليمين في RTL لولا !important و mx-auto
  assert.match(style, /margin-left:\s*auto\s*!important;\s*margin-right:\s*auto\s*!important;/);
  assert.match(html, /<body class="[^"]*\bmx-auto\b/);
  assert.match(style, /html\s*\{[^}]*background:\s*radial-gradient/s);
  assert.doesNotMatch(html, /<body class="[^"]*h-screen/);
  // شريط التمرير داكن والخط الاحتياطي يدعم رموز Unicode 13+ مثل 🪙 و🪨 على ويندوز 10
  assert.match(style, /\.tab-content::-webkit-scrollbar-thumb/);
  assert.match(style, /Noto Color Emoji/);
});

test('small screens: body height follows the real viewport and tabs scroll internally', () => {
  assert.match(style, /height:\s*var\(--app-height,\s*100vh\)/);
  assert.match(style, /@supports \(height: 100dvh\)\s*\{\s*body \{ height: var\(--app-height, 100dvh\); \}/);
  assert.match(style, /\.tab-content\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  const viewportScript = html.slice(html.indexOf('// V16: قِس الارتفاع المرئي الحالي'), html.indexOf('// --- DOM Elements ---'));
  assert.match(viewportScript, /const syncAppHeight = \(\) => \{[^}]*const h = live > 0 \? live : stable;/s,
    'the visible viewport is authoritative; Telegram stable height is fallback only');
  const polish = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-polish.css'), 'utf8');
  assert.match(polish, /html,\s*body\s*\{[^}]*overscroll-behavior:\s*none;/s);
  assert.match(polish, /body\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(polish, /\.tab-content\s*\{[^}]*overscroll-behavior-y:\s*contain;/s);
  assert.match(polish, /@media\s*\(hover:\s*none\),\s*\(pointer:\s*coarse\)/s,
    'touch devices hide decorative scrollbar chrome without disabling content scrolling');
  for (const tab of ['tab-shop', 'tab-leaderboard', 'tab-arena']) {
    const tag = html.match(new RegExp(`<main id="${tab}" class="([^"]*)"`));
    assert.ok(tag, `${tab} should exist`);
    assert.doesNotMatch(tag[1], /max-h-\[/, `${tab} must not cap its height to a viewport fraction`);
  }
});

test('play is a fixed app screen with focused sub-tabs instead of one long page', () => {
  assert.match(style, /#tab-play\s*\{\s*overflow:\s*hidden;/);
  assert.match(style, /\.play-panel\s*\{[^}]*display:\s*none;[^}]*min-height:\s*0;/s);
  assert.match(style, /\.play-panel\.active\s*\{\s*display:\s*flex;/);
  for (const panel of ['adventure', 'missions', 'customize', 'social']) {
    assert.match(html, new RegExp(`id="play-nav-${panel}"`));
    assert.match(html, new RegExp(`id="play-panel-${panel}"`));
  }
  assert.match(html, /function switchPlayPanel\(panelId\)/);
  assert.match(html, /panel\.hidden = !selected/);
});

test('adventure canvas fills the remaining game panel and the backing store follows it', () => {
  assert.match(style, /\.adventure-stage #game-canvas \{[^}]*height:\s*100%;/s);
  assert.match(style, /\.adventure-stage\s*\{\s*min-height:\s*150px;/);
  assert.doesNotMatch(html, /id="game-canvas"[^>]*h-\[330px\]/);
  assert.match(html, /advCanvas\.height = Math\.max\(200, rect\.height\) \* dpr;/);
});

test('arena shows illustrated sword fighters and action animations, not clipped emoji cards', () => {
  assert.match(html, /id="arena-player-fighter"[^>]*arena-fighter player/);
  assert.match(html, /id="arena-enemy-fighter"[^>]*arena-fighter enemy/);
  assert.match(html, /src="\/assets\/arena-player\.png\?v=3"[^>]*alt="محارب المنجم يحمل سيفاً"/);
  assert.match(html, /src="\/assets\/arena-enemy\.png\?v=3"[^>]*alt="مبارز يحمل سيفاً"/);
  assert.match(html, /class="arena-battle-stage"/);
  assert.match(style, /\.arena-battle-stage\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(style, /\.arena-fighter-body\s*\{[^}]*object-fit:\s*contain;/s);
  assert.match(style, /@keyframes arenaLungePlayer/);
  assert.match(style, /@keyframes arenaHit/);
  assert.match(style, /@keyframes arenaDamageFloat/);
  assert.match(html, /id="arena-stage-banner"/);
  assert.match(html, /id="arena-damage-enemy"/);
  assert.match(html, /function animateArenaFighter\(actor, action, event = \{\}\)/);
  assert.match(html, /id="arena-move-left"[^>]*startArenaMove\(-1\)/);
  assert.match(html, /id="arena-move-right"[^>]*startArenaMove\(1\)/);
  assert.match(html, /const arenaInSwordRange = \(\) => arenaDistance\(\) <= 38/);
  assert.match(html, /action === 'ATTACK' && !arenaInSwordRange\(\)/);
  assert.match(html, /if \(battle\?\.active\) return;/);
  assert.match(html, /startBtn\.disabled = Boolean\(battle\?\.active\)/);
  assert.match(html, /⚔️ المعركة جارية/);
  // الساحة التفاعلية: نيّة معلنة + حكم فوق المسرح + حالة «قبل المباراة» بلا أزرار معطّلة
  assert.match(html, /id="arena-intent"/);
  assert.match(html, /id="arena-verdict"/);
  assert.match(html, /id="arena-controls"/);
  assert.match(style, /\.arena-idle #arena-controls \{ display: none; \}/);
  assert.match(style, /\.arena-fighting #arena-start-btn \{ display: none; \}/);
  assert.match(style, /\.arena-verdict\[hidden\] \{ display: none; \}/);
  assert.match(html, /function renderArenaIntent\(\)/);
  assert.match(html, /ArenaRules\.enemyIntent\(battle\)/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'arena-player.png')));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'public', 'assets', 'arena-enemy.png')));
});

test('telegram viewport height and vertical-swipe guard are applied when running inside Telegram', () => {
  assert.match(html, /tg\?\.viewportStableHeight/);
  assert.match(html, /setProperty\('--app-height'/);
  assert.match(html, /tg\.onEvent\?\.\('viewportChanged'/);
  assert.match(html, /tg\.disableVerticalSwipes\?\.\(\)/);
  // الطاقة عنصر تبويب التعدين فقط؛ التبويب الابتدائي هو اللعب
  assert.match(html, /<div id="energy-container" class="w-full mb-3" style="display:none">/);
});

// من فرع arena/d5e3e0bb (PR #20) وdevin/1792351084-gameplay-overhaul (PR #25):
// الأنماط المحلية مرتبطة فعلاً، وأدوات اللمس تحافظ على ترتيبها المكاني داخل صفحة RTL.
test('local styles are actually linked and platform touch controls preserve spatial order', () => {
  assert.match(html, /<link[^>]+href="\/game\.css/);
  assert.doesNotMatch(html, /<script[^>]+cdn\.tailwindcss\.com/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform.css'), 'utf8');
  assert.match(css, /\.mine-controls\s*\{\s*direction:ltr/);
  assert.match(html, /if \(tabId !== 'play'\) window\.PlatformGame\?\.pause\(\)/);
  assert.match(html, /if \(panelId !== 'adventure'\) window\.PlatformGame\?\.pause\(\)/);
});

// المرحلة 1: مؤثرات الإحساس بالضربة على العميل فقط. المرحلة 2 رفعت VERSION إلى 3
// (خامات/معالم) لكن أضافت أحداثاً فقط ولم تلمس فيزياء step أو عدد خطواتها.
test('phase 1+2: impact feedback and ore economy are wired into the real UI', () => {
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-renderer.js'), 'utf8');
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform.css'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const rules = require('../public/platform-rules');
  assert.ok(rules.VERSION >= 3, 'phase 2 introduced the ore engine; later phases only bump the version upward');
  for (const id of ['platform-combo', 'overlay-mission', 'mission-gems', 'mission-rocks', 'mission-fill',
    'mission-milestones', 'milestone-count', 'ore-storage', 'ore-list', 'sell-all-ore', 'ore-total']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(game, /pushFloater\(/);
  assert.match(game, /hitStopUntil > time/, 'hit-stop must freeze rendering, never R.step');
  assert.match(game, /R\.step\(sim, mask\)/, 'the physics step call stays intact');
  assert.match(renderer, /opts\.floaters/);
  assert.match(css, /\.mine-combo\{/);
  assert.match(css, /\.overlay-mission\{/);
  assert.match(css, /\.ore-row\{/);
  assert.match(server, /case 'sell_ore'/);
  assert.match(server, /ores: Object\.fromEntries/);
  assert.ok(Array.isArray(rules.MILESTONES) && rules.MILESTONES.length === 5);
  assert.equal(typeof rules.oreSummary, 'function');
  assert.equal(typeof rules.rewardBreakdown, 'function');
});

// المنجم المنصّة: هيكلة بلا تمرير — شريط علوي مدمج واحد، HUD عائم داخل الكانفاس، نافذة إعدادات التحكم، حالة Lobby/Live.
test('platform: single compact top bar replaces stacked header bars (zero-scroll)', () => {
  const gameCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-layout.css'), 'utf8');
  assert.ok(html.match(/<link[^>]+href="\/platform-layout\.css/), 'index.html links platform-layout.css');
  assert.ok(gameCss.length > 0, 'platform-layout.css exists and is non-empty');
  assert.match(gameCss, /#platform-scene\s*\{\s*[^}]*overflow:\s*hidden;/s);
  assert.match(gameCss, /height:\s*100dvh;/s);
  assert.match(gameCss, /flex-direction:\s*column;/s);
  assert.match(gameCss, /justify-content:\s*space-between;/s);
  assert.match(html, /<div class="mine-heading mine-topbar"/);
  assert.match(html, /mine-topbar/);
  assert.match(html, /<div class="mine-title"/);
  assert.match(html, /<span class="mine-gold"/);
  assert.match(html, /<span class="mine-energy"/);
  assert.match(html, /id="platform-mute"/);
  assert.match(html, /id="open-workshop-heading"/);
  assert.match(html, /id="open-guide-top"/);
  assert.match(html, /id="open-ctl-settings"/);
  // زر العتاد يحمل أيقونة الترس (i-gear)
  assert.match(html, /id="i-gear"/);
});

test('platform: floating in-canvas HUD overlay, single pause button', () => {
  assert.match(html, /<div class="mine-hud mine-hud--overlay"/);
  assert.match(html, /id="platform-hearts"/);
  assert.match(html, /id="platform-progress"/);
  assert.match(html, /id="goal-chip"/);
  assert.match(html, /id="platform-resources"/);
  assert.match(html, /id="milestone-count"/);
  // الإيقاف العائم مرة واحدة فقط داخل المشهد (لا تكرار في أزرار اللمس)
  const pauseOccurrences = (html.match(/id="platform-pause"/g) || []).length;
  assert.equal(pauseOccurrences, 1, `expected exactly one #platform-pause, found ${pauseOccurrences}`);
  assert.match(html, /class="action-btn pause-btn hud-pause"/);
  // لا شريط إيقاف عريض أسفل الكانفاس
  assert.doesNotMatch(html, /mine-controls-actions[^>]*platform-pause/s);
});

test('platform: control-settings modal relocated (ctl-settings inside ctl-modal)', () => {
  assert.match(html, /<div id="ctl-modal" class="ctl-modal"/);
  assert.match(html, /<div class="ctl-modal-backdrop" data-ctl-close>/);
  assert.match(html, /<details class="ctl-settings" id="ctl-settings"/);
  assert.match(html, /id="ctl-haptics"/);
  assert.match(html, /id="ctl-stick"/);
  assert.match(html, /id="ctl-edit"/);
  assert.match(html, /id="ctl-reset"/);
  assert.match(html, /id="ctl-layout-hint"/);
  assert.match(html, /id="platform-keyhint"/);
  assert.match(html, /id="ctl-modal-close"/);
  assert.match(html, /data-ctl-close/);
  // زر الإعدادات في الشريط العلوي يفتح النافذة
  assert.match(html, /id="open-ctl-settings"/);
});

test('platform: Lobby vs Live state classes', () => {
  assert.match(html, /id="platform-scene" class="scene-lobby"/);
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  assert.match(game, /function syncSceneState/);
  assert.match(game, /scene-live/);
  assert.match(game, /scene-lobby/);
  assert.match(game, /openCtlSettings/);
  assert.match(game, /closeCtlSettings/);
  assert.match(game, /layoutEditing/);
});

// المرحلة 3: الورشة صارت مدعومة بالخادم (بدل المعاينة) + خريطة المناجم + عرض الصلابة في المشهد.
test('phase 3 UI: the workshop is server-backed, the mines map is wired in and the scene shows rock hardness', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform.css'), 'utf8');
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-renderer.js'), 'utf8');
  assert.equal(require('../public/platform-rules').VERSION, 14, 'V21 ladder geometry: older tickets are rejected');
  for (const id of ['ws-overlay', 'ws-hero', 'ws-nodes', 'ws-cta', 'ws-modal', 'ws-upgrade', 'ws-note', 'ws-ore-row', 'ws-mine',
    'ws-card-now', 'ws-card-next', 'ws-cost-gold', 'ws-cost-ore', 'open-workshop-heading', 'open-workshop-overlay', 'open-workshop-shop',
    'mine-select', 'mines-overlay', 'mines-list', 'mines-close']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const sym of ['i-boots', 'i-bag', 'i-magnet', 'i-drill', 'i-robot', 'i-luck', 'i-armor', 'i-music', 'i-close', 'i-check']) {
    assert.match(html, new RegExp(`id="${sym}"`));
  }
  assert.match(css, /\.ws-overlay\{position:fixed;inset:0/, 'the workshop covers the whole viewport');
  assert.match(css, /\.mines-overlay\{position:fixed;inset:0/, 'the mines map covers the whole viewport');
  for (const rule of ['.ws-node{', '.ws-node.can-buy{', '.ws-cta{', '.ws-cost{', '.ws-cost.lack{', '.mine-card{', '.mine-card.locked{', '.mine-pick{', '.overlay-row{', '.ore-dot{']) {
    assert.ok(css.includes(rule), `${rule} is styled`);
  }
  assert.match(css, /\.mine-overlay::before,\.mine-overlay::after\{content:'';flex:1 0 0/, 'the start overlay centres short content without clipping tall content');
  // الورشة تقرأ الأسعار والتأثيرات من القواعد المشتركة وترسل عملية خادمية، لا مستويات محلية
  assert.match(html, /WORKSHOP_ITEMS = WS_RULES \? WS_RULES\.EQUIPMENT_ORDER/, 'items come from the shared rules; a missing rules file only disables the workshop');
  assert.match(html, /enqueueOp\(\{ type: 'buy_equip', key: id \}\)/);
  assert.match(html, /function noteEquipResults\(/);
  assert.doesNotMatch(html, /workshop-preview-levels|wsLevels/, 'no client-only levels remain');
  assert.doesNotMatch(html, /معاينة بصرية/, 'the screen is no longer a preview');
  assert.doesNotMatch(html, /\/api\/workshop/, 'equipment goes through the existing ops endpoint');
  assert.match(html, /window\.openWorkshop = wsOpen/);
  assert.match(html, /window\.openMines = minesOpen/);
  assert.ok(html.indexOf('id="mine-select"') > html.indexOf('id="platform-overlay"'), 'the selector lives in the start overlay');
  // المتحكم: المنجم المختار يُرسل عند البدء، واللقطة المخزنة تُستخدم في الاستعادة والتشغيل
  assert.match(game, /request\('\/api\/platform\/start', \{ zone: selectedZone, goal: selectedGoal, mode: playMode\(\) \}\)/);
  assert.match(game, /request\('\/api\/platform\/start', \{ resume: true \}\)/);
  assert.match(game, /R\.create\(currentHero, seedOf\(ticket\), configFor\(ticket\)\)/);
  assert.match(game, /R\.replay\(stored\.inputs, currentHero, seedOf\(stored\.ticket\), storedConfig\)/);
  assert.match(game, /event\.type === 'robot_mine'/);
  assert.match(game, /new CustomEvent\('platform-config-change'/, 'mine/hero changes notify the screens');
  assert.match(html, /addEventListener\('platform-config-change'/);
  assert.doesNotMatch(game, /[\u{1F3C6}\u{1F480}]/u, 'result titles use no emoji');
  // الرسم: صلابة الصخر بنسبة maxHp وشريط للصخور الصلبة والمخاطر من حالة المنجم
  assert.match(renderer, /rock\.maxHp/);
  assert.match(renderer, /s\.hazards \|\| L\.hazards/);
  assert.doesNotMatch(renderer, /R\.LEVEL\./, 'the renderer reads the level of the run, never the global first level');
  assert.match(renderer, /drawDrone\(c, s\.player/);
  // أصول معدّلة تحمل رقم نسخة جديد حتى لا يخلط متصفح مخزَّن بين محرك V3 وخادم V4
  assert.match(html, /platform-rules\.js\?v=20/);
  assert.match(html, /platform-game\.js\?v=46/);
  assert.match(html, /platform-renderer\.js\?v=19/);
  assert.match(html, /platform-scenery\.js\?v=3/);
  assert.match(html, /platform-bosses\.js\?v=6/);
  assert.match(html, /platform\.css\?v=24/);
});
