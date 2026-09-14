/** Request plumbing: response helpers, HTMX detection, public share-link origin.
 *  Config (PORT) is passed in explicitly; this module owns no server state. */

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export const html = (body: string, status = 200, extra: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...extra } });

/* #71: same-page actions swap in place via HTMX instead of full reloads.
   HTMX sends HX-Request: true; no-JS clients keep the 302 fallback. */
export const isHtmx = (req: Request) => req.headers.get("hx-request") === "true";

/** Best-effort public origin for share links (honors reverse-proxy headers). */
export function publicOrigin(req: Request, port: number): string {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || `localhost:${port}`;
  const proto = req.headers.get("x-forwarded-proto")
    || (/^(localhost|127\.|10\.|192\.168\.)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}
