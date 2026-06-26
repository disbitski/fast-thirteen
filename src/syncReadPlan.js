import { validateMigrationSession } from "./migrationPlan.js";
import { normalizeData } from "./storage.js";
import { FAST_SESSIONS_TABLE, fastSessionRowToSession } from "./supabaseMigrationRepository.js";

function requireUserId(user) {
  return typeof user?.id === "string" && user.id.trim() ? user.id.trim() : null;
}

function updatedAtTime(session) {
  return new Date(session.updatedAt).getTime();
}

function compareSessions(left, right) {
  const updated = updatedAtTime(left) - updatedAtTime(right);
  if (updated !== 0) return updated;
  if (left.deletedAt && !right.deletedAt) return 1;
  if (!left.deletedAt && right.deletedAt) return -1;
  return 0;
}

function sortSessions(left, right) {
  const updated = updatedAtTime(left) - updatedAtTime(right);
  if (updated !== 0) return updated;
  return left.id.localeCompare(right.id);
}

function invalidRow(id, reason) {
  return {
    id: typeof id === "string" && id.trim() ? id : null,
    reason,
  };
}

export function normalizeRemoteFastSessionRows(rows, { user } = {}) {
  const userId = requireUserId(user);
  const invalidRows = [];
  const sessions = new Map();
  let duplicateCount = 0;

  if (!userId) {
    return {
      duplicateCount,
      invalidRows: [invalidRow(null, "authenticated-user-required")],
      sessions: [],
    };
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    if (row?.user_id !== userId) {
      invalidRows.push(invalidRow(row?.id, "user-id-mismatch"));
      continue;
    }

    try {
      const result = validateMigrationSession(fastSessionRowToSession(row));
      if (!result.ok) {
        invalidRows.push(result.invalid);
        continue;
      }

      const existing = sessions.get(result.session.id);
      if (existing) duplicateCount += 1;
      if (!existing || compareSessions(result.session, existing) > 0) {
        sessions.set(result.session.id, result.session);
      }
    } catch (error) {
      invalidRows.push(invalidRow(row?.id, error.code ?? "row-invalid"));
    }
  }

  return {
    duplicateCount,
    invalidRows,
    sessions: [...sessions.values()].sort(sortSessions),
  };
}

function mergeRemoteSessions(localSessions, remoteSessions) {
  const merged = new Map();
  const decisions = [];

  for (const localSession of localSessions) {
    merged.set(localSession.id, localSession);
  }

  for (const remoteSession of remoteSessions) {
    const localSession = merged.get(remoteSession.id);

    if (!localSession) {
      merged.set(remoteSession.id, remoteSession);
      decisions.push({
        id: remoteSession.id,
        reason: remoteSession.deletedAt ? "remote-tombstone-added" : "remote-session-added",
        source: "remote",
      });
      continue;
    }

    const comparison = compareSessions(remoteSession, localSession);
    if (comparison > 0) {
      merged.set(remoteSession.id, remoteSession);
      decisions.push({
        id: remoteSession.id,
        reason: remoteSession.deletedAt ? "remote-tombstone-newer" : "remote-newer",
        source: "remote",
      });
      continue;
    }

    decisions.push({
      id: localSession.id,
      reason: comparison === 0 ? "duplicate" : localSession.deletedAt ? "local-tombstone-newer" : "local-newer",
      source: "local",
    });
  }

  return {
    decisions,
    sessions: [...merged.values()].sort(sortSessions),
  };
}

function syncStatusResult({ applied, current, next }) {
  return {
    applied,
    current,
    next,
  };
}

export function createFailedSyncReadPlan({ error = "Cloud read failed.", localData, now = new Date() } = {}) {
  const data = normalizeData(localData);
  const timestamp = new Date(now).toISOString();

  return {
    canApply: false,
    data,
    message: error,
    status: "failed",
    summary: {
      localSessions: data.sessions.length,
      remoteSessions: 0,
    },
    syncStatus: syncStatusResult({
      applied: false,
      current: data.sync,
      next: {
        status: "error",
        lastSyncedAt: data.sync.lastSyncedAt,
        lastError: error,
        updatedAt: timestamp,
      },
    }),
  };
}

export function createCloudReadPlan({
  localData,
  now = new Date(),
  remoteRows = [],
  user,
} = {}) {
  const local = normalizeData(localData);
  const userId = requireUserId(user);

  if (!userId) {
    return createFailedSyncReadPlan({
      error: "A signed-in user is required before cloud history can be read.",
      localData: local,
      now,
    });
  }

  const remote = normalizeRemoteFastSessionRows(remoteRows, { user });
  if (remote.invalidRows.length > 0) {
    const failed = createFailedSyncReadPlan({
      error: "Remote fasting history contains rows that need review before import.",
      localData: local,
      now,
    });
    return {
      ...failed,
      invalidRows: remote.invalidRows,
    };
  }

  const merged = mergeRemoteSessions(local.sessions, remote.sessions);
  const timestamp = new Date(now).toISOString();
  const nextSync = {
    status: "synced",
    lastSyncedAt: timestamp,
    lastError: null,
    updatedAt: timestamp,
  };
  const data = normalizeData({
    ...local,
    sessions: merged.sessions,
    sync: nextSync,
  });

  return {
    canApply: true,
    data,
    decisions: merged.decisions,
    invalidRows: [],
    message: "Cloud history read plan is ready. Local data remains available offline.",
    status: "ready",
    summary: {
      duplicateCount: merged.decisions.filter((decision) => decision.reason === "duplicate").length + remote.duplicateCount,
      localKeptCount: merged.decisions.filter((decision) => decision.source === "local").length,
      localSessions: local.sessions.length,
      remoteAppliedCount: merged.decisions.filter((decision) => decision.source === "remote").length,
      remoteSessions: remote.sessions.length,
      tombstoneCount: merged.sessions.filter((session) => session.deletedAt).length,
    },
    syncStatus: syncStatusResult({
      applied: true,
      current: local.sync,
      next: nextSync,
    }),
  };
}

export function syncReadReadiness({ authState = null, clientStatus = "not-ready", config = {} } = {}) {
  if (!config?.isConfigured) {
    return {
      canRead: false,
      message: "Supabase publishable config is missing; cloud reads are disabled.",
      reason: "publishable-config-missing",
      status: "disabled",
    };
  }

  if (clientStatus !== "ready") {
    return {
      canRead: false,
      message: "Supabase browser client is not ready; cloud reads are disabled.",
      reason: "client-not-ready",
      status: "disabled",
    };
  }

  if (authState?.status !== "authenticated" || !authState.user?.id) {
    return {
      canRead: false,
      message: "Sign in before cloud fasting history can be read.",
      reason: "authenticated-user-required",
      status: "disabled",
    };
  }

  return {
    canRead: true,
    message: "Cloud read planning is ready for the signed-in profile.",
    reason: null,
    status: "ready",
  };
}

export function createSupabaseSyncReadRepository({ client = null, readiness = {} } = {}) {
  return {
    readiness,

    async readFastSessions({ user } = {}) {
      if (!readiness.canRead) {
        throw new Error(readiness.message ?? "Cloud reads are disabled.");
      }

      const userId = requireUserId(user);
      if (!userId || typeof client?.from !== "function") {
        throw new Error("A signed-in user and Supabase table client are required.");
      }

      const result = await client
        .from(FAST_SESSIONS_TABLE)
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: true });

      if (result?.error) {
        throw new Error(result.error.message ?? "Could not read cloud fasting history.");
      }

      return Array.isArray(result?.data) ? result.data : [];
    },
  };
}
