export const AUTH_PROFILE_STATUS = Object.freeze({
  AUTHENTICATED: "authenticated",
  CALLBACK_CANCELLED: "callback-cancelled",
  GUEST: "guest",
  SESSION_ERROR: "session-error",
  SESSION_EXPIRED: "session-expired",
  SIGNED_OUT: "signed-out",
});

function authenticatedUserId(authState) {
  if (authState?.status !== "authenticated") return null;
  return typeof authState.user?.id === "string" && authState.user.id.trim()
    ? authState.user.id.trim()
    : null;
}

function profileStatus(authState, previousUserId = null) {
  if (authenticatedUserId(authState)) return AUTH_PROFILE_STATUS.AUTHENTICATED;
  if (authState?.status === "signed-out") return AUTH_PROFILE_STATUS.SIGNED_OUT;
  if (authState?.status === "error") return AUTH_PROFILE_STATUS.SESSION_ERROR;
  if (authState?.status === "cancelled") return AUTH_PROFILE_STATUS.CALLBACK_CANCELLED;
  if (previousUserId && authState?.status === "guest") {
    return AUTH_PROFILE_STATUS.SESSION_EXPIRED;
  }
  return AUTH_PROFILE_STATUS.GUEST;
}

function statusMessage(status) {
  const messages = {
    [AUTH_PROFILE_STATUS.AUTHENTICATED]:
      "Cloud previews are scoped to the current authenticated test profile.",
    [AUTH_PROFILE_STATUS.CALLBACK_CANCELLED]:
      "Google sign-in was cancelled. No authenticated cloud preview is active.",
    [AUTH_PROFILE_STATUS.GUEST]:
      "Guest mode is active. Cloud previews are not associated with a profile.",
    [AUTH_PROFILE_STATUS.SESSION_ERROR]:
      "The auth session could not be refreshed. Previous cloud preview data was cleared.",
    [AUTH_PROFILE_STATUS.SESSION_EXPIRED]:
      "The auth session ended. Previous cloud preview data was cleared.",
    [AUTH_PROFILE_STATUS.SIGNED_OUT]:
      "Signed out. Previous cloud preview data was cleared.",
  };
  return messages[status] ?? messages[AUTH_PROFILE_STATUS.GUEST];
}

function transitionReason(previousUserId, nextUserId, status) {
  if (previousUserId && nextUserId && previousUserId !== nextUserId) {
    return "authenticated-user-changed";
  }
  if (!previousUserId && nextUserId) return "authenticated-user-entered";
  if (previousUserId && status === AUTH_PROFILE_STATUS.SIGNED_OUT) return "signed-out";
  if (previousUserId && status === AUTH_PROFILE_STATUS.SESSION_ERROR) {
    return "session-refresh-failed";
  }
  if (previousUserId && !nextUserId) return "session-expired";
  return null;
}

function coordinatorState({
  generation = 0,
  status = AUTH_PROFILE_STATUS.GUEST,
  userId = null,
} = {}) {
  return Object.freeze({
    dataMutated: false,
    generation,
    identityKey: userId ? `profile:${generation}:${userId}` : null,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    message: statusMessage(status),
    providerTokensExposed: false,
    providerTokensStored: false,
    status,
    userId,
  });
}

export function createAuthProfileCoordinator({
  initialAuthState = null,
  onInvalidate = () => {},
  onStateChange = () => {},
} = {}) {
  const initialUserId = authenticatedUserId(initialAuthState);
  let state = coordinatorState({
    generation: initialUserId ? 1 : 0,
    status: profileStatus(initialAuthState),
    userId: initialUserId,
  });

  function current() {
    return state;
  }

  function scopeKey(resourceKey) {
    if (!state.identityKey) return null;
    return JSON.stringify({
      generation: state.generation,
      identityKey: state.identityKey,
      resourceKey,
    });
  }

  function observeAuthState(authState) {
    const previous = state;
    const nextUserId = authenticatedUserId(authState);
    const status = profileStatus(authState, previous.userId);
    const reason = transitionReason(previous.userId, nextUserId, status);
    const identityChanged = previous.userId !== nextUserId;
    const shouldInvalidate = Boolean(reason);
    const generation = identityChanged
      ? previous.generation + 1
      : previous.generation;
    const next = coordinatorState({
      generation,
      status,
      userId: nextUserId,
    });

    state = next;
    if (shouldInvalidate) {
      onInvalidate(Object.freeze({
        message: next.message,
        next,
        previous,
        reason,
      }));
    }
    onStateChange(next);
    return next;
  }

  return {
    current,
    observeAuthState,
    scopeKey,
  };
}
