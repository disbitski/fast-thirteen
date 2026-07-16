import test from "node:test";
import assert from "node:assert/strict";
import { createCloudPullRequestController } from "../src/syncPullController.js";

const readyResult = {
  plan: { message: "Cloud history read plan is ready." },
  status: "ready",
};

const failedResult = {
  plan: { message: "Network offline." },
  status: "failed",
};

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("disabled refresh never calls the pull executor", async () => {
  let calls = 0;
  const controller = createCloudPullRequestController({
    async executePull() {
      calls += 1;
      return readyResult;
    },
  });
  const result = await controller.refresh({
    key: "guest",
    readiness: {
      canRead: false,
      message: "Sign in before cloud fasting history can be read.",
    },
  });

  assert.equal(calls, 0);
  assert.equal(result.accepted, false);
  assert.equal(result.state.status, "disabled");
  assert.match(result.state.message, /Sign in/);
});

test("successful refresh reports loading then ready and deduplicates automatic reads", async () => {
  const transitions = [];
  const localData = {
    sessions: [{ id: "fast-local", updatedAt: "2026-07-12T10:00:00.000Z" }],
    sync: { status: "local" },
  };
  const snapshot = structuredClone(localData);
  let calls = 0;
  const controller = createCloudPullRequestController({
    async executePull(input) {
      calls += 1;
      assert.equal(input.localData, localData);
      return readyResult;
    },
    onStateChange(state) {
      transitions.push(state.status);
    },
  });
  const input = {
    key: "signed-in-data-v1",
    localData,
    readiness: { canRead: true },
  };

  const refreshed = await controller.refresh(input);
  const duplicate = await controller.refresh(input);

  assert.equal(calls, 1);
  assert.deepEqual(transitions, ["loading", "ready"]);
  assert.equal(refreshed.state.result, readyResult);
  assert.equal(duplicate.deduplicated, true);
  assert.deepEqual(localData, snapshot);
});

test("blocked refresh can be retried explicitly", async () => {
  const results = [failedResult, readyResult];
  let calls = 0;
  const controller = createCloudPullRequestController({
    async executePull() {
      return results[calls++];
    },
  });
  const input = {
    key: "signed-in-data-v1",
    readiness: { canRead: true },
  };

  const blocked = await controller.refresh(input);
  const automaticRetry = await controller.refresh(input);
  const manualRetry = await controller.refresh({ ...input, force: true });

  assert.equal(blocked.state.status, "blocked");
  assert.equal(automaticRetry.deduplicated, true);
  assert.equal(manualRetry.state.status, "ready");
  assert.equal(calls, 2);
});

test("stale responses cannot replace a newer cloud preview", async () => {
  const first = deferred();
  const second = deferred();
  const pending = [first, second];
  let calls = 0;
  const controller = createCloudPullRequestController({
    async executePull() {
      return pending[calls++].promise;
    },
  });

  const firstRefresh = controller.refresh({
    key: "local-data-v1",
    readiness: { canRead: true },
  });
  const secondRefresh = controller.refresh({
    key: "local-data-v2",
    readiness: { canRead: true },
  });

  first.resolve({ ...readyResult, marker: "stale" });
  const stale = await firstRefresh;
  assert.equal(stale.ignored, true);
  assert.equal(stale.stale, true);
  assert.equal(controller.current().key, "local-data-v2");
  assert.equal(controller.current().status, "loading");

  second.resolve({ ...readyResult, marker: "current" });
  const current = await secondRefresh;
  assert.equal(current.ignored, false);
  assert.equal(controller.current().result.marker, "current");
});

test("sign-out invalidation clears a pending profile read", async () => {
  const pending = deferred();
  const controller = createCloudPullRequestController({
    async executePull() {
      return pending.promise;
    },
  });
  const refresh = controller.refresh({
    identityKey: "profile:1:user-a",
    key: "user-a-generation-1",
    readiness: { canRead: true },
  });

  const invalidated = controller.invalidate({
    message: "Signed out. Previous cloud preview data was cleared.",
    reason: "signed-out",
  });
  pending.resolve({ ...readyResult, marker: "user-a" });
  const stale = await refresh;

  assert.equal(invalidated.status, "invalidated");
  assert.equal(invalidated.reason, "signed-out");
  assert.equal(invalidated.identityKey, null);
  assert.equal(invalidated.result, null);
  assert.equal(stale.ignored, true);
  assert.equal(stale.stale, true);
  assert.equal(controller.current().status, "invalidated");
});

test("user A completion cannot replace user B profile read", async () => {
  const userA = deferred();
  const userB = deferred();
  const pending = [userA, userB];
  let calls = 0;
  const controller = createCloudPullRequestController({
    async executePull() {
      return pending[calls++].promise;
    },
  });

  const readA = controller.refresh({
    identityKey: "profile:1:user-a",
    key: "user-a-generation-1",
    readiness: { canRead: true },
  });
  controller.invalidate({ reason: "authenticated-user-changed" });
  const readB = controller.refresh({
    identityKey: "profile:2:user-b",
    key: "user-b-generation-2",
    readiness: { canRead: true },
  });

  userA.resolve({ ...readyResult, marker: "user-a" });
  const staleA = await readA;
  userB.resolve({ ...readyResult, marker: "user-b" });
  const currentB = await readB;

  assert.equal(staleA.ignored, true);
  assert.equal(currentB.ignored, false);
  assert.equal(controller.current().identityKey, "profile:2:user-b");
  assert.equal(controller.current().result.marker, "user-b");
  assert.doesNotMatch(JSON.stringify(controller.current()), /user-a/);
});
