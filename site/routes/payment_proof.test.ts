/** Issue #956: proof-of-payment upload/serve/delete routes + detail UI. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database, Statement } from "bun:sqlite";
import { createDb } from "../db.ts";
import { createWebRouter } from "./web.ts";
import { createInvoiceViews } from "../views/invoices.ts";
import { insertProof } from "../lib/payment_proofs.ts";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 1]);
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3, 4, 5, 6, 7, 8]);

function setup() {
  const db = createDb(mkdtempSync(join(tmpdir(), "tk-pp-"))).db;
  db.query("INSERT INTO clients (name, color, rate) VALUES ('Bytebot', '#fb923c', 40)").run();
  const c = db.query("SELECT id FROM clients").get() as { id: number };
  db.query("INSERT INTO invoices (client_id, number, issue_date, status) VALUES (?, 'INV-0001', '2026-10-01', 'sent')").run(c.id);
  db.query("INSERT INTO invoices (client_id, number, issue_date, status) VALUES (?, 'INV-0002', '2026-10-02', 'draft')").run(c.id);
  const inv = db.query("SELECT id FROM invoices WHERE number = 'INV-0001'").get() as { id: number };
  const draft = db.query("SELECT id FROM invoices WHERE number = 'INV-0002'").get() as { id: number };
  const noop = () => "";
  const tenant = {
    db, dbPath: "",
    qRunning: { get: () => null } as any,
    qOne: { get: () => null } as any,
    qRange: { all: () => [] } as any,
    qInvoice: db.query("SELECT * FROM invoices WHERE id = ?"),
    qInvoices: { all: () => [] } as any,
    notFoundPage: noop, errorPage: noop,
    dashboardPage: noop, timerPartial: noop, todayPartial: noop, weekInner: noop, weekStrip: noop,
    calendarPage: noop, editPage: () => null, managePage: noop, clientSelection: noop,
    clientDetailBody: noop, clientListOob: noop, bizProfileSection: noop, dailyTargetSection: noop,
    clientSettingsForm: noop, themeSectionHtml: noop, settingsPage: noop,
    invoicesPage: noop, invoiceNewPage: noop, defaultNewInvParams: () => ({}), invoiceStep2: noop,
    invoiceDetailBody: noop, invoiceListOob: noop, invoiceDoc: noop, publicInvoicePage: noop,
    getInvoice: (id: number) => db.query("SELECT * FROM invoices WHERE id = ?").get(id) as any,
    invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    nextInvoiceNumber: () => "INV-0003", stripeLinkFor: async () => ({}),
    unbilledEntries: () => [], groupToLineItems: () => [], clientRestFrom: () => null,
    ensurePublicToken: () => "", getPublicToken: () => null, mintPublicToken: () => "",
    invoicePdfInput: () => ({} as any), freezeInvoiceSnapshots: () => {},
  };
  const { handleWeb } = createWebRouter({
    getTenant: () => tenant as any,
    STATIC_DIR: "", TOKEN: "t",
    authedPage: () => true,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200) => new Response(body, { status }),
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    isHtmx: () => false,
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
  return { db, invId: inv.id, draftId: draft.id, handleWeb };
}

function upload(handleWeb: any, invId: number, file: File) {
  const form = new FormData();
  form.append("proof", file);
  const req = new Request(`http://x/invoices/${invId}/payment-proof`, { method: "POST", body: form });
  return handleWeb(req, new URL(req.url), `/invoices/${invId}/payment-proof`, "POST");
}

describe("POST /invoices/:id/payment-proof", () => {
  test("accepts a valid PNG and records it", async () => {
    const { db, invId, handleWeb } = setup();
    const res = await upload(handleWeb, invId, new File([png], "receipt.png", { type: "image/png" }));
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toContain(`/invoices?invoice=${invId}`);
    const rows = db.query("SELECT filename, mime, size FROM invoice_payment_proofs WHERE invoice_id = ?").all(invId) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].filename).toBe("receipt.png");
    expect(rows[0].mime).toBe("image/png");
    expect(rows[0].size).toBe(png.length);
  });
  test("accepts PDF", async () => {
    const { invId, handleWeb } = setup();
    const res = await upload(handleWeb, invId, new File([pdf], "confirm.pdf", { type: "application/pdf" }));
    expect(res.status).toBe(302);
  });
  test("rejects magic-byte mismatch", async () => {
    const { db, invId, handleWeb } = setup();
    const html = new TextEncoder().encode("<html>not a png</html>!");
    const res = await upload(handleWeb, invId, new File([html], "evil.png", { type: "image/png" }));
    expect(res.status).toBe(400);
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_payment_proofs").get()).toEqual({ n: 0 });
  });
  test("rejects disallowed types", async () => {
    const { invId, handleWeb } = setup();
    const res = await upload(handleWeb, invId, new File([png], "x.exe", { type: "application/octet-stream" }));
    expect(res.status).toBe(400);
  });
  test("rejects oversized files", async () => {
    const { invId, handleWeb } = setup();
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set([0x89, 0x50, 0x4e, 0x47]);
    const res = await upload(handleWeb, invId, new File([big], "big.png", { type: "image/png" }));
    expect(res.status).toBe(400);
  });
  test("#985: rejects uploads past the per-invoice cap", async () => {
    const { db, invId, handleWeb } = setup();
    for (let i = 0; i < 10; i++) insertProof(db, invId, `p${i}.png`, "image/png", png);
    const res = await upload(handleWeb, invId, new File([png], "one-more.png", { type: "image/png" }));
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("maximum of 10");
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_payment_proofs WHERE invoice_id = ?").get(invId)).toEqual({ n: 10 });
  });
  test("#985: the cap counts only the target invoice", async () => {
    const { db, invId, handleWeb } = setup();
    const other = db.query("INSERT INTO invoices (client_id, number, issue_date, status) VALUES (1, 'INV-0009', '2026-10-03', 'sent') RETURNING id").get() as { id: number };
    for (let i = 0; i < 10; i++) insertProof(db, other.id, `p${i}.png`, "image/png", png);
    const res = await upload(handleWeb, invId, new File([png], "ok.png", { type: "image/png" }));
    expect(res.status).toBe(302);
  });
  test("rejects missing file", async () => {
    const { invId, handleWeb } = setup();
    const req = new Request(`http://x/invoices/${invId}/payment-proof`, { method: "POST", body: new FormData() });
    const res = await handleWeb(req, new URL(req.url), `/invoices/${invId}/payment-proof`, "POST");
    expect(res.status).toBe(400);
  });
  test("rejects draft invoices", async () => {
    const { draftId, handleWeb } = setup();
    const res = await upload(handleWeb, draftId, new File([png], "r.png", { type: "image/png" }));
    expect(res.status).toBe(404);
  });
  test("sanitizes a hostile filename", async () => {
    const { db, invId, handleWeb } = setup();
    const res = await upload(handleWeb, invId, new File([png], "../../etc/passwd", { type: "image/png" }));
    expect(res.status).toBe(302);
    const row = db.query("SELECT filename FROM invoice_payment_proofs WHERE invoice_id = ?").get(invId) as any;
    expect(row.filename).toBe("passwd");
    expect(row.filename).not.toContain("/");
  });
});

describe("GET /invoices/:id/payment-proof/:proofId", () => {
  test("serves the file with its MIME type", async () => {
    const { db, invId, handleWeb } = setup();
    const pid = insertProof(db, invId, "receipt.png", "image/png", png);
    const path = `/invoices/${invId}/payment-proof/${pid}`;
    const req = new Request(`http://x${path}`);
    const res = await handleWeb(req, new URL(req.url), path, "GET");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
  });
  test("404s for unknown proof or mismatched invoice", async () => {
    const { db, invId, handleWeb } = setup();
    const pid = insertProof(db, invId, "r.png", "image/png", png);
    const req = new Request(`http://x/invoices/${invId}/payment-proof/99999`);
    const res = await handleWeb(req, new URL(req.url), `/invoices/${invId}/payment-proof/99999`, "GET");
    expect(res.status).toBe(404);
    const req2 = new Request(`http://x/invoices/424242/payment-proof/${pid}`);
    const res2 = await handleWeb(req2, new URL(req2.url), `/invoices/424242/payment-proof/${pid}`, "GET");
    expect(res2.status).toBe(404);
  });
});

describe("POST /invoices/:id/payment-proof/:proofId/delete", () => {
  test("deletes the proof and redirects", async () => {
    const { db, invId, handleWeb } = setup();
    const pid = insertProof(db, invId, "r.png", "image/png", png);
    const path = `/invoices/${invId}/payment-proof/${pid}/delete`;
    const req = new Request(`http://x${path}`, { method: "POST" });
    const res = await handleWeb(req, new URL(req.url), path, "POST");
    expect(res.status).toBe(302);
    expect(db.query("SELECT COUNT(*) AS n FROM invoice_payment_proofs").get()).toEqual({ n: 0 });
    const res2 = await handleWeb(req, new URL(req.url), path, "POST");
    expect(res2.status).toBe(404);
  });
});

describe("invoice detail proof section (#956)", () => {
  const stubQuery = () => ({
    get: (..._a: unknown[]) => ({ n: 0 }),
    all: (..._a: unknown[]) => [],
    run: (..._a: unknown[]) => {},
  });
  const stubDb = { query: (_sql: string) => stubQuery() } as unknown as Database;
  function views(db: Database) {
    return createInvoiceViews({
      db,
      qInvoices: { all: () => [] } as unknown as Statement,
      layout: (_t: string, b: string) => b,
      clientOptions: () => "",
      getPublicToken: () => null,
      stripeConfigured: () => false,
      nextInvoiceNumber: () => "INV-0001",
      invoiceTotals: () => ({ subtotal: 3200, tax: 0, total: 3200 }),
      statusPill: (s: string) => `<span>${s}</span>`,
      isOverdue: () => false,
      unbilledByClient: () => [],
    });
  }
  const invRow = (status: string) => ({
    id: 1, number: "INV-0001", client_name: "Acme", client_color: null,
    client_payment_terms: null, issue_date: "2026-10-01", due_date: "2026-10-15",
    tax_rate: 0, subtotal: 3200, status, paid_at: status === "paid" ? "2026-10-05" : null,
    notes: "", template: "modern", created_at: "2026-10-01",
    stripe_payment_link: null, paid_via_stripe: 0, public_token: null, items: [],
  });
  test("paid invoice with no proof shows the nudge + upload form", () => {
    const html = views(stubDb).invoiceDetailBody(invRow("paid") as any, "");
    expect(html).toContain("Proof of payment");
    expect(html).toContain("No proof attached");
    expect(html).toContain('action="/invoices/1/payment-proof"');
    expect(html).toContain('type="file"');
  });
  test("paid invoice with proof lists it with view + delete", () => {
    const db = createDb(mkdtempSync(join(tmpdir(), "tk-ppv-"))).db;
    db.query("INSERT INTO clients (name, color, rate) VALUES ('Acme', '#fff', 40)").run();
    db.query("INSERT INTO invoices (id, client_id, number, issue_date, status) VALUES (1, 1, 'INV-0001', '2026-10-01', 'paid')").run();
    insertProof(db, 1, "receipt.png", "image/png", png);
    const html = views(db).invoiceDetailBody(invRow("paid") as any, "");
    expect(html).toContain("receipt.png");
    expect(html).toContain("/invoices/1/payment-proof/1");
    expect(html).toContain("Delete proof");
    expect(html).not.toContain("No proof attached");
  });
  test("draft invoice shows no proof section", () => {
    const html = views(stubDb).invoiceDetailBody(invRow("draft") as any, "");
    expect(html).not.toContain("Proof of payment");
  });
});
