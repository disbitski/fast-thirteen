import test from "node:test";
import assert from "node:assert/strict";
import { createProfileExecutionOrchestrationModel } from "../src/profileExecutionOrchestration.js";
import {
  createProfileExecutionReadiness,
} from "../src/profileExecutor.js";
import { createProfileExecutionResultStatusModel } from "../src/profileExecutionResult.js";
import { createProfileProvisioningPlan } from "../src/profileProvisioning.js";
import { supabaseProfileWriteRepositoryReadiness } from "../src/supabaseProfileWriteRepository.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const IDENTITY_KEY = `profile:5:${USER_ID}`;

function authenticated() {
  return {
    access_token: "must-not-escape",
    status: "authenticated",
    user: {
      app_metadata: { provider: "google" },
      email: "dave@example.com",
      id: USER_ID,
      provider_token: "must-not-escape",
      updated_at: "2026-07-27T10:00:00.000Z",
      user_metadata: { full_name: "Dave Isbitski" },
    },
  };
}

function scope(overrides = {}) {
  return {
    generation: 5,
    identityKey: IDENTITY_KEY,
    status: "authenticated",
    userId: USER_ID,
    ...overrides,
  };
}

function remoteProfile(overrides = {}) {
  return {
    display_name: "Dave Isbitski",
    email: "dave@example.com",
    id: USER_ID,
    provider: "google",
    updated_at: "2026-07-27T09:00:00.000Z",
    ...overrides,
  };
}

function planFor(action) {
  const authState = authenticated();
  const profileScope = scope();
  const remoteRow = action === "create"
    ? null
    : action === "update"
      ? remoteProfile({ display_name: "Older cloud name" })
      : remoteProfile({ updated_at: authState.user.updated_at });
  return createProfileProvisioningPlan({ authState, profileScope, remoteRow });
}

function provisioningState(plan, overrides = {}) {
  return {
    identityKey: IDENTITY_KEY,
    message: plan.message,
    plan,
    reason: plan.reason,
    status: plan.status,
    ...overrides,
  };
}

function buildModel(action, {
  config = {
    isConfigured: true,
    profileConfirmationsEnabled: false,
    profileWritesEnabled: false,
  },
  executeConfirmations = false,
  executeWrites = false,
  executionState = null,
  localData = { sessions: [{ id: "local-fast" }], sync: { status: "local" } },
  profileScope = scope(),
  stateOverrides = {},
} = {}) {
  const authState = authenticated();
  const plan = planFor(action);
  const repositoryReadiness = supabaseProfileWriteRepositoryReadiness({
    authState,
    client: { from() {} },
    config,
    executeConfirmations,
    executeWrites,
    profileScope,
  });
  const executionReadiness = createProfileExecutionReadiness({
    authState,
    confirmationSupport: repositoryReadiness.canConfirm,
    plan,
    profileScope,
    writeSupport: repositoryReadiness.canWrite,
  });
  const executionResult = createProfileExecutionResultStatusModel({
    controllerState: executionState,
    plan,
    profileScope,
  });
  return createProfileExecutionOrchestrationModel({
    authState,
    executionReadiness,
    executionResult,
    localData,
    profileScope,
    provisioningState: provisioningState(plan, stateOverrides),
    repositoryReadiness,
  });
}

test("missing config stays local-only and leaves Local data unchanged", () => {
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local", updatedAt: "2026-07-27T08:00:00.000Z" },
  };
  const snapshot = structuredClone(localData);
  const model = createProfileExecutionOrchestrationModel({
    authState: { status: "guest", user: null },
    localData,
    repositoryReadiness: supabaseProfileWriteRepositoryReadiness({ config: {} }),
  });

  assert.equal(model.status, "local-only");
  assert.equal(model.action.disabled, true);
  assert.equal(model.localSessionCount, 1);
  assert.equal(model.gates.productionWiringEnabled, false);
  assert.equal(model.stages.find((item) => item.key === "profileWriteAdapter").status, "not-run");
  assert.equal(model.stages.find((item) => item.key === "profileExecutionResult").status, "disabled");
  assert.deepEqual(localData, snapshot);
});

test("public profile flags alone cannot enable code-level execution", () => {
  const model = buildModel("create", {
    config: {
      isConfigured: true,
      profileConfirmationsEnabled: true,
      profileWritesEnabled: true,
    },
  });
  const writeStage = model.stages.find((item) => item.key === "profileWriteAdapter");
  const confirmationStage = model.stages.find((item) => item.key === "profileConfirmation");

  assert.equal(model.status, "preview");
  assert.equal(model.action.disabled, true);
  assert.equal(model.gates.writeAdapterReady, false);
  assert.equal(model.gates.confirmationReady, false);
  assert.match(writeStage.message, /code-level execution remains hard-off/);
  assert.match(confirmationStage.message, /code-level confirmation remains hard-off/);
});

test("create update and no-op plans map to deterministic orchestration states", () => {
  const enabledConfig = {
    isConfigured: true,
    profileConfirmationsEnabled: true,
    profileWritesEnabled: true,
  };

  for (const action of ["create", "update"]) {
    const model = buildModel(action, {
      config: enabledConfig,
      executeConfirmations: true,
      executeWrites: true,
    });
    assert.equal(model.status, "test-ready");
    assert.equal(model.actionLabel, action === "create" ? "Create" : "Update");
    assert.equal(model.gates.writeAdapterReady, true);
    assert.equal(model.gates.confirmationReady, true);
    assert.equal(model.gates.executionReady, true);
    assert.equal(model.gates.productionWiringEnabled, false);
    assert.equal(model.action.disabled, true);
    assert.equal(model.action.label, "Production wiring disabled");
  }

  const noOp = buildModel("none");
  assert.equal(noOp.status, "no-op");
  assert.equal(noOp.counts.noop, 1);
  assert.equal(noOp.action.label, "No profile write needed");
  assert.equal(noOp.stages.find((item) => item.key === "profileWriteAdapter").status, "passed");
  assert.equal(noOp.stages.find((item) => item.key === "profileConfirmation").status, "passed");
});

test("stale profile state is reset before plans or counts can appear", () => {
  const model = buildModel("update", {
    stateOverrides: { identityKey: `profile:4:${USER_ID}` },
  });

  assert.equal(model.staleStateReset, true);
  assert.equal(model.identityMatched, false);
  assert.equal(model.actionLabel, "Not run");
  assert.deepEqual(model.counts, { create: 0, invalid: 0, noop: 0, update: 0 });
  assert.equal(model.action.label, "Refresh current profile");
  assert.match(
    model.stages.find((item) => item.key === "profileLifecycle").message,
    /was reset/,
  );
});

test("authenticated lifecycle mismatch blocks readiness without exposing identity", () => {
  const model = buildModel("create", {
    executionState: {
      execution: {
        action: "create",
        confirmed: true,
        status: "executed",
      },
      scopeGeneration: 5,
      status: "executed",
    },
    profileScope: scope({ userId: OTHER_USER_ID }),
  });

  assert.equal(model.status, "blocked");
  assert.equal(model.identityMatched, false);
  assert.equal(model.blockers[0].stage, "profileLifecycle");
  assert.equal(model.gates.productionWiringEnabled, false);
  assert.equal(model.result, null);
  assert.equal(model.action.label, "Refresh current profile");
  assert.doesNotMatch(JSON.stringify(model), new RegExp(`${USER_ID}|${OTHER_USER_ID}`));
});

test("orchestration output omits provider tokens and sync mutations", () => {
  const model = buildModel("create");

  assert.equal(model.dataMutated, false);
  assert.equal(model.localDataUnchanged, true);
  assert.equal(model.localSyncStatusChanged, false);
  assert.equal(model.profileRowWritten, false);
  assert.equal(model.providerTokensExposed, false);
  assert.equal(model.providerTokensStored, false);
  assert.doesNotMatch(
    JSON.stringify(model),
    /must-not-escape|access_token|provider_token/,
  );
});

test("sanitized mock results drive status copy while every action stays disabled", () => {
  const confirmed = buildModel("create", {
    executionState: {
      execution: {
        action: "create",
        confirmed: true,
        executed: true,
        profileRowWritten: true,
        status: "executed",
      },
      scopeGeneration: 5,
      status: "executed",
    },
  });
  const blocked = buildModel("update", {
    executionState: {
      execution: {
        action: "update",
        confirmed: false,
        profileRowWritten: true,
        status: "confirmation-blocked",
      },
      scopeGeneration: 5,
      status: "confirmation-blocked",
    },
  });

  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.action.disabled, true);
  assert.equal(confirmed.action.label, "Mock confirmation passed");
  assert.equal(
    confirmed.stages.find((item) => item.key === "profileExecutionResult").status,
    "confirmed",
  );
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.action.disabled, true);
  assert.equal(blocked.action.label, "Refresh before retry");
  assert.equal(blocked.blockers[0].stage, "profileExecutionResult");
});
