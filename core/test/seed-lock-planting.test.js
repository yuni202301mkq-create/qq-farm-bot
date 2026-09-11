const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qq-farm-seed-lock-plant-'));
process.env.FARM_DATA_DIR = dataDir;

const store = require('../src/models/store');
const { splitLockedBagSeeds } = require('../src/services/planting-service');

test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function seed(seedId, count = 5) {
  return { seedId, name: `种子${seedId}`, count, requiredLevel: 0, plantSize: 1 };
}

test('locked seeds are separated out by splitLockedBagSeeds', () => {
  const accountId = 'lock-split-1';
  store.applyConfigSnapshot({ seedLocks: [22, 44] }, { accountId, persist: false });

  const { plantable, locked } = splitLockedBagSeeds(
    [seed(11), seed(22), seed(33), seed(44)],
    accountId
  );

  assert.deepEqual(plantable.map(s => s.seedId), [11, 33]);
  assert.deepEqual(locked.map(s => s.seedId), [22, 44]);
});

test('no locks configured keeps every seed plantable', () => {
  const accountId = 'lock-split-2';
  const { plantable, locked } = splitLockedBagSeeds([seed(11), seed(22)], accountId);
  assert.deepEqual(plantable.map(s => s.seedId), [11, 22]);
  assert.deepEqual(locked, []);
});

test('lock list referencing seeds not in the bag is harmless', () => {
  const accountId = 'lock-split-3';
  store.applyConfigSnapshot({ seedLocks: [999] }, { accountId, persist: false });
  const { plantable, locked } = splitLockedBagSeeds([seed(11), seed(22)], accountId);
  assert.deepEqual(plantable.map(s => s.seedId), [11, 22]);
  assert.deepEqual(locked, []);
});

test('empty / non-array input is tolerated', () => {
  const accountId = 'lock-split-4';
  store.applyConfigSnapshot({ seedLocks: [11] }, { accountId, persist: false });
  const r1 = splitLockedBagSeeds(undefined, accountId);
  const r2 = splitLockedBagSeeds(null, accountId);
  assert.deepEqual(r1, { plantable: [], locked: [] });
  assert.deepEqual(r2, { plantable: [], locked: [] });
});

test('locking then unlocking restores plantability (locks are read live from config)', () => {
  const accountId = 'lock-split-5';
  store.applyConfigSnapshot({ seedLocks: [11] }, { accountId, persist: false });
  let r = splitLockedBagSeeds([seed(11), seed(22)], accountId);
  assert.deepEqual(r.plantable.map(s => s.seedId), [22]);

  store.applyConfigSnapshot({ seedLocks: [] }, { accountId, persist: false });
  r = splitLockedBagSeeds([seed(11), seed(22)], accountId);
  assert.deepEqual(r.plantable.map(s => s.seedId), [11, 22]);
});

test('seed locks survive account config snapshot round-trip', () => {
  const accountId = 'lock-roundtrip';
  store.applyConfigSnapshot({ seedLocks: [101, 202] }, { accountId, persist: false });
  const snapshot = store.getConfigSnapshot(accountId);
  assert.deepEqual(snapshot.seedLocks.map(Number).sort((a, b) => a - b), [101, 202]);
  assert.deepEqual(store.getSeedLocks(accountId).map(Number).sort((a, b) => a - b), [101, 202]);
});
