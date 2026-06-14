import { DEFAULT_TARGET_HOURS, normalizeTargetHours } from "./fasting.js";

export const DATA_VERSION = 1;
export const STORAGE_KEY = "fast-thirteen-data";
export const LEGACY_SESSIONS_KEY = "fast-thirteen-sessions";

export function emptyData() {
  return {
    version: DATA_VERSION,
    settings: { targetHours: DEFAULT_TARGET_HOURS },
    sessions: [],
  };
}

function normalizeSession(session) {
  if (
    !session ||
    typeof session.id !== "string" ||
    Number.isNaN(Date.parse(session.startedAt)) ||
    (session.endedAt !== null && Number.isNaN(Date.parse(session.endedAt)))
  ) {
    return null;
  }

  return {
    id: session.id,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: session.endedAt ? new Date(session.endedAt).toISOString() : null,
    targetHours: normalizeTargetHours(session.targetHours),
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
    sessions,
  };
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
  const sessions = new Map(
    [...normalizedCurrent.sessions, ...normalizedIncoming.sessions].map((session) => [
      session.id,
      session,
    ]),
  );

  return normalizeData({
    settings: normalizedIncoming.settings,
    sessions: [...sessions.values()],
  });
}

export function serializeBackup(value) {
  return JSON.stringify(normalizeData(value), null, 2);
}
