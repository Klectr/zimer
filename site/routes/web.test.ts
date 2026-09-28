/** #618: rename a client from the Manage page — POST /clients/:id/name.
 * Wires the real web router with stub deps (plus the real manage views so
 * the re-rendered detail pane and OOB list refresh are exercised). */
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
    bizProfileSection: noop, invoicesPage: noop, invoiceNewPage: noop,
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

function postName(handleWeb: any, id: number, name: string, htmx = true) {
  const form = new FormData();
  form.append("name", name);
  const headers: Record<string, string> = {};
  if (htmx) headers["HX-Request"] = "true";
  const req = new Request(`http://x/clients/${id}/name`, { method: "POST", body: form, headers });
  return handleWeb(req, new URL(req.url), `/clients/${id}/name`, "POST");
}

describe("POST /clients/:id/name (#618)", () => {
  test("renames the client and re-renders detail + OOB list", async () => {
    const { db, client, handleWeb } = setup();
    const res = await postName(handleWeb, client.id, "Byte Bot LLC");
    expect(res!.status).toBe(200);
    const row = db.query("SELECT name FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.name).toBe("Byte Bot LLC");
    const body = await res!.text();
    expect(body).toContain("Byte Bot LLC");
    expect(body).toContain('action="/clients/1/name"'.replace("1", String(client.id)));
  });

  test("trims whitespace", async () => {
    const { db, client, handleWeb } = setup();
    await postName(handleWeb, client.id, "  Byte Bot LLC  ");
    const row = db.query("SELECT name FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.name).toBe("Byte Bot LLC");
  });

  test("empty name is rejected with 400 and leaves the row untouched", async () => {
    const { db, client, handleWeb } = setup();
    const res = await postName(handleWeb, client.id, "   ");
    expect(res!.status).toBe(400);
    const row = db.query("SELECT name FROM clients WHERE id = ?").get(client.id) as any;
    expect(row.name).toBe("Bytebot");
  });

  test("plain POST redirects to the manage page", async () => {
    const { client, handleWeb } = setup();
    const res = await postName(handleWeb, client.id, "Byte Bot LLC", false);
    expect(res!.status).toBe(302);
    expect(res!.headers.get("Location")).toBe(`/manage?client=${client.id}`);
  });
});
