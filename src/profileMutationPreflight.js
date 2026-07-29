export const PROFILE_MUTATION_PREFLIGHT_STATUS = Object.freeze({
  CHECKING: "checking",
  GO: "go",
  NO_GO: "no-go",
  NOOP: "no-op",
});

const PLAN_ACTIONS = new Set(["create", "none", "update"]);

function stage(key, label, message, status) {
  return Object.freeze({ key, label, message, status });
}

function lifecycleCheck(authState, profileScope, sessionHealth) {
  const authenticated = Boolean(authState?.status === "authenticated" && authState.user?.id);
  const scopeMatched = Boolean(
    authenticated
    && profileScope?.identityKey
    && profileScope.status === "authenticated"
    && profileScope.userId === authState.user.id,
  );
  const sessionStatus = sessionHealth?.status ?? "local-fallback";
  const sessionHealthy = sessionStatus === "healthy";

  if (!authenticated) {
    return {
      authenticated,
      scopeMatched,
      sessionHealthy,
      stage: stage(
        "profileMutationLifecycle",
        "Rehearsal lifecycle",
        "A healthy authenticated test lifecycle is required for mutation rehearsal.",
        "disabled",
      ),
    };
  }
  if (!scopeMatched) {
    return {
      authenticated,
      scopeMatched,
      sessionHealthy,
      stage: stage(
        "profileMutationLifecycle",
        "Rehearsal lifecycle",
        "The authenticated profile does not match the current rehearsal lifecycle.",
        "blocked",
      ),
    };
  }
  if (sessionStatus === "checking") {
    return {
      authenticated,
      scopeMatched,
      sessionHealthy,
      stage: stage(
        "profileMutationLifecycle",
        "Rehearsal lifecycle",
        "Session health is still being checked before mutation rehearsal.",
        "loading",
      ),
    };
  }
  if (!sessionHealthy) {
    return {
      authenticated,
      scopeMatched,
      sessionHealthy,
      stage: stage(
        "profileMutationLifecycle",
        "Rehearsal lifecycle",
        "The current authenticated session is not healthy enough for mutation rehearsal.",
        "blocked",
      ),
    };
  }
  return {
    authenticated,
    scopeMatched,
    sessionHealthy,
    stage: stage(
      "profileMutationLifecycle",
      "Rehearsal lifecycle",
      "Authentication, session health, and profile lifecycle belong to one test scope.",
      "passed",
    ),
  };
}

function planCheck(authState, plan, profileScope) {
  const action = PLAN_ACTIONS.has(plan?.action) ? plan.action : null;
  const scoped = Boolean(
    action
    && plan?.identityKey
    && plan.identityKey === profileScope?.identityKey
    && plan.candidate?.id
    && plan.candidate.id === profileScope?.userId
    && plan.candidate.id === authState?.user?.id,
  );

  if (!plan) {
    return {
      action,
      scoped,
      stage: stage(
        "profileMutationPlan",
        "Rehearsal plan",
        "A completed read-only profile plan is required before mutation rehearsal.",
        "not-run",
      ),
    };
  }
  if (!scoped || plan.status === "blocked" || plan.blockers?.length > 0) {
    return {
      action,
      scoped,
      stage: stage(
        "profileMutationPlan",
        "Rehearsal plan",
        "The read-only profile plan is blocked or belongs to another lifecycle.",
        "blocked",
      ),
    };
  }
  return {
    action,
    scoped,
    stage: stage(
      "profileMutationPlan",
      "Rehearsal plan",
      action === "none"
        ? "The scoped plan is a deterministic no-op with no repository call."
        : `The scoped ${action} plan is ready for mock-only rehearsal.`,
      "passed",
    ),
  };
}

function supportStage(action, repositoryReadiness, executionReadiness) {
  if (!action) {
    return stage(
      "profileMutationSupport",
      "Mock write support",
      "Write and confirmation support wait for a scoped plan.",
      "not-run",
    );
  }
  if (action === "none") {
    return stage(
      "profileMutationSupport",
      "Mock write support",
      "Skipped. Deterministic no-op rehearsal does not inspect a repository.",
      "passed",
    );
  }
  if (
    repositoryReadiness?.canWrite
    && repositoryReadiness?.canConfirm
    && executionReadiness?.canExecute
  ) {
    return stage(
      "profileMutationSupport",
      "Mock write support",
      "Injected mock write and read-back confirmation support are ready.",
      "passed",
    );
  }
  const blocked = repositoryReadiness?.status === "blocked"
    || executionReadiness?.status === "blocked";
  return stage(
    "profileMutationSupport",
    "Mock write support",
    "Write and confirmation gates are not both ready; no repository call can run.",
    blocked ? "blocked" : "disabled",
  );
}

function resultStage(action, executionResult) {
  if (!action) {
    return stage(
      "profileMutationResult",
      "Rehearsal result",
      "Mock result evaluation waits for a scoped profile plan.",
      "not-run",
    );
  }
  if (executionResult?.status === "confirmed") {
    return stage(
      "profileMutationResult",
      "Rehearsal result",
      "Mock execution passed deterministic read-back confirmation.",
      "passed",
    );
  }
  if (executionResult?.status === "no-op" && action === "none") {
    return stage(
      "profileMutationResult",
      "Rehearsal result",
      "No-op rehearsal completed without a repository call.",
      "passed",
    );
  }
  if (["loading", "executed-awaiting-confirmation"].includes(executionResult?.status)) {
    return stage(
      "profileMutationResult",
      "Rehearsal result",
      executionResult.status === "loading"
        ? "Mock execution is running with duplicate suppression active."
        : "Mock execution is waiting for deterministic read-back confirmation.",
      "loading",
    );
  }
  if (["confirmation-blocked", "failed", "invalidated", "stale"].includes(
    executionResult?.status,
  )) {
    return stage(
      "profileMutationResult",
      "Rehearsal result",
      "The mock result is blocked, failed, invalidated, or stale and cannot pass rehearsal.",
      "blocked",
    );
  }
  return stage(
    "profileMutationResult",
    "Rehearsal result",
    "No confirmed mock result is active; production remains no-go.",
    "disabled",
  );
}

function boundaryStage() {
  return stage(
    "profileMutationBoundary",
    "Write boundary",
    "The rehearsal target is profiles only; fast_sessions mutations remain disabled.",
    "passed",
  );
}

function productionStage(mockScenario) {
  return stage(
    "profileMutationProduction",
    "Production blocker",
    mockScenario
      ? "Mock-only rehearsal has no production controller, repository, or write wiring."
      : "The browser app does not construct a profile write repository or execution controller.",
    mockScenario ? "passed" : "disabled",
  );
}

function preflightStatus(stages, action, mockScenario) {
  if (stages.some((item) => item.status === "loading")) {
    return PROFILE_MUTATION_PREFLIGHT_STATUS.CHECKING;
  }
  if (action === "none" && stages.every((item) => ["passed", "disabled"].includes(item.status))) {
    return PROFILE_MUTATION_PREFLIGHT_STATUS.NOOP;
  }
  if (mockScenario && stages.every((item) => item.status === "passed")) {
    return PROFILE_MUTATION_PREFLIGHT_STATUS.GO;
  }
  return PROFILE_MUTATION_PREFLIGHT_STATUS.NO_GO;
}

function statusMessage(status, stages) {
  if (status === PROFILE_MUTATION_PREFLIGHT_STATUS.GO) {
    return "Mock-only profile mutation rehearsal passed every gate; production remains disabled.";
  }
  if (status === PROFILE_MUTATION_PREFLIGHT_STATUS.NOOP) {
    return "The profile plan is already current; rehearsal confirms that no write is needed.";
  }
  if (status === PROFILE_MUTATION_PREFLIGHT_STATUS.CHECKING) {
    return "Profile mutation rehearsal is waiting for a current session or mock result.";
  }
  return stages.find((item) => ["blocked", "disabled", "not-run"].includes(item.status))
    ?.message ?? "Profile mutation rehearsal remains no-go.";
}

export function createProfileMutationPreflightModel({
  authState = null,
  executionReadiness = null,
  executionResult = null,
  localData = null,
  mockScenario = false,
  plan = null,
  profileScope = null,
  repositoryReadiness = null,
  sessionHealth = null,
} = {}) {
  const lifecycle = lifecycleCheck(authState, profileScope, sessionHealth);
  const planState = planCheck(authState, plan, profileScope);
  const stages = Object.freeze([
    lifecycle.stage,
    planState.stage,
    boundaryStage(),
    supportStage(planState.action, repositoryReadiness, executionReadiness),
    resultStage(planState.action, executionResult),
    productionStage(mockScenario),
  ]);
  const status = preflightStatus(stages, planState.action, mockScenario);
  const blockers = Object.freeze(stages
    .filter((item) => item.status === "blocked")
    .map((item) => Object.freeze({
      code: `${item.key}-blocked`,
      message: item.message,
      stage: item.key,
    })));

  return Object.freeze({
    action: planState.action ?? "none",
    blockers,
    checks: Object.freeze({
      confirmationSupportReady: repositoryReadiness?.canConfirm === true,
      duplicateSuppressed: executionResult?.deduplicated === true,
      fastSessionsWritesDisabled: true,
      lifecycleIsolated: lifecycle.scopeMatched,
      localDataSafe: true,
      mockResultConfirmed: executionResult?.confirmed === true,
      mockScenario: mockScenario === true,
      planScoped: planState.scoped,
      productionWiringEnabled: false,
      sessionHealthy: lifecycle.sessionHealthy,
      writeSupportReady: repositoryReadiness?.canWrite === true,
      writeTargetProfilesOnly: true,
    }),
    dataMutated: false,
    fastSessionsWritesEnabled: false,
    go: status === PROFILE_MUTATION_PREFLIGHT_STATUS.GO,
    localDataUnchanged: true,
    localSessionCount: Array.isArray(localData?.sessions) ? localData.sessions.length : 0,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    message: statusMessage(status, stages),
    productionWiringEnabled: false,
    profileWritesEnabled: false,
    providerTokensExposed: false,
    providerTokensStored: false,
    remainingProductionBlocker: "Production controller and repository wiring are intentionally absent.",
    safety: "Mock-only rehearsal · profiles target only · fast_sessions disabled · Local data unchanged · Tokens omitted",
    stages,
    status,
    writeTarget: "profiles",
  });
}
