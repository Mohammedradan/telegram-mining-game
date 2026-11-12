'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const createPlatformAudio = require('../public/platform-audio');

function audioContext() {
  const calls = [];
  const param = { setValueAtTime: (...args) => calls.push(['set', ...args]), exponentialRampToValueAtTime: (...args) => calls.push(['ramp', ...args]) };
  const context = {
    state: 'suspended', currentTime: 1, destination: {},
    resume: async () => { context.state = 'running'; calls.push(['resume']); },
    createOscillator: () => ({ type: '', frequency: param, connect: () => {}, start: () => calls.push(['start']), stop: () => calls.push(['stop']) }),
    createGain: () => ({ gain: param, connect: () => {} }),
  };
  return { context, calls };
}

test('platform audio unlocks lazily and plays a synthesized event', async () => {
  const previousWindow = global.window;
  const fake = audioContext();
  global.window = { AudioContext: function AudioContext() { return fake.context; } };
  try {
    let muted = false;
    const audio = createPlatformAudio({ isMuted: () => muted, getVolume: () => 1 });
    audio.unlock();
    await Promise.resolve();
    assert.equal(fake.context.state, 'running');
    audio.beep('mine');
    assert.equal(fake.calls.filter(([name]) => name === 'start').length, 1);
    assert.equal(fake.calls.filter(([name]) => name === 'stop').length, 1);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test('platform audio respects mute and zero volume', () => {
  const previousWindow = global.window;
  const fake = audioContext();
  global.window = { AudioContext: function AudioContext() { return fake.context; } };
  try {
    let muted = true;
    let volume = 1;
    const audio = createPlatformAudio({ isMuted: () => muted, getVolume: () => volume });
    audio.unlock();
    audio.beep('jump');
    assert.equal(fake.calls.length, 0);
    muted = false;
    volume = 0;
    audio.unlock();
    audio.beep('jump');
    assert.equal(fake.calls.filter(([name]) => name === 'start').length, 0);
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});
