import test from "node:test";
import assert from "node:assert/strict";
import { createAuthLifecycleCoordinator } from "../src/authLifecycleCoordinator.js";
import {
  PROFILE_PROVISIONING_ACTION,
  PROFILE_PROVISIONING_STATUS,
  authenticatedProfileToRow,
  createProfileProvisioningPlan,
  createProfileProvisioningPreviewController,
  createProfileProvisioningReadiness,
} from "../src/profileProvisioning.js";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function authenticated(id = USER_A, {
  displayName = "Dave Isbitski",
  email = "dave@example.com",
  provider = "google",
  updatedAt = "2026-07-22T10:00:00.000Z",
} = {}) {
  return {
    access_token: "must-not-escape",
    session: {
      access_token: "must-not-escape",
      refresh_token: "must-not-escape",
    },
    status: "authenticated",
    user: {
      app_metadata: { provider },
      email,
      id,
      provider_token: "must-not-escape",
      updated_at: updatedAt,
      user_metadata: { full_name: displayName },
    },
  };
}

function scope(id = USER_A, generation = 1) {
  return {
    generation,
    identityKey: `profile:${generation}:${id}`,
    status: "authenticated",
    userId: id,
  };
}

function remoteProfile(id = USER_A, overrides = {}) {
  return {
    display_name: "Dave Isbitski",
    email: "dave@example.com",
    id,
    provider: "google",
    updated_at: "2026-07-22T09:00:00.000Z",
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("maps authenticated metadata to a token-free profiles row candidate", () => {
  const result = authenticatedProfileToRow(authenticated());

  assert.equal(result.ok, true);
  assert.deepEqual(result.row, {
    display_name: "Dave Isbitski",
    email: "dave@example.com",
    id: USER_A,
    provider: "google",
    updated_at: "2026-07-22T10:00:00.000Z",
  });
  assert.equal(result.writesEnabled, false);
  assert.equal(result.dataMutated, false);
  assert.doesNotMatch(
    JSON.stringify(result),
    /must-not-escape|access_token|refresh_token|provider_token/,
  );
});

test("token-free auth lifecycle retains only the profile revision needed for planning", () => {
  const applied = [];
  const lifecycle = createAuthLifecycleCoordinator({
    applyAuthState(state) {
      applied.push(state);
    },
  });

  lifecycle.observeAuthState({ event: "SIGNED_IN", ...authenticated() });
  const result = authenticatedProfileToRow(applied[0]);

  assert.equal(result.ok, true);
  assert.equal(result.row.updated_at, "2026-07-22T10:00:00.000Z");
  assert.doesNotMatch(
    JSON.stringify({ applied, result }),
    /must-not-escape|access_token|refresh_token|provider_token/,
  );
});

test("profile provisioning readiness stays disabled until read-only support is explicit", () => {
  const disabled = createProfileProvisioningReadiness({
    authState: authenticated(),
    profileScope: scope(),
  });
  const ready = createProfileProvisioningReadiness({
    authState: authenticated(),
    profileScope: scope(),
    readSupport: true,
  });

  assert.equal(disabled.canRead, false);
  assert.equal(disabled.status, PROFILE_PROVISIONING_STATUS.DISABLED);
  assert.equal(disabled.writesEnabled, false);
  assert.equal(ready.canRead, true);
  assert.equal(ready.status, "ready");
  assert.equal(ready.writesEnabled, false);
});

test("plans create, update, and matching-row no-op deterministically", () => {
  const input = { authState: authenticated(), profileScope: scope() };
  const create = createProfileProvisioningPlan({ ...input, remoteRow: null });
  const update = createProfileProvisioningPlan({
    ...input,
    remoteRow: remoteProfile(USER_A, { display_name: "Old name" }),
  });
  const noop = createProfileProvisioningPlan({
    ...input,
    remoteRow: remoteProfile(),
  });

  assert.equal(create.action, PROFILE_PROVISIONING_ACTION.CREATE);
  assert.equal(create.status, PROFILE_PROVISIONING_STATUS.PREVIEW);
  assert.equal(create.counts.create, 1);
  assert.equal(update.action, PROFILE_PROVISIONING_ACTION.UPDATE);
  assert.deepEqual(update.changedFields, ["display_name"]);
  assert.equal(update.counts.update, 1);
  assert.equal(noop.action, PROFILE_PROVISIONING_ACTION.NONE);
  assert.equal(noop.status, PROFILE_PROVISIONING_STATUS.CURRENT);
  assert.equal(noop.reason, "profile-current");
  for (const plan of [create, update, noop]) {
    assert.equal(plan.canExecute, false);
    assert.equal(plan.profileRowWritten, false);
    assert.equal(plan.localSyncStatusChanged, false);
    assert.equal(plan.writesEnabled, false);
  }
});

test("an equal or newer remote profile wins changed-field conflicts", () => {
  const plan = createProfileProvisioningPlan({
    authState: authenticated(),
    profileScope: scope(),
    remoteRow: remoteProfile(USER_A, {
      display_name: "Cloud name",
      updated_at: "2026-07-22T10:00:00.000Z",
    }),
  });

  assert.equal(plan.action, PROFILE_PROVISIONING_ACTION.NONE);
  assert.equal(plan.status, PROFILE_PROVISIONING_STATUS.CURRENT);
  assert.equal(plan.reason, "remote-profile-newer-or-equal");
  assert.deepEqual(plan.changedFields, ["display_name"]);
});

test("invalid auth, scope, remote ownership, and timestamps block provisioning", () => {
  const invalidAuth = createProfileProvisioningPlan({
    authState: authenticated("not-a-uuid"),
    profileScope: scope("not-a-uuid"),
    remoteRow: null,
  });
  const wrongScope = createProfileProvisioningPlan({
    authState: authenticated(),
    profileScope: scope(USER_B),
    remoteRow: null,
  });
  const wrongOwner = createProfileProvisioningPlan({
    authState: authenticated(),
    profileScope: scope(),
    remoteRow: remoteProfile(USER_B),
  });
  const invalidTimestamp = createProfileProvisioningPlan({
    authState: authenticated(),
    profileScope: scope(),
    remoteRow: remoteProfile(USER_A, { updated_at: "not-a-date" }),
  });
  const readMissing = createProfileProvisioningPlan({
    authState: authenticated(),
    profileScope: scope(),
  });

  assert.equal(invalidAuth.reason, "invalid-profile-id");
  assert.equal(wrongScope.reason, "profile-scope-mismatch");
  assert.equal(wrongOwner.reason, "remote-profile-owner-mismatch");
  assert.equal(invalidTimestamp.reason, "invalid-remote-profile-updated-at");
  assert.equal(readMissing.reason, "profile-read-required");
  for (const plan of [invalidAuth, wrongScope, wrongOwner, invalidTimestamp, readMissing]) {
    assert.equal(plan.status, PROFILE_PROVISIONING_STATUS.BLOCKED);
    assert.equal(plan.canExecute, false);
    assert.equal(plan.localDataUnchanged, true);
  }
});

test("preview controller deduplicates a profile revision and never changes local data", async () => {
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { lastSyncedAt: null, status: "local" },
  };
  const snapshot = structuredClone(localData);
  let reads = 0;
  const controller = createProfileProvisioningPreviewController({
    async readProfile({ userId }) {
      reads += 1;
      assert.equal(userId, USER_A);
      return null;
    },
  });
  const input = {
    authState: authenticated(),
    profileScope: scope(),
    readiness: { canRead: true },
  };

  const refreshed = await controller.refresh(input);
  const duplicate = await controller.refresh(input);

  assert.equal(reads, 1);
  assert.equal(refreshed.state.plan.action, PROFILE_PROVISIONING_ACTION.CREATE);
  assert.equal(duplicate.deduplicated, true);
  assert.equal(controller.current().writesEnabled, false);
  assert.deepEqual(localData, snapshot);
});

test("profile A completion is stale after profile B becomes current", async () => {
  const userA = deferred();
  const userB = deferred();
  const reads = [userA, userB];
  let call = 0;
  const controller = createProfileProvisioningPreviewController({
    async readProfile() {
      return reads[call++].promise;
    },
  });

  const readA = controller.refresh({
    authState: authenticated(USER_A),
    profileScope: scope(USER_A, 1),
    readiness: { canRead: true },
  });
  controller.invalidate({ reason: "authenticated-user-changed" });
  const readB = controller.refresh({
    authState: authenticated(USER_B, {
      email: "profile-b@example.com",
      updatedAt: "2026-07-22T11:00:00.000Z",
    }),
    profileScope: scope(USER_B, 2),
    readiness: { canRead: true },
  });

  userA.resolve(remoteProfile(USER_A));
  const staleA = await readA;
  userB.resolve(null);
  const currentB = await readB;

  assert.equal(staleA.ignored, true);
  assert.equal(staleA.stale, true);
  assert.equal(currentB.ignored, false);
  assert.equal(controller.current().identityKey, scope(USER_B, 2).identityKey);
  assert.equal(controller.current().plan.candidate.id, USER_B);
  assert.doesNotMatch(JSON.stringify(controller.current()), new RegExp(USER_A));
});

test("sign-out, expiry, refresh failure, and client replacement clear profile previews", async () => {
  const reasons = [
    "signed-out",
    "session-expired",
    "session-refresh-failed",
    "client-replaced",
  ];
  for (const reason of reasons) {
    const pending = deferred();
    const controller = createProfileProvisioningPreviewController({
      async readProfile() {
        return pending.promise;
      },
    });
    const refresh = controller.refresh({
      authState: authenticated(),
      profileScope: scope(),
      readiness: { canRead: true },
    });

    const reset = controller.invalidate({ reason });
    pending.resolve(remoteProfile());
    const stale = await refresh;

    assert.equal(reset.identityKey, null);
    assert.equal(reset.plan, null);
    assert.equal(reset.reason, reason);
    assert.equal(stale.ignored, true);
    assert.equal(controller.current().localDataUnchanged, true);
  }
});

test("disabled and failed profile reads remain local-safe", async () => {
  let reads = 0;
  const controller = createProfileProvisioningPreviewController({
    async readProfile() {
      reads += 1;
      throw new Error("RLS denied profile read");
    },
  });
  const input = { authState: authenticated(), profileScope: scope() };

  const disabled = await controller.refresh({
    ...input,
    readiness: { canRead: false, message: "Profile reads are disabled." },
  });
  const failed = await controller.refresh({
    ...input,
    readiness: { canRead: true },
  });

  assert.equal(disabled.state.status, PROFILE_PROVISIONING_STATUS.DISABLED);
  assert.equal(failed.state.status, PROFILE_PROVISIONING_STATUS.BLOCKED);
  assert.equal(failed.state.reason, "profile-read-failed");
  assert.equal(reads, 1);
  assert.equal(failed.state.dataMutated, false);
  assert.equal(failed.state.localSyncStatusChanged, false);
  assert.equal(failed.state.writesEnabled, false);
});
