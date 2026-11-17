    // ============================================================
    const WS_RULES = window.PlatformRules; // ملف القواعد المشترك؛ غيابه يعطّل الورشة والخريطة فقط ولا يُسقط بقية اللعبة
    const WORKSHOP_ITEMS = WS_RULES ? WS_RULES.EQUIPMENT_ORDER.map((id) => ({ id, ...WS_RULES.EQUIPMENT[id] })) : [];
    let wsOpenFlag = false, wsAudio = null, wsMusicTimer = 0;
    let wsSoundOn = true, wsMusicOn = false, wsActiveItem = null;
    const WS_DEFAULT_NOTE = 'تُشترى المعدات بالذهب والخامات ويتحقق الخادم من كل ترقية. تسري من جولتك القادمة.';
    const wsLevel = (id) => Math.max(0, Math.min(WS_RULES.MAX_EQUIP_LEVEL, Math.floor(Number(state.equipment?.[id]) || 0)));
    const hitsWord = (n) => (n === 1 ? 'ضربة واحدة' : n === 2 ? 'ضربتان' : n <= 10 ? `${n} ضربات` : `${n} ضربة`);
    const wsNote = (text) => { const n = document.getElementById('ws-note'); if (n) n.textContent = text || WS_DEFAULT_NOTE; };
    // هل تكفي الأرصدة الحالية للترقية التالية؟ (للعرض فقط — الخادم هو الحكم)
    function wsAfford(id) {
      const cost = WS_RULES.equipCost(id, wsLevel(id));
      if (!cost) return { max: true, ok: false, cost: null, goldOk: false, lacking: [] };
      const goldOk = (Number(state.gold) || 0) >= cost.gold;
      const lacking = Object.entries(cost.ores).filter(([k, n]) => (Number(state.ores?.[k]) || 0) < n).map(([k]) => k);
      return { max: false, ok: goldOk && !lacking.length, cost, goldOk, lacking };
    }

    function wsNodePos(i) {
      const a = (-90 + i * 45) * Math.PI / 180;
      return { x: 50 + 41 * Math.cos(a), y: 50 + 41 * Math.sin(a) };
    }
    // ميدالية المعدة: حلقة التقدّم = رصيد الذهب ÷ سعر الترقية، وتخضرّ مع سهم حين يكفي الذهب والخامات، وتكتمل ذهبياً عند المستوى الأقصى
    function wsMedal(id, icon, lvl, a) {
      const mstate = a.max ? 'max' : a.ok ? 'ready' : 'poor';
      const progress = a.max ? 1 : a.cost ? Math.min(1, (Number(state.gold) || 0) / Math.max(1, a.cost.gold)) : 0;
      const art = window.CaveArt;
      if (art?.medalHTML) return art.medalHTML({ id, icon, level: lvl, progress, state: mstate });
      return `<svg class="ui-icon" aria-hidden="true"><use href="#${icon}"/></svg><span class="ws-node-lvl">${lvl}</span>`;
    }
    function wsRenderHero() {
      const drone = document.getElementById('ws-drone');
      if (drone) drone.hidden = !(WS_RULES && wsLevel('robot') >= 1);
    }
    function wsRenderNodes() {
      const host = document.getElementById('ws-nodes');
      if (!host) return;
      host.innerHTML = WORKSHOP_ITEMS.map((it, i) => {
        const pos = wsNodePos(i), lvl = wsLevel(it.id), a = wsAfford(it.id);
        const cls = ['ws-node', a.max ? 'is-max' : '', a.ok ? 'can-buy' : ''].filter(Boolean).join(' ');
        return `<button class="${cls}" type="button" data-ws-item="${it.id}" style="left:${pos.x}%;top:${pos.y}%" aria-label="${it.name} — المستوى ${lvl}${a.ok ? ' — ترقية متاحة' : ''}" title="${it.name}">${wsMedal(it.id, it.icon, lvl, a)}</button>`;
      }).join('');
      wsRenderHero();
    }
    function wsRenderTop() {
      const gold = document.getElementById('ws-gold');
      if (gold) gold.textContent = fmt(Math.floor(state.gold || 0));
      const ores = document.getElementById('ws-ore-total');
      if (ores) ores.textContent = fmt(Object.values(state.ores || {}).reduce((a, v) => a + Math.max(0, Number(v) || 0), 0));
      const row = document.getElementById('ws-ore-row');
      if (row) row.innerHTML = Object.entries(WS_RULES.ORES).map(([k, d]) => `<span class="ws-ore-chip" title="${d.name}"><i class="ore-dot ore-${k}"></i>${d.name}<b>${fmt(Math.max(0, Number(state.ores?.[k]) || 0))}</b></span>`).join('');
      const summary = document.getElementById('ws-summary');
      if (summary) {
        const total = WORKSHOP_ITEMS.reduce((a, it) => a + wsLevel(it.id), 0);
        const zone = window.PlatformGame?.getZone?.() ?? 0, hero = window.PlatformGame?.getHero?.() || 'miner';
        const hits = WS_RULES.hitsToBreak(hero, zone, state.equipment);
        summary.innerHTML = `<span>المعدات المطوّرة <b>${total}/${WORKSHOP_ITEMS.length * WS_RULES.MAX_EQUIP_LEVEL}</b></span><span>كسر صخرة المنجم <b>${hitsWord(hits)}</b></span>`;
      }
      minesLabels();
    }
    function wsRefresh() {
      if (!wsOpenFlag) return;
      wsRenderNodes(); wsRenderTop();
      if (wsActiveItem && !document.getElementById('ws-modal').hidden) wsOpenItem(wsActiveItem.id, false);
    }
    function wsBeep(freq, dur = 0.12, vol = 0.04, force = false) {
      if (!wsSoundOn && !force) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!wsAudio) wsAudio = new AC();
        wsAudio.resume?.();
        const osc = wsAudio.createOscillator(), gain = wsAudio.createGain();
        osc.frequency.value = freq; osc.type = 'triangle';
        gain.gain.setValueAtTime(vol, wsAudio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, wsAudio.currentTime + dur);
        osc.connect(gain); gain.connect(wsAudio.destination);
        osc.start(); osc.stop(wsAudio.currentTime + dur);
      } catch (_) {}
    }
    const WS_NOTES = [392, 440, 494, 523, 494, 440];
    function wsToggleMusic() {
      wsMusicOn = !wsMusicOn;
      document.getElementById('ws-music')?.setAttribute('aria-pressed', String(wsMusicOn));
      if (wsMusicTimer) { clearInterval(wsMusicTimer); wsMusicTimer = 0; }
      if (wsMusicOn) {
        let i = 0;
        wsMusicTimer = setInterval(() => { if (wsOpenFlag) wsBeep(WS_NOTES[i++ % WS_NOTES.length], 0.22, 0.02, true); }, 420);
        wsBeep(523, 0.15, 0.03, true);
      }
    }
    function wsOpen() {
      const overlay = document.getElementById('ws-overlay');
      if (!overlay) return;
      try { window.PlatformGame?.pause(); } catch (_) {}
      wsOpenFlag = true; overlay.hidden = false; wsNote('');
      wsRenderNodes(); wsRenderTop(); wsBeep(440, 0.1);
      document.getElementById('ws-close')?.focus({ preventScroll: true });
    }
    function wsClose() {
      const overlay = document.getElementById('ws-overlay');
      if (!overlay || overlay.hidden) return;
      wsOpenFlag = false; overlay.hidden = true;
      if (wsMusicTimer) { clearInterval(wsMusicTimer); wsMusicTimer = 0; }
      wsMusicOn = false;
      document.getElementById('ws-music')?.setAttribute('aria-pressed', 'false');
      document.getElementById('ws-modal').hidden = true;
      try { window.PlatformGame?.refresh?.(); } catch (_) {} // مشهد الانتظار يعكس المعدات الجديدة
    }
    function wsOpenItem(id, sound = true) {
      const item = WORKSHOP_ITEMS.find(x => x.id === id);
      if (!item) return;
      wsActiveItem = item;
      const lvl = wsLevel(id), a = wsAfford(id);
      document.getElementById('ws-card-icon').innerHTML = wsMedal(item.id, item.icon, lvl, a);
      document.getElementById('ws-card-title').textContent = item.name;
      document.getElementById('ws-card-effect').textContent = item.blurb;
      document.getElementById('ws-card-level').textContent = String(lvl);
      document.getElementById('ws-card-now').textContent = `الحالي: ${WS_RULES.effectText(id, lvl)}`;
      document.getElementById('ws-card-next').textContent = a.max ? 'وصلت إلى المستوى الأقصى.' : `التالي: ${WS_RULES.effectText(id, lvl + 1)}`;
      const goldChip = document.getElementById('ws-cost-gold'), oreChip = document.getElementById('ws-cost-ore');
      document.getElementById('ws-card-cost').textContent = a.cost ? fmt(a.cost.gold) : '—';
      goldChip.classList.toggle('lack', Boolean(a.cost) && !a.goldOk);
      oreChip.innerHTML = a.cost ? Object.entries(a.cost.ores).map(([k, n]) => `<i class="ore-dot ore-${k}"></i>${WS_RULES.ORES[k].name} <b>${fmt(Math.floor(Number(state.ores?.[k]) || 0))}/${n}</b>`).join(' ') : '';
      oreChip.classList.toggle('lack', a.lacking.length > 0);
      const btn = document.getElementById('ws-upgrade');
      btn.disabled = a.max || !a.ok || !serverMode;
      btn.textContent = !serverMode ? 'تتطلب الترقية اتصالاً بالخادم' : a.max ? 'المستوى الأقصى'
        : !a.goldOk ? 'الذهب غير كافٍ' : a.lacking.length ? `ينقصك ${a.lacking.map((k) => WS_RULES.ORES[k].name).join(' و')}` : 'ترقية';
      document.getElementById('ws-modal').hidden = false;
      if (sound) wsBeep(560, 0.08);
    }
    function wsUpgrade() {
      if (!wsActiveItem) return;
      const id = wsActiveItem.id, a = wsAfford(id);
      if (!serverMode || a.max || !a.ok) { wsBeep(200, 0.12, 0.04); haptic('error'); return; }
      // عرض فوري بنفس القواعد؛ الخادم يؤكد أو يصحّح عند أول مزامنة (adoptServerState يعيد البناء من حالته)
      applyOpLocally(state, { type: 'buy_equip', key: id });
      enqueueOp({ type: 'buy_equip', key: id });
      haptic('success'); updateUI(); save();
      wsRenderNodes(); wsRenderTop(); wsOpenItem(id, false);
      wsNote(`${wsActiveItem.name}: المستوى ${wsLevel(id)} — بانتظار تأكيد الخادم…`);
      wsBeep(720, 0.14);
    }
    // حكم الخادم على ترقيات المعدات (يُستدعى من مزامنة العمليات)
    function noteEquipResults(results) {
      if (!results.length) return;
      const refused = results.find((r) => r.status === 'rejected');
      const ok = results.filter((r) => r.status === 'ok');
      if (refused) wsNote(refused.reason === 'max' ? 'هذه المعدة في مستواها الأقصى.' : 'رفض الخادم ترقية لا يغطيها رصيدك الحقيقي — صُحّحت الأرصدة.');
      else if (ok.length) { const last = ok[ok.length - 1]; wsNote(`ترقية مؤكدة من الخادم: المستوى ${last.level} — تسري من جولتك القادمة.`); }
      wsRefresh();
    }
    function wsStart() {
      wsClose();
      try { switchTab('play'); switchPlayPanel('adventure'); } catch (_) {}
      const start = document.getElementById('platform-start');
      if (start && !start.disabled) start.click();
    }
    // «إلى المنجم» في تبويب التعدين: ينتقل إلى جولة المنصّات ويبدأها، إلا إن كانت هناك جولة موقوفة فيقرر اللاعب (متابعة أو إعادة)
    function goToMine() {
      try { switchTab('play'); switchPlayPanel('adventure'); } catch (_) {}
      const resume = document.getElementById('platform-resume');
      const start = document.getElementById('platform-start');
      if (resume && !resume.hidden) return;
      if (start && !start.disabled) start.click();
    }
    // ميدالية الورشة في تبويب التعدين: هل تكفي الأرصدة الآن لترقية أي معدة؟ (للعرض فقط — الخادم هو الحكم)
    function workshopHint() {
      try {
        if (!serverMode || !WS_RULES) return null;
        return { ready: WORKSHOP_ITEMS.some((it) => wsAfford(it.id).ok) };
      } catch (_) { return null; }
    }
    // ميدالية الحفر العميق: حلقتها = أفضل عمق ÷ عمق الصندوق (يُحفظ محلياً، لا علاقة له بالخادم)
    function deepDiveHint() {
      try { return window.DeepDigUI && window.DeepDigUI.active ? { progress: window.DeepDigUI.progress(), best: window.DeepDigUI.bestDepth() } : null; } catch (_) { return null; }
    }

    // ============================================================
    // خريطة المناجم: اختيار المنجم المفتوح. الخادم يعيد التحقق من الفتح عند بدء الجولة.
    // ============================================================
    let minesOpenFlag = false, minesOpener = null;
    function minesLabels() {
      const z = window.PlatformGame?.getZone?.() ?? 0, hero = window.PlatformGame?.getHero?.() || 'miner';
      const mine = WS_RULES.MINES[z] || WS_RULES.MINES[0];
      const hits = WS_RULES.hitsToBreak(hero, z, state.equipment);
      document.querySelectorAll('[data-mine-name]').forEach((n) => { n.textContent = mine.name; });
      document.querySelectorAll('[data-mine-hits]').forEach((n) => { n.textContent = `الصخرة: ${hitsWord(hits)}`; });
    }
    // الخطر المميّز لكل عالم (نص عرض فقط؛ الخطر نفسه معرَّف في مستوى المنجم بالقواعد المشتركة)
    const WORLD_DANGER = { stone: 'فتحات بخار وحفرة أشواك', iron: 'مكبس سحق موقوت', gold: 'غبار ذهبي ينفث', crystal: 'بلّورات تنبثق بإيقاعات مختلفة', lava: 'نوافير حمم فوق الفجوات', legend: 'مكبس سحق وحارس القلب' };
    function minesRender() {
      const host = document.getElementById('mines-list');
      if (!host) return;
      const selected = window.PlatformGame?.getZone?.() ?? 0, hero = window.PlatformGame?.getHero?.() || 'miner';
      host.innerHTML = WS_RULES.MINES.map((m, i) => {
        const st = WS_RULES.mineStatus(i, state.mines, state.equipment), zone = WS_RULES.ZONES[i];
        const hits = WS_RULES.hitsToBreak(hero, i, state.equipment);
        const ores = [...new Set(Object.values(m.tier))].map((o) => `<span class="mine-ore"><i class="ore-dot ore-${o}"></i>${WS_RULES.ORES[o].name}</span>`).join('');
        const needs = st.unlocked ? '' : `<ul class="mine-needs">${st.needs.map((n) => `<li class="${n.ok ? 'ok' : 'no'}"><svg class="ui-icon" aria-hidden="true"><use href="#${n.ok ? 'i-check' : 'i-close'}"/></svg>${n.label}</li>`).join('')}</ul>`;
        const label = i === selected ? 'المنجم الحالي' : st.unlocked ? 'اختيار' : 'مقفل';
        const cls = ['mine-card', i === selected ? 'selected' : '', st.unlocked ? '' : 'locked'].filter(Boolean).join(' ');
        return `<article class="${cls}" data-mine-card="${i}" style="--mine-a:${zone.sky[2]};--mine-b:${zone.glow}">
          <div class="mine-card-art" aria-hidden="true"><span>${i + 1}</span></div>
          <div class="mine-card-body">
            <h3>${m.name}</h3><p>${m.blurb}</p>
            <div class="mine-meta"><span>الصخرة: ${hitsWord(hits)}</span><span>انتصارات: <b>${st.wins}</b></span></div>
            <div class="mine-world"><span class="mine-danger"><svg class="ui-icon" aria-hidden="true"><use href="#i-flame"/></svg>${WORLD_DANGER[m.id] || ''}</span>${WS_RULES.levelFor(i).boss ? `<span class="mine-boss"><svg class="ui-icon" aria-hidden="true"><use href="#i-boss"/></svg>زعيم: ${WS_RULES.levelFor(i).boss.name}</span>` : ''}</div>
            <div class="mine-ores">${ores}</div>${needs}
          </div>
          <button type="button" class="mine-pick" data-mine-pick="${i}" ${st.unlocked && i !== selected ? '' : 'disabled'}>${label}</button>
        </article>`;
      }).join('');
    }
