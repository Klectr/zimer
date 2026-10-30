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

/** #1059: every indexable public page carries a meta description and a
    self-referencing canonical; terms/privacy get OG tags like the rest. */
describe("public page heads (#1059)", () => {
  const v = views as any;
  test("changelog has a description and canonical", () => {
    const html = v.changelogPage([], "https://example.com");
    expect(html).toContain('<meta name="description" content="What\'s new in Zimer: release notes, fixes, and product changes.">');
    expect(html).toContain('<link rel="canonical" href="https://example.com/changelog">');
  });
  test("terms has a description, canonical, and OG tags", () => {
    const html = v.termsPage([], "https://example.com");
    expect(html).toContain('<meta name="description" content="Zimer terms of service: the $12/month hosted plan with a 14-day free trial, 30-day refunds, and the free-forever self-hosted option.">');
    expect(html).toContain('<link rel="canonical" href="https://example.com/terms">');
    expect(html).toContain('property="og:title" content="Terms of service · Zimer"');
    expect(html).toContain('property="og:url" content="https://example.com/terms"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });
  test("privacy has a description, canonical, and OG tags", () => {
    const html = v.privacyPage("https://example.com");
    expect(html).toContain('<meta name="description" content="Zimer privacy policy: what we store, where it lives, what we never do with your data, and how to delete your account.">');
    expect(html).toContain('<link rel="canonical" href="https://example.com/privacy">');
    expect(html).toContain('property="og:title" content="Privacy policy · Zimer"');
    expect(html).toContain('property="og:url" content="https://example.com/privacy"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });
});

/** #1069: the privacy page discloses the PostHog analytics the hosted site
    actually runs, with links out to PostHog. */
describe("privacy analytics disclosure (#1069)", () => {
  const v = views as any;
  test("privacy names PostHog, what it records, and links its privacy policy", () => {
    const html = v.privacyPage("https://example.com");
    expect(html).toContain("Analytics");
    expect(html).toContain('<a href="https://posthog.com" target="_blank" rel="noopener">PostHog</a>');
    expect(html).toContain('<a href="https://posthog.com/privacy" target="_blank" rel="noopener">posthog.com/privacy</a>');
    expect(html).toContain("records sessions (a replay of the visit)");
    expect(html).toContain("tied to your account ID, never your email");
    expect(html).toContain("Self-hosted instances send us nothing.");
    expect(html).toContain("The analytics we run on this site is the PostHog disclosure above.");
    expect(html.indexOf("Analytics")).toBeLessThan(html.indexOf("What we don&#39;t do"));
  });
  test("terms sections stay plain text (the html flag is opt-in)", () => {
    const html = v.termsPage([{ heading: "H", body: "<b>not bold</b>" }], "https://example.com");
    expect(html).toContain("&lt;b&gt;not bold&lt;/b&gt;");
    expect(html).not.toContain("<b>not bold</b>");
  });
});

describe("indexing split (#1050)", () => {
  test("public content pages are indexable; auth and invoice pages are not", () => {
    const v = views as any;
    expect(v.changelogPage([], "https://example.com")).not.toContain('content="noindex"');
    expect(v.termsPage([], "https://example.com")).not.toContain('content="noindex"');
    expect(v.privacyPage("https://example.com")).not.toContain('content="noindex"');
    expect(v.loginPage()).toContain('content="noindex"');
    expect(v.signupPage()).toContain('content="noindex"');
    expect(v.hostedLoginPage()).toContain('content="noindex"');
    const inv: any = { id: 1, number: "INV-0001", tax_rate: 0, stripe_payment_link: "", items: [], public_token: "abc123" };
    expect(v.publicInvoicePage(inv, "https://example.com", "/i/abc123")).toContain('content="noindex"');
  });
});
