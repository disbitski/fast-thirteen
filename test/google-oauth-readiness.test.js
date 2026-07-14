import test from "node:test";
import assert from "node:assert/strict";
import {
  GOOGLE_OAUTH_READINESS,
  createGoogleOAuthReadiness,
  currentAppRedirectUrl,
} from "../src/googleOAuthReadiness.js";

const readyConfig = Object.freeze({
  authRedirectOrigins: Object.freeze([
    "http://127.0.0.1:4173",
    "http://192.168.86.50:4173",
    "https://disbitski.github.io",
  ]),
  googleProviderEnabled: true,
  isConfigured: true,
});

const localLocation = Object.freeze({
  href: "http://127.0.0.1:4173/index.html?source=test#profile",
});

test("allowed local origin enables every non-secret sign-in gate", () => {
  const model = createGoogleOAuthReadiness({
    authState: { status: "guest" },
    clientStatus: "ready",
    config: readyConfig,
    location: localLocation,
  });

  assert.equal(model.status, GOOGLE_OAUTH_READINESS.OAUTH_READY);
  assert.equal(model.canSignIn, true);
  assert.equal(model.redirectOrigin, "http://127.0.0.1:4173");
  assert.equal(model.redirectTo, "http://127.0.0.1:4173/");
  assert.equal(model.stages.sdk.status, "ready");
  assert.equal(model.stages.provider.status, "ready");
  assert.equal(model.stages.redirect.status, "ready");
  assert.equal(model.stages.callback.status, "ready");
  assert.equal(model.stages.signIn.status, "ready");
});

test("GitHub Pages redirect keeps the Fast Thirteen project path", () => {
  assert.equal(
    currentAppRedirectUrl({
      href: "https://disbitski.github.io/fast-thirteen/index.html?error=old#profile",
    }),
    "https://disbitski.github.io/fast-thirteen/",
  );
});

test("unlisted LAN origin blocks sign-in before OAuth", () => {
  const model = createGoogleOAuthReadiness({
    authState: { status: "guest" },
    clientStatus: "ready",
    config: readyConfig,
    location: { href: "http://192.168.86.99:4173/" },
  });

  assert.equal(model.status, GOOGLE_OAUTH_READINESS.REDIRECT_BLOCKED);
  assert.equal(model.canSignIn, false);
  assert.match(model.message, /not in the redirect-origin allowlist/);
  assert.equal(model.stages.redirect.status, "blocked");
});

test("cancelled and failed callbacks stay visible while allowing a safe retry", () => {
  const cancelled = createGoogleOAuthReadiness({
    authState: {
      message: "Google sign-in was cancelled. Local tracking still works.",
      status: "cancelled",
    },
    clientStatus: "ready",
    config: readyConfig,
    location: localLocation,
  });
  const failed = createGoogleOAuthReadiness({
    authState: {
      error: { error: "server_error" },
      message: "Google rejected the callback. Local tracking still works.",
      status: "error",
    },
    clientStatus: "ready",
    config: readyConfig,
    location: localLocation,
  });

  assert.equal(cancelled.status, GOOGLE_OAUTH_READINESS.CALLBACK_CANCELLED);
  assert.equal(cancelled.stages.callback.status, "cancelled");
  assert.equal(cancelled.canSignIn, true);
  assert.equal(failed.status, GOOGLE_OAUTH_READINESS.CALLBACK_ERROR);
  assert.equal(failed.stages.callback.status, "blocked");
  assert.equal(failed.canSignIn, true);
});

test("non-callback session errors do not impersonate callback blockers", () => {
  const model = createGoogleOAuthReadiness({
    authState: {
      error: new Error("session lookup failed"),
      message: "Session lookup failed. Local tracking still works.",
      status: "error",
    },
    clientStatus: "ready",
    config: readyConfig,
    location: localLocation,
  });

  assert.equal(model.status, GOOGLE_OAUTH_READINESS.OAUTH_READY);
  assert.equal(model.stages.callback.status, "ready");
  assert.equal(model.canSignIn, true);
});

test("readiness modeling leaves local data unchanged", () => {
  const localData = Object.freeze({
    sessions: Object.freeze([{ id: "local-fast" }]),
    sync: Object.freeze({ status: "local" }),
  });
  const before = JSON.stringify(localData);
  const model = createGoogleOAuthReadiness({
    clientStatus: "ready",
    config: readyConfig,
    location: localLocation,
  });

  assert.equal(model.dataMutated, false);
  assert.equal(model.localTrackingAvailable, true);
  assert.equal(JSON.stringify(localData), before);
});
