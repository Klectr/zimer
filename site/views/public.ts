/** Public views: login page and public invoice page.
 *  The invoice-reading helpers (getInvoice, invoiceTotals, invoiceSheet,
 *  ensurePublicToken) stay owned by server.ts until the invoices view slice
 *  (#171) and are injected here, so these pages render unchanged. */

import { esc, money } from "../lib/format.ts";
import { icon, logo } from "../lib/icons.ts";
import type { ChangelogEntry } from "../lib/changelog.ts"; /* #303 */
import type { TermsSection } from "../lib/license-terms.ts"; /* #341 */
import type { Invoice, InvoiceItem } from "../lib/types.ts";

export interface PublicViewDeps {
  getInvoice: (id: number) => (Invoice & { items: InvoiceItem[] }) | null;
  invoiceTotals: (items: InvoiceItem[], taxRate: number) => { subtotal: number; tax: number; total: number };
  invoiceDocumentHtml: (inv: Invoice & { items: InvoiceItem[] }) => string; /* #301: frozen at send, live for drafts */
  ensurePublicToken: (id: number) => string;
}

export function createPublicViews(deps: PublicViewDeps) {
  const { getInvoice, invoiceTotals, invoiceDocumentHtml, ensurePublicToken } = deps;

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

  /** Public client invoice page: no auth, read-only, no actions or navigation. */
  function publicInvoicePage(inv: Invoice & { items: InvoiceItem[] }, origin: string, tokenPath: string): string {
    const t = invoiceTotals(inv.items, inv.tax_rate);
    const pay = inv.stripe_payment_link ? `
      <div class="no-print public-pay">
        <a class="md-filled-button public-pay-btn" href="${esc(inv.stripe_payment_link)}" target="_blank" rel="noopener">${icon("card")}<span>Pay ${money(t.total)}</span></a>
      </div>` : "";
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
  ${invoiceDocumentHtml(inv)}
  ${pay}
  <p class="muted tiny no-print public-foot">Shared securely via Zimer · <a href="/changelog">Changelog</a></p>
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
        <h2 class="md-title-large">${esc(s.heading)}</h2>
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
  <h1 class="md-headline-small changelog-title">${logo(28)}<span>Zimer privacy policy</span></h1>
  ${body}
  <p class="muted tiny no-print public-foot">Shared securely via Zimer · <a href="/changelog">Changelog</a> · <a href="/terms">Terms</a></p>
  </main>
  </html>`;
  }

  /* #303: public changelog — same minimal public chrome as the invoice page:
     no auth, no app nav. */
  function changelogPage(entries: ChangelogEntry[], origin: string): string {
    const body = entries.length ? entries.map(e => `
      <section class="changelog-release">
        <h2 class="md-title-large">${esc(e.date)}</h2>
        <ul>${e.items.map(i => `<li>${i}</li>`).join("")}</ul>
      </section>`).join("") :
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
  <h1 class="md-headline-small changelog-title">${logo(28)}<span>Zimer changelog</span></h1>
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
        <h2 class="md-title-large">${esc(s.heading)}</h2>
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
  <h1 class="md-headline-small changelog-title">${logo(28)}<span>Zimer terms of service</span></h1>
  ${body}
  <p class="muted tiny no-print public-foot">Shared securely via Zimer · <a href="/changelog">Changelog</a> · <a href="/privacy">Privacy</a></p>
  </main>
  </html>`;
  }

  function loginPage(): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Log in · Zimer</title>
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script></head>
  <body><main class="login">
  <div class="md-card" style="border-radius:28px;padding:28px">
  <h1 class="md-headline-small" style="margin-top:0;display:flex;align-items:center;gap:12px">${logo(32)}<span>Zimer</span></h1>
  <form method="post" action="/login" class="form">
  <div class="md-text-field">
    <input type="password" id="login-token" name="token" autocomplete="off" required placeholder=" " aria-label="API token">
    <label for="login-token">API token</label>
  </div>
  <button class="md-filled-button" type="submit">Log in</button>
  <p class="muted tiny">Printed in the server log on first run, or set via TIMEKEEP_TOKEN.</p>
  </form></div></main></body></html>`;
  }

  /* #732: hosted signup + login pages. Same M3 card as the token login. */
  function authShell(title: string, form: string, error?: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${title} · Zimer</title>
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script>
  <script src="/static/utm.js" defer></script></head>
  <body><main class="login">
  <div class="md-card" style="border-radius:28px;padding:28px">
  <h1 class="md-headline-small" style="margin-top:0;display:flex;align-items:center;gap:12px">${logo(32)}<span>Zimer</span></h1>
  ${form}${error ? `<p class="error" role="alert">${esc(error)}</p>` : ""}
  </div></main></body></html>`;
  }

  function signupPage(error?: string): string {
    return authShell("Sign up", `
  <form method="post" action="/signup" class="form">
  <div class="md-text-field">
    <input type="email" id="su-email" name="email" autocomplete="email" required placeholder=" " aria-label="Email">
    <label for="su-email">Email</label>
  </div>
  <div class="md-text-field">
    <input type="password" id="su-password" name="password" autocomplete="new-password" required minlength="8" placeholder=" " aria-label="Password">
    <label for="su-password">Password</label>
  </div>
  <button class="md-filled-button" type="submit">Create account</button>
  <p class="muted tiny">14-day free trial, then $12/month. <a href="/#pricing">Pricing</a> · <a href="/login">Log in</a> instead.</p>
  </form>`, error);
  }

  function hostedLoginPage(error?: string): string {
    return authShell("Log in", `
  <form method="post" action="/login" class="form">
  <div class="md-text-field">
    <input type="email" id="li-email" name="email" autocomplete="email" required placeholder=" " aria-label="Email">
    <label for="li-email">Email</label>
  </div>
  <div class="md-text-field">
    <input type="password" id="li-password" name="password" autocomplete="current-password" required placeholder=" " aria-label="Password">
    <label for="li-password">Password</label>
  </div>
  <button class="md-filled-button" type="submit">Log in</button>
  <p class="muted tiny">No account yet? <a href="/signup">Sign up</a> · <a href="/#pricing">Pricing</a>.</p>
  </form>`, error);
  }

  return { loginPage, signupPage, hostedLoginPage, publicInvoicePage, changelogPage, termsPage, privacyPage };
}

