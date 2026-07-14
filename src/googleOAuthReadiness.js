export const GOOGLE_OAUTH_READINESS = Object.freeze({
  AUTHENTICATED: "authenticated",
  CALLBACK_CANCELLED: "callback-cancelled",
  CALLBACK_ERROR: "callback-error",
  CLIENT_ERROR: "client-error",
  LOCAL_ONLY: "local-only",
  OAUTH_READY: "oauth-ready",
  PROVIDER_DISABLED: "provider-disabled",
  REDIRECT_BLOCKED: "redirect-blocked",
  SDK_LOADING: "sdk-loading",
  SDK_MISSING: "sdk-missing",
});

function safeUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

export function currentRedirectOrigin(location = globalThis.location) {
  const url = safeUrl(location?.href ?? location?.origin);
  return url?.origin === "null" ? null : url?.origin ?? null;
}

export function currentAppRedirectUrl(location = globalThis.location) {
  const url = safeUrl(location?.href ?? location?.origin);
  if (!url) return null;

  const lastSegment = url.pathname.split("/").pop() ?? "";
  if (!url.pathname.endsWith("/")) {
    url.pathname = lastSegment.includes(".")
      ? url.pathname.slice(0, url.pathname.lastIndexOf("/") + 1)
      : `${url.pathname}/`;
  }
  url.search = "";
  url.hash = "";
  return url.toString();
}

function requestedRedirectUrl({ location, redirectTo } = {}) {
  if (!redirectTo) return currentAppRedirectUrl(location);
  const url = safeUrl(redirectTo);
  if (!url) return null;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function stage(label, message, status) {
  return { label, message, status };
}

function hasCallbackError(authState) {
  const error = authState?.error;
  return authState?.status === "error"
    && error
    && typeof error === "object"
    && ("error" in error || "description" in error || "code" in error);
}

function sdkStage(configured, clientStatus) {
  if (!configured) {
    return stage("Waiting", "Publishable Supabase config is missing.", "disabled");
  }
  if (clientStatus === "ready") {
    return stage("Ready", "The pinned Supabase browser SDK is ready.", "ready");
  }
  if (clientStatus === "loading") {
    return stage("Loading", "The pinned Supabase browser SDK is loading.", "loading");
  }
  if (clientStatus === "error") {
    return stage("Issue", "The Supabase browser SDK could not start.", "blocked");
  }
  return stage("Missing", "The Supabase browser SDK is not ready.", "blocked");
}

function callbackStage(authState) {
  if (authState?.status === "authenticated") {
    return stage("Complete", "Google sign-in completed for this profile.", "ready");
  }
  if (authState?.status === "cancelled") {
    return stage("Cancelled", authState.message, "cancelled");
  }
  if (hasCallbackError(authState)) {
    return stage(
      "Issue",
      authState.message ?? "The Google callback reported an issue.",
      "blocked",
    );
  }
  return stage("Clear", "No Google callback blocker is active.", "ready");
}

export function createGoogleOAuthReadiness({
  authState = null,
  clientStatus = "not-ready",
  config = {},
  location = globalThis.location,
  redirectTo = null,
} = {}) {
  const configured = config?.isConfigured === true;
  const providerEnabled = config?.googleProviderEnabled === true;
  const redirectUrl = requestedRedirectUrl({ location, redirectTo });
  const redirectOrigin = currentRedirectOrigin(
    redirectUrl ? { href: redirectUrl } : location,
  );
  const allowedOrigins = Array.isArray(config?.authRedirectOrigins)
    ? config.authRedirectOrigins
    : [];
  const redirectAllowed = Boolean(
    redirectOrigin && allowedOrigins.includes(redirectOrigin),
  );
  const sdk = sdkStage(configured, clientStatus);
  const provider = providerEnabled
    ? stage("Enabled", "Google provider readiness is explicitly enabled.", "ready")
    : stage("Disabled", "Google provider readiness is still default-off.", "disabled");
  const redirect = redirectAllowed
    ? stage("Allowed", `${redirectOrigin} is explicitly allowed.`, "ready")
    : stage(
      "Blocked",
      redirectOrigin
        ? `${redirectOrigin} is not in the redirect-origin allowlist.`
        : "The current redirect origin is unavailable.",
      "blocked",
    );
  const callback = callbackStage(authState);
  const authenticated = Boolean(
    authState?.status === "authenticated" && authState.user?.id,
  );
  const baseReady = configured && sdk.status === "ready" && providerEnabled && redirectAllowed;
  const canSignIn = Boolean(baseReady && !authenticated);
  const signIn = authenticated
    ? stage("Signed in", "This profile is signed in with Google.", "ready")
    : canSignIn
      ? stage("Ready", "Every non-secret Google sign-in check passed.", "ready")
      : stage("Blocked", "Google sign-in remains disabled until every gate passes.", "blocked");
  const stages = { sdk, provider, redirect, callback, signIn };

  let label = "Guest mode";
  let message = "Add Supabase publishable config to begin Google sign-in readiness.";
  let status = GOOGLE_OAUTH_READINESS.LOCAL_ONLY;

  if (authenticated) {
    label = "Signed in";
    message = "Google sign-in is active. Cloud writes remain disabled.";
    status = GOOGLE_OAUTH_READINESS.AUTHENTICATED;
  } else if (configured && clientStatus === "loading") {
    label = "Loading SDK";
    message = "Loading the pinned Supabase browser SDK. Local tracking remains available.";
    status = GOOGLE_OAUTH_READINESS.SDK_LOADING;
  } else if (configured && clientStatus === "error") {
    label = "Client issue";
    message = "The Supabase browser client could not start. Local tracking still works.";
    status = GOOGLE_OAUTH_READINESS.CLIENT_ERROR;
  } else if (configured && clientStatus !== "ready") {
    label = "SDK missing";
    message = "Supabase config is present, but the browser SDK is not ready.";
    status = GOOGLE_OAUTH_READINESS.SDK_MISSING;
  } else if (configured && !providerEnabled) {
    label = "Provider setup";
    message = "Google provider readiness is disabled until setup is explicitly confirmed.";
    status = GOOGLE_OAUTH_READINESS.PROVIDER_DISABLED;
  } else if (configured && !redirectAllowed) {
    label = "Redirect blocked";
    message = redirect.message;
    status = GOOGLE_OAUTH_READINESS.REDIRECT_BLOCKED;
  } else if (authState?.status === "cancelled") {
    label = "Sign-in cancelled";
    message = authState.message;
    status = GOOGLE_OAUTH_READINESS.CALLBACK_CANCELLED;
  } else if (hasCallbackError(authState)) {
    label = "Sign-in issue";
    message = authState.message ?? "Google sign-in could not complete. Local tracking still works.";
    status = GOOGLE_OAUTH_READINESS.CALLBACK_ERROR;
  } else if (baseReady) {
    label = "Sign-in ready";
    message = "SDK, provider, and redirect checks passed for this origin.";
    status = GOOGLE_OAUTH_READINESS.OAUTH_READY;
  }

  return {
    canSignIn,
    dataMutated: false,
    label,
    localTrackingAvailable: true,
    message,
    redirectOrigin,
    redirectTo: redirectUrl,
    stages,
    status,
  };
}
