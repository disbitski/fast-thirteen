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

export function supabaseMigrationRepositoryReadiness({
  client = null,
  config = {},
  executeWrites = false,
} = {}) {
  if (!config?.isConfigured) {
    return {
      canWrite: false,
      message: "Supabase publishable config is missing; migration writes are disabled.",
      reason: "publishable-config-missing",
      status: "disabled",
    };
  }

  if (!client) {
    return {
      canWrite: false,
      message: "Supabase browser client is not ready; migration writes are disabled.",
      reason: "client-missing",
      status: "disabled",
    };
  }

  if (config.migrationWritesEnabled !== true) {
    return {
      canWrite: false,
      message: "Publishable Supabase config is present, but migration write support is disabled.",
      reason: "write-support-disabled",
      status: "disabled",
    };
  }

  if (executeWrites !== true) {
    return {
      canWrite: false,
      message: "Migration write support is configured, but execution is disabled in this build.",
      reason: "executor-disabled",
      status: "disabled",
    };
  }

  return {
    canWrite: true,
    message: "Supabase migration write support is explicitly enabled.",
    reason: null,
    status: "ready",
  };
}

export function createSupabaseMigrationRepository({
  client = null,
  config = {},
  executeWrites = false,
} = {}) {
  const readiness = supabaseMigrationRepositoryReadiness({ client, config, executeWrites });

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
      requireUserId(user);
      return {
        action: "confirmMigration",
        candidateCount: plan?.uploadCandidates?.length ?? 0,
        userId: user.id,
      };
    },
  };
}
