import test from "node:test";
import assert from "node:assert/strict";
import { GET, PUT } from "../api/data.js";

test("Vercel relay forwards the existing sync key to the unchanged Cloudflare endpoint", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ data: null, revision: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await GET(new Request("https://fast13.vercel.app/api/data", {
      headers: { Authorization: "Bearer private-test-token", Origin: "https://fast13.vercel.app" },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), { data: null, revision: 0 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://fast-api.thedavedev.com/v1/data");
    assert.equal(calls[0].options.headers.Authorization, "Bearer private-test-token");
    assert.equal(calls[0].options.headers.Origin, undefined);
    assert.equal(calls[0].options.redirect, "manual");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vercel relay rejects missing credentials and oversized uploads before forwarding", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded = false;
  globalThis.fetch = async () => { forwarded = true; throw new Error("Unexpected fetch"); };

  try {
    assert.equal((await GET(new Request("https://fast13.vercel.app/api/data"))).status, 401);
    const oversized = new Uint8Array(1_000_001);
    const response = await PUT(new Request("https://fast13.vercel.app/api/data", {
      method: "PUT",
      headers: { Authorization: "Bearer private-test-token" },
      body: oversized,
      duplex: "half",
    }));
    assert.equal(response.status, 413);
    assert.equal(forwarded, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vercel relay preserves PUT snapshots and Cloudflare revision responses", async () => {
  const originalFetch = globalThis.fetch;
  const snapshot = JSON.stringify({ version: 3, sessions: [] });
  let forwardedBody;
  globalThis.fetch = async (_url, options) => {
    forwardedBody = new TextDecoder().decode(options.body);
    return new Response(JSON.stringify({ revision: 7, data: { version: 3, sessions: [] } }), {
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const response = await PUT(new Request("https://fast13.vercel.app/api/data", {
      method: "PUT",
      headers: { Authorization: "Bearer private-test-token", "Content-Type": "application/json" },
      body: snapshot,
    }));
    assert.equal(forwardedBody, snapshot);
    assert.equal((await response.json()).revision, 7);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
