import { validateMigrationSession } from "./migrationPlan.js";

export const FAST_SESSIONS_TABLE = "fast_sessions";
export const MIGRATION_REPOSITORY_METHODS = Object.freeze([
  "preserveBackup",
  "uploadSession",
  "updateSession",
  "tombstoneSession",
  "confirmMigration",
]);

export class SupabaseMigrationRepositoryError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SupabaseMigrationRepositoryError";
    this.code = code;
  }
}

function requireUserId(user) {
  if (typeof user?.id !== "string" || !user.id.trim()) {
    throw new SupabaseMigrationRepositoryError(
      "authenticated-user-required",
      "A signed-in Supabase user is required to map migration rows.",
    );
  }

  return user.id;
}

function toIso(value, field) {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new SupabaseMigrationRepositoryError("invalid-session-field", `${field} must be a valid date.`);
  }
  return date.toISOString();
}

function requireClientTable(client) {
  if (typeof client?.from !== "function") {
    throw new SupabaseMigrationRepositoryError(
      "client-missing",
      "Supabase migration repository requires a browser client with table access.",
    );
  }

  return client.from.bind(client);
}

function assertCanWrite(readiness) {
  if (!readiness.canWrite) {
    throw new SupabaseMigrationRepositoryError("migration-writes-disabled", readiness.message);
  }
}

async function executeSupabaseQuery(query, action) {
  const result = typeof query?.throwOnError === "function"
    ? await query.throwOnError()
    : await query;

  if (result?.error) {
    throw new SupabaseMigrationRepositoryError("supabase-write-failed", result.error.message ?? `${action} failed.`);
  }

  return result?.data ?? result ?? null;
}

export function sessionToFastSessionRow(session, user) {
  const userId = requireUserId(user);
  if (typeof session?.id !== "string" || !session.id.trim()) {
    throw new SupabaseMigrationRepositoryError("invalid-session-field", "session.id is required.");
  }

  return {
    user_id: userId,
    id: session.id,
    started_at: toIso(session.startedAt, "startedAt"),
    ended_at: toIso(session.endedAt, "endedAt"),
    target_hours: Number(session.targetHours),
    updated_at: toIso(session.updatedAt, "updatedAt"),
    deleted_at: toIso(session.deletedAt, "deletedAt"),
  };
}

export function fastSessionRowToSession(row) {
  if (!row || typeof row !== "object") {
    throw new SupabaseMigrationRepositoryError("invalid-row", "fast_sessions row is required.");
  }

  return {
    id: row.id,
    startedAt: toIso(row.started_at, "started_at"),
    endedAt: toIso(row.ended_at, "ended_at"),
    targetHours: Number(row.target_hours),
    updatedAt: toIso(row.updated_at, "updated_at"),
    deletedAt: toIso(row.deleted_at, "deleted_at"),
  };
}

function sessionComparisonFields(session) {
  return {
    deletedAt: session.deletedAt ?? null,
    endedAt: session.endedAt ?? null,
    id: session.id,
    startedAt: session.startedAt,
    targetHours: Number(session.targetHours),
    updatedAt: session.updatedAt,
  };
}

function changedFields(expected, actual) {
  const expectedFields = sessionComparisonFields(expected);
  const actualFields = sessionComparisonFields(actual);
  return Object.keys(expectedFields).filter((field) => expectedFields[field] !== actualFields[field]);
}

function latestByUpdatedAtThenTombstone(left, right) {
  const leftUpdated = new Date(left.updatedAt).getTime();
  const rightUpdated = new Date(right.updatedAt).getTime();
  if (leftUpdated !== rightUpdated) return leftUpdated - rightUpdated;
  if (left.deletedAt && !right.deletedAt) return 1;
  if (!left.deletedAt && right.deletedAt) return -1;
  return 0;
}

export function normalizeMigrationReadBackRows(rows, { user } = {}) {
  const userId = requireUserId(user);
  const invalidRows = [];
  const sessions = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.user_id !== userId) {
      invalidRows.push({
        id: typeof row?.id === "string" ? row.id : null,
        reason: "user-id-mismatch",
      });
      continue;
    }

    try {
      const result = validateMigrationSession(fastSessionRowToSession(row));
      if (!result.ok) {
        invalidRows.push(result.invalid);
        continue;
      }

      const existing = sessions.get(result.session.id);
      if (!existing || latestByUpdatedAtThenTombstone(result.session, existing) > 0) {
        sessions.set(result.session.id, result.session);
      }
    } catch (error) {
      invalidRows.push({
        id: typeof row?.id === "string" ? row.id : null,
        reason: error.code ?? "row-invalid",
      });
    }
  }

  return {
    invalidRows,
    sessions,
  };
}

function blocker(code, sessionId, detail = {}) {
  return {
    code,
    sessionId,
    ...detail,
  };
}

export function createMigrationConfirmationResult({ plan, rows = [], user } = {}) {
  const readBack = normalizeMigrationReadBackRows(rows, { user });
  const blockers = readBack.invalidRows.map((row) => blocker("invalid-read-back-row", row.id, { reason: row.reason }));
  const candidates = plan?.uploadCandidates ?? [];

  for (const candidate of candidates) {
    const expected = candidate.session;
    const actual = readBack.sessions.get(expected.id);

    if (!actual) {
      blockers.push(blocker("missing-read-back-row", expected.id, { action: candidate.action }));
      continue;
    }

    if (candidate.action === "tombstone" && !actual.deletedAt) {
      blockers.push(blocker("tombstone-not-confirmed", expected.id));
      continue;
    }

    const fields = changedFields(expected, actual);
    if (fields.length > 0) {
      blockers.push(blocker("changed-read-back-row", expected.id, { fields }));
    }
  }

  return {
    blockers,
    canMarkSynced: blockers.length === 0,
    confirmedCount: blockers.length === 0 ? candidates.length : 0,
    expectedCount: candidates.length,
    readBackCount: readBack.sessions.size,
    status: blockers.length === 0 ? "confirmed" : "blocked",
  };
}

export function supabaseMigrationRepositoryReadiness({
  client = null,
  config = {},
  executeConfirmations = false,
  executeFinalization = false,
  executeWrites = false,
} = {}) {
  if (!config?.isConfigured) {
    return {
      canConfirm: false,
      canFinalize: false,
      canWrite: false,
      message: "Supabase publishable config is missing; migration writes are disabled.",
      reason: "publishable-config-missing",
      status: "disabled",
    };
  }

  if (!client) {
    return {
      canConfirm: false,
      canFinalize: false,
      canWrite: false,
      message: "Supabase browser client is not ready; migration writes are disabled.",
      reason: "client-missing",
      status: "disabled",
    };
  }

  if (config.migrationWritesEnabled !== true) {
    return {
      canConfirm: false,
      canFinalize: false,
      canWrite: false,
      message: "Publishable Supabase config is present, but migration write support is disabled.",
      reason: "write-support-disabled",
      status: "disabled",
    };
  }

  if (executeWrites !== true) {
    return {
      canConfirm: false,
      canFinalize: false,
      canWrite: false,
      message: "Migration write support is configured, but execution is disabled in this build.",
      reason: "executor-disabled",
      status: "disabled",
    };
  }

  if (config.migrationConfirmationsEnabled !== true) {
    return {
      canConfirm: false,
      canFinalize: false,
      canWrite: false,
      message: "Migration writes require explicit read-back confirmation support before execution.",
      reason: "confirmation-support-disabled",
      status: "disabled",
    };
  }

  if (executeConfirmations !== true) {
    return {
      canConfirm: false,
      canFinalize: false,
      canWrite: false,
      message: "Migration confirmation support is configured, but confirmation is disabled in this build.",
      reason: "confirmation-disabled",
      status: "disabled",
    };
  }

  if (config.migrationFinalizationEnabled !== true) {
    return {
      canConfirm: true,
      canFinalize: false,
      canWrite: false,
      message: "Migration confirmation requires explicit local finalization support before execution.",
      reason: "finalization-support-disabled",
      status: "disabled",
    };
  }

  if (executeFinalization !== true) {
    return {
      canConfirm: true,
      canFinalize: false,
      canWrite: false,
      message: "Migration finalization support is configured, but local sync updates are disabled in this build.",
      reason: "finalization-disabled",
      status: "disabled",
    };
  }

  return {
    canConfirm: true,
    canFinalize: true,
    canWrite: true,
    message: "Supabase migration write, confirmation, and finalization support are explicitly enabled.",
    reason: null,
    status: "ready",
  };
}

export function createSupabaseMigrationRepository({
  client = null,
  config = {},
  executeConfirmations = false,
  executeFinalization = false,
  executeWrites = false,
} = {}) {
  const readiness = supabaseMigrationRepositoryReadiness({
    client,
    config,
    executeConfirmations,
    executeFinalization,
    executeWrites,
  });

  return {
    methods: MIGRATION_REPOSITORY_METHODS,
    readiness,

    async preserveBackup({ backup, backupCreatedAt, user } = {}) {
      assertCanWrite(readiness);
      requireUserId(user);
      if (!backup || !backupCreatedAt) {
        throw new SupabaseMigrationRepositoryError("backup-required", "A local backup is required before migration.");
      }

      return {
        action: "preserveBackup",
        backupCreatedAt,
        storage: "local-backup-required",
      };
    },

    async uploadSession({ session, user } = {}) {
      assertCanWrite(readiness);
      const from = requireClientTable(client);
      const row = sessionToFastSessionRow(session, user);
      return executeSupabaseQuery(
        from(FAST_SESSIONS_TABLE).upsert(row, { onConflict: "user_id,id" }),
        "uploadSession",
      );
    },

    async updateSession({ session, user } = {}) {
      assertCanWrite(readiness);
      const from = requireClientTable(client);
      const row = sessionToFastSessionRow(session, user);
      return executeSupabaseQuery(
        from(FAST_SESSIONS_TABLE).upsert(row, { onConflict: "user_id,id" }),
        "updateSession",
      );
    },

    async tombstoneSession({ session, user } = {}) {
      assertCanWrite(readiness);
      const from = requireClientTable(client);
      const row = sessionToFastSessionRow(session, user);
      return executeSupabaseQuery(
        from(FAST_SESSIONS_TABLE).upsert(row, { onConflict: "user_id,id" }),
        "tombstoneSession",
      );
    },

    async confirmMigration({ plan, user } = {}) {
      assertCanWrite(readiness);
      const userId = requireUserId(user);
      const from = requireClientTable(client);
      const rows = await executeSupabaseQuery(
        from(FAST_SESSIONS_TABLE).select("*").eq("user_id", userId),
        "confirmMigration",
      );
      return createMigrationConfirmationResult({ plan, rows, user });
    },
  };
}
