import {
  PROFILE_PROVISIONING_ACTION,
  PROFILE_PROVISIONING_STATUS,
  normalizeRemoteProfileRow,
} from "./profileProvisioning.js";

export const PROFILE_EXECUTION_STATUS = Object.freeze({
  BLOCKED: "blocked",
  CONFIRMATION_BLOCKED: "confirmation-blocked",
  DISABLED: "disabled",
  EXECUTED: "executed",
  FAILED: "failed",
  IDLE: "idle",
  INVALIDATED: "invalidated",
  LOADING: "loading",
  READY: "ready",
  SKIPPED: "skipped",
});

const PROFILE_FIELDS = Object.freeze([
  "id",
  "display_name",
  "email",
  "provider",
  "updated_at",
]);

function safetyState() {
  return {
    dataMutated: false,
    liveSupabaseWritesEnabled: false,
    localDataUnchanged: true,
    localProfileChanged: false,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    providerTokensExposed: false,
    providerTokensStored: false,
  };
}

function readinessResult({
  canExecute = false,
  canSkip = false,
  confirmationSupport = false,
  message,
  reason = null,
  status,
  writeSupport = false,
}) {
  return Object.freeze({
    canExecute,
    canSkip,
    confirmationSupport,
    message,
    reason,
    status,
    writeSupport,
    ...safetyState(),
  });
}

function currentPlanBlocker({ authState, plan, profileScope }) {
  if (authState?.status !== "authenticated" || !authState.user?.id) {
    return {
      message: "A current authenticated test profile is required before profile execution.",
      reason: "authenticated-profile-required",
    };
  }
  if (!profileScope?.identityKey || profileScope.status !== "authenticated") {
    return {
      message: "A current authenticated lifecycle is required before profile execution.",
      reason: "authenticated-profile-scope-required",
    };
  }
  if (!plan || !plan.candidate || !plan.identityKey) {
    return {
      message: "A completed read-only profile plan is required before profile execution.",
      reason: "profile-plan-required",
    };
  }
  if (
    plan.identityKey !== profileScope.identityKey
    || plan.candidate.id !== authState.user.id
    || plan.candidate.id !== profileScope.userId
  ) {
    return {
      message: "The profile plan does not match the current authenticated lifecycle.",
      reason: "profile-plan-scope-mismatch",
    };
  }
  if (plan.status === PROFILE_PROVISIONING_STATUS.BLOCKED || plan.blockers?.length > 0) {
    return {
      message: plan.message ?? "The profile plan is blocked.",
      reason: plan.reason ?? "profile-plan-blocked",
    };
  }
  if (![PROFILE_PROVISIONING_STATUS.PREVIEW, PROFILE_PROVISIONING_STATUS.CURRENT]
    .includes(plan.status)) {
    return {
      message: "Only a completed create, update, or no-op profile plan can continue.",
      reason: "profile-plan-not-ready",
    };
  }
  if (![PROFILE_PROVISIONING_ACTION.CREATE, PROFILE_PROVISIONING_ACTION.UPDATE,
    PROFILE_PROVISIONING_ACTION.NONE].includes(plan.action)) {
    return {
      message: "The profile plan contains an unsupported action.",
      reason: "profile-action-invalid",
    };
  }
  return null;
}

export function createProfileExecutionReadiness({
  authState,
  confirmationSupport = false,
  plan,
  profileScope,
  writeSupport = false,
} = {}) {
  const blocker = currentPlanBlocker({ authState, plan, profileScope });
  if (blocker) {
    return readinessResult({
      confirmationSupport,
      message: blocker.message,
      reason: blocker.reason,
      status: PROFILE_EXECUTION_STATUS.BLOCKED,
      writeSupport,
    });
  }

  if (plan.action === PROFILE_PROVISIONING_ACTION.NONE) {
    return readinessResult({
      canSkip: true,
      confirmationSupport,
      message: "The profile plan is a deterministic no-op; no repository call is needed.",
      reason: "profile-plan-noop",
      status: PROFILE_EXECUTION_STATUS.SKIPPED,
      writeSupport,
    });
  }

  if (writeSupport !== true) {
    return readinessResult({
      confirmationSupport,
      message: "Profile write execution is disabled. The browser repository remains read-only.",
      reason: "profile-write-support-disabled",
      status: PROFILE_EXECUTION_STATUS.DISABLED,
    });
  }

  if (confirmationSupport !== true) {
    return readinessResult({
      confirmationSupport,
      message: "Profile read-back confirmation support is required before execution.",
      reason: "profile-confirmation-support-disabled",
      status: PROFILE_EXECUTION_STATUS.DISABLED,
      writeSupport,
    });
  }

  return readinessResult({
    canExecute: true,
    confirmationSupport: true,
    message: "The profile plan is ready for mocked write and read-back confirmation.",
    status: PROFILE_EXECUTION_STATUS.READY,
    writeSupport: true,
  });
}

function confirmationResult({
  changedFields = [],
  matchesPlan = false,
  message,
  reason,
  status,
}) {
  return Object.freeze({
    changedFields: Object.freeze(changedFields),
    matchesPlan,
    message,
    reason,
    status,
    ...safetyState(),
  });
}

export function confirmProfileProvisioningResult({ plan, remoteRow } = {}) {
  if (!plan?.candidate || ![PROFILE_PROVISIONING_ACTION.CREATE, PROFILE_PROVISIONING_ACTION.UPDATE]
    .includes(plan.action)) {
    return confirmationResult({
      message: "A completed create or update plan is required for profile confirmation.",
      reason: "profile-confirmation-plan-required",
      status: PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED,
    });
  }

  const normalized = normalizeRemoteProfileRow(remoteRow, plan.candidate.id);
  if (!normalized.ok) {
    return confirmationResult({
      message: normalized.blocker.message,
      reason: normalized.blocker.code,
      status: PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED,
    });
  }

  const changedFields = PROFILE_FIELDS.filter((field) =>
    normalized.row[field] !== plan.candidate[field],
  );
  if (changedFields.length > 0) {
    return confirmationResult({
      changedFields,
      message: "The read-back profile row does not match the precomputed plan.",
      reason: "profile-readback-mismatch",
      status: PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED,
    });
  }

  return confirmationResult({
    matchesPlan: true,
    message: "The read-back profile row matches the precomputed plan.",
    reason: null,
    status: "confirmed",
  });
}

function executionResult({
  action = PROFILE_PROVISIONING_ACTION.NONE,
  calls = [],
  code = null,
  confirmation = null,
  confirmed = false,
  executed = false,
  message,
  profileRowWritten = false,
  status,
}) {
  return Object.freeze({
    action,
    calls: Object.freeze(calls),
    code,
    confirmation,
    confirmed,
    executed,
    message,
    profileRowWritten,
    repositoryMode: "mock-only",
    status,
    summary: Object.freeze({
      confirmationCount: calls.filter((call) => call === "confirm").length,
      createCount: calls.filter((call) => call === "create").length,
      readCount: calls.filter((call) => call === "read").length,
      updateCount: calls.filter((call) => call === "update").length,
    }),
    ...safetyState(),
  });
}

function blockedFromReadiness(plan, readiness) {
  return executionResult({
    action: plan?.action,
    code: readiness?.reason ?? "profile-execution-disabled",
    message: readiness?.message ?? "Profile execution is disabled.",
    status: readiness?.status === PROFILE_EXECUTION_STATUS.DISABLED
      ? PROFILE_EXECUTION_STATUS.DISABLED
      : PROFILE_EXECUTION_STATUS.BLOCKED,
  });
}

function requiredMethod(repository, name) {
  return typeof repository?.[name] === "function";
}

function safeConfirmation(confirmation, deterministic) {
  const matchesPlan = deterministic.matchesPlan === true
    && confirmation?.matchesPlan === true
    && confirmation?.status === "confirmed";
  return Object.freeze({
    deterministicMatch: deterministic.matchesPlan === true,
    matchesPlan,
    message: matchesPlan
      ? "Mock repository confirmation and deterministic read-back comparison passed."
      : "Mock repository confirmation or deterministic read-back comparison did not pass.",
    reason: matchesPlan ? null : deterministic.reason ?? "profile-confirmation-blocked",
    repositoryConfirmed: confirmation?.status === "confirmed",
    status: matchesPlan ? "confirmed" : PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED,
  });
}

export async function executeProfileProvisioningPlan({
  authState,
  plan,
  profileScope,
  readiness,
  repository,
} = {}) {
  const currentReadiness = createProfileExecutionReadiness({
    authState,
    confirmationSupport: readiness?.confirmationSupport,
    plan,
    profileScope,
    writeSupport: readiness?.writeSupport,
  });

  if (currentReadiness.canSkip) {
    return executionResult({
      action: plan.action,
      confirmed: true,
      message: "The profile row needs no change; repository execution was skipped.",
      status: PROFILE_EXECUTION_STATUS.SKIPPED,
    });
  }
  if (!currentReadiness.canExecute) return blockedFromReadiness(plan, currentReadiness);

  const writeMethod = plan.action === PROFILE_PROVISIONING_ACTION.CREATE
    ? "createProfile"
    : "updateProfile";
  for (const method of [writeMethod, "readProfile", "confirmProfile"]) {
    if (!requiredMethod(repository, method)) {
      return executionResult({
        action: plan.action,
        code: "repository-method-missing",
        message: `The mocked profile repository is missing ${method}.`,
        status: PROFILE_EXECUTION_STATUS.BLOCKED,
      });
    }
  }

  const calls = [];
  let writeResult;
  try {
    writeResult = await repository[writeMethod]({
      profile: plan.candidate,
      reason: plan.reason,
    });
    calls.push(plan.action);
  } catch (error) {
    return executionResult({
      action: plan.action,
      calls,
      code: "profile-write-failed",
      message: "The mocked profile write failed without changing Local data.",
      status: PROFILE_EXECUTION_STATUS.FAILED,
    });
  }

  let remoteRow;
  try {
    remoteRow = await repository.readProfile({ userId: plan.candidate.id });
    calls.push("read");
  } catch (error) {
    return executionResult({
      action: plan.action,
      calls,
      code: "profile-readback-failed",
      message: "The mocked profile read-back failed; confirmation is blocked.",
      profileRowWritten: true,
      status: PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED,
    });
  }

  const deterministic = confirmProfileProvisioningResult({ plan, remoteRow });
  let repositoryConfirmation;
  try {
    repositoryConfirmation = await repository.confirmProfile({
      action: plan.action,
      expected: deterministic,
      remoteRow,
      writeResult,
    });
    calls.push("confirm");
  } catch (error) {
    return executionResult({
      action: plan.action,
      calls,
      code: "profile-confirmation-failed",
      message: "The mocked profile confirmation failed; Local data remains unchanged.",
      profileRowWritten: true,
      status: PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED,
    });
  }

  const confirmation = safeConfirmation(repositoryConfirmation, deterministic);
  if (!confirmation.matchesPlan) {
    return executionResult({
      action: plan.action,
      calls,
      code: confirmation.reason,
      confirmation,
      message: confirmation.message,
      profileRowWritten: true,
      status: PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED,
    });
  }

  return executionResult({
    action: plan.action,
    calls,
    confirmation,
    confirmed: true,
    executed: true,
    message: "Mocked profile execution passed read-back confirmation. Local data remains unchanged.",
    profileRowWritten: true,
    status: PROFILE_EXECUTION_STATUS.EXECUTED,
  });
}

function controllerState({
  execution = null,
  message = "Profile execution has not run.",
  reason = null,
  scopeGeneration = 0,
  status = PROFILE_EXECUTION_STATUS.IDLE,
} = {}) {
  return Object.freeze({
    execution,
    message,
    reason,
    scopeGeneration,
    status,
    ...safetyState(),
  });
}

function executionKey(profileScope, plan) {
  return JSON.stringify([
    profileScope.generation,
    plan.action,
    plan.candidate?.updated_at,
    plan.remote?.updated_at ?? null,
  ]);
}

export function createProfileExecutionController({
  executePlan = executeProfileProvisioningPlan,
  onStateChange = () => {},
} = {}) {
  let requestId = 0;
  let activeKey = null;
  let state = controllerState();

  function publish(next) {
    state = next;
    onStateChange(state);
    return state;
  }

  function current() {
    return state;
  }

  function invalidate({
    message = "The authenticated lifecycle changed. Previous profile execution was cleared.",
    reason = "profile-transition",
  } = {}) {
    requestId += 1;
    activeKey = null;
    return publish(controllerState({
      message,
      reason,
      status: PROFILE_EXECUTION_STATUS.INVALIDATED,
    }));
  }

  async function execute(input = {}) {
    const readiness = createProfileExecutionReadiness(input);
    if (!readiness.canExecute && !readiness.canSkip) {
      requestId += 1;
      activeKey = null;
      const blocked = publish(controllerState({
        message: readiness.message,
        reason: readiness.reason,
        scopeGeneration: input.profileScope?.generation ?? 0,
        status: readiness.status,
      }));
      return { accepted: false, deduplicated: false, ignored: false, state: blocked };
    }

    const key = executionKey(input.profileScope, input.plan);
    if (activeKey === key && [
      PROFILE_EXECUTION_STATUS.LOADING,
      PROFILE_EXECUTION_STATUS.EXECUTED,
      PROFILE_EXECUTION_STATUS.SKIPPED,
      PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED,
    ].includes(state.status)) {
      return { accepted: false, deduplicated: true, ignored: false, state };
    }

    const activeRequestId = ++requestId;
    activeKey = key;
    publish(controllerState({
      message: readiness.canSkip
        ? "Confirming that the profile plan needs no repository call."
        : "Running the mocked profile write and read-back confirmation scaffold.",
      scopeGeneration: input.profileScope.generation,
      status: PROFILE_EXECUTION_STATUS.LOADING,
    }));

    const execution = await executePlan({ ...input, readiness });
    if (activeRequestId !== requestId) {
      return { accepted: true, deduplicated: false, ignored: true, stale: true, state };
    }

    const completed = publish(controllerState({
      execution,
      message: execution.message,
      reason: execution.code,
      scopeGeneration: input.profileScope.generation,
      status: execution.status,
    }));
    return { accepted: true, deduplicated: false, ignored: false, state: completed };
  }

  return { current, execute, invalidate };
}

export function createProfileExecutionControlModel({ readiness = {}, requestState = null } = {}) {
  if (requestState?.status === PROFILE_EXECUTION_STATUS.LOADING) {
    return Object.freeze({
      disabled: true,
      label: "Confirming mocked profile",
      message: "One profile execution request is in progress; duplicates are ignored.",
      status: PROFILE_EXECUTION_STATUS.LOADING,
    });
  }
  if (requestState?.status === PROFILE_EXECUTION_STATUS.EXECUTED) {
    return Object.freeze({
      disabled: true,
      label: "Mock confirmation passed",
      message: "The scaffold completed without changing Local data or sync metadata.",
      status: PROFILE_EXECUTION_STATUS.EXECUTED,
    });
  }
  if (requestState?.status === PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED) {
    return Object.freeze({
      disabled: true,
      label: "Refresh before retry",
      message: "A new read-only plan is required after confirmation is blocked.",
      status: PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED,
    });
  }
  if (readiness.canSkip) {
    return Object.freeze({
      disabled: true,
      label: "No profile write needed",
      message: readiness.message,
      status: PROFILE_EXECUTION_STATUS.SKIPPED,
    });
  }
  if (!readiness.canExecute) {
    return Object.freeze({
      disabled: true,
      label: "Profile writes disabled",
      message: readiness.message ?? "Mock profile execution is disabled.",
      status: readiness.status ?? PROFILE_EXECUTION_STATUS.DISABLED,
    });
  }
  return Object.freeze({
    disabled: false,
    label: "Confirm mocked profile write",
    message: "Only explicitly injected mock write and confirmation support can enable this action.",
    status: PROFILE_EXECUTION_STATUS.READY,
  });
}
