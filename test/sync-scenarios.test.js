import test from "node:test";
import assert from "node:assert/strict";
import { applyCloudReadPlan, syncApplyReadiness } from "../src/syncApply.js";
import { executeCloudPushPlan } from "../src/syncPushExecutor.js";
import {
  createPushFinalizationReadiness,
  finalizeConfirmedCloudPush,
} from "../src/syncPushFinalizer.js";
import { createCloudPushPlan, syncPushReadiness } from "../src/syncPushPlan.js";
import {
  createCloudReadPlan,
  createFailedSyncReadPlan,
  syncReadReadiness,
} from "../src/syncReadPlan.js";
import {
  createSyncOrchestrationModel,
  createSyncOrchestrationStatusModel,
} from "../src/syncOrchestration.js";
import { emptyData, parseBackup } from "../src/storage.js";
import {
  sessionToFastSessionRow,
  supabasePushRepositoryReadiness,
} from "../src/supabaseMigrationRepository.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const authState = {
  status: "authenticated",
  user,
};

const publishableConfig = {
  isConfigured: true,
  supabaseAnonKey: "sb_publishable_test",
  supabaseUrl: "https://example.supabase.co",
};

const writableConfig = {
  ...publishableConfig,
  syncConfirmationsEnabled: true,
  syncWritesEnabled: true,
};

const sharedBase = {
  id: "fast-shared",
  startedAt: "2026-07-04T23:10:00.000Z",
  endedAt: "2026-07-05T12:20:00.000Z",
  targetHours: 13,
  updatedAt: "2026-07-05T12:20:00.000Z",
  deletedAt: null,
};

const localOnly = {
  id: "fast-local-only",
  startedAt: "2026-07-05T23:30:00.000Z",
  endedAt: "2026-07-06T12:45:00.000Z",
  targetHours: 13,
  updatedAt: "2026-07-06T12:45:00.000Z",
  deletedAt: null,
};

const duplicate = {
  id: "fast-duplicate",
  startedAt: "2026-07-03T23:05:00.000Z",
  endedAt: "2026-07-04T12:15:00.000Z",
  targetHours: 13,
  updatedAt: "2026-07-04T12:15:00.000Z",
  deletedAt: null,
};

const activeLocal = {
  id: "fast-active",
  startedAt: "2026-07-06T23:00:00.000Z",
  endedAt: null,
  targetHours: 13,
  updatedAt: "2026-07-06T23:00:00.000Z",
  deletedAt: null,
};

function signedInData(sessions, sync = {}) {
  return {
    ...emptyData(),
    profile: {
      mode: "authenticated",
      guestId: "local-guest",
      userId: user.id,
      email: user.email,
      displayName: "Dave",
      provider: "google",
      updatedAt: "2026-07-06T11:00:00.000Z",
    },
    sync: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: "2026-07-06T11:00:00.000Z",
      ...sync,
    },
    sessions,
  };
}

function row(session) {
  return sessionToFastSessionRow(session, user);
}

function readReady() {
  return syncReadReadiness({
    authState,
    clientStatus: "ready",
    config: publishableConfig,
  });
}

function pushReady() {
  return syncPushReadiness({
    authState,
    clientStatus: "ready",
    config: writableConfig,
    executeWrites: true,
  });
}

function repositoryReady() {
  return supabasePushRepositoryReadiness({
    client: { from() {} },
    config: writableConfig,
    executeConfirmations: true,
    executeWrites: true,
  });
}

function finalizationReady(pushReadiness = pushReady()) {
  return createPushFinalizationReadiness({
    finalizationEnabled: true,
    pushReadiness,
    repositoryReadiness: repositoryReady(),
  });
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

test("concurrent edit scenario preserves local-newer edits and plans safe pushes", () => {
  const localNewer = {
    ...sharedBase,
    endedAt: "2026-07-05T12:55:00.000Z",
    updatedAt: "2026-07-05T12:55:00.000Z",
  };
  const staleRemote = {
    ...sharedBase,
    endedAt: "2026-07-05T12:25:00.000Z",
    updatedAt: "2026-07-05T12:25:00.000Z",
  };
  const remoteNewer = {
    id: "fast-remote-newer",
    startedAt: "2026-07-04T23:30:00.000Z",
    endedAt: "2026-07-05T13:10:00.000Z",
    targetHours: 13,
    updatedAt: "2026-07-05T13:10:00.000Z",
    deletedAt: null,
  };
  const localStale = {
    ...remoteNewer,
    endedAt: "2026-07-05T12:40:00.000Z",
    updatedAt: "2026-07-05T12:40:00.000Z",
  };
  const data = signedInData([localNewer, localStale, localOnly, duplicate, activeLocal]);
  const snapshot = structuredClone(data);
  const readPlan = createCloudReadPlan({
    localData: data,
    now: new Date("2026-07-06T13:00:00.000Z"),
    remoteRows: [row(staleRemote), row(remoteNewer), row(duplicate)],
    user,
  });

  assert.equal(readPlan.status, "ready");
  assert.deepEqual(
    readPlan.decisions.map((decision) => [decision.id, decision.reason, decision.source]),
    [
      ["fast-duplicate", "duplicate", "local"],
      ["fast-shared", "local-newer", "local"],
      ["fast-remote-newer", "remote-newer", "remote"],
    ],
  );

  const disabledApply = applyCloudReadPlan({
    applyReadiness: syncApplyReadiness(),
    localData: data,
    plan: readPlan,
  });
  assert.equal(disabledApply.status, "disabled");
  assert.deepEqual(disabledApply.data, snapshot);

  const applied = applyCloudReadPlan({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: data,
    now: new Date("2026-07-06T13:05:00.000Z"),
    plan: readPlan,
  });
  assert.equal(applied.status, "applied");
  assert.deepEqual(parseBackup(applied.backup), snapshot);
  assert.equal(
    applied.data.sessions.find((session) => session.id === "fast-remote-newer").endedAt,
    remoteNewer.endedAt,
  );

  const pushReadiness = pushReady();
  const pushPlan = createCloudPushPlan({
    localData: data,
    readiness: pushReadiness,
    remoteRows: [row(staleRemote), row(remoteNewer), row(duplicate)],
    user,
  });

  assert.equal(pushPlan.status, "ready");
  assert.deepEqual(
    pushPlan.candidates.map((candidate) => [candidate.session.id, candidate.action, candidate.reason]),
    [
      ["fast-shared", "update", "local-session-newer"],
      ["fast-local-only", "upload", "local-session-missing-in-cloud"],
    ],
  );
  assert.deepEqual(pushPlan.skippedSessions, [
    { id: "fast-active", reason: "active-session" },
    { id: "fast-duplicate", reason: "duplicate" },
    { id: "fast-remote-newer", reason: "remote-newer" },
  ]);

  const model = createSyncOrchestrationModel({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: data,
    pushFinalizationReadiness: finalizationReady(pushReadiness),
    pushPlan,
    pushReadiness,
    pushRepositoryReadiness: repositoryReady(),
    readPlan,
    readReadiness: readReady(),
  });
  assert.equal(model.status, "ready");
  assert.equal(model.summary.pendingUploadCount, 1);
  assert.equal(model.summary.pendingUpdateCount, 1);
  assert.equal(model.backupExpectations.applyRequiresBackup, true);
  assert.equal(model.backupExpectations.pushFinalizationRequiresBackup, true);
  assert.deepEqual(data, snapshot);
});

test("offline delete scenario gives tombstones precedence through read push and finalization gates", async () => {
  const timestamp = "2026-07-06T13:00:00.000Z";
  const localTombstone = {
    ...sharedBase,
    deletedAt: timestamp,
    updatedAt: timestamp,
  };
  const remoteCompleted = {
    ...sharedBase,
    deletedAt: null,
    updatedAt: timestamp,
  };
  const data = signedInData([localTombstone]);
  const snapshot = structuredClone(data);
  const readPlan = createCloudReadPlan({
    localData: data,
    remoteRows: [row(remoteCompleted)],
    user,
  });

  assert.deepEqual(readPlan.decisions, [
    {
      id: localTombstone.id,
      reason: "local-tombstone-newer",
      source: "local",
    },
  ]);
  assert.equal(readPlan.data.sessions[0].deletedAt, timestamp);

  const pushReadiness = pushReady();
  const pushPlan = createCloudPushPlan({
    localData: data,
    readiness: pushReadiness,
    remoteRows: [row(remoteCompleted)],
    user,
  });

  assert.equal(pushPlan.status, "ready");
  assert.deepEqual(
    pushPlan.candidates.map((candidate) => [candidate.session.id, candidate.action, candidate.reason]),
    [["fast-shared", "tombstone", "local-tombstone-newer"]],
  );

  const blockedExecution = await executeCloudPushPlan({
    plan: pushPlan,
    repository: repository({ confirm: false }),
  });
  const blockedFinalization = finalizeConfirmedCloudPush({
    execution: blockedExecution,
    finalizationReadiness: finalizationReady(pushReadiness),
    localData: data,
  });
  assert.equal(blockedFinalization.status, "blocked");
  assert.equal(blockedFinalization.syncUpdated, false);
  assert.deepEqual(blockedFinalization.data, snapshot);

  const execution = await executeCloudPushPlan({
    plan: pushPlan,
    repository: repository(),
  });
  const finalized = finalizeConfirmedCloudPush({
    execution,
    finalizationReadiness: finalizationReady(pushReadiness),
    localData: data,
    now: new Date("2026-07-06T13:30:00.000Z"),
  });

  assert.equal(execution.status, "executed");
  assert.equal(finalized.status, "finalized");
  assert.equal(finalized.data.sync.status, "synced");
  assert.deepEqual(parseBackup(finalized.backup.data), snapshot);
  assert.deepEqual(data, snapshot);
});

test("offline recovery scenario keeps failed reads local-safe then resumes preview planning", () => {
  const data = signedInData([localOnly], {
    status: "local",
    updatedAt: "2026-07-06T10:00:00.000Z",
  });
  const snapshot = structuredClone(data);
  const failedRead = createFailedSyncReadPlan({
    error: "Network offline.",
    localData: data,
    now: new Date("2026-07-06T13:00:00.000Z"),
  });
  const previewPushReadiness = syncPushReadiness({
    authState,
    clientStatus: "ready",
    config: publishableConfig,
  });
  const previewPushPlan = createCloudPushPlan({
    localData: data,
    readiness: previewPushReadiness,
    user,
  });
  const blockedModel = createSyncOrchestrationModel({
    applyReadiness: syncApplyReadiness(),
    localData: data,
    pushFinalizationReadiness: createPushFinalizationReadiness(),
    pushPlan: previewPushPlan,
    pushReadiness: previewPushReadiness,
    pushRepositoryReadiness: supabasePushRepositoryReadiness({
      client: { from() {} },
      config: publishableConfig,
    }),
    readPlan: failedRead,
    readReadiness: readReady(),
  });

  assert.equal(failedRead.status, "failed");
  assert.equal(blockedModel.status, "blocked");
  assert.deepEqual(blockedModel.blockers.map((blocker) => blocker.code), ["cloud-read-blocked"]);
  assert.equal(blockedModel.actions.push.enabled, false);
  assert.deepEqual(data, snapshot);

  const recoveredRead = createCloudReadPlan({
    localData: data,
    now: new Date("2026-07-06T13:15:00.000Z"),
    remoteRows: [],
    user,
  });
  const recoveredModel = createSyncOrchestrationModel({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: data,
    pushFinalizationReadiness: createPushFinalizationReadiness(),
    pushPlan: previewPushPlan,
    pushReadiness: previewPushReadiness,
    pushRepositoryReadiness: supabasePushRepositoryReadiness({
      client: { from() {} },
      config: publishableConfig,
    }),
    readPlan: recoveredRead,
    readReadiness: readReady(),
  });
  const statusModel = createSyncOrchestrationStatusModel(recoveredModel);

  assert.equal(recoveredRead.status, "ready");
  assert.equal(recoveredModel.status, "preview");
  assert.equal(recoveredModel.actions.apply.enabled, true);
  assert.equal(recoveredModel.actions.push.enabled, false);
  assert.equal(statusModel.status, "preview");
  assert.equal(statusModel.action.disabled, true);
  assert.deepEqual(data, snapshot);
});

test("duplicate-only cross-device state avoids push and finalization work", async () => {
  const data = signedInData([duplicate]);
  const snapshot = structuredClone(data);
  const pushReadiness = pushReady();
  const readPlan = createCloudReadPlan({
    localData: data,
    remoteRows: [row(duplicate)],
    user,
  });
  const pushPlan = createCloudPushPlan({
    localData: data,
    readiness: pushReadiness,
    remoteRows: [row(duplicate), row(duplicate)],
    user,
  });
  const execution = await executeCloudPushPlan({
    plan: pushPlan,
    repository: repository(),
  });
  const finalization = finalizeConfirmedCloudPush({
    execution,
    finalizationReadiness: finalizationReady(pushReadiness),
    localData: data,
  });
  const model = createSyncOrchestrationModel({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: data,
    pushFinalizationReadiness: finalizationReady(pushReadiness),
    pushPlan,
    pushReadiness,
    pushRepositoryReadiness: repositoryReady(),
    readPlan,
    readReadiness: readReady(),
  });

  assert.equal(readPlan.summary.duplicateCount, 1);
  assert.equal(pushPlan.status, "nothing-to-push");
  assert.equal(pushPlan.summary.duplicateCount, 2);
  assert.equal(execution.status, "blocked");
  assert.equal(execution.code, "push-plan-not-ready");
  assert.equal(finalization.status, "blocked");
  assert.equal(model.status, "preview");
  assert.equal(model.actions.push.enabled, false);
  assert.equal(model.backupExpectations.pushFinalizationRequiresBackup, false);
  assert.deepEqual(data, snapshot);
});
