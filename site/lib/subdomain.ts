/** #734: hosted subdomain tenant routing — extract <slug> from a Host header.
 *
 *  Pure function (no env, no DB) so the matching rule is unit-testable
 *  without a server. `host` is the raw Host header value (may carry a
 *  :port); `hostedDomain` is the HOSTED_DOMAIN env value. Returns the slug
 *  when host is exactly <slug>.HOSTED_DOMAIN, else null:
 *    - hostedDomain empty → routing disabled, always null (no crash)
 *    - bare domain (host === hostedDomain) → null (session fallback)
 *    - foreign host or missing/odd header → null
 */

export function subdomainFromHost(
  host: string | null,
  hostedDomain: string
): string | null {
  const domain = hostedDomain.trim().toLowerCase();
  if (!domain) return null;
  /* Strip the port — and a trailing-dot FQDN form, which browsers allow. */
  const h = (host || "").split(":")[0].trim().toLowerCase().replace(/\.$/, "");
  if (!h || h === domain || !h.endsWith("." + domain)) return null;
  const slug = h.slice(0, h.length - domain.length - 1);
  return slug || null;
}
