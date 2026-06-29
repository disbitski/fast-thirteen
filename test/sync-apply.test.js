import test from "node:test";
import assert from "node:assert/strict";
import { applyCloudReadPlan, syncApplyReadiness } from "../src/syncApply.js";
import { createCloudReadPlan, createFailedSyncReadPlan } from "../src/syncReadPlan.js";
import { emptyData, parseBackup } from "../src/storage.js";
import { sessionToFastSessionRow } from "../src/supabaseMigrationRepository.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const localSession = {
  id: "fast-local",
  startedAt: "2026-06-27T23:00:00.000Z",
  endedAt: "2026-06-28T12:15:00.000Z",
  targetHours: 13,
  updatedAt: "2026-06-28T12:15:00.000Z",
  deletedAt: null,
};

const remoteSession = {
  id: "fast-remote",
  startedAt: "2026-06-28T23:00:00.000Z",
  endedAt: "2026-06-29T12:10:00.000Z",
  targetHours: 13,
  updatedAt: "2026-06-29T12:10:00.000Z",
  deletedAt: null,
};

function localData(sessions = [localSession]) {
  return {
    ...emptyData(),
    profile: {
      mode: "authenticated",
      guestId: "local-guest",
      userId: user.id,
      email: user.email,
      displayName: "Dave",
      provider: "google",
      updatedAt: "2026-06-29T11:00:00.000Z",
    },
    sync: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: "2026-06-29T11:00:00.000Z",
    },
    sessions,
  };
}

function row(session) {
  return sessionToFastSessionRow(session, user);
}

test("apply readiness is disabled until explicit local apply support is enabled", () => {
  assert.deepEqual(syncApplyReadiness(), {
    canApply: false,
    message: "Applying cloud reads is disabled until local finalization support is explicitly enabled.",
    reason: "apply-support-disabled",
    status: "disabled",
  });

  assert.deepEqual(syncApplyReadiness({ enabled: true }), {
    canApply: true,
    message: "Successful cloud read plans can be applied to the local offline copy.",
    reason: null,
    status: "ready",
  });
});

test("successful cloud read plans preserve a local backup before applying", () => {
  const data = localData();
  const plan = createCloudReadPlan({
    localData: data,
    now: new Date("2026-06-29T13:00:00.000Z"),
    remoteRows: [row(remoteSession)],
    user,
  });
  const result = applyCloudReadPlan({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: data,
    now: new Date("2026-06-29T13:05:00.000Z"),
    plan,
  });

  assert.equal(result.status, "applied");
  assert.equal(result.applied, true);
  assert.equal(result.backupCreatedAt, "2026-06-29T13:05:00.000Z");
  assert.deepEqual(parseBackup(result.backup), data);
  assert.deepEqual(data.sessions, [localSession]);
  assert.deepEqual(
    result.data.sessions.map((session) => session.id),
    ["fast-local", "fast-remote"],
  );
  assert.deepEqual(result.data.sync, plan.data.sync);
});

test("failed read plans do not change local data", () => {
  const data = localData();
  const failedPlan = createFailedSyncReadPlan({
    error: "Network offline.",
    localData: data,
  });
  const result = applyCloudReadPlan({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: data,
    plan: failedPlan,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.applied, false);
  assert.equal(result.backup, null);
  assert.deepEqual(result.data, data);
});

test("disabled apply support blocks ready read plans", () => {
  const data = localData();
  const plan = createCloudReadPlan({
    localData: data,
    remoteRows: [row(remoteSession)],
    user,
  });
  const result = applyCloudReadPlan({
    localData: data,
    plan,
  });

  assert.equal(result.status, "disabled");
  assert.equal(result.applied, false);
  assert.equal(result.backup, null);
  assert.deepEqual(result.data, data);
  assert.match(result.message, /disabled/);
});

test("applied read plans preserve tombstone and local-newer merge decisions", () => {
  const timestamp = "2026-06-29T13:00:00.000Z";
  const localNewer = {
    ...localSession,
    id: "shared-local-newer",
    updatedAt: "2026-06-29T13:30:00.000Z",
  };
  const staleRemote = {
    ...localNewer,
    endedAt: "2026-06-29T12:45:00.000Z",
    updatedAt: "2026-06-29T12:45:00.000Z",
  };
  const completed = {
    ...remoteSession,
    id: "shared-tombstone",
    updatedAt: timestamp,
  };
  const remoteTombstone = {
    ...completed,
    deletedAt: timestamp,
  };
  const plan = createCloudReadPlan({
    localData: localData([localNewer, completed]),
    remoteRows: [row(staleRemote), row(remoteTombstone)],
    user,
  });
  const result = applyCloudReadPlan({
    applyReadiness: syncApplyReadiness({ enabled: true }),
    localData: localData([localNewer, completed]),
    plan,
  });

  assert.equal(result.status, "applied");
  assert.equal(
    result.data.sessions.find((session) => session.id === localNewer.id).endedAt,
    localNewer.endedAt,
  );
  assert.equal(
    result.data.sessions.find((session) => session.id === completed.id).deletedAt,
    timestamp,
  );
  assert.deepEqual(
    plan.decisions.map((decision) => decision.reason),
    ["local-newer", "remote-tombstone-newer"],
  );
});
