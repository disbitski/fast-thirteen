import { validateMigrationSession } from "./migrationPlan.js";
import { normalizeData } from "./storage.js";
import { fastSessionRowToSession } from "./supabaseMigrationRepository.js";

function requireUserId(user) {
  return typeof user?.id === "string" && user.id.trim() ? user.id.trim() : null;
}

function toTime(value) {
  return new Date(value).getTime();
}

function compareSessions(left, right) {
  const updated = toTime(left.updatedAt) - toTime(right.updatedAt);
  if (updated !== 0) return updated;
  if (left.deletedAt && !right.deletedAt) return 1;
  if (!left.deletedAt && right.deletedAt) return -1;
  return 0;
}

function sortBySession(left, right) {
  const updated = toTime(left.session.updatedAt) - toTime(right.session.updatedAt);
  if (updated !== 0) return updated;
  return left.session.id.localeCompare(right.session.id);
}

function invalidSession(id, reason) {
  return {
    id: typeof id === "string" && id.trim() ? id : null,
    reason,
  };
}

function normalizeRemoteSessions({ remoteRows = [], remoteSessions = [], user } = {}) {
  const userId = requireUserId(user);
  const invalidRemoteSessions = [];
  const sessions = new Map();
  let duplicateCount = 0;

  const addSession = (session, id = session?.id) => {
    const result = validateMigrationSession(session);
    if (!result.ok) {
      invalidRemoteSessions.push(result.invalid);
      return;
    }

    const existing = sessions.get(result.session.id);
    if (existing) duplicateCount += 1;
    if (!existing || compareSessions(result.session, existing) > 0) {
      sessions.set(result.session.id, result.session);
    }
  };

  for (const row of Array.isArray(remoteRows) ? remoteRows : []) {
    if (!userId || row?.user_id !== userId) {
      invalidRemoteSessions.push(invalidSession(row?.id, "user-id-mismatch"));
      continue;
    }

    try {
      addSession(fastSessionRowToSession(row), row?.id);
    } catch (error) {
      invalidRemoteSessions.push(invalidSession(row?.id, error.code ?? "row-invalid"));
    }
  }

  for (const session of Array.isArray(remoteSessions) ? remoteSessions : []) {
    addSession(session);
  }

  return {
    duplicateCount,
    invalidRemoteSessions,
    sessions,
  };
}

export function syncPushReadiness({
  authState = null,
  clientStatus = "not-ready",
  config = {},
  executeWrites = false,
} = {}) {
  if (!config?.isConfigured) {
    return {
      canPlan: false,
      canWrite: false,
      localTrackingAvailable: true,
      message: "Supabase publishable config is missing; push planning is disabled. Local tracking still works.",
      reason: "publishable-config-missing",
      status: "disabled",
    };
  }

  if (clientStatus !== "ready") {
    return {
      canPlan: false,
      canWrite: false,
      localTrackingAvailable: true,
      message: "Supabase browser client is not ready; push planning is disabled. Local tracking still works.",
      reason: "client-not-ready",
      status: "disabled",
    };
  }

  if (authState?.status !== "authenticated" || !authState.user?.id) {
    return {
      canPlan: false,
      canWrite: false,
      localTrackingAvailable: true,
      message: "Sign in before cloud push planning can run. Local tracking still works.",
      reason: "authenticated-user-required",
      status: "disabled",
    };
  }

  if (config.syncWritesEnabled !== true || executeWrites !== true) {
    return {
      canPlan: true,
      canWrite: false,
      localTrackingAvailable: true,
      message: "Cloud push planning is available, but Supabase writes are disabled in this build.",
      reason: "write-support-disabled",
      status: "preview-only",
    };
  }

  return {
    canPlan: true,
    canWrite: true,
    localTrackingAvailable: true,
    message: "Cloud push planning and explicit write execution are enabled.",
    reason: null,
    status: "ready",
  };
}

function candidateFor(localSession, remoteSession) {
  if (!remoteSession) {
    return {
      action: localSession.deletedAt ? "tombstone" : "upload",
      reason: localSession.deletedAt ? "local-tombstone-missing-in-cloud" : "local-session-missing-in-cloud",
      session: localSession,
      remoteSession: null,
    };
  }

  const comparison = compareSessions(localSession, remoteSession);
  if (comparison <= 0) {
    return {
      reason: comparison === 0 ? "duplicate" : remoteSession.deletedAt ? "remote-tombstone-newer" : "remote-newer",
      remoteSession,
      session: localSession,
      skip: true,
    };
  }

  return {
    action: localSession.deletedAt ? "tombstone" : "update",
    reason: localSession.deletedAt ? "local-tombstone-newer" : "local-session-newer",
    remoteSession,
    session: localSession,
  };
}

export function createCloudPushPlan({
  localData,
  now = new Date(),
  readiness = syncPushReadiness(),
  remoteRows = [],
  remoteSessions = [],
  user,
} = {}) {
  const local = normalizeData(localData);
  const rawLocalSessions = Array.isArray(localData?.sessions) ? localData.sessions : [];
  const timestamp = new Date(now).toISOString();

  if (!readiness?.canPlan) {
    return {
      candidates: [],
      invalidSessions: [],
      invalidRemoteSessions: [],
      message: readiness?.message ?? "Cloud push planning is disabled.",
      readiness,
      skippedSessions: [],
      status: "disabled",
      summary: {
        duplicateCount: 0,
        invalidCount: 0,
        localSessions: local.sessions.length,
        remoteSessions: 0,
        skipCount: 0,
        tombstoneCount: 0,
        updateCount: 0,
        uploadCount: 0,
      },
      timestamp,
    };
  }

  const remote = normalizeRemoteSessions({ remoteRows, remoteSessions, user });
  const candidates = [];
  const invalidSessions = [];
  const skippedSessions = [];

  for (const rawSession of rawLocalSessions) {
    const result = validateMigrationSession(rawSession);
    if (!result.ok) {
      invalidSessions.push(result.invalid);
      continue;
    }

    const localSession = result.session;
    if (!localSession.deletedAt && !localSession.endedAt) {
      skippedSessions.push({ id: localSession.id, reason: "active-session" });
      continue;
    }

    const candidate = candidateFor(localSession, remote.sessions.get(localSession.id));
    if (candidate.skip) {
      skippedSessions.push({
        id: localSession.id,
        reason: candidate.reason,
      });
      continue;
    }

    candidates.push(candidate);
  }

  candidates.sort(sortBySession);
  invalidSessions.sort((left, right) => (left.id ?? "").localeCompare(right.id ?? ""));
  skippedSessions.sort((left, right) => left.id.localeCompare(right.id));

  const blockers = [];
  if (invalidSessions.length > 0) blockers.push("invalid-local-sessions");
  if (remote.invalidRemoteSessions.length > 0) blockers.push("invalid-remote-sessions");

  const status = blockers.length > 0
    ? "blocked"
    : candidates.length > 0
      ? "ready"
      : "nothing-to-push";

  return {
    blockers,
    candidates,
    invalidSessions,
    invalidRemoteSessions: remote.invalidRemoteSessions,
    message: status === "ready"
      ? "Cloud push plan is ready for preview. No Supabase writes will run from this scaffold."
      : status === "blocked"
        ? "Cloud push planning found records that need review before any future write."
        : "No local changes need a cloud push right now.",
    readiness,
    skippedSessions,
    status,
    summary: {
      duplicateCount: skippedSessions.filter((session) => session.reason === "duplicate").length + remote.duplicateCount,
      invalidCount: invalidSessions.length + remote.invalidRemoteSessions.length,
      localSessions: rawLocalSessions.length,
      remoteSessions: remote.sessions.size,
      skipCount: skippedSessions.length,
      tombstoneCount: candidates.filter((candidate) => candidate.action === "tombstone").length,
      updateCount: candidates.filter((candidate) => candidate.action === "update").length,
      uploadCount: candidates.filter((candidate) => candidate.action === "upload").length,
    },
    timestamp,
  };
}

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function countVerb(count, singular, plural) {
  return count === 1 ? singular : plural;
}

export function createCloudPushPreviewModel(plan) {
  const summary = plan?.summary ?? {};
  const readiness = plan?.readiness ?? {};

  const stats = [
    { label: "Readiness", value: readiness.canPlan ? "Ready" : "Disabled", tone: readiness.canPlan ? "good" : "warn" },
    { label: "Upload", value: String(summary.uploadCount ?? 0), tone: "neutral" },
    { label: "Update", value: String(summary.updateCount ?? 0), tone: "neutral" },
    { label: "Delete", value: String(summary.tombstoneCount ?? 0), tone: "neutral" },
    { label: "Skipped", value: String(summary.skipCount ?? 0), tone: "neutral" },
    { label: "Invalid", value: String(summary.invalidCount ?? 0), tone: (summary.invalidCount ?? 0) > 0 ? "warn" : "neutral" },
  ];

  if (!readiness.canPlan) {
    return {
      action: {
        disabled: true,
        label: "Cloud push disabled",
        message: "Local tracking still works without sign-in or cloud write support.",
      },
      details: [
        readiness.message ?? "Cloud push planning is disabled.",
        "No local fasting data is changed by this preview.",
      ],
      stats,
      status: "disabled",
      title: "Cloud push preview disabled",
      message: "Push planning needs a signed-in profile and publishable Supabase config.",
    };
  }

  if (plan?.status === "blocked") {
    return {
      action: {
        disabled: true,
        label: "Resolve push blockers",
        message: "Cloud writes remain disabled until invalid records are reviewed.",
      },
      details: [
        `${countLabel(summary.invalidCount ?? 0, "invalid record")} ${countVerb(summary.invalidCount ?? 0, "needs", "need")} review before push planning can continue.`,
        "No Supabase writes happen from this scaffold.",
      ],
      stats,
      status: "blocked",
      title: "Cloud push needs review",
      message: "The local push planner found records that need cleanup before any future write.",
    };
  }

  if (plan?.status === "nothing-to-push") {
    return {
      action: {
        disabled: true,
        label: "Nothing to push",
        message: "Cloud writes remain disabled in this scaffold.",
      },
      details: [
        `${countLabel(summary.duplicateCount ?? 0, "duplicate")} already ${countVerb(summary.duplicateCount ?? 0, "matches", "match")} cloud history.`,
        `${countLabel(summary.skipCount ?? 0, "local record")} ${countVerb(summary.skipCount ?? 0, "is", "are")} intentionally skipped.`,
      ],
      stats,
      status: "empty",
      title: "No cloud push needed",
      message: "Local history has no validated changes waiting for a cloud push.",
    };
  }

  return {
    action: {
      disabled: true,
      label: readiness.canWrite ? "Push disabled in preview" : "Push preview only",
      message: "Supabase writes are still disabled; this only shows what would push later.",
    },
    details: [
      `${countLabel(summary.uploadCount ?? 0, "new fast")} would upload.`,
      `${countLabel(summary.updateCount ?? 0, "local edit")} would update cloud history.`,
      `${countLabel(summary.tombstoneCount ?? 0, "deleted fast")} would stay deleted in cloud history.`,
      `${countLabel(summary.duplicateCount ?? 0, "duplicate")} would be skipped by stable session id.`,
    ],
    stats,
    status: "ready",
    title: "Cloud push preview ready",
    message: "This local-safe plan shows what would push after local actions. It does not write to Supabase.",
  };
}
