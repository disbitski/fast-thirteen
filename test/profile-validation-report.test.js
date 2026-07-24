import test from "node:test";
import assert from "node:assert/strict";
import { createProfileValidationReport } from "../src/profileValidationReport.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY_KEY = `profile:4:${USER_ID}`;

const authState = Object.freeze({
  access_token: "must-not-escape",
  status: "authenticated",
  user: Object.freeze({
    id: USER_ID,
    provider_token: "must-not-escape",
  }),
});

const profileScope = Object.freeze({
  generation: 4,
  identityKey: IDENTITY_KEY,
  status: "authenticated",
  userId: USER_ID,
});

const readiness = Object.freeze({
  canRead: true,
  message: "Profile read ready.",
  status: "ready",
});

function requestState(action, status = action === "none" ? "current" : "preview") {
  return {
    identityKey: IDENTITY_KEY,
    message: `${action} profile decision.`,
    plan: {
      action,
      counts: {
        create: action === "create" ? 1 : 0,
        invalid: 0,
        noop: action === "none" ? 1 : 0,
        update: action === "update" ? 1 : 0,
      },
      message: `${action} profile decision.`,
      status,
    },
    status,
  };
}

test("guest validation stays local-only with reads and writes gated", () => {
  const report = createProfileValidationReport({
    authState: { status: "guest", user: null },
    localData: { sessions: [{ id: "local-fast" }], sync: { status: "local" } },
    readiness: {
      canRead: false,
      message: "Supabase publishable config is missing.",
      status: "disabled",
    },
  });

  assert.equal(report.status, "local-only");
  assert.equal(report.localSessionCount, 1);
  assert.equal(report.stages.find((item) => item.key === "repositoryRead").status, "not-run");
  assert.equal(report.gates.profileWritesEnabled, false);
  assert.equal(report.gates.sessionWritesEnabled, false);
  assert.equal(report.localTrackingAvailable, true);
});

test("loading report preserves one profile-scoped read state", () => {
  const report = createProfileValidationReport({
    authState,
    profileScope,
    readiness,
    requestState: {
      identityKey: IDENTITY_KEY,
      message: "Reading profile.",
      plan: null,
      status: "loading",
    },
  });

  assert.equal(report.status, "loading");
  assert.equal(report.identityMatched, true);
  assert.equal(report.stages.find((item) => item.key === "repositoryRead").status, "loading");
  assert.equal(report.stages.find((item) => item.key === "decision").status, "loading");
});

test("create update and no-op decisions map into a validated report", () => {
  const scenarios = [
    ["create", "Create", "create"],
    ["update", "Update", "update"],
    ["none", "No write", "noop"],
  ];

  for (const [action, label, countKey] of scenarios) {
    const report = createProfileValidationReport({
      authState,
      profileScope,
      readiness,
      requestState: requestState(action),
      sessionHealth: { message: "Session healthy.", status: "healthy" },
    });

    assert.equal(report.status, "validated");
    assert.equal(report.action, label);
    assert.equal(report.counts[countKey], 1);
    assert.equal(report.stages.find((item) => item.key === "repositoryRead").status, "passed");
    assert.equal(report.stages.find((item) => item.key === "decision").status, "passed");
  }
});

test("RLS read failure blocks validation without changing Local data", () => {
  const localData = {
    sessions: [{ id: "local-fast", updatedAt: "2026-07-24T08:00:00.000Z" }],
    sync: { status: "local", updatedAt: "2026-07-24T08:00:00.000Z" },
  };
  const snapshot = structuredClone(localData);
  const report = createProfileValidationReport({
    authState,
    localData,
    profileScope,
    readiness,
    requestState: {
      identityKey: IDENTITY_KEY,
      message: "Row-level security denied the profiles read.",
      plan: null,
      reason: "profile-read-failed",
      status: "blocked",
    },
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.blockers[0].stage, "repositoryRead");
  assert.match(report.message, /Row-level security/);
  assert.equal(report.dataMutated, false);
  assert.equal(report.localSyncStatusChanged, false);
  assert.deepEqual(localData, snapshot);
});

test("stale profile lifecycle cannot appear in the current validation report", () => {
  const report = createProfileValidationReport({
    authState,
    profileScope,
    readiness,
    requestState: {
      ...requestState("update"),
      identityKey: `profile:3:${USER_ID}`,
    },
  });

  assert.equal(report.identityMatched, false);
  assert.equal(report.status, "ready");
  assert.equal(report.action, "Not run");
  assert.deepEqual(report.counts, { create: 0, invalid: 0, noop: 0, update: 0 });
});

test("refresh failure blocks profile validation and omits all token fields", () => {
  const report = createProfileValidationReport({
    authState,
    profileScope,
    readiness: { ...readiness, access_token: "must-not-escape" },
    requestState: requestState("create"),
    sessionHealth: {
      message: "The auth session could not be refreshed.",
      provider_token: "must-not-escape",
      status: "refresh-failed",
    },
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.stages.find((item) => item.key === "sessionHealth").status, "blocked");
  assert.equal(report.providerTokensExposed, false);
  assert.equal(report.providerTokensStored, false);
  assert.doesNotMatch(
    JSON.stringify(report),
    /must-not-escape|access_token|provider_token/,
  );
});
