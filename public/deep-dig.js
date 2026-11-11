// الحفر العميق — نموذج اللعب (محرك حتمي بلا DOM؛ يعمل في المتصفح وفي Node للاختبار).
//
// بذرة + مستويات المعدات + مدخلات (اتجاه واحد في كل نبضة 1/60 ث) ⇒ نفس العالم ونفس النتيجة دائماً.
// المعدّن ينزل في بئر بعرض 7 بلاطات عبر 5 طبقات (حجر ← حديد ← ذهب ← بلّور ← حمم) نحو صندوق «قلب الأسطورة»:
//   • يحفر بالاتجاه (دفع نحو بلاطة صلبة = حفرها؛ نحو فراغ = مشي)، والعروق تلمع قبل الوصول (عرض الواجهة).
//   • حقيبة محدودة، وقرار «أنزل أعمق أم أصعد؟»: الحبل ينقلك للسطح بكل غنيمتك، والإغماء يفقدك نصفها.
//   • أخطار لها حل: صخور سائبة تسقط إن حفرت تحتها، جيوب غاز تنفجر عند حفرها، وحمم تُحرق من الجوار.
//
// لا علاقة له بالاقتصاد ولا بالخادم: النتيجة (العمق والغنيمة) تُسجَّل محلياً في الواجهة فقط في هذه النسخة.
// أسعار الخامات هي سلّم أسعار محرك المنصّات نفسه (يفرض ذلك اختبار) كي يسهل ربطها بالمكافآت لاحقاً بعد موافقة صريحة.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DeepDig = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLS = 7;
  const ROWS = 62;              // 0 = السطح، 1..60 = الطبقات، 61 = أرضية غرفة الكنز
  const LAST_ROCK_ROW = 60;
  const CHEST_ROW = 61;
  const MID = 3;                // العمود الأوسط: بداية النزول وموضع الصندوق
  const METERS_PER_ROW = 2;
  const DT = 1 / 60;
  const MAX_TICKS_PER_ADVANCE = 8;

  const TILE = Object.freeze({ AIR: 0, ROCK: 1, ORE: 2, GAS: 3, BOULDER: 4, LAVA: 5, BEDROCK: 6, CHEST: 7 });

  const LAYERS = Object.freeze([
    Object.freeze({ id: 'stone', name: 'الحجر', from: 1, to: 12, hardness: 1 }),
    Object.freeze({ id: 'iron', name: 'الحديد', from: 13, to: 24, hardness: 2 }),
    Object.freeze({ id: 'gold', name: 'الذهب', from: 25, to: 36, hardness: 3 }),
    Object.freeze({ id: 'crystal', name: 'البلّور', from: 37, to: 48, hardness: 4 }),
    Object.freeze({ id: 'lava', name: 'الحمم', from: 49, to: 60, hardness: 5 }),
  ]);

  // الأسعار = سلّم محرك المنصّات (copper..lava)؛ الأثر القديم خامة نادرة خاصة بهذا الوضع.
  const ORE_IDS = Object.freeze(['copper', 'iron', 'gold', 'crystal', 'lava', 'relic']);
  const ORE_N = Object.freeze({ copper: 1, iron: 2, gold: 3, crystal: 4, lava: 5, relic: 6 });
  const ORES = Object.freeze({
    copper: Object.freeze({ name: 'نحاس', price: 2 }),
    iron: Object.freeze({ name: 'حديد', price: 4 }),
    gold: Object.freeze({ name: 'ذهب خام', price: 8 }),
    crystal: Object.freeze({ name: 'بلّور', price: 12 }),
    lava: Object.freeze({ name: 'حمم', price: 20 }),
    relic: Object.freeze({ name: 'أثر قديم', price: 120 }),
  });

  // احتمال بدء عرق لكل بلاطة صخر حسب الطبقة. التجمّع (جار يمين 50% وأسفل 35%) يضاعفه تقريباً ×1.85،
  // فالكثافة النهائية ≈ 13–15% من بلاطات كل طبقة (يفرض ذلك اختبار)؛ أكثر من ذلك تمتلئ الحقيبة بلا قرار.
  const ORE_TABLE = Object.freeze([
    [[ORE_N.copper, 0.06], [ORE_N.iron, 0.014]],
    [[ORE_N.copper, 0.022], [ORE_N.iron, 0.06], [ORE_N.gold, 0.011]],
    [[ORE_N.iron, 0.022], [ORE_N.gold, 0.058], [ORE_N.crystal, 0.011]],
    [[ORE_N.gold, 0.022], [ORE_N.crystal, 0.058], [ORE_N.lava, 0.011]],
    [[ORE_N.crystal, 0.028], [ORE_N.lava, 0.055]],
  ]);
  const BOULDER_P = Object.freeze([0.012, 0.022, 0.028, 0.03, 0.03]);   // الصخور السائبة من الصف 5 كي تُتعلَّم القاعدة مبكراً بكلفة قليلة
  const GAS_P = Object.freeze([0, 0.012, 0.03, 0.04, 0.035]);
  const LAVA_P = Object.freeze([0, 0, 0, 0.035, 0.10]);
  const BOULDER_MIN_ROW = 5, GAS_MIN_ROW = 16, LAVA_MIN_ROW = 40, LAVA_MAX_PER_ROW = 2;
  const RELIC_ROWS = Object.freeze([28, 58]);

  const CFG = Object.freeze({
    digBase: Object.freeze([0, 0.32, 0.55, 0.85, 1.2, 1.65]),   // ثوانٍ لصلابة 1..5 قبل أثر المعدات
    digMulOre: 1.15, digMulBoulder: 1.8, digMulChest: 1.2,
    hitPeriod: 0.26,           // فاصل ضربة المعول (صوت/غبار)
    digKeep: 0.4,              // يبقى تقدّم الحفر هذه المدة بعد ترك العصا
    moveSpeed: 6.2,            // بلاطة/ث قبل أثر الأحذية
    wobble: 0.7,               // إنذار الصخرة السائبة قبل السقوط
    fallStep: 0.08,            // زمن سقوط بلاطة واحدة
    boulderDamage: 2, boulderStun: 0.35,
    gasRadius: 1.7, gasLife: 3.4, gasGrow: 0.5, gasFade: 0.7, gasGrace: 0.35, gasTick: 0.8,
    heatTick: 1.2,
    invTime: 0.6,
    faintTime: 1.1, winTime: 1.4,
    ropeBase: 0.8, ropePerRow: 0.04, ropeMax: 3.2,
    bumpGap: 20,               // نبضات بين حدثين «اصطدام»
  });

  const EQUIPMENT_KEYS = Object.freeze(['pickaxe', 'boots', 'bag', 'magnet', 'drill', 'robot', 'luck', 'armor']);
  const MAX_LEVEL = 5;

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ───────────────────────────── المعدات ─────────────────────────────
  function normalizeEquipment(raw) {
    const out = {};
    for (const k of EQUIPMENT_KEYS) out[k] = clamp(Math.floor(Number(raw && raw[k]) || 0), 0, MAX_LEVEL);
    return out;
  }

  // ما تغيّره كل معدّة هنا (كلها قراءة فقط من مستويات اللاعب؛ لا شيء يُكتب):
  //   معول/مثقاب = سرعة الحفر، أحذية = سرعة المشي، حقيبة = السعة، مغناطيس = مدى لمعان العروق،
  //   روبوت = اتساع ضوء الشعلة، درع = صحة أكثر وضرر أبطأ، حظ = خامات أكثر وآثار أكثر.
  function loadoutStats(eq) {
    const e = normalizeEquipment(eq);
    return {
      digSpeed: 1 + 0.16 * e.pickaxe + 0.10 * e.drill,
      moveSpeed: CFG.moveSpeed * (1 + 0.06 * e.boots),
      bagCap: 8 + 2 * e.bag,
      scan: 5.0 + 0.5 * e.magnet,            // مدى لمعان العروق (بلاطات) — يتجاوز ضوء الشعلة
      light: 3.4 + 0.25 * e.robot,           // نصف قطر ضوء الشعلة
      maxHp: 5 + Math.floor(e.armor / 2),
      armor: e.armor,
      luck: e.luck,
    };
  }

  // ───────────────────────────── العالم ─────────────────────────────
  const idx = (c, r) => r * COLS + c;

  function layerIndex(row) {
    if (row < 1) return -1;
    for (let i = 0; i < LAYERS.length; i++) if (row <= LAYERS[i].to) return i;
    return LAYERS.length - 1;
  }
  const hardnessAt = (row) => { const i = layerIndex(row); return i < 0 ? 0 : LAYERS[i].hardness; };

  function generate(seed, luck) {
    const rnd = mulberry32(seed);
    const tiles = new Uint8Array(COLS * ROWS);
    const ore = new Uint8Array(COLS * ROWS);
    for (let r = 1; r <= LAST_ROCK_ROW; r++) for (let c = 0; c < COLS; c++) tiles[idx(c, r)] = TILE.ROCK;
    for (let c = 0; c < COLS; c++) tiles[idx(c, CHEST_ROW)] = TILE.BEDROCK;
    tiles[idx(MID, CHEST_ROW)] = TILE.CHEST;

    // الخامات: عروق من 1 إلى 3 بلاطات (جار يمين/أسفل)
    const boost = 1 + 0.06 * (luck || 0);
    for (let r = 1; r <= LAST_ROCK_ROW; r++) {
      const table = ORE_TABLE[layerIndex(r)];
      for (let c = 0; c < COLS; c++) {
        const i = idx(c, r);
        if (tiles[i] !== TILE.ROCK) continue;
        let x = rnd(), kind = 0;
        for (const [k, p] of table) { if (x < p * boost) { kind = k; break; } x -= p * boost; }
        if (!kind) continue;
        tiles[i] = TILE.ORE; ore[i] = kind;
        if (rnd() < 0.5 && c + 1 < COLS && tiles[i + 1] === TILE.ROCK) { tiles[i + 1] = TILE.ORE; ore[i + 1] = kind; }
        if (rnd() < 0.35 && r + 1 <= LAST_ROCK_ROW && tiles[i + COLS] === TILE.ROCK) { tiles[i + COLS] = TILE.ORE; ore[i + COLS] = kind; }
      }
    }

    // الأخطار: لا شيء قرب السطح، والحمم لا تزيد على اثنتين في الصف، والطريق إلى الصندوق دائماً مفتوح
    const lavaInRow = new Uint8Array(ROWS);
    for (let r = BOULDER_MIN_ROW; r <= LAST_ROCK_ROW; r++) {
      const L = layerIndex(r);
      const pb = BOULDER_P[L], pg = r >= GAS_MIN_ROW ? GAS_P[L] : 0, pl = r >= LAVA_MIN_ROW ? LAVA_P[L] : 0;
      for (let c = 0; c < COLS; c++) {
        const i = idx(c, r);
        if (tiles[i] !== TILE.ROCK) continue;
        const x = rnd();
        if (x < pb) tiles[i] = TILE.BOULDER;
        else if (x < pb + pg) tiles[i] = TILE.GAS;
        else if (x < pb + pg + pl && lavaInRow[r] < LAVA_MAX_PER_ROW && !(c === MID && r >= LAST_ROCK_ROW - 3)) { tiles[i] = TILE.LAVA; lavaInRow[r]++; }
      }
    }

    // الآثار القديمة: نادرة، في الطبقات العميقة، مرئية من بعيد (يلمع الأثر أكثر)
    const relics = 1 + (luck >= 3 ? 1 : 0) + (luck >= 5 ? 1 : 0);
    for (let n = 0; n < relics; n++) {
      for (let tries = 0; tries < 40; tries++) {
        const r = RELIC_ROWS[0] + Math.floor(rnd() * (RELIC_ROWS[1] - RELIC_ROWS[0] + 1));
        const c = Math.floor(rnd() * COLS);
        const i = idx(c, r);
        if (tiles[i] === TILE.ROCK || tiles[i] === TILE.ORE) { tiles[i] = TILE.ORE; ore[i] = ORE_N.relic; break; }
      }
    }
    return { tiles, ore };
  }

  function emptyBag() { return { copper: 0, iron: 0, gold: 0, crystal: 0, lava: 0, relic: 0 }; }

  function create(opts) {
    const o = opts || {};
    const seed = (Number(o.seed) >>> 0) || 1;
    const eq = normalizeEquipment(o.equipment);
    const stats = loadoutStats(eq);
    const world = generate(seed, stats.luck);
    return {
      seed, eq, stats, cols: COLS, rows: ROWS,
      tiles: world.tiles, ore: world.ore,
      tick: 0, time: 0, acc: 0,
      status: 'running',            // running | done
      result: null,
      legend: false,
      layerMax: -1,
      miner: {
        col: MID, row: 0, state: 'idle', face: 1, axis: 'v',
        move: null, dig: null, hp: stats.maxHp, inv: 0, stun: 0, heat: 0,
        gasT: 0, gasNext: CFG.gasGrace, rope: null, faintT: 0, winT: 0, maxRow: 0, lastBump: -999,
      },
      bag: emptyBag(), bagCount: 0,
      loose: [], clouds: [], events: [], robot: { dig: null, blocked: false },
      counts: { dug: 0, ores: 0, hits: 0 },
    };
  }

  // ───────────────────────────── مساعدات القراءة ─────────────────────────────
  function kindAt(game, c, r) {
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return TILE.BEDROCK;
    return game.tiles[idx(c, r)];
  }
  const oreAt = (game, c, r) => (c < 0 || c >= COLS || r < 0 || r >= ROWS ? 0 : game.ore[idx(c, r)]);
  const diggable = (k) => k === TILE.ROCK || k === TILE.ORE || k === TILE.GAS || k === TILE.BOULDER || k === TILE.CHEST;

  function digTime(game, c, r, kind) {
    const h = hardnessAt(r) || 1;
    const mul = kind === TILE.ORE ? CFG.digMulOre : kind === TILE.BOULDER ? CFG.digMulBoulder : kind === TILE.CHEST ? CFG.digMulChest : 1;
    return CFG.digBase[h] * mul / game.stats.digSpeed;
  }

  // موضع المعدّن (مركز البلاطة بوحدات البلاطات) مع نسبة الحركة بين بلاطتين
  function minerPos(game) {
    const m = game.miner;
    if (m.state === 'rope' && m.rope) {
      const p = clamp(m.rope.t / m.rope.dur, 0, 1), e = p * p * (3 - 2 * p);
      return { x: m.col + 0.5, y: m.rope.fromRow + 0.5 + (0.5 - (m.rope.fromRow + 0.5)) * e };
    }
    if (m.move) {
      const t = clamp(m.move.t, 0, 1);
      return { x: m.move.fc + 0.5 + (m.move.tc - m.move.fc) * t, y: m.move.fr + 0.5 + (m.move.tr - m.move.fr) * t };
    }
    return { x: m.col + 0.5, y: m.row + 0.5 };
  }

  const occupies = (game, c, r) => {
    const m = game.miner;
    if (m.move) return (m.move.fc === c && m.move.fr === r) || (m.move.tc === c && m.move.tr === r);
    return m.col === c && m.row === r;
  };
  const fallingAt = (game, c, r) => game.loose.some((b) => b.fall && b.c === c && b.r === r);

  function emit(game, type, data) {
    if (game.events.length < 160) game.events.push(Object.assign({ type }, data));
  }
  function drainEvents(game) { const e = game.events; game.events = []; return e; }

  // ───────────────────────────── الضرر والنهاية ─────────────────────────────
  function damage(game, amount, kind) {
    const m = game.miner;
    if (game.status !== 'running' || m.inv > 0) return false;
    if (m.state === 'rope' || m.state === 'faint' || m.state === 'win') return false;
    m.hp = Math.max(0, m.hp - amount);
    m.inv = CFG.invTime;
    game.counts.hits++;
    emit(game, 'hurt', { kind, hp: m.hp, amount });
    m.dig = null;
    if (m.hp <= 0) {
      if (m.move) { if (m.move.t >= 0.5) { m.col = m.move.tc; m.row = m.move.tr; } m.move = null; }
      m.state = 'faint'; m.faintT = CFG.faintTime;
      emit(game, 'faint', {});
    } else if (kind === 'boulder') {
      m.stun = CFG.boulderStun;
    }
    return true;
  }

  const bagValue = (bag) => ORE_IDS.reduce((s, k) => s + (bag[k] || 0) * ORES[k].price, 0);
  const bagTotal = (bag) => ORE_IDS.reduce((s, k) => s + (bag[k] || 0), 0);

  // الإغماء يُبقي أغلى نصف الغنيمة (مقرَّباً للأعلى) ويفقد الباقي
  function keepBest(bag, n) {
    const kept = emptyBag();
    let left = n;
    for (const k of ORE_IDS.slice().sort((a, b) => ORES[b].price - ORES[a].price)) {
      const take = Math.min(bag[k] || 0, left);
      kept[k] = take; left -= take;
    }
    return kept;
  }

  function finish(game, reason) {
    if (game.status !== 'running') return;
    const total = bagTotal(game.bag);
    const kept = reason === 'faint' ? keepBest(game.bag, Math.ceil(total / 2)) : Object.assign({}, game.bag);
    const lost = emptyBag();
    for (const k of ORE_IDS) lost[k] = (game.bag[k] || 0) - kept[k];
    game.status = 'done';
    game.miner.dig = null; game.miner.move = null;
    game.result = {
      reason, maxRow: game.miner.maxRow, depthM: game.miner.maxRow * METERS_PER_ROW,
      kept, lost, keptCount: bagTotal(kept), lostCount: bagTotal(lost),
      value: bagValue(kept), lostValue: bagValue(lost),
      legend: game.legend, time: game.time, layer: layerIndex(game.miner.maxRow),
      hits: game.counts.hits, dug: game.counts.dug,
    };
    emit(game, 'done', { reason });
  }

  // ───────────────────────────── الحفر والحركة ─────────────────────────────
  function wake(game, c, r) {
    if (r < 1 || kindAt(game, c, r) !== TILE.BOULDER) return;
    if (game.loose.some((b) => b.c === c && b.r === r)) return;
    game.loose.push({ c, r, wobble: CFG.wobble, fall: null });
    emit(game, 'rumble', { c, r });
  }

  // الحقيبة المحدودة تحتفظ بأفضل ما وجدت: إن امتلأت حلّت الخامة الأغلى محلّ أرخص قطعة فيها، وإلا ضاعت (bag_full)
  function collect(game, oreN, c, r) {
    const id = ORE_IDS[oreN - 1];
    if (!id) return;
    if (game.bagCount < game.stats.bagCap) {
      game.bag[id]++; game.bagCount++; game.counts.ores++;
      emit(game, 'ore', { kind: id, c, r });
      return;
    }
    let cheapest = null;
    for (const k of ORE_IDS) if (game.bag[k] > 0 && (cheapest === null || ORES[k].price < ORES[cheapest].price)) cheapest = k;
    if (cheapest !== null && ORES[cheapest].price < ORES[id].price) {
      game.bag[cheapest]--; game.bag[id]++; game.counts.ores++;
      emit(game, 'ore_swap', { kind: id, dropped: cheapest, c, r });
    } else {
      emit(game, 'bag_full', { kind: id, c, r });
    }
  }

  function completeDig(game, c, r, kind) {
    const m = game.miner;
    const i = idx(c, r);
    m.dig = null;
    game.tiles[i] = TILE.AIR;
    game.counts.dug++;
    emit(game, 'dug', { c, r, tile: kind });
    if (kind === TILE.ORE) { collect(game, game.ore[i], c, r); game.ore[i] = 0; }
    else if (kind === TILE.GAS) { game.clouds.push({ c, r, t: 0 }); emit(game, 'gas', { c, r }); }
    else if (kind === TILE.BOULDER) emit(game, 'crush', { c, r });
    else if (kind === TILE.CHEST) {
      game.legend = true; game.bag.relic++;      // كنز الأسطورة: أثر إضافي خارج سعة الحقيبة
      m.state = 'win'; m.winT = CFG.winTime; m.move = null;
      emit(game, 'chest', { c, r });
    }
    wake(game, c, r - 1);                          // الصخرة فوق البلاطة المحفورة فقدت سندها
  }

  function digProgress(game, tc, tr, kind) {
    const m = game.miner;
    if (!m.dig || m.dig.col !== tc || m.dig.row !== tr) m.dig = { col: tc, row: tr, t: 0, need: digTime(game, tc, tr, kind), idle: 0, hits: 0 };
    const d = m.dig;
    d.idle = 0;
    m.state = 'dig';
    d.t += DT;
    if (d.t >= d.hits * CFG.hitPeriod) { d.hits++; emit(game, 'dig_hit', { c: tc, r: tr, tile: kind }); }
    if (d.t >= d.need) completeDig(game, tc, tr, kind);
  }

  function releaseDig(game) {
    const m = game.miner;
    if (!m.dig) return;
    m.dig.idle += DT;
    if (m.dig.idle > CFG.digKeep) m.dig = null;
  }

  function beginMove(game, tc, tr, carry) {
    const m = game.miner;
    m.dig = null; m.state = 'move';
    m.move = { fc: m.col, fr: m.row, tc, tr, t: carry || 0 };
  }

  function arrive(game, mv) {
    const m = game.miner;
    if (m.row > m.maxRow) m.maxRow = m.row;
    emit(game, 'step', { c: m.col, r: m.row });
    const L = layerIndex(m.row);
    if (L > game.layerMax) { game.layerMax = L; if (L >= 0) emit(game, 'layer', { index: L }); }
    if (m.row === 0 && mv.fr >= 1) finish(game, 'surface');
  }

  function decide(game, input, carry) {
    const m = game.miner;
    let dx = Math.sign((input && input.dx) || 0), dy = Math.sign((input && input.dy) || 0);
    if (dx && dy) { if (m.axis === 'v') dx = 0; else dy = 0; }
    if (!dx && !dy) { releaseDig(game); m.state = 'idle'; return; }
    m.axis = dx ? 'h' : 'v';
    if (dx) m.face = dx;
    const tc = m.col + dx, tr = m.row + dy;
    const kind = kindAt(game, tc, tr);
    if (kind === TILE.AIR) {
      if (fallingAt(game, tc, tr)) { m.state = 'idle'; return; }
      beginMove(game, tc, tr, carry);
    } else if (diggable(kind)) {
      digProgress(game, tc, tr, kind);
    } else {
      m.state = 'idle';
      if (game.tick - m.lastBump > CFG.bumpGap) { m.lastBump = game.tick; emit(game, 'bump', { c: tc, r: tr, tile: kind }); }
    }
  }

  function stepMove(game, input) {
    const m = game.miner, mv = m.move;
    mv.t += game.stats.moveSpeed * DT;
    if (mv.t < 1) return;
    const carry = mv.t - 1;
    m.col = mv.tc; m.row = mv.tr; m.move = null; m.state = 'idle';
    arrive(game, mv);
    if (game.status === 'running' && m.stun <= 0) decide(game, input, carry);
  }

  // ───────────────────────────── الحبل ─────────────────────────────
  const ropeTime = (row) => clamp(CFG.ropeBase + CFG.ropePerRow * row, CFG.ropeBase, CFG.ropeMax);

  function ascend(game) {
    const m = game.miner;
    if (game.status !== 'running') return false;
    if (m.state === 'rope' || m.state === 'faint' || m.state === 'win') return false;
    if (m.move) { m.col = m.move.tc; m.row = m.move.tr; m.move = null; }
    if (m.row < 1) return false;
    m.dig = null; m.stun = 0; m.state = 'rope';
    m.rope = { t: 0, dur: ropeTime(m.row), fromRow: m.row };
    emit(game, 'rope_start', { row: m.row });
    return true;
  }

  function stepRope(game) {
    const m = game.miner;
    m.rope.t += DT;
    if (m.rope.t >= m.rope.dur) { m.row = 0; finish(game, 'rope'); }
  }

  // ───────────────────────────── الغاز والحرارة ─────────────────────────────
  const cloudRadius = (cl) => {
    const life = CFG.gasLife;
    const grow = Math.min(1, cl.t / CFG.gasGrow);
    const fade = cl.t > life - CFG.gasFade ? Math.max(0, (life - cl.t) / CFG.gasFade) : 1;
    return CFG.gasRadius * grow * fade;
  };

  function updateClouds(game) {
    for (let k = game.clouds.length - 1; k >= 0; k--) {
      const cl = game.clouds[k];
      cl.t += DT;
      if (cl.t >= CFG.gasLife) game.clouds.splice(k, 1);
    }
  }

  const lavaNeighbours = (game, c, r) =>
    (kindAt(game, c - 1, r) === TILE.LAVA) + (kindAt(game, c + 1, r) === TILE.LAVA) + (kindAt(game, c, r - 1) === TILE.LAVA) + (kindAt(game, c, r + 1) === TILE.LAVA);

  function environment(game) {
    const m = game.miner;
    if (m.state === 'rope' || m.state === 'faint' || m.state === 'win') return;
    const slow = 1 + 0.25 * game.stats.armor;
    const p = minerPos(game);
    let inGas = false;
    for (const cl of game.clouds) if (Math.hypot(p.x - (cl.c + 0.5), p.y - (cl.r + 0.5)) < cloudRadius(cl)) { inGas = true; break; }
    if (inGas) {
      m.gasT += DT;
      if (m.gasT >= m.gasNext) { damage(game, 1, 'gas'); m.gasT = 0; m.gasNext = CFG.gasTick * slow; }
    } else { m.gasT = 0; m.gasNext = CFG.gasGrace; }
    const adj = m.move
      ? Math.max(lavaNeighbours(game, m.move.fc, m.move.fr), lavaNeighbours(game, m.move.tc, m.move.tr))
      : lavaNeighbours(game, m.col, m.row);
    if (adj > 0) {
      m.heat += DT * (0.8 + 0.4 * adj);
      if (m.heat >= CFG.heatTick * slow) { damage(game, 1, 'heat'); m.heat = 0; }
    } else m.heat = Math.max(0, m.heat - DT * 1.5);
  }

  // ───────────────────────────── الصخور السائبة ─────────────────────────────
  function updateLoose(game) {
    for (let k = game.loose.length - 1; k >= 0; k--) {
      const b = game.loose[k];
      if (!b.fall) {
        b.wobble -= DT;
        if (b.wobble > 0) continue;
        if (kindAt(game, b.c, b.r + 1) !== TILE.AIR) { game.loose.splice(k, 1); continue; }   // عاد لها سند
        game.tiles[idx(b.c, b.r)] = TILE.AIR;
        b.fall = { step: 0 };
        emit(game, 'boulder_fall', { c: b.c, r: b.r });
        wake(game, b.c, b.r - 1);
        continue;
      }
      b.fall.step += DT;
      while (b.fall && b.fall.step >= CFG.fallStep) {
        b.fall.step -= CFG.fallStep;
        const nr = b.r + 1;
        if (occupies(game, b.c, nr)) {
          damage(game, game.stats.armor >= 3 ? CFG.boulderDamage - 1 : CFG.boulderDamage, 'boulder');
          emit(game, 'boulder_hit', { c: b.c, r: nr });
          game.loose.splice(k, 1); b.fall = null;
        } else if (kindAt(game, b.c, nr) === TILE.AIR) {
          b.r = nr;
        } else {
          game.tiles[idx(b.c, b.r)] = TILE.BOULDER;
          emit(game, 'boulder_land', { c: b.c, r: b.r });
          game.loose.splice(k, 1); b.fall = null;
        }
      }
    }
  }

  // لا يبدأ الروبوت حفر خام لا يمكن وضعه في الحقيبة الممتلئة أو استبداله بخام أعلى قيمة.
  function robotCanCollect(game, oreN) {
    if (game.bagCount < game.stats.bagCap) return true;
    const id = ORE_IDS[oreN - 1];
    if (!id) return false;
    let cheapest = Infinity;
    for (const key of ORE_IDS) if (game.bag[key] > 0) cheapest = Math.min(cheapest, ORES[key].price);
    return cheapest < ORES[id].price;
  }

  // الروبوت المرافق يحفر خامة مجاورة تلقائياً عندما يتوقف العامل عن الحركة.
  // التنفيذ داخل المحرك الحتمي نفسه، لذلك يعيد الخادم إنتاجه من سجل الأزرار دون ثقة بالعميل.
  function updateRobotAssist(game, input) {
    const level = game.eq.robot || 0;
    const m = game.miner;
    if (!level || game.status !== 'running' || m.state !== 'idle' || m.move || m.state === 'rope' ||
        Math.sign(Number(input && input.dx) || 0) || Math.sign(Number(input && input.dy) || 0)) {
      if (game.robot) { game.robot.dig = null; game.robot.blocked = false; }
      return;
    }
    const candidates = [[0, -1], [-1, 0], [1, 0], [0, 1]]
      .map(([dc, dr]) => ({ c: m.col + dc, r: m.row + dr, ore: oreAt(game, m.col + dc, m.row + dr) }))
      .filter((p) => kindAt(game, p.c, p.r) === TILE.ORE && p.ore > 0)
      .sort((a, b) => b.ore - a.ore || a.r - b.r || a.c - b.c);
    const target = candidates.find((p) => robotCanCollect(game, p.ore));
    if (!target) {
      game.robot.dig = null;
      game.robot.blocked = candidates.length > 0;
      return;
    }
    game.robot.blocked = false;
    let dig = game.robot.dig;
    if (!dig || dig.col !== target.c || dig.row !== target.r) {
      dig = game.robot.dig = { col: target.c, row: target.r, t: 0, need: digTime(game, target.c, target.r, TILE.ORE) / (1 + level * 0.35), hits: 0 };
    }
    dig.t += DT;
    if (dig.t >= dig.hits * CFG.hitPeriod) {
      dig.hits++;
      emit(game, 'robot_dig_hit', { c: dig.col, r: dig.row, ore: target.ore });
    }
    if (dig.t >= dig.need) {
      const { col, row } = dig;
      game.robot.dig = null;
      completeDig(game, col, row, TILE.ORE);
      emit(game, 'robot_mined', { c: col, r: row, ore: target.ore });
    }
  }

  // ───────────────────────────── النبضة الرئيسية ─────────────────────────────
  function tick(game, input) {
    if (game.status !== 'running') return false;
    game.tick++; game.time += DT;
    const m = game.miner;
    if (m.inv > 0) m.inv = Math.max(0, m.inv - DT);
    if (m.stun > 0) m.stun = Math.max(0, m.stun - DT);
    updateClouds(game);
    updateLoose(game);
    switch (m.state) {
      case 'rope': stepRope(game); break;
      case 'faint': m.faintT -= DT; if (m.faintT <= 0) finish(game, 'faint'); break;
      case 'win': m.winT -= DT; if (m.winT <= 0) finish(game, 'won'); break;
      case 'move': stepMove(game, input); break;
      default:
        if (m.stun > 0) m.state = 'hurt';
        else { if (m.state === 'hurt') m.state = 'idle'; decide(game, input, 0); }
    }
    if (game.status === 'running') updateRobotAssist(game, input);
    if (game.status === 'running') environment(game);
    return true;
  }

  // يقدّم اللعبة بزمن حقيقي (ثوانٍ) عبر نبضات ثابتة؛ الإطار البطيء جداً لا يُسرّع المحاكاة
  function advance(game, dt, input) {
    game.acc += clamp(Number(dt) || 0, 0, 0.1);
    let n = 0;
    while (game.acc >= DT && n < MAX_TICKS_PER_ADVANCE && game.status === 'running') { tick(game, input); game.acc -= DT; n++; }
    if (n >= MAX_TICKS_PER_ADVANCE) game.acc = 0;
    return n;
  }

  // ───────────────────────────── ملخصات للواجهة ─────────────────────────────
  function summary(game) {
    const m = game.miner;
    return {
      status: game.status, state: m.state, col: m.col, row: m.row,
      depthM: m.row * METERS_PER_ROW, maxDepthM: m.maxRow * METERS_PER_ROW,
      layer: layerIndex(m.row), hp: m.hp, maxHp: game.stats.maxHp,
      bag: Object.assign({}, game.bag), bagCount: game.bagCount, bagCap: game.stats.bagCap,
      value: bagValue(game.bag), legend: game.legend, time: game.time, tick: game.tick,
      loose: game.loose.length, clouds: game.clouds.length, robotBlocked: !!game.robot?.blocked, robotDig: game.robot?.dig ? { col: game.robot.dig.col, row: game.robot.dig.row, progress: Math.min(1, game.robot.dig.t / game.robot.dig.need) } : null,
    };
  }

  return {
    COLS, ROWS, MID, DT, METERS_PER_ROW, LAST_ROCK_ROW, CHEST_ROW, TILE, LAYERS, ORES, ORE_IDS, ORE_N, CFG, EQUIPMENT_KEYS, MAX_LEVEL,
    mulberry32, normalizeEquipment, loadoutStats, generate, create, layerIndex, hardnessAt,
    kindAt, oreAt, idx, diggable, digTime, minerPos, cloudRadius, fallingAt, ropeTime,
    tick, advance, ascend, drainEvents, summary, bagValue, bagTotal, keepBest,
  };
}));
