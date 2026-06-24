import { currentStreak, durationMs, isComplete } from "./fasting.js";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const ANALYTICS_RANGES = [
  { bucket: "day", days: 7, id: "7", label: "7 days", shortLabel: "7D" },
  { bucket: "day", days: 30, id: "30", label: "30 days", shortLabel: "30D" },
  { bucket: "week", days: 90, id: "90", label: "90 days", shortLabel: "90D" },
  { bucket: "month", days: 365, id: "365", label: "Full year", shortLabel: "1Y" },
];

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

function sessionsInDays(sessions, now, days) {
  const start = localDayStart(new Date(localDayStart(now).getTime() - (days - 1) * DAY_MS));
  const end = new Date(localDayStart(now).getTime() + DAY_MS);

  return completedSessions(sessions).filter((session) => {
    const endedAt = new Date(session.endedAt);
    return endedAt >= start && endedAt < end;
  });
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

export function recentSessionsForDays(sessions, now = new Date(), days = 7) {
  return lastNDays(sessions, now, days)
    .flatMap((day) => day.sessions)
    .sort((a, b) => new Date(b.endedAt) - new Date(a.endedAt));
}

function bucketDateLabel(value, bucket) {
  const options = bucket === "month"
    ? { month: "short" }
    : { month: "short", day: "numeric" };

  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function summarizeBucket(days, bucket) {
  const first = days[0];
  const last = days.at(-1);

  return {
    completed: days.reduce((total, day) => total + day.completed, 0),
    date: first.date,
    endDate: last.date,
    goalReached: days.reduce((total, day) => total + day.goalReached, 0),
    key: `${first.key}:${last.key}`,
    label: bucketDateLabel(first.date, bucket),
    sessions: days.flatMap((day) => day.sessions),
    totalHours: round1(days.reduce((total, day) => total + day.totalHours, 0)),
  };
}

function chunkDays(days, size, bucket) {
  const buckets = [];

  for (let index = 0; index < days.length; index += size) {
    buckets.push(summarizeBucket(days.slice(index, index + size), bucket));
  }

  return buckets;
}

export function rangeBuckets(sessions, now = new Date(), days = 7) {
  const daily = lastNDays(sessions, now, days);
  if (days <= 30) {
    return daily.map((day) => ({
      ...day,
      label: days <= 7
        ? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(new Date(day.date))
        : bucketDateLabel(day.date, "day"),
    }));
  }

  if (days <= 90) return chunkDays(daily, 7, "week");

  return chunkDays(daily, Math.ceil(days / 12), "month").slice(-12);
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

export function calculateAnalytics(sessions, now = new Date(), targetHours = 13, rangeDays = 7) {
  const completed = sessionsInDays(sessions, now, rangeDays);
  const goalSessions = completed.filter((session) => isComplete(session));
  const durations = completed.map((session) => durationMs(session) / HOUR_MS);
  const totalHours = durations.reduce((total, value) => total + value, 0);
  const bestSession = completed.reduce((best, session) => {
    if (!best) return session;
    return durationMs(session) > durationMs(best) ? session : best;
  }, null);
  const sevenDays = lastNDays(sessions, now, 7);
  const buckets = rangeBuckets(sessions, now, rangeDays);
  const bucketHours = buckets.map((bucket) => bucket.totalHours);
  const comparisonSize = Math.max(1, Math.min(3, Math.floor(bucketHours.length / 2)));
  const prior = bucketHours.slice(0, comparisonSize);
  const latest = bucketHours.slice(-comparisonSize);
  const trendDelta = average(latest) - average(prior);
  const range = ANALYTICS_RANGES.find((option) => option.days === rangeDays) ?? ANALYTICS_RANGES[0];

  return {
    averageHours: round1(average(durations)),
    bestHours: bestSession ? round1(durationMs(bestSession) / HOUR_MS) : 0,
    bestSession,
    completionRate: completed.length ? Math.round((goalSessions.length / completed.length) * 100) : 0,
    completedFasts: completed.length,
    currentStreak: currentStreak(sessions, now),
    last7Days: sevenDays,
    longestStreak: longestGoalStreak(completed),
    preferredEndTime: formatHourWindow(averageOrNaN(completed.map((session) => localMinutes(session.endedAt)))),
    preferredStartTime: formatHourWindow(averageOrNaN(completed.map((session) => localMinutes(session.startedAt)))),
    range,
    rangeBuckets: buckets,
    rangeDays,
    targetHours,
    totalHours: round1(totalHours),
    trendDelta: round1(trendDelta),
  };
}
