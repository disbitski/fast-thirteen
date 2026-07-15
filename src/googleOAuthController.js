export const GOOGLE_OAUTH_LAUNCH_STATUS = Object.freeze({
  AUTHENTICATED: "authenticated",
  BLOCKED: "blocked",
  CANCELLED: "cancelled",
  FAILED: "failed",
  IDLE: "idle",
  LOADING: "loading",
  REDIRECTING: "redirecting",
});

function launchState({ key = null, message, status }) {
  return Object.freeze({
    dataMutated: false,
    key,
    localTrackingAvailable: true,
    message,
    providerTokensExposed: false,
    providerTokensStored: false,
    status,
  });
}

function idleState() {
  return launchState({
    message: "Google sign-in has not started.",
    status: GOOGLE_OAUTH_LAUNCH_STATUS.IDLE,
  });
}

function callbackError(authState) {
  const error = authState?.error;
  return authState?.status === "error"
    && error
    && typeof error === "object"
    && ("error" in error || "description" in error || "code" in error);
}

function stateFromAuth(authState, current = idleState()) {
  if (authState?.status === "authenticated" && authState.user?.id) {
    return launchState({
      message: "Google sign-in completed. Provider tokens are not retained by Fast Thirteen.",
      status: GOOGLE_OAUTH_LAUNCH_STATUS.AUTHENTICATED,
    });
  }

  if (authState?.status === "cancelled") {
    return launchState({
      message: authState.message ?? "Google sign-in was cancelled. Local tracking still works.",
      status: GOOGLE_OAUTH_LAUNCH_STATUS.CANCELLED,
    });
  }

  if (callbackError(authState)) {
    return launchState({
      message: authState.message ?? "Google sign-in could not complete. Local tracking still works.",
      status: GOOGLE_OAUTH_LAUNCH_STATUS.FAILED,
    });
  }

  if (
    authState?.event === "INITIAL_SESSION"
    && [
      GOOGLE_OAUTH_LAUNCH_STATUS.CANCELLED,
      GOOGLE_OAUTH_LAUNCH_STATUS.FAILED,
    ].includes(current.status)
  ) {
    return current;
  }

  if (["guest", "signed-out"].includes(authState?.status)) return idleState();
  return current;
}

export function createGoogleOAuthLaunchController({
  initialAuthState = null,
  launch,
  onStateChange = () => {},
} = {}) {
  if (typeof launch !== "function") {
    throw new TypeError("A Google OAuth launch function is required.");
  }

  let pending = null;
  let state = stateFromAuth(initialAuthState);

  function publish(next) {
    state = next;
    onStateChange(state);
    return state;
  }

  function current() {
    return state;
  }

  function observeAuthState(authState) {
    const next = stateFromAuth(authState, state);
    if (next !== state) publish(next);
    return state;
  }

  async function start({ readiness } = {}) {
    if (!readiness?.canSignIn || !readiness.redirectTo) {
      const blocked = publish(launchState({
        message: readiness?.message ?? "Google sign-in readiness has not passed.",
        status: GOOGLE_OAUTH_LAUNCH_STATUS.BLOCKED,
      }));
      return {
        accepted: false,
        deduplicated: false,
        state: blocked,
      };
    }

    const key = readiness.redirectTo;
    if (pending?.key === key) {
      const result = await pending.promise;
      return {
        ...result,
        accepted: false,
        deduplicated: true,
      };
    }
    if (state.key === key && state.status === GOOGLE_OAUTH_LAUNCH_STATUS.REDIRECTING) {
      return {
        accepted: false,
        deduplicated: true,
        state,
      };
    }

    publish(launchState({
      key,
      message: "Opening Google sign-in without changing local fasting data.",
      status: GOOGLE_OAUTH_LAUNCH_STATUS.LOADING,
    }));

    const promise = Promise.resolve()
      .then(() => launch({ redirectTo: readiness.redirectTo }))
      .then((result) => {
        if (result?.ok) {
          return {
            accepted: true,
            deduplicated: false,
            state: publish(launchState({
              key,
              message: "Google sign-in is redirecting. Local data remains available.",
              status: GOOGLE_OAUTH_LAUNCH_STATUS.REDIRECTING,
            })),
          };
        }

        const cancelled = result?.status === "cancelled";
        return {
          accepted: true,
          deduplicated: false,
          state: publish(launchState({
            key,
            message: result?.message ?? (cancelled
              ? "Google sign-in was cancelled. Local tracking still works."
              : "Google sign-in could not start. Local tracking still works."),
            status: cancelled
              ? GOOGLE_OAUTH_LAUNCH_STATUS.CANCELLED
              : GOOGLE_OAUTH_LAUNCH_STATUS.FAILED,
          })),
        };
      })
      .catch((error) => ({
        accepted: true,
        deduplicated: false,
        state: publish(launchState({
          key,
          message: error?.message ?? "Google sign-in could not start. Local tracking still works.",
          status: GOOGLE_OAUTH_LAUNCH_STATUS.FAILED,
        })),
      }))
      .finally(() => {
        pending = null;
      });

    pending = { key, promise };
    return promise;
  }

  return {
    current,
    observeAuthState,
    start,
  };
}
