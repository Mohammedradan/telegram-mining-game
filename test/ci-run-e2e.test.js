'use strict';
// scripts/ci-run-e2e.sh wraps every browser end-to-end step in CI. When a step fails, the raw job log is
// not always downloadable, so the wrapper repeats the tail of the output as workflow annotations. These
// tests run it against a fake `npm` so the behaviour is proven without a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const script = path.join(root, 'scripts', 'ci-run-e2e.sh');
const posix = process.platform !== 'win32';

function runWrapper(fakeNpm, label = 'Demo E2E', name = 'test:demo') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-e2e-'));
  fs.writeFileSync(path.join(dir, 'npm'), `#!/bin/sh\n${fakeNpm}\n`, { mode: 0o755 });
  const res = spawnSync('bash', [script, label, name], {
    env: { ...process.env, PATH: `${dir}:${process.env.PATH}` }, encoding: 'utf8', timeout: 20000,
  });
  fs.rmSync(dir, { recursive: true, force: true });
  return res;
}

test('a passing step is passed through untouched: same output, exit 0, no annotation', { skip: !posix }, () => {
  const res = runWrapper('echo "all checks passed"; exit 0');
  assert.equal(res.status, 0);
  assert.match(res.stdout, /all checks passed/);
  assert.doesNotMatch(res.stdout, /::error/);
});

test('a failing step keeps its exit code and repeats the tail of its output as one annotation', { skip: !posix }, () => {
  const res = runWrapper('echo "first line"; echo "AssertionError: the crew lane overlaps the bar"; exit 7', 'Clicker E2E', 'test:clicker');
  assert.equal(res.status, 7, 'the step still fails with the same code');
  assert.match(res.stdout, /first line/, 'the raw output is still printed');
  const annotation = res.stdout.split('\n').find((l) => l.startsWith('::error title=Clicker E2E failed::'));
  assert.ok(annotation, 'one annotation carries the failure');
  assert.match(annotation, /first line.*AssertionError: the crew lane overlaps the bar/, 'newlines are folded so the whole tail sits on the one annotation line');
});

test('only the tail of a very long failure is annotated, so the annotation stays small', { skip: !posix }, () => {
  const res = runWrapper('i=0; while [ $i -lt 4000 ]; do echo "noise line $i"; i=$((i+1)); done; echo "THE REAL ERROR"; exit 1');
  assert.equal(res.status, 1);
  const annotation = res.stdout.split('\n').find((l) => l.startsWith('::error title=Demo E2E failed::'));
  assert.ok(annotation && annotation.length < 7000, `annotation length ${annotation && annotation.length}`);
  assert.match(annotation, /THE REAL ERROR/);
  assert.doesNotMatch(annotation, /noise line 0\b/, 'the beginning is dropped, the end is kept');
});

test('the script calls npm with the requested script name', { skip: !posix }, () => {
  const res = runWrapper('echo "npm called with: $*"; exit 0', 'X', 'test:bosses');
  assert.match(res.stdout, /npm called with: run test:bosses/);
});

test('CI runs all nine browser tests through the wrapper, in order, on the same server', () => {
  const ci = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const steps = [...ci.matchAll(/ci-run-e2e\.sh "([^"]+)" (test:[a-z]+)/g)].map((m) => m[2]);
  assert.deepEqual(steps, ['test:coach', 'test:browser', 'test:clicker', 'test:deepdive', 'test:bosses', 'test:guide', 'test:classic', 'test:quests', 'test:prestige']);
  for (const name of steps) assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts[name], `${name} exists in package.json`);
  assert.doesNotMatch(ci, /run: npm run test:(browser|clicker|deepdive|bosses|guide|classic|quests|prestige)/, 'no E2E step bypasses the wrapper');
  // one red browser test must not hide the others: every browser test after the coach check runs even when an earlier one failed
  const blocks = ci.split(/\n(?=      - name: )/);
  for (const name of ['test:browser', 'test:clicker', 'test:deepdive', 'test:bosses', 'test:guide', 'test:classic', 'test:quests', 'test:prestige']) {
    const block = blocks.find((b) => b.includes(`ci-run-e2e.sh`) && b.includes(` ${name}`));
    assert.ok(block && block.includes('if: ${{ !cancelled() }}'), `${name} still runs after an earlier E2E failed`);
  }
});
