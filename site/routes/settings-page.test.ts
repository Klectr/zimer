/** #693: direct (non-htmx) GET /settings renders the full app layout.
 * The settings modal body fragment alone is unstyled when visited directly. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createDb } from "../db.ts";
import { createWebRouter } from "./web.ts";
import { createManageViews } from "../views/manage.ts";
import { appVersion } from "../lib/version.ts";

function setup(billingSectionHtml?: (req: Request) => string) {
  const db = createDb(mkdtempSync(join(tmpdir(), "tk-settings-"))).db;
  /* Mark the layout so the test can tell the bare fragment from the full page. */
  const views = createManageViews({ db, layout: (t: string, b: string) => `<!DOCTYPE html><title>${t}</title>${b}`, unbilledByClient: () => [] });
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
    bizProfileSection: views.bizProfileSection, dailyTargetSection: views.dailyTargetSection, dailyTargetControl: views.dailyTargetControl, preferencesSection: views.preferencesSection, clientSettingsForm: views.clientSettingsForm,
    themeSectionHtml: views.themeSectionHtml, themeDotsHtml: views.themeDotsHtml,
    settingsPage: views.settingsPage, invoicesPage: noop, invoiceNewPage: noop,
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
    billingSectionHtml,
  });
  return { handleWeb };
}

function getSettings(handleWeb: any, htmx: boolean) {
  const headers: Record<string, string> = {};
  if (htmx) headers["HX-Request"] = "true";
  const req = new Request("http://x/settings", { headers });
  return handleWeb(req, new URL(req.url), "/settings", "GET");
}

describe("settings page (#693)", () => {
  test("htmx request gets the bare modal fragment", async () => {
    const { handleWeb } = setup();
    const res = await getSettings(handleWeb, true);
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain('id="biz-profile"');
    expect(body).not.toContain("<!DOCTYPE html>");
    expect(body).toContain('class="ui-settings-stack"');
  });

  /* #1121: the hosted Billing section joins the body when the dep is
     wired (server.ts passes it in hosted mode) — pinned here so the
     composition can't silently unwire. */
  test("billing section follows the profile card, before the data and theme cards", async () => {
    const { handleWeb } = setup(() => `<section id="billing-marker">BILLING</section>`);
    const res = await getSettings(handleWeb, true);
    const body = await res!.text();
    const at = (needle: string) => body.indexOf(needle);
    expect(at('id="billing-marker"')).toBeGreaterThan(at('id="biz-profile"'));
    expect(at('id="billing-marker"')).toBeLessThan(at('id="your-data"'));
    expect(at('id="billing-marker"')).toBeLessThan(at('id="update-section"'));
  });

  test("the mock's Your data card renders with real export links", async () => {
    const { handleWeb } = setup();
    const res = await getSettings(handleWeb, true);
    const body = await res!.text();
    expect(body).toContain('id="your-data"');
    expect(body).toContain('href="/backup"');
    expect(body).toContain('href="/export/entries.csv"');
    expect(body).toContain('href="/export/invoices.csv"');
    expect(body).toContain('id="about"');
    expect(body).toContain('href="/changelog"');
  });

  /* #1223: one About & updates card — the version used to render in both
     the Self-hosted card hint and the Updates card headline. */
  test("self-hosted settings show the version once, in the merged About & updates card", async () => {
    const { handleWeb } = setup();
    const res = await getSettings(handleWeb, true);
    const body = await res!.text();
    expect(body).toContain("About &amp; updates");
    expect(body).not.toContain('id="update-section"');
    expect(body).toContain('id="check-updates-btn"');
    expect(body).toContain('href="https://github.com/Klectr/zimer#self-hosting"');
    expect(body.split(appVersion()).length - 1).toBe(1);
  });

  test("hosted settings keep the plain Updates card, no merged About card", async () => {
    const { handleWeb } = setup(() => `<section id="billing-marker">BILLING</section>`);
    const res = await getSettings(handleWeb, true);
    const body = await res!.text();
    expect(body).toContain('id="update-section"');
    expect(body).not.toContain("About &amp; updates");
    expect(body).not.toContain('href="https://github.com/Klectr/zimer#self-hosting"');
  });

  test("direct visit gets the full app layout", async () => {
    const { handleWeb } = setup();
    const res = await getSettings(handleWeb, false);
    expect(res!.status).toBe(200);
    const body = await res!.text();
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("<title>Settings</title>");
    expect(body).toContain('class="ui-settings-page"');
    expect(body).toContain('class="ui-settings-stack"');
    expect(body).toContain('id="biz-profile"');
  });
});

/** #1338: the cleaned-up settings sections — payment terms description lives
 *  with its select; About pairs the version with the update check; Your data
 *  is three labelled rows with specific accessible names. */
async function settingsBodyHtml(): Promise<string> {
  const { handleWeb } = setup();
  return await (await getSettings(handleWeb, true))!.text();
}

describe("settings order", () => {
  test("self-hosted: profile, preferences, data, about, then support", async () => {
    const body = await settingsBodyHtml();
    const at = (n: string) => body.indexOf(n);
    expect(at('id="biz-profile"')).toBeGreaterThan(-1);
    expect(at('id="preferences"')).toBeGreaterThan(at('id="biz-profile"'));
    expect(at('id="your-data"')).toBeGreaterThan(at('id="preferences"'));
    expect(at('id="about"')).toBeGreaterThan(at('id="your-data"'));
    expect(at("ui-settings-support")).toBeGreaterThan(at('id="about"'));
  });

  test("hosted: billing sits right after the profile", async () => {
    const { handleWeb } = setup(() => `<section id="billing-marker">BILLING</section>`);
    const body = await (await getSettings(handleWeb, true))!.text();
    const at = (n: string) => body.indexOf(n);
    expect(at('id="billing-marker"')).toBeGreaterThan(at('id="biz-profile"'));
    expect(at('id="preferences"')).toBeGreaterThan(at('id="billing-marker"'));
    expect(at('id="update-section"')).toBeGreaterThan(at('id="your-data"'));
  });
});

describe("settings cleanup (#1338)", () => {
  test("the terms description sits inside the payment-terms field group", async () => {
    const body = await settingsBodyHtml();
    const group = body.slice(body.indexOf('<div class="ui-settings-field">'));
    expect(group.indexOf('id="bp-terms"')).toBeGreaterThan(-1);
    expect(group.indexOf('class="terms-desc')).toBeGreaterThan(group.indexOf('id="bp-terms"'));
    expect(group.indexOf('class="terms-desc')).toBeLessThan(group.indexOf('id="bp-payment_instructions"'));
  });

  test("About pairs the version status with Check for updates", async () => {
    const body = await settingsBodyHtml();
    const row = body.slice(body.indexOf('<div class="ui-about-row">'));
    expect(row.indexOf('id="update-status"')).toBeGreaterThan(-1);
    expect(row.indexOf('id="check-updates-btn"')).toBeGreaterThan(row.indexOf('id="update-status"'));
    expect(body).not.toContain("One Bun process and one SQLite file.");
  });

  test("Your data is three rows, each with a specific download name", async () => {
    const body = await settingsBodyHtml();
    expect((body.match(/class="ui-data-row"/g) || []).length).toBe(3);
    for (const [href, name] of [["/backup", "Download backup"], ["/export/entries.csv", "Download entries CSV"], ["/export/invoices.csv", "Download Zinvoices CSV"]]) {
      expect(body).toMatch(new RegExp(`href="${href.replace(/[./]/g, "\\$&")}"[^>]*aria-label="${name}"|aria-label="${name}"[^>]*href="${href.replace(/[./]/g, "\\$&")}"`));
    }
  });
});
