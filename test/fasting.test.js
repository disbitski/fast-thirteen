import test from "node:test";
import assert from "node:assert/strict";
import {
  correctSession,
  createSessionId,
  currentStreak,
  deleteSession,
  durationMs,
  endFast,
  formatDuration,
  formatHoursAndMinutes,
  isComplete,
  normalizeTargetHours,
  progress,
  startFast,
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

test("a spring clock change does not count the skipped hour toward a fast", () => {
  const active = startFast(new Date("2026-03-07T19:00:00-05:00"), 13);
  const morning = new Date("2026-03-08T08:00:00-04:00");

  assert.equal(durationMs(active, morning), 12 * 60 * 60 * 1000);
  assert.equal(progress(active, morning), 12 / 13);
  assert.equal(isComplete(active, morning), false);
  assert.equal(isComplete(active, new Date("2026-03-08T09:00:00-04:00")), true);
});

test("a half-hour goal completes at the exact target time", () => {
  const active = startFast(new Date("2026-09-08T18:00:00.000Z"), 14.5);
  const justBefore = new Date("2026-09-09T08:29:59.999Z");
  const atTarget = new Date("2026-09-09T08:30:00.000Z");

  assert.equal(isComplete(active, justBefore), false);
  assert.ok(progress(active, justBefore) < 1);
  assert.equal(isComplete(active, atTarget), true);
  assert.equal(progress(active, atTarget), 1);
});

test("caps progress when a fast exceeds its target", () => {
  const complete = session("2026-06-11T18:00:00.000Z", "2026-06-12T08:00:00.000Z");

  assert.equal(progress(complete), 1);
  assert.equal(isComplete(complete), true);
});

test("an ended fast does not keep progressing as time passes", () => {
  const active = startFast(new Date("2026-09-06T20:00:00.000Z"), 13);
  const ended = endFast(active, new Date("2026-09-07T08:00:00.000Z"));
  const nextDay = new Date("2026-09-08T08:00:00.000Z");

  assert.equal(durationMs(ended, nextDay), 12 * 60 * 60 * 1000);
  assert.equal(progress(ended, nextDay), 12 / 13);
  assert.equal(isComplete(ended, nextDay), false);
});

test("ending a fast twice preserves the original end time", () => {
  const active = startFast(new Date("2026-09-12T18:00:00.000Z"), 13);
  const ended = endFast(active, new Date("2026-09-13T07:00:00.000Z"));
  const original = { ...ended };

  assert.throws(
    () => endFast(ended, new Date("2026-09-13T08:00:00.000Z")),
    /Fast has already ended/,
  );
  assert.deepEqual(ended, original);
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

test("keeps a streak across a daylight-saving time change", () => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = "America/New_York";

  try {
    const sessions = [
      session("2026-10-30T20:00:00", "2026-10-31T10:00:00"),
      session("2026-10-31T20:00:00", "2026-11-01T10:00:00"),
      session("2026-11-01T20:00:00", "2026-11-02T10:00:00"),
    ];

    assert.equal(currentStreak(sessions, new Date("2026-11-02T12:00:00")), 3);
  } finally {
    if (previousTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = previousTimeZone;
    }
  }
});

test("formats elapsed time for timer and history displays", () => {
  assert.equal(formatDuration((13 * 60 * 60 + 4 * 60 + 9) * 1000), "13:04:09");
  assert.equal(formatHoursAndMinutes((100 * 60 * 60 + 4 * 60 + 9) * 1000), "100:04");
});

test("normalizes fasting targets to safe half-hour increments", () => {
  assert.equal(normalizeTargetHours("14.2"), 14);
  assert.equal(normalizeTargetHours(14.3), 14.5);
  assert.equal(normalizeTargetHours(0), 1);
  assert.equal(normalizeTargetHours(100), 48);
  assert.equal(normalizeTargetHours("not a number"), 13);
});

test("captures the selected goal when starting a fast", () => {
  const fast = startFast(new Date("2026-06-14T22:00:00.000Z"), 14.5);

  assert.equal(fast.targetHours, 14.5);
  assert.equal(fast.startedAt, "2026-06-14T22:00:00.000Z");
});

test("creates session ids without requiring secure-context randomUUID", () => {
  const id = createSessionId(new Date("2026-06-14T22:00:00.000Z"), {});

  assert.match(id, /^fast-/);
});

test("corrects a completed session while preserving its target", () => {
  const original = session("2026-06-14T23:00:00.000Z", "2026-06-15T11:00:00.000Z", 13);
  const corrected = correctSession(
    original,
    "2026-06-14T22:30:00.000Z",
    "2026-06-15T12:00:00.000Z",
    new Date("2026-06-15T13:00:00.000Z"),
  );

  assert.equal(corrected.targetHours, 13);
  assert.equal(corrected.startedAt, "2026-06-14T22:30:00.000Z");
  assert.equal(corrected.endedAt, "2026-06-15T12:00:00.000Z");
  assert.equal(isComplete(corrected), true);
});

test("shortening a fast below its goal removes goal completion", () => {
  const original = session("2026-09-15T18:00:00.000Z", "2026-09-16T08:00:00.000Z", 13);
  assert.equal(isComplete(original), true);

  const corrected = correctSession(
    original,
    original.startedAt,
    "2026-09-16T06:00:00.000Z",
    new Date("2026-09-16T09:00:00.000Z"),
  );

  assert.equal(corrected.id, original.id);
  assert.equal(corrected.targetHours, 13);
  assert.equal(durationMs(corrected), 12 * 60 * 60 * 1000);
  assert.equal(isComplete(corrected), false);
  assert.equal(original.endedAt, "2026-09-16T08:00:00.000Z");
});

test("rejects invalid session corrections", () => {
  const completed = session("2026-06-14T23:00:00.000Z", "2026-06-15T11:00:00.000Z");

  assert.throws(
    () => correctSession(completed, completed.endedAt, completed.startedAt),
    /End time must be after start time/,
  );
});

test("deleted sessions do not affect dashboard statistics", () => {
  const completed = session("2026-06-14T22:00:00.000Z", "2026-06-15T11:00:00.000Z");
  const deleted = deleteSession(completed, new Date("2026-06-15T12:00:00.000Z"));

  assert.equal(summarize([deleted]).completedFasts, 0);
  assert.equal(summarize([deleted]).totalHours, 0);
});

test("does not allow an active fast to be deleted", () => {
  const active = session("2026-06-14T22:00:00.000Z", null);

  assert.throws(() => deleteSession(active), /An active fast cannot be deleted/);
});

test("rejects corrections that end in the future", () => {
  const completed = session("2026-06-14T23:00:00.000Z", "2026-06-15T11:00:00.000Z");

  assert.throws(
    () =>
      correctSession(
        completed,
        completed.startedAt,
        "2026-06-15T14:00:00.000Z",
        new Date("2026-06-15T13:00:00.000Z"),
      ),
    /cannot end in the future/,
  );
});
