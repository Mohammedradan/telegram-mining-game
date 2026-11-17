// حارس انحدار لتخطيط الواجهة: عمود بعرض هاتف على الشاشات الكبيرة،
// وتمرير داخلي للتبويبات وارتفاع فعلي لمنفذ العرض على الشاشات الصغيرة.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const adventure = fs.readFileSync(path.join(__dirname, '..', 'public', 'adventure-game.js'), 'utf8');
const arenaClient = fs.readFileSync(path.join(__dirname, '..', 'public', 'arena-client.js'), 'utf8');
const workshop = fs.readFileSync(path.join(__dirname, '..', 'public', 'mine-workshop.js'), 'utf8');
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
  assert.match(adventure, /advCanvas\.height = Math\.max\(200, rect\.height\) \* dpr;/);
});

test('arena shows illustrated sword fighters and action animations, not clipped emoji cards', () => {
  const page = html + arenaClient;
  assert.match(page, /id="arena-player-fighter"[^>]*arena-fighter player/);
  assert.match(page, /id="arena-enemy-fighter"[^>]*arena-fighter enemy/);
  assert.match(page, /src="\/assets\/arena-player\.png\?v=3"[^>]*alt="محارب المنجم يحمل سيفاً"/);
  assert.match(page, /src="\/assets\/arena-enemy\.png\?v=3"[^>]*alt="مبارز يحمل سيفاً"/);
  assert.match(page, /class="arena-battle-stage"/);
  assert.match(style, /\.arena-battle-stage\s*\{[^}]*overflow:\s*hidden;/s);
  assert.match(style, /\.arena-fighter-body\s*\{[^}]*object-fit:\s*contain;/s);
  assert.match(style, /@keyframes arenaLungePlayer/);
  assert.match(style, /@keyframes arenaHit/);
  assert.match(style, /@keyframes arenaDamageFloat/);
  assert.match(page, /id="arena-stage-banner"/);
  assert.match(page, /id="arena-damage-enemy"/);
  assert.match(page, /function animateArenaFighter\(actor, action, event = \{\}\)/);
  assert.match(page, /id="arena-move-left"[^>]*startArenaMove\(-1\)/);
  assert.match(page, /id="arena-move-right"[^>]*startArenaMove\(1\)/);
  assert.match(page, /const arenaInSwordRange = \(\) => arenaDistance\(\) <= 38/);
  assert.match(page, /action === 'ATTACK' && !arenaInSwordRange\(\)/);
  assert.match(page, /if \(battle\?\.active\) return;/);
  assert.match(page, /startBtn\.disabled = Boolean\(battle\?\.active\)/);
  assert.match(page, /⚔️ المعركة جارية/);
  // الساحة التفاعلية: نيّة معلنة + حكم فوق المسرح + حالة «قبل المباراة» بلا أزرار معطّلة
  assert.match(html, /id="arena-intent"/);
  assert.match(html, /id="arena-verdict"/);
  assert.match(html, /id="arena-controls"/);
  assert.match(style, /\.arena-idle #arena-controls \{ display: none; \}/);
  assert.match(style, /\.arena-fighting #arena-start-btn \{ display: none; \}/);
  assert.match(style, /\.arena-verdict\[hidden\] \{ display: none; \}/);
  assert.match(page, /function renderArenaIntent\(\)/);
  assert.match(page, /ArenaRules\.enemyIntent\(battle\)/);
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
  assert.ok(html.match(/<link[^>]+href="\/platform-layout\.css\?v=6/), 'index.html links the current platform layout stylesheet');
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
  const layout = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-layout.css'), 'utf8');
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
  assert.match(layout, /#platform-scene:not\(\.scene-live\)\s+\.mine-hud--overlay\s*\{\s*display:\s*none;/,
    'the in-game HUD stays out of the lobby and result overlay');
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

test('active platform gameplay gets the screen space without losing tab navigation', () => {
  const layout = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-layout.css'), 'utf8');
  assert.match(layout, /body #platform-scene\.scene-live \.mine-title,\s*body #platform-scene\.scene-live \.mine-economy \{ display: none; \}/);
  assert.match(layout, /body\.scene-live \.bottom-nav \{\s*flex: 0 0 52px;/);
  assert.match(layout, /body #platform-scene\.scene-lobby \.mine-topbar \{\s*display: grid;/);
  assert.match(html, /id="platform-status" class="mine-status mine-status--toast mine-status--hint"/);
  assert.match(layout, /#platform-scene\.scene-live \.mine-status--hint \{ display: none; \}/);
});

test('the movement prototype button stays inside the mining screen', () => {
  const stationUi = fs.readFileSync(path.join(__dirname, '..', 'public', 'station-ui.js'), 'utf8');
  const stationCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'station.css'), 'utf8');
  assert.match(stationUi, /const entryHost=tab\.querySelector\('#ck-stage'\)\|\|tab;/);
  assert.doesNotMatch(stationUi, /document\.querySelector\('\.ck-hud'\)/);
  assert.match(stationCss, /\.station-entry\{[^}]*position:absolute;/);
  assert.match(stationCss, /#station-view\{inset:50% auto auto 50%;[^}]*height:min\(48dvh,520px\)/);
});

// المرحلة 3: الورشة صارت مدعومة بالخادم (بدل المعاينة) + خريطة المناجم + عرض الصلابة في المشهد.
test('phase 3 UI: the workshop is server-backed, the mines map is wired in and the scene shows rock hardness', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform.css'), 'utf8');
  const game = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-game.js'), 'utf8');
  const renderer = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-renderer.js'), 'utf8');
  const characters = fs.readFileSync(path.join(__dirname, '..', 'public', 'platform-characters.js'), 'utf8');
  assert.equal(require('../public/platform-rules').VERSION, 15, 'V22 logistics replay: older tickets are rejected');
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
  assert.match(workshop, /WORKSHOP_ITEMS = WS_RULES \? WS_RULES\.EQUIPMENT_ORDER/, 'items come from the shared rules; a missing rules file only disables the workshop');
  assert.match(workshop, /enqueueOp\(\{ type: 'buy_equip', key: id \}\)/);
  assert.match(workshop, /function noteEquipResults\(/);
  assert.doesNotMatch(workshop, /workshop-preview-levels|wsLevels/, 'no client-only levels remain');
  assert.doesNotMatch(workshop, /معاينة بصرية/, 'the screen is no longer a preview');
  assert.doesNotMatch(workshop, /\/api\/workshop/, 'equipment goes through the existing ops endpoint');
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
  assert.match(characters, /function drawDrone\(c, p, tick, reduced\)/);
  // أصول معدّلة تحمل رقم نسخة جديد حتى لا يخلط متصفح مخزَّن بين محرك V3 وخادم V4
  assert.match(html, /platform-rules\.js\?v=22/);
  assert.match(html, /platform-game\.js\?v=50/);
  assert.match(html, /platform-renderer\.js\?v=25/);
  assert.match(html, /platform-scenery\.js\?v=3/);
  assert.match(html, /platform-bosses\.js\?v=6/);
  assert.match(html, /platform\.css\?v=25/);
});


test('showcase lobby and live stages yield to phone and short-landscape viewports', () => {
  const lobby = fs.readFileSync(path.join(__dirname, '..', 'public', 'game-showcase.css'), 'utf8');
  const live = fs.readFileSync(path.join(__dirname, '..', 'public', 'game-showcase-live.css'), 'utf8');
  const lobbyMobileAt = lobby.lastIndexOf('@media (max-width: 600px)');
  const liveMobileAt = live.lastIndexOf('@media (max-width: 600px)');
  assert.ok(lobbyMobileAt > lobby.indexOf('height: 660px'), 'the mobile lobby override follows the fixed desktop stage');
  assert.match(lobby.slice(lobbyMobileAt), /#platform-scene\.scene-lobby \.mine-stage \{\s*flex: 1 1 0 !important;\s*min-height: 0 !important;\s*height: auto !important;/,
    'the lobby stage consumes only the space left by the mobile shell');
  assert.match(lobby, /@media \(max-width: 600px\)[\s\S]*#platform-scene\.scene-lobby #platform-start,[\s\S]*#platform-scene\.scene-lobby #platform-resume,[\s\S]*bottom: 64px !important;/,
    'the phone start/resume action sits above the mine/workshop row without scrolling the page');
  assert.match(lobby, /@media \(max-width: 380px\) and \(max-height: 600px\)[\s\S]*#platform-scene\.scene-lobby #platform-start,[\s\S]*bottom: 60px !important;/,
    'the compact 320x568 start action has its own row above the picker');
  assert.match(lobby, /#platform-scene\.scene-lobby \.overlay-row \{\s*bottom: 8px !important;/,
    'the mine/workshop row stays anchored at the bottom of the stage');
  assert.match(lobby, /@media \(min-width: 600px\) and \(max-height: 520px\) and \(orientation: landscape\)[\s\S]*#platform-scene\.scene-lobby \.mine-stage \{\s*flex: 1 1 0 !important;/,
    'short landscape lobby stages do not retain the desktop 660px height');
  assert.ok(liveMobileAt > live.indexOf('height: 770px'), 'the live mobile override follows the fixed desktop stage');
  assert.match(live.slice(liveMobileAt), /#platform-scene\.scene-live \.mine-topbar \{[\s\S]*?min-height: 44px !important;/,
    'the live phone action bar stays compact and reachable');
  assert.match(live.slice(liveMobileAt), /#platform-scene\.scene-live \.mine-stage \{\s*flex: 1 1 0 !important;\s*min-height: 0 !important;\s*height: auto !important;/,
    'the live stage fits the remaining phone viewport');
  assert.match(lobby, /#platform-scene #platform-goals \{\s*pointer-events: none !important;\s*\}/,
    'empty goal-panel space cannot intercept resume/start controls in lobby or live state');
  assert.match(lobby, /#platform-scene #platform-goals \.goal-option \{\s*pointer-events: auto !important;\s*\}/,
    'individual goal choices remain interactive');
  assert.match(lobby, /#platform-scene\.scene-lobby \.lobby-compass-card \* \{\s*pointer-events: none !important;\s*\}/,
    'decorative compass text cannot intercept the mine picker');
  assert.match(live, /@media \(min-width: 600px\) and \(max-height: 520px\) and \(orientation: landscape\)[\s\S]*#platform-scene\.scene-live \.mine-stage \{\s*flex: 1 1 0 !important;/,
    'short landscape live stages also relinquish the desktop height');
  assert.match(html, /game-showcase\.css\?v=9/);
  assert.match(html, /game-showcase-live\.css\?v=2/);
});
