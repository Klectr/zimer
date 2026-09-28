/** #630: client settings modal — GET/POST /clients/:id/settings (name +
 * contact details). Wires the real web router with stub deps (plus the real
 * manage views so the settings form fragment is exercised). */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createDb } from "../db.ts";
import { createWebRouter } from "./web.ts";
import { createManageViews } from "../views/manage.ts";

function setup() {
  const db = createDb(mkdtempSync(join(tmpdir(), "tk-web-"))).db;
  db.query("INSERT INTO clients (name, color, rate) VALUES ('Bytebot', '#f2c14e', 40)").run();
  const client = db.query("SELECT * FROM clients").get() as any;
  const views = createManageViews({ db, layout: (_t: string, b: string) => b });
  const noop = () => "";
  const { handleWeb } = createWebRouter({
    db,
    qRunning: { get: () => null } as any,
    qOne: { get: () => null } as any,
    qRange: { all: () => [] } as any,
    qInvoice: { get: () => null } as any,
    qInvoices: { all: () => [] } as any,
    DATA_DIR: "", STATIC_DIR: "", TOKEN: "t",
    authedPage: () => true,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200) => new Response(body, { status }),
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    isHtmx: (req: Request) => req.headers.get("HX-Request") === "true",
    csvResponse: (f: string) => new Response(f),
    shareOrigin: () => "",
    PORT: 3000,
    loginPage: noop, publicInvoicePage: noop, changelogPage: () => [],
    termsPage: () => [], notFoundPage: noop, noSuchInvoicePage: noop,
    rateLimitPage: noop, errorPage: noop, dashboardPage: noop,
    timerPartial: noop, todayPartial: noop, weekInner: noop, weekStrip: noop,
    calendarPage: noop, editPage: () => null,
    managePage: views.managePage, clientSelection: views.clientSelection,
    clientDetailBody: views.clientDetailBody, clientListOob: views.clientListOob,
    bizProfileSection: noop, clientSettingsForm: views.clientSettingsForm, invoicesPage: noop, invoiceNewPage: noop,
    defaultNewInvParams: () => ({}), invoiceStep2: noop,
    invoiceDetailBody: noop, invoiceListOob: noop, invoiceDoc: noop,
    getInvoice: () => null, invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    nextInvoiceNumber: () => "INV-0001",
    stripeLinkFor: async () => ({}),
    unbilledEntries: () => [], groupToLineItems: () => [],
    clientRestFrom: () => null, ensurePublicToken: () => "",
    getPublicToken: () => null, mintPublicToken: () => "",
    invoicePdf: () => new Uint8Array(), invoicePdfInput: () => ({} as any),
    freezeInvoiceSnapshots: () => {}, stripeConfigured: () => false,
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

  test("POST saves the trimmed name and contact details, returning the form", async () => {
    const { db, client, handleWeb } = setup();
    const res = await postSettings(handleWeb, client.id, full);
    expect(res!.status).toBe(200);
    const row = db.query("SELECT name, email, phone, website, address FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.name).toBe("Byte Bot LLC");
    expect(row.email).toBe("ap@bytebot.io");
    expect(row.phone).toBe("555-0100");
    expect(row.website).toBe("bytebot.io");
    expect(row.address).toBe("2643 Morningside Dr\nClearwater, FL 33759");
    const body = await res!.text();
    expect(body).toContain('id="client-settings-form"');
    expect(body).toContain('name="name" value="Byte Bot LLC"');
    expect(body).toContain("ap@bytebot.io");
  });

  test("empty name is rejected with 400 and leaves the row untouched", async () => {
    const { db, client, handleWeb } = setup();
    const res = await postSettings(handleWeb, client.id, { ...full, name: "   " });
    expect(res!.status).toBe(400);
    const row = db.query("SELECT name FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.name).toBe("Bytebot");
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
    expect(res!.headers.get("Location")).toBe(`/manage?client=${client.id}`);
  });
});
