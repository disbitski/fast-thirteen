export const AUTH_SESSION_HEALTH_STATUS = Object.freeze({
  CHECKING: "checking",
  EXPIRED: "expired",
  HEALTHY: "healthy",
  LOCAL_FALLBACK: "local-fallback",
  REFRESH_FAILED: "refresh-failed",
  SIGNED_OUT: "signed-out",
});

const KNOWN_AUTH_EVENTS = new Set([
  "INITIAL_SESSION",
  "SIGNED_IN",
  "TOKEN_REFRESHED",
  "USER_UPDATED",
  "SIGNED_OUT",
]);

function normalizedEvent(authState, checkedAt) {
  const event = typeof authState?.event === "string"
    ? authState.event.trim().toUpperCase()
    : "";
  if (KNOWN_AUTH_EVENTS.has(event)) return event;
  return checkedAt ? "SESSION_CHECK" : null;
}

function callbackError(authState) {
  const error = authState?.error;
  return authState?.status === "error"
    && error
    && typeof error === "object"
    && ("error" in error || "description" in error || "code" in error);
}

function authenticated(authState) {
  return Boolean(authState?.status === "authenticated" && authState.user?.id);
}

function checkedTimestamp(value, fallback = null) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return fallback;
  return new Date(value).toISOString();
}

function statusFromAuth(authState, previous) {
  if (authState?.status === "loading") return AUTH_SESSION_HEALTH_STATUS.CHECKING;
  if (authState?.event === "SIGNED_OUT" || authState?.status === "signed-out") {
    return AUTH_SESSION_HEALTH_STATUS.SIGNED_OUT;
  }
  if (authenticated(authState)) return AUTH_SESSION_HEALTH_STATUS.HEALTHY;
  if (authState?.status === "error" && !callbackError(authState)) {
    return AUTH_SESSION_HEALTH_STATUS.REFRESH_FAILED;
  }
  if (
    authState?.status === "guest"
    && [
      AUTH_SESSION_HEALTH_STATUS.CHECKING,
      AUTH_SESSION_HEALTH_STATUS.EXPIRED,
      AUTH_SESSION_HEALTH_STATUS.HEALTHY,
      AUTH_SESSION_HEALTH_STATUS.REFRESH_FAILED,
    ].includes(previous?.status)
    && previous?.hadAuthenticatedSession
  ) {
    return AUTH_SESSION_HEALTH_STATUS.EXPIRED;
  }
  return AUTH_SESSION_HEALTH_STATUS.LOCAL_FALLBACK;
}

function statusCopy(status, authState, hadAuthenticatedSession) {
  const copy = {
    [AUTH_SESSION_HEALTH_STATUS.CHECKING]: {
      label: "Checking",
      message: hadAuthenticatedSession
        ? "Rechecking the authenticated session without reading fasting rows."
        : "Checking for an authenticated session without changing Local data.",
      previewMessage: hadAuthenticatedSession
        ? "The current profile preview stays protected while this check runs."
        : "No authenticated profile preview is active during this check.",
      previewStatus: hadAuthenticatedSession ? "protected" : "not-active",
      recovery: "Wait for this local session check to finish.",
    },
    [AUTH_SESSION_HEALTH_STATUS.EXPIRED]: {
      label: "Session expired",
      message: "The authenticated session ended. Guest mode and Local data remain available.",
      previewMessage: "The previous profile preview was cleared before local fallback.",
      previewStatus: "reset",
      recovery: "Use Continue with Google when it is ready to start a new isolated session.",
    },
    [AUTH_SESSION_HEALTH_STATUS.HEALTHY]: {
      label: "Session healthy",
      message: "The authenticated session is available for profile-scoped read-only validation.",
      previewMessage: "Cloud preview data is scoped to this authenticated lifecycle.",
      previewStatus: "profile-scoped",
      recovery: "Recheck the session at any time without reading or changing fasting data.",
    },
    [AUTH_SESSION_HEALTH_STATUS.LOCAL_FALLBACK]: {
      label: "Local fallback",
      message: authState?.message ?? "No authenticated session is active. Local tracking still works.",
      previewMessage: "No authenticated profile preview is active.",
      previewStatus: "not-active",
      recovery: "Keep tracking locally or sign in after every Google readiness check passes.",
    },
    [AUTH_SESSION_HEALTH_STATUS.REFRESH_FAILED]: {
      label: "Refresh failed",
      message: "The auth session could not be verified. Guest mode and Local data remain available.",
      previewMessage: "The previous profile preview was cleared after the failed session check.",
      previewStatus: "reset",
      recovery: "Retry the local session check, then sign in again if the session is still unavailable.",
    },
    [AUTH_SESSION_HEALTH_STATUS.SIGNED_OUT]: {
      label: "Signed out",
      message: "The authenticated session is closed. Local fasting history remains available.",
      previewMessage: "The previous profile preview was cleared at sign-out.",
      previewStatus: "reset",
      recovery: "Continue in Guest mode or sign in again when Google readiness passes.",
    },
  };
  return copy[status] ?? copy[AUTH_SESSION_HEALTH_STATUS.LOCAL_FALLBACK];
}

export function createAuthSessionHealthModel({
  authState = null,
  checkedAt = null,
  previous = null,
} = {}) {
  const status = statusFromAuth(authState, previous);
  const hadAuthenticatedSession = status === AUTH_SESSION_HEALTH_STATUS.HEALTHY
    || Boolean(previous?.hadAuthenticatedSession);
  const copy = statusCopy(status, authState, hadAuthenticatedSession);
  const lastCheckedAt = checkedTimestamp(checkedAt, previous?.lastCheckedAt ?? null);

  return Object.freeze({
    canRetry: status !== AUTH_SESSION_HEALTH_STATUS.CHECKING,
    dataMutated: false,
    event: normalizedEvent(authState, checkedAt),
    hadAuthenticatedSession,
    label: copy.label,
    lastCheckedAt,
    localDataUnchanged: true,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    message: copy.message,
    previewMessage: copy.previewMessage,
    previewStatus: copy.previewStatus,
    profilePreviewReset: copy.previewStatus === "reset",
    providerTokensExposed: false,
    providerTokensStored: false,
    recovery: copy.recovery,
    status,
  });
}

function failedCheckAuthState() {
  return {
    configured: true,
    error: true,
    message: "The local session check failed. Local tracking still works.",
    status: "error",
    user: null,
  };
}

export function createAuthSessionHealthController({
  checkSession,
  initialAuthState = null,
  initialScopeKey = null,
  now = () => new Date().toISOString(),
  onStateChange = () => {},
} = {}) {
  if (typeof checkSession !== "function") {
    throw new TypeError("A local auth session check function is required.");
  }

  let activeScopeKey = initialScopeKey;
  let pending = null;
  let requestId = 0;
  let state = createAuthSessionHealthModel({ authState: initialAuthState });

  function publish(next) {
    state = next;
    onStateChange(state);
    return state;
  }

  function current() {
    return state;
  }

  function invalidatePending() {
    requestId += 1;
    pending = null;
  }

  function observeAuthState(authState, { checkedAt = null, scopeKey = activeScopeKey } = {}) {
    const scopeChanged = scopeKey !== activeScopeKey;
    const observedLifecycleEvent = KNOWN_AUTH_EVENTS.has(authState?.event);
    const terminalState = ["error", "guest", "signed-out"].includes(authState?.status);
    if (pending && (scopeChanged || observedLifecycleEvent || terminalState)) {
      invalidatePending();
    }
    activeScopeKey = scopeKey;
    return publish(createAuthSessionHealthModel({ authState, checkedAt, previous: state }));
  }

  async function check({ enabled = false, scopeKey = activeScopeKey } = {}) {
    if (!enabled) {
      return {
        accepted: false,
        deduplicated: false,
        ignored: false,
        reason: "session-check-disabled",
        state,
      };
    }

    if (pending?.scopeKey === scopeKey) {
      const result = await pending.promise;
      return {
        ...result,
        accepted: false,
        deduplicated: true,
      };
    }

    if (pending) invalidatePending();
    const activeRequestId = ++requestId;
    activeScopeKey = scopeKey;
    publish(createAuthSessionHealthModel({
      authState: { status: "loading" },
      previous: state,
    }));

    const promise = Promise.resolve()
      .then(() => checkSession())
      .then((authState) => ({ authState, checkedAt: now() }))
      .catch(() => ({ authState: failedCheckAuthState(), checkedAt: now() }))
      .then((result) => {
        if (activeRequestId !== requestId || activeScopeKey !== scopeKey) {
          return {
            accepted: false,
            deduplicated: false,
            ignored: true,
            reason: "stale-session-check",
            state,
          };
        }

        return {
          accepted: true,
          deduplicated: false,
          ignored: false,
          ...result,
          state: createAuthSessionHealthModel({
            authState: result.authState,
            checkedAt: result.checkedAt,
            previous: state,
          }),
        };
      })
      .finally(() => {
        if (pending?.requestId === activeRequestId) pending = null;
      });

    pending = { promise, requestId: activeRequestId, scopeKey };
    return promise;
  }

  return {
    check,
    current,
    observeAuthState,
  };
}
