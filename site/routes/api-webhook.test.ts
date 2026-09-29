
/** #645: POST /api/stripe/webhook marks the matching sent invoice paid.
 * Payment-link metadata does NOT propagate to checkout sessions, so the
 * handler matches session.payment_link against the stored link ID first
 * (metadata stays as a fallback). Signature is verified before any DB
 * access; duplicates are no-ops; unknown events and unpaid sessions are
 * ignored.
 */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { Database as BunDatabase } from "bun:sqlite";
import { createApiRouter } from "./api.ts";

const stubStatement = () =>
  ({ get: () => null, all: () => [], run: () => {} } as unknown as Statement);

function setup(sigOk: boolean) {
  const db = new BunDatabase(":memory:");
  db.exec(`CREATE TABLE invoices (
    id INTEGER PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'draft',
    paid_at TEXT,
    paid_via_stripe INTEGER NOT NULL DEFAULT 0,
    stripe_payment_link_id TEXT
  )`);
  db.query(
    "INSERT INTO invoices (id, status, stripe_payment_link_id) VALUES (1, 'sent', 'plink_abc'), (2, 'sent', NULL), (3, 'paid', 'plink_paid')"
  ).run();

  const { handleApi } = createApiRouter({
    db: db as unknown as Database,
    qRunning: stubStatement(),
    qOne: stubStatement(),
    qRange: stubStatement(),
    qInvoice: {
      get: (id: number) =>
        db.query("SELECT id, status FROM invoices WHERE id = ?").get(id),
    } as unknown as Statement,
    qInvoices: stubStatement(),
TOKEN: "tok",
    authedApi: () => true,
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    entryToJson: (e: any) => e,
    groupToLineItems: () => [],
    unbilledEntries: () => [],
    getInvoice: (id: number) => ({ id, items: [], tax_rate: 0 }) as any,
    invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    nextInvoiceNumber: () => "INV-0001",
    mintPublicToken: () => "tok",
    stripeLinkFor: async () => ({}),
    verifyWebhookSignature: () => sigOk,
    revenueTotals: () => null,
    revenueMonthly: () => [],
    revenueByClient: () => [],
    revenueOverdue: () => [],
    freezeInvoiceSnapshots: () => {},
    shareOrigin: () => "",
  });

  const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

  async function postWebhook(event: any) {
    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=abc" },
      body: JSON.stringify(event),
    });
    const res = (await handleApi(req, new URL(req.url), "/api/stripe/webhook", "POST"))!;
    if (prevSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
    return res;
  }
  const row = (id: number) =>
    db.query("SELECT status, paid_at, paid_via_stripe FROM invoices WHERE id = ?").get(id) as any;
  return { postWebhook, row };
}

const paidSession = (overrides: any = {}) => ({
  id: "evt_1",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_1",
      payment_status: "paid",
      payment_link: "plink_abc",
      metadata: {},
      ...overrides,
    },
  },
});

describe("#645: POST /api/stripe/webhook", () => {
  test("paid session with matching link id marks invoice paid", async () => {
    const { postWebhook, row } = setup(true);
    const res = await postWebhook(paidSession());
    expect(res.status).toBe(200);
    const r = row(1);
    expect(r.status).toBe("paid");
    expect(r.paid_via_stripe).toBe(1);
    expect(r.paid_at).toBe(new Date().toISOString().slice(0, 10));
  });

  test("metadata invoice_id works as fallback without link id", async () => {
    const { postWebhook, row } = setup(true);
    const res = await postWebhook(
      paidSession({ payment_link: null, metadata: { invoice_id: "2" } })
    );
    expect(res.status).toBe(200);
    expect(row(2).status).toBe("paid");
  });

  test("duplicate delivery on already-paid invoice is a no-op", async () => {
    const { postWebhook, row } = setup(true);
    const before = row(3);
    const res = await postWebhook(paidSession({ payment_link: "plink_paid" }));
    expect(res.status).toBe(200);
    expect(row(3)).toEqual(before);
  });

  test("invalid signature -> 400 with no DB writes", async () => {
    const { postWebhook, row } = setup(false);
    const res = await postWebhook(paidSession());
    expect(res.status).toBe(400);
    expect(row(1).status).toBe("sent");
  });

  test("unknown event types are ignored with 200", async () => {
    const { postWebhook, row } = setup(true);
    const res = await postWebhook({ id: "evt_2", type: "charge.refunded", data: { object: {} } });
    expect(res.status).toBe(200);
    expect(row(1).status).toBe("sent");
  });

  test("unpaid sessions are ignored", async () => {
    const { postWebhook, row } = setup(true);
    const res = await postWebhook(paidSession({ payment_status: "unpaid" }));
    expect(res.status).toBe(200);
    expect(row(1).status).toBe("sent");
  });

  test("sessions with no link id and no metadata are ignored", async () => {
    const { postWebhook, row } = setup(true);
    const res = await postWebhook(paidSession({ payment_link: "plink_unknown" }));
    expect(res.status).toBe(200);
    expect(row(1).status).toBe("sent");
  });
});
