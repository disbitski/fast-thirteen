import test from "node:test";
import assert from "node:assert/strict";
import { createGuestMigrationPlan, validateMigrationSession } from "../src/migrationPlan.js";
import { emptyData, parseBackup } from "../src/storage.js";

const user = {
  email: "dave@example.com",
  id: "user-123",
};

const completed = {
  id: "fast-2026-06-18",
  startedAt: "2026-06-18T23:00:00.000Z",
  endedAt: "2026-06-19T12:15:00.000Z",
  targetHours: 13,
  updatedAt: "2026-06-19T12:15:00.000Z",
  deletedAt: null,
};

const active = {
  ...completed,
  id: "fast-active",
  endedAt: null,
  updatedAt: "2026-06-20T01:00:00.000Z",
};

const tombstone = {
  ...completed,
  id: "fast-deleted",
  deletedAt: "2026-06-20T13:00:00.000Z",
  updatedAt: "2026-06-20T13:00:00.000Z",
};

function signedInPlan(overrides = {}) {
  return createGuestMigrationPlan({
    authState: {
      status: "authenticated",
      user,
    },
    localData: {
      ...emptyData(),
      sessions: [completed],
    },
    now: new Date("2026-06-20T14:00:00.000Z"),
    ...overrides,
  });
}

test("validates completed migration sessions before planning upload", () => {
  assert.deepEqual(validateMigrationSession(completed), {
    ok: true,
    session: completed,
  });
  assert.deepEqual(validateMigrationSession({ ...completed, endedAt: completed.startedAt }), {
    ok: false,
    invalid: {
      id: completed.id,
      reason: "duration-invalid",
    },
  });
});

test("plans deterministic uploads and preserves a normalized local backup", () => {
  const newer = {
    ...completed,
    id: "fast-2026-06-19",
    updatedAt: "2026-06-20T12:00:00.000Z",
  };
  const older = {
    ...completed,
    id: "fast-2026-06-17",
    updatedAt: "2026-06-18T12:00:00.000Z",
  };
  const plan = signedInPlan({
    localData: {
      ...emptyData(),
      sessions: [newer, older],
    },
  });

  assert.equal(plan.canMigrate, true);
  assert.equal(plan.status, "ready");
  assert.equal(plan.backupCreatedAt, "2026-06-20T14:00:00.000Z");
  assert.deepEqual(parseBackup(plan.backup).sessions, [newer, older]);
  assert.deepEqual(
    plan.uploadCandidates.map((candidate) => [candidate.action, candidate.session.id]),
    [
      ["upload", "fast-2026-06-17"],
      ["upload", "fast-2026-06-19"],
    ],
  );
  assert.deepEqual(plan.summary, {
    activeSkippedCount: 0,
    cloudSessions: 0,
    duplicateCount: 0,
    invalidCount: 0,
    localSessions: 2,
    skipCount: 0,
    tombstoneCount: 0,
    uploadCount: 2,
  });
});

test("avoids uploading duplicate sessions already present in cloud history", () => {
  const plan = signedInPlan({
    cloudSessions: [completed],
  });

  assert.equal(plan.status, "nothing-to-sync");
  assert.deepEqual(plan.uploadCandidates, []);
  assert.deepEqual(plan.skippedSessions, [
    {
      id: completed.id,
      reason: "duplicate",
    },
  ]);
  assert.equal(plan.summary.duplicateCount, 1);
});

test("plans local updates when local history is newer than cloud history", () => {
  const olderCloudSession = {
    ...completed,
    endedAt: "2026-06-19T11:45:00.000Z",
    updatedAt: "2026-06-19T11:45:00.000Z",
  };
  const plan = signedInPlan({
    cloudSessions: [olderCloudSession],
  });

  assert.equal(plan.uploadCandidates.length, 1);
  assert.equal(plan.uploadCandidates[0].action, "update");
  assert.equal(plan.uploadCandidates[0].reason, "local-session-newer");
  assert.deepEqual(plan.uploadCandidates[0].cloudSession, olderCloudSession);
});

test("plans tombstoned deletions including deterministic updated-at ties", () => {
  const cloudCompleted = {
    ...tombstone,
    deletedAt: null,
  };
  const plan = signedInPlan({
    cloudSessions: [cloudCompleted],
    localData: {
      ...emptyData(),
      sessions: [tombstone],
    },
  });

  assert.equal(plan.uploadCandidates.length, 1);
  assert.equal(plan.uploadCandidates[0].action, "tombstone");
  assert.equal(plan.uploadCandidates[0].reason, "local-tombstone-newer");
  assert.equal(plan.summary.tombstoneCount, 1);
});

test("rejects invalid local sessions before allowing migration", () => {
  const invalid = {
    ...completed,
    id: "broken-fast",
    startedAt: "not-a-date",
  };
  const plan = signedInPlan({
    localData: {
      ...emptyData(),
      sessions: [completed, invalid],
    },
  });

  assert.equal(plan.canMigrate, false);
  assert.equal(plan.status, "blocked");
  assert.deepEqual(plan.blockers, ["invalid-local-sessions"]);
  assert.deepEqual(plan.invalidSessions, [
    {
      id: "broken-fast",
      reason: "started-at-invalid",
    },
  ]);
  assert.deepEqual(
    plan.uploadCandidates.map((candidate) => candidate.session.id),
    [completed.id],
  );
});

test("skips active sessions until the fast is complete", () => {
  const plan = signedInPlan({
    localData: {
      ...emptyData(),
      sessions: [active],
    },
  });

  assert.equal(plan.status, "nothing-to-sync");
  assert.deepEqual(plan.uploadCandidates, []);
  assert.deepEqual(plan.skippedSessions, [
    {
      id: active.id,
      reason: "active-session",
    },
  ]);
  assert.equal(plan.summary.activeSkippedCount, 1);
});

test("requires an authenticated user before migration can run", () => {
  const plan = createGuestMigrationPlan({
    authState: {
      status: "guest",
      user: null,
    },
    localData: {
      ...emptyData(),
      sessions: [completed],
    },
  });

  assert.equal(plan.canMigrate, false);
  assert.equal(plan.status, "blocked");
  assert.deepEqual(plan.blockers, ["authenticated-user-required"]);
  assert.deepEqual(plan.user, {
    email: null,
    id: null,
  });
});

test("does not treat a stale local profile as current authentication", () => {
  const plan = createGuestMigrationPlan({
    authState: {
      status: "disabled",
      user: null,
    },
    localData: {
      ...emptyData(),
      profile: {
        ...emptyData().profile,
        mode: "authenticated",
        userId: "stale-user",
        email: "stale@example.com",
        displayName: "Stale user",
        provider: "google",
      },
      sessions: [completed],
    },
  });

  assert.equal(plan.canMigrate, false);
  assert.deepEqual(plan.blockers, ["authenticated-user-required"]);
  assert.deepEqual(plan.user, {
    email: null,
    id: null,
  });
});
