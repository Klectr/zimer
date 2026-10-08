/** #910: security headers on every response. */
import { describe, expect, test } from "bun:test";
import { secureResponse, isHttps, html, publicOrigin, originMatches } from "./http.ts";

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

  test("#916: ignores non-http(s) forwarded protos", () => {
    expect(isHttps(new Request("http://x/", { headers: { "x-forwarded-proto": "javascript" } }))).toBe(false);
    expect(isHttps(new Request("http://x/", { headers: { "x-forwarded-proto": "HTTPS" } }))).toBe(true);
  });
});

describe("publicOrigin", () => {
  test("honors valid forwarded headers", () => {
    const req = new Request("http://127.0.0.1:8080/", {
      headers: { "x-forwarded-host": "zimer.example.com", "x-forwarded-proto": "https" },
    });
    expect(publicOrigin(req, 8080)).toBe("https://zimer.example.com");
  });

  test("#916: rejects non-http(s) forwarded protos", () => {
    const req = new Request("http://127.0.0.1:8080/", {
      headers: { "x-forwarded-proto": "javascript" },
    });
    expect(publicOrigin(req, 8080)).toBe("http://localhost:8080"); /* synthetic Request has no Host header */
  });

  test("#916: rejects malformed forwarded hosts, falls back to Host header", () => {
    for (const bad of ["evil.com@victim.com", "evil.com/path", "evil .com", "evil.com?q=1", ""]) {
      const req = new Request("http://127.0.0.1:8080/", {
        headers: { "host": "real.example.com", "x-forwarded-host": bad },
      });
      expect(publicOrigin(req, 8080)).toBe("http://real.example.com");
    }
  });

  test("#916: accepts host with port and bracketed IPv6", () => {
    const req = new Request("http://127.0.0.1:8080/", {
      headers: { "x-forwarded-host": "example.com:8443", "x-forwarded-proto": "HTTPS" },
    });
    expect(publicOrigin(req, 8080)).toBe("https://example.com:8443");
    const v6 = new Request("http://[::1]:8080/", { headers: { "x-forwarded-host": "[::1]:8080" } });
    expect(publicOrigin(v6, 8080)).toBe("http://[::1]:8080");
  });
});

describe("originMatches (#912)", () => {
  /* Bun's Request constructor doesn't populate the Host header from the URL,
     so set it explicitly — a real server connection always carries it. */
  const req = (url: string, headers: Record<string, string> = {}) => {
    const host = headers.host ?? new URL(url).host;
    return new Request(url, { method: "POST", headers: { ...headers, host } });
  };

  test("matching origin and host passes", () => {
    expect(originMatches(req("http://x/logout", { origin: "http://x" }))).toBe(true);
    expect(originMatches(req("http://127.0.0.1:8080/entries", { origin: "http://127.0.0.1:8080" }))).toBe(true);
  });

  test("mismatched origin is rejected", () => {
    expect(originMatches(req("http://x/logout", { origin: "http://evil.com" }))).toBe(false);
    expect(originMatches(req("http://x/logout", { origin: "http://x.evil.com" }))).toBe(false);
    expect(originMatches(req("http://x/logout", { origin: "https://x" }))).toBe(false); /* scheme differs only in port */
  });

  test("absent origin and referer is allowed (curl, stripped headers)", () => {
    expect(originMatches(req("http://x/logout"))).toBe(true);
  });

  test("referer is used when origin is absent", () => {
    expect(originMatches(req("http://x/logout", { referer: "http://x/timer" }))).toBe(true);
    expect(originMatches(req("http://x/logout", { referer: "http://evil.com/" }))).toBe(false);
  });

  test("unparsable origin fails closed", () => {
    expect(originMatches(req("http://x/logout", { origin: "not a url" }))).toBe(false);
  });

  test("default ports are normalized", () => {
    expect(originMatches(req("https://example.com/", { origin: "https://example.com", host: "example.com" }))).toBe(true);
    expect(originMatches(req("http://example.com/", { origin: "http://example.com", host: "example.com:80" }))).toBe(true);
  });

  test("explicit non-default ports must match exactly", () => {
    const r = (o: string, h: string) => req("http://example.com:8080/", { origin: o, host: h });
    expect(originMatches(r("http://example.com:8080", "example.com:8080"))).toBe(true);
    expect(originMatches(r("http://example.com:9090", "example.com:8080"))).toBe(false);
    expect(originMatches(r("http://example.com", "example.com:8080"))).toBe(false);
  });

  test("host comparison is case-insensitive", () => {
    expect(originMatches(req("http://x/logout", { origin: "http://X", host: "x" }))).toBe(true);
  });

  test("x-forwarded-host is honored behind the proxy", () => {
    const r = new Request("http://127.0.0.1:8080/logout", {
      method: "POST",
      headers: { origin: "https://invoice.klectr.dev", "x-forwarded-host": "invoice.klectr.dev", "x-forwarded-proto": "https" },
    });
    expect(originMatches(r)).toBe(true);
  });

  test("malformed forwarded host fails closed", () => {
    const r = new Request("http://127.0.0.1:8080/logout", {
      method: "POST",
      headers: { origin: "https://invoice.klectr.dev", "x-forwarded-host": "evil.com@invoice.klectr.dev" },
    });
    expect(originMatches(r)).toBe(false);
  });
});
