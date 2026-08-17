import { mergeSnapshots, normalizeSnapshot } from "./snapshot.js";

const ACCOUNT_ID = "primary";
const MAX_SNAPSHOT_BYTES = 1_000_000;

function allowedOrigin(request, environment) {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allowed = (environment.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : false;
}

function headers(origin) {
  const result = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin) {
    result.set("Access-Control-Allow-Origin", origin);
    result.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    result.set("Access-Control-Allow-Methods", "GET, PUT, OPTIONS");
    result.set("Vary", "Origin");
  }
  return result;
}

function json(value, status = 200, origin = null) {
  return new Response(JSON.stringify(value), { status, headers: headers(origin) });
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function authorized(request, environment) {
  const expected = environment.SYNC_TOKEN;
  const authorization = request.headers.get("Authorization") ?? "";
  if (!expected || !authorization.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  const [left, right] = await Promise.all([digest(supplied), digest(expected)]);
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function readSnapshot(database) {
  const row = await database
    .prepare("SELECT revision, data_json, updated_at FROM fast_data WHERE account_id = ?1")
    .bind(ACCOUNT_ID)
    .first();
  if (!row) return null;
  return {
    data: normalizeSnapshot(JSON.parse(row.data_json)),
    revision: Number(row.revision),
    updatedAt: row.updated_at,
  };
}

async function mergeAndStore(database, incoming) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readSnapshot(database);
    const data = mergeSnapshots(current?.data ?? null, incoming);
    const dataJson = JSON.stringify(data);
    const updatedAt = new Date().toISOString();

    if (!current) {
      const inserted = await database
        .prepare("INSERT OR IGNORE INTO fast_data (account_id, revision, data_json, updated_at) VALUES (?1, 1, ?2, ?3)")
        .bind(ACCOUNT_ID, dataJson, updatedAt)
        .run();
      if (inserted.meta.changes === 1) return { data, revision: 1, updatedAt };
      continue;
    }

    const revision = current.revision + 1;
    const updated = await database
      .prepare("UPDATE fast_data SET revision = ?1, data_json = ?2, updated_at = ?3 WHERE account_id = ?4 AND revision = ?5")
      .bind(revision, dataJson, updatedAt, ACCOUNT_ID, current.revision)
      .run();
    if (updated.meta.changes === 1) return { data, revision, updatedAt };
  }
  throw new Error("The cloud snapshot changed too many times; retry the request.");
}

export default {
  async fetch(request, environment) {
    const origin = allowedOrigin(request, environment);
    if (origin === false) return json({ error: "Origin not allowed" }, 403);
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: headers(origin) });
    }
    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "fast-thirteen-api" }, 200, origin);
    }
    if (url.pathname !== "/v1/data") return json({ error: "Not found" }, 404, origin);
    if (!(await authorized(request, environment))) {
      return json({ error: "A valid Fast Thirteen sync key is required" }, 401, origin);
    }

    try {
      if (request.method === "GET") {
        const stored = await readSnapshot(environment.DB);
        return json(stored ?? { data: null, revision: 0, updatedAt: null }, 200, origin);
      }
      if (request.method === "PUT") {
        const contentLength = Number(request.headers.get("Content-Length") ?? 0);
        if (contentLength > MAX_SNAPSHOT_BYTES) return json({ error: "Snapshot is too large" }, 413, origin);
        const text = await request.text();
        if (new TextEncoder().encode(text).byteLength > MAX_SNAPSHOT_BYTES) {
          return json({ error: "Snapshot is too large" }, 413, origin);
        }
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          throw new TypeError("A valid JSON snapshot is required.");
        }
        const incoming = normalizeSnapshot(body?.data ?? body);
        return json(await mergeAndStore(environment.DB, incoming), 200, origin);
      }
      return json({ error: "Method not allowed" }, 405, origin);
    } catch (error) {
      const invalid = error instanceof TypeError;
      return json(
        { error: invalid ? error.message : "Cloud data is temporarily unavailable" },
        invalid ? 400 : 503,
        origin,
      );
    }
  },
};
