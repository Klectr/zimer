/** #731: hosted landing page — renders 200 only for a logged-out visitor on
 *  GET / in HOSTED mode; self-host and authed hosted visitors fall through
 *  (null), so / keeps its current behavior for both. Copy is short and
 *  stays within the shipped offer: $12/month, 14-day free trial. */
import { describe, expect, test } from "bun:test";
import { createLandingViews } from "../views/landing.ts";
import { posthogSnippet } from "../views/layout.ts";
import { createLandingRouter } from "./landing.ts";
import { html } from "../lib/http.ts";

function setup(hosted: boolean, authed: boolean) {
  const { landingPage } = createLandingViews();
  const { handleLanding } = createLandingRouter({
    hosted,
    visitorAuthed: () => authed,
    shareOrigin: () => "https://example.com", /* #865 */
    landingPage,
    html,
  });
  return { handleLanding };
}

async function get(hosted: boolean, authed: boolean, path: string, method = "GET") {
  const { handleLanding } = setup(hosted, authed);
  const req = new Request(`http://localhost${path}`, { method });
  const res = await handleLanding(req, new URL(req.url), path, method);
  return { res, body: res ? await res.text() : null };
}

describe("#731: landing page router", () => {
  test("hosted logged-out GET / -> 200 landing, CTA to /signup", async () => {
    const { res, body } = await get(true, false, "/");
    expect(res!.status).toBe(200);
    expect(body).toContain("<title>Zimer: the time tracker that turns your hours into an invoice</title>");
    expect(body).toContain("The time tracker that turns your hours into an invoice.");
    expect(body).toContain("Your Zimer is your Zinvoice.");
    expect(body).toContain("$12/month");
    expect(body).toContain("14-day free trial");
    expect(body).toContain('href="/signup"');
    expect(body).toContain('href="#pricing"');
    /* #1017: the repo is public — the Self-host plan links out to it. */
    expect(body).toContain('href="https://github.com/Klectr/zimer"');
    expect(body).toContain("View on GitHub");
    expect(body).toContain("support@klectr.dev");
  });

  test("#865: share meta tags use absolute URLs from shareOrigin", async () => {
    const { res, body } = await get(true, false, "/");
    expect(res!.status).toBe(200);
    expect(body).toContain(
      '<meta property="og:image" content="https://example.com/static/og-image-v3.png">'
    );
    expect(body).toContain(
      '<meta property="og:url" content="https://example.com/">'
    );
    expect(body).toContain(
      '<meta name="twitter:image" content="https://example.com/static/og-image-v3.png">'
    );
    /* #1061: description names the buyer and the offer; og stays in sync. */
    expect(body).toContain(
      '<meta name="description" content="Time tracking for freelancers and solo work that turns hours into an invoice. Self-host it free forever, or hosted at $12/month flat with a 14-day free trial.">'
    );
    expect(body).toContain(
      '<meta property="og:description" content="Time tracking for freelancers and solo work that turns hours into an invoice. Self-host it free forever, or hosted at $12/month flat with a 14-day free trial.">'
    );
    /* #1053: declared dimensions and alt text travel with the image. */
    expect(body).toContain('<meta property="og:image:width" content="1200">');
    expect(body).toContain('<meta property="og:image:height" content="630">');
    expect(body).toContain('<meta property="og:image:alt"');
    expect(body).toContain('<meta name="twitter:image:alt"');
  });

  test("#1062: the page names the buyer and the wedge", async () => {
    const { res, body } = await get(true, false, "/");
    expect(res!.status).toBe(200);
    expect(body).toContain("Built for freelancers and solo work");
    expect(body).toContain("Freelancers, contractors, and solo shops.");
    expect(body).toContain("Self-hosted time tracking on your own server");
    expect(body).toContain("The bill stays the same");
    expect(body).toContain("never move behind a surprise paywall");
  });

  test("hosted authed visitor falls through (null) — / keeps serving the app", async () => {
    const { res, body } = await get(true, true, "/");
    expect(res).toBeNull();
    expect(body).toBeNull();
  });

  test("self-host GET / falls through (null) — / keeps bouncing to /login", async () => {
    const { res, body } = await get(false, false, "/");
    expect(res).toBeNull();
    expect(body).toBeNull();
  });

  test("non-root paths and non-GET methods fall through", async () => {
    expect((await get(true, false, "/pricing")).res).toBeNull();
    expect((await get(true, false, "/login")).res).toBeNull();
    expect((await get(true, false, "/", "POST")).res).toBeNull();
  });
});

describe("#731: landing page view", () => {
  test("no em-dashes, no emoji, minimal public chrome", () => {
    const { landingPage } = createLandingViews();
    const page = landingPage("https://example.com");
    expect(page).not.toContain("—");
    expect(page).not.toContain("–");
    expect(page).not.toContain('content="noindex"');
    expect(page).toContain('<link rel="canonical" href="https://example.com/">');
    expect(page).toContain("/static/style.css");
    expect(page).toContain("/static/utm.js");
  });

  test("#998: analytics head renders only when the thunk supplies it", () => {
    const bare = createLandingViews().landingPage("https://example.com");
    expect(bare).not.toContain("posthog");
    const wired = createLandingViews(() => posthogSnippet("phc_test123", "https://us.i.posthog.com", null, { landing: true })).landingPage("https://example.com");
    expect(wired).toContain("phc_test123");
    expect(wired).toContain("capture_pageview: true");
  });
});

describe("#1044: hero leads with the promise and the product", () => {
  test("the app screenshot renders inside the hero section", async () => {
    const { body } = await get(true, false, "/");
    const hero = body!.slice(body!.indexOf('<section class="landing-hero">'), body!.indexOf("</section>"));
    expect(hero).toContain("landing-shot");
    expect(hero).toContain("The time tracker that turns your hours into an invoice.");
  });
});

describe("#1050: landing structured data", () => {
  test("JSON-LD parses and names the Organization and WebSite", () => {
    const { landingPage } = createLandingViews();
    const page = landingPage("https://example.com");
    const m = page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (!m) throw new Error("no JSON-LD block");
    const data = JSON.parse(m[1]);
    const types = data["@graph"].map((n: any) => n["@type"]);
    expect(types).toEqual(["Organization", "WebSite"]);
    expect(data["@graph"][0].url).toBe("https://example.com/");
    expect(data["@graph"][0].sameAs).toEqual(["https://github.com/Klectr/zimer"]);
  });
});
