function stage(key, label, message, status) {
  return Object.freeze({ key, label, message, status });
}

function authStage(authState) {
  if (authState?.status === "authenticated" && authState.user?.id) {
    return stage(
      "authentication",
      "Authentication",
      "A token-free authenticated test profile is available for validation.",
      "passed",
    );
  }
  return stage(
    "authentication",
    "Authentication",
    "Sign in with a configured throwaway profile before reading its cloud profile row.",
    "disabled",
  );
}

function sessionStage(sessionHealth, authenticated) {
  if (!sessionHealth) {
    return authenticated
      ? stage(
          "sessionHealth",
          "Session health",
          "The authenticated session is available for this profile-scoped read.",
          "passed",
        )
      : stage(
          "sessionHealth",
          "Session health",
          "No authenticated session is active. Local tracking remains available.",
          "disabled",
        );
  }

  const statuses = {
    checking: "loading",
    expired: "blocked",
    healthy: "passed",
    "local-fallback": "disabled",
    "refresh-failed": "blocked",
    "signed-out": "disabled",
  };
  return stage(
    "sessionHealth",
    "Session health",
    sessionHealth.message,
    statuses[sessionHealth.status] ?? "waiting",
  );
}

function readinessStage(readiness) {
  const statuses = {
    blocked: "blocked",
    disabled: "disabled",
    ready: "passed",
  };
  return stage(
    "profileReadiness",
    "Profile readiness",
    readiness?.message ?? "Cloud profile read readiness is unavailable.",
    readiness?.canRead ? "passed" : statuses[readiness?.status] ?? "disabled",
  );
}

function repositoryStage({ authenticated, readiness, requestState }) {
  if (!authenticated || !readiness?.canRead) {
    return stage(
      "repositoryRead",
      "RLS / read",
      "The profiles query has not run. Guest mode and Local data remain available.",
      "not-run",
    );
  }
  if (!requestState) {
    return stage(
      "repositoryRead",
      "RLS / read",
      "Use Check cloud profile to validate this profile's read-only RLS path.",
      "waiting",
    );
  }
  if (requestState.status === "loading") {
    return stage(
      "repositoryRead",
      "RLS / read",
      "Reading only the current authenticated profile's profiles row.",
      "loading",
    );
  }
  if (requestState.status === "blocked" && !requestState.plan) {
    return stage(
      "repositoryRead",
      "RLS / read",
      requestState.message ?? "The profile read or RLS policy blocked validation.",
      "blocked",
    );
  }
  if (requestState.plan) {
    return stage(
      "repositoryRead",
      "RLS / read",
      "The read-only profiles query completed for this isolated auth lifecycle.",
      "passed",
    );
  }
  return stage(
    "repositoryRead",
    "RLS / read",
    "The profile read has not completed for this auth lifecycle.",
    "waiting",
  );
}

function decisionStage(requestState) {
  const plan = requestState?.plan;
  if (!plan) {
    return stage(
      "decision",
      "Provisioning decision",
      "Create, update, or no-op planning waits for a successful profile read.",
      requestState?.status === "loading" ? "loading" : "not-run",
    );
  }
  if (plan.status === "blocked") {
    return stage(
      "decision",
      "Provisioning decision",
      plan.message,
      "blocked",
    );
  }
  if (plan.action === "create") {
    return stage(
      "decision",
      "Provisioning decision",
      "Create preview: one missing profiles row was identified, but no write can run.",
      "passed",
    );
  }
  if (plan.action === "update") {
    return stage(
      "decision",
      "Provisioning decision",
      "Update preview: newer token-free metadata was identified, but no write can run.",
      "passed",
    );
  }
  return stage(
    "decision",
    "Provisioning decision",
    "No-op: the cloud row is current or wins the deterministic timestamp comparison.",
    "passed",
  );
}

function executionStage(executionReadiness, requestState) {
  if (!requestState?.plan) {
    return stage(
      "profileExecution",
      "Write / confirm",
      "Mock execution waits for a successful profile read and provisioning decision.",
      "not-run",
    );
  }
  if (executionReadiness?.canSkip) {
    return stage(
      "profileExecution",
      "Write / confirm",
      "No-op plan: no profile write or read-back confirmation is needed.",
      "passed",
    );
  }
  if (executionReadiness?.canExecute) {
    return stage(
      "profileExecution",
      "Write / confirm",
      "Explicit mocked write and read-back confirmation support is ready.",
      "passed",
    );
  }
  if (executionReadiness?.status === "blocked") {
    return stage(
      "profileExecution",
      "Write / confirm",
      executionReadiness.message,
      "blocked",
    );
  }
  return stage(
    "profileExecution",
    "Write / confirm",
    executionReadiness?.message
      ?? "Profile write and read-back confirmation support remain disabled.",
    "disabled",
  );
}

function actionLabel(plan) {
  if (plan?.action === "create") return "Create";
  if (plan?.action === "update") return "Update";
  if (plan?.status === "current") return "No write";
  return "Not run";
}

export function createProfileValidationReport({
  authState = null,
  executionReadiness = null,
  localData = null,
  profileScope = null,
  readiness = null,
  requestState = null,
  sessionHealth = null,
} = {}) {
  const authenticated = Boolean(authState?.status === "authenticated" && authState.user?.id);
  const identityMatched = Boolean(
    authenticated
    && profileScope?.identityKey
    && requestState?.identityKey === profileScope.identityKey,
  );
  const scopedRequest = identityMatched ? requestState : null;
  const plan = scopedRequest?.plan ?? null;
  const stages = Object.freeze([
    authStage(authState),
    sessionStage(sessionHealth, authenticated),
    readinessStage(readiness),
    repositoryStage({ authenticated, readiness, requestState: scopedRequest }),
    decisionStage(scopedRequest),
    executionStage(executionReadiness, scopedRequest),
    stage(
      "localSafety",
      "Local safety",
      "Local fasting history, backups, and sync metadata remain unchanged by validation.",
      "passed",
    ),
    stage(
      "cloudWrites",
      "Cloud writes",
      "Disabled. Neither profiles nor fast_sessions can be inserted, updated, or deleted.",
      "disabled",
    ),
  ]);
  const blockers = Object.freeze(stages
    .filter((item) => item.status === "blocked")
    .map((item) => Object.freeze({
      code: `${item.key}-blocked`,
      message: item.message,
      stage: item.key,
    })));
  const loading = stages.some((item) => item.status === "loading");
  const validated = stages
    .filter((item) => ["repositoryRead", "decision"].includes(item.key))
    .every((item) => item.status === "passed");

  let status = "ready";
  let title = "Cloud profile ready to validate";
  let message = "Check the current profile row to validate RLS and provisioning planning.";
  if (!authenticated || !readiness?.canRead) {
    status = blockers.length > 0 ? "blocked" : "local-only";
    title = status === "blocked" ? "Cloud profile validation blocked" : "Local-safe profile validation";
    message = blockers[0]?.message ?? readiness?.message
      ?? "Guest mode and Local data remain available while cloud validation is disabled.";
  } else if (loading) {
    status = "loading";
    title = "Cloud profile validation running";
    message = "The current profile row is being read without changing Local data.";
  } else if (blockers.length > 0) {
    status = "blocked";
    title = "Cloud profile validation blocked";
    message = blockers[0].message;
  } else if (validated) {
    status = "validated";
    title = "Cloud profile validation passed";
    message = "Authentication, RLS read, and deterministic provisioning planning passed with writes disabled.";
  }

  const counts = plan?.counts ?? { create: 0, invalid: 0, noop: 0, update: 0 };
  return Object.freeze({
    action: actionLabel(plan),
    blockers,
    counts,
    dataMutated: false,
    gates: Object.freeze({
      localApplyEnabled: false,
      mockProfileExecutionReady: executionReadiness?.canExecute === true,
      profileWritesEnabled: false,
      sessionWritesEnabled: false,
    }),
    identityMatched,
    localDataUnchanged: true,
    localSessionCount: Array.isArray(localData?.sessions) ? localData.sessions.length : 0,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    message,
    profileRowWritten: false,
    providerTokensExposed: false,
    providerTokensStored: false,
    safety: "Profile-scoped read · Mock execution gated · Local data unchanged · Tokens omitted · Live writes disabled",
    stages,
    status,
    title,
  });
}
