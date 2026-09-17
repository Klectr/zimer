/** Request plumbing: response helpers, HTMX detection, public share-link origin.
 *  Config (PORT) is passed in explicitly; this module owns no server state. */

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...extra } });

/* #71: same-page actions swap in place via HTMX instead of full reloads.
   HTMX sends HX-Request: true; no-JS clients keep the 302 fallback. */
export const isHtmx = (req: Request) => req.headers.get("hx-request") === "true";

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
