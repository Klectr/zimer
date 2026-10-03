/** #733 acceptance: in hosted mode every user gets their own SQLite file and
 *  never sees another user's data. Wires the real API + web routers exactly
 *  like server.ts does in hosted mode (session → user → tenant tree), with
 *  stub views — the isolation property lives in the per-request bundle. */
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db.ts";
import { createAccountsDb } from "../lib/accounts.ts";
import { authedApi } from "../lib/auth.ts";
import { entryToJson } from "../lib/format.ts";
import { createTenantStore, tenantDbPath } from "../lib/tenants.ts";
import { createApiRouter } from "./api.ts";
import { createWebRouter } from "./web.ts";

function setupHosted() {
  const dataDir = mkdtempSync(join(tmpdir(), "tk-733iso-"));
  const accounts = createAccountsDb(dataDir);
  /* Same shape as server.ts's buildTenantTree, but with stub views — the
     test only exercises data paths, which run on the real bundle. */
  const tenants = createTenantStore(dataDir, (bundle, dbPath) => ({
    db: bundle.db,
    dbPath,
    qRunning: bundle.qRunning,
    qOne: bundle.qOne,
    qRange: bundle.qRange,
    qInvoice: bundle.qInvoice,
    qInvoices: bundle.qInvoices,
    notFoundPage: () => "nf",
    errorPage: () => "err",
    dashboardPage: () => "<h1>timer</h1>",
    timerPartial: () => "",
    todayPartial: () => "",
    weekInner: () => "",
    weekStrip: () => "",
    calendarPage: () => "",
    editPage: () => null,
    managePage: () => "",
    clientSelection: () => null,
    clientDetailBody: () => "",
    clientListOob: () => "",
    bizProfileSection: () => "",
    clientSettingsForm: () => "",
    settingsPage: () => "",
    invoicesPage: () => "",
    invoiceNewPage: () => "",
    defaultNewInvParams: () => ({}),
    invoiceStep2: () => "",
    invoiceDetailBody: () => "",
    invoiceListOob: () => "",
    invoiceDoc: () => "",
    publicInvoicePage: () => "",
    getInvoice: () => null,
    invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    nextInvoiceNumber: () => "INV-0001",
    stripeLinkFor: async () => ({}),
    unbilledEntries: () => [],
    groupToLineItems: () => [],
    clientRestFrom: () => null,
    ensurePublicToken: () => "",
    getPublicToken: () => null,
    mintPublicToken: () => "",
    invoicePdfInput: () => ({} as any),
    freezeInvoiceSnapshots: () => {},
    revenueTotals: () => null,
    revenueMonthly: () => [],
    revenueByClient: () => [],
    revenueOverdue: () => [],
  }));
  const getTenant = (req: Request) => {
    const user = accounts.sessionUserFromRequest(req);
    return user ? (tenants.get(user.id) as any) : null;
  };
  const { handleApi } = createApiRouter({
    getTenant,
    TOKEN: "test-token",
    authedApi: (req, token) =>
      authedApi(req, token) || accounts.sessionUserFromRequest(req) !== null,
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    entryToJson,
    verifyWebhookSignature: () => false,
    shareOrigin: () => "",
  });
  const noop = () => "";
  const { handleWeb } = createWebRouter({
    getTenant,
    STATIC_DIR: "",
    TOKEN: "test-token",
    authedPage: () => false,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200) => new Response(body, { status }),
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
    noSuchInvoicePage: noop,
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

function apiReq(path: string, method: string, cookie?: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (cookie) headers["cookie"] = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://x${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("hosted tenant isolation (#733)", () => {
  test("tenant files are created lazily on the first authenticated request", async () => {
    const { dataDir, accounts, handleApi } = setupHosted();
    expect(existsSync(join(dataDir, "tenants"))).toBe(false);
    const { user, cookie } = await signupLogin(accounts, "a@example.com");
    /* Signup/login touch only the accounts control plane — no tenant yet. */
    expect(existsSync(join(dataDir, "tenants"))).toBe(false);
    const req = apiReq("/api/entries", "GET", cookie);
    const res = (await handleApi(req, new URL(req.url), "/api/entries", "GET"))!;
    expect(res.status).toBe(200);
    expect(existsSync(tenantDbPath(dataDir, user.id))).toBe(true);
  });

  test("two users write entries; neither ever sees the other's data", async () => {
    const { dataDir, accounts, tenants, handleApi } = setupHosted();
    const a = await signupLogin(accounts, "a@example.com");
    const b = await signupLogin(accounts, "b@example.com");

    /* A tracks time. */
    let req = apiReq("/api/timer/start", "POST", a.cookie, { description: "alice work" });
    let res = (await handleApi(req, new URL(req.url), "/api/timer/start", "POST"))!;
    expect(res.status).toBe(201);
    req = apiReq("/api/timer/stop", "POST", a.cookie, {});
    res = (await handleApi(req, new URL(req.url), "/api/timer/stop", "POST"))!;
    expect(res.status).toBe(200);

    /* B sees nothing; A sees her entry. */
    req = apiReq("/api/entries", "GET", b.cookie);
    res = (await handleApi(req, new URL(req.url), "/api/entries", "GET"))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
    req = apiReq("/api/entries", "GET", a.cookie);
    res = (await handleApi(req, new URL(req.url), "/api/entries", "GET"))!;
    const entries = (await res.json()) as any[];
    expect(entries.length).toBe(1);
    expect(entries[0].description).toBe("alice work");

    /* The files on disk agree — and B can't reach A's rows by id either. */
    const aDb = createDb(join(dataDir, "tenants", String(a.user.id))).db;
    const bDb = createDb(join(dataDir, "tenants", String(b.user.id))).db;
    const count = (db: any) =>
      (db.query("SELECT COUNT(*) AS n FROM time_entries").get() as { n: number }).n;
    expect(count(aDb)).toBe(1);
    expect(count(bDb)).toBe(0);
    req = apiReq(`/api/entries/${entries[0].id}`, "DELETE", b.cookie);
    res = (await handleApi(req, new URL(req.url), `/api/entries/${entries[0].id}`, "DELETE"))!;
    expect(res.status).toBe(204); /* delete of a missing id is a no-op */
    expect(count(aDb)).toBe(1);
    expect(tenants.size()).toBe(2);
  });

  test("the accounts control plane never holds customer data", async () => {
    const { dataDir, accounts, handleApi } = setupHosted();
    const { cookie } = await signupLogin(accounts, "a@example.com");
    const req = apiReq("/api/timer/start", "POST", cookie, { description: "x" });
    await handleApi(req, new URL(req.url), "/api/timer/start", "POST");
    const tables = accounts.db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name).sort()).toEqual(["sessions", "users"]);
  });

  test("API without a session is 401; pages without a session bounce to /login", async () => {
    const { handleApi, handleWeb } = setupHosted();
    let req = apiReq("/api/entries", "GET");
    let res = (await handleApi(req, new URL(req.url), "/api/entries", "GET"))!;
    expect(res.status).toBe(401);
    req = new Request("http://x/");
    res = (await handleWeb(req, new URL(req.url), "/", "GET"))!;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/login");
  });

  test("an authenticated page resolves the tenant (no cross-user leak via pages)", async () => {
    const { accounts, handleWeb } = setupHosted();
    const a = await signupLogin(accounts, "a@example.com");
    const req = new Request("http://x/", { headers: { cookie: a.cookie } });
    const res = (await handleWeb(req, new URL(req.url), "/", "GET"))!;
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("timer");
  });
});
