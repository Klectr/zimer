/** #734: Host-header → workspace slug matching rules. */
import { describe, expect, test } from "bun:test";
import { subdomainFromHost } from "./subdomain.ts";

describe("subdomainFromHost (#734)", () => {
  test("extracts the slug from <slug>.HOSTED_DOMAIN", () => {
    expect(subdomainFromHost("acme.example.com", "example.com")).toBe("acme");
    expect(subdomainFromHost("my-shop-2.example.com", "example.com")).toBe("my-shop-2");
  });

  test("strips the port", () => {
    expect(subdomainFromHost("acme.example.com:3000", "example.com")).toBe("acme");
  });

  test("bare domain is not a subdomain (session fallback)", () => {
    expect(subdomainFromHost("example.com", "example.com")).toBeNull();
    expect(subdomainFromHost("example.com:3000", "example.com")).toBeNull();
  });

  test("foreign hosts never match", () => {
    expect(subdomainFromHost("acme.other.com", "example.com")).toBeNull();
    expect(subdomainFromHost("example.com.evil.com", "example.com")).toBeNull();
    expect(subdomainFromHost("notexample.com", "example.com")).toBeNull();
  });

  test("empty HOSTED_DOMAIN disables routing (no crash)", () => {
    expect(subdomainFromHost("acme.example.com", "")).toBeNull();
    expect(subdomainFromHost("acme.example.com", "   ")).toBeNull();
  });

  test("missing or degenerate Host headers", () => {
    expect(subdomainFromHost(null, "example.com")).toBeNull();
    expect(subdomainFromHost("", "example.com")).toBeNull();
    expect(subdomainFromHost(".example.com", "example.com")).toBeNull();
  });

  test("matching is case-insensitive", () => {
    expect(subdomainFromHost("ACME.Example.COM", "example.com")).toBe("acme");
  });
});
