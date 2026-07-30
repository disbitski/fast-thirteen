import test from "node:test";
import assert from "node:assert/strict";
import { createProfileExecutionReadiness } from "../src/profileExecutor.js";
import { createProfileProvisioningPlan } from "../src/profileProvisioning.js";
import {
  PROFILE_WRITE_ACTIVATION_STATUS,
  PROFILE_WRITE_CONFIRMATION_PHRASE,
  createProfileWriteActivationPolicy,
} from "../src/profileWriteActivationPolicy.js";
import { supabaseProfileWriteRepositoryReadiness } from "../src/supabaseProfileWriteRepository.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY_KEY = `profile:9:${USER_ID}`;

function authenticated() {
  return {
    access_token: "must-not-escape",
    status: "authenticated",
    user: {
      app_metadata: { provider: "google" },
      email: "dave@example.com",
      id: USER_ID,
      provider_token: "must-not-escape",
      updated_at: "2026-07-30T10:00:00.000Z",
      user_metadata: { full_name: "Dave Isbitski" },
    },
  };
}

function scope(overrides = {}) {
  return {
    generation: 9,
    identityKey: IDENTITY_KEY,
    status: "authenticated",
    userId: USER_ID,
    ...overrides,
  };
}

function remoteProfile(authState, overrides = {}) {
  return {
    display_name: authState.user.user_metadata.full_name,
    email: authState.user.email,
    id: authState.user.id,
    provider: "google",
    updated_at: "2026-07-30T09:00:00.000Z",
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

function support(plan, authState = authenticated(), profileScope = scope()) {
  const repositoryReadiness = supabaseProfileWriteRepositoryReadiness({
    authState,
    client: { from() {} },
    config: {
      isConfigured: true,
      profileConfirmationsEnabled: true,
      profileWritesEnabled: true,
    },
    executeConfirmations: true,
    executeWrites: true,
    profileScope,
  });
  const executionReadiness = createProfileExecutionReadiness({
    authState,
    confirmationSupport: repositoryReadiness.canConfirm,
    plan,
    profileScope,
    writeSupport: repositoryReadiness.canWrite,
  });
  return { executionReadiness, repositoryReadiness };
}

function readyInput(action = "create", overrides = {}) {
  const authState = overrides.authState ?? authenticated();
  const profileScope = overrides.profileScope ?? scope();
  const plan = overrides.plan ?? planFor(action);
  const readiness = support(plan, authState, profileScope);
  const origin = overrides.origin ?? "http://127.0.0.1:4174";

  return {
    activationEnabled: true,
    allowedOrigins: overrides.allowedOrigins ?? [origin],
    authState,
    backupReadiness: overrides.backupReadiness ?? {
      marker: "local-backup-preserved",
      offlineCopyAvailable: true,
      preserved: true,
    },
    challenge: Object.hasOwn(overrides, "challenge")
      ? overrides.challenge
      : {
          consumed: false,
          identityKey: profileScope.identityKey,
          nonce: "challenge-20260730",
          response: PROFILE_WRITE_CONFIRMATION_PHRASE,
          singleUse: true,
        },
    executionReadiness: overrides.executionReadiness ?? readiness.executionReadiness,
    fastSessionsWritesEnabled: overrides.fastSessionsWritesEnabled ?? false,
    localData: overrides.localData ?? {
      sessions: [{ id: "local-fast" }],
      sync: { status: "local" },
    },
    location: { href: `${origin}/index.html` },
    operatorTestMode: overrides.operatorTestMode ?? true,
    plan,
    profileScope,
    readEvidence: overrides.readEvidence ?? {
      identityKey: profileScope.identityKey,
      ownershipVerified: true,
      status: "passed",
      table: "profiles",
    },
    repositoryReadiness: overrides.repositoryReadiness ?? readiness.repositoryReadiness,
    sessionHealth: overrides.sessionHealth ?? { status: "healthy" },
    target: overrides.target ?? "profiles",
  };
}

test("an injected throwaway profile policy can report ready without enabling writes", () => {
  for (const action of ["create", "update"]) {
    const model = createProfileWriteActivationPolicy(readyInput(action));

    assert.equal(model.status, PROFILE_WRITE_ACTIVATION_STATUS.READY);
    assert.equal(model.activationReady, true);
    assert.equal(model.action, action);
    assert.equal(model.writeTarget, "profiles");
    assert.equal(model.profileWritesEnabled, false);
    assert.equal(model.fastSessionsWritesEnabled, false);
    assert.equal(model.productionWiringEnabled, false);
    assert.equal(model.stages.every((item) => item.status === "passed"), true);
  }
});

test("the shipped default-off policy ignores public flags and remains local-safe", () => {
  const input = readyInput("create");
  const model = createProfileWriteActivationPolicy({
    ...input,
    activationEnabled: false,
    operatorTestMode: false,
  });

  assert.equal(model.status, PROFILE_WRITE_ACTIVATION_STATUS.DISABLED);
  assert.equal(model.activationReady, false);
  assert.equal(model.checks.supportReady, false);
  assert.equal(
    model.stages.find((item) => item.key === "profileActivationSwitch").status,
    "disabled",
  );
  assert.equal(
    model.stages.find((item) => item.key === "profileActivationProduction").status,
    "disabled",
  );
  assert.equal(model.localDataUnchanged, true);
});

test("GitHub Pages and public origins can never pass the private-origin policy", () => {
  for (const origin of [
    "https://disbitski.github.io",
    "https://fast-thirteen.example.com",
  ]) {
    const model = createProfileWriteActivationPolicy(readyInput("create", {
      allowedOrigins: [origin],
      origin,
    }));

    assert.equal(model.status, PROFILE_WRITE_ACTIVATION_STATUS.BLOCKED);
    assert.equal(model.activationReady, false);
    assert.equal(model.checks.originAllowed, false);
    assert.equal(model.checks.originPrivate, false);
    assert.equal(
      model.blockers.some((item) => item.stage === "profileActivationOrigin"),
      true,
    );
  }
});

test("explicitly allowed localhost and private LAN origins pass origin readiness", () => {
  for (const origin of [
    "http://127.0.0.1:4174",
    "http://192.168.86.50:4173",
    "https://fast-thirteen.local",
  ]) {
    const model = createProfileWriteActivationPolicy(readyInput("create", {
      allowedOrigins: [origin],
      origin,
    }));

    assert.equal(model.status, PROFILE_WRITE_ACTIVATION_STATUS.READY);
    assert.equal(model.checks.originAllowed, true);
    assert.equal(model.checks.originPrivate, true);
  }
});

test("changed users expired sessions and stale read evidence block activation", () => {
  const lifecycleMismatch = createProfileWriteActivationPolicy(readyInput("create", {
    profileScope: scope({ userId: "22222222-2222-4222-8222-222222222222" }),
  }));
  const expired = createProfileWriteActivationPolicy(readyInput("create", {
    sessionHealth: { status: "expired" },
  }));
  const staleRead = createProfileWriteActivationPolicy(readyInput("create", {
    readEvidence: {
      identityKey: `profile:8:${USER_ID}`,
      ownershipVerified: true,
      status: "passed",
      table: "profiles",
    },
  }));

  assert.equal(lifecycleMismatch.status, PROFILE_WRITE_ACTIVATION_STATUS.BLOCKED);
  assert.equal(expired.status, PROFILE_WRITE_ACTIVATION_STATUS.BLOCKED);
  assert.equal(staleRead.status, PROFILE_WRITE_ACTIVATION_STATUS.BLOCKED);
  assert.equal(lifecycleMismatch.checks.lifecycleIsolated, false);
  assert.equal(expired.checks.lifecycleIsolated, true);
  assert.equal(staleRead.checks.readOwnershipVerified, false);
});

test("RLS blockers missing backups and fast_sessions targets fail closed", () => {
  const rlsBlocked = createProfileWriteActivationPolicy(readyInput("create", {
    readEvidence: {
      identityKey: IDENTITY_KEY,
      ownershipVerified: false,
      status: "blocked",
      table: "profiles",
    },
  }));
  const missingBackup = createProfileWriteActivationPolicy(readyInput("create", {
    backupReadiness: {
      marker: null,
      offlineCopyAvailable: true,
      preserved: false,
    },
  }));
  const sessionsTarget = createProfileWriteActivationPolicy(readyInput("create", {
    fastSessionsWritesEnabled: true,
    target: "fast_sessions",
  }));

  assert.equal(rlsBlocked.status, PROFILE_WRITE_ACTIVATION_STATUS.BLOCKED);
  assert.equal(missingBackup.status, PROFILE_WRITE_ACTIVATION_STATUS.BLOCKED);
  assert.equal(sessionsTarget.status, PROFILE_WRITE_ACTIVATION_STATUS.BLOCKED);
  assert.equal(rlsBlocked.checks.readOwnershipVerified, false);
  assert.equal(missingBackup.checks.backupReady, false);
  assert.equal(sessionsTarget.checks.fastSessionsWritesDisabled, false);
  assert.equal(sessionsTarget.checks.targetProfilesOnly, false);
});

test("single-use confirmations reject missing mismatched and consumed challenges", () => {
  const missing = createProfileWriteActivationPolicy(readyInput("create", {
    challenge: null,
  }));
  const mismatched = createProfileWriteActivationPolicy(readyInput("create", {
    challenge: {
      consumed: false,
      identityKey: IDENTITY_KEY,
      nonce: "challenge-20260730",
      response: "ENABLE SOMETHING ELSE",
      singleUse: true,
    },
  }));
  const firstUse = createProfileWriteActivationPolicy(readyInput("create"));
  const reused = createProfileWriteActivationPolicy(readyInput("create", {
    challenge: {
      consumed: true,
      identityKey: IDENTITY_KEY,
      nonce: "challenge-20260730",
      response: PROFILE_WRITE_CONFIRMATION_PHRASE,
      singleUse: true,
    },
  }));

  assert.equal(missing.status, PROFILE_WRITE_ACTIVATION_STATUS.BLOCKED);
  assert.equal(mismatched.status, PROFILE_WRITE_ACTIVATION_STATUS.BLOCKED);
  assert.equal(firstUse.status, PROFILE_WRITE_ACTIVATION_STATUS.READY);
  assert.equal(reused.status, PROFILE_WRITE_ACTIVATION_STATUS.BLOCKED);
  assert.match(
    reused.stages.find((item) => item.key === "profileActivationChallenge").message,
    /already consumed/,
  );
});

test("deterministic no-op plans need no write support or confirmation", () => {
  const plan = planFor("none");
  const model = createProfileWriteActivationPolicy(readyInput("none", {
    challenge: null,
    executionReadiness: null,
    plan,
    repositoryReadiness: null,
  }));

  assert.equal(model.status, PROFILE_WRITE_ACTIVATION_STATUS.NOOP);
  assert.equal(model.activationReady, false);
  assert.equal(model.checks.supportReady, true);
  assert.equal(model.checks.challengeReady, true);
  assert.equal(model.profileRowWritten, false);
});

test("policy output omits identity tokens and preserves Local fasting data", () => {
  const localData = {
    sessions: [{ id: "local-fast" }],
    sync: { status: "local", updatedAt: "2026-07-30T08:00:00.000Z" },
  };
  const snapshot = structuredClone(localData);
  const model = createProfileWriteActivationPolicy(readyInput("create", { localData }));

  assert.doesNotMatch(
    JSON.stringify(model),
    new RegExp(`${USER_ID}|${IDENTITY_KEY}|must-not-escape|access_token|provider_token|dave@example.com|challenge-20260730`),
  );
  assert.equal(model.providerTokensExposed, false);
  assert.equal(model.providerTokensStored, false);
  assert.equal(model.dataMutated, false);
  assert.equal(model.localSyncStatusChanged, false);
  assert.deepEqual(localData, snapshot);
});
