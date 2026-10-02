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

  test("#703: new-invoice Notes/Internal notes inputs have accessible names", () => {
    const html = views([]).invoiceNewPage(views([]).defaultNewInvParams());
    expect(html).toContain('aria-label="Notes (optional)"><label>Notes (optional)</label>');
    expect(html).toContain('aria-label="Internal notes (only you see this)"><label>Internal notes (only you see this)</label>');
  });

  test("#709: new-invoice date/number labels are wired via matching id/for", () => {
    const html = views([]).invoiceNewPage(views([]).defaultNewInvParams());
    for (const id of ["inv-from", "inv-to", "inv-number", "inv-issue", "inv-due"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label for="${id}">`);
    }
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

/** #560: the invoice-sheet date phrases must wrap as units on narrow screens.
 *  Before: "Issued 2026-09-27 ·" could trail the middot with "Due …" on the
 *  next line, and "Sep 21 –" split the billing-period dash. The dates line
 *  mirrors the #442/#481 list-row fix: each date phrase sits in the existing
 *  .inv-date nowrap span and the middot is a separator between the spans,
 *  so wraps happen before a separator, never after one.
 *  #612: the dates moved out of the header band into .inv-dates-line below
 *  it — the nowrap treatment is unchanged, only the location moved.
 *  #656: the separators are their own .inv-date-sep spans (aria-hidden) so
 *  the dates can stack cleanly on phones; desktop rendering is unchanged. */
describe("#560: date phrases stay together", () => {
  const items = [{
    description: "d", hours: 1, rate: 40, amount: 40, entry_ids: [1],
    date_from: "2026-09-21", date_to: "2026-09-26",
  }];
  const sheet = () => views([]).invoiceSheet({ ...detailInv("sent", null), items } as any);
  test("Issued and Due are nowrap spans with a separator span between", () => {
    const html = sheet();
    expect(html).toContain(`<span class="inv-date">Issued Sep 1</span>`);
    expect(html).toContain(`<span class="inv-date-sep" aria-hidden="true">·</span><span class="inv-date"><strong>Due Sep 30</strong></span>`);
    // the old format with the middot inside the phrase span is gone
    expect(html).not.toContain(`<span class="inv-date"> · <strong>Due`);
  });
  test("billing period is one nowrap phrase", () => {
    expect(sheet()).toContain(`<span class="inv-date">Billing period: Sep 21 – Sep 26, 2026</span>`);
  });
  test("#615: dates line sits directly above the table, below the parties row", () => {
    const html = sheet();
    const datesIdx = html.indexOf(`class="inv-dates-line`);
    const partiesIdx = html.indexOf(`<div class="inv-modern-parties">`);
    const tableIdx = html.indexOf(`<div class="table-wrap">`);
    expect(datesIdx).toBeGreaterThan(-1);
    expect(datesIdx).toBeGreaterThan(partiesIdx);
    expect(datesIdx).toBeLessThan(tableIdx);
    expect(html).not.toContain(`inv-modern-dates`);
  });
  test("#612: Bill to renders before From", () => {
    const meta = { business_name: "Triston Armstrong", business_email: "triston@klectr.dev" };
    const metaDb = {
      query: (_sql: string) => ({
        get: (key: string) => ({ value: meta[key as keyof typeof meta] ?? "" }),
        all: () => [],
        run: (..._a: unknown[]) => {},
      }),
    } as unknown as Database;
    const html = createInvoiceViews({
      db: metaDb,
      qInvoices: { all: () => [] } as unknown as Statement,
      layout: (_t: string, b: string) => b,
      clientOptions: () => "",
      getPublicToken: () => null,
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
    }).invoiceSheet({ ...detailInv("sent", null), items } as any);
    expect(html).toContain("Bill to");
    expect(html).toContain("From");
    expect(html.indexOf("Bill to")).toBeLessThan(html.indexOf(">From<"));
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

/** #621: the copy-client-link button must work on non-secure contexts. The
 *  app is served over plain HTTP on the Tailscale IP, where
 *  navigator.clipboard is undefined — the old #312 "clipboard API or
 *  nothing" handler silently no-op'd there. The share script now falls back
 *  to a temporary-textarea execCommand copy. */
describe("#621: copy-link fallback for non-secure contexts", () => {
  const html = views([], { publicToken: "tok_test" }).invoiceDetailBody(detailInv("sent", null) as any, "http://x");
  test("share script carries an execCommand fallback", () => {
    expect(html).toContain('document.execCommand("copy")');
    expect(html).toContain('document.createElement("textarea")');
    expect(html).not.toContain("clipboard API or nothing");
  });
  test("success feedback only fires when the copy actually worked", () => {
    // done() (which flashes the .copied state) runs on writeText resolve
    // or execCommand true — never unconditionally, so no fake success.
    expect(html).toContain('if (document.execCommand("copy")) done()');
    expect(html).toContain("navigator.clipboard.writeText(text).then(done,");
  });
});

/* #627: client contact details on the invoice Bill-to block — the address
 * (multi-line) and email render under the client name on the HTML sheet;
 * nothing extra renders when the record has none. */
describe("#627: Bill-to block shows client address and email", () => {
  const addr = ["2643 Morningside Dr", "Clearwater, FL 33759"].join("\n");
  const sheet = (extra: object) =>
    views([]).invoiceSheet({ ...detailInv("sent", null), items: [], ...extra } as any);

  test("address lines and email appear under the client name", () => {
    const html = sheet({ client_address: addr, client_email: "ap@bytebot.io" });
    expect(html).toContain("<strong>Acme</strong>");
    expect(html).toContain("2643 Morningside Dr");
    expect(html).toContain("Clearwater, FL 33759");
    expect(html).toContain("ap@bytebot.io");
    // address lines come before the email
    expect(html.indexOf("Clearwater, FL 33759")).toBeLessThan(html.indexOf("ap@bytebot.io"));
  });

  test("blank lines are skipped and values are escaped", () => {
    const html = sheet({ client_address: ["  ", "Clearwater, FL 33759"].join("\n"), client_email: "<x@y.z>" });
    expect(html).not.toContain("<div class=\"muted\"> </div>");
    expect(html).toContain("Clearwater, FL 33759");
    expect(html).toContain("&lt;x@y.z&gt;");
  });

  test("no extra lines when the client has no contact details", () => {
    const html = sheet({ client_address: null, client_email: null });
    expect(html).toContain("<strong>Acme</strong>");
    expect(html).not.toContain("2643 Morningside Dr");
  });
});

/** #639: paid invoice PDFs drop the PAY ONLINE link — nothing left to pay,
 *  and a stale payment instruction risks confusion or a double payment. */
describe("#639: PDF input omits payUrl once paid", () => {
  const input = (status: string) => views([]).invoicePdfInput({
    ...detailInv(status, status === "paid" ? "2026-09-25" : null),
    client_address: null, client_email: null,
    public_token: "tok123",
  } as any, "https://example.com");

  test("sent invoice keeps the public URL", () => {
    expect(input("sent").payUrl).toBe("https://example.com/i/tok123");
  });

  test("paid invoice drops the public URL", () => {
    expect(input("paid").payUrl).toBeUndefined();
  });
});

/** #643: switching invoices while scrolled down left the new detail rendered
 *  mid-sheet — the innerHTML fragment swap preserves the pane's scrollTop.
 *  The row-click swap spec must reset the detail pane to the top so every
 *  invoice opens on its header band. */
describe("#643: detail pane scrolls to top on invoice switch", () => {
  test("fragment swap spec includes scroll:top", () => {
    const html = views([{ ...baseRow, status: "sent", paid_at: null }]).invoicesPage(null, "http://x");
    expect(html).toContain('swap: "innerHTML scroll:top"');
  });
});

/* #679: the phone-stacked layout appends its "×" suffix from CSS, so the
   sheet marks a 1-hour cell with inv-hours-1 and the stylesheet swaps the
   suffix to the singular " hr". */
describe("#679: singular hour marker", () => {
  const mkItems = (hours: number) => [{
    description: "d", hours, rate: 40, amount: 40 * hours, entry_ids: [1],
    date_from: "2026-09-21", date_to: "2026-09-26",
  }];
  const sheet = (hours: number) =>
    views([]).invoiceSheet({ ...detailInv("sent", null), items: mkItems(hours) } as any);
  test("1-hour line item gets the inv-hours-1 marker", () => {
    expect(sheet(1)).toContain(`<td class="num inv-hours inv-hours-1">1</td>`);
  });
  test("other hours keep the plain inv-hours cell", () => {
    expect(sheet(2.5)).toContain(`<td class="num inv-hours">2.5</td>`);
    expect(sheet(2.5)).not.toContain(`inv-hours-1`);
  });
});

/** #668: manual line items — step 2 offers an "Add line item" button, and
 *  the no-unbilled-entries case renders the manual-item form instead of a
 *  dead end, so one-time work can be invoiced without tracked time. */
describe("#668: manual line items on step 2", () => {
  const p = {
    client_id: "1", from: "2026-09-01", to: "2026-09-30", rate: "40",
    number: "INV-0001", issue_date: "2026-09-01", due_date: "2026-09-16",
    tax_rate: "0", notes: "", internal_notes: "",
  };

  test("empty preview renders the manual-item form, not a dead end", () => {
    const html = views([]).invoiceStep2(p as any, {
      items: [], emptyMsg: "No unbilled, finished entries on this client's projects in that range.",
    });
    expect(html).toContain("No unbilled, finished entries");
    expect(html).toContain('action="/invoices"');
    expect(html).toContain('name="groups" value="0"');
    expect(html).toContain("data-add-item");
    expect(html).toContain("Add line item");
    expect(html).toContain("Create invoice");
  });

  test("preview with items also gets the add button", () => {
    const html = views([]).invoiceStep2(p as any, {
      items: [{ description: "Website", hours: 2.5, rate: 40, amount: 100, entry_ids: [1], date_from: "2026-09-20", date_to: "2026-09-20" }],
      rounding: 5,
    });
    expect(html).toContain("Website");
    expect(html).toContain('name="groups" value="1"');
    expect(html).toContain("data-add-item");
  });

  test("no preview renders nothing", () => {
    expect(views([]).invoiceStep2(p as any)).toBe("");
  });
});

/** #687: the grand-total row on a paid invoice must not claim an amount is
 * "due" — it reads "Total" once paid, "Total due" while draft/sent. */
describe("#687: invoice sheet grand-total label", () => {
  test("paid invoice sheet reads Total, not Total due", () => {
    const html = views([]).invoiceDoc(detailInv("paid", "2026-09-21") as any);
    expect(html).toContain('<tr class="grand"><td colspan="4">Total</td>');
    expect(html).not.toContain("Total due");
  });

  test("sent invoice sheet still reads Total due", () => {
    const html = views([]).invoiceDoc(detailInv("sent", null) as any);
    expect(html).toContain('<tr class="grand"><td colspan="4">Total due</td>');
  });
});
