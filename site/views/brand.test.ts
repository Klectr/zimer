/** #753: Zimer visual identity — mascot placements.
 *  The Klectr alien, rebadged K→Z: landing hero, invoices empty state,
 *  and the timer "New here?" demo banner. Subtle by design — one image
 *  per surface, never competing with a CTA. */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db.ts";
import { demoBanner } from "../lib/demo.ts";
import { createLandingViews } from "./landing.ts";
import { createInvoiceViews } from "./invoices.ts";

const stubQuery = () => ({
  get: (..._a: unknown[]) => ({ n: 0 }),
  all: (..._a: unknown[]) => [],
  run: (..._a: unknown[]) => {},
});
const stubDb = { query: (_sql: string) => stubQuery() } as unknown as Database;

function invoiceViews() {
  return createInvoiceViews({
    db: stubDb,
    qInvoices: { all: () => [] } as unknown as Statement,
    layout: (_t: string, b: string) => b,
    clientOptions: () => "",
    getPublicToken: () => null,
    stripeConfigured: () => false,
    nextInvoiceNumber: () => "INV-0001",
    invoiceTotals: (items: any[], _taxRate: number) => ({
      subtotal: 0, tax: 0,
      total: items.reduce((a: number, it: any) => a + Number(it.amount || 0), 0),
    }),
    statusPill: (s: string) => `<span class="pill">${s}</span>`,
    isOverdue: () => false,
    unbilledByClient: () => [],
  });
}

describe("#753: mascot placements", () => {
  test("landing hero shows the mascot, OG tags, and PNG favicon", () => {
    const { landingPage } = createLandingViews();
    const html = landingPage();
    expect(html).toContain('class="landing-mascot"');
    expect(html).toContain('src="/static/mascot.png"');
    expect(html).toContain('property="og:image" content="/static/og-image.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('href="/static/favicon-32.png"');
    expect(html).toContain('rel="apple-touch-icon" href="/static/alien-180.png"');
    expect(html).not.toContain("logo.svg");
  });

  test("invoices empty state shows the stopwatch mascot, not the receipt icon", () => {
    const html = invoiceViews().invoicesPage(null, "/invoices");
    expect(html).toContain('class="empty-mascot"');
    expect(html).toContain('src="/static/mascot-empty.png"');
    expect(html).toContain("No zinvoices yet");
  });

  test("timer first-run demo banner shows the mascot", () => {
    const db = createDb(mkdtempSync(join(tmpdir(), "tk-brand-"))).db;
    const html = demoBanner(db);
    expect(html).toContain("New here?");
    expect(html).toContain('class="demo-mascot"');
    expect(html).toContain('src="/static/mascot.png"');
  });
});
