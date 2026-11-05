// اختبارات صوت الكهف (public/cave-sound.js) بسياق WebAudio مزيّف ومؤقتات يدوية: لا جهاز صوت ولا انتظار حقيقي.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const CaveSound = require('../public/cave-sound.js');

function fakeAudio() {
  const log = { nodes: [], started: 0, stopped: 0, suspended: 0, resumed: 0, oscs: [] };
  class Param {
    constructor(v = 0) { this.value = v; this.calls = []; }
    setValueAtTime(v, t) { this.value = v; this.calls.push(['set', v, t]); }
    linearRampToValueAtTime(v, t) { this.calls.push(['lin', v, t]); }
    exponentialRampToValueAtTime(v, t) { this.calls.push(['exp', v, t]); }
    setTargetAtTime(v, t, k) { this.calls.push(['target', v, t, k]); }
    cancelScheduledValues(t) { this.calls.push(['cancel', t]); }
  }
  class Node { constructor(kind) { this.kind = kind; this.out = []; log.nodes.push(this); } connect(n) { this.out.push(n); return n; } disconnect() { this.disconnected = true; } }
  class Osc extends Node { constructor() { super('osc'); this.frequency = new Param(440); this.detune = new Param(0); this.type = 'sine'; log.oscs.push(this); } start() { log.started++; } stop() { log.stopped++; } }
  class Gain extends Node { constructor() { super('gain'); this.gain = new Param(1); } }
  class Filter extends Node { constructor() { super('filter'); this.frequency = new Param(350); this.Q = new Param(1); this.type = 'lowpass'; } }
  class Src extends Node { constructor() { super('src'); this.loop = false; this.buffer = null; } start() { log.started++; } stop() { log.stopped++; } }
  class Delay extends Node { constructor() { super('delay'); this.delayTime = new Param(0); } }
  class Comp extends Node { constructor() { super('comp'); } }
  class AC {
    constructor() { log.ctx = this; this.currentTime = 0; this.sampleRate = 8000; this.state = 'running'; this.destination = new Node('dest'); }
    createOscillator() { return new Osc(); } createGain() { return new Gain(); } createBiquadFilter() { return new Filter(); }
    createBufferSource() { return new Src(); } createBuffer(ch, len) { return { getChannelData() { return new Float32Array(len); } }; }
    createDelay() { return new Delay(); } createDynamicsCompressor() { return new Comp(); }
    suspend() { this.state = 'suspended'; log.suspended++; } resume() { this.state = 'running'; log.resumed++; }
  }
  return { AC, log };
}

function fakeTimers() {
  let now = 0, id = 0;
  const q = new Map();
  return {
    setTimeout(f, ms) { q.set(++id, { f, at: now + ms }); return id; },
    clearTimeout(i) { q.delete(i); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...q.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; q.delete(next[0]); next[1].f();
      }
      now = end;
    },
    get pending() { return q.size; },
  };
}

function memoryStorage(initial) {
  const m = new Map(Object.entries(initial || {}));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}

function rig(opts = {}) {
  const audio = fakeAudio(), timers = fakeTimers(), storage = memoryStorage(opts.storage);
  let clock = 0;
  const seq = [0.1, 0.8, 0.35, 0.6, 0.2, 0.9, 0.5, 0.75];
  let i = 0;
  const sound = CaveSound.create({ storage, scope: opts.noAudio ? {} : { AudioContext: audio.AC }, timers, rng: () => seq[i++ % seq.length], now: () => clock });
  return { sound, audio, timers, storage, tick: (ms) => { clock += ms; }, get clock() { return clock; } };
}

test('without AudioContext every call is a safe no-op', () => {
  const r = rig({ noAudio: true });
  assert.equal(r.sound.sfx('dig'), false);
  r.sound.start(0); r.sound.setLayer(2); r.sound.stop(); r.sound.unlock();
  assert.equal(r.sound.inspect().ctx, false);
  assert.equal(r.sound.inspect().bed, false);
});

test('the mute switch is the shared ClickerFX key; muted means no context at all', () => {
  assert.equal(CaveSound.MUTE_KEY, 'mining-fx-muted');
  const r = rig({ storage: { 'mining-fx-muted': 'true' } });
  assert.equal(r.sound.muted, true);
  assert.equal(r.sound.sfx('ore', { kind: 'gold' }), false);
  r.sound.start(0);
  assert.equal(r.sound.inspect().ctx, false, 'الصامت لا ينشئ سياق صوت');
  assert.equal(r.audio.log.nodes.length, 0);
  r.sound.setMuted(false);
  assert.equal(r.storage.getItem('mining-fx-muted'), 'false');
  assert.equal(r.sound.sfx('ore', { kind: 'gold' }), true);
  assert.ok(r.audio.log.started > 0);
  assert.equal(r.sound.inspect().bed, true, 'البساط كان مطلوباً قبل الكتم فيبدأ عند رفعه');
});

test('only whitelisted effects play, and each of them produces sound', () => {
  const r = rig();
  assert.equal(r.sound.sfx('nonsense'), false);
  assert.equal(r.sound.sfx('constructor'), false);
  assert.equal(r.sound.sfx(), false);
  for (const name of CaveSound.SFX_NAMES) {
    const before = r.audio.log.started;
    r.tick(1000);
    r.timers.advance(3000);                            // تُحرَّر الأصوات السابقة (وإلا بلغنا الحد الأقصى بين المؤثرات)
    assert.equal(r.sound.sfx(name, { kind: 'crystal', hard: 3 }), true, name);
    assert.ok(r.audio.log.started > before, `${name} لم يُصدر صوتاً`);
  }
});

test('the same effect is rate limited so a held pick does not pile up noise', () => {
  const r = rig();
  assert.equal(r.sound.sfx('dig'), true);
  assert.equal(r.sound.sfx('dig'), false, 'ضمن الفاصل');
  r.tick(CaveSound.SFX_GAP.dig + 1);
  assert.equal(r.sound.sfx('dig'), true);
  assert.equal(r.sound.sfx('ore', { kind: 'copper' }), true, 'مؤثر آخر مستقل');
});

test('voices are capped to protect weak phones, and released by their own timers', () => {
  const r = rig();
  for (let i = 0; i < 8; i++) { r.tick(400); r.sound.sfx('relic'); }
  const s = r.sound.inspect();
  assert.ok(s.voices <= CaveSound.MAX_VOICES, `${s.voices} أصوات`);
  assert.ok(s.dropped > 0, 'ما زاد عن الحد أُسقط');
  r.timers.advance(5000);
  assert.equal(r.sound.inspect().voices, 0);
});

test('ore chimes rise with the ore: copper < iron < gold < crystal < lava < relic', () => {
  const firstFreq = (kind) => {
    const r = rig();
    r.sound.sfx('ore', { kind });
    return r.audio.log.oscs[0].frequency.calls[0][1];
  };
  const f = ['copper', 'iron', 'gold', 'crystal', 'lava', 'relic'].map(firstFreq);
  assert.deepEqual(f, [...f].sort((a, b) => a - b));
  assert.equal(new Set(f).size, 6);
});

test('ambience: starts a drone + air bed, schedules sparse events, and stops cleanly with a fade', () => {
  const r = rig();
  r.sound.start(-1);
  let s = r.sound.inspect();
  assert.equal(s.bed, true); assert.equal(s.mood, 'surface'); assert.equal(s.timer, true);
  assert.ok(r.audio.log.started >= 6, 'ثلاثة أوتار + LFO + هواء + اهتزاز عميق');
  const played0 = s.played;
  r.timers.advance(8000);
  s = r.sound.inspect();
  assert.ok(s.played > played0, 'نغمة أو قطرة بعيدة');
  assert.equal(s.timer, true, 'تُجدول التالية');
  const stoppedBefore = r.audio.log.stopped;
  r.sound.stop(0.5);
  s = r.sound.inspect();
  assert.equal(s.bed, false); assert.equal(s.wantBed, false); assert.equal(s.timer, false);
  r.timers.advance(1000);
  assert.ok(r.audio.log.stopped > stoppedBefore, 'الأوتار تُوقف بعد التلاشي');
  r.timers.advance(20000);
  assert.equal(r.sound.inspect().played, s.played, 'لا أحداث بعد الإيقاف');
  assert.equal(r.timers.pending, 0);
});

test('entering a deeper layer retunes the drone smoothly and changes the mood once', () => {
  const r = rig();
  r.sound.start(0);
  assert.equal(r.sound.inspect().mood, 'stone');
  const droneOsc = r.audio.log.oscs[0];
  const callsBefore = droneOsc.frequency.calls.length;
  r.sound.setLayer(4);
  assert.equal(r.sound.inspect().mood, 'lava');
  const call = droneOsc.frequency.calls.slice(callsBefore).find((c) => c[0] === 'target');
  assert.ok(call, 'تدرّج ناعم لا قفزة');
  assert.ok(Math.abs(call[1] - CaveSound.MOODS[5].root) < 0.01, 'جذر الحمم');
  const n = droneOsc.frequency.calls.length;
  r.sound.setLayer(4);
  assert.equal(droneOsc.frequency.calls.length, n, 'الطبقة نفسها لا تعيد الضبط');
  r.sound.setLayer(-1);
  assert.equal(r.sound.inspect().mood, 'surface');
  r.sound.setLayer(99);
  assert.equal(r.sound.inspect().mood, 'lava', 'خارج النطاق يُقصّ');
});

test('muting stops and suspends; unmuting resumes the bed; the stored key can be re-read after the hub changes it', () => {
  const r = rig();
  r.sound.start(1);
  assert.equal(r.sound.inspect().bed, true);
  r.sound.setMuted(true);
  assert.equal(r.sound.inspect().bed, false);
  assert.equal(r.audio.log.ctx.state, 'suspended');
  assert.equal(r.storage.getItem('mining-fx-muted'), 'true');
  assert.equal(r.sound.sfx('ore', { kind: 'gold' }), false);
  r.storage.setItem('mining-fx-muted', 'false');       // غُيّر من شاشة التعدين
  assert.equal(r.sound.syncMuted(), false);
  assert.equal(r.sound.inspect().bed, true, 'يعود البساط');
  assert.equal(r.audio.log.ctx.state, 'running');
  r.storage.setItem('mining-fx-muted', 'true');
  assert.equal(r.sound.syncMuted(), true);
  assert.equal(r.sound.inspect().bed, false);
});

test('a suspended context is resumed on the next effect (browsers suspend until a user gesture)', () => {
  const r = rig();
  r.sound.unlock();
  r.audio.log.ctx.state = 'suspended';
  const resumed = r.audio.log.resumed;
  r.sound.sfx('bump');
  assert.equal(r.audio.log.resumed, resumed + 1);
});

test('a throwing audio engine never breaks the game', () => {
  const bad = { AudioContext: class { constructor() { throw new Error('no audio device'); } } };
  const sound = CaveSound.create({ storage: memoryStorage(), scope: bad, timers: fakeTimers() });
  assert.equal(sound.sfx('dig'), false);
  sound.start(0); sound.setLayer(1); sound.stop(); sound.setMuted(true); sound.setMuted(false);
  assert.equal(sound.inspect().bed, false);
});

test('every mood has a usable scale, a cutoff and ambient gaps; the lava layer is the darkest and heaviest', () => {
  assert.equal(CaveSound.MOODS.length, 6);
  for (const m of CaveSound.MOODS) {
    assert.ok(m.scale.length >= 5 && m.scale.every((f) => f > 80 && f < 2000), m.id);
    assert.ok(m.gap[0] > 0 && m.gap[1] > m.gap[0], m.id);
    assert.ok(m.cutoff >= 200 && m.cutoff <= 1500, m.id);
  }
  const lava = CaveSound.MOODS[5];
  assert.ok(lava.cutoff === Math.min(...CaveSound.MOODS.map((m) => m.cutoff)));
  assert.ok(lava.rumble === Math.max(...CaveSound.MOODS.map((m) => m.rumble)));
  assert.ok(lava.root === Math.min(...CaveSound.MOODS.map((m) => m.root)));
});
