import test from "node:test";
import assert from "node:assert/strict";
import {
  createSyncDiagnosticsViewModel,
  createSyncLoadingPreviewModel,
  createSyncPreviewModel,
  createSyncRefreshControlModel,
} from "../src/syncPreview.js";

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
  canApply: true,
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
  assert.deepEqual(model.action, {
    disabled: true,
    label: "Apply disabled",
    message: "Applying cloud reads is disabled until local finalization support is explicitly enabled.",
  });
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

test("enables the ready read plan action only with explicit apply support", () => {
  const model = createSyncPreviewModel(readyPlan, {
    applyReadiness: {
      canApply: true,
      message: "Successful cloud read plans can be applied to the local offline copy.",
    },
    readiness: { canRead: true },
  });

  assert.deepEqual(model.action, {
    disabled: false,
    label: "Apply cloud read",
    message: "Successful cloud read plans can be applied to the local offline copy.",
  });
});

test("maps cloud read diagnostics into four clear safety stages", () => {
  const model = createSyncDiagnosticsViewModel({
    backupRequired: false,
    dataMutated: false,
    invalidRowCount: 0,
    localSyncStatusChanged: false,
    nextStep: "Applying cloud reads remains disabled.",
    stages: {
      readiness: { message: "Signed-in profile is ready.", status: "ready" },
      repositoryRead: { message: "Rows were read safely.", status: "passed" },
      mergePlan: { message: "Merge preview is ready.", status: "ready" },
      localApply: { message: "Local apply is disabled.", status: "gated" },
    },
    status: "preview",
  });

  assert.equal(model.status, "preview");
  assert.deepEqual(
    model.stages.map((stage) => [stage.index, stage.label, stage.statusLabel, stage.tone]),
    [
      ["01", "Readiness", "Ready", "good"],
      ["02", "Cloud read", "Passed", "good"],
      ["03", "Merge plan", "Ready", "good"],
      ["04", "Local apply", "Gated", "neutral"],
    ],
  );
  assert.deepEqual(model.safetyItems, [
    "Local data unchanged",
    "Sync status unchanged",
    "Apply remains gated",
  ]);
  assert.equal(model.nextStep, "Applying cloud reads remains disabled.");
});

test("surfaces invalid remote rows and backup expectations in diagnostics", () => {
  const blocked = createSyncDiagnosticsViewModel({
    invalidRowCount: 2,
    stages: {
      mergePlan: { message: "Remote rows need review.", status: "blocked" },
    },
    status: "blocked",
  });
  const applyReady = createSyncDiagnosticsViewModel({
    backupRequired: true,
    stages: {
      localApply: { message: "Backup required.", status: "ready" },
    },
    status: "apply-ready",
  });

  assert.equal(blocked.stages[2].statusLabel, "2 invalid");
  assert.equal(blocked.stages[2].tone, "warn");
  assert.equal(applyReady.safetyItems[2], "Backup required before apply");
});

test("maps cloud refresh loading state without enabling apply", () => {
  const model = createSyncLoadingPreviewModel({
    sessions: [{ id: "local-fast" }],
    sync: { lastSyncedAt: null },
  });

  assert.equal(model.status, "loading");
  assert.equal(model.title, "Refreshing cloud preview");
  assert.equal(model.action.disabled, true);
  assert.equal(model.action.label, "Refreshing...");
  assert.deepEqual(model.stats.map((item) => item.value), ["Ready", "1", "...", "0", "0", "0"]);
  assert.match(model.details[1], /offline copy stay unchanged/);
});

test("maps refresh control disabled loading ready and retry states", () => {
  const disabled = createSyncRefreshControlModel({
    readiness: { canRead: false, message: "Sign in first." },
  });
  const loading = createSyncRefreshControlModel({
    readiness: { canRead: true },
    requestState: { status: "loading" },
  });
  const ready = createSyncRefreshControlModel({
    readiness: { canRead: true },
    requestState: { status: "ready" },
  });
  const blocked = createSyncRefreshControlModel({
    readiness: { canRead: true },
    requestState: { message: "Network offline.", status: "blocked" },
  });

  assert.deepEqual(
    [disabled, loading, ready, blocked].map((model) => [model.status, model.disabled, model.label]),
    [
      ["disabled", true, "Refresh unavailable"],
      ["loading", true, "Refreshing..."],
      ["ready", false, "Refresh cloud preview"],
      ["blocked", false, "Retry cloud preview"],
    ],
  );
  assert.equal(blocked.message, "Network offline.");
});
