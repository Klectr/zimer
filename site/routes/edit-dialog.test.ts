/** #903: timer-page entry edit dialog routes — htmx GET /entries/:id/edit serves
 *  the dialog fragment (direct visits keep the full edit page); htmx POST
 *  saves and answers HX-Trigger so #today-list refreshes in place. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createDb } from "../db.ts";
import { createWebRouter } from "./web.ts";
import { createCalendarViews } from "../views/calendar.ts";

const ENTRY_SELECT = `
  SELECT e.id, e.project_id, e.description, e.start_time, e.end_time, e.invoice_id,
         p.name AS project_name, c.name AS client_name, c.color AS client_color,
         i.number AS invoice_number, i.status AS invoice_status
  FROM time_entries e
  LEFT JOIN projects p ON p.id = e.project_id
  LEFT JOIN clients c ON c.id = p.client_id
  LEFT JOIN invoices i ON i.id = e.invoice_id`;

function setup() {
  const db = createDb(mkdtempSync(join(tmpdir(), "tk-editdlg-"))).db;
  db.query("INSERT INTO time_entries (description, start_time, end_time) VALUES ('Deep work', '2026-10-07T14:00:00.000Z', '2026-10-07T15:00:00.000Z')").run();
  const entry = db.query("SELECT id FROM time_entries").get() as any;
  const qOne = db.query(`${ENTRY_SELECT} WHERE e.id = ?`);
  const views = createCalendarViews({
    db, qOne,
    qRange: { all: () => [] } as any,
    entrySelect: ENTRY_SELECT,
    layout: (t: string, b: string) => `<!DOCTYPE html><title>${t}</title>${b}`,
    projectOptions: () => "",
    weekTargetBar: () => "",
    calHourPx: 64,
  } as any);
  const noop = () => "";
  const tenant = {
    db, dbPath: "",
    qRunning: { get: () => null } as any,
    qOne,
    qRange: { all: () => [] } as any,
    qInvoice: { get: () => null } as any,
    qInvoices: { all: () => [] } as any,
    notFoundPage: noop, errorPage: noop,
    dashboardPage: noop,
    timerPartial: noop, todayPartial: noop, weekInner: noop, weekStrip: noop,
    calendarPage: noop, editPage: views.editPage, editEntryDialog: views.editEntryDialog,
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
  return { db, entry, handleWeb };
}

function getEdit(handleWeb: any, id: number | string, htmx: boolean) {
  const headers: Record<string, string> = {};
  if (htmx) headers["HX-Request"] = "true";
  const req = new Request(`http://x/entries/${id}/edit`, { headers });
  return handleWeb(req, new URL(req.url), `/entries/${id}/edit`, "GET");
}

function postEdit(handleWeb: any, id: number, fields: Record<string, string>, htmx: boolean) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const headers: Record<string, string> = {};
  if (htmx) headers["HX-Request"] = "true";
  const req = new Request(`http://x/entries/${id}`, { method: "POST", body: form, headers });
  return handleWeb(req, new URL(req.url), `/entries/${id}`, "POST");
}

const SAVE = {
  description: "Deeper work",
  project_id: "",
  start_time: "2026-10-07T16:00:00+00:00",
  end_time: "2026-10-07T17:30:00+00:00",
};

describe("entry edit dialog routes (#903)", () => {
  test("htmx GET serves the bare dialog fragment", async () => {
    const { entry, handleWeb } = setup();
    const res = await getEdit(handleWeb, entry.id, true);
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain('id="entry-dialog-title"');
    expect(body).toContain(`hx-post="/entries/${entry.id}"`);
    expect(body).toContain('id="edit-entry-form"');
    expect(body).not.toContain("<!DOCTYPE html>");
  });

  test("direct GET keeps the full edit page", async () => {
    const { entry, handleWeb } = setup();
    const res = await getEdit(handleWeb, entry.id, false);
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body.includes('id="edit-entry-form"')).toBe(true);
  });

  test("htmx GET for an unknown entry is 404", async () => {
    const { handleWeb } = setup();
    const res = await getEdit(handleWeb, 999, true);
    expect(res!.status).toBe(404);
  });

  test("htmx POST saves and triggers the today-list refresh", async () => {
    const { db, entry, handleWeb } = setup();
    const res = await postEdit(handleWeb, entry.id, SAVE, true);
    expect(res!.status).toBe(200);
    expect(res!.headers.get("HX-Trigger")).toBe("timer-updated");
    const row = db.query("SELECT description, start_time, end_time FROM time_entries WHERE id = ?").get(entry.id) as any;
    expect(row.description).toBe("Deeper work");
    expect(row.start_time).toBe("2026-10-07T16:00:00.000Z");
    expect(row.end_time).toBe("2026-10-07T17:30:00.000Z");
  });

  test("non-htmx POST keeps the 302 to /calendar", async () => {
    const { db, entry, handleWeb } = setup();
    const res = await postEdit(handleWeb, entry.id, SAVE, false);
    expect(res!.status).toBe(302);
    expect(res!.headers.get("Location")).toBe("/calendar");
    const row = db.query("SELECT description FROM time_entries WHERE id = ?").get(entry.id) as any;
    expect(row.description).toBe("Deeper work");
  });
});

/** #964: the edit dialog's form used to carry native method/action alongside
 * hx-post, so a native-submit fallback posted bare datetimes the server
 * parsed as UTC, silently shifting times. The form is htmx-only now, and the
 * server rejects bare datetimes with 400 instead of corrupting them. */
describe("bare datetimes are rejected (#964)", () => {
  const BARE = {
    description: "Deeper work",
    project_id: "",
    start_time: "2026-10-07T16:00",
    end_time: "2026-10-07T17:30",
  };

  test("htmx POST with a bare start_time is 400 and saves nothing", async () => {
    const { db, entry, handleWeb } = setup();
    const res = await postEdit(handleWeb, entry.id, BARE, true);
    expect(res!.status).toBe(400);
    const row = db.query("SELECT description, start_time FROM time_entries WHERE id = ?").get(entry.id) as any;
    expect(row.description).toBe("Deep work");
    expect(row.start_time).toBe("2026-10-07T14:00:00.000Z");
  });

  test("non-htmx POST with a bare start_time is 400 too", async () => {
    const { entry, handleWeb } = setup();
    const res = await postEdit(handleWeb, entry.id, BARE, false);
    expect(res!.status).toBe(400);
  });

  test("dialog form has no native method/action — htmx only", async () => {
    const { entry, handleWeb } = setup();
    const res = await getEdit(handleWeb, entry.id, true);
    const body = await res!.text();
    expect(body).toContain(`hx-post="/entries/${entry.id}"`);
    expect(body).not.toContain('method="post"');
    expect(body).not.toContain('action="/entries/');
  });
});

/** #975: the dialog's htmx:configRequest handler appended the tz suffix only
 *  when `els[j].name in ev.detail.parameters` — but htmx 2.0.4's parameters
 *  is a Proxy over FormData with no `has` trap, so the check was always
 *  false, the suffix never landed, and every dialog save hit the #964 400.
 *  The handler must assign unconditionally (the proxy's set trap writes
 *  through to the FormData). */
describe("dialog tz-suffix handler shape (#975)", () => {
  test("configRequest handler assigns parameters without an `in` guard", async () => {
    const { entry, handleWeb } = setup();
    const res = await getEdit(handleWeb, entry.id, true);
    const body = await res!.text();
    expect(body).toContain("ev.detail.parameters[els[j].name]=els[j].value+suf;");
    expect(body).not.toContain("in ev.detail.parameters");
  });
});
