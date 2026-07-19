import test from "node:test";
import assert from "node:assert/strict";
import { createAuthProfileCoordinator } from "../src/authProfileCoordinator.js";
import { AUTH_SESSION_CHECK_SOURCE } from "../src/authSessionHealth.js";
import {
  AUTH_SESSION_EXPIRY_STATUS,
  AUTH_SESSION_FRESHNESS_STATUS,
  createAuthSessionExpiryController,
  createAuthSessionFreshnessModel,
} from "../src/authSessionFreshness.js";

function authenticated(expiresAt, event = "SIGNED_IN", id = "user-a") {
  return {
    event,
    provider_token: "must-not-escape",
    session: {
      access_token: "must-not-escape",
      expiresAt,
    },
    status: "authenticated",
    user: { id },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fakeScheduler(startAt) {
  let currentTime = Date.parse(startAt);
  let nextId = 0;
  const tasks = new Map();

  return {
    clearTimer(id) {
      tasks.delete(id);
    },
    count() {
      return tasks.size;
    },
    nextDueAt() {
      return [...tasks.values()].sort((left, right) => left.dueAt - right.dueAt)[0]?.dueAt;
    },
    now() {
      return currentTime;
    },
    async runNext() {
      const next = [...tasks.entries()]
        .sort((left, right) => left[1].dueAt - right[1].dueAt)[0];
      if (!next) return null;
      const [id, task] = next;
      tasks.delete(id);
      currentTime = task.dueAt;
      return task.callback();
    },
    setTimer(callback, delay) {
      const id = ++nextId;
      tasks.set(id, { callback, dueAt: currentTime + delay });
      return id;
    },
  };
}

test("models healthy expiring expired unknown and local-fallback freshness", () => {
  const expiresAt = "2026-07-19T13:00:00.000Z";
  const healthy = createAuthSessionFreshnessModel({
    authState: authenticated(expiresAt),
    now: "2026-07-19T12:00:00.000Z",
  });
  const expiring = createAuthSessionFreshnessModel({
    authState: authenticated(expiresAt),
    now: "2026-07-19T12:56:00.000Z",
  });
  const expired = createAuthSessionFreshnessModel({
    authState: authenticated(expiresAt),
    now: expiresAt,
  });
  const unknown = createAuthSessionFreshnessModel({
    authState: authenticated(null),
    now: "2026-07-19T12:00:00.000Z",
  });
  const outOfRange = createAuthSessionFreshnessModel({
    authState: authenticated(Number.MAX_VALUE),
    now: "2026-07-19T12:00:00.000Z",
  });
  const local = createAuthSessionFreshnessModel({
    authState: { status: "guest", user: null },
    now: "2026-07-19T12:00:00.000Z",
  });

  assert.equal(healthy.status, AUTH_SESSION_FRESHNESS_STATUS.HEALTHY);
  assert.equal(healthy.nextTransitionAt, "2026-07-19T12:55:00.000Z");
  assert.equal(expiring.status, AUTH_SESSION_FRESHNESS_STATUS.EXPIRING);
  assert.equal(expiring.nextTransitionAt, expiresAt);
  assert.equal(expired.status, AUTH_SESSION_FRESHNESS_STATUS.EXPIRED);
  assert.equal(unknown.status, AUTH_SESSION_FRESHNESS_STATUS.UNKNOWN);
  assert.equal(outOfRange.status, AUTH_SESSION_FRESHNESS_STATUS.UNKNOWN);
  assert.equal(local.status, AUTH_SESSION_FRESHNESS_STATUS.LOCAL_FALLBACK);
  assert.doesNotMatch(
    JSON.stringify({ expired, expiring, healthy, local, outOfRange, unknown }),
    /user-a|must-not-escape|access_token|provider_token/,
  );
});

test("health checking overrides expiry without exposing session details", () => {
  const model = createAuthSessionFreshnessModel({
    authState: authenticated("2026-07-19T13:00:00.000Z"),
    healthState: { status: "checking" },
    now: "2026-07-19T12:00:00.000Z",
  });

  assert.equal(model.status, AUTH_SESSION_FRESHNESS_STATUS.CHECKING);
  assert.equal(model.canSchedule, false);
  assert.equal(model.providerTokensExposed, false);
});

test("one timer transitions to expiring then performs one auth-only expiry check", async () => {
  const scheduler = fakeScheduler("2026-07-19T12:00:00.000Z");
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local", updatedAt: null },
  };
  const snapshot = structuredClone(localData);
  const calls = [];
  const controller = createAuthSessionExpiryController({
    checkSession(input) {
      calls.push(input);
      return { accepted: true, ignored: false };
    },
    clearTimer: scheduler.clearTimer,
    now: scheduler.now,
    setTimer: scheduler.setTimer,
  });

  let state = controller.observe({
    authState: authenticated("2026-07-19T12:10:00.000Z"),
    enabled: true,
    online: true,
    scopeKey: "profile:1:user-a",
    visibilityState: "visible",
  });
  assert.equal(state.purpose, "freshness-transition");
  assert.equal(state.scheduledFor, "2026-07-19T12:05:00.000Z");

  await scheduler.runNext();
  state = controller.current();
  assert.equal(state.freshness.status, AUTH_SESSION_FRESHNESS_STATUS.EXPIRING);
  assert.equal(state.purpose, "expiry-check");
  assert.equal(state.scheduledFor, "2026-07-19T12:10:00.000Z");

  const result = await scheduler.runNext();
  assert.equal(result.accepted, true);
  assert.equal(controller.current().status, AUTH_SESSION_EXPIRY_STATUS.COMPLETED);
  assert.deepEqual(calls, [{
    scopeKey: "profile:1:user-a",
    source: AUTH_SESSION_CHECK_SOURCE.EXPIRY,
  }]);
  assert.deepEqual(localData, snapshot);
});

test("same-user refresh preserves profile scope and replaces the old expiry timer", () => {
  const scheduler = fakeScheduler("2026-07-19T12:00:00.000Z");
  const signedIn = authenticated("2026-07-19T12:10:00.000Z");
  const profile = createAuthProfileCoordinator({ initialAuthState: signedIn });
  const controller = createAuthSessionExpiryController({
    checkSession: () => ({ accepted: true }),
    clearTimer: scheduler.clearTimer,
    now: scheduler.now,
    setTimer: scheduler.setTimer,
  });

  const initialScope = profile.current().identityKey;
  controller.observe({
    authState: signedIn,
    enabled: true,
    online: true,
    scopeKey: initialScope,
    visibilityState: "visible",
  });
  const refreshed = authenticated("2026-07-19T12:20:00.000Z", "TOKEN_REFRESHED");
  const refreshedProfile = profile.observeAuthState(refreshed);
  const state = controller.observe({
    authState: refreshed,
    enabled: true,
    online: true,
    scopeKey: refreshedProfile.identityKey,
    visibilityState: "visible",
  });

  assert.equal(refreshedProfile.identityKey, initialScope);
  assert.equal(scheduler.count(), 1);
  assert.equal(new Date(scheduler.nextDueAt()).toISOString(), "2026-07-19T12:15:00.000Z");
  assert.equal(state.freshness.expiresAt, "2026-07-19T12:20:00.000Z");
});

test("hidden offline and disabled states cancel expiry scheduling", () => {
  const scheduler = fakeScheduler("2026-07-19T12:00:00.000Z");
  const controller = createAuthSessionExpiryController({
    checkSession: () => ({ accepted: true }),
    clearTimer: scheduler.clearTimer,
    now: scheduler.now,
    setTimer: scheduler.setTimer,
  });
  const input = {
    authState: authenticated("2026-07-19T12:10:00.000Z"),
    enabled: true,
    online: true,
    scopeKey: "profile:1:user-a",
    visibilityState: "visible",
  };

  controller.observe(input);
  assert.equal(scheduler.count(), 1);
  const hidden = controller.observe({ ...input, visibilityState: "hidden" });
  const offline = controller.observe({ ...input, online: false });
  const disabled = controller.observe({ ...input, enabled: false });

  assert.equal(hidden.reason, "document-hidden");
  assert.equal(offline.reason, "browser-offline");
  assert.equal(disabled.reason, "session-check-disabled");
  assert.equal(scheduler.count(), 0);
});

test("repeated expired observations keep one cooldown-gated check", async () => {
  const scheduler = fakeScheduler("2026-07-19T12:00:00.000Z");
  let calls = 0;
  const controller = createAuthSessionExpiryController({
    checkSession() {
      calls += 1;
      return { accepted: true };
    },
    clearTimer: scheduler.clearTimer,
    now: scheduler.now,
    setTimer: scheduler.setTimer,
  });
  const input = {
    authState: authenticated("2026-07-19T11:59:00.000Z"),
    enabled: true,
    online: true,
    scopeKey: "profile:1:user-a",
    visibilityState: "visible",
  };

  controller.observe(input);
  controller.observe(input);
  assert.equal(scheduler.count(), 1);
  await scheduler.runNext();
  controller.observe(input);

  assert.equal(calls, 1);
  assert.equal(scheduler.count(), 1);
  assert.equal(new Date(scheduler.nextDueAt()).toISOString(), "2026-07-19T12:01:00.000Z");
});

test("profile invalidation makes an in-flight expiry completion stale", async () => {
  const scheduler = fakeScheduler("2026-07-19T12:00:00.000Z");
  const pending = deferred();
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local", updatedAt: null },
  };
  const snapshot = structuredClone(localData);
  const controller = createAuthSessionExpiryController({
    checkSession: () => pending.promise,
    clearTimer: scheduler.clearTimer,
    now: scheduler.now,
    setTimer: scheduler.setTimer,
  });

  controller.observe({
    authState: authenticated("2026-07-19T11:59:00.000Z"),
    enabled: true,
    online: true,
    scopeKey: "profile:1:user-a",
    visibilityState: "visible",
  });
  const check = scheduler.runNext();
  await Promise.resolve();
  controller.invalidate({ reason: "authenticated-user-changed" });
  pending.resolve({ accepted: true });
  const stale = await check;

  assert.equal(stale.ignored, true);
  assert.equal(controller.current().status, AUTH_SESSION_EXPIRY_STATUS.STALE);
  assert.doesNotMatch(JSON.stringify(controller.current()), /user-a|must-not-escape/);
  assert.deepEqual(localData, snapshot);
});
