/** #729: pricing page — renders 200 in both HOSTED modes; hosted CTA
 *  points to /signup, self-host shows the free-forever note; pricing is
 *  linked from the hosted login and signup pages. */
import { describe, expect, test } from "bun:test";
import { createPricingViews } from "../views/pricing.ts";
import { createPricingRouter } from "./pricing.ts";
import { createPublicViews } from "../views/public.ts";
import { html } from "../lib/http.ts";

function setup(hosted: boolean) {
  const { pricingPage } = createPricingViews({ hosted });
  const { handlePricing } = createPricingRouter({
    hosted,
    pricingPage,
    html,
  });
  return { handlePricing };
}

async function get(hosted: boolean, path: string, method = "GET") {
  const { handlePricing } = setup(hosted);
  const req = new Request(`http://localhost${path}`, { method });
  const res = await handlePricing(req, new URL(req.url), path, method);
  return { res, body: res ? await res.text() : null };
}

describe("#729: pricing page", () => {
  test("non-pricing paths return null (fall through)", async () => {
    const { res, body } = await get(true, "/timer");
    expect(res).toBeNull();
    expect(body).toBeNull();
  });

  test("hosted: GET /pricing -> 200, CTA points to /signup", async () => {
    const { res, body } = await get(true, "/pricing");
    expect(res!.status).toBe(200);
    expect(body).toContain("Start free trial");
    expect(body).toContain('href="/signup"');
    expect(body).not.toContain("free forever.");
  });

  test("self-host: GET /pricing -> 200, free-forever note, no signup CTA", async () => {
    const { res, body } = await get(false, "/pricing");
    expect(res!.status).toBe(200);
    expect(body).toContain("You're self-hosting — free forever.");
    expect(body).not.toContain('href="/signup"');
  });

  test("both modes: one tier, $12/month, 14-day trial, whole-app included", async () => {
    for (const hosted of [true, false]) {
      const { res, body } = await get(hosted, "/pricing");
      expect(res!.status).toBe(200);
      expect(body).toContain("$12");
      expect(body).toContain("/month");
      expect(body).toContain("14-day free trial");
      expect(body).toContain("timer, calendar, invoices, clients");
      expect(body).toContain("Self-host");
      expect(body).toContain("free forever");
      expect(body).toContain("<title>Pricing · Zimer</title>");
    }
  });

  test("hosted login page links to /pricing", () => {
    const { hostedLoginPage } = createPublicViews({
      getInvoice: () => null,
      invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      invoiceDocumentHtml: () => "",
      ensurePublicToken: () => "",
    });
    expect(hostedLoginPage()).toContain('href="/pricing"');
  });

  test("signup page links to /pricing", () => {
    const { signupPage } = createPublicViews({
      getInvoice: () => null,
      invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
      invoiceDocumentHtml: () => "",
      ensurePublicToken: () => "",
    });
    expect(signupPage()).toContain('href="/pricing"');
  });
});
