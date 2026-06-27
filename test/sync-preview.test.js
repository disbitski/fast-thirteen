import test from "node:test";
import assert from "node:assert/strict";
import { createSyncPreviewModel } from "../src/syncPreview.js";

const failedPlan = {
  data: {
    sessions: [{ id: "local-fast" }],
  },
  message: "Remote fasting history contains rows that need review before import.",
  status: "failed",
  summary: {
    localSessions: 1,
    remoteSessions: 0,
  },
  syncStatus: {
    applied: false,
    current: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: "2026-06-27T10:00:00.000Z",
    },
    next: {
      status: "error",
      lastSyncedAt: null,
      lastError: "Remote fasting history contains rows that need review before import.",
      updatedAt: "2026-06-27T11:00:00.000Z",
    },
  },
};

const readyPlan = {
  decisions: [
    { id: "remote-new", reason: "remote-session-added", source: "remote" },
    { id: "shared", reason: "duplicate", source: "local" },
    { id: "local-edit", reason: "local-newer", source: "local" },
  ],
  message: "Cloud history read plan is ready. Local data remains available offline.",
  status: "ready",
  summary: {
    duplicateCount: 1,
    localKeptCount: 2,
    localSessions: 3,
    remoteAppliedCount: 1,
    remoteSessions: 2,
    tombstoneCount: 1,
  },
  syncStatus: {
    applied: true,
    current: {
      status: "synced",
      lastSyncedAt: "2026-06-26T11:00:00.000Z",
      lastError: null,
      updatedAt: "2026-06-26T11:00:00.000Z",
    },
    next: {
      status: "synced",
      lastSyncedAt: "2026-06-27T11:00:00.000Z",
      lastError: null,
      updatedAt: "2026-06-27T11:00:00.000Z",
    },
  },
};

test("maps disabled cloud-read readiness into local-safe preview copy", () => {
  const model = createSyncPreviewModel(failedPlan, {
    readiness: {
      canRead: false,
      message: "Supabase publishable config is missing; cloud reads are disabled.",
    },
  });

  assert.equal(model.status, "disabled");
  assert.equal(model.title, "Cloud sync preview disabled");
  assert.equal(model.action.label, "Cloud read disabled");
  assert.equal(model.action.disabled, true);
  assert.deepEqual(
    model.stats.map((item) => [item.label, item.value, item.tone]),
    [
      ["Readiness", "Disabled", "warn"],
      ["Local", "1", "neutral"],
      ["Remote", "0", "neutral"],
      ["Apply", "0", "neutral"],
      ["Keep local", "0", "neutral"],
      ["Duplicates", "0", "neutral"],
    ],
  );
  assert.match(model.details[0], /publishable config is missing/);
  assert.equal(model.lastSync, "Last successful sync: Never synced");
});

test("maps failed read plans into blocker preview without applying sync state", () => {
  const model = createSyncPreviewModel(failedPlan, {
    readiness: { canRead: true },
  });

  assert.equal(model.status, "blocked");
  assert.equal(model.title, "Cloud read needs review");
  assert.equal(model.action.label, "Resolve read blocker");
  assert.match(model.message, /blocker/);
  assert.deepEqual(model.details, [
    "Remote fasting history contains rows that need review before import.",
    "1 local session remains available offline.",
    "Local sync status is not changed until a read plan succeeds.",
  ]);
});

test("maps ready read plans into merge counts and last-sync preview", () => {
  const model = createSyncPreviewModel(readyPlan, {
    readiness: { canRead: true },
  });

  assert.equal(model.status, "ready");
  assert.equal(model.title, "Cloud read preview ready");
  assert.match(model.message, /does not write to Supabase/);
  assert.deepEqual(
    model.stats.map((item) => [item.label, item.value, item.tone]),
    [
      ["Readiness", "Ready", "good"],
      ["Local", "3", "neutral"],
      ["Remote", "2", "neutral"],
      ["Apply", "1", "neutral"],
      ["Keep local", "2", "neutral"],
      ["Duplicates", "1", "neutral"],
    ],
  );
  assert.deepEqual(model.details, [
    "1 remote change would merge into local history.",
    "2 local edits stay newer than cloud history.",
    "1 duplicate would be skipped by stable session id.",
    "1 deleted fast stays deleted after the merge.",
  ]);
  assert.match(model.lastSync, /Preview sync time:/);
});
