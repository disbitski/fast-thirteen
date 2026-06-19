import test from "node:test";
import assert from "node:assert/strict";
import { AUTH_READINESS, authReadiness } from "../src/authReadiness.js";

test("auth readiness defaults to local-only when config is missing", () => {
  assert.deepEqual(authReadiness({ config: { isConfigured: false } }), {
    label: "Local-only",
    message: "Add Supabase publishable config to enable Google sign-in readiness.",
    status: AUTH_READINESS.LOCAL_ONLY,
  });
});

test("auth readiness reports SDK missing when config exists without browser SDK", () => {
  assert.deepEqual(
    authReadiness({
      clientStatus: "not-ready",
      config: { isConfigured: true },
    }),
    {
      label: "SDK missing",
      message: "Supabase config is present, but the browser SDK is not loaded yet.",
      status: AUTH_READINESS.SDK_MISSING,
    },
  );
});

test("auth readiness reports OAuth pending when config and SDK are ready", () => {
  assert.deepEqual(
    authReadiness({
      authStatus: "guest",
      clientStatus: "ready",
      config: { isConfigured: true },
    }),
    {
      label: "OAuth pending",
      message: "Supabase config and SDK are ready; confirm Google provider credentials before sign-in.",
      status: AUTH_READINESS.OAUTH_PENDING,
    },
  );
});

test("auth readiness reports signed-in state after authentication", () => {
  assert.deepEqual(
    authReadiness({
      authStatus: "authenticated",
      clientStatus: "ready",
      config: { isConfigured: true },
    }),
    {
      label: "Signed in",
      message: "Google sign-in is active. Cloud sync setup comes next.",
      status: AUTH_READINESS.AUTHENTICATED,
    },
  );
});
