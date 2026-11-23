// The camera is presentation only, but it must be correct: clamped to the world,
// smooth, frame-rate independent, and stable when the world is smaller than the screen.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Camera = require('../public/adventure/adventure-camera');
const M = require('../public/adventure/stone-mine-map');

const VIEW = { worldW: M.WIDTH, worldH: M.HEIGHT };

test('the camera never shows outside the map on either axis', () => {
  const viewports = [[320, 568], [390, 844], [844, 390], [1280, 800], [1920, 1080]];
  for (const [w, h] of viewports) {
    for (const x of [0, 60, 1700, M.WIDTH - 10]) {
      for (const y of [0, 340, 940, M.HEIGHT]) {
        const target = Camera.targetFor({ ...VIEW, viewW: w, viewH: h, x, y, w: 24, h: 40, facing: 1 });
        assert.ok(target.x >= 0 && target.x <= Math.max(0, M.WIDTH - w), `x=${target.x} at ${w}x${h}`);
        assert.ok(target.y >= 0 && target.y <= Math.max(0, M.HEIGHT - h), `y=${target.y} at ${w}x${h}`);
      }
    }
  }
});

test('the camera follows a walking miner across several screens', () => {
  const camera = Camera.create();
  const view = (x) => ({ ...VIEW, viewW: 390, viewH: 844, x, y: 300, w: 24, h: 40, facing: 1 });
  camera.jumpTo(view(120));
  const start = camera.position.x;
  for (let x = 120; x < 2600; x += 4) camera.update(view(x), 1 / 60);
  const end = camera.position.x;
  // The camera leads slightly ahead of the facing direction, so "west edge" means
  // within a look-ahead of zero rather than exactly zero.
  assert.ok(start >= 0 && start < 90, `starts at the west edge (${start.toFixed(1)})`);
  assert.ok(end - start > 1500, `the view travelled with the miner (${(end - start).toFixed(0)}px)`);
  assert.ok(end <= M.WIDTH - 390, 'and stopped at the east clamp');
});

test('the follow is frame-rate independent', () => {
  // A fixed focal point isolates the smoothing from the input path: after the same
  // elapsed time, every refresh rate must land in the same place.
  const view = { ...VIEW, viewW: 390, viewH: 844, x: 1700, y: 300, w: 24, h: 40, facing: 1 };
  const settle = (fps, seconds) => {
    const camera = Camera.create();
    camera.jumpTo({ ...view, x: 120 });
    for (let i = 0; i < fps * seconds; i++) camera.update(view, 1 / fps);
    return camera.position.x;
  };
  const at30 = settle(30, 0.5);
  const at60 = settle(60, 0.5);
  const at120 = settle(120, 0.5);
  assert.ok(Math.abs(at60 - at30) < 2.5, `30 and 60 fps agree (${at30.toFixed(1)} vs ${at60.toFixed(1)})`);
  assert.ok(Math.abs(at60 - at120) < 2.5, `60 and 120 fps agree (${at120.toFixed(1)} vs ${at60.toFixed(1)})`);
});

test('a teleport snaps instead of sliding through the world', () => {
  const camera = Camera.create();
  const view = (x, y) => ({ ...VIEW, viewW: 390, viewH: 844, x, y, w: 24, h: 40, facing: 1 });
  camera.jumpTo(view(120, 300));
  const before = camera.position.x;
  camera.update(view(3100, 900), 1 / 60);
  assert.ok(camera.position.x - before > 1000, 'a lift ride to the far east arrives immediately');
});

test('a world smaller than the viewport is centred, never negative-clamped', () => {
  const small = { worldW: 400, worldH: 300, viewW: 800, viewH: 600, x: 200, y: 150, w: 24, h: 40, facing: 1 };
  const target = Camera.targetFor(small);
  assert.equal(target.x, -200, 'centres the world horizontally');
  assert.equal(target.y, -150, 'and vertically');
});

test('the facing direction leads the camera without leaving the clamp', () => {
  const base = { ...VIEW, viewW: 390, viewH: 844, x: 1700, y: 300, w: 24, h: 40 };
  const right = Camera.targetFor({ ...base, facing: 1 });
  const left = Camera.targetFor({ ...base, facing: -1 });
  assert.ok(right.x > left.x, 'looking right shows more of the right side');
  assert.ok(right.x - left.x < 390, 'the lead never exceeds a screen');
  assert.ok(left.x >= 0 && right.x <= M.WIDTH - 390);
});

test('screen conversion and culling agree with the camera position', () => {
  const cam = { x: 1400, y: 340 };
  const vein = { x: 1560, y: 340, w: 36, h: 40 };
  const screen = Camera.toScreen(vein, cam);
  assert.equal(screen.x, 160);
  assert.equal(screen.y, 0);
  const visible = Camera.viewportBox(cam, 390, 844);
  assert.equal(Camera.intersects(visible, vein), true);
  assert.equal(Camera.intersects(visible, { x: 3000, y: 340, w: 36, h: 40 }), false, 'off-screen veins are culled');
});

test('a dead zone stops idle jitter while walking slowly', () => {
  const camera = Camera.create({ follow: 8 });
  const view = (x) => ({ ...VIEW, viewW: 390, viewH: 844, x, y: 300, w: 24, h: 40, facing: 1 });
  camera.jumpTo(view(1700));
  const before = camera.position.x;
  camera.update(view(1704), 1 / 60);
  camera.update(view(1702), 1 / 60);
  assert.ok(Math.abs(camera.position.x - before) < 6, 'small steps do not move the view');
  camera.update(view(2100), 1 / 60);
  assert.ok(camera.position.x > before, 'a real walk still moves it');
});
