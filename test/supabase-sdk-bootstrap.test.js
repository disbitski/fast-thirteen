import test from "node:test";
import assert from "node:assert/strict";
import {
  SUPABASE_BROWSER_SDK_URL,
  SUPABASE_BROWSER_SDK_VERSION,
  createSupabaseSdkBootstrap,
} from "../src/supabaseSdkBootstrap.js";

const configured = {
  authRedirectOrigins: ["http://127.0.0.1:4173"],
  googleProviderEnabled: true,
  supabaseUrl: "https://example.supabase.co",
  supabaseAnonKey: "sb_publishable_test",
  isConfigured: true,
};

test("missing config skips SDK loading and keeps local tracking available", async () => {
  let loadCount = 0;
  const bootstrap = createSupabaseSdkBootstrap({
    loadSdk() {
      loadCount += 1;
    },
  });

  const result = await bootstrap.load({ config: { isConfigured: false }, source: {} });

  assert.equal(loadCount, 0);
  assert.equal(result.status, "disabled");
  assert.equal(result.client, null);
  assert.equal(result.dataMutated, false);
  assert.equal(result.localTrackingAvailable, true);
});

test("configured bootstrap loads the pinned browser SDK and creates one client", async () => {
  const calls = [];
  const client = { auth: {} };
  const bootstrap = createSupabaseSdkBootstrap({
    async loadSdk() {
      return (...args) => {
        calls.push(args);
        return client;
      };
    },
  });

  const pending = bootstrap.load({ config: configured, source: {} });
  assert.equal(bootstrap.current().status, "loading");

  const result = await pending;
  assert.equal(result.status, "ready");
  assert.equal(result.client, client);
  assert.equal(result.sdkVersion, SUPABASE_BROWSER_SDK_VERSION);
  assert.equal(result.sdkUrl, SUPABASE_BROWSER_SDK_URL);
  assert.deepEqual(calls[0].slice(0, 2), [configured.supabaseUrl, configured.supabaseAnonKey]);
});

test("SDK load failure falls back without changing local data", async () => {
  const localData = Object.freeze({
    sessions: Object.freeze([{ id: "local-session" }]),
    sync: Object.freeze({ status: "local" }),
  });
  const before = JSON.stringify(localData);
  const bootstrap = createSupabaseSdkBootstrap({
    async loadSdk() {
      throw new Error("network unavailable");
    },
  });

  const result = await bootstrap.load({ config: configured, source: {} });

  assert.equal(result.status, "error");
  assert.match(result.message, /Guest mode and Local data remain available/);
  assert.equal(result.dataMutated, false);
  assert.equal(result.localTrackingAvailable, true);
  assert.equal(JSON.stringify(localData), before);
});

test("concurrent bootstrap calls share one SDK load and one client", async () => {
  let release;
  let loadCount = 0;
  let createCount = 0;
  const bootstrap = createSupabaseSdkBootstrap({
    loadSdk() {
      loadCount += 1;
      return new Promise((resolve) => {
        release = () => resolve(() => {
          createCount += 1;
          return { auth: {} };
        });
      });
    },
  });

  const first = bootstrap.load({ config: configured, source: {} });
  const second = bootstrap.load({ config: configured, source: {} });
  assert.equal(first, second);
  await Promise.resolve();
  release();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult, secondResult);
  assert.equal(loadCount, 1);
  assert.equal(createCount, 1);
  assert.equal(firstResult.status, "ready");
});
