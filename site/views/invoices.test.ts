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
  get: (..._a: unknown[]) => ({ n: 0 }),
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
    expect(html).toContain('<span class="inv-date">· issued Sep 1</span>');
    expect(html).toContain('<span class="inv-date">· due Sep 30</span>');
    expect(html).toContain('<span class="inv-date">· paid Sep 21</span>');
    const html2 = views([{ ...baseRow, status: "sent", paid_at: null }]).invoiceListOob(0);
    expect(html2).toContain('<span class="inv-date">· issued Sep 1</span>');
    expect(html2).toContain('<span class="inv-date">· due Sep 30</span>');
    expect(html2).not.toContain('inv-date">· paid');
  });

  test("#481: no middot dangles in raw text between the date spans", () => {
    const html = views([{ ...baseRow, status: "paid", paid_at: "2026-09-21" }]).invoiceListOob(7);
    const supporting = html.match(/<div class="md-list-item-supporting">([\s\S]*?)<\/div>/)?.[1] || "";
    /* The middot is a leading separator inside each nowrap span, so a wrap
       breaks before a middot, never after one — no " · " in raw text. */
    expect(supporting).toContain('Acme <span class="inv-dates"><span class="inv-date">· issued Sep 1</span> <span class="inv-date">· due Sep 30</span> <span class="inv-date">· paid Sep 21</span></span>');
    expect(supporting).not.toMatch(/ · </);
  });

  test("#588: date segments share one nowrap group, not the client line", () => {
    const html = views([{ ...baseRow, status: "sent", paid_at: null }]).invoiceListOob(0);
    const supporting = html.match(/<div class="md-list-item-supporting">([\s\S]*?)<\/div>/)?.[1] || "";
    /* The dates wrap as one unit: the break lands between the client name
       and the .inv-dates group, never between two date segments. */
    expect(supporting).toContain('<span class="inv-dates"><span class="inv-date">· issued Sep 1</span> <span class="inv-date">· due Sep 30</span></span>');
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

/** #536: hidden per-row inputs must not be direct children of <tr> — only
 *  td/th are valid there. The parser foster-parents stray inputs before the
 *  <table>; they still land inside the <form> today, but if the table ever
 *  moves out of the form (or the fragment is serialized standalone), the
 *  entry IDs and date ranges silently drop and invoices would be created
 *  with zero entries linked. */
describe("#536: line-item hidden inputs live inside a td", () => {
  const items = [
    { description: "d", hours: 1, rate: 40, amount: 40, entry_ids: [1, 2], date_from: "2026-09-20", date_to: "2026-09-21" },
    { description: "e", hours: 2, rate: 40, amount: 80, entry_ids: [3], date_from: "2026-09-22", date_to: "2026-09-22" },
  ];
  test("no input sits directly under a tr", () => {
    const html = views([]).invoiceStep2(views([]).defaultNewInvParams(), { items } as any);
    /* the editable cell inputs already live inside <td>s, so any input right
       after a <tr> or </td> boundary is a stray tr child. */
    expect(html).not.toMatch(/<tr>\s*<input/);
    expect(html).not.toMatch(/<\/td>\s*<input/);
    // the three hidden fields are still emitted per row, inside the form
    for (const i of [0, 1]) {
      expect(html).toContain(`name="g${i}_ids"`);
      expect(html).toContain(`name="g${i}_date_from"`);
      expect(html).toContain(`name="g${i}_date_to"`);
    }
  });
});

/** #560: the invoice-sheet header date phrases must wrap as units on narrow
 *  screens. Before: "Issued 2026-09-27 ·" could trail the middot with "Due
 *  …" on the next line, and "Sep 21 –" split the billing-period dash. The
 *  header now mirrors the #442/#481 list-row fix: each date phrase sits in
 *  the existing .inv-date nowrap span and the middot is a leading separator,
 *  so wraps happen before a separator, never after one. */
describe("#560: header date phrases stay together", () => {
  const items = [{
    description: "d", hours: 1, rate: 40, amount: 40, entry_ids: [1],
    date_from: "2026-09-21", date_to: "2026-09-26",
  }];
  const sheet = () => views([]).invoiceSheet({ ...detailInv("sent", null), items } as any);
  test("Issued and Due are nowrap spans with the middot leading", () => {
    const html = sheet();
    expect(html).toContain(`<span class="inv-date">Issued Sep 1</span>`);
    expect(html).toContain(`<span class="inv-date">· <strong>Due Sep 30</strong></span>`);
    // the old inline " · <strong>Due" separator is gone from the header
    expect(html).not.toContain(" · <strong>");
  });
  test("billing period is one nowrap phrase", () => {
    expect(sheet()).toContain(`Billing period: <span class="inv-date">Sep 21 – Sep 26, 2026</span>`);
  });
  test("no due phrase when pay-when-paid, and no period without items", () => {
    const html = views([]).invoiceSheet({ ...detailInv("sent", null), client_payment_terms: "pay_when_paid", items: [] } as any);
    expect(html).not.toContain("<strong>Due ");
    expect(html).not.toContain("Billing period:");
  });
});

/** #594: Export CSV on an empty invoice list downloads a header-only file,
 *  so the button stays hidden until there is at least one invoice to export. */
describe("#594: Export CSV visibility", () => {
  test("Export CSV is hidden when there are no invoices", () => {
    const html = views([]).invoicesPage(null, "http://x");
    expect(html).not.toContain("/export/invoices.csv");
  });
  test("Export CSV is present when invoices exist", () => {
    const html = views([{ ...baseRow, status: "sent", paid_at: null }]).invoicesPage(null, "http://x");
    expect(html).toContain("/export/invoices.csv");
  });
});
