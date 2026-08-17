const DATA_VERSION = 3;

function targetHours(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 13;
  return Math.min(48, Math.max(1, Math.round(number * 2) / 2));
}

function isoDate(value, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return nullable ? null : undefined;
  return date.toISOString();
}

function normalizeSession(value) {
  if (!value || typeof value.id !== "string" || !value.id.trim()) return null;
  const startedAt = isoDate(value.startedAt);
  const endedAt = isoDate(value.endedAt, { nullable: true });
  const deletedAt = isoDate(value.deletedAt, { nullable: true });
  const updatedAt = isoDate(value.updatedAt ?? value.endedAt ?? value.startedAt);
  if (!startedAt || !updatedAt) return null;
  if (value.endedAt != null && !endedAt) return null;
  if (value.deletedAt != null && !deletedAt) return null;
  if (endedAt && new Date(endedAt) < new Date(startedAt)) return null;

  return {
    id: value.id.trim(),
    startedAt,
    endedAt,
    targetHours: targetHours(value.targetHours),
    updatedAt,
    deletedAt,
  };
}

export function normalizeSnapshot(value) {
  if (!value || !Array.isArray(value.sessions)) {
    throw new TypeError("A versioned Fast Thirteen snapshot is required.");
  }
  const sessions = value.sessions.map(normalizeSession);
  if (sessions.some((session) => session == null)) {
    throw new TypeError("The snapshot contains an invalid fasting session.");
  }
  return {
    version: DATA_VERSION,
    settings: { targetHours: targetHours(value.settings?.targetHours) },
    profile: value.profile ?? null,
    sync: value.sync ?? null,
    sessions,
  };
}

export function mergeSnapshots(currentValue, incomingValue) {
  const current = currentValue ? normalizeSnapshot(currentValue) : null;
  const incoming = normalizeSnapshot(incomingValue);
  if (!current) return incoming;

  const sessions = new Map(current.sessions.map((session) => [session.id, session]));
  for (const incomingSession of incoming.sessions) {
    const existing = sessions.get(incomingSession.id);
    if (!existing) {
      sessions.set(incomingSession.id, incomingSession);
      continue;
    }
    const incomingTime = new Date(incomingSession.updatedAt).getTime();
    const existingTime = new Date(existing.updatedAt).getTime();
    if (
      incomingTime > existingTime ||
      (incomingTime === existingTime && incomingSession.deletedAt && !existing.deletedAt)
    ) {
      sessions.set(incomingSession.id, incomingSession);
    }
  }

  return {
    ...incoming,
    sessions: [...sessions.values()].sort(
      (left, right) => new Date(right.startedAt) - new Date(left.startedAt),
    ),
  };
}
