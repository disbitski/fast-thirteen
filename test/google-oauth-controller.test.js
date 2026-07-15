import test from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_OAUTH_LAUNCH_STATUS,
  createGoogleOAuthLaunchController,
} from "../src/googleOAuthController.js";

const ready = Object.freeze({
  canSignIn: true,
  message: "Ready",
  redirectTo: "https://disbitski.github.io/fast-thirteen/",
});

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("launch controller rejects a non-ready model before OAuth", async () => {
  let calls = 0;
  const localData = { sessions: [{ id: "local-fast" }], sync: { status: "local" } };
  const snapshot = structuredClone(localData);
  const controller = createGoogleOAuthLaunchController({
    async launch() {
      calls += 1;
      return { ok: true };
    },
  });

  const result = await controller.start({
    readiness: { canSignIn: false, message: "Redirect is not allowed." },
  });

  assert.equal(calls, 0);
  assert.equal(result.accepted, false);
  assert.equal(result.state.status, GOOGLE_OAUTH_LAUNCH_STATUS.BLOCKED);
  assert.equal(result.state.dataMutated, false);
  assert.deepEqual(localData, snapshot);
});

test("repeated launch attempts share one request and omit provider tokens", async () => {
  const pending = deferred();
  const transitions = [];
  let calls = 0;
  const controller = createGoogleOAuthLaunchController({
    async launch(input) {
      calls += 1;
      assert.equal(input.redirectTo, ready.redirectTo);
      return pending.promise;
    },
    onStateChange(state) {
      transitions.push(state.status);
    },
  });

  const first = controller.start({ readiness: ready });
  const duplicate = controller.start({ readiness: ready });
  pending.resolve({
    data: { provider_token: "must-not-escape", url: "https://accounts.google.com/" },
    ok: true,
    status: "redirecting",
  });

  const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
  assert.equal(calls, 1);
  assert.deepEqual(transitions, ["loading", "redirecting"]);
  assert.equal(firstResult.accepted, true);
  assert.equal(duplicateResult.accepted, false);
  assert.equal(duplicateResult.deduplicated, true);
  assert.equal(controller.current().providerTokensStored, false);
  assert.doesNotMatch(JSON.stringify(controller.current()), /must-not-escape|provider_token/);
});

test("callback cancellation and failure survive INITIAL_SESSION hydration", () => {
  const controller = createGoogleOAuthLaunchController({
    launch: async () => ({ ok: true }),
  });

  controller.observeAuthState({
    message: "Google sign-in was cancelled. Local tracking still works.",
    status: "cancelled",
  });
  controller.observeAuthState({ event: "INITIAL_SESSION", status: "guest", user: null });
  assert.equal(controller.current().status, GOOGLE_OAUTH_LAUNCH_STATUS.CANCELLED);

  controller.observeAuthState({
    error: { error: "server_error" },
    message: "Google callback failed. Local tracking still works.",
    status: "error",
  });
  controller.observeAuthState({ event: "INITIAL_SESSION", status: "guest", user: null });
  assert.equal(controller.current().status, GOOGLE_OAUTH_LAUNCH_STATUS.FAILED);

  controller.observeAuthState({
    event: "SIGNED_IN",
    status: "authenticated",
    user: { id: "test-user" },
  });
  assert.equal(controller.current().status, GOOGLE_OAUTH_LAUNCH_STATUS.AUTHENTICATED);
});

test("failed launch maps safe retry feedback without returning raw errors", async () => {
  const controller = createGoogleOAuthLaunchController({
    async launch() {
      throw new Error("Network unavailable");
    },
  });

  const result = await controller.start({ readiness: ready });
  assert.equal(result.state.status, GOOGLE_OAUTH_LAUNCH_STATUS.FAILED);
  assert.equal(result.state.message, "Network unavailable");
  assert.equal("error" in result.state, false);
  assert.equal(result.state.localTrackingAvailable, true);
});
