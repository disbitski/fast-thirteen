import test from "node:test";
import assert from "node:assert/strict";
import {
  createCloudPushPlan,
  createCloudPushPreviewModel,
  syncPushReadiness,
} from "../src/syncPushPlan.js";
import { emptyData } from "../src/storage.js";
import { sessionToFastSessionRow } from "../src/supabaseMigrationRepository.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const baseSession = {
  id: "fast-local",
  startedAt: "2026-06-28T23:00:00.000Z",
  endedAt: "2026-06-29T12:15:00.000Z",
  targetHours: 13,
  updatedAt: "2026-06-29T12:15:00.000Z",
  deletedAt: null,
};

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
      updatedAt: "2026-06-30T11:00:00.000Z",
    },
    sync: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: "2026-06-30T11:00:00.000Z",
    },
    sessions,
  };
}

function row(session) {
  return sessionToFastSessionRow(session, user);
}

const planningReady = {
  canPlan: true,
  canWrite: false,
  localTrackingAvailable: true,
  message: "Cloud push planning is available, but Supabase writes are disabled in this build.",
  reason: "write-support-disabled",
  status: "preview-only",
};

test("push readiness preserves local tracking when cloud planning is disabled", () => {
  assert.deepEqual(syncPushReadiness({ config: {} }), {
    canPlan: false,
    canWrite: false,
    localTrackingAvailable: true,
    message: "Supabase publishable config is missing; push planning is disabled. Local tracking still works.",
    reason: "publishable-config-missing",
    status: "disabled",
  });

  assert.deepEqual(
    syncPushReadiness({
      authState: { status: "authenticated", user },
      clientStatus: "ready",
      config: { isConfigured: true },
    }),
    planningReady,
  );
});

test("plans upload update and tombstone candidates without live writes", () => {
  const uploadSession = {
    ...baseSession,
    id: "fast-upload",
    updatedAt: "2026-06-29T12:00:00.000Z",
  };
  const updateSession = {
    ...baseSession,
    id: "fast-update",
    endedAt: "2026-06-29T13:05:00.000Z",
    updatedAt: "2026-06-29T13:05:00.000Z",
  };
  const staleRemoteUpdate = {
    ...updateSession,
    endedAt: "2026-06-29T12:45:00.000Z",
    updatedAt: "2026-06-29T12:45:00.000Z",
  };
  const tombstoneSession = {
    ...baseSession,
    id: "fast-delete",
    deletedAt: "2026-06-30T10:00:00.000Z",
    updatedAt: "2026-06-30T10:00:00.000Z",
  };
  const remoteCompleted = {
    ...tombstoneSession,
    deletedAt: null,
    updatedAt: "2026-06-30T09:00:00.000Z",
  };
  const plan = createCloudPushPlan({
    localData: localData([uploadSession, updateSession, tombstoneSession]),
    readiness: planningReady,
    remoteRows: [row(staleRemoteUpdate), row(remoteCompleted)],
    user,
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.readiness.canWrite, false);
  assert.deepEqual(
    plan.candidates.map((candidate) => [candidate.session.id, candidate.action, candidate.reason]),
    [
      ["fast-upload", "upload", "local-session-missing-in-cloud"],
      ["fast-update", "update", "local-session-newer"],
      ["fast-delete", "tombstone", "local-tombstone-newer"],
    ],
  );
  assert.deepEqual(plan.summary, {
    duplicateCount: 0,
    invalidCount: 0,
    localSessions: 3,
    remoteSessions: 2,
    skipCount: 0,
    tombstoneCount: 1,
    updateCount: 1,
    uploadCount: 1,
  });
});

test("skips duplicates and remote-newer sessions by stable id", () => {
  const remoteNewer = {
    ...baseSession,
    id: "remote-newer",
    endedAt: "2026-06-29T13:00:00.000Z",
    updatedAt: "2026-06-29T13:00:00.000Z",
  };
  const localOlder = {
    ...remoteNewer,
    endedAt: "2026-06-29T12:00:00.000Z",
    updatedAt: "2026-06-29T12:00:00.000Z",
  };
  const duplicate = {
    ...baseSession,
    id: "duplicate",
  };
  const plan = createCloudPushPlan({
    localData: localData([duplicate, localOlder]),
    readiness: planningReady,
    remoteRows: [row(duplicate), row(remoteNewer), row(remoteNewer)],
    user,
  });

  assert.equal(plan.status, "nothing-to-push");
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(plan.skippedSessions, [
    { id: "duplicate", reason: "duplicate" },
    { id: "remote-newer", reason: "remote-newer" },
  ]);
  assert.equal(plan.summary.duplicateCount, 2);
});

test("tombstones win deterministic updated-at ties during push planning", () => {
  const timestamp = "2026-06-30T10:00:00.000Z";
  const localTombstone = {
    ...baseSession,
    id: "local-tombstone",
    deletedAt: timestamp,
    updatedAt: timestamp,
  };
  const remoteCompleted = {
    ...localTombstone,
    deletedAt: null,
    updatedAt: timestamp,
  };
  const localCompleted = {
    ...baseSession,
    id: "remote-tombstone",
    updatedAt: timestamp,
  };
  const remoteTombstone = {
    ...localCompleted,
    deletedAt: timestamp,
    updatedAt: timestamp,
  };
  const plan = createCloudPushPlan({
    localData: localData([localTombstone, localCompleted]),
    readiness: planningReady,
    remoteRows: [row(remoteCompleted), row(remoteTombstone)],
    user,
  });

  assert.deepEqual(
    plan.candidates.map((candidate) => [candidate.session.id, candidate.action, candidate.reason]),
    [["local-tombstone", "tombstone", "local-tombstone-newer"]],
  );
  assert.deepEqual(plan.skippedSessions, [
    {
      id: "remote-tombstone",
      reason: "remote-tombstone-newer",
    },
  ]);
});

test("disabled readiness produces a no-op push plan", () => {
  const plan = createCloudPushPlan({
    localData: localData([baseSession]),
    readiness: syncPushReadiness({ config: {} }),
    remoteRows: [row(baseSession)],
    user,
  });

  assert.equal(plan.status, "disabled");
  assert.deepEqual(plan.candidates, []);
  assert.equal(plan.summary.localSessions, 1);
  assert.equal(plan.summary.remoteSessions, 0);
  assert.match(plan.message, /Local tracking still works/);
});

test("invalid local and remote records block push planning", () => {
  const plan = createCloudPushPlan({
    localData: localData([
      {
        ...baseSession,
        id: "invalid-local",
        endedAt: "not-a-date",
      },
    ]),
    readiness: planningReady,
    remoteRows: [
      {
        ...row(baseSession),
        user_id: "someone-else",
      },
    ],
    user,
  });

  assert.equal(plan.status, "blocked");
  assert.deepEqual(plan.blockers, ["invalid-local-sessions", "invalid-remote-sessions"]);
  assert.deepEqual(plan.invalidSessions, [
    {
      id: "invalid-local",
      reason: "ended-at-invalid",
    },
  ]);
  assert.deepEqual(plan.invalidRemoteSessions, [
    {
      id: baseSession.id,
      reason: "user-id-mismatch",
    },
  ]);
  assert.equal(plan.summary.invalidCount, 2);
});

test("push preview maps ready disabled and blocked states", () => {
  const readyPlan = createCloudPushPlan({
    localData: localData([baseSession]),
    readiness: planningReady,
    remoteRows: [],
    user,
  });
  const readyModel = createCloudPushPreviewModel(readyPlan);

  assert.equal(readyModel.status, "ready");
  assert.equal(readyModel.action.disabled, true);
  assert.equal(readyModel.action.label, "Push preview only");
  assert.match(readyModel.message, /does not write to Supabase/);
  assert.deepEqual(readyModel.details, [
    "1 new fast would upload.",
    "0 local edits would update cloud history.",
    "0 deleted fasts would stay deleted in cloud history.",
    "0 duplicates would be skipped by stable session id.",
  ]);

  const disabledModel = createCloudPushPreviewModel(createCloudPushPlan({
    localData: localData([baseSession]),
    readiness: syncPushReadiness({ config: {} }),
  }));
  assert.equal(disabledModel.status, "disabled");
  assert.equal(disabledModel.action.label, "Cloud push disabled");

  const blockedModel = createCloudPushPreviewModel(createCloudPushPlan({
    localData: localData([{ ...baseSession, startedAt: "bad-date" }]),
    readiness: planningReady,
    user,
  }));
  assert.equal(blockedModel.status, "blocked");
  assert.equal(blockedModel.action.label, "Resolve push blockers");
});
