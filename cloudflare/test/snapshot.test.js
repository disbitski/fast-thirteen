import test from "node:test";
import assert from "node:assert/strict";
import { mergeSnapshots, normalizeSnapshot } from "../src/snapshot.js";

function snapshot(sessions) {
  return { version: 3, settings: { targetHours: 13 }, sessions };
}

function session(id, updatedAt, extra = {}) {
  return {
    id,
    startedAt: "2026-08-17T00:00:00.000Z",
    endedAt: "2026-08-17T13:00:00.000Z",
    targetHours: 13,
    updatedAt,
    deletedAt: null,
    ...extra,
  };
}

test("cloud merge keeps the latest stable session and tombstone precedence", () => {
  const timestamp = "2026-08-17T14:00:00.000Z";
  const current = snapshot([session("same", timestamp), session("local", timestamp)]);
  const incoming = snapshot([
    session("same", timestamp, { deletedAt: timestamp }),
    session("remote", "2026-08-17T15:00:00.000Z"),
  ]);
  const merged = mergeSnapshots(current, incoming);
  assert.equal(merged.sessions.length, 3);
  assert.equal(merged.sessions.find((item) => item.id === "same").deletedAt, timestamp);
});

test("cloud snapshots reject invalid sessions instead of dropping fasting data", () => {
  assert.throws(
    () => normalizeSnapshot(snapshot([{ id: "broken", startedAt: "not-a-date" }])),
    /invalid fasting session/,
  );
});
