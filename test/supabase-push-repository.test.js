import test from "node:test";
import assert from "node:assert/strict";
import { executeCloudPushPlan } from "../src/syncPushExecutor.js";
import { createCloudPushPlan, syncPushReadiness } from "../src/syncPushPlan.js";
import { emptyData } from "../src/storage.js";
import {
  FAST_SESSIONS_TABLE,
  PUSH_REPOSITORY_METHODS,
  SupabaseMigrationRepositoryError,
  createPushConfirmationResult,
  createSupabasePushRepository,
  pushCandidateToFastSessionMutation,
  sessionToFastSessionRow,
  supabasePushRepositoryReadiness,
} from "../src/supabaseMigrationRepository.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const session = {
  id: "fast-2026-07-03",
  startedAt: "2026-07-02T23:15:00.000Z",
  endedAt: "2026-07-03T12:30:00.000Z",
  targetHours: 13,
  updatedAt: "2026-07-03T12:30:00.000Z",
  deletedAt: null,
};

const configured = {
  isConfigured: true,
  supabaseAnonKey: "sb_publishable_test",
  supabaseUrl: "https://example.supabase.co",
  syncConfirmationsEnabled: false,
  syncWritesEnabled: false,
};

const writeReady = syncPushReadiness({
  authState: { status: "authenticated", user },
  clientStatus: "ready",
  config: { ...configured, syncWritesEnabled: true },
  executeWrites: true,
});

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
      updatedAt: "2026-07-03T11:00:00.000Z",
    },
    sync: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: "2026-07-03T11:00:00.000Z",
    },
    sessions,
  };
}

function fakeClient({ readRows = [] } = {}) {
  const calls = [];

  return {
    calls,
    from(table) {
      return {
        select(columns) {
          calls.push({ columns, table, type: "select" });
          return {
            eq(column, value) {
              calls.push({ column, table, type: "eq", value });
              return Promise.resolve({ data: readRows, error: null });
            },
          };
        },
        upsert(row, options) {
          calls.push({ options, row, table, type: "upsert" });
          return Promise.resolve({ data: row, error: null });
        },
      };
    },
  };
}

function plan(overrides = {}) {
  return createCloudPushPlan({
    localData: localData(),
    readiness: writeReady,
    user,
    ...overrides,
  });
}

async function assertRepositoryError(input, code) {
  await assert.rejects(
    input,
    (error) => error instanceof SupabaseMigrationRepositoryError && error.code === code,
  );
}

test("maps push candidates to fast_sessions upsert mutations", () => {
  assert.deepEqual(
    pushCandidateToFastSessionMutation(
      {
        action: "upload",
        reason: "local-session-missing-in-cloud",
        session,
      },
      user,
    ),
    {
      action: "upload",
      reason: "local-session-missing-in-cloud",
      row: sessionToFastSessionRow(session, user),
      table: FAST_SESSIONS_TABLE,
      type: "upsert",
    },
  );

  assert.throws(
    () => pushCandidateToFastSessionMutation({ action: "merge", session }, user),
    (error) => error instanceof SupabaseMigrationRepositoryError && error.code === "invalid-push-action",
  );
});

test("publishable config alone keeps cloud push writes disabled", () => {
  assert.deepEqual(
    supabasePushRepositoryReadiness({
      client: fakeClient(),
      config: configured,
    }),
    {
      canConfirm: false,
      canWrite: false,
      message: "Publishable Supabase config is present, but cloud push write support is disabled.",
      reason: "write-support-disabled",
      status: "disabled",
    },
  );
});

test("cloud push writes require explicit execution and confirmation support", () => {
  assert.deepEqual(
    supabasePushRepositoryReadiness({
      client: fakeClient(),
      config: { ...configured, syncWritesEnabled: true },
    }),
    {
      canConfirm: false,
      canWrite: false,
      message: "Cloud push write support is configured, but execution is disabled in this build.",
      reason: "executor-disabled",
      status: "disabled",
    },
  );

  assert.deepEqual(
    supabasePushRepositoryReadiness({
      client: fakeClient(),
      config: { ...configured, syncWritesEnabled: true },
      executeWrites: true,
    }),
    {
      canConfirm: false,
      canWrite: false,
      message: "Cloud push writes require explicit read-back confirmation support before execution.",
      reason: "confirmation-support-disabled",
      status: "disabled",
    },
  );

  assert.deepEqual(
    supabasePushRepositoryReadiness({
      client: fakeClient(),
      config: { ...configured, syncConfirmationsEnabled: true, syncWritesEnabled: true },
      executeWrites: true,
    }),
    {
      canConfirm: false,
      canWrite: false,
      message: "Cloud push confirmation support is configured, but confirmation is disabled in this build.",
      reason: "confirmation-disabled",
      status: "disabled",
    },
  );
});

test("repository exposes the push executor contract", () => {
  const repository = createSupabasePushRepository({
    client: fakeClient(),
    config: configured,
  });

  assert.deepEqual(repository.methods, PUSH_REPOSITORY_METHODS);
  for (const method of PUSH_REPOSITORY_METHODS) {
    assert.equal(typeof repository[method], "function");
  }
});

test("disabled push repository rejects writes before touching Supabase", async () => {
  const client = fakeClient();
  const repository = createSupabasePushRepository({
    client,
    config: configured,
  });

  await assertRepositoryError(
    () => repository.uploadSession({ session, user }),
    "push-writes-disabled",
  );
  assert.deepEqual(client.calls, []);
});

test("disabled Supabase push repository remains local-safe with push executor", async () => {
  const client = fakeClient();
  const repository = createSupabasePushRepository({
    client,
    config: configured,
  });
  const data = localData();
  const snapshot = structuredClone(data);

  await assertRepositoryError(
    () => executeCloudPushPlan({
      plan: plan({ localData: data }),
      repository,
    }),
    "push-writes-disabled",
  );

  assert.deepEqual(client.calls, []);
  assert.deepEqual(data, snapshot);
});

test("enabled repository maps upload update and tombstone calls to fast_sessions upserts", async () => {
  const deleted = {
    ...session,
    id: "fast-deleted",
    deletedAt: "2026-07-03T13:00:00.000Z",
    updatedAt: "2026-07-03T13:00:00.000Z",
  };
  const client = fakeClient({ readRows: [sessionToFastSessionRow(session, user), sessionToFastSessionRow(deleted, user)] });
  const repository = createSupabasePushRepository({
    client,
    config: { ...configured, syncConfirmationsEnabled: true, syncWritesEnabled: true },
    executeConfirmations: true,
    executeWrites: true,
  });

  await repository.uploadSession({ reason: "local-session-missing-in-cloud", session, user });
  await repository.updateSession({ reason: "local-session-newer", session, user });
  await repository.tombstoneSession({ reason: "local-tombstone-newer", session: deleted, user });

  assert.deepEqual(
    client.calls.map((call) => [call.type, call.row?.id ?? null, call.options ?? null]),
    [
      ["upsert", session.id, { onConflict: "user_id,id" }],
      ["upsert", session.id, { onConflict: "user_id,id" }],
      ["upsert", deleted.id, { onConflict: "user_id,id" }],
    ],
  );
});

test("push confirmation reads back rows and blocks changed or missing sessions", async () => {
  const missingConfirmation = createPushConfirmationResult({
    plan: plan(),
    rows: [],
    user,
  });
  assert.equal(missingConfirmation.status, "blocked");
  assert.deepEqual(missingConfirmation.blockers, [
    {
      action: "upload",
      code: "missing-read-back-row",
      sessionId: session.id,
    },
  ]);

  const changedConfirmation = createPushConfirmationResult({
    plan: plan(),
    rows: [
      {
        ...sessionToFastSessionRow(session, user),
        target_hours: 14,
      },
    ],
    user,
  });
  assert.equal(changedConfirmation.status, "blocked");
  assert.deepEqual(changedConfirmation.blockers, [
    {
      code: "changed-read-back-row",
      fields: ["targetHours"],
      sessionId: session.id,
    },
  ]);
});

test("enabled push repository is compatible with executeCloudPushPlan and confirmation", async () => {
  const client = fakeClient({ readRows: [sessionToFastSessionRow(session, user)] });
  const repository = createSupabasePushRepository({
    client,
    config: { ...configured, syncConfirmationsEnabled: true, syncWritesEnabled: true },
    executeConfirmations: true,
    executeWrites: true,
  });
  const data = localData();
  const snapshot = structuredClone(data);
  const execution = await executeCloudPushPlan({
    plan: plan({ localData: data }),
    repository,
  });

  assert.equal(execution.status, "executed");
  assert.equal(execution.localDataMutated, false);
  assert.equal(execution.syncUpdated, false);
  assert.deepEqual(data, snapshot);
  assert.deepEqual(
    client.calls.map((call) => [call.type, call.row?.id ?? call.columns ?? null]),
    [
      ["upsert", session.id],
      ["select", "*"],
      ["eq", null],
    ],
  );
});
