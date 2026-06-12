import test from "node:test";
import assert from "node:assert/strict";
import {
  currentStreak,
  durationMs,
  endFast,
  formatDuration,
  isComplete,
  progress,
  summarize,
} from "../src/fasting.js";

function session(startedAt, endedAt, targetHours = 13) {
  return { id: startedAt, startedAt, endedAt, targetHours };
}

test("calculates duration and progress toward a 13-hour fast", () => {
  const active = session("2026-06-12T08:00:00.000Z", null);
  const now = new Date("2026-06-12T14:30:00.000Z");

  assert.equal(durationMs(active, now), 6.5 * 60 * 60 * 1000);
  assert.equal(progress(active, now), 0.5);
  assert.equal(isComplete(active, now), false);
});

test("caps progress when a fast exceeds its target", () => {
  const complete = session("2026-06-11T18:00:00.000Z", "2026-06-12T08:00:00.000Z");

  assert.equal(progress(complete), 1);
  assert.equal(isComplete(complete), true);
});

test("ending a fast rejects impossible timestamps", () => {
  const active = session("2026-06-12T08:00:00.000Z", null);

  assert.throws(
    () => endFast(active, new Date("2026-06-12T07:59:00.000Z")),
    /cannot end before it starts/,
  );
});

test("summarizes completed fasts and total tracked time", () => {
  const sessions = [
    session("2026-06-10T18:00:00.000Z", "2026-06-11T07:00:00.000Z"),
    session("2026-06-11T18:00:00.000Z", "2026-06-12T06:00:00.000Z"),
  ];

  const stats = summarize(sessions, new Date("2026-06-12T12:00:00.000Z"));

  assert.equal(stats.completedFasts, 1);
  assert.equal(stats.totalHours, 25);
});

test("counts a streak ending today or yesterday", () => {
  const sessions = [
    session("2026-06-09T10:00:00", "2026-06-10T00:00:00"),
    session("2026-06-10T10:00:00", "2026-06-11T00:00:00"),
    session("2026-06-11T10:00:00", "2026-06-12T00:00:00"),
  ];

  assert.equal(currentStreak(sessions, new Date("2026-06-12T12:00:00")), 3);
  assert.equal(currentStreak(sessions, new Date("2026-06-13T12:00:00")), 3);
  assert.equal(currentStreak(sessions, new Date("2026-06-14T12:00:00")), 0);
});

test("formats elapsed time for the timer", () => {
  assert.equal(formatDuration((13 * 60 * 60 + 4 * 60 + 9) * 1000), "13:04:09");
});
