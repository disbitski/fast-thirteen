import test from "node:test";
import assert from "node:assert/strict";
import { syncApplyReadiness, applyCloudReadPlan } from "../src/syncApply.js";
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
import { emptyData } from "../src/storage.js";
import {
  sessionToFastSessionRow,
  supabasePushRepositoryReadiness,
} from "../src/supabaseMigrationRepository.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const session = {
  id: "fast-2026-07-05",
  startedAt: "2026-07-04T23:20:00.000Z",
  endedAt: "2026-07-05T12:35:00.000Z",
  targetHours: 13,
  updatedAt: "2026-07-05T12:35:00.000Z",
  deletedAt: null,
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
      updatedAt: "2026-07-05T11:00:00.000Z",
    },
    sync: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: "2026-07-05T11:00:00.000Z",
    },
    sessions,
  };
}

function readyReadiness() {
  return syncReadReadiness({
    authState,
    clientStatus: "ready",
    config: publishableConfig,
  });
}

function previewPushReadiness() {
  return syncPushReadiness({
    authState,
    clientStatus: "ready",
    config: publishableConfig,
  });
}

function writePushReadiness() {
  return syncPushReadiness({
    authState,
    clientStatus: "ready",
    config: writableConfig,
    executeWrites: true,
  });
}

function readyRepositoryReadiness() {
  return supabasePushRepositoryReadiness({
    client: { from() {} },
    config: writableConfig,
    executeConfirmations: true,
    executeWrites: true,
  });
}

function readyFinalizationReadiness(pushReadiness = writePushReadiness()) {
  return createPushFinalizationReadiness({
    finalizationEnabled: true,
    pushReadiness,
    repositoryReadiness: readyRepositoryReadiness(),
  });
}

function repository() {
  return {
    async confirmPush(input) {
      return {
        canMarkSynced: true,
        confirmedCount: input.calls.length,
        status: "confirmed",
      };
    },
    async tombstoneSession() {},
    async updateSession() {},
    async uploadSession() {},
  };
}

test("local-only orchestration keeps every cloud action disabled without mutating data", () => {
  const data = localData();
  const snapshot = structuredClone(data);
  const readReadiness = syncReadReadiness({ config: {} });
  const pushReadiness = syncPushReadiness({ config: {} });
  const model = createSyncOrchestrationModel({
    applyReadiness: syncApplyReadiness(),
    localData: data,
    pushFinalizationReadiness: createPushFinalizationReadiness(),
    pushPlan: createCloudPushPlan({ localData: data, readiness: pushReadiness, user }),
    pushReadiness,
    pushRepositoryReadiness: supabasePushRepositoryReadiness({ config: {} }),
    readReadiness,
  });

  assert.equal(model.status, "local-only");
  assert.equal(model.localTrackingAvailable, true);
  assert.equal(model.dataMutated, false);
  assert.equal(model.summary.localSessions, 1);
  assert.deepEqual(
    Object.values(model.actions).map((item) => item.enabled),
    [false, false, false, false],
  );
  assert.deepEqual(model.blockers, []);
  assert.deepEqual(data, snapshot);
});

test("signed-in publishable config maps to preview readiness with writes disabled", () => {
  const data = localData();
  const pushReadiness = previewPushReadiness();
  const pushPlan = createCloudPushPlan({
    localData: data,
    readiness: pushReadiness,
    user,
  });
  const model = createSyncOrchestrationModel({
    applyReadiness: syncApplyReadiness(),
    localData: data,
    pushFinalizationReadiness: createPushFinalizationReadiness(),
    pushPlan,
    pushReadiness,
    pushRepositoryReadiness: supabasePushRepositoryReadiness({
      client: { from() {} },
      config: publishableConfig,
    }),
    readPlan: createCloudReadPlan({ localData: data, remoteRows: [], user }),
    readReadiness: readyReadiness(),
  });

  assert.equal(model.status, "preview");
  assert.equal(model.actions.read.enabled, true);
  assert.equal(model.actions.apply.enabled, false);
  assert.equal(model.actions.push.enabled, false);
  assert.equal(model.actions.finalizePush.enabled, false);
  assert.equal(model.summary.pendingUploadCount, 1);
  assert.equal(model.summary.readRemoteSessions, 0);
  assert.deepEqual(model.blockers, []);
});

test("fully explicit gates enable future read apply push and finalize actions", () => {
  const data = localData();
  const pushReadiness = writePushReadiness();
  const repositoryReadiness = readyRepositoryReadiness();
  const readPlan = createCloudReadPlan({
    localData: data,
    remoteRows: [],
    user,
  });
  const pushPlan = createCloudPushPlan({
    localData: data,
    readiness: pushReadiness,
    user,
  });
  const model = createSyncOrchestrationModel({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: data,
    pushFinalizationReadiness: createPushFinalizationReadiness({
      finalizationEnabled: true,
      pushReadiness,
      repositoryReadiness,
    }),
    pushPlan,
    pushReadiness,
    pushRepositoryReadiness: repositoryReadiness,
    readPlan,
    readReadiness: readyReadiness(),
  });

  assert.equal(model.status, "ready");
  assert.deepEqual(
    Object.values(model.actions).map((item) => item.enabled),
    [true, true, true, true],
  );
  assert.deepEqual(model.backupExpectations, {
    applyRequiresBackup: true,
    pushFinalizationRequiresBackup: true,
    preservesOfflineCopy: true,
  });
});

test("read and push blockers are surfaced without changing local data", () => {
  const data = localData([{ ...session, endedAt: "not-a-date" }]);
  const snapshot = structuredClone(data);
  const pushReadiness = writePushReadiness();
  const model = createSyncOrchestrationModel({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: data,
    pushFinalizationReadiness: readyFinalizationReadiness(pushReadiness),
    pushPlan: createCloudPushPlan({
      localData: data,
      readiness: pushReadiness,
      user,
    }),
    pushReadiness,
    pushRepositoryReadiness: readyRepositoryReadiness(),
    readPlan: createFailedSyncReadPlan({
      error: "Remote fasting history contains rows that need review before import.",
      localData: data,
    }),
    readReadiness: readyReadiness(),
  });

  assert.equal(model.status, "blocked");
  assert.deepEqual(
    model.blockers.map((blocker) => [blocker.stage, blocker.code]),
    [
      ["pull", "cloud-read-blocked"],
      ["pushPlanning", "invalid-local-sessions"],
    ],
  );
  assert.equal(model.dataMutated, false);
  assert.deepEqual(data, snapshot);
});

test("duplicate no-op push plans stay preview-only and do not require backup", () => {
  const data = localData();
  const pushReadiness = writePushReadiness();
  const pushPlan = createCloudPushPlan({
    localData: data,
    readiness: pushReadiness,
    remoteRows: [sessionToFastSessionRow(session, user)],
    user,
  });
  const model = createSyncOrchestrationModel({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: data,
    pushFinalizationReadiness: readyFinalizationReadiness(pushReadiness),
    pushPlan,
    pushReadiness,
    pushRepositoryReadiness: readyRepositoryReadiness(),
    readPlan: createCloudReadPlan({ localData: data, remoteRows: [], user }),
    readReadiness: readyReadiness(),
  });

  assert.equal(pushPlan.status, "nothing-to-push");
  assert.equal(model.status, "preview");
  assert.equal(model.actions.push.enabled, false);
  assert.equal(model.actions.finalizePush.enabled, false);
  assert.equal(model.summary.pendingUploadCount, 0);
  assert.equal(model.summary.pendingSkipCount, 1);
  assert.equal(model.backupExpectations.pushFinalizationRequiresBackup, false);
  assert.deepEqual(model.blockers, []);
});

test("orchestration model is compatible with pull apply push and finalizer modules", async () => {
  const data = localData();
  const snapshot = structuredClone(data);
  const pushReadiness = writePushReadiness();
  const repositoryReadiness = readyRepositoryReadiness();
  const readPlan = createCloudReadPlan({
    localData: data,
    remoteRows: [],
    user,
  });
  const applyResult = applyCloudReadPlan({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: data,
    plan: readPlan,
  });
  const pushPlan = createCloudPushPlan({
    localData: data,
    readiness: pushReadiness,
    user,
  });
  const execution = await executeCloudPushPlan({
    plan: pushPlan,
    repository: repository(),
  });
  const finalizationReadiness = createPushFinalizationReadiness({
    finalizationEnabled: true,
    pushReadiness,
    repositoryReadiness,
  });
  const finalizationResult = finalizeConfirmedCloudPush({
    execution,
    finalizationReadiness,
    localData: data,
  });
  const model = createSyncOrchestrationModel({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: data,
    pushFinalizationReadiness: finalizationReadiness,
    pushPlan,
    pushReadiness,
    pushRepositoryReadiness: repositoryReadiness,
    readPlan,
    readReadiness: readyReadiness(),
  });
  const statusModel = createSyncOrchestrationStatusModel(model);

  assert.equal(applyResult.status, "applied");
  assert.equal(execution.status, "executed");
  assert.equal(finalizationResult.status, "finalized");
  assert.equal(model.status, "ready");
  assert.equal(statusModel.status, "ready");
  assert.equal(statusModel.action.disabled, false);
  assert.equal(model.dataMutated, false);
  assert.deepEqual(data, snapshot);
});
