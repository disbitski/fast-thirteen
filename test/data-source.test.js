import test from "node:test";
import assert from "node:assert/strict";
import {
  CLOUDFLARE_API_ORIGIN,
  cloudDataUrl,
  defaultDataSource,
  normalizeDataSource,
} from "../src/dataSource.js";

test("data source defaults to private cloud sync and keeps GitHub Pages sample mode local", () => {
  assert.deepEqual(defaultDataSource({ hostname: "192.168.86.50", origin: "http://192.168.86.50:4173" }), {
    mode: "cloud",
    cloudOrigin: CLOUDFLARE_API_ORIGIN,
  });
  assert.deepEqual(defaultDataSource({ hostname: "disbitski.github.io", origin: "https://disbitski.github.io" }), {
    mode: "local",
    cloudOrigin: CLOUDFLARE_API_ORIGIN,
  });
});

test("cloud data URLs are normalized and local mode does not make a network request", () => {
  const source = normalizeDataSource({ mode: "cloud", cloudOrigin: `${CLOUDFLARE_API_ORIGIN}/` });
  assert.equal(cloudDataUrl(source), `${CLOUDFLARE_API_ORIGIN}/v1/data`);
  assert.equal(cloudDataUrl({ ...source, mode: "local" }), null);
});
