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
    oauthReadiness,
    pullResult: readyPullResult(),
    requestState: { status: "ready" },
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
    oauthReadiness,
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
    requestState: { status: "blocked" },
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
    requestState: { status: "blocked" },
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
