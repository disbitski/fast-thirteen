import test from "node:test";
import assert from "node:assert/strict";
import { createCloudPullPreview } from "../src/syncPull.js";
import { emptyData } from "../src/storage.js";
import { sessionToFastSessionRow } from "../src/supabaseMigrationRepository.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const localSession = {
  id: "fast-local",
  startedAt: "2026-06-26T23:00:00.000Z",
  endedAt: "2026-06-27T12:15:00.000Z",
  targetHours: 13,
  updatedAt: "2026-06-27T12:15:00.000Z",
  deletedAt: null,
};

const remoteSession = {
  id: "fast-remote",
  startedAt: "2026-06-27T23:00:00.000Z",
  endedAt: "2026-06-28T12:05:00.000Z",
  targetHours: 13,
  updatedAt: "2026-06-28T12:05:00.000Z",
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
      updatedAt: "2026-06-28T11:00:00.000Z",
    },
    sync: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: "2026-06-28T11:00:00.000Z",
    },
    sessions,
  };
}

function row(session) {
  return sessionToFastSessionRow(session, user);
}

test("mocked cloud pull builds a ready read plan and preview without mutating local data", async () => {
  const data = localData();
  const repositoryCalls = [];
  const result = await createCloudPullPreview({
    localData: data,
    now: new Date("2026-06-28T13:00:00.000Z"),
    readiness: { canRead: true },
    repository: {
      async readFastSessions(input) {
        repositoryCalls.push(input);
        return [row(remoteSession)];
      },
    },
    user,
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(repositoryCalls, [{ user }]);
  assert.deepEqual(data.sessions, [localSession]);
  assert.deepEqual(
    result.plan.data.sessions.map((session) => session.id),
    ["fast-local", "fast-remote"],
  );
  assert.deepEqual(result.plan.summary, {
    duplicateCount: 0,
    localKeptCount: 0,
    localSessions: 1,
    remoteAppliedCount: 1,
    remoteSessions: 1,
    tombstoneCount: 0,
  });
  assert.equal(result.model.status, "ready");
  assert.equal(result.model.title, "Cloud read preview ready");
  assert.match(result.model.message, /does not write to Supabase/);
  assert.equal(result.diagnostics.status, "preview");
  assert.equal(result.diagnostics.profileMode, "authenticated");
  assert.equal(result.diagnostics.dataMutated, false);
  assert.equal(result.diagnostics.localSyncStatusChanged, false);
  assert.equal(result.diagnostics.plannedSyncStatus, "synced");
  assert.deepEqual(
    Object.values(result.diagnostics.stages).map((stage) => stage.status),
    ["ready", "passed", "ready", "gated"],
  );
});

test("cloud pull passes explicit apply readiness into the preview action", async () => {
  const result = await createCloudPullPreview({
    applyReadiness: {
      canApply: true,
      message: "Successful cloud read plans can be applied to the local offline copy.",
    },
    localData: localData(),
    readiness: { canRead: true },
    repository: {
      async readFastSessions() {
        return [row(remoteSession)];
      },
    },
    user,
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.model.action, {
    disabled: false,
    label: "Apply cloud read",
    message: "Successful cloud read plans can be applied to the local offline copy.",
  });
  assert.equal(result.diagnostics.status, "apply-ready");
  assert.equal(result.diagnostics.backupRequired, true);
  assert.equal(result.diagnostics.stages.localApply.status, "ready");
  assert.match(result.diagnostics.nextStep, /Preserve a local backup/);
});

test("repository failures return a blocked preview and keep local sync state unchanged", async () => {
  const data = localData();
  const result = await createCloudPullPreview({
    localData: data,
    now: new Date("2026-06-28T13:00:00.000Z"),
    readiness: { canRead: true },
    repository: {
      async readFastSessions() {
        throw new Error("Network offline.");
      },
    },
    user,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.plan.canApply, false);
  assert.deepEqual(result.plan.data.sync, data.sync);
  assert.deepEqual(result.plan.data.sessions, data.sessions);
  assert.equal(result.plan.syncStatus.applied, false);
  assert.equal(result.model.status, "blocked");
  assert.deepEqual(result.model.details, [
    "Network offline.",
    "1 local session remains available offline.",
    "Local sync status is not changed until a read plan succeeds.",
  ]);
  assert.equal(result.diagnostics.status, "blocked");
  assert.deepEqual(result.diagnostics.blockers, [
    {
      code: "repository-read-failed",
      message: "Network offline.",
      stage: "repositoryRead",
    },
  ]);
  assert.equal(result.diagnostics.stages.repositoryRead.status, "blocked");
  assert.equal(result.diagnostics.stages.mergePlan.status, "not-run");
  assert.equal(result.diagnostics.localTrackingAvailable, true);
});

test("disabled readiness does not call the repository", async () => {
  let called = false;
  const result = await createCloudPullPreview({
    localData: localData(),
    readiness: {
      canRead: false,
      message: "Sign in before cloud fasting history can be read.",
    },
    repository: {
      async readFastSessions() {
        called = true;
        return [row(remoteSession)];
      },
    },
    user,
  });

  assert.equal(called, false);
  assert.equal(result.status, "disabled");
  assert.equal(result.plan.canApply, false);
  assert.equal(result.model.status, "disabled");
  assert.equal(result.model.action.label, "Cloud read disabled");
  assert.equal(result.diagnostics.status, "disabled");
  assert.equal(result.diagnostics.stages.readiness.status, "disabled");
  assert.equal(result.diagnostics.stages.repositoryRead.status, "not-run");
  assert.equal(result.diagnostics.backupRequired, false);
});

test("missing repository is blocked even when readiness is true", async () => {
  const result = await createCloudPullPreview({
    localData: localData(),
    readiness: { canRead: true },
    repository: {},
    user,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.model.status, "blocked");
  assert.match(result.plan.message, /repository is not available/);
});

test("invalid remote rows map to read blockers and preview copy", async () => {
  const result = await createCloudPullPreview({
    localData: localData(),
    readiness: { canRead: true },
    repository: {
      async readFastSessions() {
        return [
          {
            ...row(remoteSession),
            ended_at: "not-a-date",
          },
        ];
      },
    },
    user,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.plan.canApply, false);
  assert.deepEqual(result.plan.invalidRows, [
    {
      id: remoteSession.id,
      reason: "invalid-session-field",
    },
  ]);
  assert.equal(result.model.status, "blocked");
  assert.match(result.model.details[0], /need review/);
  assert.equal(result.diagnostics.status, "blocked");
  assert.equal(result.diagnostics.invalidRowCount, 1);
  assert.equal(result.diagnostics.stages.repositoryRead.status, "passed");
  assert.equal(result.diagnostics.stages.mergePlan.status, "blocked");
  assert.deepEqual(result.diagnostics.blockers, [
    {
      code: "invalid-remote-rows",
      message: "Remote fasting history contains rows that need review before import.",
      stage: "mergePlan",
    },
  ]);
});
