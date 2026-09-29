const COOKIE_NAME = "__Host-fast13-access";
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const encoder = new TextEncoder();

function ipv4Number(value) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) {
    return null;
  }
  return parts.reduce((number, part) => (number * 256 + Number(part)) >>> 0, 0);
}

export function isAllowedIp(clientIp, allowedIps = "") {
  if (!clientIp) return false;
  return allowedIps.split(",").some((entry) => {
    const allowed = entry.trim();
    if (allowed.toLowerCase() === clientIp.toLowerCase()) return true;
    const [network, prefix, extra] = allowed.split("/");
    if (extra !== undefined || !/^(?:[0-9]|[12][0-9]|3[0-2])$/.test(prefix ?? "")) return false;
    const address = ipv4Number(clientIp);
    const base = ipv4Number(network);
    if (address === null || base === null) return false;
    const mask = prefix === "0" ? 0 : (0xffffffff << (32 - Number(prefix))) >>> 0;
    return (address & mask) === (base & mask);
  });
}

export function clientIp(request) {
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export function accessConfigured(environment = process.env) {
  return Boolean(environment.FAST_THIRTEEN_ACCESS_PASSWORD)
    && (environment.FAST_THIRTEEN_ACCESS_SESSION_SECRET?.length ?? 0) >= 32;
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return crypto.subtle.sign("HMAC", key, encoder.encode(value));
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function passwordMatches(value, expected) {
  if (typeof value !== "string" || typeof expected !== "string" || !expected) return false;
  const [actualHash, expectedHash] = await Promise.all(
    [value, expected].map((text) => crypto.subtle.digest("SHA-256", encoder.encode(text))),
  );
  const actual = new Uint8Array(actualHash);
  const reference = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual[index] ^ reference[index];
  }
  return difference === 0;
}

export async function createAccessCookie(secret, now = Date.now()) {
  const expires = Math.floor(now / 1000) + SESSION_SECONDS;
  const signature = hex(await hmac(String(expires), secret));
  return `${COOKIE_NAME}=${expires}.${signature}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export async function hasAccessCookie(cookieHeader, secret, now = Date.now()) {
  if (!secret || !cookieHeader) return false;
  const raw = cookieHeader.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  const match = /^(\d{10})\.([a-f0-9]{64})$/.exec(raw ?? "");
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires <= Math.floor(now / 1000) || expires > Math.floor(now / 1000) + SESSION_SECONDS) return false;
  const signature = hex(await hmac(match[1], secret));
  let difference = 0;
  for (let index = 0; index < signature.length; index += 1) {
    difference |= signature.charCodeAt(index) ^ match[2].charCodeAt(index);
  }
  return difference === 0;
}

export function accessPage(incorrect = false) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Fast Thirteen access</title>
<style>body{min-height:100vh;display:grid;place-items:center;margin:0;background:#10151e;color:#f5f7fb;font:16px system-ui,sans-serif}main{width:min(22rem,calc(100% - 3rem));padding:2rem;border:1px solid #344052;border-radius:1rem;background:#192231}h1{margin:0 0 .5rem;font-size:1.5rem}p{color:#b9c5d5}label{display:block;margin:1.5rem 0 .5rem}input,button{box-sizing:border-box;width:100%;padding:.8rem;border-radius:.5rem;font:inherit}input{border:1px solid #77879e}button{margin-top:1rem;border:0;background:#73dcde;color:#102026;font-weight:700;cursor:pointer}.error{color:#ffb4b4}</style>
</head><body><main><h1>Fast Thirteen</h1><p>Enter the access password to continue.</p>
${incorrect ? '<p class="error" role="alert">Incorrect password. Try again.</p>' : ""}
<form action="/api/unlock" method="post"><label for="password">Password</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit">Continue</button></form></main></body></html>`;
}

export function accessResponse(incorrect = false) {
  return new Response(accessPage(incorrect), {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}
