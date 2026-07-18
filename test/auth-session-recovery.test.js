import test from "node:test";
import assert from "node:assert/strict";
import { createAuthProfileCoordinator } from "../src/authProfileCoordinator.js";
import {
  AUTH_SESSION_CHECK_SOURCE,
  createAuthSessionHealthController,
} from "../src/authSessionHealth.js";
import {
  AUTH_SESSION_RECOVERY_STATUS,
  createAuthSessionRecoveryCoordinator,
} from "../src/authSessionRecovery.js";

function authenticated(event = "SIGNED_IN", id = "user-a") {
  return {
    event,
    session: {
      access_token: "must-not-escape",
      provider_token: "must-not-escape",
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

const READY_CONTEXT = Object.freeze({
  enabled: true,
  online: true,
  scopeKey: "profile:1:user-a",
  visibilityState: "visible",
});

test("a visible resume performs one auth-only recovery check", async () => {
  const calls = [];
  const coordinator = createAuthSessionRecoveryCoordinator({
    checkSession(input) {
      calls.push(input);
      return { accepted: true, ignored: false };
    },
    now: () => 1_000,
  });

  const result = await coordinator.resume(READY_CONTEXT);

  assert.equal(result.accepted, true);
  assert.equal(result.source, AUTH_SESSION_CHECK_SOURCE.RESUME);
  assert.deepEqual(calls, [{
    scopeKey: "profile:1:user-a",
    source: AUTH_SESSION_CHECK_SOURCE.RESUME,
  }]);
  assert.equal(result.state.status, AUTH_SESSION_RECOVERY_STATUS.COMPLETED);
  assert.equal(result.state.authStateOnly, true);
  assert.equal(result.state.cloudRowsRead, false);
  assert.equal(result.state.dataMutated, false);
  assert.equal(result.state.localSyncStatusChanged, false);
  assert.equal(result.state.oauthLaunched, false);
  assert.equal(result.state.writesEnabled, false);
});

test("an online reconnect performs one auth-only recovery check", async () => {
  let source = null;
  const coordinator = createAuthSessionRecoveryCoordinator({
    checkSession(input) {
      source = input.source;
      return { accepted: true };
    },
  });

  const result = await coordinator.reconnect(READY_CONTEXT);

  assert.equal(result.accepted, true);
  assert.equal(source, AUTH_SESSION_CHECK_SOURCE.RECONNECT);
  assert.equal(result.state.source, AUTH_SESSION_CHECK_SOURCE.RECONNECT);
});

test("hidden offline and disabled signals never request auth state", async () => {
  let calls = 0;
  const coordinator = createAuthSessionRecoveryCoordinator({
    checkSession() {
      calls += 1;
      return { accepted: true };
    },
  });

  const hidden = await coordinator.resume({
    ...READY_CONTEXT,
    visibilityState: "hidden",
  });
  const offline = await coordinator.reconnect({
    ...READY_CONTEXT,
    online: false,
  });
  const disabled = await coordinator.resume({
    ...READY_CONTEXT,
    enabled: false,
  });

  assert.equal(hidden.reason, "document-hidden");
  assert.equal(offline.reason, "browser-offline");
  assert.equal(disabled.reason, "session-check-disabled");
  assert.equal(calls, 0);
});

test("rapid signals respect cooldown while a new profile scope can recover immediately", async () => {
  let calls = 0;
  let time = 10_000;
  const coordinator = createAuthSessionRecoveryCoordinator({
    checkSession() {
      calls += 1;
      return { accepted: true };
    },
    cooldownMs: 60_000,
    now: () => time,
  });

  const first = await coordinator.resume(READY_CONTEXT);
  time += 30_000;
  const cooledDown = await coordinator.reconnect(READY_CONTEXT);
  const newProfile = await coordinator.resume({
    ...READY_CONTEXT,
    scopeKey: "profile:2:user-b",
  });

  assert.equal(first.accepted, true);
  assert.equal(cooledDown.reason, "recovery-cooldown");
  assert.equal(newProfile.accepted, true);
  assert.equal(calls, 2);
});

test("concurrent resume and reconnect signals share one recovery request", async () => {
  const pending = deferred();
  let calls = 0;
  const coordinator = createAuthSessionRecoveryCoordinator({
    checkSession() {
      calls += 1;
      return pending.promise;
    },
  });

  const resume = coordinator.resume(READY_CONTEXT);
  const reconnect = coordinator.reconnect(READY_CONTEXT);
  await Promise.resolve();
  pending.resolve({ accepted: true });
  const [first, second] = await Promise.all([resume, reconnect]);

  assert.equal(calls, 1);
  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.deduplicated, true);
});

test("a stale user A recovery completion cannot replace user B health", async () => {
  const pending = deferred();
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local", updatedAt: null },
  };
  const snapshot = structuredClone(localData);
  const profile = createAuthProfileCoordinator({ initialAuthState: authenticated() });
  const health = createAuthSessionHealthController({
    checkSession: () => pending.promise,
    initialAuthState: authenticated(),
    initialScopeKey: profile.current().identityKey,
  });
  const recovery = createAuthSessionRecoveryCoordinator({
    checkSession({ source, scopeKey }) {
      return health.check({ enabled: true, source, scopeKey });
    },
  });

  const checkA = recovery.resume({
    ...READY_CONTEXT,
    scopeKey: profile.current().identityKey,
  });
  await Promise.resolve();
  await Promise.resolve();
  const profileB = profile.observeAuthState(authenticated("SIGNED_IN", "user-b"));
  recovery.invalidate({ reason: "authenticated-user-changed" });
  health.observeAuthState(authenticated("SIGNED_IN", "user-b"), {
    scopeKey: profileB.identityKey,
  });
  pending.resolve(authenticated("TOKEN_REFRESHED", "user-a"));
  const stale = await checkA;

  assert.equal(stale.ignored, true);
  assert.equal(stale.state.status, AUTH_SESSION_RECOVERY_STATUS.STALE);
  assert.doesNotMatch(
    JSON.stringify({ recovery: stale.state, health: health.current() }),
    /user-a|user-b|must-not-escape|access_token|provider_token/,
  );
  assert.deepEqual(localData, snapshot);
});

test("a late profile A completion cannot replace profile B recovery status", async () => {
  const profileA = deferred();
  const profileB = deferred();
  const coordinator = createAuthSessionRecoveryCoordinator({
    checkSession({ scopeKey }) {
      return scopeKey === "profile:1:user-a" ? profileA.promise : profileB.promise;
    },
  });

  const checkA = coordinator.resume(READY_CONTEXT);
  await Promise.resolve();
  coordinator.invalidate({ reason: "authenticated-user-changed" });
  const checkB = coordinator.reconnect({
    ...READY_CONTEXT,
    scopeKey: "profile:2:user-b",
  });
  await Promise.resolve();
  profileB.resolve({ accepted: true });
  const currentB = await checkB;
  profileA.resolve({ accepted: true });
  const staleA = await checkA;

  assert.equal(currentB.state.status, AUTH_SESSION_RECOVERY_STATUS.COMPLETED);
  assert.equal(currentB.state.source, AUTH_SESSION_CHECK_SOURCE.RECONNECT);
  assert.equal(staleA.ignored, true);
  assert.equal(coordinator.current(), currentB.state);
});
