/** #416: "paid on" date — regression guard.
 *
 *  paid_at is set when an invoice is marked paid (manual or Stripe) but was
 *  never displayed. The list row and the detail page-head must show it when
 *  present, and show nothing extra when it is absent (older paid invoices).
 */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { createInvoiceViews } from "./invoices.ts";

const stubQuery = () => ({
  get: (..._a: unknown[]) => null,
  all: (..._a: unknown[]) => [],
  run: (..._a: unknown[]) => {},
});
const stubDb = { query: (_sql: string) => stubQuery() } as unknown as Database;

function views(rows: any[], opts: { publicToken?: string | null } = {}) {
  return createInvoiceViews({
    db: stubDb,
    qInvoices: { all: () => rows } as unknown as Statement,
    layout: (_t: string, b: string) => b,
    clientOptions: () => "",
    getPublicToken: () => opts.publicToken ?? null,
    stripeConfigured: () => false,
    nextInvoiceNumber: () => "INV-0001",
    invoiceTotals: (items: any[], taxRate: number) => {
      const subtotal = items.reduce((a: number, it: any) => a + Number(it.amount || 0), 0);
      const tax = subtotal * taxRate / 100;
      return { subtotal, tax, total: subtotal + tax };
    },
    statusPill: (s: string) => `<span class="pill">${s}</span>`,
    isOverdue: () => false,
    unbilledByClient: () => [],
  });
}

const baseRow = {
  id: 7, number: "INV-0007", client_name: "Acme", client_color: null,
  client_payment_terms: null, issue_date: "2026-09-01", due_date: "2026-09-30",
  tax_rate: 0, subtotal: 3200,
};

function detailInv(status: string, paid_at: string | null) {
  return {
    ...baseRow, status, paid_at, notes: "", template: "modern",
    created_at: "2026-09-01", stripe_payment_link: null, paid_via_stripe: 0,
    public_token: null, internal_notes: "", pdf_snapshot: null, html_snapshot: null,
    items: [],
  };
}

describe("paid-on date", () => {
  test("list row shows the paid date when present", () => {
    const html = views([{ ...baseRow, status: "paid", paid_at: "2026-09-21" }]).invoiceListOob(7);
    expect(html).toContain("paid Sep 21");
  });

  test("list row shows no paid date for unpaid invoices", () => {
    const html = views([{ ...baseRow, status: "sent", paid_at: null }]).invoiceListOob(0);
    expect(html).not.toContain("paid ");
  });

  test("list row shows no paid date when a paid invoice predates the column", () => {
    const html = views([{ ...baseRow, status: "paid", paid_at: null }]).invoiceListOob(7);
    expect(html).not.toContain("paid ");
  });

  test("#432: detail actions are icon buttons with M3 tooltips", () => {
    const html = views([]).invoiceDetailBody(detailInv("draft", null) as any, "http://x");
    const row = html.match(/<div class="page-head no-print">[\s\S]*?<div class="row">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] || "";
    expect(row).toContain('data-tip="Download PDF"');
    expect(row).toContain('data-tip="Mark sent"');
    expect(row).toContain('data-tip="Delete draft"');
    expect(row).toContain('aria-label="Download PDF"');
    expect(row).not.toContain("md-filled-button");
    expect(row).not.toContain("md-text-button");
    expect(row).not.toContain("inv-overflow-menu-");
    const iconBtns = row.match(/md-icon-button/g) || [];
    expect(iconBtns.length).toBe(3);
    expect(row.match(/tip-right/g)?.length).toBe(3); // #434: tooltips anchor right
  });

  test("#432: paid invoice shows only the download icon button", () => {
    const html = views([]).invoiceDetailBody(detailInv("paid", "2026-09-21") as any, "http://x");
    const row = html.match(/<div class="page-head no-print">[\s\S]*?<div class="row">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] || "";
    const iconBtns = row.match(/md-icon-button/g) || [];
    expect(iconBtns.length).toBe(1);
    expect(row).not.toContain("inv-overflow-menu-");
  });

  test("#424: paid label is an M3 chip first in the detail actions row", () => {
    const html = views([]).invoiceDetailBody(detailInv("paid", "2026-09-21") as any, "http://x");
    const actionsRow = html.match(/<div class="page-head no-print">[\s\S]*?<div class="row">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] || "";
    expect(actionsRow).toContain("md-chip");
    expect(actionsRow).toContain("Paid Sep 21");
    // chip leads the actions row, ahead of Download PDF
    expect(actionsRow.indexOf("md-chip")).toBeLessThan(actionsRow.indexOf("Download PDF"));
    // title block untouched: back link only, no paid date
    const headBlock = html.match(/<div class="invoice-detail-head">[\s\S]*?<\/div>/)?.[0] || "";
    expect(headBlock).not.toContain("Paid Sep 21");
    // no caption element anywhere
    expect(html).not.toContain("paid-meta");
  });

  test("detail page-head shows no paid date for sent invoices", () => {
    const html = views([]).invoiceDetailBody(detailInv("sent", null) as any, "http://x");
    expect(html).not.toContain("Paid ");
  });

  test("#442: list row keeps date phrases on one line", () => {
    const html = views([{ ...baseRow, status: "paid", paid_at: "2026-09-21" }]).invoiceListOob(7);
    expect(html).toContain('<span class="inv-date">· issued 2026-09-01</span>');
    expect(html).toContain('<span class="inv-date">· due 2026-09-30</span>');
    expect(html).toContain('<span class="inv-date">· paid Sep 21</span>');
    const html2 = views([{ ...baseRow, status: "sent", paid_at: null }]).invoiceListOob(0);
    expect(html2).toContain('<span class="inv-date">· issued 2026-09-01</span>');
    expect(html2).toContain('<span class="inv-date">· due 2026-09-30</span>');
    expect(html2).not.toContain('inv-date">· paid');
  });

  test("#481: no middot dangles in raw text between the date spans", () => {
    const html = views([{ ...baseRow, status: "paid", paid_at: "2026-09-21" }]).invoiceListOob(7);
    const supporting = html.match(/<div class="md-list-item-supporting">([\s\S]*?)<\/div>/)?.[1] || "";
    /* The middot is a leading separator inside each nowrap span, so a wrap
       breaks before a middot, never after one — no " · " in raw text. */
    expect(supporting).toContain('Acme <span class="inv-date">· issued 2026-09-01</span> <span class="inv-date">· due 2026-09-30</span> <span class="inv-date">· paid Sep 21</span>');
    expect(supporting).not.toMatch(/ · </);
  });

  test("#448: stripe-paid chip uses the icon system, not an emoji", () => {
    const stripeInv = { ...detailInv("paid", "2026-09-21"), paid_via_stripe: 1 };
    const html = views([]).invoiceDetailBody(stripeInv as any, "http://x");
    const chip = html.match(/<span class="stripe-paid-chip"[^>]*>([\s\S]*?)<\/span>/)?.[1] || "";
    expect(chip).toContain("<svg");
    expect(chip).toContain("Paid via Stripe");
    expect(chip).not.toContain("⚡");
    /* #494: the chip carries no native title — the visible label already
       says "Paid via Stripe", so the tooltip restated it (#488 class). */
    expect(html).not.toContain('stripe-paid-chip" title=');
    const plain = views([]).invoiceDetailBody(detailInv("paid", "2026-09-21") as any, "http://x");
    expect(plain).not.toContain("stripe-paid-chip");
  });

  test("#471: new-invoice rate/tax use affixes, not label-crammed units", () => {
    const html = views([]).invoiceNewPage(views([]).defaultNewInvParams());
    // rate: $ prefix affix, label is just "Hourly rate"
    expect(html).toContain('class="md-text-field filled has-prefix"');
    expect(html).toContain('<span class="affix prefix" aria-hidden="true">$</span>');
    expect(html).toContain('aria-label="Hourly rate"><label>Hourly rate</label>');
    expect(html).not.toContain("Hourly rate ($)");
    // tax: % suffix affix, label is just "Tax"
    expect(html).toContain('class="md-text-field filled has-suffix"');
    expect(html).toContain('<span class="affix suffix" aria-hidden="true">%</span>');
    expect(html).toContain('aria-label="Tax"><label>Tax</label>');
    expect(html).not.toContain("Tax %");
  });
});

/** #486: finish the data-tip sweep — the invoice share-section buttons
 *  (copy link, regenerate/revoke) used the OS-native title= tooltip while the
 *  detail header actions already show M3 plain tooltips. */
describe("share-section tooltips (#486)", () => {
  const html = views([], { publicToken: "tok_test" }).invoiceDetailBody(detailInv("draft", null) as any, "http://x");
  test("copy link uses data-tip, not the native title", () => {
    expect(html).toContain('data-tip="Copy link"');
    expect(html).not.toContain('title="Copy link"');
  });
  test("regenerate keeps the full accessible name; tip stays short", () => {
    // the M3 tooltip caps at 200px nowrap — the long label would overflow it
    expect(html).toContain('data-tip="Regenerate link"');
    expect(html).toContain('aria-label="Regenerate link (invalidates the old one)"');
    expect(html).not.toContain('title="Regenerate link');
  });
  test("revoke uses data-tip, not the native title", () => {
    expect(html).toContain('data-tip="Revoke link"');
    expect(html).not.toContain('title="Revoke link"');
  });
  test("client-link URL uses data-tip, not the native title (#502)", () => {
    const url = "http://x/i/tok_test";
    expect(html).toContain(`<span class="share-url-wrap" data-tip="${url}"><span class="share-url">${url}</span></span>`);
    expect(html).not.toContain(`title="${url}"`);
  });
});

/** #526: line-item table headers must carry scope="col" (WCAG H63) so screen
 *  readers announce the column (Hours, Rate, Amount) for each numeric cell.
 *  Covers both the new-invoice preview table and the rendered sheet, which
 *  also serves the client-facing public invoice page. */
describe("#526: line-item table headers carry scope=col", () => {
  const scoped = [
    `<th scope="col">Date</th>`,
    `<th scope="col">Description</th>`,
    `<th scope="col" class="num">Hours</th>`,
    `<th scope="col" class="num">Rate</th>`,
    `<th scope="col" class="num">Amount</th>`,
  ];
  const previewParams = () => views([]).defaultNewInvParams();

  test("preview table scopes all five column headers", () => {
    const html = views([]).invoiceStep2(previewParams(), { items: [] });
    for (const th of scoped) expect(html).toContain(th);
    expect(html).not.toContain("<th>Date</th>");
  });

  test("rendered sheet scopes all five column headers", () => {
    const html = views([]).invoiceSheet(detailInv("sent", null));
    for (const th of scoped) expect(html).toContain(th);
    expect(html).not.toContain("<th>Date</th>");
  });

  test("the two tables share one header row — no drift", () => {
    const step2 = views([]).invoiceStep2(previewParams(), { items: [] });
    const sheet = views([]).invoiceSheet(detailInv("sent", null));
    const headOf = (html: string) => html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
    expect(headOf(step2)).toBe(headOf(sheet));
  });
});
