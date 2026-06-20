import { normalizeData, serializeBackup } from "./storage.js";

const BLOCKED = "blocked";
const NOTHING_TO_SYNC = "nothing-to-sync";
const READY = "ready";

function isValidDate(value) {
  if (value == null) return false;
  return !Number.isNaN(new Date(value).getTime());
}

function toTime(value) {
  return new Date(value).getTime();
}

function compareByUpdatedAtThenTombstone(left, right) {
  const leftUpdated = toTime(left.updatedAt);
  const rightUpdated = toTime(right.updatedAt);
  if (leftUpdated !== rightUpdated) return leftUpdated - rightUpdated;
  if (left.deletedAt && !right.deletedAt) return 1;
  if (!left.deletedAt && right.deletedAt) return -1;
  return 0;
}

function sortSessions(left, right) {
  const updated = toTime(left.updatedAt) - toTime(right.updatedAt);
  if (updated !== 0) return updated;
  return left.id.localeCompare(right.id);
}

function invalidSession(id, reason) {
  return {
    id: typeof id === "string" && id.trim() ? id : null,
    reason,
  };
}

export function validateMigrationSession(session) {
  if (!session || typeof session !== "object") {
    return { ok: false, invalid: invalidSession(null, "session-missing") };
  }

  if (typeof session.id !== "string" || !session.id.trim()) {
    return { ok: false, invalid: invalidSession(session.id, "session-id-missing") };
  }

  if (!isValidDate(session.startedAt)) {
    return { ok: false, invalid: invalidSession(session.id, "started-at-invalid") };
  }

  if (session.endedAt != null && !isValidDate(session.endedAt)) {
    return { ok: false, invalid: invalidSession(session.id, "ended-at-invalid") };
  }

  if (session.deletedAt != null && !isValidDate(session.deletedAt)) {
    return { ok: false, invalid: invalidSession(session.id, "deleted-at-invalid") };
  }

  if (!isValidDate(session.updatedAt ?? session.endedAt ?? session.startedAt)) {
    return { ok: false, invalid: invalidSession(session.id, "updated-at-invalid") };
  }

  if (session.endedAt != null && toTime(session.endedAt) <= toTime(session.startedAt)) {
    return { ok: false, invalid: invalidSession(session.id, "duration-invalid") };
  }

  const [normalized] = normalizeData({ sessions: [session] }).sessions;
  if (!normalized) {
    return { ok: false, invalid: invalidSession(session.id, "session-invalid") };
  }

  return { ok: true, session: normalized };
}

function normalizeCloudSessions(cloudSessions) {
  const sessions = new Map();
  const invalid = [];

  for (const cloudSession of Array.isArray(cloudSessions) ? cloudSessions : []) {
    const result = validateMigrationSession(cloudSession);
    if (!result.ok) {
      invalid.push(result.invalid);
      continue;
    }

    const existing = sessions.get(result.session.id);
    if (!existing || compareByUpdatedAtThenTombstone(result.session, existing) > 0) {
      sessions.set(result.session.id, result.session);
    }
  }

  return { invalid, sessions };
}

function migrationUserId({ authState, localData, profile }) {
  return (
    authState?.user?.id ??
    profile?.userId ??
    (localData?.profile?.mode === "authenticated" ? localData.profile.userId : null) ??
    null
  );
}

function migrationUserEmail({ authState, localData, profile }) {
  return (
    authState?.user?.email ??
    profile?.email ??
    (localData?.profile?.mode === "authenticated" ? localData.profile.email : null) ??
    null
  );
}

function planCandidate(localSession, cloudSession) {
  if (!cloudSession) {
    return {
      action: localSession.deletedAt ? "tombstone" : "upload",
      session: localSession,
      reason: localSession.deletedAt ? "local-tombstone-missing-in-cloud" : "local-session-missing-in-cloud",
    };
  }

  const comparison = compareByUpdatedAtThenTombstone(localSession, cloudSession);
  if (comparison <= 0) {
    return {
      reason: comparison === 0 ? "duplicate" : "cloud-newer",
      session: localSession,
      skip: true,
    };
  }

  return {
    action: localSession.deletedAt ? "tombstone" : "update",
    cloudSession,
    session: localSession,
    reason: localSession.deletedAt ? "local-tombstone-newer" : "local-session-newer",
  };
}

export function createGuestMigrationPlan({
  authState = null,
  cloudSessions = [],
  localData = {},
  now = new Date(),
  profile = null,
} = {}) {
  const normalizedLocalData = normalizeData(localData);
  const rawLocalSessions = Array.isArray(localData?.sessions) ? localData.sessions : [];
  const backup = serializeBackup(localData);
  const backupCreatedAt = new Date(now).toISOString();
  const userId = migrationUserId({ authState, localData: normalizedLocalData, profile });
  const userEmail = migrationUserEmail({ authState, localData: normalizedLocalData, profile });
  const cloud = normalizeCloudSessions(cloudSessions);
  const invalidSessions = [];
  const skippedSessions = [];
  const uploadCandidates = [];

  for (const rawSession of rawLocalSessions) {
    const result = validateMigrationSession(rawSession);
    if (!result.ok) {
      invalidSessions.push(result.invalid);
      continue;
    }

    const localSession = result.session;
    if (!localSession.deletedAt && !localSession.endedAt) {
      skippedSessions.push({
        id: localSession.id,
        reason: "active-session",
      });
      continue;
    }

    const candidate = planCandidate(localSession, cloud.sessions.get(localSession.id));
    if (candidate.skip) {
      skippedSessions.push({
        id: localSession.id,
        reason: candidate.reason,
      });
      continue;
    }

    uploadCandidates.push({
      action: candidate.action,
      cloudSession: candidate.cloudSession ?? null,
      reason: candidate.reason,
      session: candidate.session,
    });
  }

  uploadCandidates.sort((left, right) => sortSessions(left.session, right.session));
  skippedSessions.sort((left, right) => left.id.localeCompare(right.id));
  invalidSessions.sort((left, right) => (left.id ?? "").localeCompare(right.id ?? ""));

  const blockers = [];
  if (!userId) blockers.push("authenticated-user-required");
  if (invalidSessions.length > 0) blockers.push("invalid-local-sessions");

  const status = blockers.length > 0
    ? BLOCKED
    : uploadCandidates.length > 0
      ? READY
      : NOTHING_TO_SYNC;

  return {
    backup,
    backupCreatedAt,
    blockers,
    canMigrate: blockers.length === 0,
    cloudInvalidSessions: cloud.invalid,
    skippedSessions,
    status,
    summary: {
      activeSkippedCount: skippedSessions.filter((session) => session.reason === "active-session").length,
      cloudSessions: cloud.sessions.size,
      duplicateCount: skippedSessions.filter((session) => session.reason === "duplicate").length,
      invalidCount: invalidSessions.length,
      localSessions: rawLocalSessions.length,
      skipCount: skippedSessions.length,
      tombstoneCount: uploadCandidates.filter((candidate) => candidate.action === "tombstone").length,
      uploadCount: uploadCandidates.length,
    },
    uploadCandidates,
    user: {
      email: userEmail,
      id: userId,
    },
    invalidSessions,
    warnings: cloud.invalid.length > 0 ? ["invalid-cloud-sessions-ignored"] : [],
  };
}
