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
   is a possible follow-up once inline scripts are refactored out.
   #928: when POSTHOG_KEY is set, the PostHog snippet loads from their CDN
   and sends events to their ingestion host — allow both. The key is a
   server env var, so the CSP is fixed at startup. */
export function buildCsp(posthogEnabled: boolean): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://unpkg.com" + (posthogEnabled ? " https://*.posthog.com" : ""),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'" + (posthogEnabled ? " https://*.posthog.com" : ""),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}
const CSP = buildCsp(!!process.env.POSTHOG_KEY);

const STATIC_SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** True when the request arrived over HTTPS (directly or via the proxy). */
export function isHttps(req: Request): boolean {
  return (forwardedProto(req) || new URL(req.url).protocol.replace(/:$/, "")) === "https";
}

/* #911: the Secure cookie attribute, gated on HTTPS. Set-Cookie strings
   append this so local-dev and Tailscale plain-HTTP logins keep working
   while the HTTPS hosted site gets the protection. */
export function secureCookieAttr(req: Request): string {
  return isHttps(req) ? "; Secure" : "";
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

/* #993: gzip text responses at the origin. Compression otherwise exists only
   where Cloudflare provides it — Tailnet, direct, and self-host traffic got
   raw bytes (CSS 121 KB vs 29 KB gzipped). Applied at the same server fetch
   boundary as secureResponse so every route is covered in one place. Only
   responses a client asked to gzip, with a text-like content type and a body
   big enough to benefit; anything already encoded, ranged, or bodyless
   passes through untouched. */
const COMPRESSIBLE_TYPE = /^(?:text\/|application\/(?:json|javascript|xml|xhtml\+xml)|image\/svg\+xml)/;
const GZIP_MIN_BYTES = 1024;

function acceptsGzip(req: Request): boolean {
  let wildcard: boolean | null = null;
  for (const part of (req.headers.get("accept-encoding") || "").split(",")) {
    const [token, ...params] = part.split(";").map((s) => s.trim().toLowerCase());
    if (token !== "gzip" && token !== "*") continue;
    const q = params.find((p) => p.startsWith("q="));
    const ok = !q || parseFloat(q.slice(2)) > 0;
    if (token === "gzip") return ok; /* an explicit entry beats the wildcard */
    wildcard = ok;
  }
  return wildcard === true;
}

function withVary(headers: Headers): void {
  const vary = (headers.get("vary") || "").split(",").map((s) => s.trim().toLowerCase());
  if (!vary.includes("accept-encoding") && !vary.includes("*")) {
    headers.set("Vary", [...vary.filter(Boolean), "Accept-Encoding"].join(", "));
  }
}

export async function compressResponse(res: Response, req: Request): Promise<Response> {
  if (req.method === "HEAD" || res.status === 204 || res.status === 304) return res;
  if (res.headers.has("content-encoding") || res.headers.has("content-range")) return res;
  /* Bun.serve synthesizes 206 responses from the request's Range header and
     a file body after the handler returns — buffering the body here would
     silently turn them into full 200s, so range requests pass through. */
  if (req.headers.has("range")) return res;
  if (!COMPRESSIBLE_TYPE.test(res.headers.get("content-type") || "")) return res;
  if (!acceptsGzip(req)) { withVary(res.headers); return res; }
  const declaredHeader = res.headers.get("content-length");
  const declared = declaredHeader === null ? NaN : Number(declaredHeader);
  if (Number.isFinite(declared) && declared < GZIP_MIN_BYTES) { withVary(res.headers); return res; }
  const body = new Uint8Array(await res.arrayBuffer());
  const rebuild = (bytes: Uint8Array, encoded: boolean) => {
    const headers = new Headers(res.headers);
    withVary(headers);
    if (encoded) {
      headers.set("Content-Encoding", "gzip");
      headers.delete("Content-Length");
      /* The gzipped bytes are a different representation, so the identity
         body's strong ETag must not ride along verbatim — weaken it. */
      const etag = headers.get("etag");
      if (etag && !etag.startsWith("W/")) headers.set("ETag", `W/${etag}`);
    }
    return new Response(bytes, { status: res.status, statusText: res.statusText, headers });
  };
  if (body.byteLength < GZIP_MIN_BYTES) return rebuild(body, false);
  const gz = Bun.gzipSync(body);
  return gz.byteLength < body.byteLength ? rebuild(gz, true) : rebuild(body, false);
}

/* #916: X-Forwarded-Host/Proto are attacker-controlled input. Only values that
   can form a sane URL are honored — a syntactically valid host (no
   whitespace, @, /, ?, #) and http/https only. Anything else falls back to
   the direct Host header and the request's own scheme. */
const FORWARDED_HOST_RE = /^(\[[0-9a-f:.]+\]|[a-z0-9]([a-z0-9.-]*[a-z0-9])?)(:\d+)?$/i;

function forwardedHost(req: Request): string | null {
  const h = (req.headers.get("x-forwarded-host") || "").trim();
  return FORWARDED_HOST_RE.test(h) ? h : null;
}

function forwardedProto(req: Request): string | null {
  const p = (req.headers.get("x-forwarded-proto") || "").trim().toLowerCase();
  return p === "http" || p === "https" ? p : null;
}

/** Best-effort public origin for share links (honors reverse-proxy headers).
 *  Without proxy headers, trust the request's actual protocol (#225) — never
 *  guess from the host (a Tailscale IP is not localhost, but it is plain HTTP). */
export function publicOrigin(req: Request, port: number): string {
  const host = forwardedHost(req) || req.headers.get("host")?.trim() || `localhost:${port}`;
  const proto = forwardedProto(req) || new URL(req.url).protocol.replace(/:$/, "");
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

/** #912: CSRF guard for cookie-authenticated mutating routes. The app is
 *  same-origin — every form POST and htmx/fetch POST the UI makes carries an
 *  Origin (falling back to Referer) naming this host, while a cross-site
 *  forgery carries the attacker's origin (or a suppressed one). A present-
 *  but-mismatched origin is rejected; an absent one is allowed (curl, and
 *  proxies that strip the header) — SameSite=Lax cookies still cover the
 *  modern-browser POST path on top of this. The host is read through the same
 *  validated forwarded-host path publicOrigin() uses, so the check holds
 *  behind the nginx proxy. Bearer-token API calls stay exempt: tokens aren't
 *  ambient credentials, so there's nothing to forge, and the extension calls
 *  it cross-origin. #984: API calls authenticated by the session cookie ARE
 *  ambient, so api.ts applies this same check to cookie-authed mutations. */
export function originMatches(req: Request): boolean {
  const origin = req.headers.get("origin")?.trim() || req.headers.get("referer")?.trim();
  if (!origin) return true; /* nothing to judge */
  let o: URL, h: URL;
  try {
    o = new URL(origin);
    const host = forwardedHost(req) || req.headers.get("host")?.trim();
    if (!host) return false;
    /* Rebuild the request's own origin from the validated host and the
       request scheme (direct or x-forwarded-proto) — comparing origins, not
       bare hostnames, so ports and default-port normalization are handled by
       the URL parser itself. */
    const proto = forwardedProto(req) || new URL(req.url).protocol.replace(/:$/, "");
    h = new URL(`${proto}://${host}`);
  } catch {
    return false; /* unparsable origin or host — fail closed */
  }
  const portOf = (u: URL) => u.port || (u.protocol === "https:" ? "443" : "80");
  return o.hostname.toLowerCase() === h.hostname.toLowerCase() && portOf(o) === portOf(h);
}
