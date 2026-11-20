    // ================= ⚔️ ساحة القتال (محاكاة حتمية يختمها الخادم) =================
    // القواعد والعشوائية كلها في /arena-rules.js المشترك مع الخادم: البذرة ومستوى الخصم من «تذكرة»
    // يصدرها الخادم، ونرسل له حركاتنا فقط؛ هو من يعيد تشغيل المباراة ويقرر الفائز والمكافأة.
    const ARENA = ArenaRules.CONFIG;
    let battle = null;
    let arenaRecord = { wins: 0, losses: 0 };
    try { arenaRecord = { ...arenaRecord, ...JSON.parse(localStorage.getItem('mining_arena_record') || '{}') }; } catch (e) {}
    const saveArenaRecord = () => { try { localStorage.setItem('mining_arena_record', JSON.stringify(arenaRecord)); } catch (e) {} };
    const ARENA_FIGHTERS = [
      { min: 1, icon: '🥷', name: 'مبارز الظلال' },
      { min: 4, icon: '🧔‍♂️', name: 'قاطع الطريق' },
      { min: 8, icon: '🧝‍♂️', name: 'حارس الكهف' },
      { min: 13, icon: '👹', name: 'سيد الساحة' },
    ];
    // ⚡ المبارزة الحيّة: تفتح محرك الحركة نفسه (وضع duel) في تبويب اللعب — قتال أكشن حقيقي
    // بنفس تحكم الكيبورد/اللمس، ونتيجتها تُعاد على الخادم بنفس مسار جولات المنصّات.
    // المبارزة تبدأ بأعمق منجم مفتوح للاعب (إن لم يُحدَّد مستوى) — فيتقدّم سلّم المبارزين مع تقدّم التعدين،
    // والعمق مثبَّت في تذكرة الخادم مثل أي جولة أخرى فلا يمكن تغييره بعد الإصدار.
    function deepestUnlockedMine() {
      const RULES = window.PlatformRules, st = (typeof state !== 'undefined' && state) ? state : {};
      if (!RULES?.mineUnlocked) return 0;
      let deepest = 0;
      for (let z = 0; z < (RULES.MINES?.length || 1); z++) if (RULES.mineUnlocked(z, st.mines, st.equipment)) deepest = z;
      return deepest;
    }
    // سلّم المبارزين: ثلاثة صفوف حقيقية (منجم + خصم + مكافأة + حالة الفتح)،
    // والضغط على صف يغيّر المسرح الحيّ فوقه، ثم زر واحد يبدأ المبارزة في ذلك المنجم.
    let arenaSelectedZone = null;
    const ARENA_TIER_ZONES = () => {
      const last = Math.max(0, (window.PlatformRules?.MINES?.length || 1) - 1);
      return [0, Math.min(2, last), last];
    };
    function renderArenaLadder() {
      const RULES = window.PlatformRules;
      renderArenaGear();
      renderArenaAdvice();
      const box = document.getElementById('arena-ladder');
      if (!box || !RULES?.RIVALS) return;
      const st = (typeof state !== 'undefined' && state) || {};
      const zones = ARENA_TIER_ZONES();
      if (arenaSelectedZone == null) arenaSelectedZone = deepestUnlockedMine();
      if (!zones.includes(arenaSelectedZone)) arenaSelectedZone = zones[0];
      // لا يبقى الاختيار على مبارز مقفل أبدًا: زر البدء يجب أن يبدأ مبارزة حقيقية
      const selStatus = RULES.mineStatus?.(arenaSelectedZone, st.mines, st.equipment);
      if (selStatus && selStatus.unlocked === false) arenaSelectedZone = deepestUnlockedMine();
      box.innerHTML = '';
      zones.forEach((zone, i) => {
        const rival = RULES.rivalFor?.(zone) || RULES.RIVALS[i];
        const mine = RULES.MINES?.[zone];
        const status = RULES.mineStatus?.(zone, st.mines, st.equipment) || { unlocked: true, needs: [] };
        const reward = RULES.duelReward?.(zone);
        const row = document.createElement('button');
        row.type = 'button';
        row.setAttribute('role', 'listitem');
        row.className = `al-row${zone === arenaSelectedZone ? ' active' : ''}${status.unlocked ? '' : ' locked'}`;
        row.dataset.zone = String(zone);
        // الصف المقفل يشرح شرطه ولا يصبح مختارًا: زر البدء يجب أن يبقى يعمل دائمًا
        row.onclick = status.unlocked ? () => pickRival(zone) : () => explainLockedRival(status);
        const blocked = (status.needs || []).filter((n) => !n.ok).map((n) => n.label).join(' · ');
        row.innerHTML = `
          <span class="al-avatar" aria-hidden="true"><svg class="ui-icon"><use href="#i-swords"/></svg></span>
          <span class="al-main">
            <b class="al-name">${rival?.name || 'مبارز'}</b>
            <span class="al-sub">${mine?.name || ''}${blocked ? ` · يُفتح عند: ${blocked}` : ''}</span>
          </span>
          <span class="al-reward">${Number.isFinite(reward) ? `${reward} ذهب` : ''}</span>
          <span class="al-badge ${status.unlocked ? 'ready' : 'locked'}">${status.unlocked ? (zone === arenaSelectedZone ? 'مختار' : 'تحدّ') : 'مقفل'}</span>`;
        box.appendChild(row);
      });
      window.PlatformGame?.showArenaPreview?.(arenaSelectedZone);
      refreshArenaCta();
      if (typeof renderArenaReady === 'function') renderArenaReady();
    }
    // بطاقة العدّة: القيم من Rules.combatGear (نفس ما يحسبه المحرك والخادم) — عرض فقط
    // V11: توصية القتال — تُبنى من combatAdvice في المحرك (نفس أرقام الحفظ) ولا تمنع شيئاً
    function renderArenaAdvice() {
      const box = document.getElementById('arena-advice');
      const RULES = window.PlatformRules, st = (typeof state !== 'undefined' && state) || {};
      if (!box || !RULES?.combatAdvice) return;
      let hero = 'miner';
      try { const h = localStorage.getItem('platform-hero'); if (RULES.CHARACTERS?.[h]) hero = h; } catch (_) {}
      const a = RULES.combatAdvice(hero, st.equipment);
      const p = a.priority;
      box.innerHTML = '<div class="av-head"><b>توصية القتال</b><i>اختيارية — لا تمنع دخول أي منطقة</i></div>' +
        `<div class="av-line"><s>الساحة</s><span>قلوب ${a.arena.hearts} · ضرر ${a.arena.damage} · نَفَس ${a.arena.breath} · مهارة ${a.arena.skillCd} إطار</span></div>` +
        `<div class="av-line"><span class="av-good">▲ ${a.strength}</span></div>` +
        `<div class="av-line"><span class="av-bad">▼ ${a.weakness}</span></div>` +
        (p ? `<div class="av-next">الخطوة القادمة: <b>${p.name} ${p.from}→${p.to}</b> — ${p.why}</div>`
           : '<div class="av-next">معداتك في أقصى ما تفيد به الساحة — الترقية لم تعد شرطاً.</div>') +
        `<div class="av-note">${a.optional}</div>`;
    }
    function renderArenaGear() {
      const box = document.getElementById('arena-gear');
      const RULES = window.PlatformRules, st = (typeof state !== 'undefined' && state) || {};
      if (!box || !RULES?.combatGear) return;
      let hero = 'miner';
      try { const h = localStorage.getItem('platform-hero'); if (RULES.CHARACTERS?.[h]) hero = h; } catch (_) {}
      const rows = RULES.combatGear(hero, st.equipment);
      box.innerHTML = '<div class="ag-head"><b>عدّة القتال</b><span>من حفظك · الخادم هو المرجع</span></div>' +
        rows.map((r) => `<div class="ag-row" data-gear="${r.id}"><i>${r.name}</i><em>${r.level}/${r.max}</em>` +
          `<span>${r.effect}</span><small>${r.detail}</small></div>`).join('');
    }

    // ===== المرحلة B: شاشة الاستعداد =====
    // النموذج يأتي من public/platform-arena-ready.js (قواعد + سجل حقيقي)، وهذا الكود يعرضه فقط.
    // لا رقم مكتوب يدوياً هنا، ولا عملية كتابة: الأزرار تفتح أنظمة قائمة (الورشة/السجل) والبدء يستدعي
    // startArenaDuel نفسها التي كانت تعمل — فلم يتغيّر أي مسار قتال أو مكافأة.
    function arenaReadyRecordLabel(rec) {
      const parts = [`${rec.wins || 0} فوز`, `${rec.losses || 0} خسارة`];
      if (rec.draws) parts.push(`${rec.draws} تعادل`);
      return parts.join(' · ');
    }
    function arenaReadyModel() {
      const RULES = window.PlatformRules;
      const st = (typeof state !== 'undefined' && state) || {};
      if (!RULES || !window.PlatformArenaReady) return null;
      let heroId = 'miner';
      try { const h = localStorage.getItem('platform-hero'); if (RULES.CHARACTERS?.[h]) heroId = h; } catch (_) {}
      const names = (window.PlatformArenaScene?.ARENAS || []).map((a) => a && a.name).filter(Boolean);
      try {
        return window.PlatformArenaReady.build({
          rules: RULES,
          zone: arenaSelectedZone,
          zones: ARENA_TIER_ZONES(),
          heroId,
          heroLevel: (typeof playerLevel === 'function' ? playerLevel() : 1),
          equipment: st.equipment,
          mines: st.mines,
          record: (typeof arenaRecordView === 'function' ? arenaRecordView() : {}) || {},
          arenaNames: names.length ? names : undefined,
        });
      } catch (err) {
        arenaLog('تعذّر تجهيز شاشة الاستعداد — الأرقام تُقرأ من القواعد.');
        return null;
      }
    }
    function renderArenaReady() {
      const box = document.getElementById('arena-ready');
      const m = arenaReadyModel();
      if (!box || !m) return null;
      const txt = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
      box.dataset.zone = String(m.zone);
      txt('ar-arena-name', m.arena.name);
      txt('ar-arena-sub', `الخصم · ${m.rival.name} · المستوى ${m.rival.level}`);
      txt('ar-record', arenaReadyRecordLabel(m.record));
      // مقاتلك
      txt('ar-hero-name', m.hero.name);
      txt('ar-hero-role', m.hero.role);
      txt('ar-hero-level', `مستوى ${m.hero.level}`);
      // نفس الرقم يظهر في HUD القتال (المرحلة C) — مصدر واحد للحقيقة
      txt('cx-lvl-hero', `مستوى ${m.hero.level}`);
      txt('cx-record', `${m.record.wins}–${m.record.losses}`);
      txt('ar-hero-hearts', String(m.hero.hearts));
      txt('ar-hero-dmg', String(m.hero.damage));
      txt('ar-hero-breath', String(m.hero.breath));
      txt('ar-hero-skill', `${m.hero.skill} · ${m.hero.skillCd}ث · مراوغة ${m.hero.dodgeCd}ث`);
      // خصمك
      txt('ar-rival-name', m.rival.name);
      txt('ar-rival-role', m.rival.tag || m.rival.role);
      txt('ar-rival-level', `مستوى ${m.rival.level}`);
      txt('ar-rival-hp', String(m.rival.hp));
      txt('ar-rival-moves', String(m.rival.moves));
      txt('ar-rival-reward', String(m.rival.reward));
      txt('ar-showcase-reward', String(m.rival.reward));
      txt('ar-showcase-wins', String(m.record.wins));
      txt('ar-showcase-losses', String(m.record.losses));
      txt('ar-rival-skill', m.rival.locked && m.rival.needs.length ? `مقفل — يحتاج: ${m.rival.needs.join(' · ')}` : (m.rival.tag || m.rival.role));
      // توازن القوة (مؤشر عرض فقط)
      const fill = document.getElementById('ar-balance-fill');
      if (fill) fill.style.width = `${Math.round(m.balance * 100)}%`;
      // زر البدء
      const cta = document.getElementById('ar-start');
      if (cta) {
        cta.innerHTML = `<span class="ar-cta-ico">⚔️</span> <b class="ar-cta-title">${m.cta.label === 'ابدأ المبارزة' ? 'بدء المعركة' : m.cta.label}</b> <span class="ar-cta-energy">⚡ 10</span>`;
        cta.disabled = m.cta.disabled;
      }
      // شريط الساحات
      const rail = document.getElementById('ar-rail');
      if (rail) {
        rail.innerHTML = m.rail.map((r) => `<button type="button" class="ar-pill" role="tab" data-zone="${r.zone}"` +
          ` aria-selected="${r.selected ? 'true' : 'false'}"${r.locked ? ' disabled aria-disabled="true"' : ''}` +
          ` aria-label="${r.name} — ${r.rival}${r.locked ? ' (مقفل)' : ` — ${r.reward} ذهب`}">` +
          `<b>${r.short || r.name}</b><small>${r.locked ? 'مقفل' : `${r.rival} · ${r.reward} ذهب`}</small></button>`).join('');
        rail.querySelectorAll('button[data-zone]').forEach((btn) => {
          btn.addEventListener('click', () => { if (!btn.disabled) pickRival(Number(btn.dataset.zone)); });
        });
      }
      if (!document.getElementById('ar-log')?.hidden) renderArenaLog(m);
      return m;
    }
    function renderArenaLog(m) {
      const body = document.getElementById('ar-log-body');
      if (!body || !m) return;
      const rate = m.record.winRate == null ? '—' : `${Math.round(m.record.winRate * 100)}%`;
      const rows = [
        ['المباريات', `${m.record.total}`, `${m.record.wins} فوز · ${m.record.losses} خسارة${m.record.draws ? ` · ${m.record.draws} تعادل` : ''}`],
        ['نسبة الفوز', rate, 'من مبارياتك المسجّلة'],
        ['أعلى مكافأة متاحة', `${m.record.best} ذهب`, 'عن فوز واحد في أعلى ساحة مفتوحة'],
      ];
      body.innerHTML = rows.map(([k, v, s]) => `<div class="ar-log-row"><b>${k}</b><span>${v}</span><s>${s}</s></div>`).join('') +
        m.rail.map((r) => `<div class="ar-log-row"><s>${r.name}</s><span>${r.rival}</span><b>${r.locked ? 'مقفل' : `${r.reward} ذهب`}</b></div>`).join('') +
        '<p class="ar-log-note">المكافآت تُحسب وتُعتمد على الخادم عند إنهاء المبارزة — الشاشة تعرض ولا تمنح.</p>';
    }
    function toggleArenaLog(force) {
      const box = document.getElementById('ar-log');
      const btn = document.getElementById('ar-log-btn');
      if (!box) return;
      const open = force == null ? box.hidden : Boolean(force);
      box.hidden = !open;
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { renderArenaLog(arenaReadyModel()); try { haptic('light'); } catch (_) {} }
    }
    // انتقال قصير ثم المبارزة على نظامها القائم. لو تعذّر البدء (لا تذكرة/مبارز مقفل) يعود المسرح كما كان.
    let arenaEntering = false;
    function arenaEnterDuel() {
      const cta = document.getElementById('ar-start');
      if (arenaEntering || (cta && cta.disabled)) { try { haptic('error'); } catch (_) {} return false; }
      if (window.PlatformGame?.duelBusy?.().running) return false;
      arenaEntering = true;
      document.body.classList.add('arena-entering');
      try { haptic('medium'); } catch (_) {}
      setTimeout(() => {
        arenaEntering = false;
        document.body.classList.remove('arena-entering');
        try { startArenaDuel(); } catch (_) {}
      }, 260);
      return true;
    }

    function pickRival(zone) {
      arenaSelectedZone = Number(zone) || 0;
      const live = document.getElementById('arena-live-banner');
      if (live) live.hidden = true;
      renderArenaLadder();
      haptic('light');
    }
    function explainLockedRival(status) {
      const live = document.getElementById('arena-live-banner');
      const text = document.getElementById('arena-live-text');
      if (!live || !text) return;
      const blocked = ((status && status.needs) || []).filter((n) => !n.ok).map((n) => n.label).join(' · ');
      live.hidden = false;
      text.textContent = `هذا المبارز مقفل — يحتاج: ${blocked}. ابدأ بمبارز مفتوح، ويُفتح هذا تلقائيًا عند استيفاء الشرط.`;
      const resumeBtn = document.getElementById('arena-resume-btn');
      const abandonBtn = document.getElementById('arena-abandon-btn');
      if (resumeBtn) resumeBtn.hidden = true;
      if (abandonBtn) abandonBtn.hidden = true;
      haptic('error');
    }
    // زر البدء يعكس الحالة: مقفلة أم جاهزة (لا يبقى زرًا صامتًا)
    function refreshArenaCta() {
      const btn = document.getElementById('arena-duel-btn');
      if (!btn) return;
      const RULES = window.PlatformRules, st = (typeof state !== 'undefined' && state) || {};
      const status = RULES?.mineStatus?.(arenaSelectedZone, st.mines, st.equipment);
      const locked = Boolean(status && status.unlocked === false);
      btn.disabled = locked;
      btn.textContent = locked ? 'مبارز مقفل' : 'ابدأ المبارزة';
      // المرحلة B: زر اللوحة يعكس نفس الحالة (لا نصّان متعارضان)
      const cta = document.getElementById('ar-start');
      if (cta) {
        cta.disabled = locked;
        cta.innerHTML = `<span class="ar-cta-ico">⚔️</span> <b class="ar-cta-title">${locked ? 'مبارز مقفل' : 'بدء المعركة'}</b> <span class="ar-cta-energy">⚡ 10</span>`;
      }
    }

    // حالة زر المبارزة: إن كانت هناك جولة جارية تُعرض أزرار فعلية بدل رسالة صامتة
    function refreshArenaDuelState() {
      const live = document.getElementById('arena-live-banner');
      if (!live) return;
      const text = document.getElementById('arena-live-text');
      const resumeBtn = document.getElementById('arena-resume-btn');
      const abandonBtn = document.getElementById('arena-abandon-btn');
      // مبارزة الساحة لها حالتها المستقلة: لا نلمس بانرها أثناء جريانها
      if (window.PlatformGame?.duelBusy?.().running) return;
      const busy = window.PlatformGame?.busy?.() || {};
      const hideAll = () => { live.hidden = true; if (resumeBtn) resumeBtn.hidden = true; if (abandonBtn) abandonBtn.hidden = true; };
      if (!busy.running && !busy.pending) { hideAll(); return; }
      live.hidden = false;
      if (busy.pending) {
        // نتيجة لم تُختم على الخادم بعد: لا تُهمل أبدًا
        if (text) text.textContent = 'نتيجتك السابقة لم تُختم على الخادم بعد. أعد إرسالها من تبويب «اللعب» قبل مبارزة جديدة.';
        if (resumeBtn) { resumeBtn.hidden = false; resumeBtn.textContent = 'افتح تبويب اللعب'; }
        if (abandonBtn) abandonBtn.hidden = true;
      } else {
        // جولة المنجم وحالة الساحة مستقلتان: وجود جولة منجم لا يمنع المبارزة ولا يطلب مغادرة التبويب
        if (text) text.textContent = 'جولة منجمك محفوظة كما هي، وستُستأنف عند عودتك إلى تبويب «اللعب». يمكنك المبارزة الآن.';
        if (resumeBtn) resumeBtn.hidden = true;
        if (abandonBtn) abandonBtn.hidden = true;
      }
    }

    // لقطة مرجعية للمراجعة البصرية: تُثبّت المسرح عند لحظة الزعيم/الموجة بلا خادم وبلا نتيجة
    function arenaShot(kind) {
      const game = window.PlatformGame;
      if (!game?.arenaSnapshot) { arenaLog('المسرح غير جاهز بعد.'); return; }
      if (game.duelBusy?.().running) { arenaLog('أنهِ المبارزة أولًا، ثم اطلب اللقطة.'); return; }
      const ok = game.arenaSnapshot(kind);
      arenaLog(ok ? 'لقطة مجمّدة — اضغط الزر نفسه للعودة إلى المسرح.' : 'تعذّر تجهيز اللقطة، أعد المحاولة.');
    }
    // V14: شاشة كاملة حقيقية (تُخفي شريط المتصفح) فوق تخطيط «الشاشة كاملة» في CSS.
    // كل شيء داخل try: بعض نسخ تيليجرام ترفض الطلب بلا إيماءة مستخدم، ولا يجوز أن يُعطّل ذلك المبارزة.
    function arenaFullscreen(on) {
      try {
        const tg = window.Telegram && window.Telegram.WebApp;
        if (on) {
          tg?.expand?.();
          if (typeof tg?.requestFullscreen === 'function') { tg.requestFullscreen(); return; }
          const root = document.documentElement;
          if (root?.requestFullscreen && !document.fullscreenElement) {
            const p = root.requestFullscreen({ navigationUI: 'hide' });
            if (p && p.catch) p.catch(() => {});
          }
        } else {
          if (typeof tg?.exitFullscreen === 'function') tg.exitFullscreen();
          if (document.fullscreenElement && document.exitFullscreen) {
            const p = document.exitFullscreen();
            if (p && p.catch) p.catch(() => {});
          }
        }
      } catch (_) {}
    }
    // V17: «التبويبات» تُعيد الهيدر وشريط التنقّل، و«المزيد» تُعيد اللوحات تحت المسرح
    document.getElementById('arena-tabs-btn')?.addEventListener('click', () => {
      document.body.classList.remove('arena-live', 'arena-more');
      document.getElementById('arena-more-btn')?.setAttribute('aria-pressed', 'false');
      document.getElementById('nav-arena')?.focus?.();
      try { haptic('light'); } catch (_) {}
    });
    // المرحلة B: أزرار شاشة الاستعداد تفتح الأنظمة القائمة نفسها (لا أزرار شكلية)
    document.getElementById('ar-start')?.addEventListener('click', () => { arenaEnterDuel(); });
    document.getElementById('ar-gear-btn')?.addEventListener('click', () => {
      try { haptic('light'); } catch (_) {}
      if (typeof window.openWorkshop === 'function') window.openWorkshop();
      else arenaLog('الورشة غير متاحة الآن.');
    });
    document.getElementById('ar-log-btn')?.addEventListener('click', () => toggleArenaLog());
    document.getElementById('ar-log-close')?.addEventListener('click', () => toggleArenaLog(false));
    // بعد كل مبارزة يتغيّر السجل فتُحدَّث البطاقات فوراً
    window.addEventListener('platform-duel-done', () => {
      toggleArenaLog(false);
      arenaPausePanel(false);
      arenaPauseLabel();
      if (typeof renderArenaLadder === 'function') renderArenaLadder();
      else if (typeof renderArenaReady === 'function') renderArenaReady();
    });
    document.getElementById('arena-more-btn')?.addEventListener('click', (e) => {
      const on = document.body.classList.toggle('arena-more');
      e.currentTarget.setAttribute('aria-pressed', on ? 'true' : 'false');
      try { haptic('light'); } catch (_) {}
    });

    function arenaPauseLabel() {
      const btn = document.getElementById('arena-fs-pause');
      if (!btn) return;
      const busy = window.PlatformGame?.duelBusy?.();
      btn.textContent = busy?.paused ? 'متابعة' : 'إيقاف';
    }
    // المرحلة C: لوحة الإيقاف المؤقت — تظهر عند الإيقاف فقط، وأرقامها من الحالة نفسها
    function arenaPausePanel(show) {
      const box = document.getElementById('cx-pause');
      if (!box) return;
      if (show) {
        const b = window.PlatformGame?.duelBusy?.() || {};
        const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
        set('cx-pause-time', b.timeLeft == null ? '—' : `${b.timeLeft} ث`);
        set('cx-pause-hearts', b.hearts == null ? '—' : `${b.hearts}/${b.maxHearts}`);
        set('cx-pause-rival', b.rivalHp == null ? '—' : `${Math.round(b.rivalHp)}/${Math.round(b.rivalMaxHp || b.rivalHp)}`);
      }
      box.hidden = !show;
    }
    (() => {
      document.getElementById('arena-fs-pause')?.addEventListener('click', () => {
        const game = window.PlatformGame;
        const busy = game?.duelBusy?.();
        if (!busy?.running) return;
        if (busy.paused) game.resumeDuel?.(); else game.pauseDuel?.();
        arenaPauseLabel();
        arenaPausePanel(Boolean(game.duelBusy?.().paused));
      });
      document.getElementById('arena-fs-exit')?.addEventListener('click', () => {
        const game = window.PlatformGame;
        if (!game?.duelAbandon?.()) return;
        arenaPausePanel(false);
        arenaFullscreen(false);
        arenaLog('انسحبت من المبارزة — لا فوز ولا خسارة.');
      });
      // لوحة الإيقاف المؤقت: المتابعة تستأنف نفس المحاكاة، والانسحاب يمرّ بنفس دالة الإنهاء
      document.getElementById('cx-resume')?.addEventListener('click', () => {
        const game = window.PlatformGame;
        if (!game?.duelBusy?.().running) { arenaPausePanel(false); return; }
        game.resumeDuel?.();
        arenaPauseLabel(); arenaPausePanel(false);
        try { haptic('light'); } catch (_) {}
      });
      document.getElementById('cx-exit')?.addEventListener('click', () => {
        const game = window.PlatformGame;
        const done = game?.duelAbandon?.();
        arenaPausePanel(false);
        if (!done) return;
        arenaFullscreen(false);
        arenaLog('انسحبت من المبارزة — لا فوز ولا خسارة.');
      });
    })();

    function startArenaDuel(zone = null) {
      const game = window.PlatformGame;
      const live = document.getElementById('arena-live-banner');
      if (!game?.startDuel) {
        if (live) { live.hidden = false; const t = document.getElementById('arena-live-text'); if (t) t.textContent = 'حدّث الصفحة (إعادة تحميل) لتفعيل المبارزة الحيّة.'; }
        return;
      }
      const tier = Number.isInteger(zone) ? zone : (arenaSelectedZone ?? deepestUnlockedMine());
      // مبارز مقفل: نوضّح الشرط على الساحة نفسها بدل إرسال طلب سيرفضه الخادم
      const RULES = window.PlatformRules, st = (typeof state !== 'undefined' && state) || {};
      const status = RULES?.mineStatus?.(tier, st.mines, st.equipment);
      if (status && status.unlocked === false) {
        const blocked = (status.needs || []).filter((n) => !n.ok).map((n) => n.label).join(' · ');
        if (live) { live.hidden = false; const t = document.getElementById('arena-live-text'); if (t) t.textContent = `هذا المبارز مقفل — يحتاج: ${blocked}`; }
        return;
      }
      // المبارزة تجري هنا في تبويب الساحة نفسه — لا تنقّل إلى تبويب اللعب
      if (!game.startDuel(tier)) { refreshArenaDuelState(); return; }
      if (live) live.hidden = true;
      document.body.classList.add('duel-live');
      arenaFullscreen(true);
      arenaPauseLabel();
      const pad = document.getElementById('arena-pad'); if (pad) pad.hidden = false;
      const btn = document.getElementById('arena-duel-btn'); if (btn) btn.disabled = true;
      const stage = document.getElementById('arena-preview'); stage?.focus?.({ preventScroll: true });
      // المبارزة تُلعب هنا في تبويب الساحة: لا تبديل تبويب، ولا لمس لمشهد تبويب اللعب.
      haptic('success');
    }

    // زر يخصّ حالة واحدة فقط: نتيجة منجم لم تُختم على الخادم بعد (زر إعادة الإرسال هناك)
    function resumeActiveRun() {
      switchTab('play');
      window.PlatformGame?.resumeRun?.();
    }

    // «تخلَّ عنها وابدأ المبارزة»: الجولة غير المنتهية بلا مكافأة أصلاً، فالتخلّي لا يخصم شيئًا
    function abandonAndDuel() {
      const game = window.PlatformGame;
      if (!game?.abandon || !game.abandon()) { refreshArenaDuelState(); return; }
      startArenaDuel();
    }

    // نهاية المبارزة: نُعيد الزر والسلّم ونفتح مبارزة أخرى
    window.addEventListener('platform-duel-done', () => {
      document.body.classList.remove('duel-live');
      arenaFullscreen(false);
      const pad = document.getElementById('arena-pad'); if (pad) pad.hidden = true;
      const btn = document.getElementById('arena-duel-btn'); if (btn) btn.disabled = false;
      const ladder = document.getElementById('arena-ladder'); if (ladder) ladder.hidden = false;
      window.PlatformGame?.showArenaPreview?.(arenaSelectedZone ?? deepestUnlockedMine());
      refreshArenaDuelState();
    });

    function arenaEnemyFighter(level = 1) {
      return ARENA_FIGHTERS.reduce((chosen, fighter) => level >= fighter.min ? fighter : chosen, ARENA_FIGHTERS[0]);
    }

    const arenaPosition = { player: 76, enemy: 24 };
    let arenaMoveTimer = 0;
    const arenaDistance = () => Math.abs(arenaPosition.player - arenaPosition.enemy);
    const arenaInSwordRange = () => arenaDistance() <= 38;
    function renderArenaPositions() {
      for (const actor of ['player', 'enemy']) {
        const fighter = document.getElementById(`arena-${actor}-fighter`);
        if (fighter?.style?.setProperty) fighter.style.setProperty('--fighter-x', arenaPosition[actor]);
        else if (fighter?.style) fighter.style['--fighter-x'] = arenaPosition[actor];
      }
      const distance = document.getElementById('arena-distance');
      if (distance) {
        distance.textContent = arenaInSwordRange() ? '⚔️ ضمن مدى السيف' : '↔️ اقترب للهجوم';
        distance.className = `text-[10px] font-bold min-w-20 text-center ${arenaInSwordRange() ? 'text-emerald-400' : 'text-amber-400'}`;
      }
    }
    function moveArenaPlayer(direction) {
      if (!battle?.active || battle.busy) return;
      const min = arenaPosition.enemy + 24;
      arenaPosition.player = Math.max(min, Math.min(88, arenaPosition.player + direction * 3));
      renderArenaPositions();
      updateArenaUI();
    }
    function startArenaMove(direction) {
      stopArenaMove();
      moveArenaPlayer(direction);
      arenaMoveTimer = setInterval(() => moveArenaPlayer(direction), 85);
    }
    function stopArenaMove() {
      if (arenaMoveTimer) clearInterval(arenaMoveTimer);
      arenaMoveTimer = 0;
    }
    window.addEventListener('pointerup', stopArenaMove);
    window.addEventListener('blur', stopArenaMove);
    window.addEventListener('keydown', (event) => {
      if (!document.getElementById('tab-arena')?.classList.contains('active') || event.repeat) return;
      if (/INPUT|TEXTAREA|SELECT/.test(event.target?.tagName || '')) return; // لا تختطف الكتابة
      const arenaKeys = { '1': 'ATTACK', '2': 'DEFEND', '3': 'HEAL', '4': 'WAIT', '١': 'ATTACK', '٢': 'DEFEND', '٣': 'HEAL', '٤': 'WAIT' };
      if (event.key === 'ArrowLeft') { event.preventDefault?.(); moveArenaPlayer(-1); }
      else if (event.key === 'ArrowRight') { event.preventDefault?.(); moveArenaPlayer(1); }
      else if (arenaKeys[event.key]) { event.preventDefault?.(); arenaAction(arenaKeys[event.key]); }
      else if (event.key === 'Enter' && !battle?.active) { event.preventDefault?.(); startBattle(); }
    });

    // 👁️ بطاقة نيّة الخصم: خطة الدور الحالية كما أعلنها المحرك (حقيقية 100%، لا تخمين)
    const ARENA_INTENTS = {
      ATTACK: { icon: '⚔️', label: 'الخصم يهجم', hint: 'دفاعك الآن ينصّف الضرر', tone: 'attack' },
      DEFEND: { icon: '🛡️', label: 'الخصم يتحصّن', hint: 'ضربتك القادمة تنصّف', tone: 'defend' },
      HEAL: { icon: '💚', label: 'الخصم يعالج', hint: 'اضربه قبل أن يستعيد صحته', tone: 'heal' },
      WAIT: { icon: '⚡', label: 'الخصم يشحن', hint: 'لحظة مناسبة للهجوم', tone: 'wait' },
    };
    function renderArenaIntent() {
      const chip = document.getElementById('arena-intent');
      const enemyFighter = document.getElementById('arena-enemy-fighter');
      if (!chip) return;
      const intent = battle?.active && !battle.busy ? ArenaRules.enemyIntent(battle) : null;
      const meta = intent ? ARENA_INTENTS[intent] : null;
      if (!meta) {
        chip.hidden = true;
        chip.textContent = '';
        chip.className = 'arena-intent';
        enemyFighter?.classList.remove('arena-windup');
        return;
      }
      chip.hidden = false;
      chip.className = `arena-intent tone-${meta.tone}${intent === 'ATTACK' && battle.player.hp <= 35 ? ' danger' : ''}`;
      chip.innerHTML = `<b>${meta.icon} ${meta.label}</b><i>${meta.hint}</i>`;
      enemyFighter?.classList.toggle('arena-windup', intent === 'ATTACK');
    }

    // الحالة المرئية للتبويب: قبل المباراة نعرض زر بدء واحدًا واضحًا، وأثناءها نعرض التحكم فقط
    function syncArenaMode() {
      const tab = document.getElementById('tab-arena');
      if (!tab) return;
      const fighting = Boolean(battle?.active);
      tab.classList.toggle('arena-fighting', fighting);
      tab.classList.toggle('arena-idle', !fighting);
    }

    // حكم النهاية: بطاقة فوق المسرح (نتيجة + مكافأة + إعادة فورية) بلا حاجة إلى تمرير
    function showArenaVerdict(outcome, sub) {
      const box = document.getElementById('arena-verdict');
      if (!box) return;
      const meta = outcome === 'win' ? { badge: '🏆', title: 'انتصار!' } :
        outcome === 'loss' ? { badge: '💀', title: 'هُزمت' } : { badge: '🤝', title: 'تعادل' };
      document.getElementById('arena-verdict-badge').textContent = meta.badge;
      document.getElementById('arena-verdict-title').textContent = meta.title;
      document.getElementById('arena-verdict-sub').textContent = sub;
      box.className = `arena-verdict ${outcome}`;
      box.hidden = false;
    }
    function hideArenaVerdict() {
      const box = document.getElementById('arena-verdict');
      if (box) { box.hidden = true; box.className = 'arena-verdict'; }
    }

    function showArenaBanner(text, kind = '') {
      const banner = document.getElementById('arena-stage-banner');
      if (!banner) return;
      banner.textContent = text;
      banner.className = `arena-stage-banner${kind ? ` ${kind}` : ''}`;
      void banner.offsetWidth;
      banner.classList.add('show');
    }

    function animateArenaFighter(actor, action, event = {}) {
      const fighter = document.getElementById(`arena-${actor}-fighter`);
      const targetActor = actor === 'player' ? 'enemy' : 'player';
      const target = document.getElementById(`arena-${targetActor}-fighter`);
      const stage = document.getElementById('arena-battle-stage');
      if (!fighter) return;
      const motionClasses = ['arena-attack', 'arena-defend', 'arena-heal', 'arena-wait', 'arena-hit'];
      motionClasses.forEach((name) => fighter.classList.remove(name));
      void fighter.offsetWidth; // يعيد تشغيل الحركة إذا كرر اللاعب الفعل نفسه
      const motion = action === 'ATTACK' ? 'arena-attack' : `arena-${action.toLowerCase()}`;
      fighter.classList.add(motion);

      const popupActor = action === 'ATTACK' ? targetActor : actor;
      const popup = document.getElementById(`arena-damage-${popupActor}`);
      if (popup) {
        popup.classList.remove('show', 'heal');
        popup.classList.toggle('crit', action === 'ATTACK' && Number(event.dmg) >= 14);
        popup.textContent = action === 'ATTACK' ? `−${event.dmg || 0}`
          : action === 'HEAL' ? `+${event.healed || 0} ❤️`
          : action === 'DEFEND' ? '🛡️ دفاع' : '+3 ⚡';
        popup.classList.toggle('heal', action !== 'ATTACK');
        void popup.offsetWidth;
        popup.classList.add('show');
      }

      if (action === 'ATTACK' && target) {
        setTimeout(() => {
          target.classList.remove('arena-hit');
          void target.offsetWidth;
          target.classList.add('arena-hit');
          stage?.classList.remove('arena-stage-shake');
          void stage?.offsetWidth;
          stage?.classList.add('arena-stage-shake');
        }, 230);
      }
      setTimeout(() => {
        fighter.classList.remove(motion);
        target?.classList.remove('arena-hit');
        stage?.classList.remove('arena-stage-shake');
        popup?.classList.remove('show');
      }, 900);
    }

    function arenaLog(msg) {
      const el = document.getElementById('arena-log');
      const line = document.createElement('div');
      line.textContent = msg;
      el.prepend(line);
      while (el.children.length > 4) el.lastChild.remove();
    }

    function playerLevel() { return (serverMode && profile?.progress?.level) || Math.floor(state.totalEarned / 5000) + 1; }

    // تذكرة المباراة التالية من الخادم — غير متاحة ما دامت مباراة سابقة بانتظار ختمه
    function arenaTicket() {
      const t = profile?.arena?.ticket;
      if (!serverMode || !t || !Number.isFinite(t.matchNo)) return null;
      if (SYNC.pending.some((op) => op.type === 'arena' && op.matchNo === t.matchNo)) return null;
      return t;
    }
    // سجل الساحة: من ختم الخادم في الوضع السحابي، ومحلي بدونه
    function arenaRecordView() { return (serverMode && profile?.arena?.record) || arenaRecord; }

    function startBattle() {
      // زر البدء لا يعيد المباراة وهي جارية؛ يجب إكمال القتال الحالي أولاً.
      if (battle?.active) return;
      const ticket = arenaTicket();
      const practice = serverMode && !ticket; // لا تذكرة بعد: مباراة تدريبية بلا مكافأة بدل تعطيل الزر
      const lvl = ticket ? ticket.level : playerLevel();
      const seed = ticket ? ticket.seed : (Math.random() * 4294967296) >>> 0;
      battle = ArenaRules.newBattle({ level: lvl, seed });
      battle.busy = false; battle.ticket = ticket; battle.practice = practice;
      stopArenaMove();
      arenaPosition.player = 76;
      arenaPosition.enemy = 24;
      renderArenaPositions();
      document.getElementById('arena-log').innerHTML = '';
      document.querySelectorAll('.arena-fighter').forEach((fighter) => fighter.classList.remove('arena-defeated', 'arena-windup'));
      hideArenaVerdict();
      const rival = arenaEnemyFighter(lvl);
      arenaLog(`⚔️ بدأت مباراة ضد ${rival.name} (مستوى ${lvl}) — صحته ${battle.enemy.maxHp}`);
      if (practice) { arenaLog('🧪 مباراة تدريبية بلا مكافأة — بانتظار ختم الخادم للمباراة السابقة'); flushOps(); }
      arenaLog('اختصار سريع: ١ اضرب · ٢ دفاع · ٣ علاج · ٤ انتظار · الأسهم للحركة');
      arenaLog('اختر حركتك الأولى!');
      showArenaBanner('⚔️ استعد للقتال!');
      haptic('success');
      updateArenaUI();
    }

    function updateArenaUI() {
      const p = battle?.player || { hp: ARENA.maxHp, energy: ARENA.maxEnergy, defending: false };
      const e = battle?.enemy || { hp: 100, maxHp: 100, energy: ARENA.maxEnergy, defending: false, level: 1 };
      const set = (id, v) => { const el = document.getElementById(id); if (el) el.style.width = `${Math.max(0, v)}%`; };
      const txt = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
      const rec = arenaRecordView();
      set('arena-player-hp', p.hp / ARENA.maxHp * 100);
      set('arena-player-energy', p.energy / ARENA.maxEnergy * 100);
      set('arena-enemy-hp', e.hp / e.maxHp * 100);
      set('arena-enemy-energy', e.energy / ARENA.maxEnergy * 100);
      txt('arena-player-hp-text', `${Math.max(0, Math.ceil(p.hp))}/${ARENA.maxHp}`);
      txt('arena-player-energy-text', `${p.energy}/${ARENA.maxEnergy}`);
      txt('arena-enemy-hp-text', `${Math.max(0, Math.ceil(e.hp))}/${e.maxHp}`);
      txt('arena-enemy-energy-text', `${e.energy}/${ARENA.maxEnergy}`);
      const rival = arenaEnemyFighter(e.level);
      txt('arena-enemy-name', `${rival.name} · مستوى ${e.level}`);
      document.getElementById('arena-player-fighter')?.classList.toggle('arena-defeated', p.hp <= 0);
      document.getElementById('arena-enemy-fighter')?.classList.toggle('arena-defeated', e.hp <= 0);
      txt('arena-player-status', p.defending ? '🛡️ دفاع مفعّل' : '');
      txt('arena-enemy-status', e.defending ? '🛡️ دفاع مفعّل' : '');
      txt('arena-record', `${rec.wins || 0} فوز · ${rec.losses || 0} خسارة${rec.draws ? ` · ${rec.draws} تعادل` : ''}`);
      if (typeof renderArenaLadder === 'function') renderArenaLadder();
      txt('arena-turn', !battle?.active
        ? (battle ? 'انتهت المباراة — اضغط «مباراة جديدة»' : 'اضغط «ابدأ المبارزة» ثم اقرأ نيّة الخصم')
        : battle.busy ? '⏳ الخصم ينفّذ خطته…'
        : arenaInSwordRange() ? `🎯 جولتك ${battle.round} — اختر حركة` : `🎮 جولة ${battle.round} — اقترب لتصل ضربتك`);
      const startBtn = document.getElementById('arena-start-btn');
      startBtn.disabled = Boolean(battle?.active);
      startBtn.innerText = battle?.active ? '⚔️ المعركة جارية' : battle ? '🔄 مباراة جديدة' : '🚀 ابدأ المبارزة';
      const canControl = Boolean(battle?.active && !battle.busy);
      document.getElementById('arena-move-left').disabled = !canControl || arenaPosition.player <= arenaPosition.enemy + 24;
      document.getElementById('arena-move-right').disabled = !canControl || arenaPosition.player >= 88;
      for (const [key, action] of [['attack', 'ATTACK'], ['defend', 'DEFEND'], ['heal', 'HEAL'], ['wait', 'WAIT']]) {
        const btn = document.getElementById(`arena-btn-${key}`);
        btn.disabled = !canControl || (action === 'ATTACK' && !arenaInSwordRange()) || !ArenaRules.canAct(battle.player, action);
      }
      // نبض الشاشة عند انخفاض الصحة: تلميح بصري بدل مفاجأة الهزيمة
      document.getElementById('arena-player-hp')?.classList.toggle('arena-hp-low', p.hp > 0 && p.hp <= ARENA.maxHp * 0.3);
      document.getElementById('arena-enemy-hp')?.classList.toggle('arena-hp-low', e.hp > 0 && e.hp <= e.maxHp * 0.3);
      renderArenaPositions();
      syncArenaMode();
      renderArenaIntent();
    }

    // وصف نصي لحدث من المحرك
    function describeMove(ev, actorName) {
      switch (ev.action) {
        case 'ATTACK': return `⚔️ ${actorName} هاجم وأصاب بـ ${ev.dmg} ضرر`;
        case 'DEFEND': return `🛡️ ${actorName} تدرّع (الضرر القادم −50%)`;
        case 'HEAL': return `💚 ${actorName} عالج نفسه +${ev.healed}`;
        default: return `⏳ ${actorName} انتظر وشحن +3 طاقة`;
      }
    }

    function arenaAction(action) {
      if (!battle?.active || battle.busy) return;
      if (action === 'ATTACK' && !arenaInSwordRange()) {
        showArenaBanner('◀️ اقترب من الخصم أولاً');
        haptic('error');
        return;
      }
      stopArenaMove();
      const ev = ArenaRules.playerMove(battle, action);
      if (ev.error) { haptic('error'); return; }
      animateArenaFighter('player', action, ev);
      const positionBattle = battle;
      if (action === 'ATTACK') setTimeout(() => {
        if (battle !== positionBattle) return;
        arenaPosition.enemy = Math.max(12, arenaPosition.enemy - 3);
        renderArenaPositions();
      }, 520);
      arenaLog(describeMove(ev, 'أنت'));
      haptic(action === 'ATTACK' ? 'light' : 'success');
      if (checkBattleEnd()) return;
      battle.busy = true;
      updateArenaUI();
      const current = battle; // إعادة البدء أثناء دور الروبوت لا يجب أن تُدخل حركة في المباراة الجديدة
      setTimeout(() => {
        if (battle !== current || !current.active) return;
        const enemyEvent = ArenaRules.enemyMove(current);
        animateArenaFighter('enemy', enemyEvent.action, enemyEvent);
        if (enemyEvent.action === 'ATTACK') setTimeout(() => {
          if (battle !== current) return;
          arenaPosition.player = Math.min(88, arenaPosition.player + 4);
          renderArenaPositions();
        }, 520);
        arenaLog(describeMove(enemyEvent, arenaEnemyFighter(current.enemy.level).name));
        haptic('light');
        if (checkBattleEnd()) return;
        // بداية جولة جديدة: تجدد طاقة +2 للطرفين، أو حسم بنسبة الصحة بعد آخر جولة
        const next = ArenaRules.nextRound(current);
        if (next?.judged) {
          if (next.draw) arenaLog('🤝 انتهت الجولات بتعادل — لا فائز ولا مكافأة');
          else arenaLog(`⏱️ انتهت ${ARENA.maxRounds} جولة — الحسم بنسبة الصحة (${Math.round(next.pRatio * 100)}٪ مقابل ${Math.round(next.eRatio * 100)}٪)`);
          checkBattleEnd();
          return;
        }
        current.busy = false;
        updateArenaUI();
      }, ARENA.enemyDelayMs);
      updateArenaUI();
    }

    function checkBattleEnd() {
      if (!battle) return true;
      if (battle.active) return false;
      battle.busy = false;
      const won = battle.outcome === 'win';
      const sealed = Boolean(serverMode && battle.ticket); // مباراة بتذكرة: الخادم هو من يعتمد النتيجة
      if (battle.outcome === 'draw') {
        showArenaBanner('🤝 تعادل!');
        showArenaVerdict('draw', 'انتهت 30 جولة بلا فاصل — جرّب ضغطًا أسرع');
        haptic('error');
      } else if (won) {
        if (sealed || !serverMode) { state.gold += ARENA.winReward; state.totalEarned += ARENA.winReward; }
        arenaLog(battle.practice ? '🏆 انتصرت في مباراة تدريبية — بلا مكافأة' : sealed ? `🏆 انتصرت! +${ARENA.winReward} 🪙 بعد اعتماد الخادم` : `🏆 انتصرت! حصلت على +${ARENA.winReward} 🪙`);
        showArenaBanner('🏆 انتصار!');
        showArenaVerdict('win', battle.practice ? 'مباراة تدريبية — بلا مكافأة'
          : sealed ? `+${ARENA.winReward} 🪙 بعد اعتماد الخادم · ${battle.round} جولة`
          : `+${ARENA.winReward} 🪙 · ${battle.round} جولة`);
        haptic('success');
      } else {
        arenaLog('💀 هُزمت… جرّب خطة مختلفة: عالِج مبكراً ولا تهاجم بلا طاقة احتياطية');
        showArenaBanner('💀 هزيمة', 'loss');
        showArenaVerdict('loss', 'اقرأ النيّة: دافع عند الهجوم وعالج قبل النفاد');
        haptic('error');
      }
      if (sealed) {
        // تفاؤلياً نعدّ النتيجة في السجل؛ رد الخادم يستبدله بسجله المختوم (أو يصحح الذهب إن رفض المباراة)
        const rec = profile.arena.record = profile.arena.record || { wins: 0, losses: 0, draws: 0 };
        rec[won ? 'wins' : battle.outcome === 'draw' ? 'draws' : 'losses'] += 1;
        enqueueOp({ type: 'arena', matchNo: battle.ticket.matchNo, moves: battle.moves.slice(), expected: won ? ARENA.winReward : 0 });
      } else if (!serverMode && battle.outcome !== 'draw') {
        arenaRecord[won ? 'wins' : 'losses'] += 1;
        saveArenaRecord();
      }
      updateUI();
      save();
      updateArenaUI();
      return true;
    }

    // أحكام الخادم على مباريات أُرسلت: رفض (حركات لا تطابق المحاكاة) أو فوز متسارع بلا مكافأة
    function noteArenaVerdicts(verdicts) {
      for (const v of verdicts) {
        if (v.status === 'rejected') arenaLog(v.reason === 'stale_match' ? '🛡️ مباراة بتذكرة منتهية — ابدأ مباراة جديدة' : `🛡️ لم يعتمد الخادم المباراة #${v.matchNo} (${v.reason || 'غير مطابقة'})`);
        else if (v.status === 'too_soon') arenaLog(`⏱️ الفوز #${v.matchNo} سُجّل بلا مكافأة — انتظر ${Math.max(1, Math.ceil(((v.retryAt || 0) - Date.now()) / 1000))} ث بين فوزين`);
        else if (v.status === 'ok' && v.outcome === 'win' && v.gold) arenaLog(`✅ اعتمد الخادم فوزك #${v.matchNo}: +${v.gold} 🪙${v.xp ? ` +${v.xp} خبرة` : ''}`);
      }
    }
