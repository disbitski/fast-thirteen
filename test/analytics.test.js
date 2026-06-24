import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateAnalytics,
  formatHourWindow,
  lastNDays,
  longestGoalStreak,
  rangeBuckets,
  recentSessionsForDays,
} from "../src/analytics.js";

const sessions = [
  {
    id: "day-1",
    startedAt: "2026-06-13T23:00:00.000Z",
    endedAt: "2026-06-14T12:30:00.000Z",
    targetHours: 13,
    updatedAt: "2026-06-14T12:30:00.000Z",
    deletedAt: null,
  },
  {
    id: "day-2",
    startedAt: "2026-06-14T23:10:00.000Z",
    endedAt: "2026-06-15T12:20:00.000Z",
    targetHours: 13,
    updatedAt: "2026-06-15T12:20:00.000Z",
    deletedAt: null,
  },
  {
    id: "short",
    startedAt: "2026-06-15T23:30:00.000Z",
    endedAt: "2026-06-16T10:30:00.000Z",
    targetHours: 13,
    updatedAt: "2026-06-16T10:30:00.000Z",
    deletedAt: null,
  },
  {
    id: "deleted",
    startedAt: "2026-06-16T23:00:00.000Z",
    endedAt: "2026-06-17T12:30:00.000Z",
    targetHours: 13,
    updatedAt: "2026-06-17T13:00:00.000Z",
    deletedAt: "2026-06-17T13:00:00.000Z",
  },
  {
    id: "active",
    startedAt: "2026-06-18T23:00:00.000Z",
    endedAt: null,
    targetHours: 13,
    updatedAt: "2026-06-18T23:00:00.000Z",
    deletedAt: null,
  },
];

test("builds last seven day buckets from completed non-deleted sessions", () => {
  const days = lastNDays(sessions, new Date("2026-06-19T12:00:00.000Z"));

  assert.equal(days.length, 7);
  assert.deepEqual(
    days.map((day) => [day.key, day.completed, day.totalHours]),
    [
      ["2026-06-13", 0, 0],
      ["2026-06-14", 1, 13.5],
      ["2026-06-15", 1, 13.2],
      ["2026-06-16", 1, 11],
      ["2026-06-17", 0, 0],
      ["2026-06-18", 0, 0],
      ["2026-06-19", 0, 0],
    ],
  );
});

test("recent sessions use seven local calendar days instead of a rolling hour window", () => {
  const dailySessions = Array.from({ length: 8 }, (_, index) => {
    const day = 17 + index;
    return {
      id: `june-${day}`,
      startedAt: `2026-06-${String(day - 1).padStart(2, "0")}T23:00:00.000Z`,
      endedAt: `2026-06-${String(day).padStart(2, "0")}T12:00:00.000Z`,
      targetHours: 13,
      updatedAt: `2026-06-${String(day).padStart(2, "0")}T12:00:00.000Z`,
      deletedAt: null,
    };
  });

  const recent = recentSessionsForDays(
    dailySessions,
    new Date("2026-06-24T13:00:00.000Z"),
    7,
  );

  assert.equal(recent.length, 7);
  assert.deepEqual(
    recent.map((session) => session.id),
    ["june-24", "june-23", "june-22", "june-21", "june-20", "june-19", "june-18"],
  );
});

test("calculates dashboard analytics without active or deleted sessions", () => {
  const analytics = calculateAnalytics(sessions, new Date("2026-06-19T12:00:00.000Z"), 13);

  assert.equal(analytics.completedFasts, 3);
  assert.equal(analytics.totalHours, 37.7);
  assert.equal(analytics.averageHours, 12.6);
  assert.equal(analytics.bestHours, 13.5);
  assert.equal(analytics.completionRate, 67);
  assert.equal(analytics.longestStreak, 2);
  assert.equal(analytics.targetHours, 13);
  assert.equal(analytics.range.days, 7);
  assert.equal(analytics.rangeBuckets.length, 7);
});

test("calculates dashboard analytics for the selected date range", () => {
  const olderSession = {
    id: "older",
    startedAt: "2026-05-20T23:00:00.000Z",
    endedAt: "2026-05-21T12:30:00.000Z",
    targetHours: 13,
    updatedAt: "2026-05-21T12:30:00.000Z",
    deletedAt: null,
  };

  const sevenDayAnalytics = calculateAnalytics(
    [...sessions, olderSession],
    new Date("2026-06-19T12:00:00.000Z"),
    13,
    7,
  );
  const thirtyDayAnalytics = calculateAnalytics(
    [...sessions, olderSession],
    new Date("2026-06-19T12:00:00.000Z"),
    13,
    30,
  );

  assert.equal(sevenDayAnalytics.completedFasts, 3);
  assert.equal(sevenDayAnalytics.totalHours, 37.7);
  assert.equal(thirtyDayAnalytics.completedFasts, 4);
  assert.equal(thirtyDayAnalytics.totalHours, 51.2);
});

test("builds readable buckets for dashboard range toggles", () => {
  const now = new Date("2026-06-19T12:00:00.000Z");

  assert.equal(rangeBuckets(sessions, now, 7).length, 7);
  assert.equal(rangeBuckets(sessions, now, 30).length, 30);
  assert.equal(rangeBuckets(sessions, now, 90).length, 13);
  assert.equal(rangeBuckets(sessions, now, 365).length, 12);
  assert.ok(rangeBuckets(sessions, now, 90).some((bucket) => bucket.completed > 1));
});

test("empty analytics shows not enough data for time windows", () => {
  const analytics = calculateAnalytics([], new Date("2026-06-19T12:00:00.000Z"), 13);

  assert.equal(analytics.preferredStartTime, "Not enough data");
  assert.equal(analytics.preferredEndTime, "Not enough data");
});

test("finds longest goal streak by completed local days", () => {
  assert.equal(longestGoalStreak(sessions), 2);
});

test("formats hour windows for empty and concrete values", () => {
  assert.equal(formatHourWindow(Number.NaN), "Not enough data");
  assert.equal(formatHourWindow(21 * 60 + 8), "9:08 PM");
});
