/** #630: client settings modal — GET/POST /clients/:id/settings (name +
 * contact details). Wires the real web router with stub deps (plus the real
 * manage views so the settings form fragment is exercised). */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createDb, getMeta } from "../db.ts";
import { createWebRouter } from "./web.ts";
import { createManageViews } from "../views/manage.ts";

function setup() {
  const db = createDb(mkdtempSync(join(tmpdir(), "tk-web-"))).db;
  db.query("INSERT INTO clients (name, color, rate) VALUES ('Bytebot', '#fb923c', 40)").run();
  const client = db.query("SELECT * FROM clients").get() as any;
  const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
  const noop = () => "";
  /* #733: data deps resolve per request through getTenant now. */
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
    bizProfileSection: noop, dailyTargetSection: views.dailyTargetSection, clientSettingsForm: views.clientSettingsForm, themeSectionHtml: views.themeSectionHtml, settingsPage: noop,
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
  return { db, client, handleWeb };
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
      bizProfileSection: noop, dailyTargetSection: views.dailyTargetSection, clientSettingsForm: views.clientSettingsForm, themeSectionHtml: views.themeSectionHtml, settingsPage: noop,
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
    return { handleWeb };
  }

  async function getManage(handleWeb: any) {
    const req = new Request("http://x/manage", { method: "GET" });
    const res = await handleWeb(req, new URL(req.url), "/manage", "GET");
    return { status: res.status, body: await res.text() };
  }

  test("zero clients: the stacked page renders with the No client row", async () => {
    const { handleWeb } = setupWith([]);
    const { status, body } = await getManage(handleWeb);
    expect(status).toBe(200);
    expect(body).toContain('<h1 class="ui-app-title">Manage</h1>');
    expect(body).toContain("No client");
    expect(body).toContain('id="projects-card"');
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
