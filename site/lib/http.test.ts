/** #910: security headers on every response. */
import { describe, expect, test } from "bun:test";
import { secureResponse, isHttps, html } from "./http.ts";

describe("secureResponse", () => {
  test("adds the baseline headers to a bare response", () => {
    const res = secureResponse(new Response("ok"));
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("Permissions-Policy")).toContain("camera=()");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("https://unpkg.com"); // htmx CDN, per repo AGENTS.md
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("*"); // no wildcard sources
  });

  test("preserves status and original headers", () => {
    const res = secureResponse(html("<p>hi</p>", 200));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  test("no HSTS without a request, or over plain HTTP", () => {
    expect(secureResponse(new Response("ok")).headers.get("Strict-Transport-Security")).toBeNull();
    const plain = new Request("http://127.0.0.1:8080/");
    expect(secureResponse(new Response("ok"), plain).headers.get("Strict-Transport-Security")).toBeNull();
  });

  test("HSTS only over HTTPS", () => {
    const proxied = new Request("http://127.0.0.1:8080/", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(secureResponse(new Response("ok"), proxied).headers.get("Strict-Transport-Security"))
      .toContain("max-age=31536000");
    const direct = new Request("https://invoice.klectr.dev/i/abc");
    expect(secureResponse(new Response("ok"), direct).headers.get("Strict-Transport-Security"))
      .toContain("includeSubDomains");
  });
});

describe("isHttps", () => {
  test("trusts x-forwarded-proto, falls back to the URL scheme", () => {
    expect(isHttps(new Request("http://x/", { headers: { "x-forwarded-proto": "https" } }))).toBe(true);
    expect(isHttps(new Request("https://x/"))).toBe(true);
    expect(isHttps(new Request("http://127.0.0.1:8080/"))).toBe(false);
    expect(isHttps(new Request("http://x/", { headers: { "x-forwarded-proto": "http" } }))).toBe(false);
  });
});
