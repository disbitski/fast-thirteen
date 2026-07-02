import test from "node:test";
import assert from "node:assert/strict";
import {
  createCloudPushExecutionStatusModel,
  executeCloudPushPlan,
} from "../src/syncPushExecutor.js";
import { createCloudPushPlan, syncPushReadiness } from "../src/syncPushPlan.js";
import { emptyData } from "../src/storage.js";
import { sessionToFastSessionRow } from "../src/supabaseMigrationRepository.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const baseSession = {
  id: "fast-local",
  startedAt: "2026-07-01T23:00:00.000Z",
  endedAt: "2026-07-02T12:15:00.000Z",
  targetHours: 13,
  updatedAt: "2026-07-02T12:15:00.000Z",
  deletedAt: null,
};

const writeReady = syncPushReadiness({
  authState: { status: "authenticated", user },
  clientStatus: "ready",
  config: {
    isConfigured: true,
    syncWritesEnabled: true,
  },
  executeWrites: true,
});

function localData(sessions = [baseSession]) {
  return {
    ...emptyData(),
    profile: {
      mode: "authenticated",
      guestId: "local-guest",
      userId: user.id,
      email: user.email,
      displayName: "Dave",
      provider: "google",
      updatedAt: "2026-07-02T11:00:00.000Z",
    },
    sync: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: "2026-07-02T11:00:00.000Z",
    },
    sessions,
  };
}

function row(session) {
  return sessionToFastSessionRow(session, user);
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

test("disabled write readiness is a no-op and preserves local-only data", async () => {
  const data = localData();
  const snapshot = structuredClone(data);
  const plan = createCloudPushPlan({
    localData: data,
    readiness: syncPushReadiness({
      authState: { status: "authenticated", user },
      clientStatus: "ready",
      config: { isConfigured: true },
    }),
    user,
  });
  const repo = repository();
  const execution = await executeCloudPushPlan({ plan, repository: repo });

  assert.equal(execution.status, "disabled");
  assert.equal(execution.code, "write-readiness-required");
  assert.equal(execution.executed, false);
  assert.equal(execution.localDataMutated, false);
  assert.equal(execution.syncUpdated, false);
  assert.deepEqual(repo.calls, []);
  assert.deepEqual(data, snapshot);
});

test("ready push plans call mocked upload update tombstone methods then confirm", async () => {
  const uploadSession = {
    ...baseSession,
    id: "fast-upload",
  };
  const updateSession = {
    ...baseSession,
    id: "fast-update",
    endedAt: "2026-07-02T12:45:00.000Z",
    updatedAt: "2026-07-02T12:45:00.000Z",
  };
  const staleRemote = {
    ...updateSession,
    endedAt: "2026-07-02T12:00:00.000Z",
    updatedAt: "2026-07-02T12:00:00.000Z",
  };
  const tombstoneSession = {
    ...baseSession,
    id: "fast-delete",
    deletedAt: "2026-07-02T13:00:00.000Z",
    updatedAt: "2026-07-02T13:00:00.000Z",
  };
  const remoteCompleted = {
    ...tombstoneSession,
    deletedAt: null,
    updatedAt: "2026-07-02T12:30:00.000Z",
  };
  const data = localData([uploadSession, updateSession, tombstoneSession]);
  const snapshot = structuredClone(data);
  const plan = createCloudPushPlan({
    localData: data,
    readiness: writeReady,
    remoteRows: [row(staleRemote), row(remoteCompleted)],
    user,
  });
  const repo = repository();
  const execution = await executeCloudPushPlan({ plan, repository: repo });

  assert.equal(execution.status, "executed");
  assert.equal(execution.executed, true);
  assert.equal(execution.localDataMutated, false);
  assert.equal(execution.syncUpdated, false);
  assert.deepEqual(
    repo.calls.map(([type, input]) => [type, input.session?.id ?? null]),
    [
      ["upload", "fast-upload"],
      ["update", "fast-update"],
      ["tombstone", "fast-delete"],
      ["confirm", null],
    ],
  );
  assert.deepEqual(execution.summary, {
    executedCount: 3,
    plannedCount: 3,
    tombstoneCount: 1,
    updateCount: 1,
    uploadCount: 1,
  });
  assert.deepEqual(execution.calls, [
    { action: "upload", sessionId: "fast-upload" },
    { action: "update", sessionId: "fast-update" },
    { action: "tombstone", sessionId: "fast-delete" },
  ]);
  assert.deepEqual(data, snapshot);
});

test("invalid push plans are blocked before repository calls", async () => {
  const plan = createCloudPushPlan({
    localData: localData([{ ...baseSession, endedAt: "not-a-date" }]),
    readiness: writeReady,
    user,
  });
  const repo = repository();
  const execution = await executeCloudPushPlan({ plan, repository: repo });

  assert.equal(execution.status, "blocked");
  assert.equal(execution.code, "invalid-local-sessions");
  assert.equal(execution.executed, false);
  assert.equal(execution.localDataMutated, false);
  assert.deepEqual(repo.calls, []);
});

test("duplicate-only push plans are no-op executions", async () => {
  const data = localData([baseSession]);
  const plan = createCloudPushPlan({
    localData: data,
    readiness: writeReady,
    remoteRows: [row(baseSession)],
    user,
  });
  const repo = repository();
  const execution = await executeCloudPushPlan({ plan, repository: repo });

  assert.equal(plan.status, "nothing-to-push");
  assert.equal(execution.status, "blocked");
  assert.equal(execution.code, "push-plan-not-ready");
  assert.deepEqual(repo.calls, []);
});

test("confirmation blockers keep local sync state unchanged after mocked writes", async () => {
  const data = localData([baseSession]);
  const snapshot = structuredClone(data);
  const plan = createCloudPushPlan({
    localData: data,
    readiness: writeReady,
    user,
  });
  const repo = repository({ confirm: false });
  const execution = await executeCloudPushPlan({ plan, repository: repo });

  assert.equal(execution.status, "confirmation-blocked");
  assert.equal(execution.code, "push-confirmation-blocked");
  assert.equal(execution.executed, false);
  assert.equal(execution.localDataMutated, false);
  assert.equal(execution.syncUpdated, false);
  assert.deepEqual(
    repo.calls.map(([type]) => type),
    ["upload", "confirm"],
  );
  assert.deepEqual(data, snapshot);
});

test("execution status model maps executed blocked and disabled states", async () => {
  const readyPlan = createCloudPushPlan({
    localData: localData([baseSession]),
    readiness: writeReady,
    user,
  });
  const executed = await executeCloudPushPlan({
    plan: readyPlan,
    repository: repository(),
  });
  const executedModel = createCloudPushExecutionStatusModel(executed);

  assert.equal(executedModel.status, "executed");
  assert.equal(executedModel.action.disabled, true);
  assert.equal(executedModel.action.label, "Awaiting confirmation finalization");
  assert.match(executedModel.message, /Local sync finalization remains/);

  const disabled = await executeCloudPushPlan({
    plan: createCloudPushPlan({
      localData: localData([baseSession]),
      readiness: syncPushReadiness({ config: {} }),
      user,
    }),
    repository: repository(),
  });
  const disabledModel = createCloudPushExecutionStatusModel(disabled);
  assert.equal(disabledModel.status, "disabled");
  assert.equal(disabledModel.action.label, "Cloud push blocked");

  const confirmationBlocked = await executeCloudPushPlan({
    plan: readyPlan,
    repository: repository({ confirm: false }),
  });
  const blockedModel = createCloudPushExecutionStatusModel(confirmationBlocked);
  assert.equal(blockedModel.status, "blocked");
  assert.equal(blockedModel.action.label, "Confirmation required");
});
