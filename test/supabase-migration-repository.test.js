import test from "node:test";
import assert from "node:assert/strict";
import { executeGuestMigrationPlan } from "../src/migrationExecutor.js";
import {
  FAST_SESSIONS_TABLE,
  MIGRATION_REPOSITORY_METHODS,
  SupabaseMigrationRepositoryError,
  createSupabaseMigrationRepository,
  fastSessionRowToSession,
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
  migrationWritesEnabled: false,
  supabaseAnonKey: "sb_publishable_test",
  supabaseUrl: "https://example.supabase.co",
};

function fakeClient() {
  const calls = [];

  return {
    calls,
    from(table) {
      return {
        upsert(row, options) {
          calls.push({ options, row, table });
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
    config: { ...configured, migrationWritesEnabled: true },
    executeWrites: true,
  });

  await repository.uploadSession({ session, user });

  assert.deepEqual(client.calls, [
    {
      options: { onConflict: "user_id,id" },
      row: sessionToFastSessionRow(session, user),
      table: FAST_SESSIONS_TABLE,
    },
  ]);
});
