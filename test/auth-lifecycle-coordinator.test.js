import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_LIFECYCLE_EVENT,
  AUTH_LIFECYCLE_STATUS,
  createAuthLifecycleCoordinator,
} from "../src/authLifecycleCoordinator.js";
import { createAuthProfileCoordinator } from "../src/authProfileCoordinator.js";
import { createAuthSessionExpiryController } from "../src/authSessionFreshness.js";
import { createCloudPullRequestController } from "../src/syncPullController.js";

function authenticated(id, {
  event = "SIGNED_IN",
  expiresAt = "2026-07-20T13:00:00.000Z",
  updatedAt = "2026-07-20T12:00:00.000Z",
} = {}) {
  return {
    access_token: "must-not-escape",
    event,
    provider_token: "must-not-escape",
    session: {
      access_token: "must-not-escape",
      expiresAt,
      refresh_token: "must-not-escape",
    },
    status: "authenticated",
    user: { id, updated_at: updatedAt },
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
    setTimer(callback, delay) {
      const id = ++nextId;
      tasks.set(id, { callback, dueAt: currentTime + delay });
      return id;
    },
  };
}

test("deduplicates repeated subscription events without retaining identity or tokens", () => {
  const applied = [];
  const coordinator = createAuthLifecycleCoordinator({
    applyAuthState(state, context) {
      applied.push({ context, state });
    },
  });
  const signedIn = authenticated("user-a");

  const first = coordinator.observeAuthState(signedIn);
  const duplicate = coordinator.observeAuthState(signedIn);

  assert.equal(first.accepted, true);
  assert.equal(first.state.status, AUTH_LIFECYCLE_STATUS.APPLIED);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.state.status, AUTH_LIFECYCLE_STATUS.DEDUPLICATED);
  assert.equal(applied.length, 1);
  assert.doesNotMatch(
    JSON.stringify(applied),
    /must-not-escape|access_token|provider_token|refresh_token/,
  );
  assert.doesNotMatch(
    JSON.stringify({ first, duplicate, current: coordinator.current() }),
    /user-a|must-not-escape|access_token|provider_token|refresh_token/,
  );
});

test("same-user token refresh preserves generation and replaces expiry scheduling once", () => {
  const initial = authenticated("user-a");
  const applied = [];
  const coordinator = createAuthLifecycleCoordinator({
    initialAuthState: initial,
    applyAuthState(state) {
      applied.push(state);
    },
  });
  const refreshed = authenticated("user-a", {
    event: "TOKEN_REFRESHED",
    expiresAt: "2026-07-20T14:00:00.000Z",
  });

  const result = coordinator.observeAuthState(refreshed);
  const duplicate = coordinator.observeAuthState(refreshed);

  assert.equal(result.state.event, AUTH_LIFECYCLE_EVENT.TOKEN_REFRESHED);
  assert.equal(result.state.generation, 1);
  assert.equal(result.state.sameUser, true);
  assert.equal(result.state.expirySchedule, "replace");
  assert.equal(duplicate.deduplicated, true);
  assert.equal(applied.length, 1);
});

test("direct session hydration seeds the same-user lifecycle before subscription events", () => {
  const coordinator = createAuthLifecycleCoordinator({
    applyAuthState() {},
    initialAuthState: { status: "loading", user: null },
  });
  coordinator.synchronizeAuthState(authenticated("user-a", { event: undefined }));

  const refreshed = coordinator.observeAuthState(authenticated("user-a", {
    event: "TOKEN_REFRESHED",
    expiresAt: "2026-07-20T14:00:00.000Z",
  }));

  assert.equal(refreshed.state.generation, 1);
  assert.equal(refreshed.state.sameUser, true);
  assert.equal(refreshed.state.transition, "same-user-refreshed");
});

test("same-user profile metadata changes are not mistaken for duplicate events", () => {
  const applied = [];
  const coordinator = createAuthLifecycleCoordinator({
    applyAuthState(state) {
      applied.push(state);
    },
    initialAuthState: authenticated("user-a"),
  });
  const first = authenticated("user-a", { event: "USER_UPDATED" });
  first.user.user_metadata = { name: "Dave" };
  const second = authenticated("user-a", { event: "USER_UPDATED" });
  second.user.user_metadata = { name: "David" };

  coordinator.observeAuthState(first);
  const changed = coordinator.observeAuthState(second);

  assert.equal(changed.accepted, true);
  assert.equal(changed.state.transition, "same-user-updated");
  assert.equal(applied.length, 2);
  assert.equal(applied[1].user.user_metadata.name, "David");
});

test("remote sign-out resets the profile lifecycle and suppresses duplicate delivery", () => {
  let applied = 0;
  const coordinator = createAuthLifecycleCoordinator({
    initialAuthState: authenticated("user-a"),
    applyAuthState() {
      applied += 1;
    },
  });
  const signedOut = {
    event: "SIGNED_OUT",
    status: "signed-out",
    user: null,
  };

  const result = coordinator.observeAuthState(signedOut);
  const duplicate = coordinator.observeAuthState(signedOut);

  assert.equal(result.state.transition, "signed-out");
  assert.equal(result.state.profilePreviewReset, true);
  assert.equal(result.state.expirySchedule, "cancel");
  assert.equal(result.state.generation, 2);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(applied, 1);
});

test("user switch invalidates an in-flight cloud preview before stale rows can land", async () => {
  const pending = deferred();
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { lastSyncedAt: null, status: "local" },
  };
  const snapshot = structuredClone(localData);
  const pull = createCloudPullRequestController({
    executePull: () => pending.promise,
  });
  const profile = createAuthProfileCoordinator({
    initialAuthState: authenticated("user-a"),
    onInvalidate(transition) {
      pull.invalidate({ message: transition.message, reason: transition.reason });
    },
  });
  const coordinator = createAuthLifecycleCoordinator({
    initialAuthState: authenticated("user-a"),
    applyAuthState(state) {
      profile.observeAuthState(state);
    },
  });
  const read = pull.refresh({
    identityKey: profile.current().identityKey,
    key: profile.scopeKey("fast-sessions"),
    readiness: { canRead: true },
  });

  const switched = coordinator.observeAuthState(authenticated("user-b"));
  pending.resolve({ plan: { actions: [] }, status: "ready" });
  const stale = await read;

  assert.equal(switched.state.transition, "authenticated-user-changed");
  assert.equal(switched.state.profilePreviewReset, true);
  assert.equal(stale.ignored, true);
  assert.equal(pull.current().status, "invalidated");
  assert.equal(pull.current().result, null);
  assert.deepEqual(localData, snapshot);
});

test("same-user refresh replaces one expiry timer while sign-out cancels it", () => {
  const scheduler = fakeScheduler("2026-07-20T12:00:00.000Z");
  const initial = authenticated("user-a", {
    expiresAt: "2026-07-20T12:20:00.000Z",
  });
  const expiry = createAuthSessionExpiryController({
    checkSession: () => ({ accepted: true }),
    clearTimer: scheduler.clearTimer,
    now: scheduler.now,
    setTimer: scheduler.setTimer,
  });
  const profile = createAuthProfileCoordinator({
    initialAuthState: initial,
    onInvalidate(transition) {
      expiry.invalidate({ reason: transition.reason });
    },
  });
  expiry.observe({
    authState: initial,
    enabled: true,
    online: true,
    scopeKey: profile.current().identityKey,
    visibilityState: "visible",
  });
  const coordinator = createAuthLifecycleCoordinator({
    initialAuthState: initial,
    applyAuthState(state) {
      const scoped = profile.observeAuthState(state);
      expiry.observe({
        authState: state,
        enabled: true,
        online: true,
        scopeKey: scoped.identityKey,
        visibilityState: "visible",
      });
    },
  });
  const refreshed = authenticated("user-a", {
    event: "TOKEN_REFRESHED",
    expiresAt: "2026-07-20T12:30:00.000Z",
  });

  coordinator.observeAuthState(refreshed);
  coordinator.observeAuthState(refreshed);
  assert.equal(scheduler.count(), 1);
  assert.equal(new Date(scheduler.nextDueAt()).toISOString(), "2026-07-20T12:25:00.000Z");

  coordinator.observeAuthState({ event: "SIGNED_OUT", status: "signed-out", user: null });
  assert.equal(scheduler.count(), 0);
});

test("session expiry and refresh failure both reset profile-scoped state", () => {
  const initial = authenticated("user-a");
  const applied = [];
  const transitions = [];
  const coordinator = createAuthLifecycleCoordinator({
    initialAuthState: initial,
    applyAuthState(state) {
      applied.push(state);
    },
    onStateChange(state) {
      transitions.push(state);
    },
  });

  const expired = coordinator.observeAuthState({
    event: "TOKEN_REFRESHED",
    status: "guest",
    user: null,
  });
  const signedIn = coordinator.observeAuthState(authenticated("user-a"));
  const failed = coordinator.observeAuthState({
    error: new Error("refresh failed"),
    status: "error",
    user: null,
  });

  assert.equal(expired.state.event, AUTH_LIFECYCLE_EVENT.SESSION_EXPIRED);
  assert.equal(expired.state.profilePreviewReset, true);
  assert.equal(signedIn.state.transition, "authenticated-user-entered");
  assert.equal(failed.state.event, AUTH_LIFECYCLE_EVENT.REFRESH_FAILED);
  assert.equal(failed.state.profilePreviewReset, true);
  assert.equal(applied[2].event, AUTH_LIFECYCLE_EVENT.REFRESH_FAILED);
  assert.equal(transitions.every((state) => state.localDataUnchanged), true);
});

test("unsupported subscription events are ignored without applying auth state", () => {
  let applied = 0;
  const coordinator = createAuthLifecycleCoordinator({
    applyAuthState() {
      applied += 1;
    },
  });

  const result = coordinator.observeAuthState({ event: "PASSWORD_RECOVERY", status: "guest" });

  assert.equal(result.accepted, false);
  assert.equal(result.state.status, AUTH_LIFECYCLE_STATUS.IGNORED);
  assert.equal(result.state.reason, "unsupported-auth-event");
  assert.equal(applied, 0);
});
