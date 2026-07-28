import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_EXECUTION_STATUS,
  createProfileExecutionReadiness,
} from "../src/profileExecutor.js";
import {
  PROFILE_EXECUTION_RESULT_STATUS,
  createProfileExecutionResultStatusModel,
} from "../src/profileExecutionResult.js";
import { createProfileExecutionScenarioHarness } from "../src/profileExecutionScenarioHarness.js";
import { createProfileProvisioningPlan } from "../src/profileProvisioning.js";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function authenticated(id = USER_A, generation = 5) {
  return {
    access_token: "must-not-escape",
    status: "authenticated",
    user: {
      app_metadata: { provider: "google" },
      email: `${id === USER_A ? "dave" : "profile-b"}@example.com`,
      id,
      provider_token: "must-not-escape",
      updated_at: `2026-07-28T1${generation}:00:00.000Z`,
      user_metadata: { full_name: id === USER_A ? "Dave Isbitski" : "Profile B" },
    },
  };
}

function scope(id = USER_A, generation = 5) {
  return {
    generation,
    identityKey: `profile:${generation}:${id}`,
    status: "authenticated",
    userId: id,
  };
}

function remoteProfile(authState, overrides = {}) {
  return {
    display_name: authState.user.user_metadata.full_name,
    email: authState.user.email,
    id: authState.user.id,
    provider: "google",
    updated_at: "2026-07-28T09:00:00.000Z",
    ...overrides,
  };
}

function planFor(action, authState = authenticated(), profileScope = scope()) {
  const remoteRow = action === "create"
    ? null
    : action === "update"
      ? remoteProfile(authState, { display_name: "Older cloud name" })
      : remoteProfile(authState, { updated_at: authState.user.updated_at });
  return createProfileProvisioningPlan({ authState, profileScope, remoteRow });
}

function readyInput(plan, authState = authenticated(), profileScope = scope()) {
  return {
    authState,
    confirmationSupport: true,
    plan,
    profileScope,
    writeSupport: true,
  };
}

function execution(action, overrides = {}) {
  return {
    action,
    confirmed: false,
    executed: false,
    profileRowWritten: false,
    status: PROFILE_EXECUTION_STATUS.IDLE,
    summary: {
      confirmationCount: 0,
      createCount: 0,
      readCount: 0,
      updateCount: 0,
    },
    ...overrides,
  };
}

function state(status, executionResult = null, generation = 5) {
  return {
    execution: executionResult,
    message: "raw controller message must not be rendered",
    scopeGeneration: generation,
    status,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("result model maps every mock execution lifecycle state deterministically", () => {
  const create = planFor("create");
  const update = planFor("update");
  const noop = planFor("none");
  const cases = [
    ["disabled", { plan: create }, PROFILE_EXECUTION_RESULT_STATUS.DISABLED],
    ["loading", {
      controllerState: state(PROFILE_EXECUTION_STATUS.LOADING),
      plan: create,
    }, PROFILE_EXECUTION_RESULT_STATUS.LOADING],
    ["awaiting confirmation", {
      controllerState: state(PROFILE_EXECUTION_STATUS.EXECUTED, execution("create", {
        executed: true,
        profileRowWritten: true,
        status: PROFILE_EXECUTION_STATUS.EXECUTED,
      })),
      plan: create,
    }, PROFILE_EXECUTION_RESULT_STATUS.EXECUTED_AWAITING_CONFIRMATION],
    ["confirmed", {
      controllerState: state(PROFILE_EXECUTION_STATUS.EXECUTED, execution("create", {
        confirmed: true,
        executed: true,
        profileRowWritten: true,
        status: PROFILE_EXECUTION_STATUS.EXECUTED,
      })),
      plan: create,
    }, PROFILE_EXECUTION_RESULT_STATUS.CONFIRMED],
    ["confirmation blocked", {
      controllerState: state(PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED, execution("update", {
        profileRowWritten: true,
        status: PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED,
      })),
      plan: update,
    }, PROFILE_EXECUTION_RESULT_STATUS.CONFIRMATION_BLOCKED],
    ["failed", {
      controllerState: state(PROFILE_EXECUTION_STATUS.FAILED, execution("update", {
        status: PROFILE_EXECUTION_STATUS.FAILED,
      })),
      plan: update,
    }, PROFILE_EXECUTION_RESULT_STATUS.FAILED],
    ["invalidated", {
      controllerState: state(PROFILE_EXECUTION_STATUS.INVALIDATED, null, 0),
      plan: create,
    }, PROFILE_EXECUTION_RESULT_STATUS.INVALIDATED],
    ["stale", {
      controllerState: state(PROFILE_EXECUTION_STATUS.EXECUTED, execution("create"), 4),
      plan: create,
    }, PROFILE_EXECUTION_RESULT_STATUS.STALE],
    ["no-op", { plan: noop }, PROFILE_EXECUTION_RESULT_STATUS.NOOP],
  ];

  for (const [label, input, expected] of cases) {
    const model = createProfileExecutionResultStatusModel({
      profileScope: scope(),
      ...input,
    });
    assert.equal(model.status, expected, label);
    assert.equal(model.productionWiringEnabled, false, label);
    assert.equal(model.localDataUnchanged, true, label);
  }
});

test("mock-only harness maps create update and no-op outcomes", async () => {
  for (const action of ["create", "update"]) {
    const plan = planFor(action);
    let savedProfile = null;
    const repository = {
      async createProfile({ profile }) {
        savedProfile = profile;
        return { accepted: true };
      },
      async updateProfile({ profile }) {
        savedProfile = profile;
        return { accepted: true };
      },
      async readProfile() {
        return savedProfile;
      },
      async confirmProfile() {
        return { matchesPlan: true, status: "confirmed" };
      },
    };
    const harness = createProfileExecutionScenarioHarness();
    const result = await harness.execute({ ...readyInput(plan), repository });

    assert.equal(result.model.status, PROFILE_EXECUTION_RESULT_STATUS.CONFIRMED);
    assert.equal(result.model.action, action);
    assert.equal(result.model.counts[action], 1);
    assert.equal(result.model.counts.read, 1);
    assert.equal(result.model.counts.confirmation, 1);
  }

  const noop = planFor("none");
  const noOpHarness = createProfileExecutionScenarioHarness();
  const noOpResult = await noOpHarness.execute({
    ...readyInput(noop),
    confirmationSupport: false,
    repository: new Proxy({}, {
      get() {
        throw new Error("No-op must not inspect a repository.");
      },
    }),
    writeSupport: false,
  });
  assert.equal(noOpResult.model.status, PROFILE_EXECUTION_RESULT_STATUS.NOOP);
  assert.deepEqual(noOpResult.model.counts, {
    confirmation: 0,
    create: 0,
    read: 0,
    update: 0,
  });
});

test("scenario harness preserves confirmation blockers without Local data changes", async () => {
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local", updatedAt: "2026-07-28T08:00:00.000Z" },
  };
  const snapshot = structuredClone(localData);
  const update = planFor("update");
  const harness = createProfileExecutionScenarioHarness();
  const result = await harness.execute({
    ...readyInput(update),
    repository: {
      async updateProfile() {
        return { accepted: true };
      },
      async readProfile() {
        return { ...update.candidate, display_name: "Unexpected read-back" };
      },
      async confirmProfile() {
        return { matchesPlan: true, status: "confirmed" };
      },
    },
  });

  assert.equal(result.model.status, PROFILE_EXECUTION_RESULT_STATUS.CONFIRMATION_BLOCKED);
  assert.equal(result.model.blocked, true);
  assert.equal(result.model.localSyncStatusChanged, false);
  assert.deepEqual(localData, snapshot);
});

test("scenario harness suppresses duplicate concurrent execution", async () => {
  const create = planFor("create");
  const pending = deferred();
  let writes = 0;
  let savedProfile = null;
  const harness = createProfileExecutionScenarioHarness();
  const input = {
    ...readyInput(create),
    repository: {
      async createProfile({ profile }) {
        writes += 1;
        await pending.promise;
        savedProfile = profile;
        return { accepted: true };
      },
      async readProfile() {
        return savedProfile;
      },
      async confirmProfile() {
        return { matchesPlan: true, status: "confirmed" };
      },
    },
  };

  const first = harness.execute(input);
  assert.equal(harness.current().status, PROFILE_EXECUTION_RESULT_STATUS.LOADING);
  const duplicate = await harness.execute(input);
  pending.resolve();
  const completed = await first;

  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.model.status, PROFILE_EXECUTION_RESULT_STATUS.LOADING);
  assert.equal(writes, 1);
  assert.equal(completed.model.status, PROFILE_EXECUTION_RESULT_STATUS.CONFIRMED);
});

test("stale mock completion cannot replace the next profile lifecycle", async () => {
  const pendingA = deferred();
  const pendingB = deferred();
  let call = 0;
  const harness = createProfileExecutionScenarioHarness({
    async executePlan() {
      return [pendingA, pendingB][call++].promise;
    },
  });
  const planA = planFor("create");
  const authB = authenticated(USER_B, 6);
  const scopeB = scope(USER_B, 6);
  const planB = planFor("create", authB, scopeB);

  const executionA = harness.execute(readyInput(planA));
  const invalidated = harness.invalidate({ reason: "authenticated-user-changed" });
  assert.equal(invalidated.status, PROFILE_EXECUTION_RESULT_STATUS.INVALIDATED);
  const executionB = harness.execute(readyInput(planB, authB, scopeB));

  pendingA.resolve(execution("create", {
    confirmed: true,
    executed: true,
    profileRowWritten: true,
    status: PROFILE_EXECUTION_STATUS.EXECUTED,
  }));
  const staleA = await executionA;
  assert.equal(staleA.ignored, true);
  assert.equal(staleA.stale, true);
  assert.equal(staleA.model.status, PROFILE_EXECUTION_RESULT_STATUS.LOADING);

  pendingB.resolve(execution("create", {
    confirmed: true,
    executed: true,
    profileRowWritten: true,
    status: PROFILE_EXECUTION_STATUS.EXECUTED,
  }));
  const currentB = await executionB;
  assert.equal(currentB.model.status, PROFILE_EXECUTION_RESULT_STATUS.CONFIRMED);
  assert.doesNotMatch(JSON.stringify({ currentB, staleA }), new RegExp(`${USER_A}|${USER_B}`));
});

test("result status output omits raw identities rows messages and tokens", () => {
  const model = createProfileExecutionResultStatusModel({
    controllerState: {
      access_token: "must-not-escape",
      execution: {
        ...execution("create", {
          confirmed: true,
          profileRowWritten: true,
          status: PROFILE_EXECUTION_STATUS.EXECUTED,
        }),
        candidate: { id: USER_A },
        provider_token: "must-not-escape",
      },
      message: "must-not-escape",
      scopeGeneration: 5,
      status: PROFILE_EXECUTION_STATUS.EXECUTED,
    },
    plan: planFor("create"),
    profileScope: scope(),
  });

  assert.doesNotMatch(
    JSON.stringify(model),
    new RegExp(`${USER_A}|must-not-escape|access_token|provider_token|candidate`),
  );
  assert.equal(model.providerTokensExposed, false);
  assert.equal(model.providerTokensStored, false);
});
