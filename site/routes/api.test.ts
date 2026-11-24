/** #552: PATCH /api/invoices/:id stamps paid_at when an invoice is marked
 * paid, mirroring the web mark-paid route and the Stripe webhook. The
 * invoice list, the detail header chip, and the CSV export all read
 * paid_at, so an API-marked-paid invoice without it silently loses its
 * paid date everywhere.
 */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { Database as BunDatabase } from "bun:sqlite";
import { createApiRouter, nonNegativeRate, stopEndTime } from "./api.ts";
import { todayStr } from "../lib/format.ts";

const stubStatement = () =>
  ({ get: () => null, all: () => [], run: () => {} } as unknown as Statement);

function setup() {
  const db = new BunDatabase(":memory:");
  db.exec(`CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'draft',
    paid_at TEXT,
    sent_at TEXT
  )`);
  db.query("INSERT INTO invoices (id, status) VALUES (1, 'sent'), (2, 'draft')").run();

  /* #733: data deps resolve per request through getTenant now. */
  const tenant = {
    db,
    qRunning: stubStatement(),
    qOne: stubStatement(),
    qRange: stubStatement(),
    qInvoice: {
      get: (id: number) =>
        db.query("SELECT id, status FROM invoices WHERE id = ?").get(id),
    } as unknown as Statement,
    qInvoices: stubStatement(),
    groupToLineItems: () => [],
    unbilledEntries: () => [],
    getInvoice: (id: number) => ({ id, items: [], tax_rate: 0 }) as any,
    invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    nextInvoiceNumber: () => "INV-0001",
    mintPublicToken: () => "tok",
    stripeLinkFor: async () => ({}),
    revenueTotals: () => null,
    revenueMonthly: () => [],
    revenueByClient: () => [],
    revenueOverdue: () => [],
    revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }),
    freezeInvoiceSnapshots: () => {},
  };

  const { handleApi } = createApiRouter({
    getTenant: () => tenant as any,
    TOKEN: "test-token",
    authedApi: () => true,
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    entryToJson: (e: any) => e,
    verifyWebhookSignature: () => false,
    shareOrigin: () => "",
  });

  async function patchStatus(id: number, status: string, extra: Record<string, unknown> = {}) {
    const req = new Request(`http://localhost/api/invoices/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status, ...extra }),
    });
    return (await handleApi(req, new URL(req.url), `/api/invoices/${id}`, "PATCH"))!;
  }
  const paidAt = (id: number) =>
    (db.query("SELECT paid_at FROM invoices WHERE id = ?").get(id) as any).paid_at;
  const status = (id: number) =>
    (db.query("SELECT status FROM invoices WHERE id = ?").get(id) as any).status;
  return { db, patchStatus, paidAt, status };
}

describe("#984: CSRF guard on cookie-authed API mutations", () => {
  async function patchWith(headers: Record<string, string>) {
    const { handleApi } = createApiRouter({
      getTenant: () => setupTenantOnly(),
      TOKEN: "test-token",
      authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e,
      verifyWebhookSignature: () => false,
      shareOrigin: () => "",
    });
    const req = new Request("http://localhost/api/invoices/1", {
      method: "PATCH",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ status: "paid" }),
    });
    return (await handleApi(req, new URL(req.url), "/api/invoices/1", "PATCH"))!;
  }
  function setupTenantOnly() {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE invoices (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft', paid_at TEXT)`);
    db.query("INSERT INTO invoices (id, status) VALUES (1, 'sent')").run();
    return {
      db,
      qRunning: stubStatement(), qOne: stubStatement(), qRange: stubStatement(),
      qInvoice: { get: (id: number) => db.query("SELECT id, status FROM invoices WHERE id = ?").get(id) } as unknown as Statement,
      qInvoices: stubStatement(),
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: (id: number) => ({ id, items: [], tax_rate: 0 }) as any,
      invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [], revenueOverdue: () => [],
      revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }),
      freezeInvoiceSnapshots: () => {},
    } as any;
  }

  test("cookie-authed mutation with a foreign Origin -> 403", async () => {
    const res = await patchWith({ origin: "https://evil.klectr.dev" });
    expect(res.status).toBe(403);
  });

  test("cookie-authed mutation with a matching Origin -> passes", async () => {
    const res = await patchWith({ origin: "http://localhost", host: "localhost" });
    expect(res.status).toBe(200);
  });

  test("cookie-authed mutation with no Origin -> passes (nothing to judge)", async () => {
    const res = await patchWith({});
    expect(res.status).toBe(200);
  });

  test("Bearer-authed mutation with a foreign Origin -> exempt, passes", async () => {
    const res = await patchWith({ origin: "https://evil.klectr.dev", authorization: "Bearer test-token" });
    expect(res.status).toBe(200);
  });

  test("an invalid Bearer does not buy an exemption (cookie path still guarded)", async () => {
    const res = await patchWith({ origin: "https://evil.klectr.dev", authorization: "Bearer wrong-token" });
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/invoices/:id paid_at", () => {
  test("marking paid stamps paid_at with today's date", async () => {
    const { patchStatus, paidAt, status } = setup();
    const res = await patchStatus(1, "paid");
    expect(res.status).toBe(200);
    expect(status(1)).toBe("paid");
    const today = new Date().toISOString().slice(0, 10);
    expect(paidAt(1)).toBe(today);
  });

  test("sent does not stamp paid_at, and records sent_at", async () => {
    const { db, patchStatus, paidAt, status } = setup() as any;
    const res = await patchStatus(2, "sent");
    expect(res.status).toBe(200);
    expect(status(2)).toBe("sent");
    expect(paidAt(2)).toBeNull();
    expect((db.query("SELECT sent_at FROM invoices WHERE id = 2").get() as any).sent_at).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe("GET /api/invoices list projection (#1279)", () => {
  test("exposes list fields and total, never internal notes, snapshots, Stripe id or public token", async () => {
    const row = {
      id: 7, client_id: 3, number: "INV-0007", issue_date: "2026-11-01",
      due_date: "2026-11-15", status: "sent", tax_rate: 10, paid_at: null, sent_at: "2026-11-02",
      period_from: "2026-11-07", period_to: "2026-11-20",
      notes: "client-facing", internal_notes: "do not leak",
      html_snapshot: "<html>frozen</html>", pdf_snapshot: new Uint8Array([1, 2, 3]),
      stripe_payment_link_id: "plink_secret", stripe_payment_link: "https://pay.example/x",
      public_token: "tok_secret", paid_via_stripe: 0, template: "modern",
      client_name: "Acme", client_color: "#fb923c", client_payment_terms: "Net 30",
      project_name: "Site", subtotal: 100,
    };
    const tenant = {
      db: new BunDatabase(":memory:"),
      qRunning: stubStatement(), qOne: stubStatement(), qRange: stubStatement(),
      qInvoice: stubStatement(),
      qInvoices: { all: () => [row, { ...row, id: 8, number: "INV-0008", sent_at: undefined, period_from: undefined, period_to: undefined }] } as unknown as Statement,
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: () => null, invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [],
      revenueOverdue: () => [], revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }), freezeInvoiceSnapshots: () => {},
    };
    const { handleApi } = createApiRouter({
      getTenant: () => tenant as any,
      TOKEN: ["test", "token"].join("-"),
      authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e,
      verifyWebhookSignature: () => false,
      shareOrigin: () => "",
    });
    const req = new Request("http://localhost/api/invoices");
    const res = (await handleApi(req, new URL(req.url), "/api/invoices", "GET"))!;
    expect(res.status).toBe(200);
    const [item, unsent] = await res.json() as any[];
    expect(unsent.sent_at).toBeNull();
    expect(unsent.period_from).toBeNull();
    expect(unsent.period_to).toBeNull();
    expect(item.period_from).toBe("2026-11-07");
    expect(item.period_to).toBe("2026-11-20");
    expect(item.id).toBe(7);
    expect(item.client_id).toBe(3);
    expect(item.number).toBe("INV-0007");
    expect(item.issue_date).toBe("2026-11-01");
    expect(item.due_date).toBe("2026-11-15");
    expect(item.status).toBe("sent");
    expect(item.tax_rate).toBe(10);
    expect(item.paid_at).toBeNull();
    expect(item.sent_at).toBe("2026-11-02");
    expect(item.client_name).toBe("Acme");
    expect(item.client_color).toBe("#fb923c");
    expect(item.client_payment_terms).toBe("Net 30");
    expect(item.project_name).toBe("Site");
    expect(item.subtotal).toBe(100);
    expect(item.total).toBe(110);
    for (const key of ["internal_notes", "html_snapshot", "pdf_snapshot", "stripe_payment_link_id", "stripe_payment_link", "public_token", "notes", "template"])
      expect(item).not.toHaveProperty(key);
    expect(JSON.stringify(item)).not.toContain("do not leak");
  });
});

describe("GET /api/revenue uses the one-pass snapshot (#1367)", () => {
  test("200 with the snapshot body; the four per-figure functions are never called", async () => {
    const snapshot = {
      totals: { invoiced: 12, paid: 5, outstanding: 7 },
      by_month: [{ month: "2026-11", label: "Nov", invoiced: 12, paid: 5 }],
      by_client: [{ client_id: 7, name: "Acme", color: null, invoiced: 12, paid: 5, outstanding: 7 }],
      overdue: [{ id: 1, number: "INV-0001", client_name: "Acme", total: 7, due_date: "2026-11-01", days_past_due: 3, bucket: "1-15" }],
    };
    let snapshotCalls = 0;
    const boom = () => { throw new Error("per-figure function called"); };
    const tenant = {
      db: new BunDatabase(":memory:"),
      qRunning: stubStatement(), qOne: stubStatement(), qRange: stubStatement(),
      qInvoice: stubStatement(), qInvoices: stubStatement(),
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: () => null, invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: boom, revenueMonthly: boom, revenueByClient: boom, revenueOverdue: boom,
      revenueSnapshot: () => { snapshotCalls++; return snapshot; },
      freezeInvoiceSnapshots: () => {},
    };
    const { handleApi } = createApiRouter({
      getTenant: () => tenant as any,
      TOKEN: "test-token",
      authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e,
      verifyWebhookSignature: () => false,
      shareOrigin: () => "",
    });
    const req = new Request("http://localhost/api/revenue");
    const res = (await handleApi(req, new URL(req.url), "/api/revenue", "GET"))!;
    expect(res.status).toBe(200);
    expect(snapshotCalls).toBe(1);
    expect(await res.json()).toEqual(snapshot);
  });
});

describe("invoice detail projection (#1281)", () => {
  const fullRow = () => ({
    id: 7, client_id: 3, number: "INV-0007", issue_date: "2026-11-01",
    due_date: "2026-11-15", status: "sent", tax_rate: 10, paid_at: null, sent_at: "2026-11-02",
    period_from: "2026-11-07", period_to: "2026-11-20",
    notes: "client-facing", internal_notes: "do not leak",
    html_snapshot: "<html>frozen</html>", pdf_snapshot: new Uint8Array([1, 2, 3]),
    stripe_payment_link_id: "plink_secret", stripe_payment_link: "https://pay.example/x",
    public_token: "tok_secret", paid_via_stripe: 0, template: "classic",
    created_at: "2026-11-01T00:00:00Z",
    client_name: "Acme", client_color: "#fb923c", client_payment_terms: "net_30",
    client_email: "a@example.com", client_phone: "555-0100",
    client_website: "https://example.com", client_address: "1 Main St",
    items: [{ id: 1, description: "Work", hours: 1, rate: 100, amount: 100, date_from: null, date_to: null }],
  });
  function detailTenant() {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE invoices (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft', paid_at TEXT)`);
    db.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, color TEXT, rate REAL)`);
    db.query("INSERT INTO clients (id, name) VALUES (3, 'Acme')").run();
    db.query("INSERT INTO invoices (id, status) VALUES (7, 'sent')").run();
    return {
      db,
      qRunning: stubStatement(), qOne: stubStatement(), qRange: stubStatement(),
      qInvoice: { get: (id: number) => db.query("SELECT id, status FROM invoices WHERE id = ?").get(id) } as unknown as Statement,
      qInvoices: stubStatement(),
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: () => fullRow() as any,
      invoiceTotals: (items: any[], taxRate: number) => {
        const subtotal = items.reduce((a: number, it: any) => a + it.amount, 0);
        return { subtotal, tax: Math.round(subtotal * taxRate) / 100, total: Math.round(subtotal * (100 + taxRate)) / 100 };
      },
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [],
      revenueOverdue: () => [], revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }), freezeInvoiceSnapshots: () => {},
    };
  }
  function routerFor(tenant: any) {
    return createApiRouter({
      getTenant: () => tenant as any,
      TOKEN: "test-token",
      authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e,
      verifyWebhookSignature: () => false,
      shareOrigin: () => "",
    }).handleApi;
  }
  test("GET detail keeps items, notes and client contact, drops secrets and snapshots", async () => {
    const handleApi = routerFor(detailTenant());
    const req = new Request("http://localhost/api/invoices/7");
    const res = (await handleApi(req, new URL(req.url), "/api/invoices/7", "GET"))!;
    expect(res.status).toBe(200);
    const item = await res.json() as any;
    expect(item.number).toBe("INV-0007");
    expect(item.notes).toBe("client-facing");
    expect(item.client_email).toBe("a@example.com");
    expect(item.client_address).toBe("1 Main St");
    expect(item.items).toHaveLength(1);
    expect(item.sent_at).toBe("2026-11-02");
    expect(item.period_from).toBe("2026-11-07");
    expect(item.period_to).toBe("2026-11-20");
    expect(item.template).toBe("classic");
    expect(item.paid_via_stripe).toBe(0);
    expect(item.subtotal).toBe(100);
    expect(item.total).toBe(110);
    for (const key of ["internal_notes", "html_snapshot", "pdf_snapshot", "stripe_payment_link_id", "stripe_payment_link", "public_token"])
      expect(item).not.toHaveProperty(key);
    expect(JSON.stringify(item)).not.toContain("do not leak");
    expect(JSON.stringify(item)).not.toContain("tok_secret");
    expect(JSON.stringify(item)).not.toContain("plink_secret");
  });
  test("PATCH detail uses the same projection", async () => {
    const handleApi = routerFor(detailTenant());
    const req = new Request("http://localhost/api/invoices/7", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "paid" }),
    });
    const res = (await handleApi(req, new URL(req.url), "/api/invoices/7", "PATCH"))!;
    expect(res.status).toBe(200);
    const item = await res.json() as any;
    for (const key of ["internal_notes", "html_snapshot", "pdf_snapshot", "stripe_payment_link_id", "stripe_payment_link", "public_token"])
      expect(item).not.toHaveProperty(key);
  });
  test("POST response uses the same projection", async () => {
    const tenant = detailTenant();
    tenant.db.exec(`CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, description TEXT, hours REAL, rate REAL, amount REAL, date_from TEXT, date_to TEXT)`);
    tenant.db.exec(`CREATE TABLE time_entries (id INTEGER PRIMARY KEY, invoice_id INTEGER)`);
    tenant.db.exec(`ALTER TABLE invoices ADD COLUMN client_id INTEGER`);
    tenant.db.exec(`ALTER TABLE invoices ADD COLUMN number TEXT`);
    tenant.db.exec(`ALTER TABLE invoices ADD COLUMN issue_date TEXT`);
    tenant.db.exec(`ALTER TABLE invoices ADD COLUMN due_date TEXT`);
    tenant.db.exec(`ALTER TABLE invoices ADD COLUMN tax_rate REAL DEFAULT 0`);
    tenant.db.exec(`ALTER TABLE invoices ADD COLUMN notes TEXT DEFAULT ''`);
    tenant.db.exec(`ALTER TABLE invoices ADD COLUMN internal_notes TEXT DEFAULT ''`);
    tenant.db.exec(`ALTER TABLE invoices ADD COLUMN period_from TEXT`);
    tenant.db.exec(`ALTER TABLE invoices ADD COLUMN period_to TEXT`);
    const handleApi = routerFor(tenant);
    const req = new Request("http://localhost/api/invoices", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ client_id: 3, items: [{ description: "Work", hours: 1, rate: 100 }] }),
    });
    const res = (await handleApi(req, new URL(req.url), "/api/invoices", "POST"))!;
    expect(res.status).toBe(201);
    const item = await res.json() as any;
    expect(item.number).toBe("INV-0007");
    for (const key of ["internal_notes", "html_snapshot", "pdf_snapshot", "stripe_payment_link_id", "stripe_payment_link", "public_token"])
      expect(item).not.toHaveProperty(key);
    expect(JSON.stringify(item)).not.toContain("tok_secret");
  });
  function periodTenant() {
    const tenant = detailTenant();
    tenant.db.exec(`CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, description TEXT, hours REAL, rate REAL, amount REAL, date_from TEXT, date_to TEXT)`);
    tenant.db.exec(`CREATE TABLE time_entries (id INTEGER PRIMARY KEY, invoice_id INTEGER)`);
    for (const col of ["client_id INTEGER", "number TEXT", "issue_date TEXT", "due_date TEXT",
      "tax_rate REAL DEFAULT 0", "notes TEXT DEFAULT ''", "internal_notes TEXT DEFAULT ''",
      "period_from TEXT", "period_to TEXT"])
      tenant.db.exec(`ALTER TABLE invoices ADD COLUMN ${col}`);
    (tenant as any).unbilledEntries = () => [{ id: 1 }];
    (tenant as any).groupToLineItems = () => [{ description: "Work", hours: 2, rate: 50, entry_ids: [1] }];
    return tenant;
  }
  async function postPeriod(tenant: any, body: unknown) {
    const handleApi = routerFor(tenant);
    const req = new Request("http://localhost/api/invoices", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = (await handleApi(req, new URL(req.url), "/api/invoices", "POST"))!;
    expect(res.status).toBe(201);
    return tenant.db.query("SELECT period_from, period_to FROM invoices WHERE id != 7").get() as any;
  }
  test("POST stores a valid ordered from/to as the billing period (#1429)", async () => {
    const row = await postPeriod(periodTenant(), { client_id: 3, from: "2026-11-07", to: "2026-11-20" });
    expect(row).toEqual({ period_from: "2026-11-07", period_to: "2026-11-20" });
  });
  test("POST stores NULL period for a reversed from/to (#1429)", async () => {
    const row = await postPeriod(periodTenant(), { client_id: 3, items: [{ description: "Work", hours: 1, rate: 100 }], from: "2026-11-20", to: "2026-11-07" });
    expect(row).toEqual({ period_from: null, period_to: null });
  });
  test("POST stores NULL period for a malformed or impossible from/to (#1429)", async () => {
    const malformed = await postPeriod(periodTenant(), { client_id: 3, items: [{ description: "Work", hours: 1, rate: 100 }], from: "11/07/2026", to: "2026-11-20" });
    expect(malformed).toEqual({ period_from: null, period_to: null });
    const impossible = await postPeriod(periodTenant(), { client_id: 3, items: [{ description: "Work", hours: 1, rate: 100 }], from: "2026-02-30", to: "2026-13-01" });
    expect(impossible).toEqual({ period_from: null, period_to: null });
  });
  test("POST with items[] stores a valid from/to as the period too (#1429)", async () => {
    const row = await postPeriod(periodTenant(), { client_id: 3, items: [{ description: "Work", hours: 1, rate: 100 }], from: "2026-11-07", to: "2026-11-20" });
    expect(row).toEqual({ period_from: "2026-11-07", period_to: "2026-11-20" });
  });
});

describe("POST /api/invoices date validation (#1436)", () => {
  function dateTenant() {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE invoices (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft', paid_at TEXT)`);
    db.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, color TEXT, rate REAL)`);
    db.query("INSERT INTO clients (id, name) VALUES (3, 'Acme')").run();
    db.exec(`CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, description TEXT, hours REAL, rate REAL, amount REAL, date_from TEXT, date_to TEXT)`);
    db.exec(`CREATE TABLE time_entries (id INTEGER PRIMARY KEY, invoice_id INTEGER)`);
    for (const col of ["client_id INTEGER", "number TEXT", "issue_date TEXT", "due_date TEXT",
      "tax_rate REAL DEFAULT 0", "notes TEXT DEFAULT ''", "internal_notes TEXT DEFAULT ''",
      "period_from TEXT", "period_to TEXT"])
      db.exec(`ALTER TABLE invoices ADD COLUMN ${col}`);
    return {
      db,
      qRunning: stubStatement(), qOne: stubStatement(), qRange: stubStatement(),
      qInvoice: { get: (id: number) => db.query("SELECT id, status FROM invoices WHERE id = ?").get(id) } as unknown as Statement,
      qInvoices: stubStatement(),
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: (id: number) => db.query("SELECT * FROM invoices WHERE id = ?").get(id) as any,
      invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [],
      revenueOverdue: () => [], revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }), freezeInvoiceSnapshots: () => {},
    };
  }
  function routerFor(tenant: any) {
    return createApiRouter({
      getTenant: () => tenant as any,
      TOKEN: "test-token",
      authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e,
      verifyWebhookSignature: () => false,
      shareOrigin: () => "",
    }).handleApi;
  }
  async function post(tenant: any, body: unknown) {
    const handleApi = routerFor(tenant);
    const req = new Request("http://localhost/api/invoices", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await handleApi(req, new URL(req.url), "/api/invoices", "POST"))!;
  }
  const item = { description: "Work", hours: 1, rate: 100 };
  test("valid issue_date/due_date are stored verbatim", async () => {
    const tenant = dateTenant();
    const res = await post(tenant, { client_id: 3, items: [item], issue_date: "2026-11-01", due_date: "2026-11-15" });
    expect(res.status).toBe(201);
    const row = tenant.db.query("SELECT issue_date, due_date FROM invoices").get() as any;
    expect(row).toEqual({ issue_date: "2026-11-01", due_date: "2026-11-15" });
  });
  test("an impossible issue_date is a 400 and creates nothing", async () => {
    const tenant = dateTenant();
    const res = await post(tenant, { client_id: 3, items: [item], issue_date: "2026-02-30" });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("issue_date");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
  });
  test("a malformed or impossible due_date is a 400 and creates nothing", async () => {
    for (const due_date of ["11/15/2026", "2026-13-01"]) {
      const tenant = dateTenant();
      const res = await post(tenant, { client_id: 3, items: [item], due_date });
      expect(res.status).toBe(400);
      expect((await res.json() as any).error).toContain("due_date");
      expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
    }
  });
  test("absent issue_date defaults to today and absent due_date stays null", async () => {
    const tenant = dateTenant();
    const res = await post(tenant, { client_id: 3, items: [item] });
    expect(res.status).toBe(201);
    const row = tenant.db.query("SELECT issue_date, due_date FROM invoices").get() as any;
    expect(row.issue_date).toBe(todayStr());
    expect(row.due_date).toBeNull();
  });
  test("valid per-item date_from/date_to are stored", async () => {
    const tenant = dateTenant();
    const res = await post(tenant, { client_id: 3, items: [{ ...item, date_from: "2026-11-07", date_to: "2026-11-20" }] });
    expect(res.status).toBe(201);
    const row = tenant.db.query("SELECT date_from, date_to FROM invoice_items").get() as any;
    expect(row).toEqual({ date_from: "2026-11-07", date_to: "2026-11-20" });
  });
  test("an impossible per-item date is a 400 and creates nothing", async () => {
    const tenant = dateTenant();
    const res = await post(tenant, { client_id: 3, items: [{ ...item, date_from: "2026-02-30" }] });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("date_from");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
  });
  test("a dropped zero-hour row's bad date is not validated", async () => {
    const tenant = dateTenant();
    const res = await post(tenant, { client_id: 3, items: [{ description: "Placeholder", hours: 0, rate: 100, date_from: "2026-02-30" }, item] });
    expect(res.status).toBe(201);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoice_items").get() as any).n).toBe(1);
  });
});

describe("API rate validation (#1440)", () => {
  function rateTenant() {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, color TEXT, rate REAL)`);
    /* Seed name is not 'Acme': the client-create tests below post that name. */
    db.query("INSERT INTO clients (id, name) VALUES (3, 'Seed Co')").run();
    db.exec(`CREATE TABLE invoices (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft', paid_at TEXT)`);
    db.exec(`CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, description TEXT, hours REAL, rate REAL, amount REAL, date_from TEXT, date_to TEXT)`);
    db.exec(`CREATE TABLE time_entries (id INTEGER PRIMARY KEY, invoice_id INTEGER)`);
    for (const col of ["client_id INTEGER", "number TEXT", "issue_date TEXT", "due_date TEXT",
      "tax_rate REAL DEFAULT 0", "notes TEXT DEFAULT ''", "internal_notes TEXT DEFAULT ''",
      "period_from TEXT", "period_to TEXT"])
      db.exec(`ALTER TABLE invoices ADD COLUMN ${col}`);
    return {
      db,
      qRunning: stubStatement(), qOne: stubStatement(), qRange: stubStatement(),
      qInvoice: { get: (id: number) => db.query("SELECT id, status FROM invoices WHERE id = ?").get(id) } as unknown as Statement,
      qInvoices: stubStatement(),
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: (id: number) => db.query("SELECT * FROM invoices WHERE id = ?").get(id) as any,
      invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [],
      revenueOverdue: () => [], revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }), freezeInvoiceSnapshots: () => {},
    };
  }
  function routerFor(tenant: any) {
    return createApiRouter({
      getTenant: () => tenant as any,
      TOKEN: "test-token",
      authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e,
      verifyWebhookSignature: () => false,
      shareOrigin: () => "",
    }).handleApi;
  }
  async function post(tenant: any, path: string, body: unknown) {
    const handleApi = routerFor(tenant);
    const req = new Request(`http://localhost${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await handleApi(req, new URL(req.url), path, "POST"))!;
  }
  const item = { description: "Work", hours: 1, rate: 100 };
  test("nonNegativeRate: absent and blank mean 0, valid values pass, negative and garbage fail", () => {
    expect(nonNegativeRate(undefined)).toBe(0);
    expect(nonNegativeRate(null)).toBe(0);
    expect(nonNegativeRate("")).toBe(0);
    expect(nonNegativeRate(40)).toBe(40);
    expect(nonNegativeRate("12.5")).toBe(12.5);
    expect(nonNegativeRate(-1)).toBeNull();
    expect(nonNegativeRate("abc")).toBeNull();
    expect(nonNegativeRate(true)).toBeNull();
    expect(nonNegativeRate([50])).toBeNull();
    expect(nonNegativeRate({})).toBeNull();
  });
  test("POST /api/clients with a boolean rate is a 400 and creates nothing", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/clients", { name: "Acme", rate: true });
    expect(res.status).toBe(400);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n).toBe(1);
  });
  test("POST /api/invoices with a rate too large to round is a 400 and creates nothing", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/invoices", { client_id: 3, items: [{ ...item, rate: 1e307 }] });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("rate");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoice_items").get() as any).n).toBe(0);
  });
  test("POST /api/invoices with hours too large to round is a 400 and creates nothing (#1446)", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/invoices", { client_id: 3, items: [{ ...item, hours: 1e308 }] });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("hours");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoice_items").get() as any).n).toBe(0);
  });
  test("POST /api/invoices with hours x rate overflowing the amount is a 400 and creates nothing (#1446)", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/invoices", { client_id: 3, items: [{ ...item, hours: 1e200, rate: 1e200 }] });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("amount");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoice_items").get() as any).n).toBe(0);
  });
  test("POST /api/invoices with a tax_rate too large to round is a 400 and creates nothing (#1448)", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/invoices", { client_id: 3, tax_rate: 1e308, items: [item] });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("tax_rate");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoice_items").get() as any).n).toBe(0);
  });
  test("POST /api/invoices whose rows sum past the finite range is a 400 and creates nothing (#1448)", async () => {
    const tenant = rateTenant();
    const big = { description: "Work", hours: 1.7e306, rate: 1 };
    const res = await post(tenant, "/api/invoices", { client_id: 3, items: [big, big] });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("total");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoice_items").get() as any).n).toBe(0);
  });
  test("POST /api/invoices whose tax overflows the total is a 400 and creates nothing (#1448)", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/invoices", { client_id: 3, tax_rate: 1e305, items: [{ ...item, rate: 1e6 }] });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("total");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoice_items").get() as any).n).toBe(0);
  });
  test("POST /api/invoices from/to path stores grouped items at the validated rate", async () => {
    const tenant = rateTenant();
    (tenant as any).unbilledEntries = () => [{ id: 1 }];
    (tenant as any).groupToLineItems = (_groups: any[], rate: number) => [{ description: "Work", hours: 2, rate, entry_ids: [1] }];
    const res = await post(tenant, "/api/invoices", { client_id: 3, from: "2026-11-07", to: "2026-11-20", rate: 50 });
    expect(res.status).toBe(201);
    const row = tenant.db.query("SELECT rate, amount FROM invoice_items").get() as any;
    expect(row).toEqual({ rate: 50, amount: 100 });
  });
  test("POST /api/invoices from/to path rejects an impossible or malformed range (#1492)", async () => {
    for (const range of [{ from: "2026-02-30", to: "2026-03-01" }, { from: "2026-11-07", to: "11/20/2026" }]) {
      const tenant = rateTenant();
      (tenant as any).unbilledEntries = () => [{ id: 1 }];
      (tenant as any).groupToLineItems = (_groups: any[], rate: number) => [{ description: "Work", hours: 2, rate, entry_ids: [1] }];
      const res = await post(tenant, "/api/invoices", { client_id: 3, ...range, rate: 50 });
      expect(res.status).toBe(400);
      expect((await res.json() as any).error).toContain("from/to");
      expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
    }
  });
  test("POST /api/invoices from/to path rejects a reversed range (#1492)", async () => {
    const tenant = rateTenant();
    (tenant as any).unbilledEntries = () => [{ id: 1 }];
    (tenant as any).groupToLineItems = (_groups: any[], rate: number) => [{ description: "Work", hours: 2, rate, entry_ids: [1] }];
    const res = await post(tenant, "/api/invoices", { client_id: 3, from: "2026-11-20", to: "2026-11-07", rate: 50 });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("from");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
  });
  test("POST /api/clients with a negative rate is a 400 and creates nothing", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/clients", { name: "Acme", rate: -50 });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("rate");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n).toBe(1);
  });
  test("POST /api/clients stores a valid rate and defaults an absent one to 0", async () => {
    const tenant = rateTenant();
    const ok = await post(tenant, "/api/clients", { name: "Acme", rate: 40 });
    expect(ok.status).toBe(201);
    expect((await ok.json() as any).rate).toBe(40);
    const bare = await post(tenant, "/api/clients", { name: "Beta" });
    expect(bare.status).toBe(201);
    expect((await bare.json() as any).rate).toBe(0);
  });
  test("POST /api/invoices with a negative tax_rate is a 400 and creates nothing", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/invoices", { client_id: 3, items: [item], tax_rate: -5 });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("tax_rate");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
  });
  test("POST /api/invoices stores a valid tax_rate", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/invoices", { client_id: 3, items: [item], tax_rate: 10 });
    expect(res.status).toBe(201);
    expect((tenant.db.query("SELECT tax_rate FROM invoices").get() as any).tax_rate).toBe(10);
  });
  test("POST /api/invoices with a negative item rate is a 400 and creates nothing", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/invoices", { client_id: 3, items: [{ ...item, rate: -100 }] });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("rate");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
  });
  test("a dropped zero-hour row's negative rate is not validated", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/invoices", { client_id: 3, items: [{ description: "Placeholder", hours: 0, rate: -100 }, item] });
    expect(res.status).toBe(201);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoice_items").get() as any).n).toBe(1);
  });
  test("POST /api/invoices with a negative from/to rate is a 400 and creates nothing", async () => {
    const tenant = rateTenant();
    const res = await post(tenant, "/api/invoices", { client_id: 3, from: "2026-11-07", to: "2026-11-20", rate: -50 });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toContain("rate");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
  });
});

describe("API name validation (#1456)", () => {
  function nameTenant() {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, color TEXT, rate REAL)`);
    db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, client_id INTEGER)`);
    return {
      db,
      qRunning: stubStatement(), qOne: stubStatement(), qRange: stubStatement(),
      qInvoice: stubStatement(), qInvoices: stubStatement(),
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: () => null,
      invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [],
      revenueOverdue: () => [], revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }), freezeInvoiceSnapshots: () => {},
    };
  }
  async function post(tenant: any, path: string, body: unknown) {
    const handleApi = createApiRouter({
      getTenant: () => tenant as any,
      TOKEN: ["test", "token"].join("-"),
      authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e,
      verifyWebhookSignature: () => false,
      shareOrigin: () => "",
    }).handleApi;
    const req = new Request(`http://localhost${path}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await handleApi(req, new URL(req.url), path, "POST"))!;
  }
  test("POST /api/clients with a whitespace-only name is a 400 and creates nothing", async () => {
    const tenant = nameTenant();
    const res = await post(tenant, "/api/clients", { name: "   " });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("name required");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n).toBe(0);
  });
  test("POST /api/clients stores a padded name trimmed", async () => {
    const tenant = nameTenant();
    const res = await post(tenant, "/api/clients", { name: "  Acme  " });
    expect(res.status).toBe(201);
    expect((await res.json() as any).name).toBe("Acme");
    expect((tenant.db.query("SELECT name FROM clients").get() as any).name).toBe("Acme");
  });
  test("POST /api/projects with a whitespace-only name is a 400 and creates nothing", async () => {
    const tenant = nameTenant();
    const res = await post(tenant, "/api/projects", { name: " \t " });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("name required");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM projects").get() as any).n).toBe(0);
  });
  test("POST /api/projects stores a padded name trimmed", async () => {
    const tenant = nameTenant();
    const res = await post(tenant, "/api/projects", { name: "  Website  " });
    expect(res.status).toBe(201);
    expect((await res.json() as any).name).toBe("Website");
    expect((tenant.db.query("SELECT name FROM projects").get() as any).name).toBe("Website");
  });
  test("POST /api/clients with a missing or non-string name is a 400 and creates nothing", async () => {
    const tenant = nameTenant();
    expect((await post(tenant, "/api/clients", {})).status).toBe(400);
    expect((await post(tenant, "/api/clients", { name: 123 })).status).toBe(400);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n).toBe(0);
  });
  test("POST /api/projects with a missing or non-string name is a 400 and creates nothing", async () => {
    const tenant = nameTenant();
    expect((await post(tenant, "/api/projects", {})).status).toBe(400);
    expect((await post(tenant, "/api/projects", { name: 123 })).status).toBe(400);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM projects").get() as any).n).toBe(0);
  });
  test("POST /api/projects with a non-existent client_id is a 400 and creates nothing", async () => {
    const tenant = nameTenant();
    const res = await post(tenant, "/api/projects", { name: "Website", client_id: 999 });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("client_id not found");
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM projects").get() as any).n).toBe(0);
  });
  test("POST /api/projects with a non-numeric or fractional client_id is a 400 and creates nothing", async () => {
    const tenant = nameTenant();
    for (const bad of ["abc", 1.5, -2, true, 0, "0", false]) {
      expect((await post(tenant, "/api/projects", { name: "Website", client_id: bad })).status).toBe(400);
    }
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM projects").get() as any).n).toBe(0);
  });
  test("POST /api/projects with an empty client_id stores no client", async () => {
    const tenant = nameTenant();
    for (const empty of ["", null]) {
      const res = await post(tenant, "/api/projects", { name: "Website", client_id: empty });
      expect(res.status).toBe(201);
      expect((await res.json() as any).client_id).toBeNull();
    }
  });
  test("POST /api/projects with an existing client_id stores it; absent stores null", async () => {
    const tenant = nameTenant();
    tenant.db.query("INSERT INTO clients (name) VALUES ('Acme')").run();
    const res = await post(tenant, "/api/projects", { name: "Website", client_id: 1 });
    expect(res.status).toBe(201);
    expect((await res.json() as any).client_id).toBe(1);
    const bare = await post(tenant, "/api/projects", { name: "Loose" });
    expect(bare.status).toBe(201);
    expect((await bare.json() as any).client_id).toBeNull();
  });
});

/** Dates stamped on an action are the user's local day when the client
 *  sends one (client_day), else the UTC day. */
describe("PATCH /api/invoices/:id honours client_day", () => {
  const utc = () => new Date().toISOString().slice(0, 10);
  const yesterdayUtc = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  test("a valid client_day is stored as sent_at / paid_at", async () => {
    const { db, patchStatus } = setup() as any;
    await patchStatus(2, "sent", { client_day: yesterdayUtc() });
    expect((db.query("SELECT sent_at FROM invoices WHERE id = 2").get() as any).sent_at).toBe(yesterdayUtc());
    await patchStatus(1, "paid", { client_day: yesterdayUtc() });
    expect((db.query("SELECT paid_at FROM invoices WHERE id = 1").get() as any).paid_at).toBe(yesterdayUtc());
  });
  test("a malformed or far-off client_day falls back to the UTC day", async () => {
    const { db, patchStatus } = setup() as any;
    await patchStatus(2, "sent", { client_day: "2020-01-01" });
    expect((db.query("SELECT sent_at FROM invoices WHERE id = 2").get() as any).sent_at).toBe(utc());
    await patchStatus(1, "paid", { client_day: "not-a-date" });
    expect((db.query("SELECT paid_at FROM invoices WHERE id = 1").get() as any).paid_at).toBe(utc());
  });
});

describe("PATCH /api/entries/:id timestamp normalization (#1432)", () => {
  function entrySetup() {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE time_entries (
      id INTEGER PRIMARY KEY, project_id INTEGER, description TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL, end_time TEXT, invoice_id INTEGER)`);
    db.query("INSERT INTO time_entries (id, project_id, description, start_time, end_time) VALUES (1, NULL, 'Work', '2026-10-07T14:00:00.000Z', '2026-10-07T15:00:00.000Z')").run();
    const qOne = {
      get: (id: number) => {
        const r = db.query("SELECT * FROM time_entries WHERE id = ?").get(id) as any;
        return r ? { ...r, invoice_status: null } : null;
      },
    } as unknown as Statement;
    const tenant = {
      db, qRunning: stubStatement(), qOne, qRange: stubStatement(),
      qInvoice: stubStatement(), qInvoices: stubStatement(),
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: () => null, invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [], revenueOverdue: () => [],
      revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }),
      freezeInvoiceSnapshots: () => {},
    };
    const { handleApi } = createApiRouter({
      getTenant: () => tenant as any, TOKEN: "test-token", authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e, verifyWebhookSignature: () => false, shareOrigin: () => "",
    });
    async function patch(body: Record<string, unknown>) {
      const req = new Request("http://localhost/api/entries/1", {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      return (await handleApi(req, new URL(req.url), "/api/entries/1", "PATCH"))!;
    }
    const row = () => db.query("SELECT start_time, end_time FROM time_entries WHERE id = 1").get() as any;
    return { patch, row };
  }

  test("offset and microsecond timestamps are stored as canonical toISOString()", async () => {
    const { patch, row } = entrySetup();
    const res = await patch({ start_time: "2026-10-07T16:00:00.123456+02:00", end_time: "2026-10-07T17:00:00+02:00" });
    expect(res.status).toBe(200);
    expect(row()).toEqual({ start_time: "2026-10-07T14:00:00.123Z", end_time: "2026-10-07T15:00:00.000Z" });
  });

  test("a naive start_time is 400 and saves nothing", async () => {
    const { patch, row } = entrySetup();
    const res = await patch({ start_time: "2026-10-07T16:00" });
    expect(res.status).toBe(400);
    expect(row().start_time).toBe("2026-10-07T14:00:00.000Z");
  });

  test("a naive end_time is 400 and saves nothing", async () => {
    const { patch, row } = entrySetup();
    const res = await patch({ end_time: "2026-10-07T17:00:00" });
    expect(res.status).toBe(400);
    expect(row().end_time).toBe("2026-10-07T15:00:00.000Z");
  });

  test("an unparseable timestamp is 400 and saves nothing", async () => {
    const { patch, row } = entrySetup();
    const res = await patch({ start_time: "2026-13-40T16:00:00Z" });
    expect(res.status).toBe(400);
    expect(row().start_time).toBe("2026-10-07T14:00:00.000Z");
  });

  test("non-ISO strings, impossible dates and falsy values are 400 and save nothing", async () => {
    const { patch, row } = entrySetup();
    for (const bad of ["October 7, 2026Z", "2026-10-07Z", "2026-02-30T16:00:00Z", "2026-10-07T16:00:00z", "", null, 0, ["2026-10-07T16:00:00Z"]]) {
      const res = await patch({ start_time: bad });
      expect(res.status).toBe(400);
      expect(row().start_time).toBe("2026-10-07T14:00:00.000Z");
    }
    for (const bad of ["", 0, false]) {
      const res = await patch({ end_time: bad });
      expect(res.status).toBe(400);
      expect(row().end_time).toBe("2026-10-07T15:00:00.000Z");
    }
  });

  test("a colon-less offset is accepted and normalized", async () => {
    const { patch, row } = entrySetup();
    const res = await patch({ start_time: "2026-10-07T16:00:00+0200" });
    expect(res.status).toBe(200);
    expect(row().start_time).toBe("2026-10-07T14:00:00.000Z");
  });

  test("omitted timestamps keep the stored values; explicit null end_time clears it", async () => {
    const { patch, row } = entrySetup();
    let res = await patch({ description: "Renamed" });
    expect(res.status).toBe(200);
    expect(row()).toEqual({ start_time: "2026-10-07T14:00:00.000Z", end_time: "2026-10-07T15:00:00.000Z" });
    res = await patch({ end_time: null });
    expect(res.status).toBe(200);
    expect(row().end_time).toBeNull();
  });

  test("an end_time before the start_time is 400 and saves nothing (#1450)", async () => {
    const { patch, row } = entrySetup();
    const res = await patch({ start_time: "2026-10-07T14:00:00.000Z", end_time: "2026-10-07T13:00:00.000Z" });
    expect(res.status).toBe(400);
    expect(row()).toEqual({ start_time: "2026-10-07T14:00:00.000Z", end_time: "2026-10-07T15:00:00.000Z" });
  });

  test("an end_time equal to the start_time is 400 and saves nothing (#1450)", async () => {
    const { patch, row } = entrySetup();
    const res = await patch({ end_time: "2026-10-07T14:00:00.000Z" });
    expect(res.status).toBe(400);
    expect(row().end_time).toBe("2026-10-07T15:00:00.000Z");
  });

  test("an end_time patched before the stored start_time is 400 (#1450)", async () => {
    const { patch, row } = entrySetup();
    const res = await patch({ end_time: "2026-10-07T13:59:00.000Z" });
    expect(res.status).toBe(400);
    expect(row().end_time).toBe("2026-10-07T15:00:00.000Z");
  });

  test("a start_time patched after the stored end_time is 400 (#1450)", async () => {
    const { patch, row } = entrySetup();
    const res = await patch({ start_time: "2026-10-07T15:01:00.000Z" });
    expect(res.status).toBe(400);
    expect(row().start_time).toBe("2026-10-07T14:00:00.000Z");
  });

  test("a valid ordered pair still saves (#1450)", async () => {
    const { patch, row } = entrySetup();
    const res = await patch({ start_time: "2026-10-07T14:00:00.000Z", end_time: "2026-10-07T14:01:00.000Z" });
    expect(res.status).toBe(200);
    expect(row()).toEqual({ start_time: "2026-10-07T14:00:00.000Z", end_time: "2026-10-07T14:01:00.000Z" });
  });
});

describe("timer stop end time (#1452)", () => {
  test("stopEndTime returns about now for a past start", () => {
    const before = Date.now();
    const end = new Date(stopEndTime("2026-10-07T14:00:00.000Z")).getTime();
    expect(end).toBeGreaterThanOrEqual(before);
    expect(end).toBeLessThanOrEqual(Date.now());
  });

  test("stopEndTime clamps a future start to start + 1s", () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    expect(stopEndTime(future)).toBe(new Date(new Date(future).getTime() + 1000).toISOString());
  });

  test("POST /api/timer/stop never stores an end at or before the start", async () => {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE time_entries (
      id INTEGER PRIMARY KEY, project_id INTEGER, description TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL, end_time TEXT, invoice_id INTEGER)`);
    const future = new Date(Date.now() + 3600_000).toISOString();
    db.query("INSERT INTO time_entries (id, project_id, description, start_time, end_time) VALUES (1, NULL, 'Work', ?, NULL)").run(future);
    const row = () => db.query("SELECT * FROM time_entries WHERE id = 1").get() as any;
    const q = { get: () => { const r = row(); return r ? { ...r, invoice_status: null } : null; } } as unknown as Statement;
    const tenant = {
      db, qRunning: q, qOne: q, qRange: stubStatement(),
      qInvoice: stubStatement(), qInvoices: stubStatement(),
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: () => null, invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [], revenueOverdue: () => [],
      revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }),
      freezeInvoiceSnapshots: () => {},
    };
    const { handleApi } = createApiRouter({
      getTenant: () => tenant as any, TOKEN: "test-token", authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e, verifyWebhookSignature: () => false, shareOrigin: () => "",
    });
    const req = new Request("http://localhost/api/timer/stop", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const res = (await handleApi(req, new URL(req.url), "/api/timer/stop", "POST"))!;
    expect(res.status).toBe(200);
    expect(row().end_time).toBe(new Date(new Date(future).getTime() + 1000).toISOString());
  });
});

describe("API entry project_id validation (#1458)", () => {
  function entryTenant() {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, client_id INTEGER)`);
    db.exec(`CREATE TABLE time_entries (
      id INTEGER PRIMARY KEY, project_id INTEGER, description TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL, end_time TEXT, invoice_id INTEGER)`);
    db.query("INSERT INTO projects (id, name, client_id) VALUES (1, 'Website', NULL)").run();
    db.query("INSERT INTO time_entries (id, project_id, description, start_time, end_time) VALUES (1, NULL, 'Work', '2026-10-07T14:00:00.000Z', '2026-10-07T15:00:00.000Z')").run();
    const withStatus = (r: any) => r ? { ...r, invoice_status: null } : null;
    const qOne = { get: (id: number) => withStatus(db.query("SELECT * FROM time_entries WHERE id = ?").get(id)) } as unknown as Statement;
    const qRunning = { get: () => withStatus(db.query("SELECT * FROM time_entries WHERE end_time IS NULL ORDER BY start_time DESC LIMIT 1").get()) } as unknown as Statement;
    const tenant = {
      db, qRunning, qOne, qRange: stubStatement(),
      qInvoice: stubStatement(), qInvoices: stubStatement(),
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: () => null, invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [], revenueOverdue: () => [],
      revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }),
      freezeInvoiceSnapshots: () => {},
    };
    const { handleApi } = createApiRouter({
      getTenant: () => tenant as any, TOKEN: "test-token", authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e, verifyWebhookSignature: () => false, shareOrigin: () => "",
    });
    async function call(method: string, path: string, body: unknown) {
      const req = new Request(`http://localhost${path}`, {
        method, headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      return (await handleApi(req, new URL(req.url), path, method))!;
    }
    const count = () => (db.query("SELECT COUNT(*) AS n FROM time_entries").get() as any).n;
    const projectOf = (id: number) => (db.query("SELECT project_id FROM time_entries WHERE id = ?").get(id) as any)?.project_id;
    return { call, count, projectOf };
  }

  test("POST /api/timer/start with a non-existent project_id is a 400 and creates nothing", async () => {
    const { call, count } = entryTenant();
    const res = await call("POST", "/api/timer/start", { project_id: 999, description: "x" });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("project_id not found");
    expect(count()).toBe(1);
  });

  test("POST /api/timer/start with a non-numeric or fractional project_id is a 400 and creates nothing", async () => {
    const { call, count } = entryTenant();
    for (const bad of ["abc", 1.5, -2, true, [1], { id: 1 }]) {
      const res = await call("POST", "/api/timer/start", { project_id: bad, description: "x" });
      expect(res.status).toBe(400);
    }
    expect(count()).toBe(1);
  });

  test("POST /api/timer/start with an existing project_id stores it", async () => {
    const { call, projectOf } = entryTenant();
    const res = await call("POST", "/api/timer/start", { project_id: 1, description: "x" });
    expect(res.status).toBe(201);
    expect(projectOf(2)).toBe(1);
  });

  test("PATCH /api/entries/:id with a non-existent project_id is a 400 and saves nothing", async () => {
    const { call, projectOf } = entryTenant();
    const res = await call("PATCH", "/api/entries/1", { project_id: 999 });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("project_id not found");
    expect(projectOf(1)).toBeNull();
  });

  test("PATCH /api/entries/:id with a non-numeric project_id is a 400 and saves nothing", async () => {
    const { call, projectOf } = entryTenant();
    const res = await call("PATCH", "/api/entries/1", { project_id: "abc" });
    expect(res.status).toBe(400);
    expect(projectOf(1)).toBeNull();
  });

  test("PATCH /api/entries/:id with an existing project_id stores it; null clears it", async () => {
    const { call, projectOf } = entryTenant();
    let res = await call("PATCH", "/api/entries/1", { project_id: 1 });
    expect(res.status).toBe(200);
    expect(projectOf(1)).toBe(1);
    res = await call("PATCH", "/api/entries/1", { project_id: null });
    expect(res.status).toBe(200);
    expect(projectOf(1)).toBeNull();
  });
});

describe("POST /api/invoices client existence (#1468)", () => {
  function invTenant() {
    let seq = 0;
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, color TEXT, rate REAL)`);
    db.query("INSERT INTO clients (id, name) VALUES (3, 'Acme')").run();
    db.exec(`CREATE TABLE invoices (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft', paid_at TEXT)`);
    db.exec(`CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, description TEXT, hours REAL, rate REAL, amount REAL, date_from TEXT, date_to TEXT)`);
    db.exec(`CREATE TABLE time_entries (id INTEGER PRIMARY KEY, invoice_id INTEGER)`);
    for (const col of ["client_id INTEGER", "number TEXT", "issue_date TEXT", "due_date TEXT",
      "tax_rate REAL DEFAULT 0", "notes TEXT DEFAULT ''", "internal_notes TEXT DEFAULT ''",
      "period_from TEXT", "period_to TEXT"])
      db.exec(`ALTER TABLE invoices ADD COLUMN ${col}`);
    return {
      db,
      qRunning: stubStatement(), qOne: stubStatement(), qRange: stubStatement(),
      qInvoice: { get: (id: number) => db.query("SELECT id, status FROM invoices WHERE id = ?").get(id) } as unknown as Statement,
      qInvoices: stubStatement(),
      groupToLineItems: () => [{ description: "Work", hours: 2, rate: 50, entry_ids: [] }],
      unbilledEntries: () => [{ id: 1 }],
      getInvoice: (id: number) => db.query("SELECT * FROM invoices WHERE id = ?").get(id) as any,
      invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => `INV-${String(++seq).padStart(4, "0")}`, mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [],
      revenueOverdue: () => [], revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }), freezeInvoiceSnapshots: () => {},
    };
  }
  async function post(tenant: any, body: unknown) {
    const handleApi = createApiRouter({
      getTenant: () => tenant as any,
      TOKEN: "test-token",
      authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e,
      verifyWebhookSignature: () => false,
      shareOrigin: () => "",
    }).handleApi;
    const req = new Request("http://localhost/api/invoices", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await handleApi(req, new URL(req.url), "/api/invoices", "POST"))!;
  }
  const item = { description: "Work", hours: 1, rate: 100 };
  const count = (tenant: any) => (tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n;

  test("a non-existent client_id is a 400 and creates nothing, on both build paths", async () => {
    const tenant = invTenant();
    const viaItems = await post(tenant, { client_id: 999, items: [item] });
    expect(viaItems.status).toBe(400);
    expect((await viaItems.json() as any).error).toBe("client_id not found");
    const viaRange = await post(tenant, { client_id: 999, from: "2026-11-07", to: "2026-11-20", rate: 50 });
    expect(viaRange.status).toBe(400);
    expect((await viaRange.json() as any).error).toBe("client_id not found");
    expect(count(tenant)).toBe(0);
  });

  test("a non-numeric, fractional, negative or boolean client_id is a 400 and creates nothing", async () => {
    const tenant = invTenant();
    for (const bad of ["abc", 1.5, -2, true, 0, "0", false, [3], {}]) {
      expect((await post(tenant, { client_id: bad, items: [item] })).status).toBe(400);
    }
    expect(count(tenant)).toBe(0);
  });

  test("an existing client_id stores it, on both build paths", async () => {
    const tenant = invTenant();
    expect((await post(tenant, { client_id: 3, items: [item] })).status).toBe(201);
    expect((await post(tenant, { client_id: "3", from: "2026-11-07", to: "2026-11-20", rate: 50 })).status).toBe(201);
    const rows = tenant.db.query("SELECT client_id FROM invoices ORDER BY id").all() as any[];
    expect(rows).toEqual([{ client_id: 3 }, { client_id: 3 }]);
  });

  test("an absent or empty client_id still creates a client-less invoice from items[]", async () => {
    const tenant = invTenant();
    for (const body of [{ items: [item] }, { client_id: "", items: [item] }, { client_id: null, items: [item] }]) {
      expect((await post(tenant, body)).status).toBe(201);
    }
    const rows = tenant.db.query("SELECT client_id FROM invoices ORDER BY id").all() as any[];
    expect(rows).toEqual([{ client_id: null }, { client_id: null }, { client_id: null }]);
  });
});

describe("POST /api/invoices entry_id linkability (#1470)", () => {
  function linkTenant() {
    let seq = 0;
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, color TEXT, rate REAL)`);
    db.query("INSERT INTO clients (id, name) VALUES (3, 'Acme'), (4, 'Other')").run();
    db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, client_id INTEGER)`);
    db.query("INSERT INTO projects (id, name, client_id) VALUES (10, 'Site', 3), (11, 'OtherSite', 4)").run();
    db.exec(`CREATE TABLE invoices (id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'draft', paid_at TEXT)`);
    db.exec(`CREATE TABLE invoice_items (id INTEGER PRIMARY KEY, invoice_id INTEGER, description TEXT, hours REAL, rate REAL, amount REAL, date_from TEXT, date_to TEXT)`);
    db.exec(`CREATE TABLE time_entries (id INTEGER PRIMARY KEY, project_id INTEGER, description TEXT, start_time TEXT, end_time TEXT, invoice_id INTEGER)`);
    /* 1: finished + unbilled, client 3 — linkable. 2: already invoiced.
       3: still running. 4: finished + unbilled, but client 4's time. */
    db.query(`INSERT INTO time_entries (id, project_id, start_time, end_time, invoice_id) VALUES
      (1, 10, '2026-11-07T09:00:00', '2026-11-07T10:00:00', NULL),
      (2, 10, '2026-11-07T09:00:00', '2026-11-07T10:00:00', 99),
      (3, 10, '2026-11-07T09:00:00', NULL, NULL),
      (4, 11, '2026-11-07T09:00:00', '2026-11-07T10:00:00', NULL)`).run();
    for (const col of ["client_id INTEGER", "number TEXT", "issue_date TEXT", "due_date TEXT",
      "tax_rate REAL DEFAULT 0", "notes TEXT DEFAULT ''", "internal_notes TEXT DEFAULT ''",
      "period_from TEXT", "period_to TEXT"])
      db.exec(`ALTER TABLE invoices ADD COLUMN ${col}`);
    return {
      db,
      qRunning: stubStatement(), qOne: stubStatement(), qRange: stubStatement(),
      qInvoice: { get: (id: number) => db.query("SELECT id, status FROM invoices WHERE id = ?").get(id) } as unknown as Statement,
      qInvoices: stubStatement(),
      groupToLineItems: () => [],
      unbilledEntries: () => [],
      getInvoice: (id: number) => db.query("SELECT * FROM invoices WHERE id = ?").get(id) as any,
      invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => `INV-${String(++seq).padStart(4, "0")}`, mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [],
      revenueOverdue: () => [], revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }), freezeInvoiceSnapshots: () => {},
    };
  }
  async function post(tenant: any, body: unknown) {
    const handleApi = createApiRouter({
      getTenant: () => tenant as any,
      TOKEN: "tok", authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e,
      verifyWebhookSignature: () => false,
      shareOrigin: () => "",
    }).handleApi;
    const req = new Request("http://localhost/api/invoices", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await handleApi(req, new URL(req.url), "/api/invoices", "POST"))!;
  }
  const withEntry = (eid: number) => ({ description: "Work", hours: 1, rate: 100, entry_ids: [eid] });

  test("a finished, unbilled entry of the invoice's client links", async () => {
    const tenant = linkTenant();
    const res = await post(tenant, { client_id: 3, items: [withEntry(1)] });
    expect(res.status).toBe(201);
    const inv = tenant.db.query("SELECT id FROM invoices").get() as any;
    expect((tenant.db.query("SELECT invoice_id FROM time_entries WHERE id = 1").get() as any).invoice_id).toBe(inv.id);
  });

  test("a project-less entry is not billable even to a client-less invoice", async () => {
    const tenant = linkTenant();
    tenant.db.query("INSERT INTO time_entries (id, project_id, start_time, end_time, invoice_id) VALUES (5, NULL, '2026-11-07T09:00:00', '2026-11-07T10:00:00', NULL)").run();
    tenant.db.query("INSERT INTO projects (id, name, client_id) VALUES (12, 'NoClient', NULL)").run();
    tenant.db.query("INSERT INTO time_entries (id, project_id, start_time, end_time, invoice_id) VALUES (6, 12, '2026-11-07T09:00:00', '2026-11-07T10:00:00', NULL)").run();
    for (const eid of [5, 6]) {
      const res = await post(tenant, { items: [withEntry(eid)] });
      expect(res.status).toBe(400);
    }
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
    expect((tenant.db.query("SELECT COUNT(*) AS n FROM time_entries WHERE invoice_id IS NOT NULL AND id IN (5, 6)").get() as any).n).toBe(0);
  });

  test("an already-invoiced, running, other-client or missing entry is a 400 and creates nothing", async () => {
    for (const eid of [2, 3, 4, 999]) {
      const tenant = linkTenant();
      const res = await post(tenant, { client_id: 3, items: [withEntry(eid)] });
      expect(res.status).toBe(400);
      expect((await res.json() as any).error).toContain("entry");
      expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n).toBe(0);
      expect((tenant.db.query("SELECT COUNT(*) AS n FROM invoice_items").get() as any).n).toBe(0);
      const after = tenant.db.query("SELECT invoice_id FROM time_entries WHERE id = ?").get(eid) as any;
      if (after) expect(after.invoice_id).toBe(eid === 2 ? 99 : null);
    }
  });
});

describe("API deletes of missing rows return 404 (#1482)", () => {
  function deleteTenant() {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT, color TEXT, rate REAL)`);
    db.exec(`CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT, client_id INTEGER)`);
    db.exec(`CREATE TABLE time_entries (id INTEGER PRIMARY KEY, project_id INTEGER, description TEXT, start_time TEXT, end_time TEXT, invoice_id INTEGER)`);
    db.exec(`CREATE TABLE invoices (id INTEGER PRIMARY KEY, client_id INTEGER)`);
    db.query("INSERT INTO clients (id, name) VALUES (1, 'Acme')").run();
    db.query("INSERT INTO projects (id, name, client_id) VALUES (1, 'Website', 1)").run();
    db.query("INSERT INTO time_entries (id, project_id, start_time, end_time) VALUES (1, 1, '2026-11-07T09:00:00Z', '2026-11-07T10:00:00Z')").run();
    return {
      db,
      qRunning: stubStatement(),
      qOne: db.query("SELECT *, NULL AS invoice_status FROM time_entries WHERE id = ?"),
      qRange: stubStatement(),
      qInvoice: stubStatement(), qInvoices: stubStatement(),
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: () => null,
      invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [],
      revenueOverdue: () => [], revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }), freezeInvoiceSnapshots: () => {},
    };
  }
  async function del(tenant: any, path: string) {
    const handleApi = createApiRouter({
      getTenant: () => tenant as any,
      TOKEN: "test-token",
      authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e,
      verifyWebhookSignature: () => false,
      shareOrigin: () => "",
    }).handleApi;
    const req = new Request(`http://localhost${path}`, { method: "DELETE" });
    return (await handleApi(req, new URL(req.url), path, "DELETE"))!;
  }
  const count = (tenant: any, table: string) =>
    (tenant.db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as any).n;

  test("DELETE /api/entries/999 is a 404; an existing entry deletes with 204", async () => {
    const tenant = deleteTenant();
    const missing = await del(tenant, "/api/entries/999");
    expect(missing.status).toBe(404);
    expect((await missing.json() as any).error).toBe("not found");
    expect(count(tenant, "time_entries")).toBe(1);
    expect((await del(tenant, "/api/entries/1")).status).toBe(204);
    expect(count(tenant, "time_entries")).toBe(0);
  });

  test("DELETE /api/clients/999 is a 404; an existing client deletes with 204", async () => {
    const tenant = deleteTenant();
    const missing = await del(tenant, "/api/clients/999");
    expect(missing.status).toBe(404);
    expect((await missing.json() as any).error).toBe("not found");
    expect(count(tenant, "clients")).toBe(1);
    expect((await del(tenant, "/api/clients/1")).status).toBe(204);
    expect(count(tenant, "clients")).toBe(0);
  });

  test("DELETE /api/projects/999 is a 404; an existing project deletes with 204", async () => {
    const tenant = deleteTenant();
    const missing = await del(tenant, "/api/projects/999");
    expect(missing.status).toBe(404);
    expect((await missing.json() as any).error).toBe("not found");
    expect(count(tenant, "projects")).toBe(1);
    expect((await del(tenant, "/api/projects/1")).status).toBe(204);
    expect(count(tenant, "projects")).toBe(0);
  });
});

describe("GET /api/entries range validation (#1494)", () => {
  function entriesTenant() {
    const db = new BunDatabase(":memory:");
    db.exec(`CREATE TABLE time_entries (id INTEGER PRIMARY KEY, project_id INTEGER, description TEXT, start_time TEXT, end_time TEXT, invoice_id INTEGER)`);
    db.query("INSERT INTO time_entries (id, start_time, end_time) VALUES (1, '2026-11-07T09:00:00.000Z', '2026-11-07T10:00:00.000Z'), (2, '2026-11-09T09:00:00.000Z', '2026-11-09T10:00:00.000Z')").run();
    return {
      db,
      qRunning: stubStatement(),
      qOne: stubStatement(),
      qRange: db.query("SELECT * FROM time_entries WHERE start_time >= ? AND start_time < ? ORDER BY start_time DESC"),
      qInvoice: stubStatement(), qInvoices: stubStatement(),
      groupToLineItems: () => [], unbilledEntries: () => [],
      getInvoice: () => null,
      invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      nextInvoiceNumber: () => "INV-0001", mintPublicToken: () => "tok",
      stripeLinkFor: async () => ({}),
      revenueTotals: () => null, revenueMonthly: () => [], revenueByClient: () => [],
      revenueOverdue: () => [], revenueSnapshot: () => ({ totals: null, by_month: [], by_client: [], overdue: [] }), freezeInvoiceSnapshots: () => {},
    };
  }
  async function get(tenant: any, qs: string) {
    const handleApi = createApiRouter({
      getTenant: () => tenant as any,
      TOKEN: "test-token",
      authedApi: () => true,
      json: (data: unknown, status = 200) => Response.json(data, { status }),
      entryToJson: (e: any) => e,
      verifyWebhookSignature: () => false,
      shareOrigin: () => "",
    }).handleApi;
    const path = `/api/entries${qs}`;
    const req = new Request(`http://localhost${path}`);
    return (await handleApi(req, new URL(req.url), "/api/entries", "GET"))!;
  }

  test("an invalid from or to is a 400, not a silent empty or unbounded list", async () => {
    const tenant = entriesTenant();
    for (const qs of ["?from=garbage", "?to=garbage", "?from=2026-13-01", "?to=2026-02-30T00:00:00Z"]) {
      const res = await get(tenant, qs);
      expect(res.status).toBe(400);
      expect((await res.json() as any).error).toContain("from/to");
    }
  });

  test("a reversed range is a 400", async () => {
    const tenant = entriesTenant();
    const res = await get(tenant, "?from=2026-11-10T00:00:00Z&to=2026-11-08T00:00:00Z");
    expect(res.status).toBe(400);
  });

  test("a valid range returns only the entries inside it; no params returns entries up to now", async () => {
    const tenant = entriesTenant();
    const ranged = await get(tenant, "?from=2026-11-08T00:00:00Z&to=2026-11-10T00:00:00Z");
    expect(ranged.status).toBe(200);
    expect((await ranged.json() as any[]).map((e: any) => e.id)).toEqual([2]);
    const dateOnly = await get(tenant, "?from=2026-11-07&to=2026-11-08");
    expect(dateOnly.status).toBe(200);
    expect((await dateOnly.json() as any[]).map((e: any) => e.id)).toEqual([1]);
    const all = await get(tenant, "");
    expect(all.status).toBe(200);
    expect((await all.json() as any[]).length).toBe(2);
  });
});
