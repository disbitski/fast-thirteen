import test from "node:test";
import assert from "node:assert/strict";
import {
  PROFILE_SELECT_FIELDS,
  PROFILES_TABLE,
  createSupabaseProfileReadRepository,
  profileReadReadiness,
} from "../src/supabaseProfileRepository.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

function authenticated(overrides = {}) {
  return {
    status: "authenticated",
    user: {
      app_metadata: { provider: "google" },
      email: "dave@example.com",
      id: USER_ID,
      updated_at: "2026-07-23T10:00:00.000Z",
      user_metadata: { full_name: "Dave Isbitski" },
      ...overrides,
    },
  };
}

function scope(overrides = {}) {
  return {
    generation: 1,
    identityKey: `profile:1:${USER_ID}`,
    status: "authenticated",
    userId: USER_ID,
    ...overrides,
  };
}

function readyInput(overrides = {}) {
  return {
    authState: authenticated(),
    clientStatus: "ready",
    config: { isConfigured: true },
    profileScope: scope(),
    readSupport: true,
    ...overrides,
  };
}

test("profile read readiness separates config client auth scope and read support", () => {
  const missingConfig = profileReadReadiness(readyInput({ config: {} }));
  const missingClient = profileReadReadiness(readyInput({ clientStatus: "loading" }));
  const guest = profileReadReadiness(readyInput({
    authState: { status: "guest", user: null },
    profileScope: { identityKey: null, status: "guest", userId: null },
  }));
  const scopeMismatch = profileReadReadiness(readyInput({
    profileScope: scope({ userId: "22222222-2222-4222-8222-222222222222" }),
  }));
  const readDisabled = profileReadReadiness(readyInput({ readSupport: false }));
  const ready = profileReadReadiness(readyInput());

  assert.equal(missingConfig.reason, "publishable-config-missing");
  assert.equal(missingConfig.stages.config.status, "disabled");
  assert.equal(missingClient.reason, "client-not-ready");
  assert.equal(missingClient.stages.client.status, "disabled");
  assert.equal(guest.reason, "authenticated-profile-required");
  assert.equal(guest.stages.auth.status, "disabled");
  assert.equal(scopeMismatch.reason, "profile-scope-mismatch");
  assert.equal(scopeMismatch.stages.scope.status, "blocked");
  assert.equal(readDisabled.reason, "profile-read-support-disabled");
  assert.equal(readDisabled.stages.read.status, "disabled");
  assert.equal(ready.canRead, true);
  assert.equal(ready.canWrite, false);
  assert.equal(ready.stages.scope.label, "Isolated");
  assert.equal(ready.stages.read.label, "Read only");
  assert.equal(ready.writesEnabled, false);
});

test("read-only repository selects exactly the current profiles row", async () => {
  const calls = [];
  const row = {
    display_name: "Dave Isbitski",
    email: "dave@example.com",
    id: USER_ID,
    provider: "google",
    updated_at: "2026-07-23T10:00:00.000Z",
  };
  const client = {
    from(table) {
      calls.push(["from", table]);
      return {
        select(fields) {
          calls.push(["select", fields]);
          return {
            eq(field, value) {
              calls.push(["eq", field, value]);
              return {
                async maybeSingle() {
                  calls.push(["maybeSingle"]);
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  const repository = createSupabaseProfileReadRepository({
    client,
    readiness: profileReadReadiness(readyInput()),
  });

  assert.deepEqual(await repository.readProfile({ userId: USER_ID }), row);
  assert.deepEqual(calls, [
    ["from", PROFILES_TABLE],
    ["select", PROFILE_SELECT_FIELDS],
    ["eq", "id", USER_ID],
    ["maybeSingle"],
  ]);
  assert.deepEqual(repository.methods, ["readProfile"]);
  assert.equal(repository.writesEnabled, false);
  assert.equal("insertProfile" in repository, false);
  assert.equal("updateProfile" in repository, false);
});

test("missing profile row returns null for a create preview", async () => {
  const repository = createSupabaseProfileReadRepository({
    client: {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      },
    },
    readiness: profileReadReadiness(readyInput()),
  });

  assert.equal(await repository.readProfile({ userId: USER_ID }), null);
});

test("disabled and failed profile reads remain no-op operations", async () => {
  let tableCalls = 0;
  const disabled = createSupabaseProfileReadRepository({
    client: {
      from() {
        tableCalls += 1;
      },
    },
    readiness: profileReadReadiness(readyInput({ readSupport: false })),
  });
  const failed = createSupabaseProfileReadRepository({
    client: {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: null, error: { message: "RLS denied profile read" } };
                  },
                };
              },
            };
          },
        };
      },
    },
    readiness: profileReadReadiness(readyInput()),
  });

  await assert.rejects(
    disabled.readProfile({ userId: USER_ID }),
    /disabled/,
  );
  await assert.rejects(
    failed.readProfile({ userId: USER_ID }),
    /RLS denied/,
  );
  assert.equal(tableCalls, 0);
  assert.equal(disabled.readiness.dataMutated, false);
  assert.equal(failed.readiness.localSyncStatusChanged, false);
});

test("readiness and repository output omit auth and provider tokens", () => {
  const readiness = profileReadReadiness(readyInput({
    authState: authenticated({
      access_token: "must-not-escape",
      provider_token: "must-not-escape",
    }),
  }));
  const repository = createSupabaseProfileReadRepository({ readiness });

  assert.doesNotMatch(
    JSON.stringify({ readiness, repository }),
    /must-not-escape|access_token|provider_token/,
  );
});
