import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyData,
  LEGACY_SESSIONS_KEY,
  loadData,
  mergeData,
  parseBackup,
  saveData,
  serializeBackup,
  STORAGE_KEY,
} from "../src/storage.js";

function memoryStorage(values = {}) {
  const data = new Map(Object.entries(values));

  return {
    getItem(key) {
      return data.get(key) ?? null;
    },
    removeItem(key) {
      data.delete(key);
    },
    setItem(key, value) {
      data.set(key, value);
    },
  };
}

const session = {
  id: "overnight-fast",
  startedAt: "2026-06-14T22:00:00.000Z",
  endedAt: null,
  targetHours: 13,
  updatedAt: "2026-06-14T22:00:00.000Z",
  deletedAt: null,
};

test("persists an active overnight fast across reloads", () => {
  const storage = memoryStorage();
  const result = saveData(storage, {
    settings: { targetHours: 14 },
    sessions: [session],
  });

  assert.equal(result.saved, true);
  assert.deepEqual(loadData(storage), result.data);
  assert.equal(loadData(storage).sessions[0].endedAt, null);
});

test("migrates the original sessions-only storage format", () => {
  const storage = memoryStorage({
    [LEGACY_SESSIONS_KEY]: JSON.stringify([session]),
  });

  const migrated = loadData(storage);

  assert.equal(migrated.sessions.length, 1);
  assert.equal(storage.getItem(LEGACY_SESSIONS_KEY), null);
  assert.ok(storage.getItem(STORAGE_KEY));
});

test("ignores malformed sessions and applies default settings", () => {
  const storage = memoryStorage({
    [STORAGE_KEY]: JSON.stringify({
      sessions: [{ id: "bad" }, session],
    }),
  });

  const data = loadData(storage);

  assert.equal(data.settings.targetHours, 13);
  assert.deepEqual(data.sessions, [session]);
});

test("exports and restores a normalized backup", () => {
  const original = {
    settings: { targetHours: 14.5 },
    sessions: [session],
  };

  assert.deepEqual(parseBackup(serializeBackup(original)), {
    version: 2,
    settings: { targetHours: 14.5 },
    sessions: [session],
  });
});

test("merges backups without duplicating sessions", () => {
  const ended = { ...session, endedAt: "2026-06-15T11:30:00.000Z" };
  const merged = mergeData(
    { ...emptyData(), sessions: [session] },
    { settings: { targetHours: 14 }, sessions: [ended] },
  );

  assert.equal(merged.settings.targetHours, 14);
  assert.deepEqual(merged.sessions, [ended]);
});

test("reports when browser storage cannot save", () => {
  const result = saveData(
    {
      setItem() {
        throw new Error("Storage unavailable");
      },
    },
    emptyData(),
  );

  assert.equal(result.saved, false);
});

test("newer deletion tombstones win during merge", () => {
  const deleted = {
    ...session,
    deletedAt: "2026-06-15T12:00:00.000Z",
    updatedAt: "2026-06-15T12:00:00.000Z",
  };
  const merged = mergeData(
    { ...emptyData(), sessions: [deleted] },
    { ...emptyData(), sessions: [session] },
  );

  assert.equal(merged.sessions[0].deletedAt, deleted.deletedAt);
});
