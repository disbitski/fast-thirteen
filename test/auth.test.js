import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAuthService,
  mapAuthStateToProfile,
  mapSupabaseSession,
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
    session: null,
    status: "guest",
    user: null,
  });
  assert.deepEqual(await service.signInWithGoogle(), {
    ok: false,
    status: "disabled",
    message: "Google sign-in needs Supabase publishable config first.",
  });
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
