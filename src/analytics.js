import { currentStreak, durationMs, isComplete } from "./fasting.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function localDayStart(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayKey(value) {
  return localDateKey(localDayStart(value));
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function averageOrNaN(values) {
  if (values.length === 0) return Number.NaN;
  return average(values);
}

function completedSessions(sessions) {
  return sessions
    .filter((session) => !session.deletedAt && session.endedAt)
    .sort((a, b) => new Date(a.endedAt) - new Date(b.endedAt));
}

function localMinutes(value) {
  const date = new Date(value);
  return date.getHours() * 60 + date.getMinutes();
}

export function formatHourWindow(minutes) {
  if (!Number.isFinite(minutes)) return "Not enough data";
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(mins).padStart(2, "0")} ${suffix}`;
}

export function lastNDays(sessions, now = new Date(), days = 7) {
  const completed = completedSessions(sessions);
  const byDay = new Map();

  for (const session of completed) {
    const key = dayKey(session.endedAt);
    const entry = byDay.get(key) ?? {
      completed: 0,
      goalReached: 0,
      key,
      sessions: [],
      totalHours: 0,
    };
    entry.completed += 1;
    entry.goalReached += isComplete(session) ? 1 : 0;
    entry.totalHours += durationMs(session) / HOUR_MS;
    entry.sessions.push(session);
    byDay.set(key, entry);
  }

  const end = localDayStart(now);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end.getTime() - (days - index - 1) * DAY_MS);
    const key = localDateKey(date);
    const entry = byDay.get(key);

    return {
      completed: entry?.completed ?? 0,
      date: date.toISOString(),
      goalReached: entry?.goalReached ?? 0,
      key,
      sessions: entry?.sessions ?? [],
      totalHours: round1(entry?.totalHours ?? 0),
    };
  });
}

export function longestGoalStreak(sessions) {
  const days = [
    ...new Set(
      completedSessions(sessions)
        .filter((session) => isComplete(session))
        .map((session) => localDayStart(session.endedAt).getTime()),
    ),
  ].sort((a, b) => a - b);

  let longest = 0;
  let current = 0;
  let previous = null;

  for (const day of days) {
    current = previous == null || day - previous === DAY_MS ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }

  return longest;
}

export function calculateAnalytics(sessions, now = new Date(), targetHours = 13) {
  const completed = completedSessions(sessions);
  const goalSessions = completed.filter((session) => isComplete(session));
  const durations = completed.map((session) => durationMs(session) / HOUR_MS);
  const totalHours = durations.reduce((total, value) => total + value, 0);
  const bestSession = completed.reduce((best, session) => {
    if (!best) return session;
    return durationMs(session) > durationMs(best) ? session : best;
  }, null);
  const sevenDays = lastNDays(sessions, now, 7);
  const recentHours = sevenDays.map((day) => day.totalHours);
  const priorThree = recentHours.slice(0, 3);
  const latestThree = recentHours.slice(-3);
  const trendDelta = average(latestThree) - average(priorThree);

  return {
    averageHours: round1(average(durations)),
    bestHours: bestSession ? round1(durationMs(bestSession) / HOUR_MS) : 0,
    bestSession,
    completionRate: completed.length ? Math.round((goalSessions.length / completed.length) * 100) : 0,
    completedFasts: completed.length,
    currentStreak: currentStreak(sessions, now),
    last7Days: sevenDays,
    longestStreak: longestGoalStreak(sessions),
    preferredEndTime: formatHourWindow(averageOrNaN(completed.map((session) => localMinutes(session.endedAt)))),
    preferredStartTime: formatHourWindow(averageOrNaN(completed.map((session) => localMinutes(session.startedAt)))),
    targetHours,
    totalHours: round1(totalHours),
    trendDelta: round1(trendDelta),
  };
}
