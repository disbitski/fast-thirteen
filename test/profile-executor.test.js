import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_EXECUTION_STATUS,
  confirmProfileProvisioningResult,
  createProfileExecutionControlModel,
  createProfileExecutionController,
  createProfileExecutionReadiness,
  executeProfileProvisioningPlan,
} from "../src/profileExecutor.js";
import { createProfileProvisioningPlan } from "../src/profileProvisioning.js";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function authenticated(id = USER_A, {
  displayName = "Dave Isbitski",
  updatedAt = "2026-07-25T10:00:00.000Z",
} = {}) {
  return {
    access_token: "must-not-escape",
    status: "authenticated",
    user: {
      app_metadata: { provider: "google" },
      email: `${id === USER_A ? "dave" : "profile-b"}@example.com`,
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

function remoteProfile(authState = authenticated(), overrides = {}) {
  return {
    display_name: authState.user.user_metadata.full_name,
    email: authState.user.email,
    id: authState.user.id,
    provider: "google",
    updated_at: "2026-07-25T09:00:00.000Z",
    ...overrides,
  };
}

function plans(authState = authenticated(), profileScope = scope()) {
  return {
    create: createProfileProvisioningPlan({
      authState,
      profileScope,
      remoteRow: null,
    }),
    noop: createProfileProvisioningPlan({
      authState,
      profileScope,
      remoteRow: remoteProfile(authState),
    }),
    update: createProfileProvisioningPlan({
      authState,
      profileScope,
      remoteRow: remoteProfile(authState, { display_name: "Older cloud name" }),
    }),
  };
}

function readyInput(plan, overrides = {}) {
  return {
    authState: authenticated(),
    confirmationSupport: true,
    plan,
    profileScope: scope(),
    writeSupport: true,
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

test("execution readiness requires auth lifecycle write and confirmation support", () => {
  const { create, noop } = plans();
  const guest = createProfileExecutionReadiness({
    authState: { status: "guest", user: null },
    plan: create,
    profileScope: scope(),
  });
  const mismatched = createProfileExecutionReadiness({
    ...readyInput(create),
    profileScope: scope(USER_B),
  });
  const writeDisabled = createProfileExecutionReadiness({
    ...readyInput(create),
    writeSupport: false,
  });
  const confirmationDisabled = createProfileExecutionReadiness({
    ...readyInput(create),
    confirmationSupport: false,
  });
  const ready = createProfileExecutionReadiness(readyInput(create));
  const skipped = createProfileExecutionReadiness(readyInput(noop, {
    confirmationSupport: false,
    writeSupport: false,
  }));

  assert.equal(guest.reason, "authenticated-profile-required");
  assert.equal(mismatched.reason, "profile-plan-scope-mismatch");
  assert.equal(writeDisabled.reason, "profile-write-support-disabled");
  assert.equal(confirmationDisabled.reason, "profile-confirmation-support-disabled");
  assert.equal(ready.canExecute, true);
  assert.equal(skipped.canSkip, true);
  assert.equal(skipped.canExecute, false);
  for (const result of [guest, mismatched, writeDisabled, confirmationDisabled, ready, skipped]) {
    assert.equal(result.liveSupabaseWritesEnabled, false);
    assert.equal(result.localDataUnchanged, true);
  }
});

test("deterministic confirmation accepts only an exact read-back row", () => {
  const { create } = plans();
  const confirmed = confirmProfileProvisioningResult({
    plan: create,
    remoteRow: create.candidate,
  });
  const changed = confirmProfileProvisioningResult({
    plan: create,
    remoteRow: { ...create.candidate, display_name: "Changed after write" },
  });

  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.matchesPlan, true);
  assert.equal(changed.status, PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED);
  assert.deepEqual(changed.changedFields, ["display_name"]);
});

test("mocked create and update run write read and confirmation in order", async () => {
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local", updatedAt: "2026-07-25T08:00:00.000Z" },
  };
  const snapshot = structuredClone(localData);

  for (const action of ["create", "update"]) {
    const plan = plans()[action];
    const calls = [];
    let savedProfile = null;
    const repository = {
      async createProfile({ profile }) {
        calls.push("create");
        savedProfile = profile;
        return { accepted: true };
      },
      async updateProfile({ profile }) {
        calls.push("update");
        savedProfile = profile;
        return { accepted: true };
      },
      async readProfile({ userId }) {
        calls.push("read");
        assert.equal(userId, USER_A);
        return savedProfile;
      },
      async confirmProfile({ expected }) {
        calls.push("confirm");
        return { matchesPlan: expected.matchesPlan, status: "confirmed" };
      },
    };

    const execution = await executeProfileProvisioningPlan({
      ...readyInput(plan),
      readiness: createProfileExecutionReadiness(readyInput(plan)),
      repository,
    });

    assert.deepEqual(calls, [action, "read", "confirm"]);
    assert.deepEqual(execution.calls, [action, "read", "confirm"]);
    assert.equal(execution.status, PROFILE_EXECUTION_STATUS.EXECUTED);
    assert.equal(execution.confirmed, true);
    assert.equal(execution.profileRowWritten, true);
    assert.equal(execution.repositoryMode, "mock-only");
    assert.equal(execution.localSyncStatusChanged, false);
  }

  assert.deepEqual(localData, snapshot);
});

test("deterministic no-op skips every repository method", async () => {
  const { noop } = plans();
  const repository = new Proxy({}, {
    get() {
      throw new Error("No repository method should be read for a no-op plan.");
    },
  });
  const execution = await executeProfileProvisioningPlan({
    ...readyInput(noop, { confirmationSupport: false, writeSupport: false }),
    readiness: createProfileExecutionReadiness(readyInput(noop, {
      confirmationSupport: false,
      writeSupport: false,
    })),
    repository,
  });

  assert.equal(execution.status, PROFILE_EXECUTION_STATUS.SKIPPED);
  assert.equal(execution.executed, false);
  assert.equal(execution.profileRowWritten, false);
  assert.deepEqual(execution.calls, []);
});

test("read-back or repository confirmation mismatch blocks success", async () => {
  const { update } = plans();
  const repository = {
    async updateProfile() {
      return { accepted: true };
    },
    async readProfile() {
      return { ...update.candidate, display_name: "Unexpected read-back" };
    },
    async confirmProfile() {
      return { matchesPlan: true, status: "confirmed" };
    },
  };
  const execution = await executeProfileProvisioningPlan({
    ...readyInput(update),
    readiness: createProfileExecutionReadiness(readyInput(update)),
    repository,
  });

  assert.equal(execution.status, PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED);
  assert.equal(execution.confirmed, false);
  assert.equal(execution.code, "profile-readback-mismatch");
  assert.equal(execution.localDataUnchanged, true);
  assert.equal(execution.localSyncStatusChanged, false);
});

test("disabled confirmation blocks before any mocked repository call", async () => {
  const { create } = plans();
  let calls = 0;
  const input = readyInput(create, { confirmationSupport: false });
  const execution = await executeProfileProvisioningPlan({
    ...input,
    readiness: createProfileExecutionReadiness(input),
    repository: new Proxy({}, {
      get() {
        calls += 1;
        return async () => {};
      },
    }),
  });

  assert.equal(execution.status, PROFILE_EXECUTION_STATUS.DISABLED);
  assert.equal(execution.code, "profile-confirmation-support-disabled");
  assert.equal(calls, 0);
});

test("controller suppresses duplicate concurrent execution", async () => {
  const { create } = plans();
  const pending = deferred();
  let writes = 0;
  let savedProfile;
  const repository = {
    async createProfile({ profile }) {
      writes += 1;
      savedProfile = await pending.promise;
      return { accepted: true, profile };
    },
    async readProfile() {
      return savedProfile;
    },
    async confirmProfile() {
      return { matchesPlan: true, status: "confirmed" };
    },
  };
  const input = { ...readyInput(create), repository };
  const controller = createProfileExecutionController();

  const first = controller.execute(input);
  const duplicate = await controller.execute(input);
  pending.resolve(create.candidate);
  const completed = await first;

  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(writes, 1);
  assert.equal(completed.state.status, PROFILE_EXECUTION_STATUS.EXECUTED);
});

test("stale completion is ignored after lifecycle invalidation", async () => {
  const pendingA = deferred();
  const pendingB = deferred();
  let call = 0;
  const controller = createProfileExecutionController({
    async executePlan() {
      return [pendingA, pendingB][call++].promise;
    },
  });
  const planA = plans().create;
  const authB = authenticated(USER_B, {
    displayName: "Profile B",
    updatedAt: "2026-07-25T11:00:00.000Z",
  });
  const scopeB = scope(USER_B, 2);
  const planB = plans(authB, scopeB).create;

  const executionA = controller.execute(readyInput(planA));
  controller.invalidate({ reason: "authenticated-user-changed" });
  const executionB = controller.execute(readyInput(planB, {
    authState: authB,
    profileScope: scopeB,
  }));
  pendingA.resolve({ code: null, message: "A completed.", status: "executed" });
  const staleA = await executionA;
  pendingB.resolve({ code: null, message: "B completed.", status: "executed" });
  const currentB = await executionB;

  assert.equal(staleA.ignored, true);
  assert.equal(staleA.stale, true);
  assert.equal(currentB.ignored, false);
  assert.equal(controller.current().scopeGeneration, 2);
  assert.doesNotMatch(JSON.stringify(controller.current()), new RegExp(USER_A));
});

test("executor and action model omit identities and provider tokens", async () => {
  const { create } = plans();
  const input = readyInput(create);
  const readiness = createProfileExecutionReadiness(input);
  const execution = await executeProfileProvisioningPlan({
    ...input,
    readiness,
    repository: {
      async createProfile() {
        throw new Error("must-not-escape");
      },
      async readProfile() {
        throw new Error("must-not-escape");
      },
      async confirmProfile() {
        throw new Error("must-not-escape");
      },
    },
  });
  const disabledModel = createProfileExecutionControlModel({
    readiness: createProfileExecutionReadiness({ ...input, writeSupport: false }),
  });

  assert.doesNotMatch(
    JSON.stringify({ disabledModel, execution, readiness }),
    new RegExp(`${USER_A}|must-not-escape|access_token|provider_token`),
  );
  assert.equal(disabledModel.disabled, true);
  assert.equal(disabledModel.label, "Profile writes disabled");
  assert.equal(execution.liveSupabaseWritesEnabled, false);
});

test("action model keeps production UI disabled until both mock gates are explicit", () => {
  const { create, noop } = plans();
  const disabledReadiness = createProfileExecutionReadiness({
    ...readyInput(create),
    writeSupport: false,
  });
  const readyReadiness = createProfileExecutionReadiness(readyInput(create));
  const noOpReadiness = createProfileExecutionReadiness(readyInput(noop, {
    confirmationSupport: false,
    writeSupport: false,
  }));
  const disabled = createProfileExecutionControlModel({ readiness: disabledReadiness });
  const ready = createProfileExecutionControlModel({ readiness: readyReadiness });
  const noOp = createProfileExecutionControlModel({ readiness: noOpReadiness });
  const loading = createProfileExecutionControlModel({
    readiness: readyReadiness,
    requestState: { status: PROFILE_EXECUTION_STATUS.LOADING },
  });
  const confirmationBlocked = createProfileExecutionControlModel({
    readiness: readyReadiness,
    requestState: { status: PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED },
  });

  assert.equal(disabled.disabled, true);
  assert.equal(ready.disabled, false);
  assert.equal(ready.label, "Confirm mocked profile write");
  assert.equal(noOp.disabled, true);
  assert.equal(noOp.label, "No profile write needed");
  assert.equal(loading.disabled, true);
  assert.equal(confirmationBlocked.label, "Refresh before retry");
});
