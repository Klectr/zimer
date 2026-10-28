/** #827: the auth pages' floating labels are wired to their fields via
 *  matching id/for, completing the label-wiring pass (#709 pattern). */
import { describe, expect, test } from "bun:test";
import { createPublicViews } from "./public.ts";

const views = createPublicViews({
  getInvoice: () => null,
  invoiceTotals: () => ({}),
  invoiceDocumentHtml: () => "",
  ensurePublicToken: () => "",
} as any);

describe("auth labels (#827)", () => {
  test("token login label is wired", () => {
    const html = views.loginPage();
    expect(html).toContain('id="login-token"');
    expect(html).toContain('<label for="login-token">');
  });

  test("signup labels are wired", () => {
    const html = views.signupPage();
    for (const id of ["su-email", "su-password"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label for="${id}">`);
    }
  });

  test("hosted login labels are wired", () => {
    const html = views.hostedLoginPage();
    for (const id of ["li-email", "li-password"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label for="${id}">`);
    }
  });

  test("#981: auth pages load the utm stash script", () => {
    expect(views.signupPage()).toContain("/static/utm.js");
    expect(views.hostedLoginPage()).toContain("/static/utm.js");
  });
});

/** #924: OG + Twitter card tags on public pages. */
describe("social meta tags (#924)", () => {
  const inv: any = {
    id: 1, number: "INV-0001", tax_rate: 0, stripe_payment_link: "",
    items: [], public_token: "abc123",
  };
  test("public invoice page has generic OG tags, no PII", () => {
    const html = (views as any).publicInvoicePage(inv, "https://zimer.klectr.dev", "/i/abc123");
    for (const tag of [
      'property="og:title" content="Zinvoice · Zimer"',
      'property="og:url" content="https://zimer.klectr.dev/i/abc123"',
      'property="og:image" content="https://zimer.klectr.dev/static/og-image.png"',
      'property="og:image:width" content="2240"',
      'name="twitter:card" content="summary_large_image"',
    ]) expect(html).toContain(tag);
    expect(html).not.toContain("Acme"); // client names never leak
  });
  test("changelog page has OG tags", () => {
    const html = (views as any).changelogPage([], "https://zimer.klectr.dev");
    expect(html).toContain('property="og:title" content="Changelog · Zimer"');
    expect(html).toContain('property="og:url" content="https://zimer.klectr.dev/changelog"');
    expect(html).toContain('property="og:image" content="https://zimer.klectr.dev/static/og-image-v3.png"');
  });
});

describe("indexing split (#1050)", () => {
  test("public content pages are indexable; auth and invoice pages are not", () => {
    const v = views as any;
    expect(v.changelogPage([], "https://example.com")).not.toContain('content="noindex"');
    expect(v.termsPage([])).not.toContain('content="noindex"');
    expect(v.privacyPage()).not.toContain('content="noindex"');
    expect(v.loginPage()).toContain('content="noindex"');
    expect(v.signupPage()).toContain('content="noindex"');
    expect(v.hostedLoginPage()).toContain('content="noindex"');
    const inv: any = { id: 1, number: "INV-0001", tax_rate: 0, stripe_payment_link: "", items: [], public_token: "abc123" };
    expect(v.publicInvoicePage(inv, "https://example.com", "/i/abc123")).toContain('content="noindex"');
  });
});
