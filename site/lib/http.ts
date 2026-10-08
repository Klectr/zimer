/** Request plumbing: response helpers, HTMX detection, public share-link origin.
 *  Config (PORT) is passed in explicitly; this module owns no server state. */

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...extra } });

/* #71: same-page actions swap in place via HTMX instead of full reloads.
   HTMX sends HX-Request: true; no-JS clients keep the 302 fallback. */
export const isHtmx = (req: Request) => req.headers.get("hx-request") === "true";

/* #910: baseline security headers for every response. Attached at the server
   fetch boundary (server.ts) so HTML, JSON, static assets, PDFs, CSVs, and
   redirects are all covered in one place. The CSP allows the app's inline
   scripts ('unsafe-inline' — several views render <script> blocks) and htmx
   from the unpkg CDN; everything else is same-origin. Nonce-based tightening
   is a possible follow-up once inline scripts are refactored out. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** True when the request arrived over HTTPS (directly or via the proxy). */
export function isHttps(req: Request): boolean {
  const proto = req.headers.get("x-forwarded-proto")?.trim().toLowerCase()
    || new URL(req.url).protocol.replace(/:$/, "");
  return proto === "https";
}

/** Stamp the #910 security headers onto a response (headers are set, never
 *  appended, so re-wrapping is idempotent). HSTS only goes out over HTTPS —
 *  sending it on plain-HTTP origins (local dev, Tailscale) would tell the
 *  browser to refuse plain HTTP for that host for a year. */
export function secureResponse(res: Response, req?: Request): Response {
  for (const [k, v] of Object.entries(STATIC_SECURITY_HEADERS)) res.headers.set(k, v);
  if (req && isHttps(req)) {
    res.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return res;
}

/** Best-effort public origin for share links (honors reverse-proxy headers).
 *  Without proxy headers, trust the request's actual protocol (#225) — never
 *  guess from the host (a Tailscale IP is not localhost, but it is plain HTTP). */
export function publicOrigin(req: Request, port: number): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || `localhost:${port}`;
  const proto = req.headers.get("x-forwarded-proto") || new URL(req.url).protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

/** Client IP for rate limiting (#308). X-Real-IP is set by our nginx from the
 *  connecting IP, so it can't be spoofed. Falls back to the last
 *  X-Forwarded-For entry (the one our proxy appended), then "unknown" for
 *  direct connections (local dev). */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map(s => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return "unknown";
}
