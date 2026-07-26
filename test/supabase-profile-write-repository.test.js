import test from "node:test";
import assert from "node:assert/strict";
import {
  createProfileExecutionReadiness,
  executeProfileProvisioningPlan,
} from "../src/profileExecutor.js";
import { createProfileProvisioningPlan } from "../src/profileProvisioning.js";
import {
  PROFILE_WRITE_REPOSITORY_METHODS,
  SupabaseProfileWriteRepositoryError,
  createSupabaseProfileWriteRepository,
  profileCandidateToMutation,
  supabaseProfileWriteRepositoryReadiness,
} from "../src/supabaseProfileWriteRepository.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";

function authenticated(overrides = {}) {
  return {
    access_token: "must-not-escape",
    status: "authenticated",
    user: {
      app_metadata: { provider: "google" },
      email: "dave@example.com",
      id: USER_ID,
      provider_token: "must-not-escape",
      updated_at: "2026-07-26T10:00:00.000Z",
      user_metadata: { full_name: "Dave Isbitski" },
      ...overrides,
    },
  };
}

function scope(overrides = {}) {
  return {
    generation: 3,
    identityKey: `profile:3:${USER_ID}`,
    status: "authenticated",
    userId: USER_ID,
    ...overrides,
  };
}

const configured = Object.freeze({
  isConfigured: true,
  profileConfirmationsEnabled: false,
  profileWritesEnabled: false,
  supabaseAnonKey: "sb_publishable_test",
  supabaseUrl: "https://example.supabase.co",
});

function remoteProfile(overrides = {}) {
  return {
    display_name: "Dave Isbitski",
    email: "dave@example.com",
    id: USER_ID,
    provider: "google",
    updated_at: "2026-07-26T09:00:00.000Z",
    ...overrides,
  };
}

function plans() {
  const authState = authenticated();
  const profileScope = scope();
  return {
    authState,
    create: createProfileProvisioningPlan({ authState, profileScope, remoteRow: null }),
    noop: createProfileProvisioningPlan({
      authState,
      profileScope,
      remoteRow: remoteProfile({ updated_at: authState.user.updated_at }),
    }),
    profileScope,
    update: createProfileProvisioningPlan({
      authState,
      profileScope,
      remoteRow: remoteProfile({ display_name: "Older cloud name" }),
    }),
  };
}

function fakeClient({ initialRow = null, readOverride } = {}) {
  const calls = [];
  let row = initialRow;
  return {
    calls,
    from(table) {
      calls.push(["from", table]);
      return {
        insert(value) {
          calls.push(["insert", value]);
          row = value;
          return Promise.resolve({ data: value, error: null });
        },
        select(fields) {
          calls.push(["select", fields]);
          return {
            eq(column, value) {
              calls.push(["read-eq", column, value]);
              return {
                async maybeSingle() {
                  calls.push(["maybeSingle"]);
                  return {
                    data: readOverride === undefined ? row : readOverride,
                    error: null,
                  };
                },
              };
            },
          };
        },
        update(value) {
          calls.push(["update", value]);
          return {
            eq(column, owner) {
              calls.push(["write-eq", column, owner]);
              row = value;
              return Promise.resolve({ data: value, error: null });
            },
          };
        },
      };
    },
  };
}

function readyRepository(client, overrides = {}) {
  const { authState, profileScope } = plans();
  return createSupabaseProfileWriteRepository({
    authState,
    client,
    config: {
      ...configured,
      profileConfirmationsEnabled: true,
      profileWritesEnabled: true,
    },
    executeConfirmations: true,
    executeWrites: true,
    profileScope,
    ...overrides,
  });
}

function executorInput(plan, repository) {
  const { authState, profileScope } = plans();
  return {
    authState,
    confirmationSupport: repository.readiness.canConfirm,
    plan,
    profileScope,
    repository,
    writeSupport: repository.readiness.canWrite,
  };
}

async function assertRepositoryError(operation, code) {
  await assert.rejects(
    operation,
    (error) => error instanceof SupabaseProfileWriteRepositoryError && error.code === code,
  );
}

test("maps profile candidates to deterministic create and owner-scoped update inputs", () => {
  const { create, update } = plans();
  assert.deepEqual(
    profileCandidateToMutation(create.candidate, { action: "create", expectedUserId: USER_ID }),
    {
      action: "create",
      filter: null,
      row: create.candidate,
      table: "profiles",
      type: "insert",
    },
  );
  assert.deepEqual(
    profileCandidateToMutation(update.candidate, { action: "update", expectedUserId: USER_ID }),
    {
      action: "update",
      filter: { column: "id", value: USER_ID },
      row: update.candidate,
      table: "profiles",
      type: "update",
    },
  );
  assert.throws(
    () => profileCandidateToMutation(create.candidate, {
      action: "create",
      expectedUserId: OTHER_USER_ID,
    }),
    (error) => error.code === "remote-profile-owner-mismatch",
  );
});

test("profile repository readiness requires config client lifecycle write and confirmation gates", () => {
  const { authState, profileScope } = plans();
  const client = fakeClient();
  const input = { authState, client, config: configured, profileScope };
  const cases = [
    [supabaseProfileWriteRepositoryReadiness({ ...input, config: {} }), "publishable-config-missing"],
    [supabaseProfileWriteRepositoryReadiness({ ...input, client: null }), "client-missing"],
    [supabaseProfileWriteRepositoryReadiness({
      ...input,
      profileScope: scope({ userId: OTHER_USER_ID }),
    }), "profile-scope-mismatch"],
    [supabaseProfileWriteRepositoryReadiness(input), "profile-write-support-disabled"],
    [supabaseProfileWriteRepositoryReadiness({
      ...input,
      config: { ...configured, profileWritesEnabled: true },
    }), "profile-write-executor-disabled"],
    [supabaseProfileWriteRepositoryReadiness({
      ...input,
      config: { ...configured, profileWritesEnabled: true },
      executeWrites: true,
    }), "profile-confirmation-support-disabled"],
    [supabaseProfileWriteRepositoryReadiness({
      ...input,
      config: {
        ...configured,
        profileConfirmationsEnabled: true,
        profileWritesEnabled: true,
      },
      executeWrites: true,
    }), "profile-confirmation-executor-disabled"],
  ];

  for (const [readiness, reason] of cases) {
    assert.equal(readiness.reason, reason);
    assert.equal(readiness.canWrite, false);
    assert.equal(readiness.canConfirm, false);
    assert.equal(readiness.productionWiringEnabled, false);
  }
  assert.equal(readyRepository(client).readiness.status, "ready");
});

test("repository exposes the executor contract while production wiring stays off", () => {
  const repository = createSupabaseProfileWriteRepository();
  assert.deepEqual(repository.methods, PROFILE_WRITE_REPOSITORY_METHODS);
  for (const method of PROFILE_WRITE_REPOSITORY_METHODS) {
    assert.equal(typeof repository[method], "function");
  }
  assert.equal(repository.productionWiringEnabled, false);
});

test("default-disabled repository rejects writes before touching Supabase", async () => {
  const { authState, create, profileScope } = plans();
  const client = fakeClient();
  const repository = createSupabaseProfileWriteRepository({
    authState,
    client,
    config: configured,
    profileScope,
  });

  await assertRepositoryError(
    () => repository.createProfile({ profile: create.candidate }),
    "profile-writes-disabled",
  );
  assert.deepEqual(client.calls, []);
});

test("fake Supabase adapter satisfies create and update executor paths", async () => {
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local", updatedAt: "2026-07-26T08:00:00.000Z" },
  };
  const snapshot = structuredClone(localData);

  for (const action of ["create", "update"]) {
    const plan = plans()[action];
    const client = fakeClient({ initialRow: action === "update" ? plan.remote : null });
    const repository = readyRepository(client);
    const input = executorInput(plan, repository);
    const execution = await executeProfileProvisioningPlan({
      ...input,
      readiness: createProfileExecutionReadiness(input),
    });

    assert.equal(execution.status, "executed");
    assert.equal(execution.confirmed, true);
    assert.equal(execution.localDataUnchanged, true);
    assert.deepEqual(execution.calls, [action, "read", "confirm"]);
    assert.equal(client.calls.some(([name]) => name === (action === "create" ? "insert" : "update")), true);
    assert.equal(client.calls.some(([name]) => name === "maybeSingle"), true);
  }

  assert.deepEqual(localData, snapshot);
});

test("read-back mismatch blocks confirmation and leaves local state unchanged", async () => {
  const { update } = plans();
  const client = fakeClient({
    initialRow: update.remote,
    readOverride: { ...update.candidate, display_name: "Unexpected read-back" },
  });
  const repository = readyRepository(client);
  const input = executorInput(update, repository);
  const execution = await executeProfileProvisioningPlan({
    ...input,
    readiness: createProfileExecutionReadiness(input),
  });

  assert.equal(execution.status, "confirmation-blocked");
  assert.equal(execution.confirmed, false);
  assert.equal(execution.code, "profile-readback-mismatch");
  assert.equal(execution.localDataUnchanged, true);
  assert.equal(execution.localSyncStatusChanged, false);

  const wrongOwner = await repository.confirmProfile({
    action: "update",
    expected: { matchesPlan: true },
    remoteRow: { ...update.candidate, id: OTHER_USER_ID },
  });
  assert.equal(wrongOwner.matchesPlan, false);
  assert.equal(wrongOwner.reason, "remote-profile-owner-mismatch");
});

test("deterministic no-op does not touch even a disabled adapter", async () => {
  const { authState, noop, profileScope } = plans();
  const client = fakeClient();
  const repository = createSupabaseProfileWriteRepository({
    authState,
    client,
    config: configured,
    profileScope,
  });
  const input = executorInput(noop, repository);
  const execution = await executeProfileProvisioningPlan({
    ...input,
    readiness: createProfileExecutionReadiness(input),
  });

  assert.equal(execution.status, "skipped");
  assert.deepEqual(client.calls, []);
});

test("repository readiness and results omit user ids and provider tokens", async () => {
  const { create } = plans();
  const repository = readyRepository(fakeClient());
  const input = executorInput(create, repository);
  const execution = await executeProfileProvisioningPlan({
    ...input,
    readiness: createProfileExecutionReadiness(input),
  });

  assert.doesNotMatch(
    JSON.stringify({ execution, readiness: repository.readiness }),
    new RegExp(`${USER_ID}|must-not-escape|access_token|provider_token`),
  );
});
