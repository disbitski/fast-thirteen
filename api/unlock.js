import {
  accessConfigured,
  accessResponse,
  createAccessCookie,
  passwordMatches,
} from "../lib/accessGate.js";

export async function POST(request) {
  if (!accessConfigured()) return new Response("Access is not configured", { status: 503 });

  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin) return new Response("Forbidden", { status: 403 });

  const body = await request.text();
  if (body.length > 4096) return new Response("Request too large", { status: 413 });
  const password = new URLSearchParams(body).get("password");
  if (!(await passwordMatches(password, process.env.FAST_THIRTEEN_ACCESS_PASSWORD))) {
    return accessResponse(true);
  }

  return new Response(null, {
    status: 303,
    headers: {
      "Cache-Control": "no-store",
      "Location": "/",
      "Set-Cookie": await createAccessCookie(process.env.FAST_THIRTEEN_ACCESS_SESSION_SECRET),
    },
  });
}
