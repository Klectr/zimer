/** #701: every app page renders exactly one h1 — the visible page title.
 *
 *  Timer, calendar, invoices list, new invoice, manage, and settings all
 *  rendered with zero h1 elements (their titles were h2s), so screen-reader
 *  heading navigation had no page-level heading. Each page-title h2 was
 *  promoted to h1 in place, with identical classes (zero visual change).
 */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { createTimerViews } from "./timer.ts";
import { createCalendarViews } from "./calendar.ts";
import { createInvoiceViews } from "./invoices.ts";
import { createManageViews } from "./manage.ts";

const stubQuery = () => ({
  get: (..._a: unknown[]) => ({ n: 0 }),
  all: (..._a: unknown[]) => [],
  run: (..._a: unknown[]) => {},
});
const stubDb = { query: (_sql: string) => stubQuery() } as unknown as Database;
const layout = (_t: string, b: string) => b;

const h1Texts = (html: string) =>
  [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim()
  );

function timerPage(): string {
  const deps = {
    db: stubDb,
    qRunning: { get: () => null } as unknown as Statement,
    qRange: { all: () => [] } as unknown as Statement,
    layout,
    demoBanner: () => "",
    projectOptions: () => "",
    projectOptionRows: () => [],
    revenueTotals: () => ({ invoiced: 0, paid: 0, outstanding: 0 }),
    revenueMonthly: () => [],
    revenueByClient: () => [],
    revenueOverdue: () => [],
    m3ProgressBar: () => "",
    dayTargetSecs: () => 8 * 3600,
  };
  return createTimerViews(deps as any).dashboardPage();
}

/* The calendar's week grid (incl. the week-nav h1) loads via htmx on page
   load — the initial server render is an aria-hidden skeleton. */
function calendarWeekHtml(): string {
  const deps = {
    db: stubDb,
    qOne: { get: () => null } as unknown as Statement,
    qRange: { all: () => [] } as unknown as Statement,
    entrySelect: "",
    layout,
    projectOptions: () => "",
    projectOptionRows: () => [],
    weekTargetBar: () => "",
    calHourPx: 56,
  };
  return createCalendarViews(deps as any).weekStrip();
}

function invoicePages() {
  const views = createInvoiceViews({
    db: stubDb,
    qInvoices: { all: () => [] } as unknown as Statement,
    layout,
    getPublicToken: () => null,
    stripeConfigured: () => false,
    nextInvoiceNumber: () => "INV-0001",
    invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    isOverdue: () => false,
    unbilledByClient: () => [],
  } as any);
  return {
    list: views.invoicesPage(null, ""),
    form: views.invoiceNewPage(views.defaultNewInvParams()),
  };
}

function managePages() {
  const views = createManageViews({ db: stubDb, layout, unbilledByClient: () => [] });
  return {
    manage: views.managePage({ kind: "none" }),
    settings: views.settingsPage(""),
  };
}

describe("page-level h1 (#701)", () => {
  test("timer page has exactly one h1: Today", () => {
    expect(h1Texts(timerPage())).toEqual(["Today"]);
  });
  test("calendar page has exactly one h1: the week nav title", () => {
    const h1 = h1Texts(calendarWeekHtml());
    expect(h1).toHaveLength(1);
    expect(h1[0].length).toBeGreaterThan(0);
  });
  test("invoices list page has exactly one h1: Zinvoices", () => {
    expect(h1Texts(invoicePages().list)).toEqual(["Zinvoices"]);
  });
  test("new invoice page has exactly one h1: New Zinvoice", () => {
    expect(h1Texts(invoicePages().form)).toEqual(["New Zinvoice"]);
  });
  test("manage page has exactly one h1: Clients", () => {
    expect(h1Texts(managePages().manage)).toEqual(["Clients"]);
  });
  test("settings page h1 carries the ui title class (migrated in #1100)", () => {
    expect(managePages().settings).toContain('<h1 class="ui-app-title">Settings</h1>');
  });
  test("settings page has exactly one h1: Settings", () => {
    expect(h1Texts(managePages().settings)).toEqual(["Settings"]);
  });
  test("timer page h1 carries the ui title class (appHeader, #1121)", () => {
    expect(timerPage()).toContain('<h1 class="ui-app-title">Today</h1>');
  });
  test("manage page h1 carries the ui title class (migrated in #1105)", () => {
    expect(managePages().manage).toContain('<h1 class="ui-app-title">Clients</h1>');
  });
  test("zinvoices page h1s carry the ui title class (list: appHeader, #1121)", () => {
    expect(invoicePages().list).toContain('<h1 class="ui-app-title">Zinvoices</h1>');
    expect(invoicePages().form).toContain('<h1 class="ui-app-title">New Zinvoice</h1>');
  });
  test("the calendar week heading carries the ui page title (migrated in #1111)", () => {
    expect(calendarWeekHtml()).toContain('<h1 class="ui-page-title">');
  });
});
