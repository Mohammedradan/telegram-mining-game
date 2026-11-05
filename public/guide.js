/* المرشد «العم سراج» — حارس المصباح: يخبر اللاعب ماذا يفعل الآن (الهدف التالي)، ويحمل موسوعة الخامات والمناجم والمعدات،
   ويروي حكاية المناجم فصلاً فصلاً حين يُفتح كل منجم. عرض فقط: يقرأ حالة اللاعب (state.equipment / state.mines / state.ores / state.gold)
   وقواعد المنصّة المشتركة، ولا يكتب ذهباً ولا خامات ولا عمليات ولا يطلب شيئاً من الخادم. الوحيد الذي يحفظه جهاز اللاعب نفسه
   هو أي الفصول قرأها (localStorage، المفتاح mining-guide).
   النموذج (الدوال الصافية: nextGoal / codex / chapter*) يُختبر في Node بلا DOM؛ الواجهة تُبنى في المتصفح فقط.
   كل معالج حدث محصَّن (safe): تعطل هذا الملف لا يجوز أن يوقف اللعب أو الحفظ في بقية التطبيق. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.Guide = factory(root);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const R = root.PlatformRules || (typeof require === 'function' ? require('./platform-rules.js') : null);
  const api = { active: false };

  const CFG = Object.freeze({
    KEY: 'mining-guide',
    NAME: 'العم سراج',
    ROLE: 'حارس المصباح',
    PORTRAIT: '/assets/cave/guide/siraj.webp?v=1',
    LABEL: 'المرشد',
    LABEL_NEW: 'فصل جديد',
    ARIA: 'المرشد العم سراج: الهدف والموسوعة والحكاية',
    STORE_VERSION: 1,
  });

  const num = (n, d = 0) => { const v = Number(n); return Number.isFinite(v) ? v : d; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Math.max(0, Math.floor(num(n))).toLocaleString('en-US');

  // الخطر المميّز لكل عالم (نص عرض فقط؛ الخطر نفسه معرَّف في مستوى المنجم بالقواعد المشتركة، وخريطة المناجم تعرض النص نفسه)
  const DANGER = Object.freeze({
    stone: 'فتحات بخار وحفرة أشواك', iron: 'مكبس سحق موقوت', gold: 'غبار ذهبي ينفث',
    crystal: 'بلّورات تنبثق بإيقاعات مختلفة', lava: 'نوافير حمم فوق الفجوات', legend: 'مكبس سحق وحارس القلب',
  });

  // ================= الحكاية: فصل لكل منجم + خاتمة =================
  // زوايا الحكاية: مصباح علّقه العم سراج عند باب المنجم، وحجر في القلب يضيء كل المصابيح. النصائح تطابق ما يفعله المحرك فعلاً
  // (إنذار المكبس، إيقاعا البلّور، موجة العملاق، اندفاع الحارس)، فالحكاية تعلّم اللعب لا تزيّنه فقط.
  const CHAPTERS = Object.freeze([
    { id: 0, zone: 0, title: 'المصباح الأول',
      body: ['على باب هذا المنجم علّقتُ مصباحي قبل أن تولد. يقولون إن في أعمق نقطة منه «قلب الأسطورة»، حجراً يضيء كل مصابيح الدنيا، ومن يصل إليه لا يعود كما كان.',
        'ابدأ من هنا يا بطل: بلّورات تجمعها، وصخرة تكسرها، وبوابة تعبرها.'],
      tip: 'اجمع 3 بلّورات وعدّن صخرة واحدة ثم اعبر البوابة. بخار الفتحات ينفث على فترات: عدّ معه واعبر حين يهدأ.' },
    { id: 1, zone: 1, title: 'المكبس القديم',
      body: ['هنا قطع رجال القرية الحديد لقرون، وتركوا مكبسهم الضخم يعمل وحده. لا يغضب المكبس ولا يرحم، لكنه صادق: ينذرك قبل أن ينزل.',
        'الصخور أصلب هنا، فلا تستعجل ضرباتك.'],
      tip: 'يصفرّ ضوء المكبس ويهتز قبل أن ينزل. انتظر حتى يرتفع ثم اعبر، ولا تقف تحته وهو ينزل.' },
    { id: 2, zone: 2, title: 'عملاق الذهب',
      body: ['في الكهوف الذهبية يرقد عملاق صُنع من الذهب نفسه ليحرسه. درعه لا يُخترق، إلا حين يتعب بعد ضربته.',
        'لن تعبر هذه البوابة قبل أن يسقط، فاجمع شجاعتك.'],
      tip: 'اقفز فوق موجة الصدمة؛ فإذا ترنّح وظهرت النجوم فوق رأسه فاضربه بكل ما معك. ما تنقصه من صحته لا يعود إليه إن أُصبتَ.' },
    { id: 3, zone: 3, title: 'صوت البلّور',
      body: ['البلّور هنا يغنّي. لكل عرق إيقاعه، ومن أصغى جيداً عبر دون أن يُجرح. تعلّمك هذه الأعماق الصبر قبل القوة.'],
      tip: 'بلّورات الفخ تنبثق بإيقاعين مختلفين وترتجف قبل أن تنبثق: راقب الأول واعبر، ثم انتظر الثاني.' },
    { id: 4, zone: 4, title: 'نار تحت الجسر',
      body: ['قبل ألف عام انشقت الأرض هنا وبقيت الحمم تتنفس. النوافير تثور حين تشاء، لكن لكل نافورة غليان قبل ثورانها.',
        'ومن عبر هذه البحيرة ملأ جيبه بأغلى الخامات.'],
      tip: 'نوافير الحمم فوق الفجوات: اقفز عندما تهدأ النافورة لا عندما تغلي. والحمم أغلى خامات المنجم.' },
    { id: 5, zone: 5, title: 'حارس القلب',
      body: ['وصلتَ أخيراً. هنا يضيء الحجر بنفسه، وحارس القلب لا يدع أحداً يمرّ. إنه يندفع كالسيل إذا غضب، ولا يقف إلا حين يرتطم بجدار.'],
      tip: 'عند إنذار الاندفاع ابتعد، ثم اقفز حين يقترب. الارتطام بالجدار يربكه وقتاً أطول، فاضربه حينها.' },
    { id: 6, zone: null, epilogue: true, title: 'المصباح لا ينطفئ',
      body: ['أضاء قلب الأسطورة مصباحي القديم من جديد. شكراً لأنك حملتَ نوره إلى هنا.',
        'لكن المناجم لا تنتهي: الخامات تتجدد، والمعدات تُرقّى، والصخور تنتظر ضربتك.'],
      tip: 'ارفع معداتك إلى آخر مستوى وجرّب كل بطل: لكل واحد طريقته مع الزعيمين.' },
  ]);
  const LAST_MINE = CHAPTERS.filter((c) => !c.epilogue).length - 1;

  // ================= لقطة حالة اللاعب (عرض فقط) =================
  function snapOf(state) {
    const s = state && typeof state === 'object' ? state : {};
    const ores = {};
    for (const k of Object.keys(R.ORES)) ores[k] = Math.max(0, Math.floor(num(s.ores && s.ores[k])));
    return {
      wins: R.normalizeProgress(s.mines).wins,
      equipment: R.normalizeLoadout(s.equipment),
      ores,
      gold: Math.max(0, Math.floor(num(s.gold))),
    };
  }
  const progressOf = (snap) => ({ wins: snap.wins });
  const statusOf = (snap, zone) => R.mineStatus(zone, progressOf(snap), snap.equipment);
  const unlockedZones = (snap) => R.MINES.map((_, i) => i).filter((i) => statusOf(snap, i).unlocked);

  // ================= الفصول =================
  function chapterUnlocked(snap, id) {
    const ch = CHAPTERS[id];
    if (!ch) return false;
    return ch.epilogue ? snap.wins[LAST_MINE] >= 1 : statusOf(snap, ch.zone).unlocked;
  }
  // سبب القفل للعرض: أول شرط ناقص في المنجم (أو هزيمة الحارس للخاتمة)
  function chapterGate(snap, id) {
    const ch = CHAPTERS[id];
    if (!ch || chapterUnlocked(snap, id)) return '';
    if (ch.epilogue) return `اهزم ${R.levelFor(LAST_MINE).boss.name} في ${R.MINES[LAST_MINE].name}`;
    const need = statusOf(snap, ch.zone).needs.find((n) => !n.ok);
    return need ? need.label : '';
  }
  const unlockedChapters = (snap) => CHAPTERS.filter((c) => chapterUnlocked(snap, c.id)).map((c) => c.id);
  const unreadChapters = (snap, store) => unlockedChapters(snap).filter((id) => !(store && store.seen.includes(id)));
  const chapterKicker = (id) => {
    const ch = CHAPTERS[id];
    return `${ch.epilogue ? 'الخاتمة' : R.MINES[ch.zone].name} · الفصل ${id + 1} من ${CHAPTERS.length}`;
  };

  // ================= نسب الخامات وأين تُوجد =================
  // weights = نسب مئوية لخانات (common, mid, rare) عند اختيار خام كل صخرة؛ نجمع خانات الخام نفسه (الحمم في المنجم الخامس خانتان)
  function oreShares(mine) {
    const out = {};
    ['common', 'mid', 'rare'].forEach((slot, i) => { const ore = mine.tier[slot]; out[ore] = (out[ore] || 0) + mine.weights[i]; });
    return out;
  }
  function whereOre(ore) {
    return R.MINES.map((m, zone) => ({ zone, name: m.name, share: oreShares(m)[ore] || 0 })).filter((x) => x.share > 0).sort((a, b) => b.share - a.share || a.zone - b.zone);
  }
  // أنسب منجم مفتوح لجمع خام (أعلى نسبة؛ التعادل للأقدم) — null إن لم يفتح اللاعب منجماً يُنتجه
  function bestMineFor(ore, snap) {
    const open = new Set(unlockedZones(snap));
    return whereOre(ore).find((w) => open.has(w.zone)) || null;
  }

  // ================= الهدف التالي =================
  function costLine(cost, snap) {
    const miss = [];
    for (const [ore, n] of Object.entries(cost.ores || {})) { const have = snap.ores[ore] || 0; if (have < n) miss.push({ ore, need: n, have }); }
    return { gold: cost.gold, ores: cost.ores, goldMissing: Math.max(0, cost.gold - snap.gold), oresMissing: miss, affordable: snap.gold >= cost.gold && miss.length === 0 };
  }
  function costText(cost) {
    const parts = [`${fmt(cost.gold)} ذهب`];
    for (const [ore, n] of Object.entries(cost.ores || {})) parts.push(`${n} ${R.ORES[ore].name}`);
    return parts.join(' و');
  }
  // نص ما ينقص (إن نقص شيء) مع أنسب مكان لجمعه — ويعيد أيضاً المنجم الذي يُنصح باللعب فيه
  function shortage(cost, snap) {
    const c = costLine(cost, snap), lines = [];
    let zone = null;
    for (const m of c.oresMissing) {
      const best = bestMineFor(m.ore, snap);
      lines.push(`تنقصك ${m.need - m.have} ${R.ORES[m.ore].name}${best ? ` — الأنسب لجمعه الآن «${R.MINES[best.zone].name}» (${best.share}% من خامات صخوره)` : ''}`);
      if (best && zone === null) zone = best.zone;
    }
    if (c.goldMissing > 0) lines.push(`وتنقصك ${fmt(c.goldMissing)} ذهب (من نقرات الكهف وجوائز الجولات)`);
    return { ...c, lines, zone };
  }
  const topUnlocked = (snap) => Math.max(...unlockedZones(snap));

  function gearGoal(id, snap, target) {
    const def = R.EQUIPMENT[id], lvl = snap.equipment[id], cost = R.equipCost(id, lvl);
    const sh = cost ? shortage(cost, snap) : null;
    const action = !sh ? null
      : sh.affordable ? { kind: 'workshop', label: 'افتح الورشة وابدأ الترقية' }
        : { kind: 'play', zone: sh.zone !== null ? sh.zone : topUnlocked(snap), label: `العب في ${R.MINES[sh.zone !== null ? sh.zone : topUnlocked(snap)].name}` };
    return { def, lvl, cost, sh, action, target };
  }

  function nextGoal(input) {
    const snap = input && input.wins && input.equipment && input.ores ? input : snapOf(input);
    const L = snap.equipment;

    // 1) لم يفز بالمنجم الأول بعد
    if (!(snap.wins[0] >= 1)) {
      return { id: 'win:0', kind: 'win', zone: 0, title: `اعبر ${R.MINES[0].name}`,
        text: 'أهلاً يا بطل، أنا العم سراج. جولتك الأولى بسيطة: اجمع 3 بلّورات، وعدّن صخرة واحدة، ثم اعبر بوابة الخروج في آخر المنجم.',
        steps: [{ ok: false, label: `الفوز في ${R.MINES[0].name}` }],
        action: { kind: 'play', zone: 0, label: `ابدأ من ${R.MINES[0].name}` } };
    }

    // 2) أول منجم مقفل بالترتيب: ما الشرط الناقص؟
    for (let i = 1; i < R.MINES.length; i++) {
      const st = statusOf(snap, i);
      if (st.unlocked) continue;
      const target = R.MINES[i];
      const steps = st.needs.map((n) => {
        if (n.kind !== 'gear') return { ok: n.ok, label: n.label };
        return { ok: n.ok, label: n.label, detail: `${R.EQUIPMENT[n.id].name}: ${L[n.id]}/${n.level}` };
      });
      const winNeed = st.needs.find((n) => n.kind === 'win' && !n.ok);
      if (winNeed) {
        const prev = R.MINES[winNeed.zone], boss = R.levelFor(winNeed.zone).boss;
        return { id: `win:${winNeed.zone}`, kind: 'win', zone: winNeed.zone, target: i, title: `افز في ${prev.name}`,
          text: `لتفتح «${target.name}» افز أولاً في «${prev.name}»؛ كل جولة تنتهي بعبور بوابة الخروج تُحسب فوزاً.${boss ? ` هناك يحرسك ${boss.name}، ولن تُفتح البوابة قبل أن يسقط.` : ''}`,
          steps, action: { kind: 'play', zone: winNeed.zone, label: `العب في ${prev.name}` } };
      }
      const gearNeed = st.needs.find((n) => n.kind === 'gear' && !n.ok);
      const g = gearGoal(gearNeed.id, snap, i);
      const lines = g.sh ? [`الترقية التالية تكلّف ${costText(g.cost)}.`, ...g.sh.lines.map((l) => `${l}.`)] : [];
      return { id: `gear:${gearNeed.id}:${gearNeed.level}`, kind: 'gear', item: gearNeed.id, zone: topUnlocked(snap), target: i,
        title: `ارفع ${g.def.name} إلى المستوى ${gearNeed.level}`,
        text: `«${target.name}» ينتظرك: فزتَ فيما قبله وتبقّى أن تقوّي معداتك. ${lines.join(' ')}`.trim(),
        steps, cost: g.cost, shortage: g.sh, action: g.action };
    }

    // 3) كل المناجم مفتوحة والحارس لم يسقط
    if (!(snap.wins[LAST_MINE] >= 1)) {
      const boss = R.levelFor(LAST_MINE).boss;
      return { id: 'boss', kind: 'win', zone: LAST_MINE, title: `اهزم ${boss.name}`,
        text: `فتحتَ كل المناجم. بقي ${boss.name} في «${R.MINES[LAST_MINE].name}»: تراجع عند إنذاره ثم اقفز حين يقترب، واضربه وهو مرتبك.`,
        steps: [{ ok: false, label: `الفوز في ${R.MINES[LAST_MINE].name}` }], action: { kind: 'play', zone: LAST_MINE, label: `العب في ${R.MINES[LAST_MINE].name}` } };
    }

    // 4) كل شيء مفتوح والأسطورة أُضيئت: قوِّ أضعف معدّة
    const weakest = R.EQUIPMENT_ORDER.filter((id) => L[id] < R.MAX_EQUIP_LEVEL).sort((a, b) => L[a] - L[b])[0];
    if (weakest) {
      const g = gearGoal(weakest, snap, null);
      const lines = g.sh ? [`الترقية التالية تكلّف ${costText(g.cost)}.`, ...g.sh.lines.map((l) => `${l}.`)] : [];
      return { id: `upgrade:${weakest}`, kind: 'gear', item: weakest, zone: topUnlocked(snap), title: `قوِّ ${g.def.name}`,
        text: `أضأتَ القلب. اللعب الآن للمتعة والتحدّي، وأضعف معداتك: ${g.def.name} (المستوى ${g.lvl} من ${R.MAX_EQUIP_LEVEL}). ${lines.join(' ')}`.trim(),
        steps: R.EQUIPMENT_ORDER.map((id) => ({ ok: L[id] >= R.MAX_EQUIP_LEVEL, label: R.EQUIPMENT[id].name, detail: `${L[id]}/${R.MAX_EQUIP_LEVEL}` })),
        cost: g.cost, shortage: g.sh, action: g.action };
    }

    // 5) لا شيء ناقص
    return { id: 'legend', kind: 'done', zone: LAST_MINE, title: 'أنت أسطورة المنجم',
      text: 'فتحتَ كل المناجم وأضأتَ القلب ورفعتَ كل معداتك إلى آخر مستوى. العب بعد الآن للمتعة، وجرّب كل بطل مع الزعيمين.',
      steps: [], action: { kind: 'play', zone: LAST_MINE, label: `العب في ${R.MINES[LAST_MINE].name}` } };
  }

  // ================= الموسوعة =================
  function codex(input) {
    const snap = input && input.wins && input.equipment && input.ores ? input : snapOf(input);
    const open = new Set(unlockedZones(snap));
    const ores = R.ORE_LADDER.map((id) => {
      const found = whereOre(id).map((w) => ({ ...w, unlocked: open.has(w.zone) }));
      const owned = snap.ores[id] || 0;
      const known = owned > 0 || found.some((f) => f.unlocked);
      return { id, name: R.ORES[id].name, price: R.ORES[id].price, owned, known, foundIn: found, firstZone: found.length ? Math.min(...found.map((f) => f.zone)) : null };
    });
    const mines = R.MINES.map((m, zone) => {
      const st = statusOf(snap, zone), boss = R.levelFor(zone).boss;
      const shares = oreShares(m);
      return {
        zone, id: m.id, name: m.name, blurb: m.blurb, unlocked: st.unlocked, wins: st.wins, needs: st.needs,
        danger: st.unlocked ? DANGER[m.id] || '' : '', boss: st.unlocked && boss ? boss.name : null, hasBoss: !!boss,
        ores: Object.keys(shares).map((id) => ({ id, name: R.ORES[id].name, share: shares[id] })).sort((a, b) => b.share - a.share),
      };
    });
    const gear = R.EQUIPMENT_ORDER.map((id) => {
      const def = R.EQUIPMENT[id], level = snap.equipment[id], cost = R.equipCost(id, level);
      return { id, name: def.name, blurb: def.blurb, icon: def.icon, level, max: R.MAX_EQUIP_LEVEL, now: R.effectText(id, level), next: cost, nextText: cost ? costText(cost) : '', nextEffect: cost ? R.effectText(id, level + 1) : '' };
    });
    return { ores, mines, gear };
  }

  // ================= الحفظ المحلي: أي الفصول قرأها اللاعب =================
  // null = لم يُنشأ بعد. لاعب لديه تقدّم قبل هذه الميزة لا تنهال عليه الفصول كلها «جديدة»؛ تُعدّ مقروءة، ويبقى فصل يُفتح بعد ذلك جديداً.
  function loadStore(storage) {
    let raw = null;
    try { raw = JSON.parse(storage.getItem(CFG.KEY)); } catch (_) { raw = null; }
    if (!raw || raw.v !== CFG.STORE_VERSION) return null;
    return { v: CFG.STORE_VERSION, seen: [...new Set((Array.isArray(raw.seen) ? raw.seen : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < CHAPTERS.length))].sort((a, b) => a - b), opened: raw.opened === true };
  }
  function hasProgress(snap) {
    return snap.wins.some((w) => w > 0) || Object.values(snap.equipment).some((l) => l > 0) || Object.values(snap.ores).some((n) => n > 0);
  }
  function initialStore(snap) {
    return { v: CFG.STORE_VERSION, seen: hasProgress(snap) ? unlockedChapters(snap) : [], opened: false };
  }
  function saveStore(storage, store) {
    try { storage.setItem(CFG.KEY, JSON.stringify({ v: store.v, seen: store.seen, opened: store.opened })); return true; } catch (_) { return false; }
  }
  function withSeen(store, id) {
    if (!Number.isInteger(id) || id < 0 || id >= CHAPTERS.length || store.seen.includes(id)) return store;
    return { ...store, seen: [...store.seen, id].sort((a, b) => a - b) };
  }
  // نقطة «جديد» على زر المرشد: لم يفتحه اللاعب قط، أو هناك فصل لم يقرأه
  const needsAttention = (snap, store) => !!store && (!store.opened || unreadChapters(snap, store).length > 0);

  // ================= الرسم (نصوص HTML صافية، كل نص معقَّم) =================
  const ic = (id) => `<svg class="ui-icon" aria-hidden="true"><use href="#${id}"/></svg>`;
  const oreDot = (id) => `<i class="ore-dot ore-${esc(id)}"></i>`;

  function renderGoal(snap, zone) {
    const g = nextGoal(snap);
    const steps = g.steps.length ? `<ul class="gd-steps">${g.steps.map((s) => `<li class="${s.ok ? 'ok' : 'no'}">${ic(s.ok ? 'i-check' : 'i-close')}<span>${esc(s.label)}</span>${s.detail ? `<em>${esc(s.detail)}</em>` : ''}</li>`).join('')}</ul>` : '';
    const action = g.action ? `<button type="button" class="gd-action" data-guide-action="${esc(g.action.kind)}" data-zone="${g.action.zone ?? ''}">${esc(g.action.label)}</button>` : '';
    const z = Number.isInteger(zone) && zone >= 0 && zone < LAST_MINE + 1 ? zone : 0;
    const tip = chapterUnlocked(snap, z) ? `<aside class="gd-tipbox">${ic('i-bolt')}<div><b>نصيحة لـ «${esc(R.MINES[z].name)}»</b><p>${esc(CHAPTERS[z].tip)}</p></div></aside>` : '';
    return `<section class="gd-goal" data-goal="${esc(g.id)}">
      <div class="gd-talk"><img class="gd-figure" src="${CFG.PORTRAIT}" alt="" width="428" height="520" decoding="async" draggable="false">
        <div class="gd-bubble"><small>هدفك الآن</small><h3>${esc(g.title)}</h3><p>${esc(g.text)}</p></div></div>
      ${steps}${action}${tip}</section>`;
  }

  function renderCodex(snap, section) {
    const c = codex(snap), sec = ['ores', 'mines', 'gear'].includes(section) ? section : 'ores';
    const nav = [['ores', 'الخامات'], ['mines', 'المناجم'], ['gear', 'المعدات']]
      .map(([id, label]) => `<button type="button" role="tab" class="gd-seg${id === sec ? ' active' : ''}" aria-selected="${id === sec}" data-guide-section="${id}">${label}</button>`).join('');
    let body = '';
    if (sec === 'ores') {
      body = c.ores.map((o) => o.known
        ? `<article class="gd-entry" data-ore="${esc(o.id)}"><h4>${oreDot(o.id)}${esc(o.name)}</h4>
            <p class="gd-meta">تُباع بـ ${o.price} ذهب للقطعة · لديك ${fmt(o.owned)}</p>
            <p class="gd-where">${o.foundIn.map((f) => `<span class="${f.unlocked ? '' : 'dim'}">${esc(f.name)} ${f.share}%</span>`).join('')}</p></article>`
        : `<article class="gd-entry gd-unknown" data-ore="${esc(o.id)}"><h4>${ic('i-close')}؟؟؟</h4><p class="gd-meta">خام لم تكتشفه بعد — تجده في «${esc(R.MINES[o.firstZone].name)}».</p></article>`).join('');
    } else if (sec === 'mines') {
      body = c.mines.map((m) => `<article class="gd-entry${m.unlocked ? '' : ' gd-locked'}" data-mine="${m.zone}"><h4><b class="gd-num">${m.zone + 1}</b>${esc(m.name)}${m.unlocked ? '' : ic('i-close')}</h4>
          <p class="gd-meta">${esc(m.blurb)}${m.unlocked ? ` · انتصاراتك ${m.wins}` : ''}</p>
          ${m.unlocked
    ? `<p class="gd-world">${ic('i-flame')}${esc(m.danger)}${m.boss ? `<span class="gd-boss">${ic('i-boss')}زعيم: ${esc(m.boss)}</span>` : ''}</p>`
    : `<ul class="gd-steps">${m.needs.map((n) => `<li class="${n.ok ? 'ok' : 'no'}">${ic(n.ok ? 'i-check' : 'i-close')}<span>${esc(n.label)}</span></li>`).join('')}</ul>${m.hasBoss ? '<p class="gd-world">زعيم يحرس هذا المنجم</p>' : ''}`}
          <p class="gd-where">${m.ores.map((o) => `<span>${oreDot(o.id)}${esc(o.name)} ${o.share}%</span>`).join('')}</p></article>`).join('');
    } else {
      body = c.gear.map((g) => `<article class="gd-entry" data-gear="${esc(g.id)}"><h4>${ic(g.icon)}${esc(g.name)}<em class="gd-lvl">${g.level}/${g.max}</em></h4>
          <p class="gd-meta">${esc(g.blurb)}</p><p class="gd-meta">الآن: ${esc(g.now)}</p>
          ${g.next ? `<p class="gd-meta">الترقية التالية (${esc(g.nextEffect)}): ${esc(g.nextText)}</p>` : '<p class="gd-meta">بلغت المستوى الأقصى.</p>'}</article>`).join('');
    }
    return `<div class="gd-segs" role="tablist" aria-label="أقسام الموسوعة">${nav}</div><div class="gd-list">${body}</div>`;
  }

  function renderStory(snap, store) {
    const items = CHAPTERS.map((ch) => {
      const open = chapterUnlocked(snap, ch.id), fresh = open && !(store && store.seen.includes(ch.id));
      return open
        ? `<button type="button" class="gd-chapter-row${fresh ? ' fresh' : ''}" data-guide-read="${ch.id}"><b class="gd-num">${ch.id + 1}</b><span><strong>${esc(ch.title)}</strong><small>${esc(chapterKicker(ch.id))}</small></span>${fresh ? '<i class="gd-new">جديد</i>' : ic('i-check')}</button>`
        : `<div class="gd-chapter-row locked"><b class="gd-num">${ch.id + 1}</b><span><strong>فصل مغلق</strong><small>${esc(chapterGate(snap, ch.id))}</small></span>${ic('i-close')}</div>`;
    }).join('');
    return `<p class="gd-lead">فصل جديد يُروى كلما فتحتَ منجماً. اضغط فصلاً لتقرأه.</p><div class="gd-list">${items}</div>`;
  }

  function renderChapter(snap, id) {
    const ch = CHAPTERS[id];
    if (!ch || !chapterUnlocked(snap, id)) return '';
    const next = CHAPTERS.find((c) => c.id > id && chapterUnlocked(snap, c.id));
    return `<article class="gd-chapter" data-chapter="${id}">
      <header><img class="gd-mini" src="${CFG.PORTRAIT}" alt="" width="428" height="520" decoding="async" draggable="false"><div><small>${esc(chapterKicker(id))}</small><h3>${esc(ch.title)}</h3></div></header>
      ${ch.body.map((p) => `<p>${esc(p)}</p>`).join('')}
      <aside class="gd-tipbox">${ic('i-bolt')}<div><b>نصيحة ${esc(CFG.NAME)}</b><p>${esc(ch.tip)}</p></div></aside>
      <footer><button type="button" class="gd-back" data-guide-back>كل الفصول</button>${next ? `<button type="button" class="gd-action" data-guide-read="${next.id}">الفصل التالي: ${esc(next.title)}</button>` : ''}</footer></article>`;
  }

  // ================= الواجهة =================
  let els = null, deps = {}, store = null, tab = 'goal', section = 'ores', reading = null, isOpen = false, opener = null, lastSig = '';
  const safe = (fn) => (...args) => { try { return fn(...args); } catch (e) { try { console.error('[guide]', e); } catch (_) {} return undefined; } };
  const storage = () => { try { return root.localStorage || null; } catch (_) { return null; } };
  const el = (id) => (root.document && root.document.getElementById ? root.document.getElementById(id) : null);
  const currentSnap = () => snapOf(deps.getState ? deps.getState() : null);
  const currentZone = () => { try { return num(deps.getZone ? deps.getZone() : 0); } catch (_) { return 0; } };

  function persist() { const s = storage(); if (s && store) saveStore(s, store); }

  // الفصل الأول يُعرَّف بنقطة الزر فقط. كل فصل لاحق يحوّل نص الزر إلى «فصل جديد» ويفتح الفصل مباشرة، دون شريط إضافي:
  // شاشة الجولة على جوال 390×844 تتسع لمحتواها بالكاد، وأي سطر زائد يدفع صفّ الأزرار خارجها
  function paintAttention(snap) {
    if (!els) return;
    const unread = unreadChapters(snap, store), dot = needsAttention(snap, store);
    const first = unread.find((id) => id > 0);
    for (const b of els.openers) {
      const d = b.querySelector ? b.querySelector('.guide-dot') : null;
      if (d) d.hidden = !dot;
      const label = b.querySelector ? b.querySelector('[data-guide-label]') : null;
      if (label) label.textContent = first === undefined ? CFG.LABEL : CFG.LABEL_NEW;
      b.dataset.news = first === undefined ? '0' : '1';
      b.dataset.chapter = first === undefined ? '' : String(first);
      b.setAttribute('aria-label', first === undefined ? CFG.ARIA : `${CFG.LABEL_NEW}: «${CHAPTERS[first].title}» — ${CFG.ARIA}`);
    }
  }

  function paintTabs() {
    for (const b of els.tabs) {
      const on = b.dataset.guideTab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    }
  }

  function paintBody() {
    const snap = currentSnap();
    let html;
    if (tab === 'goal') html = renderGoal(snap, currentZone());
    else if (tab === 'codex') html = renderCodex(snap, section);
    else html = reading !== null ? (renderChapter(snap, reading) || renderStory(snap, store)) : renderStory(snap, store);
    els.body.innerHTML = html;
    if (els.body.scrollTo) els.body.scrollTo(0, 0); else els.body.scrollTop = 0;
    paintTabs();
  }

  // ما يغيّر ما يعرضه المرشد: الانتصارات ومستويات المعدات والفصول المقروءة (الذهب والخامات تُقرأ عند الرسم فقط)
  const sigOf = (snap) => `${snap.wins.join('')}|${R.EQUIPMENT_ORDER.map((id) => snap.equipment[id]).join('')}|${store.seen.join('')}|${store.opened}`;

  function refresh() {
    if (!els || !store) return;
    const snap = currentSnap(), sig = sigOf(snap);
    if (sig === lastSig) return;
    lastSig = sig;
    paintAttention(snap);
    if (isOpen) paintBody();
  }

  function show(which, chapter = null) {
    if (!els || !store) return false;
    tab = ['goal', 'codex', 'story'].includes(which) ? which : 'goal';
    reading = tab === 'story' && Number.isInteger(chapter) ? chapter : null;
    if (!isOpen) {
      try { deps.pause && deps.pause(); } catch (_) {}
      opener = root.document ? root.document.activeElement : null;
      isOpen = true; els.overlay.hidden = false;
    }
    if (!store.opened) { store = { ...store, opened: true }; persist(); }
    if (reading !== null) { store = withSeen(store, reading); persist(); }
    const snap = currentSnap();
    paintBody(); paintAttention(snap); lastSig = sigOf(snap);
    if (els.close && els.close.focus) els.close.focus({ preventScroll: true });
    return true;
  }

  function hide() {
    if (!els || !isOpen) return;
    isOpen = false; els.overlay.hidden = true;
    try {
      const back = opener && !opener.hidden && root.document && root.document.contains(opener) ? opener : els.openers.find((b) => !b.hidden);
      if (back && back.focus) back.focus({ preventScroll: true });
    } catch (_) {}
    opener = null;
  }

  const onAction = safe((btn) => {
    const kind = btn.dataset.guideAction, zone = btn.dataset.zone === '' || btn.dataset.zone === undefined ? null : Number(btn.dataset.zone);
    hide();
    if (kind === 'workshop') { if (deps.openWorkshop) deps.openWorkshop(); }
    else if (kind === 'play' && zone !== null && deps.setZone) deps.setZone(zone);
  });

  const onBodyClick = safe((e) => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const read = t.closest('[data-guide-read]');
    if (read) { show('story', Number(read.dataset.guideRead)); return; }
    if (t.closest('[data-guide-back]')) { show('story'); return; }
    const sec = t.closest('[data-guide-section]');
    if (sec) { section = sec.dataset.guideSection; paintBody(); return; }
    const act = t.closest('[data-guide-action]');
    if (act) onAction(act);
  });

  function init(options) {
    deps = options || {};
    const overlay = el('guide-overlay'), body = el('guide-body');
    if (!overlay || !body || !root.document) return false;
    const list = (sel) => (root.document.querySelectorAll ? [...root.document.querySelectorAll(sel)] : []);
    els = { overlay, body, close: el('guide-close'), tabs: list('[data-guide-tab]'), openers: list('[data-guide-open]') };
    for (const b of els.openers) b.addEventListener('click', safe(() => { if (b.dataset.chapter) show('story', Number(b.dataset.chapter)); else show('goal'); }));
    for (const b of els.tabs) b.addEventListener('click', safe(() => show(b.dataset.guideTab)));
    if (els.close) els.close.addEventListener('click', safe(hide));
    body.addEventListener('click', onBodyClick);
    root.document.addEventListener('keydown', safe((e) => { if (e.key === 'Escape' && isOpen) hide(); }));
    api.active = true;
    return true;
  }

  // يُستدعى بعد أن يعتمد التطبيق حالة الخادم (أو يتخلى عنها): قبل ذلك يبدو اللاعب القديم جديداً
  function start() {
    if (!els) return false;
    const s = storage(), snap = currentSnap();
    store = (s && loadStore(s)) || initialStore(snap);
    if (s) saveStore(s, store);
    for (const b of els.openers) b.hidden = false;
    lastSig = '';
    refresh();
    return true;
  }

  function inspect() {
    const snap = currentSnap();
    return { open: isOpen, tab, section, reading, ready: !!store, store: store ? { seen: [...store.seen], opened: store.opened } : null, unread: store ? unreadChapters(snap, store) : [], attention: needsAttention(snap, store), goal: nextGoal(snap).id };
  }

  Object.assign(api, {
    VERSION: 1, CFG, CHAPTERS, DANGER, snapOf, oreShares, whereOre, bestMineFor, nextGoal, codex, costText,
    chapterUnlocked, chapterGate, unlockedChapters, unreadChapters,
    loadStore, initialStore, saveStore, withSeen, needsAttention,
    renderGoal, renderCodex, renderStory, renderChapter,
    init: safe(init), start: safe(start), refresh: safe(refresh), open: safe(show), close: safe(hide), inspect,
  });
  return api;
});
