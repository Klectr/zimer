/** #731: hosted landing page — renders 200 only for a logged-out visitor on
 *  GET / in HOSTED mode; self-host and authed hosted visitors fall through
 *  (null), so / keeps its current behavior for both. Copy is short and
 *  stays within the shipped offer: $12/month, 14-day free trial. */
import { describe, expect, test } from "bun:test";
import { createLandingViews } from "../views/landing.ts";
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
    expect(body).toContain("<title>Zimer: your Zimer is your Zinvoice</title>");
    expect(body).toContain("Your Zimer is your Zinvoice.");
    expect(body).toContain("$12/month");
    expect(body).toContain("14-day free trial");
    expect(body).toContain('href="/signup"');
    expect(body).toContain('href="#pricing"');
    expect(body).toContain("support@klectr.dev");
  });

  test("#865: share meta tags use absolute URLs from shareOrigin", async () => {
    const { res, body } = await get(true, false, "/");
    expect(res!.status).toBe(200);
    expect(body).toContain(
      '<meta property="og:image" content="https://example.com/static/og-image.png">'
    );
    expect(body).toContain(
      '<meta property="og:url" content="https://example.com/">'
    );
    expect(body).toContain(
      '<meta name="twitter:image" content="https://example.com/static/og-image.png">'
    );
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
    expect(page).toContain('content="noindex"');
    expect(page).toContain("/static/style.css");
  });
});
