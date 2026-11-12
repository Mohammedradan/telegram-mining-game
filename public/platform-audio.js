/* Platform game audio synthesis. Kept separate from deterministic simulation and rendering. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.PlatformAudio = { create: factory };
})(typeof globalThis !== 'undefined' ? globalThis : this, function createPlatformAudio({ isMuted = () => false, getVolume = () => 1 } = {}) {
  'use strict';
  let audio = null;
  function audioUnlock() {
    if (isMuted()) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!audio && AC) audio = new AC();
      audio?.resume()?.catch(() => {});
    } catch (_) {}
  }

  // Richer sound synthesis with per-event timbres
  function beep(type) {
    if (isMuted() || getVolume() === 0 || !audio || audio.state !== 'running') return;
    try {
      const defs = {
        jump: { freq: 440, dur: 0.14, type: 'sine', slide: 660 },
        land: { freq: 90, dur: 0.12, type: 'triangle', slide: 70 },
        mine: { freq: 160, dur: 0.11, type: 'triangle', slide: 220 },
        mine_miss: { freq: 120, dur: 0.08, type: 'triangle', slide: 90 },
        robot_mine: { freq: 300, dur: 0.09, type: 'square', slide: 420 },
        attack: { freq: 520, dur: 0.12, type: 'sawtooth', slide: 380 },
        hit: { freq: 720, dur: 0.10, type: 'sawtooth', slide: 480 },
        enemy_death: { freq: 280, dur: 0.22, type: 'triangle', slide: 120 },
        skill: { freq: 780, dur: 0.18, type: 'sine', slide: 1050 },
        collect: { freq: 880, dur: 0.13, type: 'sine', slide: 1220 },
        hurt: { freq: 110, dur: 0.18, type: 'sawtooth', slide: 55 },
        win: { freq: 1040, dur: 0.22, type: 'sine', slide: 1560 },
        game_over: { freq: 140, dur: 0.32, type: 'triangle', slide: 70 },
        // الخفاش (B5): نبرة هابطة سريعة للانقضاض، وطرقة خفيفة للهبوط — لا تُلتبس بضربة الزعيم
        // (الزعيم 72→38 مثلث ثقيل؛ الخفاش 900→340 سنّ منشاري قصير، والهبوط 220→140).
        bat_dive: { freq: 900, dur: 0.13, type: 'sawtooth', slide: 340 },
        bat_land: { freq: 220, dur: 0.1, type: 'triangle', slide: 140 },
        // الزعماء: كل حدث له نبرة تُعرَف بلا نظر (إنذار صاعد، ضربة ثقيلة، انهيار، رنين الدرع)
        clang: { freq: 1500, dur: 0.09, type: 'square', slide: 900 },
        boss_wake: { freq: 90, dur: 0.5, type: 'sawtooth', slide: 52 },
        boss_windup: { freq: 260, dur: 0.32, type: 'sawtooth', slide: 560 },
        boss_slam: { freq: 72, dur: 0.3, type: 'triangle', slide: 38 },
        boss_charge: { freq: 120, dur: 0.36, type: 'sawtooth', slide: 230 },
        boss_crash: { freq: 95, dur: 0.38, type: 'square', slide: 40 },
        boss_stun: { freq: 700, dur: 0.14, type: 'sine', slide: 420 },
        boss_enrage: { freq: 210, dur: 0.5, type: 'sawtooth', slide: 92 },
        boss_death: { freq: 320, dur: 0.7, type: 'triangle', slide: 60 },
        // V8: نبرات القتال الجديد — ضربة ثقيلة، مراوغة، صدّ، ترنّح
        swing: { freq: 640, dur: 0.07, type: 'sawtooth', slide: 300 },
        heavy: { freq: 190, dur: 0.2, type: 'square', slide: 90 },
        dodge: { freq: 900, dur: 0.1, type: 'sine', slide: 320 },
        guard: { freq: 1200, dur: 0.1, type: 'square', slide: 700 },
        evade: { freq: 1320, dur: 0.09, type: 'sine', slide: 1700 },
        stagger: { freq: 380, dur: 0.16, type: 'triangle', slide: 160 },
        swing_hit: { freq: 760, dur: 0.1, type: 'sawtooth', slide: 300 },
        enemy_stagger: { freq: 380, dur: 0.16, type: 'triangle', slide: 160 },
        enemy_slash: { freq: 420, dur: 0.1, type: 'sawtooth', slide: 240 },
        enemy_block: { freq: 980, dur: 0.08, type: 'square', slide: 620 },
        // ظل الساكورا: صعود ثم ضربة مزدوجة — نبرتان تُعرفان بلا نظر
        skill_shadow: { freq: 620, dur: 0.26, type: 'sine', slide: 1680 },
        skill_hit: { freq: 240, dur: 0.14, type: 'square', slide: 120 },
      };
      const d = defs[type] || { freq: 300, dur: 0.12, type: 'sine', slide: 360 };
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = d.type;
      o.frequency.setValueAtTime(d.freq, audio.currentTime);
      if (d.slide) o.frequency.exponentialRampToValueAtTime(d.slide, audio.currentTime + d.dur * 0.7);
      g.gain.setValueAtTime(0.055, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d.dur);
      o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + d.dur);
      // second harmonic for win/collect
      if (type === 'win' || type === 'collect') {
        const o2 = audio.createOscillator(), g2 = audio.createGain();
        o2.type = 'sine';
        o2.frequency.setValueAtTime(d.freq * 1.5, audio.currentTime);
        o2.frequency.exponentialRampToValueAtTime(d.slide * 1.5, audio.currentTime + d.dur);
        g2.gain.setValueAtTime(0.022, audio.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + d.dur);
        o2.connect(g2); g2.connect(audio.destination);
        o2.start(); o2.stop(audio.currentTime + d.dur);
      }
    } catch (_) {}
  }


  return Object.freeze({ unlock: audioUnlock, beep });
});
