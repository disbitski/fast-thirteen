export const AUTH_READINESS = Object.freeze({
  AUTHENTICATED: "authenticated",
  CLIENT_ERROR: "client-error",
  LOCAL_ONLY: "local-only",
  OAUTH_PENDING: "oauth-pending",
  SDK_MISSING: "sdk-missing",
});

export function authReadiness({ authStatus, clientStatus, config } = {}) {
  if (authStatus === "authenticated") {
    return {
      label: "Signed in",
      message: "Google sign-in is active. Cloud sync setup comes next.",
      status: AUTH_READINESS.AUTHENTICATED,
    };
  }

  if (!config?.isConfigured) {
    return {
      label: "Guest mode",
      message: "Add Supabase publishable config to enable Google sign-in readiness.",
      status: AUTH_READINESS.LOCAL_ONLY,
    };
  }

  if (clientStatus === "not-ready") {
    return {
      label: "SDK missing",
      message: "Supabase config is present, but the browser SDK is not loaded yet.",
      status: AUTH_READINESS.SDK_MISSING,
    };
  }

  if (clientStatus === "error") {
    return {
      label: "Client issue",
      message: "Supabase config is present, but the browser client could not start.",
      status: AUTH_READINESS.CLIENT_ERROR,
    };
  }

  return {
    label: "OAuth pending",
    message: "Supabase config and SDK are ready; confirm Google provider credentials before sign-in.",
    status: AUTH_READINESS.OAUTH_PENDING,
  };
}
