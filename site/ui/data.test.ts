import { describe, expect, test } from "bun:test";
import { statBlock } from "./stat";
import { progressBar } from "./progress";
import { steps } from "./steps";
import { zinvoiceRow, entryRow, clientRow } from "./rows";
import { lineItemsTable } from "./line-items";

describe("statBlock", () => {
  test("renders label, value, and optional sub", () => {
    const html = statBlock({ label: "Outstanding", value: "$3,915", sub: "3 sent" });
    expect(html).toContain('<div class="ui-stat-label">Outstanding</div>');
    expect(html).toContain('<div class="ui-stat-value">$3,915</div>');
    expect(html).toContain('<div class="ui-stat-sub">3 sent</div>');
    expect(statBlock({ label: "Drafts", value: "2" })).not.toContain("ui-stat-sub");
  });

  test("valueClass lands on the value element only when given (#1166)", () => {
    expect(statBlock({ label: "Paid", value: "$5", valueClass: "ui-rev-paid" }))
      .toContain('<div class="ui-stat-value ui-rev-paid">$5</div>');
    expect(statBlock({ label: "Paid", value: "$5" }))
      .toBe('<div><div class="ui-stat-label">Paid</div><div class="ui-stat-value">$5</div></div>');
  });
});

describe("progressBar", () => {
  test("clamps the value and exposes progressbar aria", () => {
    const html = progressBar({ value: 140, label: "Goal" });
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain("width:100%");
    expect(progressBar({ value: -5, label: "Goal" })).toContain('aria-valuenow="0"');
    expect(progressBar({ value: NaN, label: "Goal" })).toContain('aria-valuenow="0"');
  });
});

describe("steps", () => {
  test("marks done, current, and upcoming steps", () => {
    const html = steps({ items: ["Details", "Entries", "Review"], current: 1 });
    expect(html).toContain("ui-step is-done");
    expect(html).toContain("ui-step is-current");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain("Details");
  });

  test("current at or past the end renders the complete state (all done, none current)", () => {
    const html = steps({ items: ["Details", "Entries"], current: 2 });
    expect(html).not.toContain("is-current");
    expect(html).not.toContain('aria-current="step"');
    expect(html).toContain("is-done");
  });
});

describe("rows", () => {
  test("zinvoiceRow composes the status chip and mono amount", () => {
    const html = zinvoiceRow({ number: "INV-0042", client: "Northwind Legal", status: "sent", amount: "$2,550.00", meta: "Due Nov 12", href: "/invoices?invoice=1042" });
    expect(html).toContain('<a href="/invoices?invoice=1042" class="ui-row">');
    expect(html).toContain("ui-chip-sent");
    expect(html).toContain('<span class="ui-row-amount">$2,550.00</span>');
    expect(html).not.toContain("ui-chip-overdue");
  });

  test("zinvoiceRow renders the overdue chip beside the status chip when overdueDays is set", () => {
    const html = zinvoiceRow({ number: "INV-0042", client: "Northwind Legal", status: "sent", overdueDays: 12, amount: "$2,550.00", meta: "Due Oct 27", href: "/invoices?invoice=1042" });
    expect(html).toContain('<span class="ui-chip ui-chip-overdue">12d overdue</span>');
  });

  test("zinvoiceRow carries the selected state, hit class, aria label, and raw client html", () => {
    const html = zinvoiceRow({
      number: "INV-0042", client: "Northwind Legal", clientHtml: "<em>No client</em>", status: "sent",
      amount: "$2,550.00", meta: "", href: "/invoices?invoice=1042",
      ariaLabel: "View zinvoice INV-0042", selected: true, className: "inv-row-hit",
    });
    expect(html).toContain('<a href="/invoices?invoice=1042" class="ui-row selected inv-row-hit" aria-label="View zinvoice INV-0042">');
    expect(html).toContain('<div class="ui-row-meta"><em>No client</em></div>');
    expect(html).not.toContain("Northwind Legal");
  });

  test("rows use div wrappers (no div-inside-span nesting)", () => {
    const html = zinvoiceRow({ number: "INV-1", client: "C", status: "draft", amount: "$1", meta: "m", href: "/x" });
    expect(html).toContain('<div class="ui-row-main">');
    expect(html).toContain('<div class="ui-row-side">');
  });

  test("entryRow omits the amount line when not given", () => {
    const html = entryRow({ title: "Pass", meta: "Acme", duration: "1h 24m" });
    expect(html).toContain("1h 24m");
    expect(html).not.toContain("$");
  });

  test("entryRow renders actions, the invoice mark, and the running live hook", () => {
    const html = entryRow({ title: "Pass", meta: "Acme", duration: "0h 12m", running: true, mark: "Draft", actions: "<button>Edit</button>" });
    expect(html).toContain("is-running");
    expect(html).toContain("data-live-duration");
    expect(html).toContain("· Draft");
    expect(html).toContain("<button>Edit</button>");
  });

  test("clientRow renders the actions slot raw and escapes the name", () => {
    const html = clientRow({ name: "<b>X</b>", meta: "1 project", actions: "<button>Edit</button>" });
    expect(html).toContain("&lt;b&gt;");
    expect(html).toContain("<button>Edit</button>");
  });

  test("clientRow links the whole row when href is set, with dot, selected state, and chevron", () => {
    const html = clientRow({
      name: "Acme Studio", meta: "2 projects · $85/hr", href: "/manage?client=1",
      ariaLabel: "Manage client Acme Studio", dot: "#fb923c", selected: true, chevron: true,
    });
    expect(html).toContain('<a class="ui-row selected client-row-hit" href="/manage?client=1" aria-label="Manage client Acme Studio">');
    expect(html).toContain('<span class="ui-row-lead-dot" style="background:#fb923c" aria-hidden="true"></span>');
    expect(html).toContain("ui-row-chevron");
  });

  test("clientRow omits the meta line when not given and renders the icon dot variant", () => {
    const html = clientRow({ name: "No client", href: "/manage?client=none", iconDot: "group", chevron: true });
    expect(html).not.toContain("ui-row-meta");
    expect(html).toContain("ui-row-lead-icon");
  });
});

describe("lineItemsTable", () => {
  test("renders the real sheet shape: date first, numeric hours/rate/amount, scoped heads", () => {
    const html = lineItemsTable({
      items: [{ dateRange: "Oct 20 – Oct 24", description: "Fixes", hours: "9.5h", rate: "$95", amount: "$902.50" }],
      totals: [{ label: "Total due", amount: "$902.50" }],
    });
    expect(html).toContain('<table class="ui-table">');
    expect(html).toContain('<th scope="col">Date</th>');
    expect(html).toContain('<th scope="col" class="num">Hours</th>');
    expect(html).toContain('<td class="num">9.5h</td>');
    expect(html).toContain('<td colspan="4">Total due</td>');
  });

  test("renders multiple totals rows (subtotal, tax, total)", () => {
    const html = lineItemsTable({
      items: [],
      totals: [
        { label: "Subtotal", amount: "$100.00" },
        { label: "Tax", amount: "$8.00" },
        { label: "Total due", amount: "$108.00" },
      ],
    });
    expect(html).toContain("Subtotal");
    expect(html).toContain("Tax");
    expect(html).toContain("$108.00");
  });

  test("empty items render the no-line-items row", () => {
    const html = lineItemsTable({ items: [], totals: [] });
    expect(html).toContain('<td colspan="5">No line items.</td>');
  });
});

describe("entryRow extensions (#1102)", () => {
  test("id, metaHtml, and dot land; plain meta still escapes", () => {
    const html = entryRow({ id: "entry-7", title: "Acme — Design", metaHtml: "<span>9:04 AM – now</span>", duration: "1h 24m", dot: "#fb923c", running: true });
    expect(html).toContain('id="entry-7"');
    expect(html).toContain('<span class="ui-row-dot" style="background:#fb923c"');
    expect(html).toContain("<span>9:04 AM – now</span>");
    expect(html).toContain("data-live-duration");
    expect(entryRow({ title: "T", meta: "<b>x</b>", duration: "1h" })).toContain("&lt;b&gt;");
  });
});

describe("entryRow link + trailing extensions (#1166)", () => {
  test("href makes the whole row an anchor; trailing renders raw after the side", () => {
    const html = entryRow({
      title: "Acme", meta: "INV-1 · Due 2026-01-01", duration: "$5.00",
      href: "/invoices?invoice=3",
      trailing: '<span class="ui-attn-chip" data-bucket="0-7">2d overdue</span>',
    });
    expect(html).toBe(
      '<a class="ui-row" href="/invoices?invoice=3">' +
      '<div class="ui-row-main"><span class="ui-row-title">Acme</span>' +
      '<div class="ui-row-meta">INV-1 · Due 2026-01-01</div></div>' +
      '<div class="ui-row-side"><span class="ui-row-amount">$5.00</span></div>' +
      '<span class="ui-attn-chip" data-bucket="0-7">2d overdue</span></a>',
    );
  });

  test("without href/trailing the output is the plain div row, unchanged", () => {
    expect(entryRow({ title: "T", meta: "M", duration: "1h" })).toBe(
      '<div class="ui-row"><div class="ui-row-main"><span class="ui-row-title">T</span>' +
      '<div class="ui-row-meta">M</div></div>' +
      '<div class="ui-row-side"><span class="ui-row-amount">1h</span></div></div>',
    );
  });
});
