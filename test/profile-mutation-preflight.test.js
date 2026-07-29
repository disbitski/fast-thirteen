import test from "node:test";
import assert from "node:assert/strict";
import { createProfileExecutionReadiness } from "../src/profileExecutor.js";
import { createProfileExecutionResultStatusModel } from "../src/profileExecutionResult.js";
import { createProfileExecutionScenarioHarness } from "../src/profileExecutionScenarioHarness.js";
import {
  PROFILE_MUTATION_PREFLIGHT_STATUS,
  createProfileMutationPreflightModel,
} from "../src/profileMutationPreflight.js";
import { createProfileProvisioningPlan } from "../src/profileProvisioning.js";
import { supabaseProfileWriteRepositoryReadiness } from "../src/supabaseProfileWriteRepository.js";

const USER_A = "11111111-1111-4111-8111-111111111111";

function authenticated() {
  return {
    access_token: "must-not-escape",
    status: "authenticated",
    user: {
      app_metadata: { provider: "google" },
      email: "dave@example.com",
      id: USER_A,
      provider_token: "must-not-escape",
      updated_at: "2026-07-29T10:00:00.000Z",
      user_metadata: { full_name: "Dave Isbitski" },
    },
  };
}

function scope(generation = 7) {
  return {
    generation,
    identityKey: `profile:${generation}:${USER_A}`,
    status: "authenticated",
    userId: USER_A,
  };
}

function remoteProfile(authState, overrides = {}) {
  return {
    display_name: authState.user.user_metadata.full_name,
    email: authState.user.email,
    id: authState.user.id,
    provider: "google",
    updated_at: "2026-07-29T09:00:00.000Z",
    ...overrides,
  };
}

function planFor(action) {
  const authState = authenticated();
  const profileScope = scope();
  const remoteRow = action === "create"
    ? null
    : action === "update"
      ? remoteProfile(authState, { display_name: "Older cloud name" })
      : remoteProfile(authState, { updated_at: authState.user.updated_at });
  return createProfileProvisioningPlan({ authState, profileScope, remoteRow });
}

function support(plan, { executeSupport = true } = {}) {
  const authState = authenticated();
  const profileScope = scope();
  const repositoryReadiness = supabaseProfileWriteRepositoryReadiness({
    authState,
    client: { from() {} },
    config: {
      isConfigured: true,
      profileConfirmationsEnabled: true,
      profileWritesEnabled: true,
    },
    executeConfirmations: executeSupport,
    executeWrites: executeSupport,
    profileScope,
  });
  const executionReadiness = createProfileExecutionReadiness({
    authState,
    confirmationSupport: repositoryReadiness.canConfirm,
    plan,
    profileScope,
    writeSupport: repositoryReadiness.canWrite,
  });
  return { authState, executionReadiness, profileScope, repositoryReadiness };
}

function preflight(plan, executionResult, options = {}) {
  const readiness = support(plan, options);
  return createProfileMutationPreflightModel({
    ...readiness,
    executionResult,
    localData: options.localData ?? { sessions: [{ id: "local-fast" }] },
    mockScenario: options.mockScenario ?? true,
    plan,
    sessionHealth: options.sessionHealth ?? { status: "healthy" },
  });
}

function readyInput(plan) {
  const readiness = support(plan);
  return {
    authState: readiness.authState,
    confirmationSupport: true,
    plan,
    profileScope: readiness.profileScope,
    writeSupport: true,
  };
}

function confirmedRepository() {
  let savedProfile = null;
  return {
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
}

function deferred() {
  let resolve;
  const promise = new Promise((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test("mock create and update rehearsals can reach go without production wiring", async () => {
  for (const action of ["create", "update"]) {
    const plan = planFor(action);
    const harness = createProfileExecutionScenarioHarness();
    const execution = await harness.execute({
      ...readyInput(plan),
      repository: confirmedRepository(),
    });
    const model = preflight(plan, execution.model);

    assert.equal(model.status, PROFILE_MUTATION_PREFLIGHT_STATUS.GO);
    assert.equal(model.go, true);
    assert.equal(model.action, action);
    assert.equal(model.writeTarget, "profiles");
    assert.equal(model.fastSessionsWritesEnabled, false);
    assert.equal(model.productionWiringEnabled, false);
    assert.equal(model.profileWritesEnabled, false);
    assert.equal(model.stages.every((item) => item.status === "passed"), true);
  }
});

test("deterministic no-op rehearsal skips write support and remains local-safe", async () => {
  const plan = planFor("none");
  const harness = createProfileExecutionScenarioHarness();
  const execution = await harness.execute({
    ...readyInput(plan),
    confirmationSupport: false,
    repository: new Proxy({}, {
      get() {
        throw new Error("No-op rehearsal must not inspect a repository.");
      },
    }),
    writeSupport: false,
  });
  const model = preflight(plan, execution.model, { executeSupport: false });

  assert.equal(model.status, PROFILE_MUTATION_PREFLIGHT_STATUS.NOOP);
  assert.equal(model.go, false);
  assert.equal(model.checks.writeSupportReady, false);
  assert.equal(model.checks.fastSessionsWritesDisabled, true);
  assert.equal(model.localDataUnchanged, true);
});

test("confirmation blockers and repository failures remain no-go", async () => {
  const update = planFor("update");
  const blockedHarness = createProfileExecutionScenarioHarness();
  const blockedExecution = await blockedHarness.execute({
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
  const failedHarness = createProfileExecutionScenarioHarness();
  const failedExecution = await failedHarness.execute({
    ...readyInput(update),
    repository: {
      async updateProfile() {
        throw new Error("must-not-escape");
      },
      async readProfile() {
        return null;
      },
      async confirmProfile() {
        return { matchesPlan: false, status: "blocked" };
      },
    },
  });

  for (const execution of [blockedExecution.model, failedExecution.model]) {
    const model = preflight(update, execution);
    assert.equal(model.status, PROFILE_MUTATION_PREFLIGHT_STATUS.NO_GO);
    assert.equal(model.go, false);
    assert.equal(
      model.blockers.some((item) => item.stage === "profileMutationResult"),
      true,
    );
    assert.equal(model.localSyncStatusChanged, false);
  }
});

test("duplicate execution stays checking and stale lifecycle results stay no-go", async () => {
  const create = planFor("create");
  const pending = deferred();
  let savedProfile = null;
  const harness = createProfileExecutionScenarioHarness();
  const input = {
    ...readyInput(create),
    repository: {
      async createProfile({ profile }) {
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
  const duplicate = await harness.execute(input);
  const checking = preflight(create, duplicate.model);
  pending.resolve();
  await first;

  assert.equal(checking.status, PROFILE_MUTATION_PREFLIGHT_STATUS.CHECKING);
  assert.equal(checking.checks.duplicateSuppressed, true);

  const staleResult = createProfileExecutionResultStatusModel({
    controllerState: {
      execution: { action: "create", confirmed: true, status: "executed" },
      scopeGeneration: 6,
      status: "executed",
    },
    plan: create,
    profileScope: scope(),
  });
  const stale = preflight(create, staleResult);
  assert.equal(stale.status, PROFILE_MUTATION_PREFLIGHT_STATUS.NO_GO);
  assert.equal(stale.blockers[0].stage, "profileMutationResult");
});

test("public browser flags alone remain no-go in the shipped mode", () => {
  const create = planFor("create");
  const disabledResult = createProfileExecutionResultStatusModel({
    plan: create,
    profileScope: scope(),
  });
  const model = preflight(create, disabledResult, {
    executeSupport: false,
    mockScenario: false,
  });

  assert.equal(model.status, PROFILE_MUTATION_PREFLIGHT_STATUS.NO_GO);
  assert.equal(model.go, false);
  assert.equal(model.checks.productionWiringEnabled, false);
  assert.equal(
    model.stages.find((item) => item.key === "profileMutationProduction").status,
    "disabled",
  );
});

test("preflight output omits tokens identities and preserves Local fasting data", () => {
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local", updatedAt: "2026-07-29T08:00:00.000Z" },
  };
  const snapshot = structuredClone(localData);
  const create = planFor("create");
  const result = createProfileExecutionResultStatusModel({
    plan: create,
    profileScope: scope(),
  });
  const model = preflight(create, result, {
    executeSupport: false,
    localData,
    mockScenario: false,
  });

  assert.doesNotMatch(
    JSON.stringify(model),
    new RegExp(`${USER_A}|must-not-escape|access_token|provider_token|dave@example.com`),
  );
  assert.equal(model.providerTokensExposed, false);
  assert.equal(model.providerTokensStored, false);
  assert.deepEqual(localData, snapshot);
});
