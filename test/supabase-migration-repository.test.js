import test from "node:test";
import assert from "node:assert/strict";
import { executeGuestMigrationPlan } from "../src/migrationExecutor.js";
import {
  FAST_SESSIONS_TABLE,
  MIGRATION_REPOSITORY_METHODS,
  SupabaseMigrationRepositoryError,
  createMigrationConfirmationResult,
  createSupabaseMigrationRepository,
  fastSessionRowToSession,
  normalizeMigrationReadBackRows,
  sessionToFastSessionRow,
  supabaseMigrationRepositoryReadiness,
} from "../src/supabaseMigrationRepository.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const session = {
  id: "fast-2026-06-22",
  startedAt: "2026-06-21T23:30:00.000Z",
  endedAt: "2026-06-22T12:45:00.000Z",
  targetHours: 13,
  updatedAt: "2026-06-22T12:45:00.000Z",
  deletedAt: null,
};

const configured = {
  isConfigured: true,
  migrationConfirmationsEnabled: false,
  migrationWritesEnabled: false,
  supabaseAnonKey: "sb_publishable_test",
  supabaseUrl: "https://example.supabase.co",
};

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

function plan() {
  return {
    backup: "{\n  \"version\": 3\n}",
    backupCreatedAt: "2026-06-23T13:00:00.000Z",
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

async function assertRepositoryError(input, code) {
  await assert.rejects(
    input,
    (error) => error instanceof SupabaseMigrationRepositoryError && error.code === code,
  );
}

test("maps local sessions to fast_sessions rows", () => {
  assert.deepEqual(sessionToFastSessionRow(session, user), {
    user_id: user.id,
    id: session.id,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    target_hours: 13,
    updated_at: session.updatedAt,
    deleted_at: null,
  });
});

test("maps fast_sessions rows back to local sessions", () => {
  assert.deepEqual(
    fastSessionRowToSession({
      user_id: user.id,
      id: session.id,
      started_at: session.startedAt,
      ended_at: session.endedAt,
      target_hours: "13",
      updated_at: session.updatedAt,
      deleted_at: null,
    }),
    session,
  );
});

test("publishable config alone keeps migration writes disabled", () => {
  assert.deepEqual(
    supabaseMigrationRepositoryReadiness({
      client: fakeClient(),
      config: configured,
    }),
    {
      canWrite: false,
      canConfirm: false,
      message: "Publishable Supabase config is present, but migration write support is disabled.",
      reason: "write-support-disabled",
      status: "disabled",
    },
  );
});

test("migration writes stay disabled without explicit executor support", () => {
  assert.deepEqual(
    supabaseMigrationRepositoryReadiness({
      client: fakeClient(),
      config: { ...configured, migrationWritesEnabled: true },
    }),
    {
      canWrite: false,
      canConfirm: false,
      message: "Migration write support is configured, but execution is disabled in this build.",
      reason: "executor-disabled",
      status: "disabled",
    },
  );
});

test("repository exposes the migration executor contract", () => {
  const repository = createSupabaseMigrationRepository({
    client: fakeClient(),
    config: configured,
  });

  assert.deepEqual(repository.methods, MIGRATION_REPOSITORY_METHODS);
  for (const method of MIGRATION_REPOSITORY_METHODS) {
    assert.equal(typeof repository[method], "function");
  }
});

test("disabled repository rejects writes before touching Supabase", async () => {
  const client = fakeClient();
  const repository = createSupabaseMigrationRepository({
    client,
    config: configured,
  });

  await assertRepositoryError(
    () => repository.uploadSession({ session, user }),
    "migration-writes-disabled",
  );
  assert.deepEqual(client.calls, []);
});

test("disabled Supabase repository is compatible with executor gating", async () => {
  const client = fakeClient();
  const repository = createSupabaseMigrationRepository({
    client,
    config: configured,
  });

  await assertRepositoryError(
    () => executeGuestMigrationPlan({ plan: plan(), repository }),
    "migration-writes-disabled",
  );
  assert.deepEqual(client.calls, []);
});

test("explicitly enabled repository maps uploads to fast_sessions upsert", async () => {
  const client = fakeClient();
  const repository = createSupabaseMigrationRepository({
    client,
    config: { ...configured, migrationConfirmationsEnabled: true, migrationWritesEnabled: true },
    executeConfirmations: true,
    executeWrites: true,
  });

  await repository.uploadSession({ session, user });

  assert.deepEqual(client.calls, [
    {
      options: { onConflict: "user_id,id" },
      row: sessionToFastSessionRow(session, user),
      table: FAST_SESSIONS_TABLE,
      type: "upsert",
    },
  ]);
});

test("confirmation support must be explicit before repository can execute", () => {
  assert.deepEqual(
    supabaseMigrationRepositoryReadiness({
      client: fakeClient(),
      config: { ...configured, migrationWritesEnabled: true },
      executeWrites: true,
    }),
    {
      canConfirm: false,
      canWrite: false,
      message: "Migration writes require explicit read-back confirmation support before execution.",
      reason: "confirmation-support-disabled",
      status: "disabled",
    },
  );
});

test("normalizes read-back rows by user and latest update", () => {
  const older = {
    ...sessionToFastSessionRow(session, user),
    updated_at: "2026-06-22T11:00:00.000Z",
  };
  const newest = sessionToFastSessionRow(session, user);
  const otherUser = {
    ...newest,
    id: "other-user-fast",
    user_id: "someone-else",
  };
  const readBack = normalizeMigrationReadBackRows([older, newest, otherUser], { user });

  assert.equal(readBack.sessions.size, 1);
  assert.deepEqual(readBack.sessions.get(session.id), session);
  assert.deepEqual(readBack.invalidRows, [
    {
      id: "other-user-fast",
      reason: "user-id-mismatch",
    },
  ]);
});

test("confirms read-back rows that match the migration plan", () => {
  assert.deepEqual(
    createMigrationConfirmationResult({
      plan: plan(),
      rows: [sessionToFastSessionRow(session, user)],
      user,
    }),
    {
      blockers: [],
      canMarkSynced: true,
      confirmedCount: 1,
      expectedCount: 1,
      readBackCount: 1,
      status: "confirmed",
    },
  );
});

test("blocks confirmation when a read-back row is missing", () => {
  const confirmation = createMigrationConfirmationResult({
    plan: plan(),
    rows: [],
    user,
  });

  assert.equal(confirmation.status, "blocked");
  assert.equal(confirmation.canMarkSynced, false);
  assert.deepEqual(confirmation.blockers, [
    {
      action: "upload",
      code: "missing-read-back-row",
      sessionId: session.id,
    },
  ]);
});

test("blocks confirmation when a read-back row changed", () => {
  const changed = {
    ...sessionToFastSessionRow(session, user),
    target_hours: 14,
  };
  const confirmation = createMigrationConfirmationResult({
    plan: plan(),
    rows: [changed],
    user,
  });

  assert.equal(confirmation.status, "blocked");
  assert.deepEqual(confirmation.blockers, [
    {
      code: "changed-read-back-row",
      fields: ["targetHours"],
      sessionId: session.id,
    },
  ]);
});

test("blocks confirmation when a tombstone was not read back as deleted", () => {
  const deletedSession = {
    ...session,
    deletedAt: "2026-06-22T13:00:00.000Z",
    id: "fast-deleted",
    updatedAt: "2026-06-22T13:00:00.000Z",
  };
  const confirmation = createMigrationConfirmationResult({
    plan: {
      ...plan(),
      uploadCandidates: [
        {
          action: "tombstone",
          cloudSession: { ...deletedSession, deletedAt: null },
          reason: "local-tombstone-newer",
          session: deletedSession,
        },
      ],
    },
    rows: [
      sessionToFastSessionRow(
        {
          ...deletedSession,
          deletedAt: null,
        },
        user,
      ),
    ],
    user,
  });

  assert.equal(confirmation.status, "blocked");
  assert.deepEqual(confirmation.blockers, [
    {
      code: "tombstone-not-confirmed",
      sessionId: deletedSession.id,
    },
  ]);
});

test("repository confirms migration by reading fast_sessions rows", async () => {
  const client = fakeClient({ readRows: [sessionToFastSessionRow(session, user)] });
  const repository = createSupabaseMigrationRepository({
    client,
    config: { ...configured, migrationConfirmationsEnabled: true, migrationWritesEnabled: true },
    executeConfirmations: true,
    executeWrites: true,
  });

  const confirmation = await repository.confirmMigration({ plan: plan(), user });

  assert.equal(confirmation.status, "confirmed");
  assert.deepEqual(client.calls, [
    {
      columns: "*",
      table: FAST_SESSIONS_TABLE,
      type: "select",
    },
    {
      column: "user_id",
      table: FAST_SESSIONS_TABLE,
      type: "eq",
      value: user.id,
    },
  ]);
});
