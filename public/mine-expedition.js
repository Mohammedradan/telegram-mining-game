/* طبقة استكشاف المنجم الموسّع: تتحكم بعرض ملء الشاشة، خريطة المغاور، أهداف الزيارة ومخابئ الاكتشاف.
   لا تمنح ولا تخصم ذهباً أو خاماً من عندها: الذهب والطاقة ووردية الآلات يظل قرارها خادمياً عبر المنصات القائمة. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else if (root) root.MiningExpedition = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const DISCOVERY_KEY = 'minequest.expedition.v1';
  const CACHE_DEFS = Object.freeze([
    Object.freeze({ id: 'toolkit', label: 'صندوق العدة', icon: 'i-bag', x: 0.09, y: 0.67, breaks: 1, requiresMachinery: false,
      locked: 'عدّن صخرة واحدة على الأقل لكشف عدة المعدّن القديمة',
      found: 'عثرت على عدة معدّن قديم؛ سُجّلت في دفتر استكشافك' }),
    Object.freeze({ id: 'secret', label: 'الممر السري', icon: 'i-gem', x: 0.89, y: 0.63, breaks: 2, requiresMachinery: true,
      locked: 'عدّن صخرتين وشغّل الحفّار والسير والعامل على الخادم لكشف الممر السري',
      found: 'انفتح ممر الكنز خلف الواجهة الصخرية؛ اكتمل جزء من خريطة هذا الكهف' }),
  ]);
  const CACHE_IDS = new Set(CACHE_DEFS.map((cache) => cache.id));
  const TASK_DEFS = Object.freeze([
    Object.freeze({ id: 'rocks', icon: 'i-pickaxe', title: 'حطّم ثلاث صخور' }),
    Object.freeze({ id: 'upper', icon: 'i-rope', title: 'اعبر إلى الممر العلوي' }),
    Object.freeze({ id: 'machinery', icon: 'i-drill', title: 'ابدأ وردية الآلات على الخادم' }),
    Object.freeze({ id: 'caches', icon: 'i-bag', title: 'افحص مخابئ هذا الكهف' }),
    Object.freeze({ id: 'next', icon: 'i-right', title: 'افتح الكهف التالي' }),
  ]);
  const MINES = Object.freeze([
    Object.freeze({ id: 'stone', name: 'المنجم الحجري', ore: 'نحاس وحديد', depth: '120 م' }),
    Object.freeze({ id: 'iron', name: 'منجم الحديد', ore: 'حديد', depth: '260 م' }),
    Object.freeze({ id: 'gold', name: 'منجم الذهب', ore: 'ذهب', depth: '480 م' }),
    Object.freeze({ id: 'crystal', name: 'كهوف البلور', ore: 'بلورات', depth: '720 م' }),
    Object.freeze({ id: 'lava', name: 'منجم الحمم', ore: 'خام ناري', depth: '980 م' }),
    Object.freeze({ id: 'legendary', name: 'المنجم الأسطوري', ore: 'خام أسطوري', depth: '1500 م' }),
  ]);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  };
  const cleanId = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  const aspectOf = (snapshot) => {
    const size = snapshot && snapshot.size;
    const width = num(size && size.W, 1);
    const height = Math.max(1, num(size && size.H, 1));
    return Math.max(0.2, width / height);
  };
  const distance = (a, b, aspect) => Math.hypot(num(a && a.x) - num(b && b.x), (num(a && a.y) - num(b && b.y)) / Math.max(0.2, num(aspect, 1)));

  function normalizeDiscoveries(value) {
    const out = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
    for (const [rawMine, rawList] of Object.entries(value)) {
      const mine = cleanId(rawMine);
      if (!mine || !Array.isArray(rawList)) continue;
      const ids = [...new Set(rawList.map(cleanId).filter((id) => CACHE_IDS.has(id)))];
      if (ids.length) out[mine] = ids;
    }
    return out;
  }

  function discoveryCount(discoveries, mineId) {
    const mine = cleanId(mineId);
    const list = mine && discoveries && discoveries[mine];
    return Array.isArray(list) ? list.filter((id) => CACHE_IDS.has(id)).length : 0;
  }

  function markDiscovery(discoveries, mineId, cacheId) {
    const mine = cleanId(mineId);
    const id = cleanId(cacheId);
    const next = normalizeDiscoveries(discoveries);
    if (!mine || !CACHE_IDS.has(id)) return next;
    const list = new Set(next[mine] || []);
    const before = list.size;
    list.add(id);
    next[mine] = [...list];
    next.__added = list.size > before ? id : '';
    return next;
  }

  function discovered(discoveries, mineId, cacheId) {
    const mine = cleanId(mineId);
    return !!(mine && discoveries && Array.isArray(discoveries[mine]) && discoveries[mine].includes(cleanId(cacheId)));
  }

  function objectiveSnapshot(snapshot, discoveries) {
    const mine = snapshot && snapshot.mine ? snapshot.mine : {};
    const definition = mine.definition || {};
    const mineId = cleanId(definition.id || 'stone') || 'stone';
    const breaks = clamp(Math.floor(num(mine.breaks)), 0, 3);
    const machinery = snapshot && snapshot.machinery ? snapshot.machinery : {};
    const machineryCount = ['drill', 'conveyor', 'worker'].filter((key) => !!machinery[key]).length;
    const cacheCount = discoveryCount(discoveries, mineId);
    const transitions = Math.max(0, Math.floor(num(mine.transitions)));
    const advanced = transitions > 0 || Math.floor(num(mine.index)) > 0;
    return [
      { id: 'rocks', progress: breaks / 3, current: breaks, target: 3, done: breaks >= 3, detail: `${breaks} من 3 صخور` },
      { id: 'upper', progress: mine.floor === 'upper' ? 1 : 0, current: mine.floor === 'upper' ? 1 : 0, target: 1, done: mine.floor === 'upper', detail: mine.floor === 'upper' ? 'وصلت إلى الممر العلوي' : 'اصعد السلم أو المصعد' },
      { id: 'machinery', progress: machineryCount / 3, current: machineryCount, target: 3, done: machineryCount === 3, detail: `${machineryCount} من 3 آلات تعمل` },
      { id: 'caches', progress: cacheCount / CACHE_DEFS.length, current: cacheCount, target: CACHE_DEFS.length, done: cacheCount >= CACHE_DEFS.length, detail: `${cacheCount} من ${CACHE_DEFS.length} مخابئ` },
      { id: 'next', progress: advanced ? 1 : 0, current: advanced ? 1 : 0, target: 1, done: advanced, detail: advanced ? 'سُجّل عبور إلى كهف آخر' : 'اعبر المخرج بعد كسر 3 صخور' },
    ];
  }

  const cacheNear = (cache, snapshot) => {
    if (!cache || !snapshot) return false;
    return distance({ x: cache.x, y: cache.y }, snapshot.miner, aspectOf(snapshot)) <= 0.23;
  };

  function cacheState(cache, snapshot, discoveries) {
    const mineId = cleanId(snapshot && snapshot.mine && snapshot.mine.definition && snapshot.mine.definition.id) || 'stone';
    if (discovered(discoveries, mineId, cache.id)) return 'found';
    const breaks = Math.max(0, Math.floor(num(snapshot && snapshot.mine && snapshot.mine.breaks)));
    const machinery = snapshot && snapshot.machinery ? snapshot.machinery : {};
    const powered = !!(machinery.drill && machinery.conveyor && machinery.worker);
    if (breaks < cache.breaks) return 'locked';
    if (cache.requiresMachinery && !powered) return 'needs-power';
    return cacheNear(cache, snapshot) ? 'ready' : 'far';
  }

  function createStore(storage) {
    const memory = {};
    const backing = storage || {
      getItem(key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; },
      setItem(key, value) { memory[key] = String(value); },
    };
    return {
      load() {
        try { return normalizeDiscoveries(JSON.parse(backing.getItem(DISCOVERY_KEY) || '{}')); }
        catch (_) { return {}; }
      },
      save(map) {
        try { backing.setItem(DISCOVERY_KEY, JSON.stringify(normalizeDiscoveries(map))); return true; }
        catch (_) { return false; }
      },
    };
  }

  const api = { active: false };
  function localStorageSafe() {
    try { return root.localStorage || null; } catch (_) { return null; }
  }
  function svgUse(id) { return `<svg class="ui-icon" aria-hidden="true" focusable="false"><use href="#${id}"></use></svg>`; }

  function buildLayer(doc, stage, area) {
    if (!stage.querySelector || !area) return null;
    // زر ملء الشاشة يعيش في صف «الأدوات» أعلى الشاشة (بجانب زر الصوت) لا فوق المشهد:
    // وضعه فوق الصف العلوي كان يحتلّ ركن ميداليات الترقية (منطقة ميتة يلمسها اللاعب مصادفةً)
    const hud = (doc.querySelector && doc.querySelector('.ck-hud')) || stage;
    if (!hud.querySelector('.ck-fullscreen-toggle')) {
      hud.insertAdjacentHTML('beforeend', `
        <button id="ck-fullscreen" class="ck-fullscreen-toggle" type="button" aria-pressed="false" aria-label="ملء الشاشة">
          ${svgUse('i-fullscreen')}<span class="ck-fs-open">ملء الشاشة</span><span class="ck-fs-close">إظهار الواجهة</span>
        </button>`);
    }
    if (!stage.querySelector('.ck-expedition-rail')) {
      stage.insertAdjacentHTML('beforeend', `
        <div class="ck-expedition-rail" aria-label="أدوات استكشاف المنجم">
          <details id="ck-map-panel" class="ck-expedition-sheet ck-map-sheet">
            <summary>${svgUse('i-book')}<span class="ck-sheet-title">خريطة المنجم</span><small id="ck-map-current">المنجم الحجري</small></summary>
            <div class="ck-map-body"><ol id="ck-map-list" aria-label="طبقات المنجم والمغاور"></ol></div>
          </details>
          <details id="ck-goals-panel" class="ck-expedition-sheet ck-goals-sheet">
            <summary>${svgUse('i-sparkle')}<span class="ck-sheet-title">أهداف الزيارة</span><b id="ck-goals-count" class="ck-goals-count">0/${TASK_DEFS.length}</b></summary>
            <ol id="ck-goals-list" class="ck-goals-list"></ol>
          </details>
        </div>
        <div id="ck-world-toast" class="ck-world-toast" role="status" aria-live="polite" aria-atomic="true"></div>`);
    }
    if (!area.querySelector('.ck-cache')) {
      area.insertAdjacentHTML('beforeend', CACHE_DEFS.map((cache) => `
        <button class="ck-cache ck-cache-${cache.id}" type="button" data-cache="${cache.id}" data-state="locked" aria-pressed="false" aria-label="${cache.label}" style="--cache-x:${cache.x};--cache-y:${cache.y}">
          <span class="ck-cache-art">${svgUse(cache.icon)}</span>
          <span class="ck-cache-label">${cache.label}</span>
          <span class="ck-cache-glint" aria-hidden="true"></span>
        </button>`).join(''));
    }
    const goals = stage.querySelector('#ck-goals-list');
    if (goals && !goals.childElementCount) {
      goals.innerHTML = TASK_DEFS.map((task) => `
        <li class="ck-goal" data-task="${task.id}">
          <span class="ck-goal-check">${svgUse('i-check')}</span>
          <span class="ck-goal-copy"><b>${task.title}</b><small class="ck-goal-detail">جارٍ القراءة…</small><span class="ck-goal-meter" aria-hidden="true"><i></i></span></span>
        </li>`).join('');
    }
    const map = stage.querySelector('#ck-map-list');
    if (map && !map.childElementCount) {
      const source = root.MineWorld && Array.isArray(root.MineWorld.MINES) ? root.MineWorld.MINES : MINES;
      map.innerHTML = source.map((mine, index) => `
        <li class="ck-map-node" data-mine="${cleanId(mine.id)}" data-index="${index}">
          <span class="ck-map-index">${index + 1}</span>
          <span class="ck-map-copy"><b>${mine.name || MINES[index].name}</b><small>${mine.depth || MINES[index].depth} · ${mine.ore || MINES[index].ore}</small></span>
          <span class="ck-map-state">مغلق</span>
        </li>`).join('');
    }
    return {
      fullscreen: hud.querySelector('#ck-fullscreen'),
      rail: stage.querySelector('.ck-expedition-rail'),
      mapPanel: stage.querySelector('#ck-map-panel'),
      mapCurrent: stage.querySelector('#ck-map-current'),
      mapList: stage.querySelector('#ck-map-list'),
      goalsPanel: stage.querySelector('#ck-goals-panel'),
      goalsCount: stage.querySelector('#ck-goals-count'),
      goalsList: stage.querySelector('#ck-goals-list'),
      toast: stage.querySelector('#ck-world-toast'),
      caches: [...area.querySelectorAll('.ck-cache')],
    };
  }

  function objectivesMarkupSignature(items) { return items.map((item) => `${item.id}:${item.done ? 1 : 0}:${item.current}`).join('|'); }

  function init(options = {}) {
    if (api.active) return true;
    const doc = root && root.document;
    if (!doc || !doc.getElementById) return false;
    const stage = doc.getElementById('ck-stage');
    const area = doc.getElementById('click-area');
    const world = doc.getElementById('ck-world');
    if (!stage || !area) return false;
    const refs = buildLayer(doc, stage, area);
    if (!refs || !refs.fullscreen || !refs.goalsList || !refs.mapList) return false;
    // Keep the field dimensions stable: sheets overlay it, and only one expands.
    const panels = [refs.mapPanel, refs.goalsPanel].filter(Boolean);
    panels.forEach((panel) => {
      panel.addEventListener('toggle', () => {
        if (panel.open) panels.forEach((other) => { if (other !== panel) other.open = false; });
      });
      panel.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !panel.open) return;
        panel.open = false;
        const summary = panel.querySelector('summary');
        if (summary && summary.focus) summary.focus();
        event.preventDefault();
        event.stopPropagation();
      });
    });
    const store = options.store || createStore(options.storage || localStorageSafe());
    let discoveries = store.load();
    let toastTimer = 0;
    let pollTimer = 0;
    let lastGoalSignature = '';
    let primed = false;
    const celebrated = new Set();
    const body = doc.body;
    const cacheById = new Map(CACHE_DEFS.map((cache) => [cache.id, cache]));

    const readSnapshot = () => {
      try { return root.DigSite && typeof root.DigSite.inspect === 'function' ? root.DigSite.inspect() : null; }
      catch (_) { return null; }
    };
    const toast = (message) => {
      if (!refs.toast) return;
      refs.toast.textContent = String(message || '');
      refs.toast.classList.add('is-on');
      try {
        if (toastTimer && root.clearTimeout) root.clearTimeout(toastTimer);
        toastTimer = root.setTimeout(() => refs.toast.classList.remove('is-on'), 3200);
      } catch (_) { /* اللمسة لا تتوقف لو تعذر المؤقّت */ }
    };
    const mineIdOf = (snapshot) => cleanId(snapshot && snapshot.mine && snapshot.mine.definition && snapshot.mine.definition.id) || 'stone';
    const currentMineIndex = (snapshot) => clamp(Math.floor(num(snapshot && snapshot.mine && snapshot.mine.index)), 0, MINES.length - 1);

    function syncFullscreenButton() {
      const focus = !!(body && body.classList && body.classList.contains('ck-mining-focus'));
      refs.fullscreen.setAttribute('aria-pressed', focus ? 'true' : 'false');
      refs.fullscreen.setAttribute('aria-label', focus ? 'إظهار واجهة اللعبة' : 'ملء الشاشة');
      if (body && body.classList) body.classList.toggle('ck-mining-focus-available', true);
    }
    async function toggleFullscreen() {
      if (!body || !body.classList) return;
      const enable = !body.classList.contains('ck-mining-focus');
      body.classList.toggle('ck-mining-focus', enable);
      const tg = root.Telegram && root.Telegram.WebApp;
      let requested = false;
      try {
        if (enable && tg && typeof tg.expand === 'function') tg.expand();
        if (enable && tg && typeof tg.requestFullscreen === 'function') {
          const result = tg.requestFullscreen();
          if (result && typeof result.then === 'function') await result;
          requested = true;
        } else if (enable && doc.documentElement && doc.documentElement.requestFullscreen && !doc.fullscreenElement) {
          await doc.documentElement.requestFullscreen({ navigationUI: 'hide' });
          requested = true;
        } else if (!enable) {
          if (tg && typeof tg.exitFullscreen === 'function') tg.exitFullscreen();
          if (doc.fullscreenElement && doc.exitFullscreen) await doc.exitFullscreen();
        }
      } catch (_) {
        if (enable) toast('وضع التركيز داخل اللعبة — تعذر ملء الشاشة على هذه النسخة');
      }
      if (enable && !requested) { /* class alone remains a useful near-fullscreen fallback */ }
      syncFullscreenButton();
    }
    refs.fullscreen.addEventListener('click', () => { toggleFullscreen(); });
    if (doc.addEventListener) doc.addEventListener('fullscreenchange', () => {
      if (!doc.fullscreenElement && body && body.classList) body.classList.remove('ck-mining-focus');
      syncFullscreenButton();
    });

    function updateMap(snapshot) {
      const index = currentMineIndex(snapshot);
      const unlocked = clamp(Math.floor(num(snapshot && snapshot.mine && snapshot.mine.unlocked, index)), 0, MINES.length - 1);
      const current = snapshot && snapshot.mine && snapshot.mine.definition ? snapshot.mine.definition : MINES[index];
      if (refs.mapCurrent) refs.mapCurrent.textContent = current.name || MINES[index].name;
      [...refs.mapList.children].forEach((node) => {
        const i = clamp(Math.floor(num(node.getAttribute('data-index'))), 0, MINES.length - 1);
        node.classList.toggle('is-current', i === index);
        node.classList.toggle('is-open', i <= unlocked && i !== index);
        node.classList.toggle('is-locked', i > unlocked);
        node.setAttribute('aria-current', i === index ? 'true' : 'false');
        const state = node.querySelector && node.querySelector('.ck-map-state');
        if (state) state.textContent = i === index ? 'هنا' : i <= unlocked ? 'مفتوح' : 'مغلق';
      });
    }

    function updateGoals(snapshot) {
      const items = objectiveSnapshot(snapshot, discoveries);
      const done = items.filter((item) => item.done).length;
      if (refs.goalsCount) refs.goalsCount.textContent = `${done}/${items.length}`;
      const signature = objectivesMarkupSignature(items);
      if (signature === lastGoalSignature) return;
      lastGoalSignature = signature;
      const byId = new Map(items.map((item) => [item.id, item]));
      [...refs.goalsList.children].forEach((li) => {
        const item = byId.get(li.getAttribute('data-task'));
        if (!item) return;
        li.classList.toggle('is-done', item.done);
        const detail = li.querySelector && li.querySelector('.ck-goal-detail');
        if (detail) detail.textContent = item.detail;
        const fill = li.querySelector && li.querySelector('.ck-goal-meter i');
        if (fill) fill.style.width = `${Math.round(clamp(item.progress, 0, 1) * 100)}%`;
        if (item.done) {
          const key = `${currentMineIndex(snapshot)}:${item.id}`;
          if (primed && !celebrated.has(key)) { celebrated.add(key); toast(`اكتملت مهمة: ${item.id === 'rocks' ? 'حطّمت 3 صخور' : item.id === 'upper' ? 'وصلت إلى الممر العلوي' : item.id === 'machinery' ? 'الآلات تعمل بأمر الخادم' : item.id === 'caches' ? 'اكتشفت مخابئ الكهف' : 'انفتحت منطقة جديدة'}`); }
          else celebrated.add(key);
        }
      });
      primed = true;
    }

    function updateCaches(snapshot) {
      const mineId = mineIdOf(snapshot);
      let foundHere = 0;
      refs.caches.forEach((button) => {
        const cache = cacheById.get(button.getAttribute('data-cache'));
        if (!cache) return;
        const state = cacheState(cache, snapshot, discoveries);
        button.dataset.state = state;
        button.setAttribute('aria-pressed', state === 'found' ? 'true' : 'false');
        button.setAttribute('aria-label', `${cache.label} — ${state === 'found' ? 'مكتشف' : state === 'ready' ? 'جاهز للفحص' : state === 'far' ? 'اقترب لفحصه' : 'مغلق'}`);
        if (state === 'found') foundHere += 1;
      });
      if (world && world.dataset) world.dataset.secretCaches = String(foundHere);
      const set = world && world.querySelector ? world.querySelector('.ck-mine-set') : null;
      if (set && set.dataset) set.dataset.secretOpen = discovered(discoveries, mineId, 'secret') ? 'true' : 'false';
    }

    function update() {
      const snapshot = readSnapshot();
      if (!snapshot) return;
      updateMap(snapshot);
      updateGoals(snapshot);
      updateCaches(snapshot);
    }
    const scheduleUpdate = () => {
      if (pollTimer) return;
      pollTimer = root.setTimeout(() => { pollTimer = 0; update(); }, 350);
    };

    refs.caches.forEach((button) => {
      button.addEventListener('click', () => {
        const cache = cacheById.get(button.getAttribute('data-cache'));
        const snapshot = readSnapshot();
        if (!cache || !snapshot) { toast('موقع الحفر غير جاهز بعد'); return; }
        const state = cacheState(cache, snapshot, discoveries);
        if (state === 'found') { toast(`${cache.label} مُكتشف بالفعل`); return; }
        if (state === 'locked' || state === 'needs-power') { toast(cache.locked); return; }
        if (state === 'far') { toast('اقترب من العلامة بالعصا ثم افحصها'); return; }
        const mineId = mineIdOf(snapshot);
        discoveries = markDiscovery(discoveries, mineId, cache.id);
        delete discoveries.__added;
        store.save(discoveries);
        update();
        toast(cache.found);
        const rect = button.getBoundingClientRect ? button.getBoundingClientRect() : null;
        if (rect && root.ClickerFX && typeof root.ClickerFX.burst === 'function') root.ClickerFX.burst('milestone', rect.left + rect.width / 2, rect.top + rect.height / 2, { scale: 1.15 });
      });
    });

    if (root.addEventListener) root.addEventListener('resize', scheduleUpdate, { passive: true });
    if (doc.addEventListener) doc.addEventListener('visibilitychange', () => { if (!doc.hidden) scheduleUpdate(); });
    syncFullscreenButton();
    if (refs.goalsPanel && num(root.innerWidth, 0) >= 980) refs.goalsPanel.open = true;
    if (refs.mapPanel && num(root.innerWidth, 0) >= 1280) {
      if (refs.goalsPanel) refs.goalsPanel.open = false;
      refs.mapPanel.open = true;
    }
    update();
    if (root.setInterval) root.setInterval(update, 500);
    api.active = true;
    return true;
  }

  Object.assign(api, {
    VERSION: 1,
    DISCOVERY_KEY,
    CACHE_DEFS,
    TASK_DEFS,
    MINES,
    normalizeDiscoveries,
    discoveryCount,
    markDiscovery,
    discovered,
    objectiveSnapshot,
    cacheState,
    cacheNear,
    createStore,
    init,
  });
  return api;
});

if (typeof window !== 'undefined' && typeof module === 'undefined') {
  const boot = () => { try { window.MiningExpedition.init(); } catch (error) { try { console.error('MiningExpedition:', error && error.message); } catch (_) { /* تجاهل */ } } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
}
