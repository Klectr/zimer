/** #630: client settings modal — GET/POST /clients/:id/settings (name +
 * contact details). Wires the real web router with stub deps (plus the real
 * manage views so the settings form fragment is exercised). */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createDb, getMeta } from "../db.ts";
import { addDays, todayStr } from "../lib/format.ts";
import { createDomain } from "../lib/domain.ts";
import { createWebRouter } from "./web.ts";
import { createManageViews } from "../views/manage.ts";
import { createInvoiceViews } from "../views/invoices.ts";
import { invoicePdf } from "../pdf.ts";

function setup() {
  const bundle = createDb(mkdtempSync(join(tmpdir(), "tk-web-")));
  const db = bundle.db;
  db.query("INSERT INTO clients (name, color, rate) VALUES ('Bytebot', '#fb923c', 40)").run();
  const client = db.query("SELECT * FROM clients").get() as any;
  const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
  const unbilledCalls: any[][] = [];
  const todayCalls: any[][] = [];
  const statsCalls: any[][] = [];
  const noop = () => "";
  /* #733: data deps resolve per request through getTenant now. */
  const tenant = {
    db, dbPath: "",
    qRunning: { get: () => null } as any,
    qOne: bundle.qOne as any,
    qRange: { all: () => [] } as any,
    qInvoice: { get: () => null } as any,
    qInvoices: { all: () => [] } as any,
    notFoundPage: noop, errorPage: noop,
    dashboardPage: noop,
    timerPartial: noop,
    todayPartial: (...args: any[]) => { todayCalls.push(args); return ""; },
    todayStatsPartial: (...args: any[]) => { statsCalls.push(args); return ""; },
    weekInner: noop, weekStrip: noop,
    calendarPage: noop, editPage: () => null,
    managePage: views.managePage, clientSelection: views.clientSelection,
    clientDialogBody: views.clientDialogBody, clientDialogProjects: views.clientDialogProjects, manageListsOob: views.manageListsOob,
    bizProfileSection: noop, dailyTargetSection: views.dailyTargetSection, dailyTargetControl: views.dailyTargetControl, preferencesSection: views.preferencesSection, clientSettingsForm: views.clientSettingsForm, themeSectionHtml: views.themeSectionHtml, themeDotsHtml: views.themeDotsHtml, settingsPage: noop,
    invoicesPage: noop, invoiceNewPage: noop,
    defaultNewInvParams: () => ({}), invoiceStep2: noop,
    invoiceDetailBody: noop, invoiceListOob: noop, invoiceDoc: noop, publicInvoicePage: noop,
    getInvoice: () => null, invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    nextInvoiceNumber: () => "INV-0001",
    stripeLinkFor: async () => ({}),
    unbilledEntries: (...args: any[]) => { unbilledCalls.push(args); return []; }, groupToLineItems: () => [],
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
    html: (body: string, status = 200, extra: Record<string, string> = {}) => new Response(body, { status, headers: extra }),
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
  return { db, client, handleWeb, unbilledCalls, todayCalls, statsCalls };
}

function postSettings(handleWeb: any, id: number, fields: Record<string, string>, htmx = true) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const headers: Record<string, string> = {};
  if (htmx) headers["HX-Request"] = "true";
  const req = new Request(`http://x/clients/${id}/settings`, { method: "POST", body: form, headers });
  return handleWeb(req, new URL(req.url), `/clients/${id}/settings`, "POST");
}

function getSettings(handleWeb: any, id: number | string, htmx = true) {
  const headers: Record<string, string> = {};
  if (htmx) headers["HX-Request"] = "true";
  const req = new Request(`http://x/clients/${id}/settings`, { headers });
  return handleWeb(req, new URL(req.url), `/clients/${id}/settings`, "GET");
}

describe("calendar ?day= redirect (#1501)", () => {
  function getCalendar(handleWeb: any, qs: string) {
    const req = new Request(`http://x/calendar${qs}`);
    return handleWeb(req, new URL(req.url), "/calendar", "GET");
  }
  test("a real day redirects to its containing week", async () => {
    const { handleWeb } = setup();
    const res = await getCalendar(handleWeb, "?day=2026-09-21");
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/calendar?week=2026-09-20");
  });
  test("an impossible day falls back to the calendar page, no redirect", async () => {
    const { handleWeb } = setup();
    const res = await getCalendar(handleWeb, "?day=2026-02-30");
    expect(res.status).toBe(200);
    expect(res.headers.get("Location")).toBeNull();
  });
});

describe("day-bounds partials (#1516)", () => {
  function get(handleWeb: any, path: string, qs: string) {
    const req = new Request(`http://x${path}${qs}`);
    return handleWeb(req, new URL(req.url), path, "GET");
  }
  test("/partial/today passes a valid pair through, normalized", async () => {
    const { handleWeb, todayCalls } = setup();
    await get(handleWeb, "/partial/today", "?from=2026-11-25T00:00:00Z&to=2026-11-26T00:00:00Z");
    expect(todayCalls[0][0]).toBe("2026-11-25T00:00:00.000Z");
    expect(todayCalls[0][1]).toBe("2026-11-26T00:00:00.000Z");
  });
  test("/partial/today falls back on an impossible date", async () => {
    const { handleWeb, todayCalls } = setup();
    await get(handleWeb, "/partial/today", "?from=2026-02-30T00:00:00Z&to=2026-03-01T00:00:00Z");
    expect(todayCalls[0][0]).toBeUndefined();
    expect(todayCalls[0][1]).toBeUndefined();
  });
  test("/partial/today falls back on a reversed pair", async () => {
    const { handleWeb, todayCalls } = setup();
    await get(handleWeb, "/partial/today", "?from=2026-11-26T00:00:00Z&to=2026-11-25T00:00:00Z");
    expect(todayCalls[0][0]).toBeUndefined();
    expect(todayCalls[0][1]).toBeUndefined();
  });
  test("/partial/today-stats falls back per pair", async () => {
    const { handleWeb, statsCalls } = setup();
    await get(handleWeb, "/partial/today-stats",
      "?from=2026-11-25T00:00:00Z&to=2026-11-26T00:00:00Z&wfrom=2026-02-30T00:00:00Z&wto=2026-03-01T00:00:00Z");
    expect(statsCalls[0][0]).toBe("2026-11-25T00:00:00.000Z");
    expect(statsCalls[0][1]).toBe("2026-11-26T00:00:00.000Z");
    expect(statsCalls[0][2]).toBeUndefined();
    expect(statsCalls[0][3]).toBeUndefined();
  });
});

describe("client settings (#630)", () => {
  const full = {
    name: "  Byte Bot LLC  ",
    rate: "45", payment_terms: "net_15", color: "#38bdf8",
    email: " ap@bytebot.io ", phone: " 555-0100 ", website: "bytebot.io",
    address: " 2643 Morningside Dr\r\nClearwater, FL 33759 ",
  };

  test("GET returns the settings form", async () => {
    const { client, handleWeb } = setup();
    const res = await getSettings(handleWeb, client.id);
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain('id="client-settings-form"');
    expect(body).toContain('name="name" value="Bytebot"');
  });

  test("GET for an unknown client is 404", async () => {
    const { handleWeb } = setup();
    const res = await getSettings(handleWeb, 999);
    expect(res!.status).toBe(404);
  });

  test("POST saves all eight fields trimmed, returning the form", async () => {
    const { db, client, handleWeb } = setup();
    const res = await postSettings(handleWeb, client.id, full);
    expect(res!.status).toBe(200);
    const row = db.query("SELECT name, rate, payment_terms, email, phone, website, address, color FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.name).toBe("Byte Bot LLC");
    expect(row.rate).toBe(45);
    expect(row.payment_terms).toBe("net_15");
    expect(row.email).toBe("ap@bytebot.io");
    expect(row.phone).toBe("555-0100");
    expect(row.website).toBe("bytebot.io");
    expect(row.address).toBe("2643 Morningside Dr\nClearwater, FL 33759");
    expect(row.color).toBe("#38bdf8");
    const body = await res!.text();
    expect(body).toContain('id="client-settings-form"');
    expect(body).toContain('name="name" value="Byte Bot LLC"');
    expect(body).toContain('name="rate" value="45"');
    expect(body).toContain('name="color" value="#38bdf8"');
    expect(body).toContain("ap@bytebot.io");
  });

  /* #1160: an invalid color falls back to the default, same as create. */
  test("an invalid color falls back to the default on save", async () => {
    const { db, client, handleWeb } = setup();
    const res = await postSettings(handleWeb, client.id, { ...full, color: "not-a-color" });
    expect(res!.status).toBe(200);
    const row = db.query("SELECT color FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.color).toBe("#fb923c");
  });

  /* #1160 review: a save that omits the color field (a pre-#1160 form, any
     caller that never had the field) keeps the stored color. */
  test("a settings save without a color field keeps the stored color", async () => {
    const { db, client, handleWeb } = setup();
    db.query("UPDATE clients SET color = '#a78bfa' WHERE id = ?").run(client.id);
    const { color: _omit, ...noColor } = full as any;
    const res = await postSettings(handleWeb, client.id, noColor);
    expect(res!.status).toBe(200);
    const row = db.query("SELECT color FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.color).toBe("#a78bfa");
  });

  /* #1160: HTMX validation failures answer 422 with the form re-rendered
     around the error (the dialog swaps it in); the row stays untouched. */
  test("empty name is rejected with a 422 inline error and leaves the row untouched", async () => {
    const { db, client, handleWeb } = setup();
    const res = await postSettings(handleWeb, client.id, { ...full, name: "   " });
    expect(res!.status).toBe(422);
    const body = await res!.text();
    expect(body).toContain('id="client-settings-form"');
    expect(body).toContain('<p class="error" role="alert">Client name is required.</p>');
    const row = db.query("SELECT name FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.name).toBe("Bytebot");
  });

  test("unknown payment terms are rejected with a 422 inline error and leave the row untouched", async () => {
    const { db, client, handleWeb } = setup();
    const res = await postSettings(handleWeb, client.id, { ...full, payment_terms: "net_99" });
    expect(res!.status).toBe(422);
    const body = await res!.text();
    expect(body).toContain('<p class="error" role="alert">Unknown payment terms.</p>');
    const row = db.query("SELECT payment_terms FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.payment_terms).toBeNull();
  });

  test("negative or non-numeric rate is rejected with a 422 inline error and leaves the row untouched", async () => {
    const { db, client, handleWeb } = setup();
    for (const rate of ["-5", "abc"]) {
      const res = await postSettings(handleWeb, client.id, { ...full, rate });
      expect(res!.status).toBe(422);
      const body = await res!.text();
      expect(body).toContain('<p class="error" role="alert">Hourly rate must be a number at or above 0.</p>');
    }
    const row = db.query("SELECT rate FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.rate).toBe(40);
  });

  /* #1160: plain (non-HTMX) posts keep the original 400 text contract. */
  test("a plain POST validation failure stays a 400 text response", async () => {
    const { client, handleWeb } = setup();
    const res = await postSettings(handleWeb, client.id, { ...full, name: "   " }, false);
    expect(res!.status).toBe(400);
    expect(await res!.text()).toBe("Client name is required.");
  });

  test("blank rate stores 0 and blank payment terms store NULL", async () => {
    const { db, client, handleWeb } = setup();
    const res = await postSettings(handleWeb, client.id, { ...full, rate: "", payment_terms: "" });
    expect(res!.status).toBe(200);
    const row = db.query("SELECT rate, payment_terms FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.rate).toBe(0);
    expect(row.payment_terms).toBeNull();
  });

  test("blank contact fields store NULL", async () => {
    const { db, client, handleWeb } = setup();
    await postSettings(handleWeb, client.id, { ...full, email: "   ", phone: "" });
    const row = db.query("SELECT email, phone FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.email).toBeNull();
    expect(row.phone).toBeNull();
  });

  test("plain POST redirects to the manage page", async () => {
    const { client, handleWeb } = setup();
    const res = await postSettings(handleWeb, client.id, full, false);
    expect(res!.status).toBe(302);
    expect(res!.headers.get("Location")).toBe("/manage");
  });
});

/** #1160: the add-client form collects email at creation (the page-manage
 *  mock always had the field; the live form dropped it). */
function postClient(handleWeb: any, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const req = new Request("http://x/clients", { method: "POST", body: form });
  return handleWeb(req, new URL(req.url), "/clients", "POST");
}

describe("client create (#1160)", () => {
  test("POST /clients stores the email, trimmed", async () => {
    const { db, handleWeb } = setup();
    const res = await postClient(handleWeb, { name: "Harbor Dental", rate: "75", color: "#4ade80", email: " billing@harbor.example " });
    expect(res!.status).toBe(302);
    const row = db.query("SELECT id, name, email, color FROM clients WHERE name = 'Harbor Dental'").get() as any;
    expect(row.email).toBe("billing@harbor.example");
    expect(row.color).toBe("#4ade80");
    expect(res!.headers.get("Location")).toBe("/manage");
  });

  test("POST /clients with a blank email stores NULL", async () => {
    const { db, handleWeb } = setup();
    await postClient(handleWeb, { name: "No Email Co", rate: "", color: "", email: "   " });
    const row = db.query("SELECT email FROM clients WHERE name = 'No Email Co'").get() as any;
    expect(row.email).toBeNull();
  });
});

/** #1442: client create mirrors the settings rate rule. */
describe("client create rate validation (#1442)", () => {
  test("a negative rate is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postClient(handleWeb, { name: "Neg Co", rate: "-5", color: "", email: "" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("at or above 0");
    expect(db.query("SELECT COUNT(*) AS n FROM clients WHERE name = 'Neg Co'").get()).toEqual({ n: 0 });
  });

  test("a non-finite rate is rejected", async () => {
    const { db, handleWeb } = setup();
    const res = await postClient(handleWeb, { name: "Inf Co", rate: "Infinity", color: "", email: "" });
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM clients WHERE name = 'Inf Co'").get()).toEqual({ n: 0 });
  });

  test("a valid rate is stored as given", async () => {
    const { db, handleWeb } = setup();
    const res = await postClient(handleWeb, { name: "Rate Co", rate: "75", color: "", email: "" });
    expect(res!.status).toBe(302);
    const row = db.query("SELECT rate FROM clients WHERE name = 'Rate Co'").get() as any;
    expect(row.rate).toBe(75);
  });
});

/** #1454: web create routes require a name, like the settings route.
 *  (The API routes only reject a missing/empty name — whitespace names
 *  still slip through there; that parity gap is filed separately.) */
function postProject(handleWeb: any, fields: Record<string, string>, htmx = false) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const headers: Record<string, string> = {};
  if (htmx) headers["HX-Request"] = "true";
  const req = new Request("http://x/projects", { method: "POST", body: form, headers });
  return handleWeb(req, new URL(req.url), "/projects", "POST");
}

describe("create name validation (#1454)", () => {
  test("a blank client name is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const before = (db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n;
    const res = await postClient(handleWeb, { name: "", rate: "", color: "", email: "" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("Client name is required.");
    expect((db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n).toBe(before);
  });

  test("a whitespace-only client name is rejected", async () => {
    const { db, handleWeb } = setup();
    const before = (db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n;
    const res = await postClient(handleWeb, { name: "   ", rate: "", color: "", email: "" });
    expect(res!.status).toBe(400);
    expect((db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n).toBe(before);
  });

  test("a missing client name field is rejected, not stored as \"null\"", async () => {
    const { db, handleWeb } = setup();
    const before = (db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n;
    const res = await postClient(handleWeb, { rate: "", color: "", email: "" });
    expect(res!.status).toBe(400);
    expect((db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n).toBe(before);
  });

  test("a padded client name is stored trimmed", async () => {
    const { db, handleWeb } = setup();
    const res = await postClient(handleWeb, { name: "  Padded Co  ", rate: "", color: "", email: "" });
    expect(res!.status).toBe(302);
    expect(db.query("SELECT COUNT(*) AS n FROM clients WHERE name = 'Padded Co'").get()).toEqual({ n: 1 });
  });

  test("a blank project name is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postProject(handleWeb, { name: "  " });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("Project name is required.");
    expect(db.query("SELECT COUNT(*) AS n FROM projects").get()).toEqual({ n: 0 });
  });

  test("a padded project name is stored trimmed", async () => {
    const { db, handleWeb } = setup();
    const res = await postProject(handleWeb, { name: "  Site Redesign  " });
    expect(res!.status).toBe(302);
    expect(db.query("SELECT COUNT(*) AS n FROM projects WHERE name = 'Site Redesign'").get()).toEqual({ n: 1 });
  });

  test("a missing project name field is rejected, not stored as \"null\"", async () => {
    const { db, handleWeb } = setup();
    const res = await postProject(handleWeb, {});
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM projects").get()).toEqual({ n: 0 });
  });

  test("an HTMX blank project name gets the 422 fragment with the error, nothing stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postProject(handleWeb, { name: "   " }, true);
    expect(res!.status).toBe(422);
    const body = await res!.text();
    expect(body).toContain("Project name is required.");
    expect(body).toContain('id="client-dialog-projects"');
    expect(db.query("SELECT COUNT(*) AS n FROM projects").get()).toEqual({ n: 0 });
  });

  test("an HTMX valid project name swaps the fragment and stores trimmed", async () => {
    const { db, handleWeb } = setup();
    const res = await postProject(handleWeb, { name: "  HTMX Proj  " }, true);
    expect(res!.status).toBe(200);
    expect(db.query("SELECT COUNT(*) AS n FROM projects WHERE name = 'HTMX Proj'").get()).toEqual({ n: 1 });
  });

  test("a project with a non-existent client_id is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postProject(handleWeb, { name: "Site", client_id: "999" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("That client no longer exists.");
    expect(db.query("SELECT COUNT(*) AS n FROM projects").get()).toEqual({ n: 0 });
  });

  test("a project with a non-numeric client_id is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postProject(handleWeb, { name: "Site", client_id: "abc" });
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM projects").get()).toEqual({ n: 0 });
  });

  test("an HTMX project with a non-existent client_id gets the 422 fragment with the error, nothing stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postProject(handleWeb, { name: "Site", client_id: "999" }, true);
    expect(res!.status).toBe(422);
    const body = await res!.text();
    expect(body).toContain("That client no longer exists.");
    expect(body).toContain('id="client-dialog-projects"');
    expect(db.query("SELECT COUNT(*) AS n FROM projects").get()).toEqual({ n: 0 });
  });

  test("a project with an existing client_id stores it", async () => {
    const { db, client, handleWeb } = setup();
    const res = await postProject(handleWeb, { name: "Site", client_id: String(client.id) });
    expect(res!.status).toBe(302);
    expect(db.query("SELECT client_id FROM projects WHERE name = 'Site'").get()).toEqual({ client_id: client.id });
  });
});

/** #668: manual line items — POST /invoices accepts rows with no entry
 *  ids, so one-time work can be invoiced without tracked time. */
function postInvoice(handleWeb: any, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const req = new Request("http://x/invoices", { method: "POST", body: form });
  return handleWeb(req, new URL(req.url), "/invoices", "POST");
}

const baseInvoiceFields = { client_id: "1", number: "INV-0001", issue_date: "2026-09-20", due_date: "", tax_rate: "0", notes: "", internal_notes: "" };

describe("manual line items (#668)", () => {
  test("a manual row creates the invoice with no linked entries", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Logo design", g0_hours: "1", g0_rate: "250",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(302);
    const inv = db.query("SELECT * FROM invoices").get() as any;
    expect(inv.number).toBe("INV-0001");
    const items = db.query("SELECT * FROM invoice_items WHERE invoice_id = ?").all(inv.id) as any[];
    expect(items.length).toBe(1);
    expect(items[0].description).toBe("Logo design");
    expect(items[0].hours).toBe(1);
    expect(items[0].rate).toBe(250);
    expect(items[0].amount).toBe(250);
    expect(items[0].date_from).toBeNull();
    expect(items[0].date_to).toBeNull();
    expect(db.query("SELECT COUNT(*) AS n FROM time_entries WHERE invoice_id IS NOT NULL").get()).toEqual({ n: 0 });
    expect(res!.headers.get("Location")).toBe(`/invoices?invoice=${inv.id}`);
  });

  test("a blank manual description defaults to Item", async () => {
    const { db, handleWeb } = setup();
    await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "", g0_hours: "2", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    const item = db.query("SELECT description FROM invoice_items").get() as any;
    expect(item.description).toBe("Item");
  });

  test("an invoice with a non-existent client_id is rejected and nothing is stored (#1468)", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, client_id: "999", groups: "1",
      g0_desc: "Logo design", g0_hours: "1", g0_rate: "250",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("That client no longer exists.");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });

  test("an invoice with a non-numeric client_id is rejected and nothing is stored (#1468)", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, client_id: "abc", groups: "1",
      g0_desc: "Logo design", g0_hours: "1", g0_rate: "250",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });

  test("mixed auto and manual rows: entries link only on the auto row", async () => {
    const { db, client, handleWeb } = setup();
    db.query("INSERT INTO projects (name, client_id) VALUES ('Site', ?)").run(client.id);
    const project = db.query("SELECT id FROM projects").get() as any;
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, 'Build', '2026-09-20T14:00:00.000Z', '2026-09-20T16:00:00.000Z')").run(project.id);
    const entry = db.query("SELECT id FROM time_entries").get() as any;
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "2",
      g0_desc: "Website", g0_hours: "2", g0_rate: "40", g0_ids: String(entry.id),
      g0_date_from: "2026-09-20", g0_date_to: "2026-09-20",
      g1_desc: "Rush fee", g1_hours: "1", g1_rate: "100",
      g1_ids: "", g1_date_from: "", g1_date_to: "",
    });
    expect(res!.status).toBe(302);
    const inv = db.query("SELECT * FROM invoices").get() as any;
    const items = db.query("SELECT description, amount FROM invoice_items WHERE invoice_id = ? ORDER BY id").all(inv.id) as any[];
    expect(items).toEqual([
      { description: "Website", amount: 80 },
      { description: "Rush fee", amount: 100 },
    ]);
    const linked = db.query("SELECT invoice_id FROM time_entries WHERE id = ?").get(entry.id) as any;
    expect(linked.invoice_id).toBe(inv.id);
  });

  test("an entry already on another invoice is rejected and not stolen (#1470)", async () => {
    const { db, client, handleWeb } = setup();
    db.query("INSERT INTO projects (name, client_id) VALUES ('Site', ?)").run(client.id);
    const project = db.query("SELECT id FROM projects").get() as any;
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time, invoice_id) VALUES (?, 'Build', '2026-09-20T14:00:00.000Z', '2026-09-20T16:00:00.000Z', 42)").run(project.id);
    const entry = db.query("SELECT id FROM time_entries").get() as any;
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Website", g0_hours: "2", g0_rate: "40", g0_ids: String(entry.id),
      g0_date_from: "2026-09-20", g0_date_to: "2026-09-20",
    });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("no longer available to invoice");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
    expect(db.query("SELECT invoice_id FROM time_entries WHERE id = ?").get(entry.id)).toEqual({ invoice_id: 42 });
  });

  test("a running entry and another client's entry are rejected (#1470)", async () => {
    const { db, client, handleWeb } = setup();
    db.query("INSERT INTO clients (name) VALUES ('Other')").run();
    const other = db.query("SELECT id FROM clients WHERE name = 'Other'").get() as any;
    db.query("INSERT INTO projects (name, client_id) VALUES ('Mine', ?)").run(client.id);
    db.query("INSERT INTO projects (name, client_id) VALUES ('Theirs', ?)").run(other.id);
    const mine = db.query("SELECT id FROM projects WHERE name = 'Mine'").get() as any;
    const theirs = db.query("SELECT id FROM projects WHERE name = 'Theirs'").get() as any;
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, 'Running', '2026-09-20T14:00:00.000Z', NULL)").run(mine.id);
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, 'Theirs', '2026-09-20T14:00:00.000Z', '2026-09-20T16:00:00.000Z')").run(theirs.id);
    const entries = db.query("SELECT id FROM time_entries ORDER BY id").all() as any[];
    for (const e of entries) {
      const res = await postInvoice(handleWeb, {
        ...baseInvoiceFields, groups: "1",
        g0_desc: "Website", g0_hours: "2", g0_rate: "40", g0_ids: String(e.id),
        g0_date_from: "2026-09-20", g0_date_to: "2026-09-20",
      });
      expect(res!.status).toBe(400);
    }
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM time_entries WHERE invoice_id IS NOT NULL").get()).toEqual({ n: 0 });
  });

  test("zero-hour manual rows are skipped and an empty invoice is rejected", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Nothing", g0_hours: "0", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });
});

/** #1442: the invoice wizard mirrors the settings/API rate rule. */
describe("invoice rate validation (#1442)", () => {
  test("a negative line rate is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "-50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("at or above 0");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 0 });
  });

  test("a negative tax rate is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, tax_rate: "-10", groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });

  test("a rate whose rounded value overflows is rejected", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "1e308",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });

  test("rows whose amounts sum past the finite range are rejected (#1448)", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "2",
      g0_desc: "Work", g0_hours: "1.7e306", g0_rate: "1",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
      g1_desc: "More", g1_hours: "1.7e306", g1_rate: "1",
      g1_ids: "", g1_date_from: "", g1_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("too large");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 0 });
  });

  test("a tax rate that overflows the total is rejected (#1448)", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, tax_rate: "1e305", groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "1e6",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("too large");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 0 });
  });

  test("a groups count that is not a whole number in range is rejected and nothing is stored (#1512)", async () => {
    for (const groups of ["1001", "2.5", "-1", "abc", "Infinity"]) {
      const { db, handleWeb } = setup();
      const res = await postInvoice(handleWeb, {
        ...baseInvoiceFields, groups,
        g0_desc: "Work", g0_hours: "1", g0_rate: "50",
        g0_ids: "", g0_date_from: "", g0_date_to: "",
      });
      expect(res!.status).toBe(400);
      expect(await res!.text()).toContain("Line item count");
      expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
      expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 0 });
    }
  });

  test("a groups count of 1000 is accepted; the missing rows drop out (#1512)", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1000",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(302);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 1 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 1 });
  });

  test("more than 1000 entry ids in one group is rejected and nothing is stored (#1522)", async () => {
    const { db, handleWeb } = setup();
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1).join(",");
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: ids, g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("at most 1000 entries");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 0 });
  });

  test("entry ids over 1000 in aggregate across groups are rejected (#1522)", async () => {
    const { db, handleWeb } = setup();
    const ids = (n: number, from: number) => Array.from({ length: n }, (_, i) => from + i).join(",");
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "2",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: ids(600, 1), g0_date_from: "", g0_date_to: "",
      g1_desc: "More", g1_hours: "1", g1_rate: "50",
      g1_ids: ids(401, 601), g1_date_from: "", g1_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("at most 1000 entries");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });

  test("exactly 1000 entry ids pass the bound (#1522)", async () => {
    const { db, client, handleWeb } = setup();
    db.query("INSERT INTO projects (name, client_id) VALUES ('Site', ?)").run(client.id);
    const project = db.query("SELECT id FROM projects").get() as any;
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, 'Build', '2026-09-20T14:00:00.000Z', '2026-09-20T16:00:00.000Z')").run(project.id);
    const entry = db.query("SELECT id FROM time_entries").get() as any;
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: Array(1000).fill(String(entry.id)).join(","), g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(302);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 1 });
  });

  test("a groups count of 0 passes the bound and fails as no line items (#1512)", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, { ...baseInvoiceFields, groups: "0" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("No line items");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });

  test("a negative rate on a dropped zero-hour row does not block the invoice", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "2",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
      g1_desc: "Skipped", g1_hours: "0", g1_rate: "-50",
      g1_ids: "", g1_date_from: "", g1_date_to: "",
    });
    expect(res!.status).toBe(302);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 1 });
  });
});

/** #1486: web invoice create validates issue_date/due_date like the API
 *  (#1436) — a provided date must be a real calendar day or nothing stores. */
describe("invoice date validation (#1486)", () => {
  test("a garbage issue_date is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, issue_date: "2026-13-40", groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("valid date");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 0 });
  });

  test("a garbage due_date is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, due_date: "not-a-date", groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("valid date");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });

  test("an impossible due_date is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, due_date: "2026-02-30", groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });

  test("valid issue and due dates are stored as given", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, due_date: "2026-10-20", groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(302);
    const inv = db.query("SELECT issue_date, due_date FROM invoices").get() as any;
    expect(inv.issue_date).toBe("2026-09-20");
    expect(inv.due_date).toBe("2026-10-20");
  });
});

/** #1488: web invoice create validates per-line dates like the API
 *  (#1436), and the preview route validates issue/due dates like the
 *  create route (#1486) — a provided date must be a real calendar day. */
describe("invoice line-date and preview-date validation (#1488)", () => {
  test("a garbage per-line date_from is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "2026-02-30", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("Date from must be a valid date");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 0 });
  });

  test("a garbage per-line date_to is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "not-a-date",
    });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("Date to must be a valid date");
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });

  test("valid per-line dates are stored as given", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "2026-09-01", g0_date_to: "2026-09-20",
    });
    expect(res!.status).toBe(302);
    const item = db.query("SELECT date_from, date_to FROM invoice_items").get() as any;
    expect(item.date_from).toBe("2026-09-01");
    expect(item.date_to).toBe("2026-09-20");
  });

  test("a padded valid per-line date is stored trimmed", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: " 2026-09-01 ", g0_date_to: "",
    });
    expect(res!.status).toBe(302);
    const item = db.query("SELECT date_from FROM invoice_items").get() as any;
    expect(item.date_from).toBe("2026-09-01");
  });

  test("a garbage date on a dropped zero-hour row does not block the invoice", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "2",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
      g1_desc: "Skipped", g1_hours: "0", g1_rate: "50",
      g1_ids: "", g1_date_from: "garbage", g1_date_to: "",
    });
    expect(res!.status).toBe(302);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 1 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 1 });
  });
});

/** #1444: preview validates rate/tax like the create route, and non-finite
 *  hours drop the row instead of orphaning the invoice header. */
function postPreview(handleWeb: any, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const req = new Request("http://x/invoices/preview", { method: "POST", body: form });
  return handleWeb(req, new URL(req.url), "/invoices/preview", "POST");
}

const basePreviewFields = { client_id: "1", from: "2026-09-01", to: "2026-09-20", rate: "40", tax_rate: "0" };

describe("invoice preview and hours hardening (#1444)", () => {
  test("a negative preview rate is rejected", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, rate: "-5" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("at or above 0");
  });

  test("a negative preview tax rate is rejected", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, tax_rate: "-10" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("at or above 0");
  });

  test("a non-numeric preview rate is rejected", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, rate: "abc" });
    expect(res!.status).toBe(400);
  });

  test("valid preview rate and tax pass", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, rate: "40", tax_rate: "8.25" });
    expect(res!.status).toBe(200);
  });

  test("a garbage preview issue_date is rejected (#1488)", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, issue_date: "2026-13-40" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("Issue date must be a valid date");
  });

  test("a garbage preview due_date is rejected (#1488)", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, due_date: "2026-02-30" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("Due date must be a valid date");
  });

  test("a padded valid preview issue_date passes (#1488)", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, issue_date: " 2026-09-20 " });
    expect(res!.status).toBe(200);
  });

  test("valid preview issue and due dates pass (#1488)", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, issue_date: "2026-09-20", due_date: "2026-10-20" });
    expect(res!.status).toBe(200);
  });

  test("an HTMX preview with a garbage issue_date gets a visible error fragment (#1488)", async () => {
    const { handleWeb } = setup();
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...basePreviewFields, issue_date: "garbage" })) form.append(k, v);
    const req = new Request("http://x/invoices/preview", { method: "POST", body: form, headers: { "HX-Request": "true" } });
    const res = await handleWeb(req, new URL(req.url), "/invoices/preview", "POST");
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("valid date");
  });

  test("a preview for a client that does not exist is rejected (#1490)", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, client_id: "999" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("no longer exists");
  });

  test("a preview with a non-numeric client_id is rejected (#1490)", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, client_id: "abc" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("no longer exists");
  });

  test("a preview with a garbage from date is rejected (#1490)", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, from: "2026-02-30" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("valid dates");
  });

  test("a preview with a garbage to date is rejected (#1490)", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, to: "not-a-date" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("valid dates");
  });

  test("a preview with a reversed range is rejected (#1490)", async () => {
    const { handleWeb } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, from: "2026-09-20", to: "2026-09-01" });
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("on or before");
  });

  test("a padded valid preview range passes, trimmed into the query (#1490)", async () => {
    const { handleWeb, unbilledCalls } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, from: " 2026-09-01 ", to: " 2026-09-20 " });
    expect(res!.status).toBe(200);
    expect(unbilledCalls).toEqual([[1, "2026-09-01T00:00:00", "2026-09-20T00:00:00"]]);
  });

  test("a same-day preview range passes (#1490)", async () => {
    const { handleWeb, unbilledCalls } = setup();
    const res = await postPreview(handleWeb, { ...basePreviewFields, from: "2026-09-10", to: "2026-09-10" });
    expect(res!.status).toBe(200);
    expect(unbilledCalls).toEqual([[1, "2026-09-10T00:00:00", "2026-09-10T00:00:00"]]);
  });

  test("an HTMX preview for a missing client gets a visible error fragment (#1490)", async () => {
    const { handleWeb } = setup();
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...basePreviewFields, client_id: "999" })) form.append(k, v);
    const req = new Request("http://x/invoices/preview", { method: "POST", body: form, headers: { "HX-Request": "true" } });
    const res = await handleWeb(req, new URL(req.url), "/invoices/preview", "POST");
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("no longer exists");
  });

  test("non-numeric hours drop the row and leave no orphan invoice", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Work", g0_hours: "abc", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 0 });
  });

  test("an HTMX preview with a negative rate gets a visible error fragment", async () => {
    const { handleWeb } = setup();
    const form = new FormData();
    for (const [k, v] of Object.entries({ ...basePreviewFields, rate: "-5" })) form.append(k, v);
    const req = new Request("http://x/invoices/preview", { method: "POST", body: form, headers: { "HX-Request": "true" } });
    const res = await handleWeb(req, new URL(req.url), "/invoices/preview", "POST");
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain("at or above 0");
  });

  test("infinite hours drop the row and leave no orphan invoice", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Work", g0_hours: "Infinity", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });

  test("finite hours and rate that multiply to Infinity are rejected, nothing stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "1",
      g0_desc: "Work", g0_hours: "1e200", g0_rate: "1e200",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 0 });
  });

  test("a tax rate whose rounded value overflows is rejected on create", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, tax_rate: "1e308", groups: "1",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
    });
    expect(res!.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 0 });
  });

  test("a non-numeric-hours row is dropped when a valid row remains", async () => {
    const { db, handleWeb } = setup();
    const res = await postInvoice(handleWeb, {
      ...baseInvoiceFields, groups: "2",
      g0_desc: "Work", g0_hours: "1", g0_rate: "50",
      g0_ids: "", g0_date_from: "", g0_date_to: "",
      g1_desc: "Bad", g1_hours: "abc", g1_rate: "50",
      g1_ids: "", g1_date_from: "", g1_date_to: "",
    });
    expect(res!.status).toBe(302);
    expect(db.query("SELECT COUNT(*) AS n FROM invoices").get()).toEqual({ n: 1 });
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_items").get()).toEqual({ n: 1 });
  });
});

/** #1202: the wizard's Send Zinvoice posts intent=send to POST /invoices —
 *  create + send in one step. Unlike setup() above, the invoice deps here
 *  are the real domain and views, and freezeInvoiceSnapshots replicates
 *  the wiring in server.ts (#301: render the sheet into html_snapshot once
 *  the invoice has left draft) so the freeze itself is asserted, not just
 *  the call. */
function setupSend() {
  const bundle = createDb(mkdtempSync(join(tmpdir(), "tk-web-send-")));
  const { db, qInvoice, qInvoiceItems, qInvoices } = bundle;
  db.query("INSERT INTO clients (name, color, rate) VALUES ('Bytebot', '#fb923c', 40)").run();
  const domain = createDomain({ db, qInvoice, qInvoiceItems, TOKEN: "t" });
  const invViews = createInvoiceViews({
    db, qInvoices, layout: (_t: string, b: string) => b,
    getPublicToken: domain.getPublicToken, stripeConfigured: () => false,
    nextInvoiceNumber: domain.nextInvoiceNumber, invoiceTotals: domain.invoiceTotals,
    isOverdue: () => false, unbilledByClient: domain.unbilledByClient,
  });
  const freezeCalls: number[] = [];
  const freezeInvoiceSnapshots = (id: number, _origin: string) => {
    freezeCalls.push(id);
    const inv = domain.getInvoice(id);
    if (!inv || inv.status === "draft") return;
    db.query("UPDATE invoices SET html_snapshot = ? WHERE id = ?").run(invViews.invoiceSheet(inv), id);
  };
  const noop = () => "";
  const tenant = {
    db, dbPath: "",
    qRunning: { get: () => null } as any,
    qOne: { get: () => null } as any,
    qRange: { all: () => [] } as any,
    qInvoice, qInvoices,
    notFoundPage: noop, errorPage: noop,
    dashboardPage: noop,
    timerPartial: noop, todayPartial: noop, weekInner: noop, weekStrip: noop,
    calendarPage: noop, editPage: () => null,
    managePage: noop, clientSelection: noop,
    clientDetailBody: noop, clientListOob: noop,
    bizProfileSection: noop, dailyTargetSection: noop, dailyTargetControl: noop, preferencesSection: noop, clientSettingsForm: noop, themeSectionHtml: noop, themeDotsHtml: noop, settingsPage: noop,
    invoicesPage: noop, invoiceNewPage: invViews.invoiceNewPage,
    defaultNewInvParams: invViews.defaultNewInvParams, invoiceStep2: invViews.invoiceStep2,
    invoiceDetailBody: invViews.invoiceDetailBody, invoiceListOob: invViews.invoiceListOob, invoiceListRegion: invViews.invoiceListRegion, invoiceDoc: invViews.invoiceDoc, publicInvoicePage: noop,
    getInvoice: domain.getInvoice, invoiceTotals: domain.invoiceTotals,
    nextInvoiceNumber: domain.nextInvoiceNumber,
    stripeLinkFor: async () => ({}),
    unbilledEntries: domain.unbilledEntries, groupToLineItems: domain.groupToLineItems,
    clientRestFrom: domain.clientRestFrom, ensurePublicToken: domain.ensurePublicToken,
    getPublicToken: domain.getPublicToken, mintPublicToken: domain.mintPublicToken,
    invoicePdfInput: () => ({} as any),
    freezeInvoiceSnapshots,
  };
  const { handleWeb } = createWebRouter({
    getTenant: () => tenant as any,
    STATIC_DIR: "", TOKEN: "t",
    authedPage: () => true,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200, extra: Record<string, string> = {}) => new Response(body, { status, headers: extra }),
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
  return { db, handleWeb, freezeCalls };
}

describe("GET /invoices filter swap", () => {
  test("an htmx filter request returns the list region, not the page shell", async () => {
    const { handleWeb } = setupSend();
    const req = new Request("http://x/invoices?status=sent", { headers: { "HX-Request": "true" } });
    const res = await handleWeb(req, new URL(req.url), "/invoices", "GET");
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain('id="inv-list-region"');
    expect(body).not.toContain("<!DOCTYPE");
    expect(body).toContain('aria-current="true"');
  });
});

describe("GET /export/invoices.csv (#1425)", () => {
  test("exports sent_date next to paid_date, blank when never sent", async () => {
    const { db, client, handleWeb } = setup();
    db.query("INSERT INTO invoices (client_id, number, issue_date, due_date, status, sent_at, paid_at) VALUES (?, 'INV-0002', '2026-11-01', '2026-11-15', 'paid', '2026-11-02', '2026-11-09')").run(client.id);
    db.query("INSERT INTO invoices (client_id, number, issue_date, status) VALUES (?, 'INV-0001', '2026-10-01', 'draft')").run(client.id);
    const req = new Request("http://x/export/invoices.csv");
    const res = await handleWeb(req, new URL(req.url), "/export/invoices.csv", "GET");
    expect(res!.status).toBe(200);
    const lines = (await res!.text()).split("\n");
    expect(lines[0]).toBe("number,client,issue_date,due_date,status,sent_date,paid_date,items,subtotal,tax,total");
    const paid = lines.find((l) => l.startsWith("INV-0002"))!;
    expect(paid.split(",").slice(4, 7)).toEqual(["paid", "2026-11-02", "2026-11-09"]);
    const draft = lines.find((l) => l.startsWith("INV-0001"))!;
    expect(draft.split(",").slice(4, 7)).toEqual(["draft", "", ""]);
  });
});

/** #1048: the invoice-rest range must never invert and must cover
 *  future-dated unbilled entries. */
describe("GET /partial/invoice-rest (#1048)", () => {
  function getRest(handleWeb: any, cid: number) {
    const req = new Request(`http://x/partial/invoice-rest?client_id=${cid}`);
    return handleWeb(req, new URL(req.url), "/partial/invoice-rest", "GET");
  }
  function rangeOf(body: string) {
    const from = body.match(/name="from"[^>]*value="([^"]+)"/)?.[1];
    const to = body.match(/name="to"[^>]*value="([^"]+)"/)?.[1];
    return { from, to };
  }

  test("a future-dated unbilled entry sets both From and To to its day", async () => {
    const { db, handleWeb } = setupSend();
    const future = addDays(todayStr(), 7);
    db.query("INSERT INTO projects (name, client_id) VALUES ('Site', 1)").run();
    const project = db.query("SELECT id FROM projects").get() as any;
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, 'Build', ?, ?)").run(project.id, `${future}T14:00:00.000Z`, `${future}T16:00:00.000Z`);
    const res = await getRest(handleWeb, 1);
    expect(res!.status).toBe(200);
    const { from, to } = rangeOf(await res!.text());
    expect(from).toBe(future);
    expect(to).toBe(future);
  });

  test("a rest-from in the future (last invoice through-date ahead) does not invert", async () => {
    const { db, handleWeb } = setupSend();
    const through = addDays(todayStr(), 3);
    db.query("INSERT INTO invoices (client_id, number, issue_date) VALUES (1, 'INV-9001', ?)").run(todayStr());
    const inv = db.query("SELECT id FROM invoices").get() as any;
    db.query("INSERT INTO invoice_items (invoice_id, description, hours, rate, amount, date_from, date_to) VALUES (?, 'Work', 1, 40, 40, ?, ?)").run(inv.id, through, through);
    const res = await getRest(handleWeb, 1);
    const { from, to } = rangeOf(await res!.text());
    expect(from).toBe(addDays(through, 1));
    expect(to).toBe(from);
  });

  test("invoiced, running, and other clients' future entries do not extend To", async () => {
    const { db, handleWeb } = setupSend();
    const past = addDays(todayStr(), -2);
    const future = addDays(todayStr(), 9);
    db.query("INSERT INTO clients (name, color, rate) VALUES ('Other', '#38bdf8', 50)").run();
    db.query("INSERT INTO projects (name, client_id) VALUES ('Site', 1)").run();
    db.query("INSERT INTO projects (name, client_id) VALUES ('OtherSite', 2)").run();
    const [p1, p2] = db.query("SELECT id FROM projects ORDER BY id").all() as any[];
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, 'Build', ?, ?)").run(p1.id, `${past}T14:00:00.000Z`, `${past}T15:00:00.000Z`);
    db.query("INSERT INTO invoices (client_id, number, issue_date) VALUES (1, 'INV-9002', ?)").run(todayStr());
    const inv = db.query("SELECT id FROM invoices").get() as any;
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time, invoice_id) VALUES (?, 'Billed', ?, ?, ?)").run(p1.id, `${future}T14:00:00.000Z`, `${future}T15:00:00.000Z`, inv.id);
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, 'Running', ?, NULL)").run(p1.id, `${future}T14:00:00.000Z`);
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, 'Theirs', ?, ?)").run(p2.id, `${future}T14:00:00.000Z`, `${future}T15:00:00.000Z`);
    const res = await getRest(handleWeb, 1);
    const { from, to } = rangeOf(await res!.text());
    expect(from).toBe(past);
    expect(to).toBe(todayStr());
  });

  test("the /invoices/new?client_id= prefill uses the same non-inverted range", async () => {
    const { db, handleWeb } = setupSend();
    const future = addDays(todayStr(), 7);
    db.query("INSERT INTO projects (name, client_id) VALUES ('Site', 1)").run();
    const project = db.query("SELECT id FROM projects").get() as any;
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, 'Build', ?, ?)").run(project.id, `${future}T14:00:00.000Z`, `${future}T16:00:00.000Z`);
    const req = new Request("http://x/invoices/new?client_id=1");
    const res = await handleWeb(req, new URL(req.url), "/invoices/new", "GET");
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain(`name="to" value="${future}"`);
    expect(body).toContain(`name="from" value="${future}"`);
  });

  test("the /invoices/new prefill rejects impossible from/to dates (#1510)", async () => {
    const { handleWeb } = setupSend();
    const req = new Request("http://x/invoices/new?from=2026-02-30&to=2026-03-05");
    const res = await handleWeb(req, new URL(req.url), "/invoices/new", "GET");
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).not.toContain('value="2026-02-30"');
    expect(body).toContain(`name="from" value="${addDays(todayStr(), -13)}"`);
    expect(body).toContain(`name="to" value="${addDays(todayStr(), 1)}"`);
  });

  test("the /invoices/new prefill honors a single-day from == to range (#1510)", async () => {
    const { db, handleWeb } = setupSend();
    const day = addDays(todayStr(), -3);
    db.query("INSERT INTO projects (name, client_id) VALUES ('Site', 1)").run();
    const project = db.query("SELECT id FROM projects").get() as any;
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, 'Build', ?, ?)").run(project.id, `${day}T14:00:00.000Z`, `${day}T16:00:00.000Z`);
    const req = new Request(`http://x/invoices/new?from=${day}&to=${day}`);
    const res = await handleWeb(req, new URL(req.url), "/invoices/new", "GET");
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain(`name="from" value="${day}"`);
    expect(body).toContain(`name="to" value="${day}"`);
  });

  test("past unbilled time keeps To at today", async () => {
    const { db, handleWeb } = setupSend();
    const past = addDays(todayStr(), -2);
    db.query("INSERT INTO projects (name, client_id) VALUES ('Site', 1)").run();
    const project = db.query("SELECT id FROM projects").get() as any;
    db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, 'Build', ?, ?)").run(project.id, `${past}T14:00:00.000Z`, `${past}T15:00:00.000Z`);
    const res = await getRest(handleWeb, 1);
    const { from, to } = rangeOf(await res!.text());
    expect(from).toBe(past);
    expect(to).toBe(todayStr());
  });
});

describe("POST /invoices intent=send (#1202)", () => {
  const fields = {
    ...baseInvoiceFields, groups: "1",
    g0_desc: "Logo design", g0_hours: "1", g0_rate: "250",
    g0_ids: "", g0_date_from: "", g0_date_to: "",
  };

  test("intent=send lands sent, with the frozen snapshot and a public token", async () => {
    const { db, handleWeb, freezeCalls } = setupSend();
    const res = await postInvoice(handleWeb, { ...fields, intent: "send" });
    expect(res!.status).toBe(302);
    const inv = db.query("SELECT * FROM invoices").get() as any;
    expect(res!.headers.get("Location")).toBe(`/invoices?invoice=${inv.id}`);
    expect(inv.status).toBe("sent");
    expect(freezeCalls).toEqual([inv.id]);
    expect(inv.html_snapshot).toBeString();
    expect(inv.html_snapshot).toContain("INV-0001");
    expect(inv.public_token).toBeString();
    expect(inv.public_token.length).toBeGreaterThan(0);
  });

  test("plain Save draft (no intent) stays draft with no snapshot", async () => {
    const { db, handleWeb, freezeCalls } = setupSend();
    const res = await postInvoice(handleWeb, { ...fields });
    expect(res!.status).toBe(302);
    const inv = db.query("SELECT * FROM invoices").get() as any;
    expect(inv.status).toBe("draft");
    expect(inv.html_snapshot).toBeNull();
    expect(freezeCalls).toEqual([]);
  });
});

/** #1203: /manage is the suite mock's stacked page — add-client card,
 *  client table, projects card. No selection state, no detail pane. */
describe("/manage stacked page (#1203)", () => {
  function setupWith(rows: string[]) {
    const db = createDb(mkdtempSync(join(tmpdir(), "tk-web-835-"))).db;
    for (const name of rows) db.query("INSERT INTO clients (name) VALUES (?)").run(name);
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const noop = () => "";
    const tenant = {
      db, dbPath: "",
      qRunning: { get: () => null } as any,
      qOne: { get: () => null } as any,
      qRange: { all: () => [] } as any,
      qInvoice: { get: () => null } as any,
      qInvoices: { all: () => [] } as any,
      notFoundPage: noop, errorPage: noop,
      dashboardPage: noop,
      timerPartial: noop, todayPartial: noop, weekInner: noop, weekStrip: noop,
      calendarPage: noop, editPage: () => null,
      managePage: views.managePage, clientSelection: views.clientSelection,
      clientDialogBody: views.clientDialogBody, clientDialogProjects: views.clientDialogProjects, manageListsOob: views.manageListsOob,
      bizProfileSection: noop, dailyTargetSection: views.dailyTargetSection, dailyTargetControl: views.dailyTargetControl, preferencesSection: views.preferencesSection, clientSettingsForm: views.clientSettingsForm, themeSectionHtml: views.themeSectionHtml, themeDotsHtml: views.themeDotsHtml, settingsPage: noop,
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
      html: (body: string, status = 200, extra: Record<string, string> = {}) => new Response(body, { status, headers: extra }),
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
    return { handleWeb };
  }

  async function getManage(handleWeb: any) {
    const req = new Request("http://x/manage", { method: "GET" });
    const res = await handleWeb(req, new URL(req.url), "/manage", "GET");
    return { status: res.status, body: await res.text() };
  }

  test("GET /clients redirects to /manage (#1217)", async () => {
    const { handleWeb } = setupWith([]);
    const req = new Request("http://x/clients", { method: "GET" });
    const res = await handleWeb(req, new URL(req.url), "/clients", "GET");
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/manage");
  });

  test("zero clients: the stacked page renders with the No client row", async () => {
    const { handleWeb } = setupWith([]);
    const { status, body } = await getManage(handleWeb);
    expect(status).toBe(200);
    expect(body).toContain('<h1 class="ui-app-title">Manage</h1>');
    expect(body).toContain("No client");
    expect(body).toContain('data-client-edit="none"');
    expect(body).not.toContain("has-selection");
    expect(body).not.toContain("client-list-detail");
  });

  test("with clients: the table lists them, no selection state", async () => {
    const { handleWeb } = setupWith(["Bytebot", "Acme"]);
    const { status, body } = await getManage(handleWeb);
    expect(status).toBe(200);
    expect(body).toContain("Acme");
    expect(body).toContain('aria-label="Edit client Acme"');
    expect(body).not.toContain("Select a client to manage");
    expect(body).not.toContain("has-selection");
  });

  test("the client dialog fragment serves settings + projects; unknown ids 404", async () => {
    const { handleWeb } = setupWith(["Acme"]);
    const req = new Request("http://x/clients/1/dialog", { method: "GET", headers: { "HX-Request": "true" } });
    const res = await handleWeb(req, new URL(req.url), "/clients/1/dialog", "GET");
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain('id="client-settings-form"');
    expect(body).toContain('id="client-dialog-projects"');
    const missing = new Request("http://x/clients/999/dialog", { method: "GET", headers: { "HX-Request": "true" } });
    const res404 = await handleWeb(missing, new URL(missing.url), "/clients/999/dialog", "GET");
    expect(res404!.status).toBe(404);
    const noneReq = new Request("http://x/clients/none/dialog", { method: "GET", headers: { "HX-Request": "true" } });
    const noneRes = await handleWeb(noneReq, new URL(noneReq.url), "/clients/none/dialog", "GET");
    expect(noneRes!.status).toBe(200);
    expect(await noneRes!.text()).toContain('data-client-name="No client"');
  });
});

describe("accent theme (#884)", () => {
  function getSettingsBody(handleWeb: any, htmx = true) {
    const headers: Record<string, string> = {};
    if (htmx) headers["HX-Request"] = "true";
    const req = new Request("http://x/settings", { headers });
    return handleWeb(req, new URL(req.url), "/settings", "GET");
  }
  function postTheme(handleWeb: any, theme: string, htmx = true) {
    const form = new FormData();
    form.append("theme", theme);
    const headers: Record<string, string> = {};
    if (htmx) headers["HX-Request"] = "true";
    const req = new Request("http://x/settings/theme", { method: "POST", body: form, headers });
    return handleWeb(req, new URL(req.url), "/settings/theme", "POST");
  }

  test("settings body has the Theme section with all five dots, pumpkin selected", async () => {
    const { handleWeb } = setup();
    const res = await getSettingsBody(handleWeb);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('id="theme-section"');
    for (const name of ["Pumpkin", "Crimson", "Blue", "Green", "Yellow"])
      expect(body).toContain(`aria-label="${name} theme"`);
    expect(body).toContain('aria-label="Pumpkin theme" aria-pressed="true"');
    expect(body).not.toContain('aria-label="Blue theme" aria-pressed="true"');
  });

  test("picking a theme stores it and returns the live-swapped style", async () => {
    const { db, handleWeb } = setup();
    const res = await postTheme(handleWeb, "crimson");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(db.query("SELECT value FROM meta WHERE key = 'theme'").get()).toMatchObject({ value: "crimson" });
    expect(body).toContain('id="theme-section"');
    expect(body).toContain('hx-swap-oob="true"');
    expect(body).toContain("--primary:#ffb4a8");
    expect(body).toContain('aria-label="Crimson theme" aria-pressed="true"');
  });

  test("unknown theme is rejected and nothing is stored", async () => {
    const { db, handleWeb } = setup();
    const res = await postTheme(handleWeb, "hotpink");
    expect(res.status).toBe(400);
    expect(db.query("SELECT value FROM meta WHERE key = 'theme'").get()).toBeNull();
  });

  test("non-htmx post redirects to /settings", async () => {
    const { handleWeb } = setup();
    const res = await postTheme(handleWeb, "blue", false);
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/settings");
  });

  test("the chosen theme persists and marks the new dot", async () => {
    const { handleWeb } = setup();
    await postTheme(handleWeb, "green");
    const body = await (await getSettingsBody(handleWeb)).text();
    expect(body).toContain('aria-label="Green theme" aria-pressed="true"');
    expect(body).not.toContain('aria-label="Pumpkin theme" aria-pressed="true"');
  });
});

/** #908: POST /daily-target — configurable daily hours target. */
describe("daily target (#908)", () => {
  function postTarget(handleWeb: any, fields: Record<string, string>, htmx = true) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const headers: Record<string, string> = {};
    if (htmx) headers["HX-Request"] = "true";
    const req = new Request("http://x/daily-target", { method: "POST", body: form, headers });
    return handleWeb(req, new URL(req.url), "/daily-target", "POST");
  }

  test("saves the target and re-renders the section", async () => {
    const { db, handleWeb } = setup();
    const res = await postTarget(handleWeb, { day_target_hours: "6" });
    expect(res!.status).toBe(200);
    expect(getMeta(db, "day_target_hours")).toBe("6");
    const body = await res!.text();
    expect(body).toContain('id="daily-target-form"');
    expect(body).toContain('value="6"');
  });

  test("accepts halves", async () => {
    const { db, handleWeb } = setup();
    const res = await postTarget(handleWeb, { day_target_hours: "7.5" });
    expect(res!.status).toBe(200);
    expect(getMeta(db, "day_target_hours")).toBe("7.5");
  });

  test("rejects non-numeric and out-of-range values with 400, leaving the stored value untouched", async () => {
    const { db, handleWeb } = setup();
    for (const v of ["abc", "", "0", "99", "-2"]) {
      const res = await postTarget(handleWeb, { day_target_hours: v });
      expect(res!.status).toBe(400);
      expect(getMeta(db, "day_target_hours")).toBe("");
    }
  });

  /* #1335: the save confirms itself by name via an HX-Trigger tk-toast
     event; a rejected value must not claim success. */
  test("an htmx save asks for the Daily target saved toast; a 400 does not", async () => {
    const { handleWeb } = setup();
    const ok = await postTarget(handleWeb, { day_target_hours: "6" });
    expect(JSON.parse(ok!.headers.get("HX-Trigger")!)).toEqual({ "tk-toast": "Daily target saved" });
    const bad = await postTarget(handleWeb, { day_target_hours: "99" });
    expect(bad!.status).toBe(400);
    expect(bad!.headers.get("HX-Trigger")).toBeNull();
  });

  test("plain POST redirects to /settings", async () => {
    const { db, handleWeb } = setup();
    const res = await postTarget(handleWeb, { day_target_hours: "6" }, false);
    expect(res!.status).toBe(302);
    expect(res!.headers.get("Location")).toBe("/settings");
    expect(getMeta(db, "day_target_hours")).toBe("6");
  });

  test("the settings body includes the daily target section", async () => {
    const { handleWeb } = setup();
    const headers = { "HX-Request": "true" };
    const req = new Request("http://x/settings", { headers });
    const res = await handleWeb(req, new URL(req.url), "/settings", "GET");
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain('id="daily-target"');
    expect(body).toContain("Daily hours target");
  });
});

/** #1335: POST /business-profile confirms with a tk-toast HX-Trigger. */
describe("business profile save toast (#1335)", () => {
  function postProfile(handleWeb: any, fields: Record<string, string>) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const req = new Request("http://x/business-profile", { method: "POST", body: form, headers: { "HX-Request": "true" } });
    return handleWeb(req, new URL(req.url), "/business-profile", "POST");
  }

  test("a valid save asks for the Business profile saved toast", async () => {
    const { handleWeb } = setup();
    const res = await postProfile(handleWeb, { business_name: "Studio", business_payment_terms: "net_30" });
    expect(res!.status).toBe(200);
    expect(JSON.parse(res!.headers.get("HX-Trigger")!)).toEqual({ "tk-toast": "Business profile saved" });
  });

  test("unknown payment terms are rejected without a toast", async () => {
    const { handleWeb } = setup();
    const res = await postProfile(handleWeb, { business_name: "Studio", business_payment_terms: "net999" });
    expect(res!.status).toBe(400);
    expect(res!.headers.get("HX-Trigger")).toBeNull();
  });
});

describe("logout and CSRF guard (#912)", () => {
  /* Bun's Request constructor doesn't populate the Host header from the URL,
     so set it explicitly — a real server connection always carries it. */
  const logoutReq = (method: string, headers: Record<string, string> = {}) => {
    const req = new Request("http://x/logout", { method, headers: { ...headers, host: "x" } });
    return { req, url: new URL(req.url) };
  };

  test("GET /logout is 405 with Allow: POST (no more CSRF-able logout links)", async () => {
    const { handleWeb } = setup();
    const { req, url } = logoutReq("GET");
    const res = (await handleWeb(req, url, "/logout", "GET"))!;
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });

  test("POST /logout still clears the cookie and redirects to /login", async () => {
    const { handleWeb } = setup();
    const { req, url } = logoutReq("POST");
    const res = (await handleWeb(req, url, "/logout", "POST"))!;
    expect(res.status).toBe(302);
    /* #928: logged_out=1 tells analytics.js to reset the PostHog identity. */
    expect(res.headers.get("Location")).toBe("/login?logged_out=1");
    expect(res.headers.get("Set-Cookie")).toContain("tk=;");
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });

  test("POST /logout with a matching Origin is allowed", async () => {
    const { handleWeb } = setup();
    const { req, url } = logoutReq("POST", { Origin: "http://x" });
    const res = (await handleWeb(req, url, "/logout", "POST"))!;
    expect(res.status).toBe(302);
  });

  test("mutating web route with a mismatched Origin is rejected with 403", async () => {
    const { handleWeb } = setup();
    const { req, url } = logoutReq("POST", { Origin: "http://evil.com" });
    const res = (await handleWeb(req, url, "/logout", "POST"))!;
    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toContain("Request blocked");
  });

  test("POST with a mismatched Referer and no Origin is rejected too", async () => {
    const { handleWeb } = setup();
    const { req, url } = logoutReq("POST", { Referer: "http://evil.com/page" });
    const res = (await handleWeb(req, url, "/logout", "POST"))!;
    expect(res.status).toBe(403);
  });
});

/** #930: rapid re-submits of the same entry must not create duplicates —
 * the calendar dialog guards in-flight saves client-side; the server
 * backstops with a short idempotency window on POST /entries. */
function postEntry(handleWeb: any, fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const req = new Request("http://x/entries", { method: "POST", body: form });
  return handleWeb(req, new URL(req.url), "/entries", "POST");
}

describe("entry create idempotency (#930)", () => {
  const fields = {
    project_id: "", description: "",
    start_time: "2026-10-08T09:00:00.000Z", end_time: "2026-10-08T10:00:00.000Z",
  };

  test("rapid identical POSTs create one entry and return the same id", async () => {
    const { db, handleWeb } = setup();
    const r1 = await postEntry(handleWeb, fields);
    expect(r1!.status).toBe(201);
    const d1 = await r1!.json();
    expect(d1.ok).toBe(true);
    const r2 = await postEntry(handleWeb, fields);
    expect(r2!.status).toBe(200);
    const d2 = await r2!.json();
    expect(d2.id).toBe(d1.id);
    const rows = db.query("SELECT COUNT(*) c FROM time_entries").get() as any;
    expect(rows.c).toBe(1);
  });

  test("distinct entries still create separately", async () => {
    const { db, handleWeb } = setup();
    await postEntry(handleWeb, fields);
    const r = await postEntry(handleWeb, { ...fields, description: "different" });
    expect(r!.status).toBe(201);
    const rows = db.query("SELECT COUNT(*) c FROM time_entries").get() as any;
    expect(rows.c).toBe(2);
  });

  test("an identical entry created long ago is not swallowed by the dedupe window", async () => {
    const { db, handleWeb } = setup();
    db.query("INSERT INTO time_entries (description, start_time, end_time, created_at) VALUES ('', '2026-10-08T09:00:00.000Z', '2026-10-08T10:00:00.000Z', '2026-10-08T08:00:00.000Z')").run();
    const r = await postEntry(handleWeb, fields);
    expect(r!.status).toBe(201);
    const rows = db.query("SELECT COUNT(*) c FROM time_entries").get() as any;
    expect(rows.c).toBe(2);
  });
});

/** #964: bare datetimes parse as UTC — reject them loudly instead of
 * silently corrupting the entry's times. */
describe("bare datetime rejection (#964)", () => {
  test("POST /entries with a bare start_time is 400 and creates nothing", async () => {
    const { db, handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "", description: "", start_time: "2026-10-08T09:00", end_time: "" });
    expect(r!.status).toBe(400);
    const rows = db.query("SELECT COUNT(*) c FROM time_entries").get() as any;
    expect(rows.c).toBe(0);
  });

  test("POST /entries with a bare end_time is 400", async () => {
    const { handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "", description: "", start_time: "2026-10-08T09:00:00.000Z", end_time: "2026-10-08T10:00" });
    expect(r!.status).toBe(400);
  });

  test("POST /entries with offset datetimes still works", async () => {
    const { handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "", description: "", start_time: "2026-10-08T09:00:00-05:00", end_time: "2026-10-08T10:00:00-05:00" });
    expect(r!.status).toBe(201);
  });
});

/** #1434: impossible calendar dates must not silently roll to another day
 * (Feb 30 -> Mar 2) or throw a 500 (month 13) — the web entry routes use
 * the same real-date validation as the API (#1432). */
describe("impossible datetime rejection (#1434)", () => {
  test("POST /entries with a Feb 30 start_time is 400 and creates nothing", async () => {
    const { db, handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "", description: "", start_time: "2026-02-30T09:00:00Z", end_time: "" });
    expect(r!.status).toBe(400);
    const rows = db.query("SELECT COUNT(*) c FROM time_entries").get() as any;
    expect(rows.c).toBe(0);
  });

  test("POST /entries with a month-13 end_time is 400, not a 500", async () => {
    const { db, handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "", description: "", start_time: "2026-10-08T09:00:00Z", end_time: "2026-13-01T10:00:00Z" });
    expect(r!.status).toBe(400);
    const rows = db.query("SELECT COUNT(*) c FROM time_entries").get() as any;
    expect(rows.c).toBe(0);
  });

  test("POST /entries/:id with an impossible start_time is 400 and leaves the entry untouched", async () => {
    const { db, handleWeb } = setup();
    const ins = db.query("INSERT INTO time_entries (description, start_time, end_time) VALUES ('x', '2026-10-08T09:00:00.000Z', '2026-10-08T10:00:00.000Z')").run();
    const id = Number(ins.lastInsertRowid);
    const form = new FormData();
    form.append("description", "x");
    form.append("start_time", "2026-02-30T09:00:00Z");
    form.append("end_time", "2026-10-08T10:00:00Z");
    const req = new Request(`http://x/entries/${id}`, { method: "POST", body: form });
    const r = await handleWeb(req, new URL(req.url), `/entries/${id}`, "POST");
    expect(r!.status).toBe(400);
    const row = db.query("SELECT start_time FROM time_entries WHERE id = ?").get(id) as any;
    expect(row.start_time).toBe("2026-10-08T09:00:00.000Z");
  });

  test("POST /entries/:id with an impossible end_time is 400 and leaves the entry untouched", async () => {
    const { db, handleWeb } = setup();
    const ins = db.query("INSERT INTO time_entries (description, start_time, end_time) VALUES ('x', '2026-10-08T09:00:00.000Z', '2026-10-08T10:00:00.000Z')").run();
    const id = Number(ins.lastInsertRowid);
    const form = new FormData();
    form.append("description", "x");
    form.append("start_time", "2026-10-08T09:00:00Z");
    form.append("end_time", "2026-02-30T10:00:00Z");
    const req = new Request(`http://x/entries/${id}`, { method: "POST", body: form });
    const r = await handleWeb(req, new URL(req.url), `/entries/${id}`, "POST");
    expect(r!.status).toBe(400);
    const row = db.query("SELECT end_time FROM time_entries WHERE id = ?").get(id) as any;
    expect(row.end_time).toBe("2026-10-08T10:00:00.000Z");
  });

  test("POST /entries in the calendar dialog's no-seconds format still works, empty end allowed", async () => {
    const { db, handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "", description: "", start_time: "2026-10-08T09:00-05:00", end_time: "" });
    expect(r!.status).toBe(201);
    const row = db.query("SELECT start_time, end_time FROM time_entries").get() as any;
    expect(row.start_time).toBe("2026-10-08T14:00:00.000Z");
    expect(row.end_time).toBeNull();
  });

  test("POST /entries with a year below 0100 still saves (validator must not map it to the 1900s)", async () => {
    const { db, handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "", description: "", start_time: "0099-06-15T09:00:00Z", end_time: "" });
    expect(r!.status).toBe(201);
    const row = db.query("SELECT start_time FROM time_entries").get() as any;
    expect(row.start_time).toBe("0099-06-15T09:00:00.000Z");
  });

  test("POST /entries/:id with a valid offset timestamp still saves, normalized to UTC", async () => {
    const { db, handleWeb } = setup();
    const ins = db.query("INSERT INTO time_entries (description, start_time, end_time) VALUES ('x', '2026-10-08T09:00:00.000Z', '2026-10-08T10:00:00.000Z')").run();
    const id = Number(ins.lastInsertRowid);
    const form = new FormData();
    form.append("description", "x");
    form.append("start_time", "2026-10-08T09:00:00-05:00");
    form.append("end_time", "2026-10-08T10:00:00-05:00");
    const req = new Request(`http://x/entries/${id}`, { method: "POST", body: form });
    const r = await handleWeb(req, new URL(req.url), `/entries/${id}`, "POST");
    expect(r!.status).toBe(302);
    const row = db.query("SELECT start_time FROM time_entries WHERE id = ?").get(id) as any;
    expect(row.start_time).toBe("2026-10-08T14:00:00.000Z");
  });
});

describe("entry end at or before start rejection (#1450)", () => {
  test("POST /entries with end before start is 400 and creates nothing", async () => {
    const { db, handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "", description: "", start_time: "2026-10-08T10:00:00.000Z", end_time: "2026-10-08T09:00:00.000Z" });
    expect(r!.status).toBe(400);
    const rows = db.query("SELECT COUNT(*) c FROM time_entries").get() as any;
    expect(rows.c).toBe(0);
  });

  test("POST /entries with end equal to start is 400 and creates nothing", async () => {
    const { db, handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "", description: "", start_time: "2026-10-08T09:00:00.000Z", end_time: "2026-10-08T09:00:00.000Z" });
    expect(r!.status).toBe(400);
    const rows = db.query("SELECT COUNT(*) c FROM time_entries").get() as any;
    expect(rows.c).toBe(0);
  });

  test("POST /entries/:id with end before start is 400 and leaves the entry untouched", async () => {
    const { db, handleWeb } = setup();
    const ins = db.query("INSERT INTO time_entries (description, start_time, end_time) VALUES ('x', '2026-10-08T09:00:00.000Z', '2026-10-08T10:00:00.000Z')").run();
    const id = Number(ins.lastInsertRowid);
    const form = new FormData();
    form.append("description", "x");
    form.append("start_time", "2026-10-08T09:00:00Z");
    form.append("end_time", "2026-10-08T08:00:00Z");
    const req = new Request(`http://x/entries/${id}`, { method: "POST", body: form });
    const r = await handleWeb(req, new URL(req.url), `/entries/${id}`, "POST");
    expect(r!.status).toBe(400);
    const row = db.query("SELECT start_time, end_time FROM time_entries WHERE id = ?").get(id) as any;
    expect(row).toEqual({ start_time: "2026-10-08T09:00:00.000Z", end_time: "2026-10-08T10:00:00.000Z" });
  });

  test("POST /entries/:id moving start after end is 400 and leaves the entry untouched", async () => {
    const { db, handleWeb } = setup();
    const ins = db.query("INSERT INTO time_entries (description, start_time, end_time) VALUES ('x', '2026-10-08T09:00:00.000Z', '2026-10-08T10:00:00.000Z')").run();
    const id = Number(ins.lastInsertRowid);
    const form = new FormData();
    form.append("description", "x");
    form.append("start_time", "2026-10-08T11:00:00Z");
    form.append("end_time", "2026-10-08T10:00:00Z");
    const req = new Request(`http://x/entries/${id}`, { method: "POST", body: form });
    const r = await handleWeb(req, new URL(req.url), `/entries/${id}`, "POST");
    expect(r!.status).toBe(400);
    const row = db.query("SELECT start_time, end_time FROM time_entries WHERE id = ?").get(id) as any;
    expect(row).toEqual({ start_time: "2026-10-08T09:00:00.000Z", end_time: "2026-10-08T10:00:00.000Z" });
  });
});

/** #1291: GET /i/:token.pdf — the client's PDF download. Same token lookup
 * as the public page; a fresh PDF from the invoice, 404 for bad tokens. */
describe("public invoice PDF download (#1291)", () => {
  const PUB_TOKEN = "pubtoken1234567890pubtoken123456";
  function setupPublicPdf(invoiceToken: string = PUB_TOKEN) {
    const db = createDb(mkdtempSync(join(tmpdir(), "tk-web-pdf-"))).db;
    db.query("INSERT INTO clients (name, color, rate) VALUES ('Bytebot', '#fb923c', 40)").run();
    const invId = Number(db.query("INSERT INTO invoices (client_id, number, issue_date, status) VALUES (1, 'INV-0001', '2026-11-05', 'sent')").run().lastInsertRowid);
    db.query("UPDATE invoices SET public_token = ? WHERE id = ?").run(PUB_TOKEN, invId);
    const noop = () => "";
    const tenant = {
      db, dbPath: "",
      qRunning: { get: () => null } as any,
      qOne: { get: () => null } as any,
      qRange: { all: () => [] } as any,
      qInvoice: { get: () => null } as any,
      qInvoices: { all: () => [] } as any,
      notFoundPage: () => "nf", errorPage: () => "err",
      publicInvoicePage: noop,
      getInvoice: (id: number) => (id === invId ? ({ id: invId, number: "INV-0001", items: [], public_token: invoiceToken } as any) : null),
      invoicePdfInput: () => ({} as any),
    };
    const { handleWeb } = createWebRouter({
      getTenant: () => tenant as any,
      STATIC_DIR: "", TOKEN: "t",
      authedPage: () => false,
      tokensEqual: (a: string, b: string) => a === b,
      html: (body: string, status = 200, extra: Record<string, string> = {}) => new Response(body, { status, headers: extra }),
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      isHtmx: () => false,
      csvResponse: (f: string) => new Response(f),
      shareOrigin: () => "https://example.com",
      PORT: 3000,
      loginPage: noop, signupPage: noop, hostedLoginPage: noop,
      HOSTED: false, accounts: null,
      changelogPage: () => [], termsPage: () => [],
      notFoundPage: () => "nf", noSuchInvoicePage: () => "no-such-invoice",
      rateLimitPage: () => "rl", errorPage: () => "err",
      invoicePdf: () => new TextEncoder().encode("%PDF-fake"), stripeConfigured: () => false,
      workspaceEmpty: () => false, demoIds: () => [], seedDemoData: () => {},
      removeDemoData: () => {}, entryToJson: (e: any) => e,
    });
    const get = (path: string) => {
      const req = new Request(`http://x${path}`);
      return handleWeb(req, new URL(req.url), path, "GET");
    };
    return { get };
  }

  test("a valid token serves the PDF as an attachment named for the invoice", async () => {
    const { get } = setupPublicPdf();
    const res = await get(`/i/${PUB_TOKEN}.pdf`);
    expect(res!.status).toBe(200);
    expect(res!.headers.get("Content-Type")).toBe("application/pdf");
    expect(res!.headers.get("Content-Disposition")).toBe('attachment; filename="INV-0001.pdf"');
    expect(res!.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res!.text()).toBe("%PDF-fake");
  });

  test("an unknown token gets the same 404 dead-end as the page", async () => {
    const { get } = setupPublicPdf();
    const res = await get(`/i/${"z".repeat(32)}.pdf`);
    expect(res!.status).toBe(404);
    expect(await res!.text()).toContain("no-such-invoice");
  });

  test("a malformed token is a 404, not a PDF", async () => {
    const { get } = setupPublicPdf();
    const res = await get("/i/short.pdf");
    expect(res!.status).toBe(404);
  });

  test("a token rotated between lookup and render never serves a PDF", async () => {
    const { get } = setupPublicPdf("rotatedtoken1234567890rotated12");
    const res = await get(`/i/${PUB_TOKEN}.pdf`);
    expect(res!.status).toBe(404);
  });
});

/** #1350: the wizard's billing period is the Zinvoice's period. It used to be
 *  dropped on create and re-derived from the first/last entry dates, so a
 *  Saturday-start period (Nov 7) printed as the first worked Monday (Nov 9). */
describe("billing period from the wizard (#1350)", () => {
  const wizardPost = (extra: Record<string, string> = {}) => ({
    ...baseInvoiceFields, number: "INV-0016", groups: "1",
    g0_desc: "Development", g0_hours: "10", g0_rate: "40",
    g0_ids: "", g0_date_from: "2026-11-09", g0_date_to: "2026-11-20",
    from: "2026-11-07", to: "2026-11-20", ...extra,
  });
  const viewsFor = (db: any) => {
    const qInvoice = db.query(`SELECT i.*, c.name AS client_name, c.color AS client_color, c.payment_terms AS client_payment_terms,
      c.email AS client_email, c.phone AS client_phone, c.website AS client_website, c.address AS client_address
      FROM invoices i LEFT JOIN clients c ON c.id = i.client_id WHERE i.id = ?`);
    const qInvoiceItems = db.query("SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY id");
    const domain = createDomain({ db, qInvoice, qInvoiceItems, TOKEN: "t" } as any);
    const views = createInvoiceViews({
      db, qInvoices: db.query("SELECT * FROM invoices"), layout: (_t: string, b: string) => b,
      getPublicToken: domain.getPublicToken, stripeConfigured: () => false,
      nextInvoiceNumber: domain.nextInvoiceNumber, invoiceTotals: domain.invoiceTotals,
      isOverdue: () => false, unbilledByClient: domain.unbilledByClient,
    });
    return { domain, views };
  };

  test("create stores the wizard's From/To on the Zinvoice", async () => {
    const { db, handleWeb } = setupSend();
    await postInvoice(handleWeb, wizardPost());
    const inv = db.query("SELECT period_from, period_to FROM invoices WHERE number = 'INV-0016'").get() as any;
    expect(inv).toEqual({ period_from: "2026-11-07", period_to: "2026-11-20" });
  });

  test("the sheet and the PDF show the stored period, not the first entry's date", async () => {
    const { db, handleWeb } = setupSend();
    await postInvoice(handleWeb, wizardPost());
    const { domain, views } = viewsFor(db);
    const id = (db.query("SELECT id FROM invoices WHERE number = 'INV-0016'").get() as any).id;
    const inv = domain.getInvoice(id)!;
    const sheet = views.invoiceSheet(inv);
    expect(sheet).toContain("Billing period: Nov 7 – Nov 20, 2026");
    expect(sheet).not.toContain("Billing period: Nov 9");
    const pdfIn = views.invoicePdfInput(inv, "http://x");
    expect(pdfIn.period).toBe("Nov 7 – Nov 20, 2026");
    const bytes = new TextDecoder("latin1").decode(invoicePdf(pdfIn));
    expect(bytes).toContain("Billing period Nov 7");
  });

  test("a missing or reversed range stores no period; surfaces fall back to the line dates", async () => {
    const { db, handleWeb } = setupSend();
    await postInvoice(handleWeb, wizardPost({ from: "2026-11-20", to: "2026-11-07" }));
    const row = db.query("SELECT id, period_from, period_to FROM invoices").get() as any;
    expect(row.period_from).toBeNull();
    expect(row.period_to).toBeNull();
    const { domain, views } = viewsFor(db);
    const inv = domain.getInvoice(row.id)!;
    expect(views.invoiceSheet(inv)).toContain("Billing period: Nov 9 – Nov 20, 2026");
    expect(views.invoicePdfInput(inv, "http://x").period).toBeUndefined();
  });

  test("invoice the rest continues the day after the stored period end", async () => {
    const { db, handleWeb } = setupSend();
    await postInvoice(handleWeb, wizardPost({ from: "2026-11-07", to: "2026-11-20", g0_date_to: "2026-11-18" }));
    const { domain } = viewsFor(db);
    expect(domain.clientRestFrom(1)).toBe("2026-11-21");
  });
});

/** Marking sent / paid from the browser stamps the user's local day. */
describe("status route honours client_day", () => {
  const yesterdayUtc = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const post = (handleWeb: any, id: number, fields: Record<string, string>) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const req = new Request(`http://x/invoices/${id}/status`, { method: "POST", body: form });
    return handleWeb(req, new URL(req.url), `/invoices/${id}/status`, "POST");
  };
  test("sent_at and paid_at take the client's day; a bad value falls back to UTC", async () => {
    const { db, handleWeb } = setupSend();
    await postInvoice(handleWeb, { ...baseInvoiceFields, groups: "1", g0_desc: "x", g0_hours: "1", g0_rate: "10", g0_ids: "", g0_date_from: "", g0_date_to: "" });
    const id = (db.query("SELECT id FROM invoices").get() as any).id;
    await post(handleWeb, id, { status: "sent", client_day: yesterdayUtc() });
    expect((db.query("SELECT sent_at FROM invoices WHERE id = ?").get(id) as any).sent_at).toBe(yesterdayUtc());
    await post(handleWeb, id, { status: "paid", client_day: "garbage" });
    expect((db.query("SELECT paid_at FROM invoices WHERE id = ?").get(id) as any).paid_at).toBe(new Date().toISOString().slice(0, 10));
  });
  test("the wizard's Send stores the client's day too", async () => {
    const { db, handleWeb } = setupSend();
    await postInvoice(handleWeb, { ...baseInvoiceFields, intent: "send", client_day: yesterdayUtc(), groups: "1", g0_desc: "x", g0_hours: "1", g0_rate: "10", g0_ids: "", g0_date_from: "", g0_date_to: "" });
    expect((db.query("SELECT sent_at FROM invoices").get() as any).sent_at).toBe(yesterdayUtc());
  });
});

/** #1462: the web entry routes get the API's #1458 check — a provided
 * project_id must name a real project, or nothing is stored. */
describe("web entry project_id validation (#1462)", () => {
  const times = { start_time: "2026-10-08T09:00:00.000Z", end_time: "2026-10-08T10:00:00.000Z" };

  test("POST /entries with a nonexistent project_id is 400 and creates nothing", async () => {
    const { db, handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "999", description: "", ...times });
    expect(r!.status).toBe(400);
    expect((db.query("SELECT COUNT(*) c FROM time_entries").get() as any).c).toBe(0);
  });

  test("POST /entries with a non-numeric project_id is 400 and creates nothing", async () => {
    const { db, handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "abc", description: "", ...times });
    expect(r!.status).toBe(400);
    expect((db.query("SELECT COUNT(*) c FROM time_entries").get() as any).c).toBe(0);
  });

  test("POST /entries with a real project_id still works", async () => {
    const { db, handleWeb } = setup();
    db.query("INSERT INTO projects (name) VALUES ('Site')").run();
    const project = db.query("SELECT id FROM projects").get() as any;
    const r = await postEntry(handleWeb, { project_id: String(project.id), description: "", ...times });
    expect(r!.status).toBe(201);
    expect((db.query("SELECT project_id FROM time_entries").get() as any).project_id).toBe(project.id);
  });

  test("POST /timer/start with a nonexistent project_id is 400 and starts nothing", async () => {
    const { db, handleWeb } = setup();
    const form = new FormData();
    form.append("project_id", "999");
    form.append("description", "");
    const req = new Request("http://x/timer/start", { method: "POST", body: form });
    const r = await handleWeb(req, new URL(req.url), "/timer/start", "POST");
    expect(r!.status).toBe(400);
    expect((db.query("SELECT COUNT(*) c FROM time_entries").get() as any).c).toBe(0);
  });

  test("POST /timer/start with a nonexistent project_id asks for a toast (#1465)", async () => {
    const { handleWeb } = setup();
    const form = new FormData();
    form.append("project_id", "999");
    form.append("description", "");
    const req = new Request("http://x/timer/start", { method: "POST", body: form, headers: { "HX-Request": "true" } });
    const r = await handleWeb(req, new URL(req.url), "/timer/start", "POST");
    expect(r!.status).toBe(400);
    expect(JSON.parse(r!.headers.get("HX-Trigger")!)).toEqual({ "tk-toast": "That project no longer exists" });
  });

  test("POST /entries/:id for a nonexistent entry is 404 (#1472)", async () => {
    const { handleWeb } = setup();
    const form = new FormData();
    form.append("description", "x");
    form.append("start_time", "2026-10-08T09:00:00.000Z");
    form.append("end_time", "2026-10-08T10:00:00.000Z");
    const req = new Request("http://x/entries/9999", { method: "POST", body: form });
    const r = await handleWeb(req, new URL(req.url), "/entries/9999", "POST");
    expect(r!.status).toBe(404);
  });

  test("POST /entries/:id for a nonexistent entry asks for a toast when htmx (#1472)", async () => {
    const { handleWeb } = setup();
    const form = new FormData();
    form.append("description", "x");
    form.append("start_time", "2026-10-08T09:00:00.000Z");
    form.append("end_time", "2026-10-08T10:00:00.000Z");
    const req = new Request("http://x/entries/9999", { method: "POST", body: form, headers: { "HX-Request": "true" } });
    const r = await handleWeb(req, new URL(req.url), "/entries/9999", "POST");
    expect(r!.status).toBe(404);
    expect(JSON.parse(r!.headers.get("HX-Trigger")!)).toEqual({ "tk-toast": "That entry no longer exists" });
  });

  test("POST /entries/:id with a nonexistent project_id is 400 and leaves the entry untouched", async () => {
    const { db, handleWeb } = setup();
    const ins = db.query("INSERT INTO time_entries (description, start_time, end_time) VALUES ('x', '2026-10-08T09:00:00.000Z', '2026-10-08T10:00:00.000Z')").run();
    const id = Number(ins.lastInsertRowid);
    const form = new FormData();
    form.append("description", "x");
    form.append("project_id", "999");
    form.append("start_time", "2026-10-08T09:00:00.000Z");
    form.append("end_time", "2026-10-08T10:00:00.000Z");
    const req = new Request(`http://x/entries/${id}`, { method: "POST", body: form });
    const r = await handleWeb(req, new URL(req.url), `/entries/${id}`, "POST");
    expect(r!.status).toBe(400);
    expect((db.query("SELECT project_id FROM time_entries WHERE id = ?").get(id) as any).project_id).toBeNull();
  });

  test("POST /clients/:id/settings for a nonexistent client is 404 (#1474)", async () => {
    const { handleWeb } = setup();
    const form = new FormData();
    form.append("name", "Ghost");
    form.append("rate", "50");
    const req = new Request("http://x/clients/999/settings", { method: "POST", body: form });
    const r = await handleWeb(req, new URL(req.url), "/clients/999/settings", "POST");
    expect(r!.status).toBe(404);
    expect(JSON.parse(r!.headers.get("HX-Trigger")!)).toEqual({ "tk-toast": "That client no longer exists" });
  });

  test("POST /clients/:id/delete for a nonexistent client is 404 (#1474)", async () => {
    const { handleWeb } = setup();
    const req = new Request("http://x/clients/999/delete", { method: "POST" });
    const r = await handleWeb(req, new URL(req.url), "/clients/999/delete", "POST");
    expect(r!.status).toBe(404);
    expect(JSON.parse(r!.headers.get("HX-Trigger")!)).toEqual({ "tk-toast": "That client no longer exists" });
  });

  test("POST /projects/:id/delete for a nonexistent project is 404 (#1474)", async () => {
    const { handleWeb } = setup();
    const req = new Request("http://x/projects/999/delete", { method: "POST" });
    const r = await handleWeb(req, new URL(req.url), "/projects/999/delete", "POST");
    expect(r!.status).toBe(404);
    expect(JSON.parse(r!.headers.get("HX-Trigger")!)).toEqual({ "tk-toast": "That project no longer exists" });
  });

  test("POST /invoices/:id/public-token/regenerate for a nonexistent invoice is 404 (#1474)", async () => {
    const { handleWeb } = setup();
    const req = new Request("http://x/invoices/999/public-token/regenerate", { method: "POST" });
    const r = await handleWeb(req, new URL(req.url), "/invoices/999/public-token/regenerate", "POST");
    expect(r!.status).toBe(404);
    expect(JSON.parse(r!.headers.get("HX-Trigger")!)).toEqual({ "tk-toast": "That invoice no longer exists" });
  });

  test("POST /invoices/:id/public-token/revoke for a nonexistent invoice is 404 (#1474)", async () => {
    const { handleWeb } = setup();
    const req = new Request("http://x/invoices/999/public-token/revoke", { method: "POST" });
    const r = await handleWeb(req, new URL(req.url), "/invoices/999/public-token/revoke", "POST");
    expect(r!.status).toBe(404);
    expect(JSON.parse(r!.headers.get("HX-Trigger")!)).toEqual({ "tk-toast": "That invoice no longer exists" });
  });

  test("POST /invoices/:id/status for a nonexistent invoice is 404 (#1480)", async () => {
    const { handleWeb } = setup();
    const form = new FormData();
    form.append("status", "sent");
    const req = new Request("http://x/invoices/999/status", { method: "POST", body: form });
    const r = await handleWeb(req, new URL(req.url), "/invoices/999/status", "POST");
    expect(r!.status).toBe(404);
    expect(JSON.parse(r!.headers.get("HX-Trigger")!)).toEqual({ "tk-toast": "That invoice no longer exists" });
  });

  test("DELETE /entries/:id for a nonexistent entry is 404 (#1478)", async () => {
    const { handleWeb } = setup();
    const req = new Request("http://x/entries/9999", { method: "DELETE" });
    const r = await handleWeb(req, new URL(req.url), "/entries/9999", "DELETE");
    expect(r!.status).toBe(404);
    expect(JSON.parse(r!.headers.get("HX-Trigger")!)).toEqual({ "tk-toast": "That entry no longer exists" });
  });

  test("DELETE /entries/:id for an invoiced entry is 403 and keeps the entry (#1478)", async () => {
    const { db, handleWeb } = setup();
    const inv = db.query("INSERT INTO invoices (number, issue_date, status) VALUES ('INV-1478', '2026-10-08', 'sent') RETURNING id").get() as any;
    const ins = db.query("INSERT INTO time_entries (description, start_time, end_time, invoice_id) VALUES ('x', '2026-10-08T09:00:00.000Z', '2026-10-08T10:00:00.000Z', ?)").run(inv.id);
    const id = Number(ins.lastInsertRowid);
    const req = new Request(`http://x/entries/${id}`, { method: "DELETE" });
    const r = await handleWeb(req, new URL(req.url), `/entries/${id}`, "DELETE");
    expect(r!.status).toBe(403);
    expect(db.query("SELECT id FROM time_entries WHERE id = ?").get(id)).not.toBeNull();
  });

  test("DELETE /entries/:id deletes an existing entry (#1478)", async () => {
    const { db, handleWeb } = setup();
    const ins = db.query("INSERT INTO time_entries (description, start_time, end_time) VALUES ('x', '2026-10-08T09:00:00.000Z', '2026-10-08T10:00:00.000Z')").run();
    const id = Number(ins.lastInsertRowid);
    const req = new Request(`http://x/entries/${id}`, { method: "DELETE" });
    const r = await handleWeb(req, new URL(req.url), `/entries/${id}`, "DELETE");
    expect(r!.status).toBe(200);
    expect(db.query("SELECT id FROM time_entries WHERE id = ?").get(id)).toBeNull();
  });
});

/** #1082: the billable flag on web entry create/edit and in the CSV export. */
describe("entry billable flag (#1082)", () => {
  const times = { start_time: "2026-10-08T09:00:00.000Z", end_time: "2026-10-08T10:00:00.000Z" };
  const flag = (db: Database) => (db.query("SELECT billable FROM time_entries").get() as any).billable;

  function postEdit(handleWeb: any, id: number, fields: [string, string][]) {
    const form = new FormData();
    for (const [k, v] of fields) form.append(k, v);
    const req = new Request(`http://x/entries/${id}`, { method: "POST", body: form });
    return handleWeb(req, new URL(req.url), `/entries/${id}`, "POST");
  }

  test("a new entry is billable unless the form says otherwise", async () => {
    const { db, handleWeb } = setup();
    expect((await postEntry(handleWeb, { project_id: "", description: "a", ...times }))!.status).toBe(201);
    expect(flag(db)).toBe(1);
    db.exec("DELETE FROM time_entries");
    expect((await postEntry(handleWeb, { project_id: "", description: "b", billable: "0", ...times }))!.status).toBe(201);
    expect(flag(db)).toBe(0);
  });

  test("the edit form's hidden 0 + checked 1 saves billable; hidden 0 alone saves non-billable", async () => {
    const { db, handleWeb } = setup();
    db.query("INSERT INTO time_entries (description, start_time, end_time) VALUES ('x', ?, ?)").run(times.start_time, times.end_time);
    const id = (db.query("SELECT id FROM time_entries").get() as any).id;
    const base: [string, string][] = [["description", "x"], ["project_id", ""], ["start_time", times.start_time], ["end_time", times.end_time]];
    await postEdit(handleWeb, id, [...base, ["billable", "0"]]);
    expect(flag(db)).toBe(0);
    await postEdit(handleWeb, id, [...base, ["billable", "0"], ["billable", "1"]]);
    expect(flag(db)).toBe(1);
  });

  test("a calendar move/resize (no billable field) keeps a non-billable entry non-billable", async () => {
    const { db, handleWeb } = setup();
    db.query("INSERT INTO time_entries (description, start_time, end_time, billable) VALUES ('x', ?, ?, 0)").run(times.start_time, times.end_time);
    const id = (db.query("SELECT id FROM time_entries").get() as any).id;
    const r = await postEdit(handleWeb, id, [["description", "x"], ["project_id", ""], ["start_time", "2026-10-08T09:15:00.000Z"], ["end_time", times.end_time]]);
    expect(r!.status).toBe(302);
    expect(flag(db)).toBe(0);
  });

  test("the CSV billable column reads the flag, and non-billable time carries no amount", async () => {
    const { db, client, handleWeb } = setup();
    db.query("INSERT INTO projects (client_id, name) VALUES (?, 'Site')").run(client.id);
    const pid = (db.query("SELECT id FROM projects").get() as any).id;
    const ins = db.query("INSERT INTO time_entries (project_id, description, start_time, end_time, billable) VALUES (?, ?, ?, ?, ?)");
    ins.run(pid, "billed", "2026-10-08T09:00:00.000Z", "2026-10-08T10:00:00.000Z", 1);
    ins.run(pid, "courtesy", "2026-10-08T11:00:00.000Z", "2026-10-08T12:00:00.000Z", 0);
    ins.run(null, "admin", "2026-10-08T13:00:00.000Z", "2026-10-08T14:00:00.000Z", 1);
    const req = new Request("http://x/export/entries.csv");
    const csv = await (await handleWeb(req, new URL(req.url), "/export/entries.csv", "GET"))!.text();
    const line = (d: string) => csv.split("\n").find((l: string) => l.includes(d))!;
    expect(line("billed")).toContain(",1.00,yes,40.00,40.00");
    expect(line("courtesy")).toContain(",1.00,no,40.00,0.00");
    expect(line("admin")).toContain(",1.00,no,");
  });
});

/** #1081: the web forms send bare wall times with the zone they're in. */
describe("entry wall-clock time on the web routes (#1081)", () => {
  test("a bare wall time with entry_tz resolves in that zone and records it", async () => {
    const { db, handleWeb } = setup();
    const r = await postEntry(handleWeb, {
      project_id: "", description: "ca", start_time: "2026-07-15T08:00", end_time: "2026-07-15T17:00",
      entry_tz: "America/Los_Angeles", client_tz: "America/New_York",
    });
    expect(r!.status).toBe(201);
    expect(db.query("SELECT start_time, end_time, tz FROM time_entries").get()).toEqual({
      start_time: "2026-07-15T15:00:00.000Z", end_time: "2026-07-16T00:00:00.000Z", tz: "America/Los_Angeles",
    });
  });

  test("a bare wall time with no zone is still rejected (#964)", async () => {
    const { db, handleWeb } = setup();
    const r = await postEntry(handleWeb, { project_id: "", description: "", start_time: "2026-07-15T08:00", end_time: "2026-07-15T17:00" });
    expect(r!.status).toBe(400);
    expect((db.query("SELECT COUNT(*) c FROM time_entries").get() as any).c).toBe(0);
  });

  test("an offset-bearing post records the page's client_tz", async () => {
    const { db, handleWeb } = setup();
    await postEntry(handleWeb, { project_id: "", description: "", start_time: "2026-07-15T08:00:00-04:00", end_time: "2026-07-15T09:00:00-04:00", client_tz: "America/New_York" });
    expect((db.query("SELECT tz FROM time_entries").get() as any).tz).toBe("America/New_York");
  });

  test("the timer records the zone it was started in", async () => {
    const { db, handleWeb } = setup();
    const form = new FormData();
    form.append("description", "x");
    form.append("client_tz", "America/Denver");
    const req = new Request("http://x/timer/start", { method: "POST", body: form });
    await handleWeb(req, new URL(req.url), "/timer/start", "POST");
    expect((db.query("SELECT tz FROM time_entries").get() as any).tz).toBe("America/Denver");
  });

  test("the CSV shows each entry's own wall date and times", async () => {
    const { db, handleWeb } = setup();
    db.query("INSERT INTO time_entries (description, start_time, end_time, tz) VALUES ('late ca', '2026-10-01T03:00:00.000Z', '2026-10-01T04:30:00.000Z', 'America/Los_Angeles')").run();
    const req = new Request("http://x/export/entries.csv");
    const csv = await (await handleWeb(req, new URL(req.url), "/export/entries.csv", "GET"))!.text();
    expect(csv).toContain("2026-09-30,,,late ca,20:00,21:30,1.50");
  });
});

/** #1507: the entries CSV export validates its ?from=/?to= week range the
 *  way the API entries list (#1494) and the invoice preview (#1490) already
 *  do — a garbage or reversed range must 400, not silently return a
 *  header-only CSV that reads as "no entries that week". */
describe("entries CSV export range validation (#1507)", () => {
  const getCsv = async (handleWeb: any, qs: string) => {
    const req = new Request(`http://x/export/entries.csv${qs}`);
    return (await handleWeb(req, new URL(req.url), "/export/entries.csv", "GET"))!;
  };

  test("a garbage from is a 400, not an empty CSV", async () => {
    const { handleWeb } = setup();
    const res = await getCsv(handleWeb, "?from=garbage&to=2026-10-15");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("valid dates");
  });

  test("an impossible to date is a 400", async () => {
    const { handleWeb } = setup();
    const res = await getCsv(handleWeb, "?from=2026-02-01&to=2026-02-30");
    expect(res.status).toBe(400);
  });

  test("a reversed range is a 400", async () => {
    const { handleWeb } = setup();
    const res = await getCsv(handleWeb, "?from=2026-10-15&to=2026-10-08");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("on or before");
  });

  test("a valid week range still filters, and no params still exports all", async () => {
    const { db, handleWeb } = setup();
    const ins = db.query("INSERT INTO time_entries (description, start_time, end_time) VALUES (?, ?, ?)");
    ins.run("in week", "2026-10-08T09:00:00.000Z", "2026-10-08T10:00:00.000Z");
    ins.run("next week", "2026-10-20T09:00:00.000Z", "2026-10-20T10:00:00.000Z");
    ins.run("on from", "2026-10-04T09:00:00.000Z", "2026-10-04T10:00:00.000Z");
    ins.run("on to", "2026-10-11T09:00:00.000Z", "2026-10-11T10:00:00.000Z");
    const week = await (await getCsv(handleWeb, "?from=2026-10-04&to=2026-10-11")).text();
    expect(week).toContain("in week");
    expect(week).not.toContain("next week");
    expect(week).toContain("on from");
    expect(week).not.toContain("on to");
    const all = await (await getCsv(handleWeb, "")).text();
    expect(all).toContain("in week");
    expect(all).toContain("next week");
  });
});
