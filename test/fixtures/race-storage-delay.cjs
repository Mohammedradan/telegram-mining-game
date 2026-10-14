// Test-only preload. No runtime flags or artificial waits are added to production.
const db = require('../../db');
const createStore = db.createStore;
db.createStore = (...args) => {
  const store = createStore(...args);
  const getUser = store.getUser.bind(store);
  store.getUser = async (...params) => {
    // Reproduce delayed PostgreSQL identity loading on every engine.
    await new Promise((resolve) => setTimeout(resolve, 100));
    return getUser(...params);
  };
  const record = store.recordRaceResult.bind(store);
  store.recordRaceResult = async (...params) => {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return record(...params);
  };
  return store;
};
