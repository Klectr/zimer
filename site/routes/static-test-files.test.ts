import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebRouter } from "./web.ts";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "tk-static-"));
  writeFileSync(join(dir, "app.js"), "console.log('ok');");
  writeFileSync(join(dir, "dialog.test.ts"), "secret test source");
  writeFileSync(join(dir, "shortcut.test.ts"), "secret test source");
  const noop = () => "";
  const tenant = { notFoundPage: () => "not-found", errorPage: () => "error" } as any;
  const { handleWeb } = createWebRouter({
    getTenant: () => tenant,
    STATIC_DIR: dir, TOKEN: "t",
    authedPage: () => false,
    tokensEqual: (a: string, b: string) => a === b,
    html: (body: string, status = 200) => new Response(body, { status }),
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    isHtmx: () => false,
    csvResponse: (f: string) => new Response(f),
    shareOrigin: () => "",
    PORT: 3000,
    loginPage: noop, signupPage: noop, hostedLoginPage: noop,
    HOSTED: false, accounts: null,
    changelogPage: () => "", termsPage: () => "", privacyPage: noop,
    noSuchInvoicePage: noop, rateLimitPage: noop,
    notFoundPage: () => "not-found", errorPage: () => "error",
    invoicePdf: () => new Uint8Array(), stripeConfigured: () => false,
    workspaceEmpty: () => false, demoIds: () => [], seedDemoData: () => {},
    removeDemoData: () => {}, entryToJson: (e: any) => e,
  } as any);
  return { handleWeb };
}

async function get(handleWeb: any, path: string) {
  const req = new Request(`http://x${path}`);
  return handleWeb(req, new URL(req.url), path, "GET");
}

describe("static route test files (#1246)", () => {
  test("normal static asset is served", async () => {
    const { handleWeb } = setup();
    const res = await get(handleWeb, "/static/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("console.log");
  });

  test("test source files return 404", async () => {
    const { handleWeb } = setup();
    for (const path of ["/static/dialog.test.ts", "/static/shortcut.test.ts"]) {
      const res = await get(handleWeb, path);
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("secret test source");
    }
  });
});
