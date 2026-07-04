import test from "node:test";
import assert from "node:assert/strict";
import { executeCloudPushPlan } from "../src/syncPushExecutor.js";
import {
  createCloudPushFinalizationStatusModel,
  createPushFinalizationReadiness,
  finalizeConfirmedCloudPush,
} from "../src/syncPushFinalizer.js";
import { createCloudPushPlan, syncPushReadiness } from "../src/syncPushPlan.js";
import { emptyData, parseBackup } from "../src/storage.js";
import {
  createSupabasePushRepository,
  sessionToFastSessionRow,
  supabasePushRepositoryReadiness,
} from "../src/supabaseMigrationRepository.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const session = {
  id: "fast-2026-07-04",
  startedAt: "2026-07-03T23:20:00.000Z",
  endedAt: "2026-07-04T12:40:00.000Z",
  targetHours: 13,
  updatedAt: "2026-07-04T12:40:00.000Z",
  deletedAt: null,
};

const pushReadiness = syncPushReadiness({
  authState: { status: "authenticated", user },
  clientStatus: "ready",
  config: {
    isConfigured: true,
    syncWritesEnabled: true,
  },
  executeWrites: true,
});

const repositoryReadiness = supabasePushRepositoryReadiness({
  client: { from() {} },
  config: {
    isConfigured: true,
    syncConfirmationsEnabled: true,
    syncWritesEnabled: true,
  },
  executeConfirmations: true,
  executeWrites: true,
});

function finalizationReadiness(overrides = {}) {
  return createPushFinalizationReadiness({
    finalizationEnabled: true,
    pushReadiness,
    repositoryReadiness,
    ...overrides,
  });
}

function localData(sessions = [session]) {
  return {
    ...emptyData(),
    profile: {
      mode: "authenticated",
      guestId: "local-guest",
      userId: user.id,
      email: user.email,
      displayName: "Dave",
      provider: "google",
      updatedAt: "2026-07-04T11:00:00.000Z",
    },
    sync: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: "2026-07-04T11:00:00.000Z",
    },
    sessions,
  };
}

function repository({ confirm = true } = {}) {
  const calls = [];

  return {
    calls,
    async confirmPush(input) {
      calls.push(["confirm", input]);
      return confirm
        ? {
            canMarkSynced: true,
            confirmedCount: input.calls.length,
            status: "confirmed",
          }
        : {
            blockers: [{ code: "missing-read-back-row", sessionId: input.calls[0]?.sessionId ?? null }],
            canMarkSynced: false,
            status: "blocked",
          };
    },
    async tombstoneSession(input) {
      calls.push(["tombstone", input]);
    },
    async updateSession(input) {
      calls.push(["update", input]);
    },
    async uploadSession(input) {
      calls.push(["upload", input]);
    },
  };
}

function fakeClient({ readRows = [] } = {}) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({ data: readRows, error: null });
            },
          };
        },
        upsert(row) {
          return Promise.resolve({ data: row, error: null });
        },
      };
    },
  };
}

function pushPlan(data = localData(), overrides = {}) {
  return createCloudPushPlan({
    localData: data,
    readiness: pushReadiness,
    user,
    ...overrides,
  });
}

test("push finalization readiness requires write confirmation and finalization support", () => {
  assert.deepEqual(
    createPushFinalizationReadiness({
      finalizationEnabled: false,
      pushReadiness,
      repositoryReadiness,
    }),
    {
      canFinalize: false,
      message: "Cloud push finalization is disabled until write, read-back confirmation, and local sync updates are explicitly enabled.",
      reason: "finalization-support-disabled",
      status: "disabled",
    },
  );

  assert.deepEqual(finalizationReadiness(), {
    canFinalize: true,
    message: "Cloud push write, read-back confirmation, and local finalization support are explicitly enabled.",
    reason: null,
    status: "ready",
  });
});

test("confirmed push execution finalizes sync metadata after preserving a backup", async () => {
  const data = localData();
  const snapshot = structuredClone(data);
  const execution = await executeCloudPushPlan({
    plan: pushPlan(data),
    repository: repository(),
  });
  const result = finalizeConfirmedCloudPush({
    execution,
    finalizationReadiness: finalizationReadiness(),
    localData: data,
    now: new Date("2026-07-04T13:15:00.000Z"),
  });

  assert.equal(result.status, "finalized");
  assert.equal(result.syncUpdated, true);
  assert.equal(result.localDataMutated, true);
  assert.deepEqual(parseBackup(result.backup.data), snapshot);
  assert.deepEqual(result.backup, {
    createdAt: "2026-07-04T13:15:00.000Z",
    data: result.backup.data,
    preserved: true,
  });
  assert.deepEqual(result.data.sessions, data.sessions);
  assert.deepEqual(result.data.profile, data.profile);
  assert.deepEqual(result.data.sync, {
    status: "synced",
    lastSyncedAt: "2026-07-04T13:15:00.000Z",
    lastError: null,
    updatedAt: "2026-07-04T13:15:00.000Z",
  });
  assert.deepEqual(data, snapshot);
});

test("disabled finalization leaves local data and sync metadata unchanged", async () => {
  const data = localData();
  const snapshot = structuredClone(data);
  const execution = await executeCloudPushPlan({
    plan: pushPlan(data),
    repository: repository(),
  });
  const result = finalizeConfirmedCloudPush({
    execution,
    localData: data,
  });

  assert.equal(result.status, "disabled");
  assert.equal(result.code, "finalization-support-disabled");
  assert.equal(result.syncUpdated, false);
  assert.equal(result.localDataMutated, false);
  assert.equal(result.backup, null);
  assert.deepEqual(result.data, snapshot);
  assert.deepEqual(data, snapshot);
});

test("blocked or confirmation-blocked push executions cannot finalize local sync state", async () => {
  const data = localData();
  const snapshot = structuredClone(data);
  const confirmationBlocked = await executeCloudPushPlan({
    plan: pushPlan(data),
    repository: repository({ confirm: false }),
  });
  const blockedResult = finalizeConfirmedCloudPush({
    execution: confirmationBlocked,
    finalizationReadiness: finalizationReadiness(),
    localData: data,
  });

  assert.equal(blockedResult.status, "blocked");
  assert.equal(blockedResult.code, "confirmation-required");
  assert.equal(blockedResult.syncUpdated, false);
  assert.equal(blockedResult.backup, null);
  assert.deepEqual(blockedResult.data, snapshot);

  const duplicatePlan = pushPlan(data, {
    remoteRows: [sessionToFastSessionRow(session, user)],
  });
  const noOpExecution = await executeCloudPushPlan({
    plan: duplicatePlan,
    repository: repository(),
  });
  const noOpResult = finalizeConfirmedCloudPush({
    execution: noOpExecution,
    finalizationReadiness: finalizationReadiness(),
    localData: data,
  });

  assert.equal(duplicatePlan.status, "nothing-to-push");
  assert.equal(noOpResult.status, "blocked");
  assert.equal(noOpResult.code, "confirmation-required");
  assert.deepEqual(noOpResult.data, snapshot);
  assert.deepEqual(data, snapshot);
});

test("finalizer accepts confirmed execution from Supabase push repository adapter", async () => {
  const data = localData();
  const snapshot = structuredClone(data);
  const supabaseRepository = createSupabasePushRepository({
    client: fakeClient({ readRows: [sessionToFastSessionRow(session, user)] }),
    config: {
      isConfigured: true,
      syncConfirmationsEnabled: true,
      syncWritesEnabled: true,
    },
    executeConfirmations: true,
    executeWrites: true,
  });
  const execution = await executeCloudPushPlan({
    plan: pushPlan(data),
    repository: supabaseRepository,
  });
  const result = finalizeConfirmedCloudPush({
    execution,
    finalizationReadiness: finalizationReadiness({
      repositoryReadiness: supabaseRepository.readiness,
    }),
    localData: data,
    now: new Date("2026-07-04T14:00:00.000Z"),
  });

  assert.equal(execution.status, "executed");
  assert.equal(result.status, "finalized");
  assert.equal(result.data.sync.status, "synced");
  assert.deepEqual(result.data.sessions, data.sessions);
  assert.deepEqual(parseBackup(result.backup.data), snapshot);
  assert.deepEqual(data, snapshot);
});

test("push finalization status model maps finalized disabled and blocked states", async () => {
  const data = localData();
  const execution = await executeCloudPushPlan({
    plan: pushPlan(data),
    repository: repository(),
  });
  const finalized = finalizeConfirmedCloudPush({
    execution,
    finalizationReadiness: finalizationReadiness(),
    localData: data,
  });
  const finalizedModel = createCloudPushFinalizationStatusModel(finalized);

  assert.equal(finalizedModel.status, "finalized");
  assert.equal(finalizedModel.action.disabled, true);
  assert.equal(finalizedModel.action.label, "Push sync finalized");

  const disabled = finalizeConfirmedCloudPush({
    execution,
    localData: data,
  });
  const disabledModel = createCloudPushFinalizationStatusModel(disabled);
  assert.equal(disabledModel.status, "disabled");
  assert.equal(disabledModel.action.label, "Finalization disabled");

  const blocked = finalizeConfirmedCloudPush({
    execution: { status: "confirmation-blocked" },
    finalizationReadiness: finalizationReadiness(),
    localData: data,
  });
  const blockedModel = createCloudPushFinalizationStatusModel(blocked);
  assert.equal(blockedModel.status, "blocked");
  assert.equal(blockedModel.action.label, "Confirmation required");
});
