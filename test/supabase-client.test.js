import test from "node:test";
import assert from "node:assert/strict";
import {
  createBrowserSupabaseClient,
  getSupabaseCreateClient,
} from "../src/supabaseClient.js";

const configured = {
  supabaseUrl: "https://example.supabase.co",
  supabaseAnonKey: "sb_publishable_test",
  isConfigured: true,
};

test("browser Supabase client stays disabled without publishable config", () => {
  assert.deepEqual(createBrowserSupabaseClient({ config: { isConfigured: false } }), {
    client: null,
    message: "Supabase config is missing.",
    status: "disabled",
  });
});

test("browser Supabase client reports not-ready when SDK is missing", () => {
  assert.deepEqual(createBrowserSupabaseClient({ config: configured, source: {} }), {
    client: null,
    message: "Supabase browser client is not loaded.",
    status: "not-ready",
  });
});

test("browser Supabase client creates SDK client with browser auth options", () => {
  const createdClient = { auth: {} };
  const calls = [];
  const result = createBrowserSupabaseClient({
    config: configured,
    createClient(...args) {
      calls.push(args);
      return createdClient;
    },
  });

  assert.equal(result.client, createdClient);
  assert.equal(result.status, "ready");
  assert.deepEqual(calls, [
    [
      "https://example.supabase.co",
      "sb_publishable_test",
      {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: true,
          persistSession: true,
        },
      },
    ],
  ]);
});

test("finds Supabase createClient from browser global", () => {
  function createClient(url, key) {
    return { key, url };
  }

  const factory = getSupabaseCreateClient({ supabase: { createClient } });
  assert.deepEqual(factory("https://example.supabase.co", "key"), {
    key: "key",
    url: "https://example.supabase.co",
  });
  assert.equal(getSupabaseCreateClient({}), null);
});
