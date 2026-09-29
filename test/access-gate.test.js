import test from "node:test";
import assert from "node:assert/strict";
import {
  accessConfigured,
  clientIp,
  createAccessCookie,
  hasAccessCookie,
  isAllowedIp,
  passwordMatches,
} from "../lib/accessGate.js";
import middleware from "../middleware.js";
import { POST as unlock } from "../api/unlock.js";

const secret = "a-long-random-session-secret-for-test-only";

test("only Vercel's client IP header can bypass the password", () => {
  const request = new Request("https://fast13.vercel.app/", {
    headers: {
      "x-vercel-forwarded-for": "203.0.113.12",
      "x-forwarded-for": "198.51.100.99",
    },
  });

  assert.equal(clientIp(request), "203.0.113.12");
  assert.equal(isAllowedIp(clientIp(request), "203.0.113.12,198.51.100.0/24"), true);
  assert.equal(isAllowedIp(clientIp(request), "198.51.100.99"), false);
  assert.equal(isAllowedIp(null, "203.0.113.12"), false);
});

test("IP ranges match only valid addresses within the configured range", () => {
  assert.equal(isAllowedIp("198.51.100.42", "198.51.100.0/24"), true);
  assert.equal(isAllowedIp("198.51.101.42", "198.51.100.0/24"), false);
  assert.equal(isAllowedIp("198.51.100.42", "198.51.100.0/33"), false);
  assert.equal(isAllowedIp("198.51.100.42", "198.51.100.999/24"), false);
});

test("password access fails closed without both deployment secrets", () => {
  assert.equal(accessConfigured({ FAST_THIRTEEN_ACCESS_PASSWORD: "example-only" }), false);
  assert.equal(accessConfigured({ FAST_THIRTEEN_ACCESS_SESSION_SECRET: secret }), false);
  assert.equal(accessConfigured({
    FAST_THIRTEEN_ACCESS_PASSWORD: "example-only",
    FAST_THIRTEEN_ACCESS_SESSION_SECRET: secret,
  }), true);
});

test("signed access cookie expires and rejects edits", async () => {
  const now = Date.parse("2026-09-29T12:00:00Z");
  const cookie = (await createAccessCookie(secret, now)).split(";")[0];

  assert.equal(await hasAccessCookie(cookie, secret, now), true);
  assert.equal(await hasAccessCookie(cookie, "a-different-long-secret-for-test-only", now), false);
  const editedCookie = `${cookie.slice(0, -1)}${cookie.endsWith("0") ? "1" : "0"}`;
  assert.equal(await hasAccessCookie(editedCookie, secret, now), false);
  assert.equal(await hasAccessCookie(cookie, secret, now + 8 * 24 * 60 * 60 * 1000), false);
});

test("only the configured password passes", async () => {
  assert.equal(await passwordMatches("example-only", "example-only"), true);
  assert.equal(await passwordMatches("another-value", "example-only"), false);
  assert.equal(await passwordMatches(null, "example-only"), false);
});

test("middleware protects pages and assets unless the client IP is allowed", async () => {
  const previous = {
    password: process.env.FAST_THIRTEEN_ACCESS_PASSWORD,
    secret: process.env.FAST_THIRTEEN_ACCESS_SESSION_SECRET,
    ips: process.env.FAST_THIRTEEN_ALLOWED_IPS,
  };
  process.env.FAST_THIRTEEN_ACCESS_PASSWORD = "example-only";
  process.env.FAST_THIRTEEN_ACCESS_SESSION_SECRET = secret;
  process.env.FAST_THIRTEEN_ALLOWED_IPS = "203.0.113.12";

  try {
    const page = await middleware(new Request("https://fast13.vercel.app/"));
    const asset = await middleware(new Request("https://fast13.vercel.app/src/app.js"));
    const trusted = await middleware(new Request("https://fast13.vercel.app/", {
      headers: { "x-vercel-forwarded-for": "203.0.113.12" },
    }));
    const sync = await middleware(new Request("https://fast13.vercel.app/v1/data", {
      headers: { Authorization: "Bearer private-test-token" },
    }));
    assert.equal(page.status, 401);
    assert.match(await page.text(), /Enter the access password/);
    assert.equal(asset.status, 401);
    assert.equal(trusted.headers.get("x-middleware-next"), "1");
    assert.equal(sync.headers.get("x-middleware-next"), "1");
  } finally {
    for (const [key, value] of [
      ["FAST_THIRTEEN_ACCESS_PASSWORD", previous.password],
      ["FAST_THIRTEEN_ACCESS_SESSION_SECRET", previous.secret],
      ["FAST_THIRTEEN_ALLOWED_IPS", previous.ips],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("unlock only sets an access cookie for the correct same-origin password", async () => {
  const previousPassword = process.env.FAST_THIRTEEN_ACCESS_PASSWORD;
  const previousSecret = process.env.FAST_THIRTEEN_ACCESS_SESSION_SECRET;
  process.env.FAST_THIRTEEN_ACCESS_PASSWORD = "example-only";
  process.env.FAST_THIRTEEN_ACCESS_SESSION_SECRET = secret;

  const attempt = (password, origin = "https://fast13.vercel.app") => unlock(new Request(
    "https://fast13.vercel.app/api/unlock",
    {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password }),
    },
  ));

  try {
    assert.equal((await attempt("example-only", "https://elsewhere.example")).status, 403);
    assert.equal((await attempt("incorrect")).headers.has("set-cookie"), false);
    const accepted = await attempt("example-only");
    assert.equal(accepted.status, 303);
    assert.equal(accepted.headers.get("location"), "/");
    assert.match(accepted.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
  } finally {
    if (previousPassword === undefined) delete process.env.FAST_THIRTEEN_ACCESS_PASSWORD;
    else process.env.FAST_THIRTEEN_ACCESS_PASSWORD = previousPassword;
    if (previousSecret === undefined) delete process.env.FAST_THIRTEEN_ACCESS_SESSION_SECRET;
    else process.env.FAST_THIRTEEN_ACCESS_SESSION_SECRET = previousSecret;
  }
});
