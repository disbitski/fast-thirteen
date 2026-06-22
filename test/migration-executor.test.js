import test from "node:test";
import assert from "node:assert/strict";
import { executeGuestMigrationPlan, MigrationExecutionError } from "../src/migrationExecutor.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const session = {
  id: "fast-2026-06-21",
  startedAt: "2026-06-20T23:00:00.000Z",
  endedAt: "2026-06-21T12:15:00.000Z",
  targetHours: 13,
  updatedAt: "2026-06-21T12:15:00.000Z",
  deletedAt: null,
};

const tombstone = {
  ...session,
  id: "fast-deleted",
  deletedAt: "2026-06-21T13:00:00.000Z",
  updatedAt: "2026-06-21T13:00:00.000Z",
};

function plan(overrides = {}) {
  return {
    backup: "{\n  \"version\": 3\n}",
    backupCreatedAt: "2026-06-22T13:00:00.000Z",
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
    ...overrides,
  };
}

function repository() {
  const calls = [];

  return {
    calls,
    async preserveBackup(input) {
      calls.push(["backup", input]);
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

async function assertMigrationError(input, code) {
  await assert.rejects(
    () => executeGuestMigrationPlan(input),
    (error) => error instanceof MigrationExecutionError && error.code === code,
  );
}

test("requires a current authenticated user before execution", async () => {
  const repo = repository();

  await assertMigrationError(
    {
      plan: plan({
        blockers: ["authenticated-user-required"],
        canMigrate: false,
        user: { email: null, id: null },
      }),
      repository: repo,
    },
    "authenticated-user-required",
  );
  assert.deepEqual(repo.calls, []);
});

test("rejects invalid-session blockers before execution", async () => {
  const repo = repository();

  await assertMigrationError(
    {
      plan: plan({
        blockers: ["invalid-local-sessions"],
        canMigrate: false,
      }),
      repository: repo,
    },
    "invalid-local-sessions",
  );
  assert.deepEqual(repo.calls, []);
});

test("requires a preserved local backup before execution", async () => {
  const repo = repository();

  await assertMigrationError(
    {
      plan: plan({ backup: null }),
      repository: repo,
    },
    "backup-required",
  );
  assert.deepEqual(repo.calls, []);
});

test("preserves backup before mocked upload update and tombstone calls", async () => {
  const repo = repository();
  const execution = await executeGuestMigrationPlan({
    plan: plan({
      uploadCandidates: [
        {
          action: "upload",
          cloudSession: null,
          reason: "local-session-missing-in-cloud",
          session,
        },
        {
          action: "update",
          cloudSession: { ...session, updatedAt: "2026-06-21T11:00:00.000Z" },
          reason: "local-session-newer",
          session: { ...session, id: "fast-updated" },
        },
        {
          action: "tombstone",
          cloudSession: { ...tombstone, deletedAt: null },
          reason: "local-tombstone-newer",
          session: tombstone,
        },
      ],
    }),
    repository: repo,
  });

  assert.deepEqual(
    repo.calls.map(([type, input]) => [type, input.session?.id ?? null]),
    [
      ["backup", null],
      ["upload", session.id],
      ["update", "fast-updated"],
      ["tombstone", tombstone.id],
    ],
  );
  assert.deepEqual(execution.summary, {
    backupPreserved: true,
    executedCount: 3,
    tombstoneCount: 1,
    updateCount: 1,
    uploadCount: 1,
  });
  assert.deepEqual(execution.calls, [
    { action: "backup", sessionId: null },
    { action: "upload", sessionId: session.id },
    { action: "update", sessionId: "fast-updated" },
    { action: "tombstone", sessionId: tombstone.id },
  ]);
});

test("rejects unknown candidate actions before preserving backup", async () => {
  const repo = repository();

  await assertMigrationError(
    {
      plan: plan({
        uploadCandidates: [
          {
            action: "upload",
            cloudSession: null,
            reason: "local-session-missing-in-cloud",
            session,
          },
          {
            action: "merge",
            cloudSession: null,
            reason: "unsupported",
            session: { ...session, id: "bad-action" },
          },
        ],
      }),
      repository: repo,
    },
    "unknown-action",
  );
  assert.deepEqual(repo.calls, []);
});
