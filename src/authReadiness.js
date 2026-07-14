import {
  GOOGLE_OAUTH_READINESS,
  createGoogleOAuthReadiness,
} from "./googleOAuthReadiness.js";

export const AUTH_READINESS = GOOGLE_OAUTH_READINESS;

export function authReadiness({
  authState = null,
  authStatus,
  clientStatus,
  config,
  location,
} = {}) {
  const state = authState ?? {
    status: authStatus,
    user: authStatus === "authenticated" ? { id: "authenticated" } : null,
  };

  return createGoogleOAuthReadiness({
    authState: state,
    clientStatus,
    config,
    location,
  });
}
