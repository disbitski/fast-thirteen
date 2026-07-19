import { AUTH_SESSION_CHECK_SOURCE } from "./authSessionHealth.js";

export const AUTH_SESSION_FRESHNESS_STATUS = Object.freeze({
  CHECKING: "checking",
  EXPIRED: "expired",
  EXPIRING: "expiring",
  HEALTHY: "healthy",
  LOCAL_FALLBACK: "local-fallback",
  UNKNOWN: "unknown",
});

export const AUTH_SESSION_EXPIRY_STATUS = Object.freeze({
  CHECKING: "checking",
  COMPLETED: "completed",
  IDLE: "idle",
  SCHEDULED: "scheduled",
  STALE: "stale",
  SUPPRESSED: "suppressed",
});

const DEFAULT_WARNING_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_COOLDOWN_MS = 60 * 1000;

function timeValue(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value);
  return Number.isFinite(value) ? value : Number.NaN;
}

function normalizedIso(value) {
  const timestamp = timeValue(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizedDuration(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function freshnessCopy(status, expiresAt) {
  const copy = {
    [AUTH_SESSION_FRESHNESS_STATUS.CHECKING]: {
      label: "Checking freshness",
      message: "Session freshness is being checked locally.",
    },
    [AUTH_SESSION_FRESHNESS_STATUS.EXPIRED]: {
      label: "Revalidation due",
      message: "The saved session expiry passed. An auth-only recheck is due.",
    },
    [AUTH_SESSION_FRESHNESS_STATUS.EXPIRING]: {
      label: "Expiring soon",
      message: `The authenticated session is nearing its ${expiresAt} expiry.`,
    },
    [AUTH_SESSION_FRESHNESS_STATUS.HEALTHY]: {
      label: "Fresh",
      message: `The authenticated session is current through ${expiresAt}.`,
    },
    [AUTH_SESSION_FRESHNESS_STATUS.LOCAL_FALLBACK]: {
      label: "Local fallback",
      message: "No authenticated session freshness is active. Local data remains available.",
    },
    [AUTH_SESSION_FRESHNESS_STATUS.UNKNOWN]: {
      label: "Expiry unavailable",
      message: "The authenticated session did not include a safe expiry timestamp.",
    },
  };
  return copy[status];
}

export function createAuthSessionFreshnessModel({
  authState = null,
  healthState = null,
  now = Date.now(),
  warningMs = DEFAULT_WARNING_MS,
} = {}) {
  const currentTime = timeValue(now);
  const expiresAt = normalizedIso(authState?.session?.expiresAt);
  const expiresAtTime = timeValue(expiresAt);
  const warningWindow = normalizedDuration(warningMs, DEFAULT_WARNING_MS);
  let status = AUTH_SESSION_FRESHNESS_STATUS.LOCAL_FALLBACK;

  if (healthState?.status === "checking" || authState?.status === "loading") {
    status = AUTH_SESSION_FRESHNESS_STATUS.CHECKING;
  } else if (authState?.status === "authenticated") {
    if (!expiresAt || !Number.isFinite(currentTime)) {
      status = AUTH_SESSION_FRESHNESS_STATUS.UNKNOWN;
    } else if (expiresAtTime <= currentTime) {
      status = AUTH_SESSION_FRESHNESS_STATUS.EXPIRED;
    } else if (expiresAtTime - currentTime <= warningWindow) {
      status = AUTH_SESSION_FRESHNESS_STATUS.EXPIRING;
    } else {
      status = AUTH_SESSION_FRESHNESS_STATUS.HEALTHY;
    }
  }

  const copy = freshnessCopy(status, expiresAt);
  const nextTransitionAt = status === AUTH_SESSION_FRESHNESS_STATUS.HEALTHY
    ? new Date(expiresAtTime - warningWindow).toISOString()
    : status === AUTH_SESSION_FRESHNESS_STATUS.EXPIRING
      ? expiresAt
      : status === AUTH_SESSION_FRESHNESS_STATUS.EXPIRED
        ? new Date(currentTime).toISOString()
        : null;

  return Object.freeze({
    authStateOnly: true,
    canSchedule: Boolean(nextTransitionAt),
    cloudRowsRead: false,
    dataMutated: false,
    expiresAt,
    label: copy.label,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    message: copy.message,
    nextTransitionAt,
    providerTokensExposed: false,
    providerTokensStored: false,
    remainingMs: expiresAt && Number.isFinite(currentTime)
      ? expiresAtTime - currentTime
      : null,
    status,
    writesEnabled: false,
  });
}

function expiryState({
  freshness = createAuthSessionFreshnessModel(),
  purpose = null,
  reason = null,
  scheduledFor = null,
  status = AUTH_SESSION_EXPIRY_STATUS.IDLE,
} = {}) {
  return Object.freeze({
    authStateOnly: true,
    cloudRowsRead: false,
    dataMutated: false,
    freshness,
    localSyncStatusChanged: false,
    oauthLaunched: false,
    providerTokensExposed: false,
    purpose,
    reason,
    scheduledFor,
    status,
    writesEnabled: false,
  });
}

function suppressionReason({ enabled, online, visibilityState }) {
  if (!enabled) return "session-check-disabled";
  if (visibilityState !== "visible") return "document-hidden";
  if (!online) return "browser-offline";
  return null;
}

export function createAuthSessionExpiryController({
  checkSession,
  clearTimer = (timer) => clearTimeout(timer),
  now = () => Date.now(),
  onStateChange = () => {},
  retryCooldownMs = DEFAULT_RETRY_COOLDOWN_MS,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  warningMs = DEFAULT_WARNING_MS,
} = {}) {
  if (typeof checkSession !== "function") {
    throw new TypeError("An auth-only expiry session check function is required.");
  }

  const retryCooldown = normalizedDuration(retryCooldownMs, DEFAULT_RETRY_COOLDOWN_MS);
  let context = null;
  let generation = 0;
  let lastCheck = null;
  let pending = null;
  let state = expiryState();
  let timer = null;

  function publish(next) {
    state = next;
    onStateChange(state);
    return state;
  }

  function current() {
    return state;
  }

  function clearScheduledTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function invalidate({ reason = "profile-scope-changed" } = {}) {
    generation += 1;
    clearScheduledTimer();
    pending = null;
    lastCheck = null;
    context = null;
    return publish(expiryState({
      freshness: state.freshness,
      reason,
      status: AUTH_SESSION_EXPIRY_STATUS.STALE,
    }));
  }

  async function execute(activeGeneration, scheduledContext) {
    if (activeGeneration !== generation || scheduledContext !== context) {
      return {
        accepted: false,
        ignored: true,
        reason: "stale-expiry-check",
        state,
      };
    }

    const suppression = suppressionReason(scheduledContext);
    if (suppression) {
      return {
        accepted: false,
        ignored: false,
        reason: suppression,
        state: publish(expiryState({
          freshness: state.freshness,
          reason: suppression,
          status: AUTH_SESSION_EXPIRY_STATUS.SUPPRESSED,
        })),
      };
    }

    if (pending?.scopeKey === scheduledContext.scopeKey) return pending.promise;

    const checkedAt = timeValue(now());
    const checkFreshness = state.freshness;
    lastCheck = {
      checkedAt,
      expiresAt: checkFreshness.expiresAt,
      scopeKey: scheduledContext.scopeKey,
    };
    publish(expiryState({
      freshness: createAuthSessionFreshnessModel({
        authState: scheduledContext.authState,
        healthState: { status: "checking" },
        now: checkedAt,
        warningMs,
      }),
      purpose: "expiry-check",
      status: AUTH_SESSION_EXPIRY_STATUS.CHECKING,
    }));

    const promise = Promise.resolve()
      .then(() => checkSession({
        scopeKey: scheduledContext.scopeKey,
        source: AUTH_SESSION_CHECK_SOURCE.EXPIRY,
      }))
      .then((result) => {
        if (activeGeneration !== generation || scheduledContext !== context) {
          return {
            accepted: false,
            ignored: true,
            reason: "stale-expiry-check",
            state,
          };
        }

        if (result?.ignored) {
          return {
            ...result,
            accepted: false,
            state: publish(expiryState({
              freshness: checkFreshness,
              reason: result.reason ?? "stale-expiry-check",
              status: AUTH_SESSION_EXPIRY_STATUS.STALE,
            })),
          };
        }

        const accepted = Boolean(result?.accepted || result?.deduplicated);
        const reason = accepted ? null : result?.reason ?? "session-check-blocked";
        return {
          ...result,
          accepted,
          ignored: false,
          reason,
          source: AUTH_SESSION_CHECK_SOURCE.EXPIRY,
          state: publish(expiryState({
            freshness: checkFreshness,
            purpose: "expiry-check",
            reason,
            status: accepted
              ? AUTH_SESSION_EXPIRY_STATUS.COMPLETED
              : AUTH_SESSION_EXPIRY_STATUS.SUPPRESSED,
          })),
        };
      })
      .catch(() => ({
        accepted: false,
        ignored: false,
        reason: "session-check-failed",
        state: publish(expiryState({
          freshness: checkFreshness,
          reason: "session-check-failed",
          status: AUTH_SESSION_EXPIRY_STATUS.SUPPRESSED,
        })),
      }))
      .finally(() => {
        if (pending?.generation === activeGeneration) pending = null;
      });

    pending = { generation: activeGeneration, promise, scopeKey: scheduledContext.scopeKey };
    return promise;
  }

  function observe({
    authState = null,
    enabled = false,
    healthState = null,
    online = true,
    scopeKey = null,
    visibilityState = "visible",
  } = {}) {
    generation += 1;
    clearScheduledTimer();
    pending = null;
    const activeGeneration = generation;
    const currentTime = timeValue(now());
    const freshness = createAuthSessionFreshnessModel({
      authState,
      healthState,
      now: currentTime,
      warningMs,
    });
    context = Object.freeze({
      authState,
      enabled,
      online,
      scopeKey,
      visibilityState,
    });

    const suppression = suppressionReason(context);
    if (suppression) {
      return publish(expiryState({
        freshness,
        reason: suppression,
        status: AUTH_SESSION_EXPIRY_STATUS.SUPPRESSED,
      }));
    }

    if (!freshness.canSchedule) {
      return publish(expiryState({ freshness }));
    }

    const purpose = freshness.status === AUTH_SESSION_FRESHNESS_STATUS.HEALTHY
      ? "freshness-transition"
      : "expiry-check";
    let scheduledTime = timeValue(freshness.nextTransitionAt);
    if (
      purpose === "expiry-check"
      && lastCheck?.scopeKey === scopeKey
      && lastCheck.expiresAt === freshness.expiresAt
    ) {
      scheduledTime = Math.max(scheduledTime, lastCheck.checkedAt + retryCooldown);
    }
    const scheduledFor = new Date(Math.max(currentTime, scheduledTime)).toISOString();
    const scheduledContext = context;
    const delay = Math.max(0, timeValue(scheduledFor) - currentTime);

    timer = setTimer(() => {
      timer = null;
      if (purpose === "freshness-transition") {
        return observe(scheduledContext);
      }
      return execute(activeGeneration, scheduledContext);
    }, delay);

    return publish(expiryState({
      freshness,
      purpose,
      scheduledFor,
      status: AUTH_SESSION_EXPIRY_STATUS.SCHEDULED,
    }));
  }

  return {
    current,
    invalidate,
    observe,
  };
}
