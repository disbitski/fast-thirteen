function stage(key, label, message, status) {
  return Object.freeze({ key, label, message, status });
}

function zeroCounts() {
  return Object.freeze({ create: 0, invalid: 0, noop: 0, update: 0 });
}

function planLabel(plan) {
  if (plan?.action === "create") return "Create";
  if (plan?.action === "update") return "Update";
  if (plan?.action === "none") return "No write";
  return "Not run";
}

function lifecycleState(authState, profileScope, provisioningState) {
  const authenticated = authState?.status === "authenticated" && Boolean(authState.user?.id);
  const scopeMatches = Boolean(
    authenticated
    && profileScope?.identityKey
    && profileScope.status === "authenticated"
    && profileScope.userId === authState.user.id,
  );
  const stateIdentity = provisioningState?.identityKey ?? null;
  const identityMatched = Boolean(
    scopeMatches
    && stateIdentity
    && stateIdentity === profileScope.identityKey,
  );
  const staleStateReset = Boolean(stateIdentity && !identityMatched);

  return {
    authenticated,
    identityMatched,
    scopeMatches,
    staleStateReset,
  };
}

function lifecycleStage(lifecycle) {
  if (!lifecycle.authenticated) {
    return stage(
      "profileLifecycle",
      "Lifecycle isolation",
      "Sign in with a configured test profile before profile execution can be evaluated.",
      "disabled",
    );
  }
  if (!lifecycle.scopeMatches) {
    return stage(
      "profileLifecycle",
      "Lifecycle isolation",
      "The authenticated profile and current lifecycle do not match.",
      "blocked",
    );
  }
  if (lifecycle.staleStateReset) {
    return stage(
      "profileLifecycle",
      "Lifecycle isolation",
      "Previous profile-scoped planning state was reset before rendering this lifecycle.",
      "disabled",
    );
  }
  return stage(
    "profileLifecycle",
    "Lifecycle isolation",
    "Readiness belongs only to the current authenticated profile lifecycle.",
    "passed",
  );
}

function planStage(plan, scopedState, lifecycle) {
  if (scopedState?.status === "loading") {
    return stage(
      "decision",
      "Provisioning plan",
      "The read-only profile lookup is still building a deterministic plan.",
      "loading",
    );
  }
  if (!plan) {
    return stage(
      "decision",
      "Provisioning plan",
      lifecycle.staleStateReset
        ? "A stale plan was discarded; refresh the current profile before evaluating execution."
        : "Create, update, or no-op execution waits for a successful read-only profile plan.",
      "not-run",
    );
  }
  if (plan.status === "blocked" || plan.blockers?.length > 0) {
    return stage(
      "decision",
      "Provisioning plan",
      plan.message ?? "The profile provisioning plan is blocked.",
      "blocked",
    );
  }
  if (plan.action === "create") {
    return stage(
      "decision",
      "Provisioning plan",
      "Create plan ready: one missing profiles row was identified by a read-only lookup.",
      "passed",
    );
  }
  if (plan.action === "update") {
    return stage(
      "decision",
      "Provisioning plan",
      "Update plan ready: newer token-free profile metadata was identified.",
      "passed",
    );
  }
  return stage(
    "decision",
    "Provisioning plan",
    "No-op plan: the cloud profile row already wins the deterministic comparison.",
    "passed",
  );
}

function writeAdapterStage(plan, repositoryReadiness) {
  if (!plan) {
    return stage(
      "profileWriteAdapter",
      "Write adapter",
      "The default-off write adapter is not evaluated until a current plan exists.",
      "not-run",
    );
  }
  if (plan.action === "none") {
    return stage(
      "profileWriteAdapter",
      "Write adapter",
      "Skipped. A deterministic no-op never constructs or calls a write repository.",
      "passed",
    );
  }
  if (repositoryReadiness?.canWrite) {
    return stage(
      "profileWriteAdapter",
      "Write adapter",
      "Test-only adapter readiness passed, but production wiring remains disabled.",
      "passed",
    );
  }
  let message = repositoryReadiness?.message ?? "Profile write adapter readiness is disabled.";
  if (repositoryReadiness?.gates?.writeConfigured !== true) {
    message = "The browser-publishable profile write flag remains off.";
  } else if (repositoryReadiness?.gates?.writeExecutionEnabled !== true) {
    message = "The profile write flag is present, but code-level execution remains hard-off.";
  }
  return stage(
    "profileWriteAdapter",
    "Write adapter",
    message,
    repositoryReadiness?.status === "blocked" ? "blocked" : "disabled",
  );
}

function confirmationStage(plan, repositoryReadiness, executionReadiness) {
  if (!plan) {
    return stage(
      "profileConfirmation",
      "Read-back confirmation",
      "Confirmation waits for a current create or update plan.",
      "not-run",
    );
  }
  if (plan.action === "none") {
    return stage(
      "profileConfirmation",
      "Read-back confirmation",
      "Skipped. No-op plans have no cloud mutation to confirm.",
      "passed",
    );
  }
  if (repositoryReadiness?.canConfirm && executionReadiness?.canExecute) {
    return stage(
      "profileConfirmation",
      "Read-back confirmation",
      "Test-only read-back confirmation gates are ready; production execution remains off.",
      "passed",
    );
  }
  let message = executionReadiness?.message
    ?? repositoryReadiness?.message
    ?? "Profile read-back confirmation is disabled.";
  if (repositoryReadiness?.gates?.confirmationConfigured !== true) {
    message = "The browser-publishable profile confirmation flag remains off.";
  } else if (repositoryReadiness?.gates?.confirmationExecutionEnabled !== true) {
    message = "The profile confirmation flag is present, but code-level confirmation remains hard-off.";
  }
  const blocked = repositoryReadiness?.status === "blocked"
    || executionReadiness?.status === "blocked";
  return stage(
    "profileConfirmation",
    "Read-back confirmation",
    message,
    blocked ? "blocked" : "disabled",
  );
}

function executionResultStage(result) {
  return stage(
    "profileExecutionResult",
    "Mock execution result",
    result?.message
      ?? "No mock execution result is active; production profile writes remain disabled.",
    result?.status ?? "disabled",
  );
}

function orchestrationStatus({ blockers, executionResult, loading, plan, testReady }) {
  if (blockers.length > 0) return "blocked";
  if (executionResult?.status === "confirmed") return "confirmed";
  if (executionResult?.status === "no-op") return "no-op";
  if (["loading", "executed-awaiting-confirmation"].includes(executionResult?.status)) {
    return "loading";
  }
  if (loading) return "loading";
  if (plan?.action === "none") return "no-op";
  if (testReady) return "test-ready";
  if (plan) return "preview";
  return "local-only";
}

function actionModel(status, plan, lifecycle, executionResult) {
  if (lifecycle.staleStateReset || (lifecycle.authenticated && !lifecycle.scopeMatches)) {
    return Object.freeze({
      disabled: true,
      label: "Refresh current profile",
      message: "Previous profile-scoped readiness was reset before it could appear here.",
      status: "disabled",
    });
  }
  if (executionResult?.status === "confirmed") {
    return Object.freeze({
      disabled: true,
      label: "Mock confirmation passed",
      message: "The sanitized mock result is confirmed; production profile writes remain disabled.",
      status,
    });
  }
  if (executionResult?.status === "loading") {
    return Object.freeze({
      disabled: true,
      label: "Mock execution in progress",
      message: executionResult.message,
      status,
    });
  }
  if (executionResult?.status === "executed-awaiting-confirmation") {
    return Object.freeze({
      disabled: true,
      label: "Awaiting mock confirmation",
      message: executionResult.message,
      status,
    });
  }
  if (["confirmation-blocked", "failed"].includes(executionResult?.status)) {
    return Object.freeze({
      disabled: true,
      label: "Refresh before retry",
      message: executionResult.message,
      status,
    });
  }
  if (["invalidated", "stale"].includes(executionResult?.status)) {
    return Object.freeze({
      disabled: true,
      label: "Refresh current profile",
      message: executionResult.message,
      status: executionResult.status,
    });
  }
  if (status === "no-op") {
    return Object.freeze({
      disabled: true,
      label: "No profile write needed",
      message: "The current plan is a deterministic no-op; no repository call will run.",
      status,
    });
  }
  if (status === "test-ready") {
    return Object.freeze({
      disabled: true,
      label: "Production wiring disabled",
      message: "Test-only gates are ready, but the browser app has no profile write repository instance.",
      status,
    });
  }
  return Object.freeze({
    disabled: true,
    label: "Profile writes disabled",
    message: plan
      ? "The plan is visible for validation, but write and confirmation execution remain hard-off."
      : "A current read-only profile plan is required before execution readiness can be evaluated.",
    status,
  });
}

export function createProfileExecutionOrchestrationModel({
  authState = null,
  executionReadiness = null,
  executionResult = null,
  localData = null,
  profileScope = null,
  provisioningState = null,
  repositoryReadiness = null,
} = {}) {
  const lifecycle = lifecycleState(authState, profileScope, provisioningState);
  const scopedState = lifecycle.identityMatched ? provisioningState : null;
  const plan = scopedState?.plan ?? null;
  const scopedExecutionResult = lifecycle.scopeMatches && !lifecycle.staleStateReset
    ? executionResult
    : null;
  const stages = Object.freeze([
    lifecycleStage(lifecycle),
    planStage(plan, scopedState, lifecycle),
    writeAdapterStage(plan, repositoryReadiness),
    confirmationStage(plan, repositoryReadiness, executionReadiness),
    executionResultStage(scopedExecutionResult),
    stage(
      "localSafety",
      "Local data safety",
      "Local fasting history, backups, profile state, and sync metadata remain unchanged.",
      "passed",
    ),
    stage(
      "productionWiring",
      "Production wiring",
      "Disabled. The browser app does not construct or pass a profile write repository.",
      "disabled",
    ),
  ]);
  const blockers = Object.freeze(stages
    .filter((item) => ["blocked", "confirmation-blocked", "failed"].includes(item.status))
    .map((item) => Object.freeze({
      code: `${item.key}-blocked`,
      message: item.message,
      stage: item.key,
    })));
  const loading = stages.some((item) =>
    ["loading", "executed-awaiting-confirmation"].includes(item.status),
  );
  const testReady = Boolean(
    plan
    && plan.action !== "none"
    && repositoryReadiness?.canWrite
    && repositoryReadiness?.canConfirm
    && executionReadiness?.canExecute,
  );
  const status = orchestrationStatus({
    blockers,
    executionResult: scopedExecutionResult,
    loading,
    plan,
    testReady,
  });

  return Object.freeze({
    action: actionModel(status, plan, lifecycle, scopedExecutionResult),
    actionLabel: planLabel(plan),
    blockers,
    counts: plan?.counts ?? zeroCounts(),
    dataMutated: false,
    gates: Object.freeze({
      confirmationReady: repositoryReadiness?.canConfirm === true,
      executionReady: executionReadiness?.canExecute === true,
      mockResultVisible: Boolean(
        scopedExecutionResult && scopedExecutionResult.status !== "disabled",
      ),
      productionWiringEnabled: false,
      writeAdapterReady: repositoryReadiness?.canWrite === true,
    }),
    identityMatched: lifecycle.identityMatched,
    localDataUnchanged: true,
    localSessionCount: Array.isArray(localData?.sessions) ? localData.sessions.length : 0,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    profileRowWritten: false,
    providerTokensExposed: false,
    providerTokensStored: false,
    result: scopedExecutionResult,
    safety: "Lifecycle isolated · Plan scoped · Mock result sanitized · Local data unchanged · Tokens omitted · Production writes disabled",
    stages,
    staleStateReset: lifecycle.staleStateReset,
    status,
  });
}
