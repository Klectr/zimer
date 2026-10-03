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

  /** Public client invoice page: no auth, read-only, no actions or navigation. */
  function publicInvoicePage(inv: Invoice & { items: InvoiceItem[] }): string {
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
  <title>Invoice ${esc(inv.number)} · Zimer</title>
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
     changelog: no auth, no app nav, noindex. Content is deliberately
     brief: what we store, where, what we don't do, and how to delete. */
  function privacyPage(): string {
    const sections: TermsSection[] = [
      {
        heading: "What we store",
        body: "Your account email and a hash of your password (your actual password is never stored), plus everything you track: time entries, clients, projects, and invoices. That's the entire list.",
      },
      {
        heading: "Where it lives",
        body: "On our server, in a single database. Your data never leaves our infrastructure except when you export it yourself (PDF, CSV, backup download).",
      },
      {
        heading: "What we don't do",
        body: "We don't sell your data, we don't share it with advertisers, and we don't track you around the web. Public pages load a font and HTMX from public CDNs — standard practice, not tracking.",
      },
      {
        heading: "Deletion",
        body: "Email support@klectr.dev from your account address and we'll delete your account and all of its data.",
      },
    ];
    const body = sections.map(s => `
      <section class="changelog-release">
        <h2 class="md-title-large">${esc(s.heading)}</h2>
        <p>${esc(s.body)}</p>
      </section>`).join("");
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Privacy policy · Zimer</title>
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
     no auth, no app nav, noindex. */
  function changelogPage(entries: ChangelogEntry[]): string {
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
  <meta name="robots" content="noindex">
  <title>Changelog · Zimer</title>
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
     changelog: no auth, no app nav, noindex. */
  function termsPage(sections: TermsSection[]): string {
    const body = sections.map(s => `
      <section class="changelog-release">
        <h2 class="md-title-large">${esc(s.heading)}</h2>
        <p>${esc(s.body)}</p>
      </section>`).join("");
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Terms of service · Zimer</title>
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
  <title>Log in · Zimer</title>
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script></head>
  <body><main class="login">
  <div class="md-card" style="border-radius:28px;padding:28px">
  <h1 class="md-headline-small" style="margin-top:0;display:flex;align-items:center;gap:12px">${logo(32)}<span>Zimer</span></h1>
  <form method="post" action="/login" class="form">
  <div class="md-text-field">
    <input type="password" name="token" autocomplete="off" required placeholder=" " aria-label="API token">
    <label>API token</label>
  </div>
  <button class="md-filled-button" type="submit">Log in</button>
  <p class="muted tiny">Printed in the server log on first run, or set via TIMEKEEP_TOKEN.</p>
  </form></div></main></body></html>`;
  }

  /* #732: hosted signup + login pages. Same M3 card as the token login. */
  function authShell(title: string, form: string, error?: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title} · Zimer</title>
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script></head>
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
    <input type="email" name="email" autocomplete="email" required placeholder=" " aria-label="Email">
    <label>Email</label>
  </div>
  <div class="md-text-field">
    <input type="password" name="password" autocomplete="new-password" required minlength="8" placeholder=" " aria-label="Password">
    <label>Password</label>
  </div>
  <button class="md-filled-button" type="submit">Create account</button>
  <p class="muted tiny">14-day free trial, then $12/month. <a href="/pricing">Pricing</a> · <a href="/login">Log in</a> instead.</p>
  </form>`, error);
  }

  function hostedLoginPage(error?: string): string {
    return authShell("Log in", `
  <form method="post" action="/login" class="form">
  <div class="md-text-field">
    <input type="email" name="email" autocomplete="email" required placeholder=" " aria-label="Email">
    <label>Email</label>
  </div>
  <div class="md-text-field">
    <input type="password" name="password" autocomplete="current-password" required placeholder=" " aria-label="Password">
    <label>Password</label>
  </div>
  <button class="md-filled-button" type="submit">Log in</button>
  <p class="muted tiny">No account yet? <a href="/signup">Sign up</a> · <a href="/pricing">Pricing</a>.</p>
  </form>`, error);
  }

  return { loginPage, signupPage, hostedLoginPage, publicInvoicePage, changelogPage, termsPage, privacyPage };
}

