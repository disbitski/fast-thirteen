import { AUTH_SESSION_CHECK_SOURCE } from "./authSessionHealth.js";

export const AUTH_SESSION_RECOVERY_SOURCE = Object.freeze({
  RECONNECT: AUTH_SESSION_CHECK_SOURCE.RECONNECT,
  RESUME: AUTH_SESSION_CHECK_SOURCE.RESUME,
});

export const AUTH_SESSION_RECOVERY_STATUS = Object.freeze({
  CHECKING: "checking",
  COMPLETED: "completed",
  IDLE: "idle",
  STALE: "stale",
  SUPPRESSED: "suppressed",
});

const DEFAULT_COOLDOWN_MS = 60_000;

function recoveryState({
  lastTriggeredAt = null,
  reason = null,
  source = null,
  status = AUTH_SESSION_RECOVERY_STATUS.IDLE,
} = {}) {
  return Object.freeze({
    authStateOnly: true,
    cloudRowsRead: false,
    dataMutated: false,
    lastTriggeredAt,
    localSyncStatusChanged: false,
    oauthLaunched: false,
    providerTokensExposed: false,
    reason,
    source,
    status,
    writesEnabled: false,
  });
}

function normalizedCooldown(value) {
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_COOLDOWN_MS;
}

function normalizedTime(value) {
  if (value instanceof Date) return value.getTime();
  return Number.isFinite(value) ? value : Date.now();
}

function checkSuppression({ enabled, online, visibilityState }) {
  if (!enabled) return "session-check-disabled";
  if (visibilityState !== "visible") return "document-hidden";
  if (!online) return "browser-offline";
  return null;
}

export function createAuthSessionRecoveryCoordinator({
  checkSession,
  cooldownMs = DEFAULT_COOLDOWN_MS,
  now = () => Date.now(),
  onStateChange = () => {},
} = {}) {
  if (typeof checkSession !== "function") {
    throw new TypeError("An auth session recovery check function is required.");
  }

  const cooldown = normalizedCooldown(cooldownMs);
  let lastStartedAt = null;
  let lastScopeKey;
  let pending = null;
  let requestId = 0;
  let state = recoveryState();

  function publish(next) {
    state = next;
    onStateChange(state);
    return state;
  }

  function current() {
    return state;
  }

  async function handleSignal({
    enabled = false,
    online = true,
    scopeKey = null,
    source,
    visibilityState = "visible",
  } = {}) {
    if (!Object.values(AUTH_SESSION_RECOVERY_SOURCE).includes(source)) {
      throw new TypeError("A visible resume or online reconnect source is required.");
    }

    const suppression = checkSuppression({ enabled, online, visibilityState });
    if (suppression) {
      return {
        accepted: false,
        deduplicated: false,
        ignored: false,
        reason: suppression,
        state: publish(recoveryState({
          reason: suppression,
          source,
          status: AUTH_SESSION_RECOVERY_STATUS.SUPPRESSED,
        })),
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

    const startedAt = normalizedTime(now());
    if (
      lastStartedAt !== null
      && lastScopeKey === scopeKey
      && startedAt - lastStartedAt < cooldown
    ) {
      return {
        accepted: false,
        deduplicated: false,
        ignored: false,
        reason: "recovery-cooldown",
        state: publish(recoveryState({
          lastTriggeredAt: new Date(lastStartedAt).toISOString(),
          reason: "recovery-cooldown",
          source,
          status: AUTH_SESSION_RECOVERY_STATUS.SUPPRESSED,
        })),
      };
    }

    if (pending) {
      requestId += 1;
      pending = null;
    }

    const activeRequestId = ++requestId;
    lastStartedAt = startedAt;
    lastScopeKey = scopeKey;
    const lastTriggeredAt = new Date(startedAt).toISOString();
    publish(recoveryState({
      lastTriggeredAt,
      source,
      status: AUTH_SESSION_RECOVERY_STATUS.CHECKING,
    }));

    const promise = Promise.resolve()
      .then(() => checkSession({ source, scopeKey }))
      .then((result) => {
        if (activeRequestId !== requestId) {
          return {
            accepted: false,
            deduplicated: false,
            ignored: true,
            reason: "stale-recovery-check",
            state,
          };
        }

        if (result?.ignored) {
          return {
            accepted: false,
            deduplicated: false,
            ignored: true,
            reason: result?.reason ?? "stale-recovery-check",
            state: publish(recoveryState({
              lastTriggeredAt,
              reason: result?.reason ?? "stale-recovery-check",
              source,
              status: AUTH_SESSION_RECOVERY_STATUS.STALE,
            })),
          };
        }

        const accepted = Boolean(result?.accepted || result?.deduplicated);
        const reason = accepted ? null : result?.reason ?? "session-check-blocked";
        return {
          ...result,
          accepted,
          deduplicated: false,
          ignored: false,
          reason,
          source,
          state: publish(recoveryState({
            lastTriggeredAt,
            reason,
            source,
            status: accepted
              ? AUTH_SESSION_RECOVERY_STATUS.COMPLETED
              : AUTH_SESSION_RECOVERY_STATUS.SUPPRESSED,
          })),
        };
      })
      .catch(() => ({
        accepted: false,
        deduplicated: false,
        ignored: false,
        reason: "session-check-failed",
        source,
        state: publish(recoveryState({
          lastTriggeredAt,
          reason: "session-check-failed",
          source,
          status: AUTH_SESSION_RECOVERY_STATUS.SUPPRESSED,
        })),
      }))
      .finally(() => {
        if (pending?.requestId === activeRequestId) pending = null;
      });

    pending = { promise, requestId: activeRequestId, scopeKey };
    return promise;
  }

  function resume(context = {}) {
    return handleSignal({ ...context, source: AUTH_SESSION_RECOVERY_SOURCE.RESUME });
  }

  function reconnect(context = {}) {
    return handleSignal({ ...context, source: AUTH_SESSION_RECOVERY_SOURCE.RECONNECT });
  }

  function invalidate({ reason = "profile-scope-changed" } = {}) {
    requestId += 1;
    pending = null;
    lastStartedAt = null;
    lastScopeKey = undefined;
    return publish(recoveryState({
      reason,
      status: AUTH_SESSION_RECOVERY_STATUS.STALE,
    }));
  }

  return {
    current,
    handleSignal,
    invalidate,
    reconnect,
    resume,
  };
}
