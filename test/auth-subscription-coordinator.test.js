import test from "node:test";
import assert from "node:assert/strict";
import { createAuthLifecycleCoordinator } from "../src/authLifecycleCoordinator.js";
import {
  AUTH_SUBSCRIPTION_STATUS,
  createAuthSubscriptionCoordinator,
} from "../src/authSubscriptionCoordinator.js";

function authenticated(id, {
  event = "SIGNED_IN",
  expiresAt = "2026-07-21T13:00:00.000Z",
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
    user: { id },
  };
}

function subscriptionHarness() {
  let handler;
  let subscriptions = 0;
  let unsubscriptions = 0;
  return {
    currentHandler() {
      return handler;
    },
    subscribe(callback) {
      subscriptions += 1;
      handler = callback;
      return {
        unsubscribe() {
          unsubscriptions += 1;
        },
      };
    },
    subscriptions() {
      return subscriptions;
    },
    unsubscriptions() {
      return unsubscriptions;
    },
  };
}

test("one browser client owns one subscription across duplicate initialization", () => {
  const harness = subscriptionHarness();
  const client = { label: "client-a", secret: "must-not-escape" };
  const coordinator = createAuthSubscriptionCoordinator({ onAuthState() {} });

  const attached = coordinator.attach({
    clientGeneration: client,
    subscribe: harness.subscribe,
  });
  const duplicate = coordinator.attach({
    clientGeneration: client,
    subscribe: harness.subscribe,
  });

  assert.equal(attached.accepted, true);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.state.status, AUTH_SUBSCRIPTION_STATUS.DEDUPLICATED);
  assert.equal(duplicate.state.subscriptionActive, true);
  assert.equal(harness.subscriptions(), 1);
  assert.equal(harness.unsubscriptions(), 0);
  assert.doesNotMatch(JSON.stringify(coordinator.current()), /client-a|must-not-escape/);
});

test("client replacement unsubscribes the old owner before attaching the new one", () => {
  const order = [];
  let oldHandler;
  let newHandler;
  const coordinator = createAuthSubscriptionCoordinator({ onAuthState() {} });
  coordinator.attach({
    clientGeneration: { generation: "a" },
    subscribe(callback) {
      order.push("subscribe-a");
      oldHandler = callback;
      return { unsubscribe: () => order.push("unsubscribe-a") };
    },
  });

  const replaced = coordinator.attach({
    clientGeneration: { generation: "b" },
    subscribe(callback) {
      order.push("subscribe-b");
      newHandler = callback;
      return { unsubscribe: () => order.push("unsubscribe-b") };
    },
  });

  assert.deepEqual(order, ["subscribe-a", "unsubscribe-a", "subscribe-b"]);
  assert.equal(replaced.state.generation, 2);
  assert.equal(replaced.state.subscriptionActive, true);
  assert.equal(typeof oldHandler, "function");
  assert.equal(typeof newHandler, "function");
});

test("teardown invalidates ownership before unsubscribe can emit a late callback", () => {
  let callbackResult;
  let handler;
  let accepted = 0;
  const coordinator = createAuthSubscriptionCoordinator({
    onAuthState() {
      accepted += 1;
    },
  });
  coordinator.attach({
    clientGeneration: { generation: "a" },
    subscribe(callback) {
      handler = callback;
      return {
        unsubscribe() {
          callbackResult = handler(authenticated("user-a"));
        },
      };
    },
  });

  const detached = coordinator.detach({ reason: "pagehide" });

  assert.equal(callbackResult.ignored, true);
  assert.equal(callbackResult.reason, "stale-auth-subscription");
  assert.equal(detached.status, AUTH_SUBSCRIPTION_STATUS.DETACHED);
  assert.equal(detached.subscriptionActive, false);
  assert.equal(accepted, 0);
});

test("callbacks from a replaced client cannot reach the active lifecycle", () => {
  const accepted = [];
  let handlerA;
  let handlerB;
  const coordinator = createAuthSubscriptionCoordinator({
    onAuthState(state) {
      accepted.push(state.event);
    },
  });
  coordinator.attach({
    clientGeneration: { generation: "a" },
    subscribe(callback) {
      handlerA = callback;
      return { unsubscribe() {} };
    },
  });
  coordinator.attach({
    clientGeneration: { generation: "b" },
    subscribe(callback) {
      handlerB = callback;
      return { unsubscribe() {} };
    },
  });

  const stale = handlerA(authenticated("user-a"));
  const current = handlerB(authenticated("user-b"));

  assert.equal(stale.ignored, true);
  assert.equal(current.accepted, true);
  assert.deepEqual(accepted, ["SIGNED_IN"]);
});

test("accepted callbacks pass through token-free lifecycle isolation", () => {
  const applied = [];
  const lifecycle = createAuthLifecycleCoordinator({
    applyAuthState(state) {
      applied.push(state);
    },
  });
  const harness = subscriptionHarness();
  const coordinator = createAuthSubscriptionCoordinator({
    onAuthState(state) {
      return lifecycle.observeAuthState(state);
    },
  });
  coordinator.attach({
    clientGeneration: { generation: "a" },
    subscribe: harness.subscribe,
  });

  harness.currentHandler()(authenticated("user-a"));
  const signedOut = harness.currentHandler()({
    event: "SIGNED_OUT",
    status: "signed-out",
    user: null,
  });

  assert.equal(signedOut.result.state.transition, "signed-out");
  assert.equal(applied.length, 2);
  assert.doesNotMatch(
    JSON.stringify({ applied, lifecycle: lifecycle.current(), owner: coordinator.current() }),
    /must-not-escape|access_token|provider_token|refresh_token/,
  );
});

test("same-user refresh duplicates are suppressed by the lifecycle coordinator", () => {
  let applied = 0;
  const lifecycle = createAuthLifecycleCoordinator({
    initialAuthState: authenticated("user-a"),
    applyAuthState() {
      applied += 1;
    },
  });
  const harness = subscriptionHarness();
  const coordinator = createAuthSubscriptionCoordinator({
    onAuthState: lifecycle.observeAuthState,
  });
  coordinator.attach({
    clientGeneration: { generation: "a" },
    subscribe: harness.subscribe,
  });
  const refreshed = authenticated("user-a", {
    event: "TOKEN_REFRESHED",
    expiresAt: "2026-07-21T14:00:00.000Z",
  });

  const first = harness.currentHandler()(refreshed);
  const duplicate = harness.currentHandler()(refreshed);

  assert.equal(first.result.accepted, true);
  assert.equal(duplicate.result.deduplicated, true);
  assert.equal(applied, 1);
  assert.equal(coordinator.current().acceptedEvents, 2);
});

test("missing or failed subscription support stays blocked and local-safe", () => {
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { lastSyncedAt: null, status: "local" },
  };
  const snapshot = structuredClone(localData);
  const coordinator = createAuthSubscriptionCoordinator({ onAuthState() {} });

  const missing = coordinator.attach({
    clientGeneration: { generation: "a" },
    subscribe: () => null,
  });
  const failed = coordinator.attach({
    clientGeneration: { generation: "b" },
    subscribe() {
      throw new Error("subscription failed");
    },
  });

  assert.equal(missing.state.status, AUTH_SUBSCRIPTION_STATUS.BLOCKED);
  assert.equal(missing.state.reason, "subscription-handle-missing");
  assert.equal(failed.state.status, AUTH_SUBSCRIPTION_STATUS.BLOCKED);
  assert.equal(failed.state.reason, "subscription-failed");
  assert.equal(failed.state.authStateRead, false);
  assert.equal(failed.state.cloudRowsRead, false);
  assert.equal(failed.state.writesEnabled, false);
  assert.deepEqual(localData, snapshot);
});

test("a fresh subscription can attach after page teardown", () => {
  const harness = subscriptionHarness();
  const client = { generation: "a" };
  const coordinator = createAuthSubscriptionCoordinator({ onAuthState() {} });

  coordinator.attach({ clientGeneration: client, subscribe: harness.subscribe });
  coordinator.detach({ reason: "pagehide" });
  const restored = coordinator.attach({
    clientGeneration: client,
    subscribe: harness.subscribe,
  });

  assert.equal(restored.accepted, true);
  assert.equal(restored.state.generation, 2);
  assert.equal(restored.state.subscriptionActive, true);
  assert.equal(harness.subscriptions(), 2);
  assert.equal(harness.unsubscriptions(), 1);
});
