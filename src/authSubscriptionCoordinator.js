export const AUTH_SUBSCRIPTION_STATUS = Object.freeze({
  ACTIVE: "active",
  BLOCKED: "blocked",
  DEDUPLICATED: "deduplicated",
  DETACHED: "detached",
  IDLE: "idle",
});

function subscriptionMessage(status, reason) {
  if (status === AUTH_SUBSCRIPTION_STATUS.ACTIVE) {
    return "One token-free auth lifecycle subscription is active.";
  }
  if (status === AUTH_SUBSCRIPTION_STATUS.DEDUPLICATED) {
    return "The current browser client already owns the auth lifecycle subscription.";
  }
  if (status === AUTH_SUBSCRIPTION_STATUS.DETACHED) {
    const messages = {
      "client-replaced": "The previous browser client subscription was detached before replacement.",
      pagehide: "The auth lifecycle subscription was detached as the page was hidden.",
    };
    return messages[reason] ?? "The auth lifecycle subscription was detached safely.";
  }
  if (status === AUTH_SUBSCRIPTION_STATUS.BLOCKED) {
    return "Auth lifecycle subscription support is unavailable. Local data remains available.";
  }
  return "No auth lifecycle subscription is active.";
}

function subscriptionState({
  acceptedEvents = 0,
  generation = 0,
  reason = null,
  status = AUTH_SUBSCRIPTION_STATUS.IDLE,
  subscriptionActive = status === AUTH_SUBSCRIPTION_STATUS.ACTIVE,
} = {}) {
  return Object.freeze({
    acceptedEvents,
    authStateRead: false,
    cloudRowsRead: false,
    dataMutated: false,
    generation,
    localDataUnchanged: true,
    localSyncStatusChanged: false,
    localTrackingAvailable: true,
    message: subscriptionMessage(status, reason),
    oauthLaunched: false,
    providerTokensExposed: false,
    providerTokensStored: false,
    reason,
    status,
    subscriptionActive,
    writesEnabled: false,
  });
}

function stopSubscription(subscription) {
  try {
    const result = subscription?.unsubscribe?.();
    if (typeof result?.catch === "function") result.catch(() => {});
  } catch {
    // Ownership is invalidated before unsubscribe, so a teardown error stays local-safe.
  }
}

export function createAuthSubscriptionCoordinator({
  onAuthState,
  onStateChange = () => {},
} = {}) {
  if (typeof onAuthState !== "function") {
    throw new TypeError("An auth lifecycle callback is required.");
  }

  let acceptedEvents = 0;
  let active = null;
  let generation = 0;
  let ownershipId = 0;
  let state = subscriptionState();

  function publish(next) {
    state = next;
    onStateChange(state);
    return state;
  }

  function current() {
    return state;
  }

  function detach({ reason = "subscription-detached" } = {}) {
    const previous = active;
    active = null;
    ownershipId += 1;
    if (previous) stopSubscription(previous.subscription);
    return publish(subscriptionState({
      acceptedEvents,
      generation,
      reason,
      status: AUTH_SUBSCRIPTION_STATUS.DETACHED,
    }));
  }

  function attach({ clientGeneration = null, subscribe } = {}) {
    if (!clientGeneration || typeof subscribe !== "function") {
      if (active) detach({ reason: "subscription-disabled" });
      return {
        accepted: false,
        deduplicated: false,
        state: publish(subscriptionState({
          acceptedEvents,
          generation,
          reason: "subscription-unavailable",
          status: AUTH_SUBSCRIPTION_STATUS.BLOCKED,
        })),
      };
    }

    if (active?.clientGeneration === clientGeneration) {
      return {
        accepted: false,
        deduplicated: true,
        state: publish(subscriptionState({
          acceptedEvents,
          generation,
          reason: "subscription-already-active",
          status: AUTH_SUBSCRIPTION_STATUS.DEDUPLICATED,
          subscriptionActive: true,
        })),
      };
    }

    if (active) detach({ reason: "client-replaced" });
    generation += 1;
    const activeOwnershipId = ++ownershipId;
    const next = {
      clientGeneration,
      ownershipId: activeOwnershipId,
      subscription: null,
    };
    active = next;

    const callback = (authState) => {
      if (active !== next || activeOwnershipId !== ownershipId) {
        return {
          accepted: false,
          ignored: true,
          reason: "stale-auth-subscription",
          state,
        };
      }
      acceptedEvents += 1;
      const result = onAuthState(authState);
      publish(subscriptionState({
        acceptedEvents,
        generation,
        status: AUTH_SUBSCRIPTION_STATUS.ACTIVE,
      }));
      return {
        accepted: true,
        ignored: false,
        result,
        state,
      };
    };

    let subscription;
    try {
      subscription = subscribe(callback);
    } catch {
      if (active === next) active = null;
      ownershipId += 1;
      return {
        accepted: false,
        deduplicated: false,
        state: publish(subscriptionState({
          acceptedEvents,
          generation,
          reason: "subscription-failed",
          status: AUTH_SUBSCRIPTION_STATUS.BLOCKED,
        })),
      };
    }

    if (typeof subscription?.unsubscribe !== "function") {
      if (active === next) active = null;
      ownershipId += 1;
      return {
        accepted: false,
        deduplicated: false,
        state: publish(subscriptionState({
          acceptedEvents,
          generation,
          reason: "subscription-handle-missing",
          status: AUTH_SUBSCRIPTION_STATUS.BLOCKED,
        })),
      };
    }

    next.subscription = subscription;
    return {
      accepted: true,
      deduplicated: false,
      state: publish(subscriptionState({
        acceptedEvents,
        generation,
        status: AUTH_SUBSCRIPTION_STATUS.ACTIVE,
      })),
    };
  }

  return {
    attach,
    current,
    detach,
  };
}
