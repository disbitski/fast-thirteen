export const DEFAULT_TARGET_HOURS = 13;
export const MIN_TARGET_HOURS = 1;
export const MAX_TARGET_HOURS = 48;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function normalizeTargetHours(value) {
  const target = Number(value);
  if (!Number.isFinite(target)) {
    return DEFAULT_TARGET_HOURS;
  }

  return Math.min(MAX_TARGET_HOURS, Math.max(MIN_TARGET_HOURS, Math.round(target * 2) / 2));
}

export function startFast(now = new Date(), targetHours = DEFAULT_TARGET_HOURS) {
  return {
    id: crypto.randomUUID(),
    startedAt: now.toISOString(),
    endedAt: null,
    targetHours: normalizeTargetHours(targetHours),
  };
}

export function endFast(session, now = new Date()) {
  if (session.endedAt) {
    throw new Error("Fast has already ended");
  }

  if (now.getTime() < new Date(session.startedAt).getTime()) {
    throw new Error("A fast cannot end before it starts");
  }

  return { ...session, endedAt: now.toISOString() };
}

export function durationMs(session, now = new Date()) {
  const end = session.endedAt ? new Date(session.endedAt) : now;
  return Math.max(0, end.getTime() - new Date(session.startedAt).getTime());
}

export function isComplete(session, now = new Date()) {
  return durationMs(session, now) >= session.targetHours * HOUR_MS;
}

export function progress(session, now = new Date()) {
  return Math.min(1, durationMs(session, now) / (session.targetHours * HOUR_MS));
}

function localDayKey(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function currentStreak(sessions, now = new Date()) {
  const completedDays = new Set(
    sessions
      .filter((session) => session.endedAt && isComplete(session))
      .map((session) => localDayKey(session.endedAt)),
  );

  const today = localDayKey(now);
  let cursor = completedDays.has(today) ? today : today - DAY_MS;
  let streak = 0;

  while (completedDays.has(cursor)) {
    streak += 1;
    cursor -= DAY_MS;
  }

  return streak;
}

export function summarize(sessions, now = new Date()) {
  const ended = sessions.filter((session) => session.endedAt);
  const completed = ended.filter((session) => isComplete(session));
  const totalMs = ended.reduce((total, session) => total + durationMs(session), 0);

  return {
    completedFasts: completed.length,
    totalHours: totalMs / HOUR_MS,
    currentStreak: currentStreak(sessions, now),
  };
}

export function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds].map((value) => String(value).padStart(2, "0")).join(":");
}
