import { next } from "@vercel/functions";
import {
  accessConfigured,
  accessResponse,
  clientIp,
  hasAccessCookie,
  isAllowedIp,
} from "./lib/accessGate.js";

export default async function middleware(request) {
  if (!accessConfigured()) {
    return new Response("Fast Thirteen access is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const url = new URL(request.url);
  if (url.pathname === "/api/unlock" && request.method === "POST") return next();
  if (["/v1/data", "/api/data"].includes(url.pathname)
      && ["GET", "PUT"].includes(request.method)) return next();

  const allowed = isAllowedIp(clientIp(request), process.env.FAST_THIRTEEN_ALLOWED_IPS);
  const signedIn = await hasAccessCookie(
    request.headers.get("cookie"),
    process.env.FAST_THIRTEEN_ACCESS_SESSION_SECRET,
  );
  if (allowed || signedIn) return next();

  if (request.method === "GET" && (url.pathname === "/" || url.pathname.endsWith(".html"))) {
    return accessResponse(url.searchParams.has("access-denied"));
  }
  return new Response("Access required", {
    status: 401,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
