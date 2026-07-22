export const AUTH_LIFECYCLE_EVENT = Object.freeze({
  INITIAL_SESSION: "INITIAL_SESSION",
  REFRESH_FAILED: "REFRESH_FAILED",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  SIGNED_IN: "SIGNED_IN",
  SIGNED_OUT: "SIGNED_OUT",
  TOKEN_REFRESHED: "TOKEN_REFRESHED",
  USER_UPDATED: "USER_UPDATED",
});

export const AUTH_LIFECYCLE_STATUS = Object.freeze({
  APPLIED: "applied",
  DEDUPLICATED: "deduplicated",
  IDLE: "idle",
  IGNORED: "ignored",
});

const SUBSCRIPTION_EVENTS = new Set([
  AUTH_LIFECYCLE_EVENT.INITIAL_SESSION,
  AUTH_LIFECYCLE_EVENT.SIGNED_IN,
  AUTH_LIFECYCLE_EVENT.SIGNED_OUT,
  AUTH_LIFECYCLE_EVENT.TOKEN_REFRESHED,
  AUTH_LIFECYCLE_EVENT.USER_UPDATED,
]);

function authenticatedIdentity(authState) {
  if (authState?.status !== "authenticated") return null;
  const id = authState.user?.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function tokenFreeUser(user) {
  const id = optionalString(user?.id);
  if (!id) return null;
  const email = optionalString(user?.email);
  const provider = optionalString(user?.app_metadata?.provider);
  const fullName = optionalString(user?.user_metadata?.full_name);
  const name = optionalString(user?.user_metadata?.name);
  const updatedAt = optionalString(user?.updated_at);
  const userMetadata = {
    ...(fullName ? { full_name: fullName } : {}),
    ...(name ? { name } : {}),
  };
  return {
    ...(provider ? { app_metadata: { provider } } : {}),
    ...(email ? { email } : {}),
    id,
    ...(updatedAt ? { updated_at: updatedAt } : {}),
    ...(fullName || name ? { user_metadata: userMetadata } : {}),
  };
}

function tokenFreeAuthState(authState, event) {
  const user = tokenFreeUser(authState?.user);
  const expiresAt = optionalString(authState?.session?.expiresAt);
  return {
    configured: Boolean(authState?.configured),
    error: authState?.error ? true : null,
    event,
    message: optionalString(authState?.message),
    session: user ? { ...(expiresAt ? { expiresAt } : {}), user } : null,
    status: authState?.status ?? "guest",
    user,
  };
}

function normalizedEvent(authState, previousIdentity) {
  if (authState?.status === "signed-out" || authState?.event === "SIGNED_OUT") {
    return AUTH_LIFECYCLE_EVENT.SIGNED_OUT;
  }
  if (authState?.status === "error") return AUTH_LIFECYCLE_EVENT.REFRESH_FAILED;
  if (authState?.status === "guest" && previousIdentity) {
    return AUTH_LIFECYCLE_EVENT.SESSION_EXPIRED;
  }

  const event = typeof authState?.event === "string"
    ? authState.event.trim().toUpperCase()
    : "";
  return SUBSCRIPTION_EVENTS.has(event) ? event : null;
}

function eventFingerprint(event, authState, identity) {
  const expiry = typeof authState?.session?.expiresAt === "string"
    ? authState.session.expiresAt
    : "";
  const userRevision = JSON.stringify([
    authState?.user?.updated_at ?? "",
    authState?.user?.email ?? "",
    authState?.user?.app_metadata?.provider ?? "",
    authState?.user?.user_metadata?.full_name ?? "",
    authState?.user?.user_metadata?.name ?? "",
  ]);
  return JSON.stringify([
    event,
    authState?.status ?? "",
    identity ?? "",
    expiry,
    userRevision,
  ]);
}

function transitionName(event, previousIdentity, nextIdentity) {
  if (previousIdentity && nextIdentity && previousIdentity !== nextIdentity) {
    return "authenticated-user-changed";
  }
  if (!previousIdentity && nextIdentity) return "authenticated-user-entered";
  if (event === AUTH_LIFECYCLE_EVENT.SIGNED_OUT) return "signed-out";
  if (event === AUTH_LIFECYCLE_EVENT.SESSION_EXPIRED) return "session-expired";
  if (event === AUTH_LIFECYCLE_EVENT.REFRESH_FAILED) return "session-refresh-failed";
  if (event === AUTH_LIFECYCLE_EVENT.TOKEN_REFRESHED) return "same-user-refreshed";
  if (event === AUTH_LIFECYCLE_EVENT.USER_UPDATED) return "same-user-updated";
  if (event === AUTH_LIFECYCLE_EVENT.SIGNED_IN) return "same-user-signed-in";
  return "initial-session-observed";
}

function expiryEffect(event, nextIdentity) {
  if (
    event === AUTH_LIFECYCLE_EVENT.SIGNED_OUT
    || event === AUTH_LIFECYCLE_EVENT.SESSION_EXPIRED
    || event === AUTH_LIFECYCLE_EVENT.REFRESH_FAILED
  ) {
    return "cancel";
  }
  if (
    nextIdentity
    && [
      AUTH_LIFECYCLE_EVENT.INITIAL_SESSION,
      AUTH_LIFECYCLE_EVENT.SIGNED_IN,
      AUTH_LIFECYCLE_EVENT.TOKEN_REFRESHED,
    ].includes(event)
  ) {
    return "replace";
  }
  return "preserve";
}

function lifecycleMessage(status, transition) {
  if (status === AUTH_LIFECYCLE_STATUS.DEDUPLICATED) {
    return "A repeated auth lifecycle event was ignored safely.";
  }
  if (status === AUTH_LIFECYCLE_STATUS.IGNORED) {
    return "An unsupported auth lifecycle event was ignored safely.";
  }
  const messages = {
    "authenticated-user-changed":
      "The authenticated profile changed. Previous profile previews were invalidated.",
    "authenticated-user-entered":
      "An authenticated lifecycle is ready for isolated read-only previews.",
    "session-expired":
      "The session expired. Profile previews were reset before Local data fallback.",
    "session-refresh-failed":
      "Session refresh failed. Profile previews were reset before Local data fallback.",
    "signed-out":
      "The signed-out lifecycle cleared profile previews while preserving Local data.",
  };
  return messages[transition]
    ?? "The current authenticated lifecycle was updated without changing Local data.";
}

function lifecycleState({
  event = null,
  expirySchedule = "preserve",
  generation = 0,
  profilePreviewReset = false,
  reason = null,
  sameUser = false,
  status = AUTH_LIFECYCLE_STATUS.IDLE,
  transition = null,
} = {}) {
  return Object.freeze({
    dataMutated: false,
    event,
    expirySchedule,
    generation,
    localDataUnchanged: true,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    message: lifecycleMessage(status, transition),
    profilePreviewReset,
    providerTokensExposed: false,
    providerTokensStored: false,
    reason,
    sameUser,
    source: "supabase-subscription",
    status,
    transition,
    writesEnabled: false,
  });
}

export function createAuthLifecycleCoordinator({
  applyAuthState,
  initialAuthState = null,
  onStateChange = () => {},
} = {}) {
  if (typeof applyAuthState !== "function") {
    throw new TypeError("An auth lifecycle state handler is required.");
  }

  let activeIdentity = authenticatedIdentity(initialAuthState);
  let generation = activeIdentity ? 1 : 0;
  let lastFingerprint = null;
  let state = lifecycleState({ generation });

  function publish(next) {
    state = next;
    onStateChange(state);
    return state;
  }

  function current() {
    return state;
  }

  function synchronizeAuthState(authState) {
    const nextIdentity = authenticatedIdentity(authState);
    if (nextIdentity !== activeIdentity) generation += 1;
    activeIdentity = nextIdentity;
    return state;
  }

  function observeAuthState(authState) {
    const event = normalizedEvent(authState, activeIdentity);
    if (!event) {
      return {
        accepted: false,
        deduplicated: false,
        state: publish(lifecycleState({
          generation,
          reason: "unsupported-auth-event",
          status: AUTH_LIFECYCLE_STATUS.IGNORED,
        })),
      };
    }

    const nextIdentity = authenticatedIdentity(authState);
    const fingerprint = eventFingerprint(event, authState, nextIdentity);
    if (fingerprint === lastFingerprint) {
      return {
        accepted: false,
        deduplicated: true,
        state: publish(lifecycleState({
          event,
          generation,
          reason: "duplicate-auth-event",
          sameUser: Boolean(activeIdentity && activeIdentity === nextIdentity),
          status: AUTH_LIFECYCLE_STATUS.DEDUPLICATED,
        })),
      };
    }

    const previousIdentity = activeIdentity;
    const identityChanged = previousIdentity !== nextIdentity;
    const sameUser = Boolean(previousIdentity && previousIdentity === nextIdentity);
    if (identityChanged) generation += 1;
    const transition = transitionName(event, previousIdentity, nextIdentity);
    const profilePreviewReset = Boolean(
      previousIdentity
      && (identityChanged || !nextIdentity),
    );

    activeIdentity = nextIdentity;
    lastFingerprint = fingerprint;
    applyAuthState(tokenFreeAuthState(authState, event), Object.freeze({
      event,
      source: "supabase-subscription",
      transition,
    }));

    return {
      accepted: true,
      deduplicated: false,
      state: publish(lifecycleState({
        event,
        expirySchedule: expiryEffect(event, nextIdentity),
        generation,
        profilePreviewReset,
        sameUser,
        status: AUTH_LIFECYCLE_STATUS.APPLIED,
        transition,
      })),
    };
  }

  return {
    current,
    observeAuthState,
    synchronizeAuthState,
  };
}
