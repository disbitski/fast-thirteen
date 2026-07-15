import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanAuthCallbackUrl,
  createAuthService,
  mapAuthStateToProfile,
  mapSupabaseSession,
  readAuthCallbackState,
  resolveAuthCallbackState,
} from "../src/auth.js";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const ignoredSecretScanDirectories = new Set([".git", "data", "node_modules"]);

function repoFiles(directory = repoRoot) {
  const files = [];

  for (const name of readdirSync(directory)) {
    if (ignoredSecretScanDirectories.has(name)) continue;
    if (name.startsWith(".env") && name !== ".env.example") continue;

    const filePath = join(directory, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) {
      files.push(...repoFiles(filePath));
    } else {
      files.push(filePath);
    }
  }

  return files;
}

test("missing auth config leaves Google sign-in disabled", async () => {
  const service = createAuthService({
    config: { isConfigured: false },
  });

  assert.equal(service.isConfigured(), false);
  assert.deepEqual(await service.currentAuthState(), {
    configured: false,
    error: null,
    message: "Google sign-in needs Supabase publishable config first.",
    session: null,
    status: "disabled",
    user: null,
  });
  assert.deepEqual(await service.signInWithGoogle(), {
    ok: false,
    status: "disabled",
    message: "Google sign-in needs Supabase publishable config first.",
  });
});

test("provider-disabled auth never calls Google OAuth", async () => {
  let oauthCalls = 0;
  const service = createAuthService({
    clientStatus: "ready",
    config: {
      authRedirectOrigins: ["http://127.0.0.1:4173"],
      googleProviderEnabled: false,
      isConfigured: true,
    },
    location: { href: "http://127.0.0.1:4173/" },
    supabaseClient: {
      auth: {
        async signInWithOAuth() {
          oauthCalls += 1;
          return {};
        },
      },
    },
  });

  const result = await service.signInWithGoogle();
  assert.equal(result.ok, false);
  assert.equal(result.status, "provider-disabled");
  assert.equal(oauthCalls, 0);
});

test("unlisted redirect origin never calls Google OAuth", async () => {
  let oauthCalls = 0;
  const service = createAuthService({
    clientStatus: "ready",
    config: {
      authRedirectOrigins: ["http://127.0.0.1:4173"],
      googleProviderEnabled: true,
      isConfigured: true,
    },
    location: { href: "http://192.168.86.99:4173/" },
    supabaseClient: {
      auth: {
        async signInWithOAuth() {
          oauthCalls += 1;
          return {};
        },
      },
    },
  });

  const result = await service.signInWithGoogle();
  assert.equal(result.ok, false);
  assert.equal(result.status, "redirect-blocked");
  assert.equal(oauthCalls, 0);
});

test("ready Google OAuth uses the GitHub Pages project return URL", async () => {
  const calls = [];
  const service = createAuthService({
    clientStatus: "ready",
    config: {
      authRedirectOrigins: ["https://disbitski.github.io"],
      googleProviderEnabled: true,
      isConfigured: true,
    },
    location: {
      href: "https://disbitski.github.io/fast-thirteen/index.html?source=test#profile",
    },
    supabaseClient: {
      auth: {
        async signInWithOAuth(value) {
          calls.push(value);
          return { data: { url: "https://accounts.google.com/" } };
        },
      },
    },
  });

  assert.deepEqual(await service.signInWithGoogle(), {
    ok: true,
    status: "redirecting",
  });
  assert.deepEqual(calls, [{
    provider: "google",
    options: {
      redirectTo: "https://disbitski.github.io/fast-thirteen/",
    },
  }]);
});

test("authenticated state omits Supabase and provider tokens", () => {
  const state = mapSupabaseSession({
    access_token: "supabase-access-token",
    provider_token: "google-provider-token",
    refresh_token: "supabase-refresh-token",
    user: { id: "user-123", email: "dave@example.com" },
  });

  assert.deepEqual(state.session, {
    user: { id: "user-123", email: "dave@example.com" },
  });
  assert.doesNotMatch(JSON.stringify(state), /provider-token|access-token|refresh-token/);
});

test("maps Supabase session user into authenticated profile state", () => {
  const authState = mapSupabaseSession({
    user: {
      id: "user-123",
      email: "dave@example.com",
      app_metadata: { provider: "google" },
      user_metadata: { full_name: "Dave Isbitski" },
    },
  });
  const profile = mapAuthStateToProfile(authState, "2026-06-17T12:00:00.000Z");

  assert.deepEqual(profile, {
    mode: "authenticated",
    guestId: "local-guest",
    userId: "user-123",
    email: "dave@example.com",
    displayName: "Dave Isbitski",
    provider: "google",
    updatedAt: "2026-06-17T12:00:00.000Z",
  });
});

test("configured auth wrapper reads the current Supabase session", async () => {
  const service = createAuthService({
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "sb_publishable_test",
      isConfigured: true,
    },
    supabaseClient: {
      auth: {
        async getSession() {
          return {
            data: {
              session: {
                user: {
                  id: "user-123",
                  email: "dave@example.com",
                },
              },
            },
          };
        },
      },
    },
  });

  assert.deepEqual(await service.currentAuthState(), {
    configured: true,
    error: null,
    message: null,
    session: {
      user: {
        id: "user-123",
        email: "dave@example.com",
      },
    },
    status: "authenticated",
    user: {
      id: "user-123",
      email: "dave@example.com",
    },
  });
});

test("configured auth wrapper reports not-ready without a browser client", async () => {
  const service = createAuthService({
    clientStatus: "not-ready",
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "sb_publishable_test",
      isConfigured: true,
    },
  });

  assert.deepEqual(service.initialState(), {
    configured: true,
    error: null,
    message: "Supabase is configured, but the browser client is not loaded yet.",
    session: null,
    status: "not-ready",
    user: null,
  });
  assert.deepEqual(await service.currentAuthState(), service.initialState());
});

test("configured auth wrapper reports browser SDK loading safely", () => {
  const service = createAuthService({
    clientStatus: "loading",
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "sb_publishable_test",
      isConfigured: true,
    },
  });

  assert.deepEqual(service.initialState(), {
    configured: true,
    error: null,
    message: "Loading the Supabase browser SDK. Local tracking still works.",
    session: null,
    status: "loading",
    user: null,
  });
});

test("maps cancelled OAuth callback into a local-safe auth state", () => {
  const state = readAuthCallbackState(
    new URLSearchParams({
      error: "access_denied",
      error_description: "User cancelled login",
    }),
  );

  assert.equal(state.status, "cancelled");
  assert.equal(state.message, "Google sign-in was cancelled. Local tracking still works.");
});

test("callback feedback survives guest session hydration but yields to later auth events", () => {
  const callbackState = readAuthCallbackState(
    new URLSearchParams({ error: "access_denied" }),
  );
  const initialGuest = {
    configured: true,
    event: "INITIAL_SESSION",
    status: "guest",
    user: null,
  };
  const signedOut = {
    configured: true,
    event: "SIGNED_OUT",
    status: "signed-out",
    user: null,
  };
  const authenticated = {
    configured: true,
    event: "SIGNED_IN",
    status: "authenticated",
    user: { id: "user-123" },
  };

  assert.equal(resolveAuthCallbackState(callbackState, initialGuest), callbackState);
  assert.equal(resolveAuthCallbackState(callbackState, signedOut), signedOut);
  assert.equal(resolveAuthCallbackState(callbackState, authenticated), authenticated);
});

test("cleans OAuth callback error params while preserving unrelated params", () => {
  const calls = [];
  cleanAuthCallbackUrl(
    {
      hash: "#top",
      pathname: "/",
      search: "?error=access_denied&keep=yes&error_description=cancelled",
    },
    {
      replaceState(...args) {
        calls.push(args);
      },
    },
  );

  assert.deepEqual(calls, [[{}, "", "/?keep=yes#top"]]);
});

test("signs out through Supabase without deleting local history", async () => {
  let signedOut = false;
  const service = createAuthService({
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "sb_publishable_test",
      isConfigured: true,
    },
    supabaseClient: {
      auth: {
        async signOut() {
          signedOut = true;
          return {};
        },
      },
    },
  });

  assert.deepEqual(await service.signOut(), {
    ok: true,
    status: "signed-out",
    message: "Signed out. Local fasting history remains on this device.",
  });
  assert.equal(signedOut, true);
});

test("sign-out reports placeholder state when SDK is not loaded", async () => {
  const service = createAuthService({
    clientStatus: "not-ready",
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "sb_publishable_test",
      isConfigured: true,
    },
  });

  assert.deepEqual(await service.signOut(), {
    ok: false,
    status: "not-ready",
    message: "Sign-out is ready for Supabase, but the browser client is not loaded yet.",
  });
});

test("auth state subscription maps signed-out events explicitly", () => {
  let handler;
  const service = createAuthService({
    config: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "sb_publishable_test",
      isConfigured: true,
    },
    supabaseClient: {
      auth: {
        onAuthStateChange(callback) {
          handler = callback;
          return { data: { subscription: { unsubscribe() {} } } };
        },
      },
    },
  });
  const states = [];

  service.onAuthStateChange((state) => states.push(state));
  handler("SIGNED_OUT", null);

  assert.deepEqual(states, [
    {
      configured: true,
      error: null,
      event: "SIGNED_OUT",
      message: "Signed out. Local fasting history remains on this device.",
      session: null,
      status: "signed-out",
      user: null,
    },
  ]);
});


test("tracked files do not contain committed OAuth or service-role secrets", () => {
  const secretPatterns = [
    /SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+/,
    /SUPABASE_JWT_SECRET\s*=\s*\S+/,
    /APPLE_CLIENT_SECRET\s*=\s*\S+/,
    /APPLE_PRIVATE_KEY\s*=\s*\S+/,
    new RegExp("-----BEGIN " + "PRIVATE KEY-----"),
    new RegExp("sb_" + "secret_[a-z0-9_-]+", "i"),
  ];

  for (const file of repoFiles()) {
    const contents = readFileSync(file, "utf8");
    for (const pattern of secretPatterns) {
      assert.equal(pattern.test(contents), false, `${file} matched ${pattern}`);
    }
  }
});
