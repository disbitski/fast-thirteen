import test from "node:test";
import assert from "node:assert/strict";
import { executeGuestMigrationPlan } from "../src/migrationExecutor.js";
import {
  createFinalizationReadiness,
  finalizeConfirmedMigration,
} from "../src/migrationFinalizer.js";
import { emptyData, serializeBackup } from "../src/storage.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const session = {
  id: "fast-2026-06-24",
  startedAt: "2026-06-23T23:00:00.000Z",
  endedAt: "2026-06-24T12:20:00.000Z",
  targetHours: 13,
  updatedAt: "2026-06-24T12:20:00.000Z",
  deletedAt: null,
};

function localData() {
  return {
    ...emptyData(),
    profile: {
      mode: "authenticated",
      guestId: "local-guest",
      userId: user.id,
      email: user.email,
      displayName: "Dave",
      provider: "google",
      updatedAt: "2026-06-24T12:00:00.000Z",
    },
    sync: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: "2026-06-24T12:00:00.000Z",
    },
    sessions: [session],
  };
}

function plan(data = localData()) {
  return {
    backup: serializeBackup(data),
    backupCreatedAt: "2026-06-24T13:00:00.000Z",
    blockers: [],
    canMigrate: true,
    status: "ready",
    uploadCandidates: [
      {
        action: "upload",
        cloudSession: null,
        reason: "local-session-missing-in-cloud",
        session,
      },
    ],
    user,
  };
}

function confirmedExecution() {
  return {
    confirmation: {
      canMarkSynced: true,
      confirmedCount: 1,
      status: "confirmed",
    },
    status: "executed",
  };
}

test("successful confirmation finalizes sync metadata while preserving local sessions", () => {
  const data = localData();
  const migrationPlan = plan(data);
  const result = finalizeConfirmedMigration({
    execution: confirmedExecution(),
    localData: data,
    migrationPlan,
    now: new Date("2026-06-24T13:30:00.000Z"),
  });

  assert.equal(result.status, "finalized");
  assert.equal(result.syncUpdated, true);
  assert.deepEqual(result.backup, {
    createdAt: migrationPlan.backupCreatedAt,
    data: migrationPlan.backup,
    preserved: true,
  });
  assert.deepEqual(result.data.sessions, data.sessions);
  assert.deepEqual(result.data.profile, data.profile);
  assert.deepEqual(result.data.settings, data.settings);
  assert.deepEqual(result.data.sync, {
    status: "synced",
    lastSyncedAt: "2026-06-24T13:30:00.000Z",
    lastError: null,
    updatedAt: "2026-06-24T13:30:00.000Z",
  });
});

test("blocked confirmation leaves local sync state unchanged", () => {
  const data = localData();
  const result = finalizeConfirmedMigration({
    execution: {
      confirmation: {
        blockers: [{ code: "missing-read-back-row", sessionId: session.id }],
        canMarkSynced: false,
        status: "blocked",
      },
      status: "executed",
    },
    localData: data,
    migrationPlan: plan(data),
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.code, "confirmation-required");
  assert.equal(result.syncUpdated, false);
  assert.equal(result.backup, null);
  assert.deepEqual(result.data.sync, data.sync);
  assert.deepEqual(result.data.sessions, data.sessions);
});

test("missing backup blocks finalization even after confirmation", () => {
  const data = localData();
  const result = finalizeConfirmedMigration({
    execution: confirmedExecution(),
    localData: data,
    migrationPlan: {
      ...plan(data),
      backup: null,
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.code, "backup-required");
  assert.deepEqual(result.data.sync, data.sync);
});

test("finalization readiness stays disabled until all migration gates are ready", () => {
  assert.deepEqual(
    createFinalizationReadiness({
      migrationReadiness: {
        canConfirm: true,
        canFinalize: false,
        canWrite: true,
      },
    }),
    {
      canFinalize: false,
      message: "Migration finalization is disabled until write, read-back, and local sync updates are explicitly enabled.",
      status: "disabled",
    },
  );

  assert.deepEqual(
    createFinalizationReadiness({
      migrationReadiness: {
        canConfirm: true,
        canFinalize: true,
        canWrite: true,
      },
    }),
    {
      canFinalize: true,
      message: "Migration write, read-back, and local finalization support are explicitly enabled.",
      status: "ready",
    },
  );
});

test("finalizer accepts execution output from repository-compatible mocks", async () => {
  const data = localData();
  const migrationPlan = plan(data);
  const repository = {
    async preserveBackup() {},
    async uploadSession() {},
    async updateSession() {},
    async tombstoneSession() {},
    async confirmMigration() {
      return {
        blockers: [],
        canMarkSynced: true,
        confirmedCount: 1,
        status: "confirmed",
      };
    },
  };

  const execution = await executeGuestMigrationPlan({ plan: migrationPlan, repository });
  const result = finalizeConfirmedMigration({
    execution,
    localData: data,
    migrationPlan,
    now: new Date("2026-06-24T14:00:00.000Z"),
  });

  assert.equal(result.status, "finalized");
  assert.equal(result.data.sync.status, "synced");
  assert.deepEqual(result.data.sessions, data.sessions);
});
