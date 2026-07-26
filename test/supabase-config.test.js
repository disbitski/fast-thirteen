import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_GLOBAL,
  loadSupabaseConfig,
  normalizeSupabaseConfig,
} from "../src/supabaseConfig.js";

test("missing Supabase browser config disables auth", () => {
  assert.deepEqual(loadSupabaseConfig({}), {
    authRedirectOrigins: [],
    googleProviderEnabled: false,
    supabaseUrl: null,
    supabaseAnonKey: null,
    migrationConfirmationsEnabled: false,
    migrationFinalizationEnabled: false,
    migrationWritesEnabled: false,
    profileConfirmationsEnabled: false,
    profileWritesEnabled: false,
    isConfigured: false,
  });
});

test("loads only browser-publishable Supabase config values", () => {
  const config = loadSupabaseConfig({
    [CONFIG_GLOBAL]: {
      supabaseUrl: " https://example.supabase.co/ ",
      supabaseAnonKey: " sb_publishable_test ",
      googleProviderEnabled: "true",
      authRedirectOrigins: [
        " http://127.0.0.1:4173/path ",
        "https://disbitski.github.io/fast-thirteen/",
        "http://127.0.0.1:4173",
        "javascript:alert(1)",
      ],
      migrationConfirmationsEnabled: "true",
      migrationFinalizationEnabled: "true",
      migrationWritesEnabled: "true",
      profileConfirmationsEnabled: "true",
      profileWritesEnabled: "true",
      serviceRoleKey: "must-not-leak",
      appleClientSecret: "must-not-leak",
    },
  });

  assert.deepEqual(config, {
    authRedirectOrigins: [
      "http://127.0.0.1:4173",
      "https://disbitski.github.io",
    ],
    googleProviderEnabled: true,
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "sb_publishable_test",
    migrationConfirmationsEnabled: true,
    migrationFinalizationEnabled: true,
    migrationWritesEnabled: true,
    profileConfirmationsEnabled: true,
    profileWritesEnabled: true,
    isConfigured: true,
  });
  assert.equal("serviceRoleKey" in config, false);
  assert.equal("appleClientSecret" in config, false);
});

test("rejects secret-looking Supabase keys in browser config", () => {
  assert.deepEqual(
    normalizeSupabaseConfig({
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "sb_" + "secret_bad-news",
    }),
    {
      authRedirectOrigins: [],
      googleProviderEnabled: false,
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: null,
      migrationConfirmationsEnabled: false,
      migrationFinalizationEnabled: false,
      migrationWritesEnabled: false,
      profileConfirmationsEnabled: false,
      profileWritesEnabled: false,
      isConfigured: false,
    },
  );
});
