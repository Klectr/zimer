/** #741 acceptance: in hosted mode the sessionless surfaces route by token.
 *  Two hosted tenants, each with a public invoice link — both links resolve
 *  to the right tenant's invoice (even when the request carries the OTHER
 *  tenant's session); a signed checkout.session.completed for B's payment
 *  link marks B's invoice paid and leaves A's untouched. Bad signature →
 *  400 before any DB touch; unknown tokens 404; an unattributable paid
 *  session fails loud (503) so Stripe retries. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { Database } from "bun:sqlite";
import { createAccountsDb } from "../lib/accounts.ts";
import { createTenantStore, findTenantByPaymentLinkId, findTenantByPublicToken } from "../lib/tenants.ts";
import { verifyWebhookSignature } from "../stripe.ts";
import { createApiRouter } from "./api.ts";
import { createWebRouter } from "./web.ts";

const SECRET = "whsec_test_741";

function setupHosted() {
  const dataDir = mkdtempSync(join(tmpdir(), "tk-741-"));
  const accounts = createAccountsDb(dataDir);
  /* Minimal tenant tree: real SQLite bundles (full schema + migrations),
     stub views. The #741 paths only touch db / qInvoice /
     freezeInvoiceSnapshots / getInvoice / publicInvoicePage. */
  const tenants = createTenantStore(dataDir, (bundle) => {
    const db = bundle.db as Database;
    return {
      db,
      dbPath: "",
      qInvoice: {
        get: (id: number) => db.query("SELECT id, status FROM invoices WHERE id = ?").get(id),
      },
      freezeInvoiceSnapshots: () => {},
      getInvoice: (id: number) => db.query("SELECT * FROM invoices WHERE id = ?").get(id),
      publicInvoicePage: (inv: any) => `public-invoice-${inv.id}-${inv.number}`,
    } as any;
  });

  const { handleApi } = createApiRouter({
    getTenant: () => null, /* hosted webhook: never a session */
    TOKEN: "test-token",
    authedApi: () => false,
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    entryToJson: (e: any) => e,
    verifyWebhookSignature,
    shareOrigin: () => "",
    dataDir,
    tenantById: (id: number) => tenants.get(id) as any,
  });

  const noop = () => "";
  const { handleWeb } = createWebRouter({
    getTenant: (req: Request) => {
      const user = accounts.sessionUserFromRequest(req);
      return user ? (tenants.get(user.id) as any) : null;
    },
    STATIC_DIR: "",
    TOKEN: "test-token",
    authedPage: () => false,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/html" } }),
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    isHtmx: () => false,
    csvResponse: (f: string) => new Response(f),
    shareOrigin: () => "",
    PORT: 3000,
    loginPage: noop,
    signupPage: noop,
    hostedLoginPage: noop,
    HOSTED: true,
    accounts,
    changelogPage: () => "",
    termsPage: () => "",
    privacyPage: noop,
    noSuchInvoicePage: () => "no-such-invoice",
    rateLimitPage: noop,
    notFoundPage: noop,
    errorPage: noop,
    invoicePdf: () => new Uint8Array(),
    stripeConfigured: () => false,
    workspaceEmpty: () => false,
    demoIds: () => [],
    seedDemoData: () => {},
    removeDemoData: () => {},
    entryToJson: (e: any) => e,
    dataDir,
    tenantById: (id: number) => tenants.get(id) as any,
  });
  return { dataDir, accounts, tenants, handleApi, handleWeb };
}

async function signupLogin(accounts: ReturnType<typeof createAccountsDb>, email: string) {
  const { user, error } = await accounts.signup(email, "password123");
  expect(error).toBeUndefined();
  const { token, error: loginError } = await accounts.login(email, "password123");
  expect(loginError).toBeUndefined();
  return { user: user!, cookie: `tksession=${token}` };
}

function seedInvoice(tenants: any, userId: number, n: string) {
  const db = (tenants.get(userId) as any).db as Database;
  db.query(
    `INSERT INTO invoices (number, issue_date, status, public_token, stripe_payment_link_id)
     VALUES (?, '2026-10-01', 'sent', ?, ?)`
  ).run(`INV-${n}`, `tok_${"a".repeat(16)}${n}`, `plink_${n}`);
  return db.query("SELECT * FROM invoices WHERE number = ?").get(`INV-${n}`) as any;
}

function signPayload(payload: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  return `t=${t},v1=${v1}`;
}

async function postWebhook(
  handleApi: (req: Request, url: URL, path: string, method: string) => Promise<Response | null>,
  event: any,
  secret: string = SECRET
) {
  const payload = JSON.stringify(event);
  const req = new Request("http://x/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signPayload(payload, secret) },
    body: payload,
  });
  const prev = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  try {
    return (await handleApi(req, new URL(req.url), "/api/stripe/webhook", "POST"))!;
  } finally {
    if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prev;
  }
}

const paidSession = (paymentLink: string | null) => ({
  id: "evt_741",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_741",
      payment_status: "paid",
      payment_link: paymentLink,
      metadata: {},
    },
  },
});

describe("#741: sessionless cross-tenant routing", () => {
  test("two tenants' public links each resolve to the right tenant's invoice", async () => {
    const { accounts, tenants, handleWeb } = setupHosted();
    const a = await signupLogin(accounts, "a@example.com");
    const b = await signupLogin(accounts, "b@example.com");
    const invA = seedInvoice(tenants, a.user.id, "A1");
    const invB = seedInvoice(tenants, b.user.id, "B1");

    /* No session at all. */
    for (const [who, inv] of [["A", invA], ["B", invB]] as const) {
      const req = new Request(`http://x/i/${inv.public_token}`);
      const res = (await handleWeb(req, new URL(req.url), `/i/${inv.public_token}`, "GET"))!;
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(`public-invoice-${inv.id}-INV-${who}1`);
    }

    /* A's session viewing B's link still resolves B's invoice — the token,
       not the session, picks the tenant. */
    const req = new Request(`http://x/i/${invB.public_token}`, { headers: { cookie: a.cookie } });
    const res = (await handleWeb(req, new URL(req.url), `/i/${invB.public_token}`, "GET"))!;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(`public-invoice-${invB.id}-INV-B1`);
  });

  test("unknown public token 404s exactly like today", async () => {
    const { accounts, tenants, handleWeb } = setupHosted();
    const a = await signupLogin(accounts, "a@example.com");
    seedInvoice(tenants, a.user.id, "A1");
    const req = new Request("http://x/i/tok_zzzzzzzzzzzzzzzz");
    const res = (await handleWeb(req, new URL(req.url), "/i/tok_zzzzzzzzzzzzzzzz", "GET"))!;
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("no-such-invoice");
  });

  test("checkout.session.completed for B's link marks B's invoice paid, A's untouched", async () => {
    const { accounts, tenants, handleApi } = setupHosted();
    const a = await signupLogin(accounts, "a@example.com");
    const b = await signupLogin(accounts, "b@example.com");
    const invA = seedInvoice(tenants, a.user.id, "A1");
    const invB = seedInvoice(tenants, b.user.id, "B1");

    const res = await postWebhook(handleApi, paidSession("plink_B1"));
    expect(res.status).toBe(200);

    const dbA = (tenants.get(a.user.id) as any).db as Database;
    const dbB = (tenants.get(b.user.id) as any).db as Database;
    const row = (db: Database, id: number) =>
      db.query("SELECT status, paid_via_stripe FROM invoices WHERE id = ?").get(id) as any;
    expect(row(dbB, invB.id)).toMatchObject({ status: "paid", paid_via_stripe: 1 });
    expect(row(dbA, invA.id)).toMatchObject({ status: "sent", paid_via_stripe: 0 });
  });

  test("bad signature -> 400 before any DB touch", async () => {
    const { accounts, tenants, handleApi } = setupHosted();
    const a = await signupLogin(accounts, "a@example.com");
    const b = await signupLogin(accounts, "b@example.com");
    const invB = seedInvoice(tenants, b.user.id, "B1");
    seedInvoice(tenants, a.user.id, "A1");

    const res = await postWebhook(handleApi, paidSession("plink_B1"), "wrong-secret");
    expect(res.status).toBe(400);
    const dbB = (tenants.get(b.user.id) as any).db as Database;
    expect((dbB.query("SELECT status FROM invoices WHERE id = ?").get(invB.id) as any).status).toBe("sent");
  });

  test("paid session with an unattributable link fails loud (503) so Stripe retries", async () => {
    const { accounts, tenants, handleApi } = setupHosted();
    const a = await signupLogin(accounts, "a@example.com");
    seedInvoice(tenants, a.user.id, "A1");
    const res = await postWebhook(handleApi, paidSession("plink_nonexistent"));
    expect(res.status).toBe(503);
  });

  test("paid session with no link id is acknowledged without touching any DB", async () => {
    const { accounts, tenants, handleApi } = setupHosted();
    const a = await signupLogin(accounts, "a@example.com");
    const invA = seedInvoice(tenants, a.user.id, "A1");
    const res = await postWebhook(handleApi, paidSession(null));
    expect(res.status).toBe(200);
    const dbA = (tenants.get(a.user.id) as any).db as Database;
    expect((dbA.query("SELECT status FROM invoices WHERE id = ?").get(invA.id) as any).status).toBe("sent");
  });

  test("scan helpers skip non-tenant files and missing dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-741scan-"));
    writeFileSync(join(dir, "accounts.db"), "not a db");
    writeFileSync(join(dir, "notes.txt"), "hi");
    expect(findTenantByPublicToken(dir, "tok_x")).toBeNull();
    expect(findTenantByPaymentLinkId(dir, "plink_x")).toBeNull();
    expect(findTenantByPublicToken(join(dir, "nope"), "tok_x")).toBeNull();
  });
});
