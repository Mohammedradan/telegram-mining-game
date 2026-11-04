/* صوت الكهف: أجواء مولَّدة (WebAudio، بلا ملفات) ومؤثرات الحفر العميق.
   • بساط الأجواء: درون منخفض يتنفّس + هواء الكهف + قطرات ماء ونغمات نادرة بعيدة؛ مزاجه يتبدّل مع كل طبقة.
   • المؤثرات: ضربة المعول، تفتّت الصخر، رنين الخامات (يعلو بسعرها)، الغاز، اهتزاز الصخرة السائبة وسقوطها، الحبل...
   عرض فقط: لا يلمس حالة اللعبة. مفتاح الكتم هو نفسه مفتاح ClickerFX فيبقى كتم واحد للتطبيق كله.
   الصوت يبدأ بعد لمسة المستخدم (unlock) كما تشترط المتصفحات، وعدد الأصوات المتزامنة محدود لحماية الهواتف الضعيفة. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CaveSound = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MUTE_KEY = 'mining-fx-muted';
  const MAX_VOICES = 24;
  const BED_VOLUME = 0.55;
  const num = (n, d = 0) => { const v = Number(n); return Number.isFinite(v) ? v : d; };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  // مزاج كل طبقة (الفهرس = رقم الطبقة + 1، و0 = السطح): جذر الدرون، سلّم النغمات النادرة، قطع المرشح،
  // ثقل الاهتزاز العميق، المدة بين حدثين (ثوانٍ)، ونوع القطرات (0 بلا، 1 قطرة ماء، 2 رنين بلّوري)
  const MOODS = Object.freeze([
    Object.freeze({ id: 'surface', root: 98.0, scale: [392, 440, 494, 587, 659], cutoff: 1100, rumble: 0, gap: [3.5, 7.0], drip: 0 }),
    Object.freeze({ id: 'stone', root: 55.0, scale: [220, 262, 294, 330, 392], cutoff: 520, rumble: 0, gap: [3.0, 6.5], drip: 1 }),
    Object.freeze({ id: 'iron', root: 73.4, scale: [147, 175, 196, 220, 262, 294], cutoff: 470, rumble: 0.25, gap: [3.0, 6.0], drip: 1 }),
    Object.freeze({ id: 'gold', root: 65.4, scale: [262, 294, 330, 392, 440], cutoff: 660, rumble: 0, gap: [2.6, 5.5], drip: 1 }),
    Object.freeze({ id: 'crystal', root: 82.4, scale: [330, 370, 415, 494, 554, 659], cutoff: 900, rumble: 0, gap: [1.8, 4.2], drip: 2 }),
    Object.freeze({ id: 'lava', root: 41.2, scale: [165, 175, 233, 247, 330], cutoff: 300, rumble: 0.8, gap: [3.5, 7.5], drip: 0 }),
  ]);

  // رنين كل خامة: سلّم خماسي يعلو بقيمتها
  const ORE_NOTES = Object.freeze({ copper: 523, iron: 587, gold: 659, crystal: 784, lava: 988, relic: 1175 });

  // قائمة بيضاء للمؤثرات + أقل فاصل بين مرتين من نفس المؤثر (مللي ثانية) كي لا يتراكم ضجيج
  const SFX_GAP = Object.freeze({
    dig: 45, crumble: 60, ore: 50, swap: 80, full: 200, relic: 300, gas: 200, rumble: 300, fall: 150, land: 100, hurt: 200,
    heat: 400, rope: 400, chest: 600, faint: 600, layer: 400, bump: 160, win: 600, tick: 80,
  });
  const SFX_NAMES = Object.freeze(Object.keys(SFX_GAP));

  function create(options) {
    const o = Object.assign({ storage: null, scope: typeof globalThis !== 'undefined' ? globalThis : {}, timers: null, rng: Math.random, now: () => Date.now() }, options || {});
    const scope = o.scope;
    const timers = o.timers || { setTimeout: (f, ms) => scope.setTimeout(f, ms), clearTimeout: (id) => scope.clearTimeout(id) };
    const rnd = () => o.rng();
    const readMuted = () => { try { return !!o.storage && o.storage.getItem(MUTE_KEY) === 'true'; } catch (e) { return false; } };

    let ac = null, master = null, send = null, noiseBuf = null;
    let muted = readMuted();
    let wantBed = false, mood = 0, bed = null, bedTimer = 0, voices = 0;
    const lastAt = {};
    const stats = { played: 0, dropped: 0 };

    function ctx() {
      if (muted) return null;
      try {
        if (!ac) {
          const AC = scope.AudioContext || scope.webkitAudioContext;
          if (!AC) return null;
          ac = new AC();
          master = ac.createGain();
          master.gain.value = 0.5;
          let out = master;
          if (typeof ac.createDynamicsCompressor === 'function') { const comp = ac.createDynamicsCompressor(); master.connect(comp); out = comp; }
          out.connect(ac.destination);
          // صدى الكهف: تأخير قصير بتغذية راجعة مصفّاة يُرسَل إليه النغمات الرنّانة فقط
          send = ac.createGain();
          send.gain.value = 0.24;
          if (typeof ac.createDelay === 'function') {
            const delay = ac.createDelay(0.8), fb = ac.createGain(), lp = ac.createBiquadFilter();
            delay.delayTime.value = 0.27; fb.gain.value = 0.34; lp.type = 'lowpass'; lp.frequency.value = 1700;
            send.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(master);
          }
        }
        if (ac.state === 'suspended' && ac.resume) ac.resume();
        return ac;
      } catch (e) { return null; }
    }

    function noiseBuffer(c) {
      if (noiseBuf) return noiseBuf;
      const len = Math.max(1, Math.floor(num(c.sampleRate, 22050)));
      noiseBuf = c.createBuffer(1, len, len);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = rnd() * 2 - 1;
      return noiseBuf;
    }

    // صوت واحد: يُحسب ضمن الحد الأقصى ويُحرَّر بعد مدته
    function claim(durationSec) {
      if (voices >= MAX_VOICES) { stats.dropped++; return false; }
      voices++;
      timers.setTimeout(() => { voices = Math.max(0, voices - 1); }, Math.round(durationSec * 1000) + 120);
      return true;
    }

    function tone(freq, dur, opt) {
      const c = ctx();
      if (!c || !claim(dur)) return;
      try {
        const a = opt || {};
        const t = num(c.currentTime) + num(a.delay);
        const osc = c.createOscillator(), g = c.createGain();
        osc.type = a.type || 'triangle';
        osc.frequency.setValueAtTime(freq, t);
        if (a.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + a.slide), t + dur);
        const atk = Math.min(num(a.attack, 0.008), dur * 0.6);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, num(a.vol, 0.06)), t + atk);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(g); g.connect(master);
        if (a.wet && send) g.connect(send);
        osc.start(t); osc.stop(t + dur + 0.04);
        stats.played++;
      } catch (e) { /* صوت اختياري */ }
    }

    function noise(dur, opt) {
      const c = ctx();
      if (!c || !claim(dur)) return;
      try {
        const a = opt || {};
        const t = num(c.currentTime) + num(a.delay);
        const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
        src.buffer = noiseBuffer(c);
        f.type = a.type || 'lowpass';
        f.Q.value = num(a.q, 0.8);
        f.frequency.setValueAtTime(num(a.freq, 800), t);
        if (a.freq2) f.frequency.exponentialRampToValueAtTime(Math.max(40, a.freq2), t + dur);
        const atk = Math.min(num(a.attack, 0.006), dur * 0.6);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(Math.max(0.0002, num(a.vol, 0.1)), t + atk);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(f); f.connect(g); g.connect(master);
        src.start(t); src.stop(t + dur + 0.04);
        stats.played++;
      } catch (e) { /* صوت اختياري */ }
    }

    // ───────── المؤثرات ─────────
    const fx = {
      dig(a) { const k = 0.9 + rnd() * 0.2, h = clamp(num(a && a.hard, 1), 1, 5); noise(0.05, { type: 'bandpass', freq: (820 + h * 280) * k, q: 1.2, vol: 0.17 }); tone(125 * k, 0.09, { type: 'sine', slide: -60, vol: 0.13 }); },
      crumble() { noise(0.24, { type: 'lowpass', freq: 1500, freq2: 280, vol: 0.2 }); tone(92, 0.2, { type: 'sine', slide: -46, vol: 0.15 }); },
      ore(a) { const f = ORE_NOTES[a && a.kind] || 523; tone(f, 0.3, { vol: 0.1, wet: true }); tone(f * 2, 0.22, { type: 'sine', vol: 0.04, delay: 0.05, wet: true }); tone(f * 1.5, 0.24, { type: 'sine', vol: 0.045, delay: 0.1, wet: true }); },
      swap(a) { tone(330, 0.1, { type: 'square', slide: -120, vol: 0.05 }); fx.ore(a); },
      full() { tone(170, 0.12, { type: 'square', vol: 0.06 }); tone(130, 0.16, { type: 'square', vol: 0.06, delay: 0.1 }); },
      relic() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.5, { vol: 0.08, delay: i * 0.09, wet: true })); noise(0.5, { type: 'highpass', freq: 5200, vol: 0.05, delay: 0.1 }); },
      gas() { noise(0.55, { type: 'bandpass', freq: 2600, freq2: 1300, q: 0.9, vol: 0.14 }); tone(75, 0.3, { type: 'sine', slide: -20, vol: 0.1 }); },
      rumble() { noise(0.7, { type: 'lowpass', freq: 130, vol: 0.28, attack: 0.15 }); tone(48, 0.7, { type: 'sine', vol: 0.12, attack: 0.2 }); },
      fall() { noise(0.28, { type: 'bandpass', freq: 900, freq2: 220, q: 0.7, vol: 0.13 }); },
      land() { tone(80, 0.3, { type: 'sine', slide: -42, vol: 0.22 }); noise(0.2, { type: 'lowpass', freq: 380, vol: 0.2 }); },
      hurt() { tone(310, 0.26, { type: 'sawtooth', slide: -200, vol: 0.07 }); noise(0.14, { type: 'lowpass', freq: 700, vol: 0.12 }); },
      heat() { noise(0.35, { type: 'highpass', freq: 3800, vol: 0.07 }); noise(0.2, { type: 'bandpass', freq: 1800, vol: 0.05, delay: 0.1 }); },
      rope() { tone(190, 0.9, { type: 'triangle', slide: 340, vol: 0.06, attack: 0.1 }); noise(0.9, { type: 'bandpass', freq: 700, freq2: 1800, q: 1.4, vol: 0.05 }); },
      chest() { [392, 494, 587, 784, 988, 1175].forEach((f, i) => tone(f, 0.7, { vol: 0.085, delay: i * 0.1, wet: true })); noise(0.8, { type: 'highpass', freq: 5000, vol: 0.05, delay: 0.2 }); },
      faint() { tone(440, 1.0, { type: 'sawtooth', slide: -380, vol: 0.06 }); noise(0.9, { type: 'lowpass', freq: 400, freq2: 90, vol: 0.12 }); },
      layer() { tone(392, 0.4, { vol: 0.06, wet: true }); tone(523, 0.6, { vol: 0.06, delay: 0.16, wet: true }); },
      bump() { tone(115, 0.05, { type: 'square', vol: 0.05 }); },
      win() { fx.chest(); },
      tick() { tone(880, 0.05, { type: 'sine', vol: 0.04 }); },
    };

    function sfx(name, args) {
      if (!SFX_NAMES.includes(name) || muted) return false;
      const now = num(o.now());
      if (now - num(lastAt[name], -1e9) < SFX_GAP[name]) return false;
      if (!ctx()) return false;
      lastAt[name] = now;
      try { fx[name](args || {}); return true; } catch (e) { return false; }
    }

    // ───────── بساط الأجواء ─────────
    function startBed() {
      const c = ctx();
      if (!c || bed) return;
      try {
        const m = MOODS[mood];
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, num(c.currentTime));
        g.gain.linearRampToValueAtTime(BED_VOLUME, num(c.currentTime) + 1.4);
        g.connect(master);
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass'; lp.frequency.value = m.cutoff; lp.Q.value = 0.7;
        lp.connect(g);
        const oscs = [[1, 'sine', 0.5, -5], [1.5, 'sine', 0.2, 4], [2, 'triangle', 0.14, 7]].map(([mul, type, vol, det]) => {
          const osc = c.createOscillator(), og = c.createGain();
          osc.type = type; osc.frequency.value = m.root * mul; osc.detune.value = det; og.gain.value = vol;
          osc.connect(og); og.connect(lp); osc.start();
          return { osc, mul };
        });
        const lfo = c.createOscillator(), lg = c.createGain();      // يهزّ قطع المرشح ببطء فتتنفس الأجواء
        lfo.frequency.value = 0.07; lg.gain.value = m.cutoff * 0.35;
        lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
        const air = c.createBufferSource(), bp = c.createBiquadFilter(), ag = c.createGain();   // هواء الكهف
        air.buffer = noiseBuffer(c); air.loop = true; bp.type = 'bandpass'; bp.frequency.value = 360; bp.Q.value = 0.6; ag.gain.value = 0.02;
        air.connect(bp); bp.connect(ag); ag.connect(g); air.start();
        const deep = c.createBufferSource(), dl = c.createBiquadFilter(), dg = c.createGain();  // اهتزاز عميق (الحمم والحديد)
        deep.buffer = noiseBuffer(c); deep.loop = true; dl.type = 'lowpass'; dl.frequency.value = 95; dg.gain.value = m.rumble * 0.07;
        deep.connect(dl); dl.connect(dg); dg.connect(g); deep.start();
        bed = { g, lp, oscs, lfo, lg, air, deep, dg };
        scheduleAmbient();
      } catch (e) { bed = null; }
    }

    function ambientEvent() {
      const m = MOODS[mood];
      if (m.drip && rnd() < 0.5) {
        const base = m.drip === 2 ? 1900 + rnd() * 900 : 1100 + rnd() * 500;
        tone(base, m.drip === 2 ? 0.5 : 0.11, { type: 'sine', slide: m.drip === 2 ? 0 : -420, vol: m.drip === 2 ? 0.035 : 0.05, wet: true });
      } else {
        const f = m.scale[Math.floor(rnd() * m.scale.length)];
        tone(f, 1.7, { type: 'triangle', vol: 0.032, attack: 0.3, wet: true });
        if (m.id === 'crystal') tone(f * 2, 1.2, { type: 'sine', vol: 0.016, attack: 0.2, delay: 0.14, wet: true });
      }
    }

    function scheduleAmbient() {
      if (bedTimer) timers.clearTimeout(bedTimer);
      const gap = MOODS[mood].gap;
      bedTimer = timers.setTimeout(() => { bedTimer = 0; if (!bed) return; ambientEvent(); scheduleAmbient(); }, Math.round((gap[0] + rnd() * (gap[1] - gap[0])) * 1000));
    }

    function stopBed(fadeSec) {
      if (bedTimer) { timers.clearTimeout(bedTimer); bedTimer = 0; }
      const b = bed;
      if (!b) return;
      bed = null;
      try {
        const t = num(ac && ac.currentTime), f = clamp(num(fadeSec, 0.6), 0.05, 3);
        b.g.gain.cancelScheduledValues && b.g.gain.cancelScheduledValues(t);
        b.g.gain.setValueAtTime(Math.max(0.0001, num(b.g.gain.value, BED_VOLUME)), t);
        b.g.gain.linearRampToValueAtTime(0.0001, t + f);
        const kill = () => { try { b.oscs.forEach((x) => x.osc.stop()); b.lfo.stop(); b.air.stop(); b.deep.stop(); b.g.disconnect(); } catch (e) { /* انتهى */ } };
        timers.setTimeout(kill, Math.round(f * 1000) + 80);
      } catch (e) { /* صوت اختياري */ }
    }

    // يُسمَع من لمسة المستخدم (فتح الحفر العميق): ينشئ السياق ويستأنفه
    function unlock() { ctx(); }

    function start(layerIndex) {
      wantBed = true;
      mood = clamp(Math.floor(num(layerIndex, -1)) + 1, 0, MOODS.length - 1);
      startBed();
    }

    function stop(fadeSec) {
      wantBed = false;
      stopBed(fadeSec);
    }

    // تبديل مزاج الأجواء بنعومة عند دخول طبقة جديدة
    function setLayer(layerIndex) {
      const next = clamp(Math.floor(num(layerIndex, -1)) + 1, 0, MOODS.length - 1);
      if (next === mood) return;
      mood = next;
      if (!bed || !ac) return;
      try {
        const m = MOODS[mood], t = num(ac.currentTime);
        bed.oscs.forEach((x) => x.osc.frequency.setTargetAtTime(m.root * x.mul, t, 0.9));
        bed.lp.frequency.setTargetAtTime(m.cutoff, t, 0.9);
        bed.lg.gain.setTargetAtTime(m.cutoff * 0.35, t, 0.9);
        bed.dg.gain.setTargetAtTime(m.rumble * 0.07, t, 0.9);
        scheduleAmbient();
      } catch (e) { /* صوت اختياري */ }
    }

    function setMuted(v) {
      muted = !!v;
      try { o.storage && o.storage.setItem(MUTE_KEY, String(muted)); } catch (e) { /* التخزين غير متاح */ }
      if (muted) {
        stopBed(0.2);
        try { if (ac && ac.suspend) ac.suspend(); } catch (e) { /* صوت اختياري */ }
      } else {
        ctx();
        if (wantBed) startBed();
      }
    }

    // الكتم قد يُغيَّر من شاشة التعدين: نعيد قراءة المفتاح المشترك عند الفتح
    function syncMuted() {
      const m = readMuted();
      if (m !== muted) setMuted(m);
      return muted;
    }

    function inspect() {
      return { muted, mood: MOODS[mood].id, bed: !!bed, wantBed, voices, ctx: !!ac, played: stats.played, dropped: stats.dropped, timer: !!bedTimer };
    }

    return { get muted() { return muted; }, sfx, start, stop, setLayer, setMuted, syncMuted, unlock, inspect };
  }

  return { MUTE_KEY, MOODS, ORE_NOTES, SFX_NAMES, SFX_GAP, MAX_VOICES, create };
});
