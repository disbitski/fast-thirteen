import { DEFAULT_TARGET_HOURS, normalizeTargetHours } from "./fasting.js";

export const DATA_VERSION = 3;
export const STORAGE_KEY = "fast-thirteen-data";
export const LEGACY_SESSIONS_KEY = "fast-thirteen-sessions";
export const SYNC_STATUSES = ["local", "syncing", "synced", "error"];
export const PROFILE_MODES = ["guest", "authenticated"];

export function emptyData() {
  const timestamp = new Date(0).toISOString();

  return {
    version: DATA_VERSION,
    settings: { targetHours: DEFAULT_TARGET_HOURS },
    profile: {
      mode: "guest",
      guestId: "local-guest",
      userId: null,
      email: null,
      displayName: "Guest",
      provider: null,
      updatedAt: timestamp,
    },
    sync: {
      status: "local",
      lastSyncedAt: null,
      lastError: null,
      updatedAt: timestamp,
    },
    sessions: [],
  };
}

function normalizeIsoDate(value, fallback) {
  const date = new Date(value ?? fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function nullableIsoDate(value) {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeString(value, fallback = null) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function normalizeProfile(profile) {
  const fallback = emptyData().profile;
  const mode = PROFILE_MODES.includes(profile?.mode) ? profile.mode : fallback.mode;

  return {
    mode,
    guestId: normalizeString(profile?.guestId, fallback.guestId),
    userId: mode === "authenticated" ? normalizeString(profile?.userId) : null,
    email: mode === "authenticated" ? normalizeString(profile?.email) : null,
    displayName: normalizeString(profile?.displayName, mode === "authenticated" ? "Signed in" : "Guest"),
    provider: mode === "authenticated" ? normalizeString(profile?.provider) : null,
    updatedAt: normalizeIsoDate(profile?.updatedAt, fallback.updatedAt),
  };
}

export function normalizeSync(sync) {
  const fallback = emptyData().sync;
  const status = SYNC_STATUSES.includes(sync?.status) ? sync.status : fallback.status;

  return {
    status,
    lastSyncedAt: nullableIsoDate(sync?.lastSyncedAt),
    lastError: status === "error" ? normalizeString(sync?.lastError, "Sync failed") : null,
    updatedAt: normalizeIsoDate(sync?.updatedAt, fallback.updatedAt),
  };
}

function normalizeSession(session) {
  const endedAt = session?.endedAt == null ? null : new Date(session.endedAt);
  const deletedAt = session?.deletedAt == null ? null : new Date(session.deletedAt);
  const updatedAt = new Date(session?.updatedAt ?? session?.endedAt ?? session?.startedAt);

  if (
    !session ||
    typeof session.id !== "string" ||
    Number.isNaN(Date.parse(session.startedAt)) ||
    (endedAt && Number.isNaN(endedAt.getTime())) ||
    (deletedAt && Number.isNaN(deletedAt.getTime())) ||
    Number.isNaN(updatedAt.getTime())
  ) {
    return null;
  }

  return {
    id: session.id,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: endedAt?.toISOString() ?? null,
    targetHours: normalizeTargetHours(session.targetHours),
    updatedAt: updatedAt.toISOString(),
    deletedAt: deletedAt?.toISOString() ?? null,
  };
}

export function normalizeData(value) {
  const sessions = Array.isArray(value?.sessions)
    ? value.sessions.map(normalizeSession).filter(Boolean)
    : [];

  return {
    version: DATA_VERSION,
    settings: {
      targetHours: normalizeTargetHours(value?.settings?.targetHours),
    },
    profile: normalizeProfile(value?.profile),
    sync: normalizeSync(value?.sync),
    sessions,
  };
}

function newestByUpdatedAt(current, incoming) {
  return new Date(incoming.updatedAt) > new Date(current.updatedAt) ? incoming : current;
}

function mergeSessions(currentSessions, incomingSessions) {
  const sessions = new Map();
  for (const session of [...currentSessions, ...incomingSessions]) {
    const existing = sessions.get(session.id);
    if (!existing) {
      sessions.set(session.id, session);
      continue;
    }

    const sessionUpdatedAt = new Date(session.updatedAt).getTime();
    const existingUpdatedAt = new Date(existing.updatedAt).getTime();
    if (
      sessionUpdatedAt > existingUpdatedAt ||
      (sessionUpdatedAt === existingUpdatedAt && session.deletedAt && !existing.deletedAt)
    ) {
      sessions.set(session.id, session);
    }
  }

  return [...sessions.values()];
}

export function loadData(storage) {
  try {
    const current = storage.getItem(STORAGE_KEY);
    if (current) {
      return normalizeData(JSON.parse(current));
    }

    const legacy = storage.getItem(LEGACY_SESSIONS_KEY);
    if (legacy) {
      const migrated = normalizeData({ sessions: JSON.parse(legacy) });
      saveData(storage, migrated);
      storage.removeItem(LEGACY_SESSIONS_KEY);
      return migrated;
    }
  } catch {}

  return emptyData();
}

export function saveData(storage, value) {
  const normalized = normalizeData(value);

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    return { data: normalized, saved: true };
  } catch {
    return { data: normalized, saved: false };
  }
}

export function parseBackup(text) {
  return normalizeData(JSON.parse(text));
}

export function mergeData(current, incoming) {
  const normalizedCurrent = normalizeData(current);
  const normalizedIncoming = normalizeData(incoming);
  const profile = newestByUpdatedAt(normalizedCurrent.profile, normalizedIncoming.profile);
  const sync = newestByUpdatedAt(normalizedCurrent.sync, normalizedIncoming.sync);

  return normalizeData({
    settings: normalizedIncoming.settings,
    profile,
    sync,
    sessions: mergeSessions(normalizedCurrent.sessions, normalizedIncoming.sessions),
  });
}

export function serializeBackup(value) {
  return JSON.stringify(normalizeData(value), null, 2);
}
