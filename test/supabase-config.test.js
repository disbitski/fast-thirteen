import test from "node:test";
import assert from "node:assert/strict";
import {
  CONFIG_GLOBAL,
  loadSupabaseConfig,
  normalizeSupabaseConfig,
} from "../src/supabaseConfig.js";

test("missing Supabase browser config disables auth", () => {
  assert.deepEqual(loadSupabaseConfig({}), {
    supabaseUrl: null,
    supabaseAnonKey: null,
    migrationConfirmationsEnabled: false,
    migrationWritesEnabled: false,
    isConfigured: false,
  });
});

test("loads only browser-publishable Supabase config values", () => {
  const config = loadSupabaseConfig({
    [CONFIG_GLOBAL]: {
      supabaseUrl: " https://example.supabase.co/ ",
      supabaseAnonKey: " sb_publishable_test ",
      migrationConfirmationsEnabled: "true",
      migrationWritesEnabled: "true",
      serviceRoleKey: "must-not-leak",
      appleClientSecret: "must-not-leak",
    },
  });

  assert.deepEqual(config, {
    supabaseUrl: "https://example.supabase.co",
    supabaseAnonKey: "sb_publishable_test",
    migrationConfirmationsEnabled: true,
    migrationWritesEnabled: true,
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
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: null,
      migrationConfirmationsEnabled: false,
      migrationWritesEnabled: false,
      isConfigured: false,
    },
  );
});
