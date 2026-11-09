/** #827: the auth pages' floating labels are wired to their fields via
 *  matching id/for, completing the label-wiring pass (#709 pattern). */
import { describe, expect, test } from "bun:test";
import { createPublicViews } from "./public.ts";

const views = createPublicViews({
  getInvoice: () => null,
  invoiceTotals: () => ({}),
  businessName: () => "",
  ensurePublicToken: () => "",
} as any);

describe("auth labels (#827)", () => {
  test("token login label is wired", () => {
    const html = views.loginPage();
    expect(html).toContain('id="login-token"');
    expect(html).toContain('<label class="ui-field-label" for="login-token">');
  });

  test("signup labels are wired", () => {
    const html = views.signupPage();
    for (const id of ["su-email", "su-password"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label class="ui-field-label" for="${id}">`);
    }
  });

  test("hosted login labels are wired", () => {
    const html = views.hostedLoginPage();
    for (const id of ["li-email", "li-password"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label class="ui-field-label" for="${id}">`);
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
    expect(html).toContain("On the landing page it records page views and clicks.");
    expect(html).toContain("On the landing page and inside the app it records sessions (a replay of the visit)");
    expect(html).toContain("tied to your account ID, never your email");
    expect(html).toContain("Self-hosted instances send us nothing.");
    expect(html).toContain("The analytics we run on this site is described under Analytics above.");
    expect(html.indexOf("Analytics")).toBeLessThan(html.indexOf("What we don&#39;t do"));
  });
  test("terms sections stay plain text (the html flag is opt-in)", () => {
    const html = v.termsPage([{ heading: "H", body: "<b>not bold</b>" }], "https://example.com");
    expect(html).toContain("&lt;b&gt;not bold&lt;/b&gt;");
    expect(html).not.toContain("<b>not bold</b>");
    const raw = v.termsPage([{ heading: "H", body: "<b>bold</b>", html: true }], "https://example.com");
    expect(raw).toContain("<b>bold</b>");
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

/** #1121: public surfaces follow the page mocks — ui pay CTA on the public
 *  invoice, ui title/entry pattern on the changelog, ui headings on the
 *  legal pages. */
describe("public page-mock parity (#1121)", () => {
  test("pay CTA is the ui primary lg block link button with the secure-payment note", () => {
    const v = createPublicViews({
      getInvoice: () => null,
      invoiceTotals: () => ({ total: 120 }),
      businessName: () => "Acme Studio",
      ensurePublicToken: () => "",
    } as any) as any;
    const inv: any = { id: 1, number: "INV-0001", tax_rate: 0, stripe_payment_link: "https://pay.example/x", items: [], public_token: "abc123" };
    const html = v.publicInvoicePage(inv, "https://example.com", "/i/abc123");
    expect(html).toContain('class="ui-btn ui-btn-primary ui-btn-lg ui-btn-block"');
    expect(html).toContain('href="https://pay.example/x"');
    expect(html).toContain("Pay $120.00");
    expect(html).toContain("Secure payment by card.");
    expect(html).toContain("never asks for your Zimer password");
    expect(html).not.toContain("md-filled-button");
  });

  test("changelog uses the mock title and the ui entry pattern", () => {
    const v = views as any;
    const html = v.changelogPage([{ date: "Nov 9, 2026", items: ["Shipped <code>x</code>"] }], "https://example.com");
    expect(html).toContain('<h1 class="ui-page-title">What&rsquo;s new in Zimer</h1>');
    expect(html).toContain("Small, finished changes. Shipped means live, not announced.");
    expect(html).toContain('class="ui-changelog-entry"');
    expect(html).toContain('<span class="ui-changelog-date">Nov 9, 2026</span>');
    expect(html).not.toContain("md-title-large");
    expect(html).not.toContain("md-headline-small");
  });

  test("legal pages use ui title classes", () => {
    const v = views as any;
    for (const html of [v.termsPage([], "https://example.com"), v.privacyPage("https://example.com")]) {
      expect(html).toContain('class="ui-page-title changelog-title"');
      expect(html).not.toContain("md-headline-small");
    }
    expect(v.termsPage([{ heading: "H", body: "B" }], "https://example.com")).toContain('<h2 class="ui-app-title">H</h2>');
  });
});

/** #1136: the public invoice page is the mocked summary card fed from the
 *  stored invoice — business title, status tag, per-item lines, tax lines,
 *  sender notes. */
describe("public invoice summary (#1136)", () => {
  const v = createPublicViews({
    getInvoice: () => null,
    invoiceTotals: (items: any[], rate: number) => {
      const subtotal = items.reduce((s: number, i: any) => s + i.amount, 0);
      const tax = Math.round(subtotal * rate) / 100;
      return { subtotal, tax, total: subtotal + tax };
    },
    businessName: () => "Studio — Triston Armstrong",
    ensurePublicToken: () => "",
  } as any) as any;
  const inv: any = {
    id: 7, number: "INV-2001", status: "sent", tax_rate: 0,
    issue_date: "2026-11-05", due_date: "2099-11-19", notes: "Thanks for your business.",
    stripe_payment_link: "https://pay.example/x", public_token: "abc123",
    items: [
      { description: "Intake form fixes", hours: 9.5, rate: 95, amount: 902.5 },
      { description: "Review call", hours: 1.5, rate: 95, amount: 142.5 },
    ],
  };
  test("renders the mocked card with business, meta, due tag, lines, total, notes", () => {
    const html = v.publicInvoicePage(inv, "https://example.com", "/i/abc123");
    expect(html).toContain('class="ui-public-sheet"');
    expect(html).toContain("Studio — Triston Armstrong");
    expect(html).toContain("Zinvoice INV-2001 · Issued Nov 5, 2026");
    expect(html).toContain("Due Nov 19");
    expect(html).toContain("Intake form fixes — 9.5h");
    expect(html).toContain("$902.50");
    expect(html).toContain("Total due");
    expect(html).toContain("$1,045.00");
    expect(html).toContain("Thanks for your business.");
    expect(html).not.toContain("invoice-sheet");
  });
  test("tax adds Subtotal and Tax lines; paid swaps the tag and total label", () => {
    const taxed: any = { ...inv, tax_rate: 10, status: "paid", stripe_payment_link: "" };
    const html = v.publicInvoicePage(taxed, "https://example.com", "/i/abc123");
    expect(html).toContain("Subtotal");
    expect(html).toContain("Tax (10%)");
    expect(html).toContain("$104.50");
    expect(html).toContain("Paid");
    expect(html).toContain("Total paid");
    expect(html).not.toContain("ui-btn-primary");
  });
  test("an elapsed due date reads Overdue", () => {
    const late: any = { ...inv, due_date: "2020-01-15" };
    const html = v.publicInvoicePage(late, "https://example.com", "/i/abc123");
    expect(html).toContain("Overdue");
    expect(html).toContain("ui-tag-error");
  });
});

describe("public invoice status edges (#1136 review)", () => {
  const mk = (globalTerms: string) => createPublicViews({
    getInvoice: () => null,
    invoiceTotals: (items: any[]) => {
      const total = items.reduce((s: number, i: any) => s + i.amount, 0);
      return { subtotal: total, tax: 0, total };
    },
    businessName: () => "Studio",
    paymentTerms: () => globalTerms,
    ensurePublicToken: () => "",
  } as any) as any;
  const base: any = {
    id: 9, number: "INV-2009", tax_rate: 0, issue_date: "2026-11-05",
    due_date: "2020-01-15", notes: "", stripe_payment_link: "", public_token: "tok",
    client_payment_terms: null,
    items: [{ description: "Work", hours: 2, rate: 50, amount: 100 }],
  };
  test("a draft never reads as money due", () => {
    const html = mk("net_30").publicInvoicePage({ ...base, status: "draft" }, "https://example.com", "/i/tok");
    expect(html).toContain("Draft");
    expect(html).toContain("Total");
    expect(html).not.toContain("Total due");
    expect(html).not.toContain("Overdue");
  });
  test("pay-when-paid terms never flag overdue (#291)", () => {
    const html = mk("pay_when_paid").publicInvoicePage({ ...base, status: "sent" }, "https://example.com", "/i/tok");
    expect(html).not.toContain("Overdue");
    expect(html).not.toContain("Due Jan 15");
    expect(html).toContain("Sent");
  });
  test("numeric terms keep the overdue flag; a client override wins", () => {
    const v = mk("pay_when_paid");
    const html = v.publicInvoicePage({ ...base, status: "sent", client_payment_terms: "net_15" }, "https://example.com", "/i/tok");
    expect(html).toContain("Overdue");
  });
});
