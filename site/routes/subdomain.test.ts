/** #734 acceptance: <slug>.HOSTED_DOMAIN resolves the slug owner's tenant;
 *  the session cookie stays the fallback on the bare domain; unknown
 *  subdomains 404; a foreign session on a known subdomain is rejected.
 *  Wires the real API + web routers with the same resolution rule server.ts
 *  uses (subdomainFromHost + userBySubdomain), stub views otherwise. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccountsDb } from "../lib/accounts.ts";
import { authedApi } from "../lib/auth.ts";
import { entryToJson } from "../lib/format.ts";
import { subdomainFromHost } from "../lib/subdomain.ts";
import { createTenantStore } from "../lib/tenants.ts";
import { createApiRouter } from "./api.ts";
import { createWebRouter } from "./web.ts";

const HOSTED_DOMAIN = "example.com";

function setupHosted() {
  const dataDir = mkdtempSync(join(tmpdir(), "tk-734sub-"));
  const accounts = createAccountsDb(dataDir);
  /* Same shape as tenant-isolation's tree — stub views, real data paths. */
  const tenants = createTenantStore(dataDir, (bundle, dbPath) => ({
    db: bundle.db,
    dbPath,
    qRunning: bundle.qRunning,
    qOne: bundle.qOne,
    qRange: bundle.qRange,
    qInvoice: bundle.qInvoice,
    qInvoices: bundle.qInvoices,
    notFoundPage: (authed: boolean) => `nf-${authed}`,
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
  /* The #734 rule exactly as server.ts wires it: subdomain pins the tenant
     to the slug owner (session must match); bare domain falls back to the
     session cookie. */
  const getTenant = (req: Request) => {
    const slug = subdomainFromHost(req.headers.get("host"), HOSTED_DOMAIN);
    if (slug !== null) {
      const owner = accounts.userBySubdomain(slug);
      if (!owner) return null;
      const sessionUser = accounts.sessionUserFromRequest(req);
      return sessionUser && sessionUser.id === owner.id
        ? (tenants.get(owner.id) as any)
        : null;
    }
    const user = accounts.sessionUserFromRequest(req);
    return user ? (tenants.get(user.id) as any) : null;
  };
  const unknownSubdomain = (req: Request) => {
    const slug = subdomainFromHost(req.headers.get("host"), HOSTED_DOMAIN);
    return slug !== null && accounts.userBySubdomain(slug) === null;
  };
  const { handleApi } = createApiRouter({
    getTenant,
    TOKEN: "x",
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
    unknownSubdomain, /* #734 */
    STATIC_DIR: "",
    TOKEN: "x",
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
    privacyPage: () => "",
    noSuchInvoicePage: noop,
    rateLimitPage: noop,
    notFoundPage: (authed: boolean) => `nf-${authed}`,
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

async function signupLogin(
  accounts: ReturnType<typeof createAccountsDb>,
  email: string,
  subdomain?: string
) {
  const { user, error } = await accounts.signup(email, "password123", subdomain);
  expect(error).toBeUndefined();
  const { token, error: loginError } = await accounts.login(email, "password123");
  expect(loginError).toBeUndefined();
  return { user: user!, cookie: `tksession=${token}` };
}

function req(
  host: string,
  path: string,
  opts: { method?: string; cookie?: string; body?: unknown; form?: string } = {}
) {
  /* Bun.serve always delivers a Host header; undici's Request does not
     materialize one from the URL, so set it explicitly. */
  const headers: Record<string, string> = { host };
  if (opts.cookie) headers["cookie"] = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.form !== undefined) headers["content-type"] = "application/x-www-form-urlencoded";
  return new Request(`http://${host}${path}`, {
    method: opts.method || "GET",
    headers,
    body: opts.body === undefined ? opts.form : JSON.stringify(opts.body),
  });
}

/* Wide-open range: sidesteps /api/entries' strict `to < now` default. */
const RANGE = "/api/entries?from=2000-01-01T00:00:00.000Z&to=2999-01-01T00:00:00.000Z";

describe("subdomain tenant routing (#734)", () => {
  test("subdomain resolves to the slug owner's tenant; bare domain falls back to the session", async () => {
    const { accounts, handleApi, handleWeb } = setupHosted();
    const a = await signupLogin(accounts, "a@example.com", "acme");

    /* A tracks time on her subdomain. */
    let r = req("acme.example.com", "/api/timer/start", {
      method: "POST",
      cookie: a.cookie,
      body: { description: "acme work" },
    });
    let res = (await handleApi(r, new URL(r.url), "/api/timer/start", "POST"))!;
    expect(res.status).toBe(201);
    r = req("acme.example.com", "/api/timer/stop", {
      method: "POST",
      cookie: a.cookie,
      body: {},
    });
    res = (await handleApi(r, new URL(r.url), "/api/timer/stop", "POST"))!;
    expect(res.status).toBe(200);

    /* Same tenant through the subdomain: one entry. The explicit range
       sidesteps /api/entries' strict `to < now` default, which drops an
       entry created in the same millisecond as the query. */
    r = req("acme.example.com", RANGE, { cookie: a.cookie });
    res = (await handleApi(r, new URL(r.url), "/api/entries", "GET"))!;
    expect(res.status).toBe(200);
    expect((await res.json() as any[]).length).toBe(1);

    /* Bare domain + session cookie reaches the same tenant (fallback). */
    r = req("example.com", RANGE, { cookie: a.cookie });
    res = (await handleApi(r, new URL(r.url), "/api/entries", "GET"))!;
    expect(res.status).toBe(200);
    const entries = (await res.json()) as any[];
    expect(entries.length).toBe(1);
    expect(entries[0].description).toBe("acme work");

    /* App page on the subdomain renders for the owner. */
    r = req("acme.example.com", "/", { cookie: a.cookie });
    res = (await handleWeb(r, new URL(r.url), "/", "GET"))!;
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<h1>timer</h1>");
  });

  test("unknown subdomain 404s every path and creates no tenant", async () => {
    const { dataDir, accounts, tenants, handleWeb } = setupHosted();
    await signupLogin(accounts, "a@example.com", "acme");
    for (const path of ["/", "/login", "/api/entries"]) {
      const r = req("ghost.example.com", path);
      const res = (await handleWeb(r, new URL(r.url), path, "GET"))!;
      expect(res.status).toBe(404);
      expect(await res.text()).toContain("nf-");
    }
    expect(tenants.size()).toBe(0);
    expect(readdirSync(dataDir).filter((f) => f === "tenants")).toEqual([]);
  });

  test("a foreign session on a known subdomain is rejected, never leaks", async () => {
    const { accounts, handleApi, handleWeb } = setupHosted();
    const a = await signupLogin(accounts, "a@example.com", "acme");
    const b = await signupLogin(accounts, "b@example.com");

    /* B's session on acme's subdomain: app page 404s (not a login loop). */
    let r = req("acme.example.com", "/", { cookie: b.cookie });
    let res = (await handleWeb(r, new URL(r.url), "/", "GET"))!;
    expect(res.status).toBe(404);

    /* API: 401, and B's own bare-domain tenant is untouched/empty. */
    r = req("acme.example.com", RANGE, { cookie: b.cookie });
    res = (await handleApi(r, new URL(r.url), "/api/entries", "GET"))!;
    expect(res.status).toBe(401);
    r = req("example.com", RANGE, { cookie: b.cookie });
    res = (await handleApi(r, new URL(r.url), "/api/entries", "GET"))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);

    /* A still sees only her own data on the subdomain. */
    r = req("acme.example.com", RANGE, { cookie: a.cookie });
    res = (await handleApi(r, new URL(r.url), "/api/entries", "GET"))!;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("anonymous visitor on a known subdomain gets the login bounce, not a 404", async () => {
    const { accounts, handleWeb } = setupHosted();
    await signupLogin(accounts, "a@example.com", "acme");
    const r = req("acme.example.com", "/");
    const res = (await handleWeb(r, new URL(r.url), "/", "GET"))!;
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  test("signup claims, rejects duplicates, and rejects invalid slugs (web)", async () => {
    const { accounts, handleWeb } = setupHosted();
    const form = (email: string, subdomain: string) =>
      req("example.com", "/signup", {
        method: "POST",
        form: `email=${encodeURIComponent(email)}&password=password123&subdomain=${encodeURIComponent(subdomain)}`,
      });
    let r = form("a@example.com", "acme");
    let res = (await handleWeb(r, new URL(r.url), "/signup", "POST"))!;
    expect(res.status).toBe(302);
    expect(accounts.userBySubdomain("acme")!.email).toBe("a@example.com");

    r = form("b@example.com", "acme");
    res = (await handleWeb(r, new URL(r.url), "/signup", "POST"))!;
    expect(res.status).toBe(400);

    r = form("c@example.com", "NOPE!");
    res = (await handleWeb(r, new URL(r.url), "/signup", "POST"))!;
    expect(res.status).toBe(400);
  });
});
