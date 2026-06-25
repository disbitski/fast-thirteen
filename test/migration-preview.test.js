import test from "node:test";
import assert from "node:assert/strict";
import { createMigrationPreviewModel } from "../src/migrationPreview.js";

const basePlan = {
  backup: "{\n}",
  backupCreatedAt: "2026-06-21T12:00:00.000Z",
  blockers: [],
  status: "ready",
  summary: {
    activeSkippedCount: 1,
    duplicateCount: 2,
    invalidCount: 0,
    localSessions: 5,
    skipCount: 3,
  },
  uploadCandidates: [
    { action: "upload" },
    { action: "upload" },
    { action: "update" },
    { action: "tombstone" },
  ],
};

test("maps a ready migration plan into local-safe preview copy", () => {
  const model = createMigrationPreviewModel(basePlan);

  assert.equal(model.status, "ready");
  assert.equal(model.title, "Migration preview ready");
  assert.match(model.message, /does not write to Supabase yet/);
  assert.deepEqual(model.confirmation, {
    disabled: true,
    label: "Confirm migration unavailable",
    message: "Cloud migration execution is not enabled in this local preview.",
  });
  assert.deepEqual(
    model.stats.map((item) => [item.label, item.value, item.tone]),
    [
      ["Backup", "Ready", "good"],
      ["Upload", "2", "neutral"],
      ["Update", "1", "neutral"],
      ["Delete", "1", "neutral"],
      ["Skipped", "3", "neutral"],
      ["Invalid", "0", "neutral"],
    ],
  );
  assert.deepEqual(model.details, [
    "2 new fasts would upload.",
    "1 local edit would update cloud history.",
    "1 deleted fast would stay deleted.",
    "2 duplicates would be skipped.",
    "1 active fast stays local until completed.",
  ]);
});

test("keeps confirmation disabled without local finalization support", () => {
  const model = createMigrationPreviewModel(basePlan, {
    migrationReadiness: {
      canConfirm: true,
      canFinalize: false,
      canWrite: true,
    },
  });

  assert.deepEqual(model.confirmation, {
    disabled: true,
    label: "Confirm migration unavailable",
    message: "Cloud migration execution is not enabled in this local preview.",
  });
});

test("only enables confirmation when write read-back and finalization support are ready", () => {
  const model = createMigrationPreviewModel(basePlan, {
    migrationReadiness: {
      canConfirm: true,
      canFinalize: true,
      canWrite: true,
    },
  });

  assert.deepEqual(model.confirmation, {
    disabled: false,
    label: "Confirm migration",
    message: "Migration execution, read-back confirmation, and local finalization are explicitly enabled.",
  });
});

test("maps missing authentication into sign-in preview state", () => {
  const model = createMigrationPreviewModel({
    ...basePlan,
    blockers: ["authenticated-user-required"],
    status: "blocked",
    uploadCandidates: [],
  });

  assert.equal(model.status, "auth-required");
  assert.equal(model.title, "Sign in to preview migration");
  assert.match(model.message, /5 local sessions/);
  assert.equal(model.confirmation.label, "Sign in before migration");
  assert.deepEqual(model.details, [
    "Local data stays on this Mac until you sign in.",
    "No cloud writes happen from this preview.",
  ]);
});

test("maps invalid local sessions into blocked preview state", () => {
  const model = createMigrationPreviewModel({
    ...basePlan,
    blockers: ["invalid-local-sessions"],
    status: "blocked",
    summary: {
      ...basePlan.summary,
      invalidCount: 2,
    },
  });

  assert.equal(model.status, "blocked");
  assert.equal(model.title, "Review local history first");
  assert.equal(model.confirmation.label, "Resolve blockers first");
  assert.equal(model.stats.at(-1).value, "2");
  assert.equal(model.stats.at(-1).tone, "warn");
  assert.deepEqual(model.details, [
    "2 invalid sessions need review before migration can run.",
    "4 valid changes can still be previewed.",
  ]);
});

test("maps empty migration plan into nothing-to-sync preview state", () => {
  const model = createMigrationPreviewModel({
    ...basePlan,
    status: "nothing-to-sync",
    summary: {
      ...basePlan.summary,
      activeSkippedCount: 0,
      duplicateCount: 1,
      skipCount: 1,
    },
    uploadCandidates: [],
  });

  assert.equal(model.status, "empty");
  assert.equal(model.title, "Nothing to migrate yet");
  assert.equal(model.confirmation.label, "Nothing to migrate");
  assert.deepEqual(model.details, [
    "1 duplicate already matches cloud history.",
    "0 active fasts stay local until completed.",
    "No cloud writes happen from this preview.",
  ]);
});
