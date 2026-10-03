/** #552: PATCH /api/invoices/:id stamps paid_at when an invoice is marked
 * paid, mirroring the web mark-paid route and the Stripe webhook. The
 * invoice list, the detail header chip, and the CSV export all read
 * paid_at, so an API-marked-paid invoice without it silently loses its
 * paid date everywhere.
 */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { Database as BunDatabase } from "bun:sqlite";
import { createApiRouter } from "./api.ts";

const stubStatement = () =>
  ({ get: () => null, all: () => [], run: () => {} } as unknown as Statement);

function setup() {
  const db = new BunDatabase(":memory:");
  db.exec(`CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'draft',
    paid_at TEXT
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

  async function patchStatus(id: number, status: string) {
    const req = new Request(`http://localhost/api/invoices/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    return (await handleApi(req, new URL(req.url), `/api/invoices/${id}`, "PATCH"))!;
  }
  const paidAt = (id: number) =>
    (db.query("SELECT paid_at FROM invoices WHERE id = ?").get(id) as any).paid_at;
  const status = (id: number) =>
    (db.query("SELECT status FROM invoices WHERE id = ?").get(id) as any).status;
  return { patchStatus, paidAt, status };
}

describe("PATCH /api/invoices/:id paid_at", () => {
  test("marking paid stamps paid_at with today's date", async () => {
    const { patchStatus, paidAt, status } = setup();
    const res = await patchStatus(1, "paid");
    expect(res.status).toBe(200);
    expect(status(1)).toBe("paid");
    const today = new Date().toISOString().slice(0, 10);
    expect(paidAt(1)).toBe(today);
  });

  test("sent does not stamp paid_at", async () => {
    const { patchStatus, paidAt, status } = setup();
    const res = await patchStatus(2, "sent");
    expect(res.status).toBe(200);
    expect(status(2)).toBe("sent");
    expect(paidAt(2)).toBeNull();
  });
});
