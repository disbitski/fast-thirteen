import { PROFILE_EXECUTION_STATUS } from "./profileExecutor.js";

export const PROFILE_EXECUTION_RESULT_STATUS = Object.freeze({
  CONFIRMATION_BLOCKED: "confirmation-blocked",
  CONFIRMED: "confirmed",
  DISABLED: "disabled",
  EXECUTED_AWAITING_CONFIRMATION: "executed-awaiting-confirmation",
  FAILED: "failed",
  INVALIDATED: "invalidated",
  LOADING: "loading",
  NOOP: "no-op",
  STALE: "stale",
});

const ACTIONS = new Set(["create", "none", "update"]);

function safetyState() {
  return {
    dataMutated: false,
    liveSupabaseWritesEnabled: false,
    localDataUnchanged: true,
    localProfileChanged: false,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    productionWiringEnabled: false,
    providerTokensExposed: false,
    providerTokensStored: false,
  };
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function callCounts(execution) {
  return Object.freeze({
    confirmation: safeCount(execution?.summary?.confirmationCount),
    create: safeCount(execution?.summary?.createCount),
    read: safeCount(execution?.summary?.readCount),
    update: safeCount(execution?.summary?.updateCount),
  });
}

function safeAction(plan, execution) {
  const action = execution?.action ?? plan?.action ?? "none";
  return ACTIONS.has(action) ? action : "none";
}

function statusState({ controllerState, plan, profileScope }) {
  const execution = controllerState?.execution;
  const controllerStatus = controllerState?.status;
  const currentGeneration = profileScope?.generation;
  const resultGeneration = controllerState?.scopeGeneration;

  if (controllerStatus === PROFILE_EXECUTION_STATUS.INVALIDATED) {
    return {
      message: "The previous mock result was invalidated when the authenticated lifecycle changed.",
      status: PROFILE_EXECUTION_RESULT_STATUS.INVALIDATED,
    };
  }
  if (
    Number.isSafeInteger(resultGeneration)
    && resultGeneration > 0
    && (!Number.isSafeInteger(currentGeneration) || resultGeneration !== currentGeneration)
  ) {
    return {
      message: "A stale mock result was discarded before it could appear for this profile lifecycle.",
      status: PROFILE_EXECUTION_RESULT_STATUS.STALE,
    };
  }
  if (controllerStatus === PROFILE_EXECUTION_STATUS.LOADING) {
    return {
      message: "One mock profile execution is in progress; duplicate requests are suppressed.",
      status: PROFILE_EXECUTION_RESULT_STATUS.LOADING,
    };
  }
  if (
    controllerStatus === PROFILE_EXECUTION_STATUS.SKIPPED
    || execution?.status === PROFILE_EXECUTION_STATUS.SKIPPED
    || (!controllerState && plan?.action === "none")
  ) {
    return {
      message: "The deterministic no-op skipped every mock repository method.",
      status: PROFILE_EXECUTION_RESULT_STATUS.NOOP,
    };
  }
  if (
    controllerStatus === PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED
    || execution?.status === PROFILE_EXECUTION_STATUS.CONFIRMATION_BLOCKED
  ) {
    return {
      message: "The mock write did not pass deterministic read-back confirmation.",
      status: PROFILE_EXECUTION_RESULT_STATUS.CONFIRMATION_BLOCKED,
    };
  }
  if (
    controllerStatus === PROFILE_EXECUTION_STATUS.FAILED
    || execution?.status === PROFILE_EXECUTION_STATUS.FAILED
  ) {
    return {
      message: "The mock execution failed without changing Local data or sync metadata.",
      status: PROFILE_EXECUTION_RESULT_STATUS.FAILED,
    };
  }
  if (execution?.confirmed === true) {
    return {
      message: "The mock write passed deterministic read-back confirmation.",
      status: PROFILE_EXECUTION_RESULT_STATUS.CONFIRMED,
    };
  }
  if (
    controllerStatus === PROFILE_EXECUTION_STATUS.EXECUTED
    || execution?.executed === true
    || execution?.profileRowWritten === true
  ) {
    return {
      message: "The mock write completed, but deterministic read-back confirmation is still required.",
      status: PROFILE_EXECUTION_RESULT_STATUS.EXECUTED_AWAITING_CONFIRMATION,
    };
  }
  return {
    message: "No mock execution result is active; production profile writes remain disabled.",
    status: PROFILE_EXECUTION_RESULT_STATUS.DISABLED,
  };
}

export function createProfileExecutionResultStatusModel({
  controllerState = null,
  plan = null,
  profileScope = null,
  requestMeta = null,
} = {}) {
  const execution = controllerState?.execution;
  const state = statusState({ controllerState, plan, profileScope });
  const counts = callCounts(execution);
  const status = state.status;

  return Object.freeze({
    action: safeAction(plan, execution),
    blocked: [
      PROFILE_EXECUTION_RESULT_STATUS.CONFIRMATION_BLOCKED,
      PROFILE_EXECUTION_RESULT_STATUS.FAILED,
    ].includes(status),
    confirmed: status === PROFILE_EXECUTION_RESULT_STATUS.CONFIRMED,
    counts,
    deduplicated: requestMeta?.deduplicated === true,
    ignored: requestMeta?.ignored === true,
    message: state.message,
    mockProfileRowWritten: execution?.profileRowWritten === true,
    repositoryMode: "mock-only",
    staleCompletionIgnored: requestMeta?.stale === true,
    status,
    terminal: [
      PROFILE_EXECUTION_RESULT_STATUS.CONFIRMATION_BLOCKED,
      PROFILE_EXECUTION_RESULT_STATUS.CONFIRMED,
      PROFILE_EXECUTION_RESULT_STATUS.FAILED,
      PROFILE_EXECUTION_RESULT_STATUS.INVALIDATED,
      PROFILE_EXECUTION_RESULT_STATUS.NOOP,
      PROFILE_EXECUTION_RESULT_STATUS.STALE,
    ].includes(status),
    ...safetyState(),
  });
}
