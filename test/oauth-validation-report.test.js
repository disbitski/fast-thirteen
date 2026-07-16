import test from "node:test";
import assert from "node:assert/strict";
import { createOAuthReadValidationReport } from "../src/oauthValidationReport.js";

const oauthReadiness = Object.freeze({
  stages: Object.freeze({
    sdk: { message: "SDK ready.", status: "ready" },
    provider: { message: "Provider enabled.", status: "ready" },
    redirect: { message: "Redirect allowed.", status: "ready" },
  }),
});

const authenticated = Object.freeze({
  session: Object.freeze({ provider_token: "never-report-this" }),
  status: "authenticated",
  user: Object.freeze({ id: "test-user" }),
});

const profileScope = Object.freeze({
  generation: 1,
  identityKey: "profile:1:test-user",
});

function readyPullResult() {
  return {
    diagnostics: {
      stages: {
        mergePlan: { status: "ready" },
        repositoryRead: { status: "passed" },
      },
    },
    plan: {
      invalidRows: [],
      status: "ready",
      summary: {
        duplicateCount: 2,
        localSessions: 8,
        remoteSessions: 7,
      },
    },
  };
}

test("authenticated read success creates one local-safe validation report", () => {
  const localData = {
    sessions: [{ id: "local-fast", updatedAt: "2026-07-15T08:00:00.000Z" }],
    sync: { status: "local" },
  };
  const snapshot = structuredClone(localData);
  const report = createOAuthReadValidationReport({
    authState: authenticated,
    launchState: { status: "authenticated" },
    localData,
    oauthReadiness,
    profileScope,
    pullResult: readyPullResult(),
    requestState: { identityKey: profileScope.identityKey, status: "ready" },
  });

  assert.equal(report.status, "ready");
  assert.equal(report.summary.localSessionCount, 8);
  assert.equal(report.summary.remoteSessionCount, 7);
  assert.equal(report.summary.duplicateCount, 2);
  assert.equal(report.summary.invalidRowCount, 0);
  assert.equal(report.gates.localApplyEnabled, false);
  assert.equal(report.gates.cloudWritesEnabled, false);
  assert.equal(report.dataMutated, false);
  assert.equal(report.localSyncStatusChanged, false);
  assert.deepEqual(localData, snapshot);
});

test("RLS or repository failure blocks the report without changing local state", () => {
  const localData = { sessions: [{ id: "local-fast" }], sync: { status: "local" } };
  const snapshot = structuredClone(localData);
  const report = createOAuthReadValidationReport({
    authState: authenticated,
    localData,
    oauthReadiness,
    profileScope,
    pullResult: {
      diagnostics: {
        stages: {
          mergePlan: { message: "Merge planning did not run.", status: "not-run" },
          repositoryRead: {
            message: "Row-level security denied this read.",
            status: "blocked",
          },
        },
      },
      plan: { invalidRows: [], summary: { localSessions: 1, remoteSessions: 0 } },
    },
    requestState: { identityKey: profileScope.identityKey, status: "blocked" },
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.blockers[0].stage, "repositoryRead");
  assert.match(report.message, /Row-level security/);
  assert.equal(report.localDataUnchanged, true);
  assert.deepEqual(localData, snapshot);
});

test("invalid rows block merge validation and provider tokens are omitted", () => {
  const report = createOAuthReadValidationReport({
    authState: authenticated,
    oauthReadiness,
    profileScope,
    pullResult: {
      diagnostics: {
        stages: {
          mergePlan: { message: "Remote rows need review.", status: "blocked" },
          repositoryRead: { status: "passed" },
        },
      },
      plan: {
        invalidRows: [{ id: "bad-row", reason: "timestamp-invalid" }],
        summary: { localSessions: 4, remoteSessions: 0 },
      },
    },
    requestState: { identityKey: profileScope.identityKey, status: "blocked" },
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.summary.invalidRowCount, 1);
  assert.equal(report.providerTokensStored, false);
  assert.equal(report.providerTokensExposed, false);
  assert.doesNotMatch(JSON.stringify(report), /never-report-this|provider_token/);
});

test("guest report keeps auth read apply and write paths gated", () => {
  const report = createOAuthReadValidationReport({
    authState: { status: "guest", user: null },
    launchState: { status: "idle" },
    oauthReadiness: {
      stages: {
        sdk: { message: "Missing config.", status: "disabled" },
        provider: { message: "Provider disabled.", status: "disabled" },
        redirect: { message: "Redirect blocked.", status: "blocked" },
      },
    },
  });

  assert.equal(report.status, "local-only");
  assert.equal(report.localTrackingAvailable, true);
  assert.equal(report.stages.find((item) => item.key === "repositoryRead").status, "not-run");
  assert.equal(report.stages.find((item) => item.key === "localApply").status, "disabled");
  assert.equal(report.stages.find((item) => item.key === "cloudWrites").status, "disabled");
});

test("a new profile cannot see the previous profile's rows or counts", () => {
  const report = createOAuthReadValidationReport({
    authState: {
      status: "authenticated",
      user: { id: "user-b" },
    },
    localData: {
      sessions: [{ id: "local-1" }, { id: "local-2" }],
    },
    oauthReadiness,
    profileScope: {
      generation: 2,
      identityKey: "profile:2:user-b",
    },
    pullResult: readyPullResult(),
    requestState: {
      identityKey: "profile:1:user-a",
      status: "ready",
    },
  });

  assert.equal(report.status, "authenticated");
  assert.equal(report.identityMatched, false);
  assert.equal(report.summary.localSessionCount, 2);
  assert.equal(report.summary.remoteSessionCount, 0);
  assert.equal(report.summary.duplicateCount, 0);
  assert.equal(report.stages.find((item) => item.key === "repositoryRead").status, "not-run");
});

test("a new lifecycle cannot reuse an old report from the same profile", () => {
  const report = createOAuthReadValidationReport({
    authState: {
      status: "authenticated",
      user: { id: "user-a" },
    },
    localData: {
      sessions: [{ id: "local-1" }],
    },
    oauthReadiness,
    profileScope: {
      generation: 3,
      identityKey: "profile:3:user-a",
    },
    pullResult: readyPullResult(),
    requestState: {
      identityKey: "profile:1:user-a",
      status: "ready",
    },
  });

  assert.equal(report.identityMatched, false);
  assert.equal(report.summary.localSessionCount, 1);
  assert.equal(report.summary.remoteSessionCount, 0);
  assert.equal(report.stages.find((item) => item.key === "repositoryRead").status, "not-run");
});

test("sign-out resets validation counts while preserving local history", () => {
  const localData = {
    sessions: [{ id: "local-1" }, { id: "local-2" }, { id: "local-3" }],
    sync: { status: "local" },
  };
  const snapshot = structuredClone(localData);
  const report = createOAuthReadValidationReport({
    authState: { status: "signed-out", user: null },
    localData,
    oauthReadiness,
    profileScope: {
      generation: 2,
      identityKey: null,
    },
    pullResult: readyPullResult(),
    requestState: {
      identityKey: "profile:1:user-a",
      status: "ready",
    },
  });

  assert.equal(report.identityMatched, false);
  assert.equal(report.summary.localSessionCount, 3);
  assert.equal(report.summary.remoteSessionCount, 0);
  assert.equal(report.profileScoped, false);
  assert.deepEqual(localData, snapshot);
});
