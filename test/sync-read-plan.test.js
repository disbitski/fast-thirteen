import test from "node:test";
import assert from "node:assert/strict";
import {
  createCloudReadPlan,
  createFailedSyncReadPlan,
  createSupabaseSyncReadRepository,
  normalizeRemoteFastSessionRows,
  syncReadReadiness,
} from "../src/syncReadPlan.js";
import { emptyData } from "../src/storage.js";
import { FAST_SESSIONS_TABLE, sessionToFastSessionRow } from "../src/supabaseMigrationRepository.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const localSession = {
  id: "fast-local",
  startedAt: "2026-06-24T23:00:00.000Z",
  endedAt: "2026-06-25T12:30:00.000Z",
  targetHours: 13,
  updatedAt: "2026-06-25T12:30:00.000Z",
  deletedAt: null,
};

const remoteSession = {
  id: "fast-remote",
  startedAt: "2026-06-25T23:00:00.000Z",
  endedAt: "2026-06-26T12:20:00.000Z",
  targetHours: 13,
  updatedAt: "2026-06-26T12:20:00.000Z",
  deletedAt: null,
};

function localData(sessions = [localSession], sync = {}) {
  return {
    ...emptyData(),
    profile: {
      mode: "authenticated",
      guestId: "local-guest",
      userId: user.id,
      email: user.email,
      displayName: "Dave",
      provider: "google",
      updatedAt: "2026-06-26T12:00:00.000Z",
    },
    sync: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: "2026-06-26T12:00:00.000Z",
      ...sync,
    },
    sessions,
  };
}

function row(session, rowUser = user) {
  return sessionToFastSessionRow(session, rowUser);
}

test("normalizes remote fast_sessions rows for the signed-in user", () => {
  const normalized = normalizeRemoteFastSessionRows(
    [
      row(remoteSession),
      {
        ...row({ ...remoteSession, id: "other-user-fast" }),
        user_id: "someone-else",
      },
    ],
    { user },
  );

  assert.deepEqual(normalized.sessions, [remoteSession]);
  assert.deepEqual(normalized.invalidRows, [
    {
      id: "other-user-fast",
      reason: "user-id-mismatch",
    },
  ]);
});

test("deduplicates duplicate remote rows by stable session id", () => {
  const newerRemote = {
    ...remoteSession,
    endedAt: "2026-06-26T12:45:00.000Z",
    updatedAt: "2026-06-26T12:45:00.000Z",
  };
  const normalized = normalizeRemoteFastSessionRows(
    [row(remoteSession), row(newerRemote)],
    { user },
  );

  assert.equal(normalized.duplicateCount, 1);
  assert.deepEqual(normalized.sessions, [newerRemote]);
});

test("remote-newer history is planned into local data without dropping offline sessions", () => {
  const shared = {
    ...localSession,
    endedAt: "2026-06-25T13:00:00.000Z",
    updatedAt: "2026-06-25T13:00:00.000Z",
  };
  const plan = createCloudReadPlan({
    localData: localData([localSession]),
    now: new Date("2026-06-26T13:00:00.000Z"),
    remoteRows: [row(shared), row(remoteSession)],
    user,
  });

  assert.equal(plan.status, "ready");
  assert.equal(plan.canApply, true);
  assert.deepEqual(
    plan.data.sessions.map((session) => session.id),
    ["fast-local", "fast-remote"],
  );
  assert.equal(plan.data.sessions.find((session) => session.id === "fast-local").endedAt, shared.endedAt);
  assert.deepEqual(plan.summary, {
    duplicateCount: 0,
    localKeptCount: 0,
    localSessions: 1,
    remoteAppliedCount: 2,
    remoteSessions: 2,
    tombstoneCount: 0,
  });
  assert.deepEqual(plan.syncStatus.next, {
    status: "synced",
    lastSyncedAt: "2026-06-26T13:00:00.000Z",
    lastError: null,
    updatedAt: "2026-06-26T13:00:00.000Z",
  });
});

test("local-newer offline edits win over stale remote rows", () => {
  const staleRemote = {
    ...localSession,
    endedAt: "2026-06-25T12:10:00.000Z",
    updatedAt: "2026-06-25T12:10:00.000Z",
  };
  const plan = createCloudReadPlan({
    localData: localData([localSession]),
    remoteRows: [row(staleRemote)],
    user,
  });

  assert.equal(plan.status, "ready");
  assert.deepEqual(plan.data.sessions, [localSession]);
  assert.deepEqual(plan.decisions, [
    {
      id: localSession.id,
      reason: "local-newer",
      source: "local",
    },
  ]);
});

test("tombstones win deterministic updated-at ties", () => {
  const timestamp = "2026-06-25T13:00:00.000Z";
  const completed = {
    ...localSession,
    updatedAt: timestamp,
  };
  const remoteTombstone = {
    ...completed,
    deletedAt: timestamp,
  };
  const plan = createCloudReadPlan({
    localData: localData([completed]),
    remoteRows: [row(remoteTombstone)],
    user,
  });

  assert.equal(plan.data.sessions[0].deletedAt, timestamp);
  assert.deepEqual(plan.decisions, [
    {
      id: completed.id,
      reason: "remote-tombstone-newer",
      source: "remote",
    },
  ]);
});

test("failed reads do not overwrite local-only tracking state", () => {
  const data = localData([localSession], {
    status: "local",
    updatedAt: "2026-06-26T10:00:00.000Z",
  });
  const plan = createFailedSyncReadPlan({
    error: "Network offline.",
    localData: data,
    now: new Date("2026-06-26T13:00:00.000Z"),
  });

  assert.equal(plan.status, "failed");
  assert.equal(plan.canApply, false);
  assert.deepEqual(plan.data.sync, data.sync);
  assert.deepEqual(plan.data.sessions, data.sessions);
  assert.equal(plan.syncStatus.applied, false);
  assert.deepEqual(plan.syncStatus.next, {
    status: "error",
    lastSyncedAt: null,
    lastError: "Network offline.",
    updatedAt: "2026-06-26T13:00:00.000Z",
  });
});

test("invalid remote rows keep the read plan local-safe", () => {
  const plan = createCloudReadPlan({
    localData: localData([localSession]),
    remoteRows: [
      {
        ...row(remoteSession),
        ended_at: "not-a-date",
      },
    ],
    user,
  });

  assert.equal(plan.status, "failed");
  assert.equal(plan.canApply, false);
  assert.deepEqual(plan.data.sessions, [localSession]);
  assert.deepEqual(plan.invalidRows, [
    {
      id: remoteSession.id,
      reason: "invalid-session-field",
    },
  ]);
});

test("sync read readiness maps configured signed-in state", () => {
  assert.deepEqual(syncReadReadiness({ config: {} }), {
    canRead: false,
    message: "Supabase publishable config is missing; cloud reads are disabled.",
    reason: "publishable-config-missing",
    status: "disabled",
  });

  assert.deepEqual(
    syncReadReadiness({
      authState: { status: "authenticated", user },
      clientStatus: "ready",
      config: { isConfigured: true },
    }),
    {
      canRead: true,
      message: "Cloud read planning is ready for the signed-in profile.",
      reason: null,
      status: "ready",
    },
  );
});

test("Supabase sync read repository describes the read-only fast_sessions query", async () => {
  const calls = [];
  const rows = [row(remoteSession)];
  const client = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(columns) {
          calls.push(["select", columns]);
          return {
            eq(column, value) {
              calls.push(["eq", column, value]);
              return {
                order(column, options) {
                  calls.push(["order", column, options]);
                  return Promise.resolve({ data: rows, error: null });
                },
              };
            },
          };
        },
      };
    },
  };
  const repository = createSupabaseSyncReadRepository({
    client,
    readiness: { canRead: true },
  });

  assert.deepEqual(await repository.readFastSessions({ user }), rows);
  assert.deepEqual(calls, [
    ["from", FAST_SESSIONS_TABLE],
    ["select", "*"],
    ["eq", "user_id", user.id],
    ["order", "updated_at", { ascending: true }],
  ]);
});
