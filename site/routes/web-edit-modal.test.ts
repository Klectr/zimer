/** #903: entry edit modal routes — the edit-modal fragment and the htmx save
 *  answer. Wires the real web router with a real DB and the real calendar
 *  views (which own the shared edit form). */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db.ts";
import { createWebRouter } from "./web.ts";
import { createCalendarViews } from "../views/calendar.ts";

function setupEntries() {
  const bundle = createDb(mkdtempSync(join(tmpdir(), "tk-web-903-")));
  const db = bundle.db;
  const noop = () => "";
  const calViews = createCalendarViews({
    db, qOne: bundle.qOne, qRange: bundle.qRange, entrySelect: bundle.ENTRY_SELECT,
    layout: (_t: string, b: string) => b,
    projectOptions: () => "",
    weekTargetBar: () => "",
    calHourPx: 64,
  } as any);
  const tenant = {
    db, dbPath: "",
    qRunning: bundle.qRunning, qOne: bundle.qOne, qRange: bundle.qRange,
    qInvoice: { get: () => null } as any,
    qInvoices: { all: () => [] } as any,
    notFoundPage: noop, errorPage: noop,
    dashboardPage: noop,
    timerPartial: noop, todayPartial: noop, weekInner: noop, weekStrip: noop,
    calendarPage: noop, editPage: calViews.editPage, entryEditModal: calViews.entryEditModal,
    managePage: noop, clientSelection: () => null, clientDetailBody: noop, clientListOob: noop,
    bizProfileSection: noop, clientSettingsForm: noop, themeSectionHtml: noop, settingsPage: noop,
    invoicesPage: noop, invoiceNewPage: noop,
    defaultNewInvParams: () => ({}), invoiceStep2: noop,
    invoiceDetailBody: noop, invoiceListOob: noop, invoiceDoc: noop, publicInvoicePage: noop,
    getInvoice: () => null, invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    nextInvoiceNumber: () => "INV-0001",
    stripeLinkFor: async () => ({}),
    unbilledEntries: () => [], groupToLineItems: () => [],
    clientRestFrom: () => null, ensurePublicToken: () => "",
    getPublicToken: () => null, mintPublicToken: () => "",
    invoicePdfInput: () => ({} as any),
    freezeInvoiceSnapshots: () => {},
  };
  const { handleWeb } = createWebRouter({
    getTenant: () => tenant as any,
    STATIC_DIR: "", TOKEN: "t",
    authedPage: () => true,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200) => new Response(body, { status }),
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    isHtmx: (req: Request) => req.headers.get("HX-Request") === "true",
    csvResponse: (f: string) => new Response(f),
    shareOrigin: () => "",
    PORT: 3000,
    loginPage: noop, signupPage: noop, hostedLoginPage: noop,
    HOSTED: false, accounts: null,
    changelogPage: () => [], termsPage: () => [],
    notFoundPage: noop, noSuchInvoicePage: noop,
    rateLimitPage: noop, errorPage: noop,
    invoicePdf: () => new Uint8Array(), stripeConfigured: () => false,
    workspaceEmpty: () => false, demoIds: () => [], seedDemoData: () => {},
    removeDemoData: () => {}, entryToJson: (e: any) => e,
  });
  return { db, handleWeb };
}

function newEntry(db: any) {
  return (db.query(
    "INSERT INTO time_entries (description, start_time, end_time) VALUES ('deep work', '2026-10-07T14:00:00.000Z', '2026-10-07T15:00:00.000Z') RETURNING id"
  ).get() as any).id as number;
}

function getEditModal(handleWeb: any, id: number | string, htmx = true) {
  const headers: Record<string, string> = {};
  if (htmx) headers["HX-Request"] = "true";
  const req = new Request(`http://x/entries/${id}/edit-modal`, { headers });
  return handleWeb(req, new URL(req.url), `/entries/${id}/edit-modal`, "GET");
}

function saveEntry(handleWeb: any, id: number, htmx: boolean) {
  const form = new FormData();
  form.append("description", "renamed");
  form.append("start_time", "2026-10-07T14:00:00-04:00");
  form.append("end_time", "2026-10-07T15:00:00-04:00");
  form.append("project_id", "");
  const headers: Record<string, string> = {};
  if (htmx) headers["HX-Request"] = "true";
  const req = new Request(`http://x/entries/${id}`, { method: "POST", body: form, headers });
  return handleWeb(req, new URL(req.url), `/entries/${id}`, "POST");
}

describe("entry edit modal routes (#903)", () => {
  test("GET edit-modal returns the htmx form fragment", async () => {
    const { db, handleWeb } = setupEntries();
    const id = newEntry(db);
    const res = await getEditModal(handleWeb, id);
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain(`hx-post="/entries/${id}"`);
    expect(body).toContain('hx-swap="none"');
    expect(body).toContain('value="deep work"');
  });

  test("GET edit-modal for an unknown entry is 404", async () => {
    const { handleWeb } = setupEntries();
    const res = await getEditModal(handleWeb, 999);
    expect(res!.status).toBe(404);
  });

  test("GET edit-modal for a locked entry is 403", async () => {
    const { db, handleWeb } = setupEntries();
    const id = newEntry(db);
    const inv = db.query(
      "INSERT INTO invoices (client_id, number, issue_date, status) VALUES (NULL, 'INV-0001', '2026-10-07', 'sent') RETURNING id"
    ).get() as any;
    db.query("UPDATE time_entries SET invoice_id = ? WHERE id = ?").run(inv.id, id);
    const res = await getEditModal(handleWeb, id);
    expect(res!.status).toBe(403);
  });

  test("htmx save answers 204 + HX-Trigger(timer-updated) and persists", async () => {
    const { db, handleWeb } = setupEntries();
    const id = newEntry(db);
    const res = await saveEntry(handleWeb, id, true);
    expect(res!.status).toBe(204);
    expect(res!.headers.get("HX-Trigger")).toBe("timer-updated");
    const row = db.query("SELECT description FROM time_entries WHERE id = ?").get(id) as any;
    expect(row.description).toBe("renamed");
  });

  test("htmx save of a locked entry is 403", async () => {
    const { db, handleWeb } = setupEntries();
    const id = newEntry(db);
    const inv = db.query(
      "INSERT INTO invoices (client_id, number, issue_date, status) VALUES (NULL, 'INV-0001', '2026-10-07', 'sent') RETURNING id"
    ).get() as any;
    db.query("UPDATE time_entries SET invoice_id = ? WHERE id = ?").run(inv.id, id);
    const res = await saveEntry(handleWeb, id, true);
    expect(res!.status).toBe(403);
  });

  test("plain (non-htmx) save keeps the 302 redirect to /calendar", async () => {
    const { db, handleWeb } = setupEntries();
    const id = newEntry(db);
    const res = await saveEntry(handleWeb, id, false);
    expect(res!.status).toBe(302);
    expect(res!.headers.get("Location")).toBe("/calendar");
  });

  test("direct GET /entries/:id/edit still renders the full page", async () => {
    const { db, handleWeb } = setupEntries();
    const id = newEntry(db);
    const req = new Request(`http://x/entries/${id}/edit`);
    const res = await handleWeb(req, new URL(req.url), `/entries/${id}/edit`, "GET");
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain(`method="post" action="/entries/${id}"`);
    expect(body).not.toContain("hx-post");
  });
});
