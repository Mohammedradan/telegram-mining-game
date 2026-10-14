const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../db');

// Run the same contract against PostgreSQL when a real test database is provided.
// Keep the ordinary CI suite fully deterministic on SQLite.
const drivers = ['sqlite', ...(process.env.TEST_DATABASE_URL ? ['postgres'] : [])];
for (const driver of drivers) {
  test(`${driver}: transactions serialize rewards, roll back partial writes, and recover after failure`, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mining-transaction-'));
    const oldUrl = process.env.DATABASE_URL;
    const oldFile = process.env.DATABASE_FILE;
    process.env.DATABASE_URL = driver === 'postgres' ? process.env.TEST_DATABASE_URL : '';
    process.env.DATABASE_FILE = path.join(tmp, 'game.db');
    const store = createStore();
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
    if (oldFile === undefined) delete process.env.DATABASE_FILE; else process.env.DATABASE_FILE = oldFile;
    const id = `transaction_${process.pid}_${driver}`;
    const now = Date.now();
    const user = { id, name: 'Test', state: { gold: 0, totalEarned: 0 }, createdAt: now, updatedAt: now, lastSaveAt: now };
    try {
      await store.withUsers([id], () => store.putUser(user));
      await Promise.all(Array.from({ length: 20 }, () => store.withUsers([id], async () => {
        const current = await store.getUser(id);
        await new Promise((resolve) => setTimeout(resolve, 2));
        current.state.gold += 1;
        await store.putUser(current);
      })));
      assert.equal((await store.getUser(id)).state.gold, 20);
      await assert.rejects(store.withUsers([id], async () => {
        const current = await store.getUser(id);
        current.state.gold += 500;
        await store.putUser(current);
        await store.addPending(id);
        throw new Error('injected storage failure');
      }), /injected storage failure/);
      assert.equal((await store.getUser(id)).state.gold, 20);
      assert.equal(await store.getPending(id), 0);
      await store.withUsers([id], async () => {
        await assert.rejects(store.withUsers([id], async () => {}), /Nested/);
      });
      await store.withUsers([id], async () => {
        const current = await store.getUser(id);
        current.state.gold += 1;
        await store.putUser(current);
      });
      assert.equal((await store.getUser(id)).state.gold, 21);
    } finally {
      await store.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
}
