/** Public views: login page and public invoice page.
 *  The invoice-reading helpers (getInvoice, invoiceTotals, invoiceSheet,
 *  ensurePublicToken) stay owned by server.ts until the invoices view slice
 *  (#171) and are injected here, so these pages render unchanged. */

import { esc, money, shortYmd, termsDays, termsKey, todayStr } from "../lib/format.ts";
import { icon, logo } from "../lib/icons.ts";
import type { ChangelogEntry } from "../lib/changelog.ts"; /* #303 */
import type { TermsSection } from "../lib/license-terms.ts"; /* #341 */
import type { Invoice, InvoiceItem } from "../lib/types.ts";
import { authCard } from "../ui/auth-card.ts";
import { textField } from "../ui/field.ts";
import { publicInvoice, type PublicInvoiceOptions } from "../ui/public-invoice.ts";
import { tag } from "../ui/tag.ts";

export interface PublicViewDeps {
  getInvoice: (id: number) => (Invoice & { items: InvoiceItem[] }) | null;
  invoiceTotals: (items: InvoiceItem[], taxRate: number) => { subtotal: number; tax: number; total: number };
  businessName?: () => string;
  paymentTerms?: () => string;
  ensurePublicToken: (id: number) => string;
}

export function createPublicViews(deps: PublicViewDeps) {
  const { getInvoice, invoiceTotals, ensurePublicToken } = deps;

  /** #924: shared OG + Twitter card tags for public pages. Unfurlers ignore
      relative URLs, so image and url are absolute. Keep invoice tags generic —
      never client names or amounts. */
  const OG_CARD = { width: 1200, height: 630, alt: "Klectr the alien with a clock and books beside the headline 'Turn your hours into an invoice.'" };
  const OG_BRAND = { width: 2240, height: 1120, alt: "Klectr the alien with a clock and books beside the text 'your Zimer is your Zinvoice.'" };
  function ogTags(title: string, description: string, url: string, image: string, card = OG_CARD): string {
    return `
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:image" content="${esc(image)}">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="${card.width}">
  <meta property="og:image:height" content="${card.height}">
  <meta property="og:image:alt" content="${card.alt}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${esc(image)}">
  <meta name="twitter:image:alt" content="${card.alt}">`;
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function longYmd(ymd: string | null | undefined): string {
    if (!ymd) return "";
    const [y, m, d] = ymd.split("-").map(Number);
    if (!y || !m || !d || m < 1 || m > 12) return ymd;
    return `${MONTHS[m - 1]} ${d}, ${y}`;
  }
  function hoursLabel(hours: number): string {
    if (!hours) return "";
    const h = (Math.round(hours * 100) / 100).toFixed(2).replace(/0$/, "");
    return ` — ${h}h`;
  }

  /** Public client invoice page: no auth, read-only. #1136: the mocked
      summary card (ui library publicInvoice) fed from the stored invoice;
      the frozen document still backs the internal detail view. */
  function publicInvoicePage(inv: Invoice & { items: InvoiceItem[] }, origin: string, tokenPath: string): string {
    const t = invoiceTotals(inv.items, inv.tax_rate);
    const business = deps.businessName?.() || "";
    const lines: PublicInvoiceOptions["lines"] = inv.items.map((it) => ({
      label: `${it.description}${hoursLabel(it.hours)}`,
      amount: money(it.amount),
    }));
    if (inv.tax_rate !== 0) {
      lines.push({ label: "Subtotal", amount: money(t.subtotal) });
      lines.push({ label: `Tax (${inv.tax_rate}%)`, amount: money(t.tax) });
    }
    let chipHtml: string | undefined;
    if (inv.status === "paid") chipHtml = tag({ label: "Paid", tone: "success" });
    else if (inv.status === "draft") chipHtml = tag({ label: "Draft", tone: "neutral" });
    else if (inv.status === "sent" && inv.due_date
      && termsDays(termsKey(inv.client_payment_terms, deps.paymentTerms?.())) !== null) {
      chipHtml = inv.due_date < todayStr()
        ? tag({ label: "Overdue", tone: "error" })
        : tag({ label: `Due ${shortYmd(inv.due_date)}`, tone: "warning" });
    } else if (inv.status === "sent") chipHtml = tag({ label: "Sent", tone: "neutral" });
    const issued = longYmd(inv.issue_date);
    const sheet = publicInvoice({
      business: business || `Zinvoice ${inv.number}`,
      meta: business
        ? `Zinvoice ${inv.number}${issued ? ` · Issued ${issued}` : ""}`
        : `${issued ? `Issued ${issued}` : ""}`,
      chipHtml,
      lines,
      totalLabel: inv.status === "paid" ? "Total paid" : inv.status === "draft" ? "Total" : "Total due",
      total: money(t.total),
      pay: inv.stripe_payment_link ? { label: `Pay ${money(t.total)}`, href: inv.stripe_payment_link } : undefined,
      note: inv.stripe_payment_link ? "Secure payment by card. Questions? Reply to the email this link came in." : undefined,
      notes: inv.notes || undefined,
      footer: "Powered by Zimer · This page never asks for your Zimer password — you don't have one.",
    });
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Invoice ${esc(inv.number)} · Zimer</title>${ogTags("Zinvoice · Zimer", "View and pay your Zinvoice securely.", origin + tokenPath, origin + "/static/og-image.png", OG_BRAND)}
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script>
  </head>
  <body>
  <main class="page-public-invoice">
  ${sheet}
  </main>
  </html>`;
  }

  /* #730: public privacy policy — same minimal public chrome as the
     changelog: no auth, no app nav. Content is deliberately
     brief: what we store, where, what we don't do, and how to delete. */
  function privacyPage(origin: string): string {
    const sections: TermsSection[] = [
      {
        heading: "What we store",
        body: "Your account email and a hash of your password (your actual password is never stored), plus everything you track: time entries, clients, projects, and zinvoices. That's the entire list.",
      },
      {
        heading: "Where it lives",
        body: "On our server, in a single database. Your data never leaves our infrastructure except when you export it yourself (PDF, CSV, backup download).",
      },
      {
        heading: "Analytics",
        html: true,
        body: "The hosted site uses <a href=\"https://posthog.com\" target=\"_blank\" rel=\"noopener\">PostHog</a> for product analytics. On the landing page it records page views and clicks. On the landing page and inside the app it records sessions (a replay of the visit) and errors when something breaks, and in the app it records a small set of product events (starting a Zimer, creating a Zinvoice) tied to your account ID, never your email. Self-hosted instances send us nothing. PostHog's privacy policy is at <a href=\"https://posthog.com/privacy\" target=\"_blank\" rel=\"noopener\">posthog.com/privacy</a>.",
      },
      {
        heading: "What we don't do",
        body: "We don't sell your data, we don't share it with advertisers, and we don't track you around the web. The analytics we run on this site is described under Analytics above.",
      },
      {
        heading: "Deletion",
        body: "Email support@klectr.dev from your account address and we'll delete your account and all of its data.",
      },
    ];
    const body = sections.map(s => `
      <section class="changelog-release">
        <h2 class="ui-app-title">${esc(s.heading)}</h2>
        <p>${s.html ? s.body : esc(s.body)}</p>
      </section>`).join("");
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Privacy policy · Zimer</title>
  <meta name="description" content="Zimer privacy policy: what we store, where it lives, what we never do with your data, and how to delete your account.">
  <link rel="canonical" href="${origin}/privacy">${ogTags("Privacy policy · Zimer", "Zimer privacy policy: what we store, where it lives, what we never do with your data, and how to delete your account.", origin + "/privacy", origin + "/static/og-image-v3.png")}
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script>
  </head>
  <body>
  <main class="page-public page-changelog">
  <h1 class="ui-page-title changelog-title">${logo(28)}<span>Zimer privacy policy</span></h1>
  ${body}
  <p class="muted tiny no-print public-foot">Shared securely via Zimer · <a href="/changelog">Changelog</a> · <a href="/terms">Terms</a></p>
  </main>
  </html>`;
  }

  /* #303: public changelog — same minimal public chrome as the invoice page:
     no auth, no app nav. */
  function changelogPage(entries: ChangelogEntry[], origin: string): string {
    const body = entries.length ? `<div class="ui-changelog">${entries.map(e => `
      <div class="ui-changelog-entry">
        <div class="ui-changelog-head"><span class="ui-changelog-date">${esc(e.date)}</span></div>
        <div class="ui-changelog-body"><ul>${e.items.map(i => `<li>${i}</li>`).join("")}</ul></div>
      </div>`).join("")}</div>` :
      `<p class="muted">No release notes yet.</p>`;
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Changelog · Zimer</title>
  <meta name="description" content="What's new in Zimer: release notes, fixes, and product changes.">
  <link rel="canonical" href="${origin}/changelog">${ogTags("Changelog · Zimer", "What's new in Zimer: release notes, fixes, and product changes.", origin + "/changelog", origin + "/static/og-image-v3.png")}
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script>
  </head>
  <body>
  <main class="page-public page-changelog">
  <h1 class="ui-page-title">What&rsquo;s new in Zimer</h1>
  <p class="ui-app-sub">Small, finished changes. Shipped means live, not announced.</p>
  ${body}
  <p class="muted tiny no-print public-foot">Shared securely via Zimer</p>
  </main>
  </html>`;
  }

  /* #341: public license terms — same minimal public chrome as the
     changelog: no auth, no app nav. */
  function termsPage(sections: TermsSection[], origin: string): string {
    const body = sections.map(s => `
      <section class="changelog-release">
        <h2 class="ui-app-title">${esc(s.heading)}</h2>
        <p>${s.html ? s.body : esc(s.body)}</p>
      </section>`).join("");
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Terms of service · Zimer</title>
  <meta name="description" content="Zimer terms of service: the $12/month hosted plan with a 14-day free trial, 30-day refunds, and the free-forever self-hosted option.">
  <link rel="canonical" href="${origin}/terms">${ogTags("Terms of service · Zimer", "Zimer terms of service: the $12/month hosted plan with a 14-day free trial, 30-day refunds, and the free-forever self-hosted option.", origin + "/terms", origin + "/static/og-image-v3.png")}
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script>
  </head>
  <body>
  <main class="page-public page-changelog">
  <h1 class="ui-page-title changelog-title">${logo(28)}<span>Zimer terms of service</span></h1>
  ${body}
  <p class="muted tiny no-print public-foot">Shared securely via Zimer · <a href="/changelog">Changelog</a> · <a href="/privacy">Privacy</a></p>
  </main>
  </html>`;
  }

  function loginPage(error?: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Log in · Zimer</title>
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script></head>
  <body><main class="login">
  ${authCard({
    action: "/login",
    headingLevel: 1,
    title: "Log in",
    sub: "Printed in the server log on first run, or set via TIMEKEEP_TOKEN.",
    fieldsHtml: textField({ id: "login-token", label: "API token", name: "token", type: "password", autocomplete: "off", required: true }),
    submitLabel: "Log in",
    error,
  })}
  </main></body></html>`;
  }

  /* #732: hosted signup + login pages. Same ui auth card as the token login. */
  function authShell(title: string, cardHtml: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title} · Zimer</title>
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script>
  <script src="/static/utm.js" defer></script></head>
  <body><main class="login">
  ${cardHtml}
  </main></body></html>`;
  }

  function signupPage(error?: string): string {
    return authShell("Sign up", authCard({
      action: "/signup",
      headingLevel: 1,
      title: "Sign up",
      sub: "14-day free trial, then $12/month.",
      fieldsHtml:
        textField({ id: "su-email", label: "Email", name: "email", type: "email", autocomplete: "email", required: true }) +
        textField({ id: "su-password", label: "Password", name: "password", type: "password", autocomplete: "new-password", required: true, attrs: 'minlength="8"' }),
      submitLabel: "Create account",
      footerHtml: `<span>Have an account? <a href="/login">Log in</a></span><a href="/#pricing">Pricing</a>`,
      error,
    }));
  }

  function hostedLoginPage(error?: string): string {
    return authShell("Log in", authCard({
      action: "/login",
      headingLevel: 1,
      title: "Welcome back",
      sub: "Log in to your timers and Zinvoices.",
      fieldsHtml:
        textField({ id: "li-email", label: "Email", name: "email", type: "email", autocomplete: "email", required: true }) +
        textField({ id: "li-password", label: "Password", name: "password", type: "password", autocomplete: "current-password", required: true }),
      submitLabel: "Log in",
      footerHtml: `<span>No account yet? <a href="/signup">Sign up</a></span><a href="/#pricing">Pricing</a>`,
      error,
    }));
  }

  return { loginPage, signupPage, hostedLoginPage, publicInvoicePage, changelogPage, termsPage, privacyPage };
}

