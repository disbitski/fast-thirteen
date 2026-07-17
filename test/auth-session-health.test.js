import test from "node:test";
import assert from "node:assert/strict";
import {
  AUTH_SESSION_HEALTH_STATUS,
  createAuthSessionHealthController,
  createAuthSessionHealthModel,
} from "../src/authSessionHealth.js";

function authenticated(event = "SIGNED_IN", id = "user-a") {
  return {
    event,
    session: {
      access_token: "must-not-escape",
      provider_token: "must-not-escape",
      refresh_token: "must-not-escape",
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

test("normalizes successful Supabase lifecycle events without retaining identity or tokens", () => {
  let model = createAuthSessionHealthModel({
    authState: authenticated("INITIAL_SESSION"),
    checkedAt: "2026-07-17T11:00:00.000Z",
  });

  for (const event of ["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"]) {
    model = createAuthSessionHealthModel({
      authState: authenticated(event),
      previous: model,
    });
    assert.equal(model.status, AUTH_SESSION_HEALTH_STATUS.HEALTHY);
    assert.equal(model.event, event);
    assert.equal(model.profilePreviewReset, false);
  }

  assert.equal(model.lastCheckedAt, "2026-07-17T11:00:00.000Z");
  assert.doesNotMatch(
    JSON.stringify(model),
    /user-a|must-not-escape|access_token|provider_token|refresh_token/,
  );
});

test("maps initial guest and OAuth callback errors into local fallback", () => {
  const guest = createAuthSessionHealthModel({
    authState: { event: "INITIAL_SESSION", status: "guest", user: null },
  });
  const callbackError = createAuthSessionHealthModel({
    authState: {
      error: { error: "access_denied" },
      message: "Google sign-in was cancelled. Local tracking still works.",
      status: "error",
      user: null,
    },
    previous: guest,
  });

  assert.equal(guest.status, AUTH_SESSION_HEALTH_STATUS.LOCAL_FALLBACK);
  assert.equal(callbackError.status, AUTH_SESSION_HEALTH_STATUS.LOCAL_FALLBACK);
  assert.equal(callbackError.message, "Google sign-in was cancelled. Local tracking still works.");
  assert.equal(callbackError.profilePreviewReset, false);
});

test("maps session expiry refresh failure and sign-out into preview reset states", () => {
  const healthy = createAuthSessionHealthModel({ authState: authenticated() });
  const expired = createAuthSessionHealthModel({
    authState: { event: "TOKEN_REFRESHED", status: "guest", user: null },
    previous: healthy,
  });
  const refreshFailed = createAuthSessionHealthModel({
    authState: { error: true, status: "error", user: null },
    previous: healthy,
  });
  const signedOut = createAuthSessionHealthModel({
    authState: { event: "SIGNED_OUT", status: "signed-out", user: null },
    previous: healthy,
  });

  assert.equal(expired.status, AUTH_SESSION_HEALTH_STATUS.EXPIRED);
  assert.equal(refreshFailed.status, AUTH_SESSION_HEALTH_STATUS.REFRESH_FAILED);
  assert.equal(signedOut.status, AUTH_SESSION_HEALTH_STATUS.SIGNED_OUT);
  assert.equal(expired.profilePreviewReset, true);
  assert.equal(refreshFailed.profilePreviewReset, true);
  assert.equal(signedOut.profilePreviewReset, true);
});

test("manual checks deduplicate one local getSession request", async () => {
  const pending = deferred();
  let calls = 0;
  const controller = createAuthSessionHealthController({
    checkSession() {
      calls += 1;
      return pending.promise;
    },
    initialAuthState: authenticated(),
    initialScopeKey: "profile:1:user-a",
    now: () => "2026-07-17T11:05:00.000Z",
  });

  const first = controller.check({ enabled: true, scopeKey: "profile:1:user-a" });
  const second = controller.check({ enabled: true, scopeKey: "profile:1:user-a" });
  assert.equal(controller.current().status, AUTH_SESSION_HEALTH_STATUS.CHECKING);
  pending.resolve(authenticated("TOKEN_REFRESHED"));
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(calls, 1);
  assert.equal(firstResult.accepted, true);
  assert.equal(secondResult.accepted, false);
  assert.equal(secondResult.deduplicated, true);
  assert.equal(firstResult.state.lastCheckedAt, "2026-07-17T11:05:00.000Z");
});

test("a stale user A check cannot replace user B session health", async () => {
  const pending = deferred();
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local" },
  };
  const snapshot = structuredClone(localData);
  const controller = createAuthSessionHealthController({
    checkSession: () => pending.promise,
    initialAuthState: authenticated("SIGNED_IN", "user-a"),
    initialScopeKey: "profile:1:user-a",
  });

  const checkA = controller.check({ enabled: true, scopeKey: "profile:1:user-a" });
  controller.observeAuthState(authenticated("SIGNED_IN", "user-b"), {
    scopeKey: "profile:2:user-b",
  });
  pending.resolve(authenticated("TOKEN_REFRESHED", "user-a"));
  const stale = await checkA;

  assert.equal(stale.ignored, true);
  assert.equal(controller.current().status, AUTH_SESSION_HEALTH_STATUS.HEALTHY);
  assert.doesNotMatch(JSON.stringify(controller.current()), /user-a|user-b/);
  assert.deepEqual(localData, snapshot);
});

test("a failed manual check is token-free and leaves local data unchanged", async () => {
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local", updatedAt: null },
  };
  const snapshot = structuredClone(localData);
  const controller = createAuthSessionHealthController({
    async checkSession() {
      throw new Error("provider_token=must-not-escape");
    },
    initialAuthState: authenticated(),
    initialScopeKey: "profile:1:user-a",
    now: () => "2026-07-17T11:10:00.000Z",
  });

  const result = await controller.check({ enabled: true, scopeKey: "profile:1:user-a" });

  assert.equal(result.state.status, AUTH_SESSION_HEALTH_STATUS.REFRESH_FAILED);
  assert.doesNotMatch(JSON.stringify(result.state), /must-not-escape|provider_token|user-a/);
  assert.deepEqual(localData, snapshot);
});

test("disabled manual checks never call the auth service", async () => {
  let calls = 0;
  const controller = createAuthSessionHealthController({
    async checkSession() {
      calls += 1;
      return authenticated();
    },
  });

  const result = await controller.check({ enabled: false });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "session-check-disabled");
  assert.equal(calls, 0);
});
