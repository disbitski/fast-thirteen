import test from "node:test";
import assert from "node:assert/strict";
import { AUTH_READINESS, authReadiness } from "../src/authReadiness.js";

function summary(model) {
  return {
    canSignIn: model.canSignIn,
    label: model.label,
    message: model.message,
    status: model.status,
  };
}

test("auth readiness defaults to local-only when config is missing", () => {
  assert.deepEqual(summary(authReadiness({ config: { isConfigured: false } })), {
    canSignIn: false,
    label: "Guest mode",
    message: "Add Supabase publishable config to begin Google sign-in readiness.",
    status: AUTH_READINESS.LOCAL_ONLY,
  });
});

test("auth readiness reports SDK missing when config exists without browser SDK", () => {
  assert.deepEqual(
    summary(authReadiness({
      clientStatus: "not-ready",
      config: { isConfigured: true },
    })),
    {
      canSignIn: false,
      label: "SDK missing",
      message: "Supabase config is present, but the browser SDK is not ready.",
      status: AUTH_READINESS.SDK_MISSING,
    },
  );
});

test("auth readiness reports pinned SDK loading while local tracking stays available", () => {
  assert.deepEqual(
    summary(authReadiness({
      clientStatus: "loading",
      config: { isConfigured: true },
    })),
    {
      canSignIn: false,
      label: "Loading SDK",
      message: "Loading the pinned Supabase browser SDK. Local tracking remains available.",
      status: AUTH_READINESS.SDK_LOADING,
    },
  );
});

test("auth readiness keeps provider setup disabled by default", () => {
  assert.deepEqual(
    summary(authReadiness({
      authStatus: "guest",
      clientStatus: "ready",
      config: { isConfigured: true, googleProviderEnabled: false },
    })),
    {
      canSignIn: false,
      label: "Provider setup",
      message: "Google provider readiness is disabled until setup is explicitly confirmed.",
      status: AUTH_READINESS.PROVIDER_DISABLED,
    },
  );
});

test("auth readiness reports signed-in state after authentication", () => {
  assert.deepEqual(
    summary(authReadiness({
      authStatus: "authenticated",
      clientStatus: "ready",
      config: { isConfigured: true },
    })),
    {
      canSignIn: false,
      label: "Signed in",
      message: "Google sign-in is active. Cloud writes remain disabled.",
      status: AUTH_READINESS.AUTHENTICATED,
    },
  );
});
