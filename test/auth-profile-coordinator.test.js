import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_PROFILE_STATUS,
  createAuthProfileCoordinator,
} from "../src/authProfileCoordinator.js";

function authenticated(id, extras = {}) {
  return {
    session: {
      access_token: "must-not-escape",
      provider_token: "must-not-escape",
    },
    status: "authenticated",
    user: { id, ...extras },
  };
}

test("profile coordinator scopes the same user stably and isolates a user switch", () => {
  const invalidations = [];
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local" },
  };
  const snapshot = structuredClone(localData);
  const coordinator = createAuthProfileCoordinator({
    onInvalidate(transition) {
      invalidations.push(transition);
    },
  });

  const userA = coordinator.observeAuthState(authenticated("user-a"));
  const keyA = coordinator.scopeKey("fast-sessions");
  const refreshedA = coordinator.observeAuthState({
    event: "TOKEN_REFRESHED",
    ...authenticated("user-a"),
  });
  const refreshedKeyA = coordinator.scopeKey("fast-sessions");
  const updatedA = coordinator.observeAuthState({
    event: "USER_UPDATED",
    ...authenticated("user-a"),
  });
  const updatedKeyA = coordinator.scopeKey("fast-sessions");
  const userB = coordinator.observeAuthState(authenticated("user-b"));
  const keyB = coordinator.scopeKey("fast-sessions");

  assert.equal(userA.generation, 1);
  assert.equal(refreshedA.generation, 1);
  assert.equal(refreshedKeyA, keyA);
  assert.equal(updatedA.generation, 1);
  assert.equal(updatedKeyA, keyA);
  assert.equal(userB.generation, 2);
  assert.notEqual(keyB, keyA);
  assert.deepEqual(
    invalidations.map((transition) => transition.reason),
    ["authenticated-user-entered", "authenticated-user-changed"],
  );
  assert.equal(userB.providerTokensStored, false);
  assert.doesNotMatch(JSON.stringify({ userB, keyB }), /must-not-escape|access_token|provider_token/);
  assert.deepEqual(localData, snapshot);
});

test("sign-out and same-user re-entry use a new lifecycle generation", () => {
  const invalidations = [];
  const coordinator = createAuthProfileCoordinator({
    onInvalidate(transition) {
      invalidations.push(transition.reason);
    },
  });

  coordinator.observeAuthState(authenticated("user-a"));
  const firstIdentityKey = coordinator.current().identityKey;
  const firstKey = coordinator.scopeKey("cloud-read");
  const signedOut = coordinator.observeAuthState({
    event: "SIGNED_OUT",
    status: "signed-out",
    user: null,
  });
  coordinator.observeAuthState(authenticated("user-a"));
  const secondIdentityKey = coordinator.current().identityKey;
  const secondKey = coordinator.scopeKey("cloud-read");

  assert.equal(signedOut.status, AUTH_PROFILE_STATUS.SIGNED_OUT);
  assert.equal(signedOut.identityKey, null);
  assert.notEqual(secondIdentityKey, firstIdentityKey);
  assert.notEqual(secondKey, firstKey);
  assert.deepEqual(invalidations, [
    "authenticated-user-entered",
    "signed-out",
    "authenticated-user-entered",
  ]);
});

test("session expiry and refresh failure invalidate authenticated scope", () => {
  const transitions = [];
  const coordinator = createAuthProfileCoordinator({
    onInvalidate(transition) {
      transitions.push([transition.reason, transition.next.status]);
    },
  });

  coordinator.observeAuthState(authenticated("user-a"));
  const expired = coordinator.observeAuthState({
    event: "TOKEN_REFRESHED",
    status: "guest",
    user: null,
  });
  coordinator.observeAuthState(authenticated("user-a"));
  const failed = coordinator.observeAuthState({
    error: new Error("refresh failed"),
    status: "error",
    user: null,
  });

  assert.equal(expired.status, AUTH_PROFILE_STATUS.SESSION_EXPIRED);
  assert.equal(failed.status, AUTH_PROFILE_STATUS.SESSION_ERROR);
  assert.deepEqual(transitions, [
    ["authenticated-user-entered", "authenticated"],
    ["session-expired", "session-expired"],
    ["authenticated-user-entered", "authenticated"],
    ["session-refresh-failed", "session-error"],
  ]);
  assert.equal(coordinator.scopeKey("cloud-read"), null);
});

test("callback cancellation remains visible without creating a profile scope", () => {
  let invalidations = 0;
  const coordinator = createAuthProfileCoordinator({
    onInvalidate() {
      invalidations += 1;
    },
  });

  const state = coordinator.observeAuthState({
    message: "Google sign-in was cancelled.",
    status: "cancelled",
    user: null,
  });

  assert.equal(state.status, AUTH_PROFILE_STATUS.CALLBACK_CANCELLED);
  assert.equal(state.identityKey, null);
  assert.equal(invalidations, 0);
});
