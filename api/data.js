const CLOUD_DATA_URL = "https://fast-api.thedavedev.com/v1/data";
const MAX_SNAPSHOT_BYTES = 1_000_000;

async function limitedBody(stream) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_SNAPSHOT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function forward(request, method) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer \S+$/.test(authorization)) {
    return new Response(JSON.stringify({ error: "A private sync key is required" }), {
      status: 401,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    });
  }

  const body = method === "PUT" ? await limitedBody(request.body) : undefined;
  if (body === null) return new Response("Snapshot is too large", { status: 413 });

  try {
    const upstream = await fetch(CLOUD_DATA_URL, {
      method,
      headers: {
        Authorization: authorization,
        ...(method === "PUT" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method === "PUT" ? { body } : {}),
      cache: "no-store",
      redirect: "manual",
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      throw new Error("Unexpected redirect from Cloudflare");
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": upstream.headers.get("content-type") ?? "application/json",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Cloud sync is temporarily unavailable" }), {
      status: 502,
      headers: { "Cache-Control": "no-store", "Content-Type": "application/json" },
    });
  }
}

export const GET = (request) => forward(request, "GET");
export const PUT = (request) => forward(request, "PUT");
