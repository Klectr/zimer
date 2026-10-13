/** #884: accent theme — the app layout's <head> carries the theme override
 *  so the whole app re-themes without touching the stylesheet. */
import { describe, expect, test } from "bun:test";
import type { Statement } from "bun:sqlite";
import { themeCss, themeKey } from "../lib/theme.ts";
import { createLayoutViews, trialBannerHtml, posthogSnippet } from "./layout.ts";
import type { Billing } from "../lib/billing.ts";

const noRunning = { get: () => null } as unknown as Statement;

describe("layout theme override (#884)", () => {
  test("the head carries the theme override after the stylesheet", () => {
    const { layout } = createLayoutViews(noRunning, () => themeCss(themeKey("crimson")));
    const head = layout("T", "body");
    const cssIdx = head.indexOf("/static/style.css");
    const styleIdx = head.indexOf('<style id="theme-style">');
    expect(cssIdx).toBeGreaterThan(-1);
    expect(styleIdx).toBeGreaterThan(cssIdx);
    expect(head).toContain("--primary:#ffb4a8");
  });
  test("default theme emits pumpkin values", () => {
    const { layout } = createLayoutViews(noRunning, () => themeCss(themeKey("")));
    expect(layout("T", "body")).toContain("--primary:#fb923c");
  });
  test("no getter (public 404 pages) still renders the empty tag", () => {
    const { layout } = createLayoutViews(noRunning);
    expect(layout("T", "body")).toContain('<style id="theme-style"></style>');
  });
});

/** #903: the entry edit dialog shell rides in the layout next to the
 *  settings dialog, so the timer page's edit buttons have a modal target. */
describe("layout entry edit dialog (#903)", () => {
  test("layout carries the hidden entry dialog scrim", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    expect(body).toContain('id="entry-scrim"');
    expect(body).toContain('id="entry-dialog-body"');
    expect(body).toContain('aria-labelledby="entry-dialog-title"');
  });
});

/** #923: trial-expiry nudge banner — pure view logic + layout wiring. */

const DAY = 86400000;
const stubBilling = (overrides: Partial<Billing> = {}) =>
  ({
    getSubscriptionStatus: () => null,
    billingActive: () => true,
    ...overrides,
  } as unknown as Billing);
const baseOpts = (createdDaysAgo: number) => ({
  hosted: true,
  billing: stubBilling(),
  userId: 7,
  userCreatedAtMs: Date.now() - createdDaysAgo * DAY,
});

describe("trialBannerHtml", () => {
  test("self-host never shows it", () => {
    expect(trialBannerHtml({ ...baseOpts(12), hosted: false })).toBe("");
  });

  test("more than 3 days left -> hidden", () => {
    expect(trialBannerHtml(baseOpts(10))).toBe(""); /* 4 days left */
  });

  test("3/2/1 days left -> 'in 3 days' / 'in 2 days' / 'tomorrow'", () => {
    expect(trialBannerHtml(baseOpts(11))).toContain("Your trial ends in 3 days");
    expect(trialBannerHtml(baseOpts(12))).toContain("Your trial ends in 2 days");
    expect(trialBannerHtml(baseOpts(13))).toContain("Your trial ends tomorrow");
  });

  test("CTA posts to /billing/checkout with the pumpkin filled button", () => {
    const html = trialBannerHtml(baseOpts(12));
    expect(html).toContain('method="POST" action="/billing/checkout"');
    expect(html).toContain('class="md-filled-button"');
    expect(html).toContain("Subscribe · $12/month");
  });

  test("dismiss button is labeled and client-side", () => {
    const html = trialBannerHtml(baseOpts(12));
    expect(html).toContain('aria-label="Dismiss trial reminder"');
    expect(html).toContain("zimer-trial-banner-dismissed");
  });

  test("subscription row exists -> hidden (not a pre-checkout trial)", () => {
    const billing = stubBilling({
      getSubscriptionStatus: () => ({ user_id: 7 }) as any,
    });
    expect(
      trialBannerHtml({ hosted: true, billing, userId: 7, userCreatedAtMs: Date.now() - 12 * DAY })
    ).toBe("");
  });

  test("trial window elapsed -> hidden", () => {
    const billing = stubBilling({ billingActive: () => false });
    expect(
      trialBannerHtml({ hosted: true, billing, userId: 7, userCreatedAtMs: Date.now() - 20 * DAY })
    ).toBe("");
  });
});

describe("createLayoutViews trialBanner thunk", () => {
  const banner = "<div>TRIAL-BANNER</div>";
  test("renders the banner between the app bar and the chrome when provided", () => {
    const { layout } = createLayoutViews(noRunning, undefined, () => banner);
    const html = layout("Today", "<p>body</p>", "timer", true);
    expect(html).toContain(banner);
    const headerIdx = html.indexOf("</header>");
    const chromeIdx = html.indexOf('<div class="app-chrome">');
    const bannerIdx = html.indexOf(banner);
    expect(bannerIdx).toBeGreaterThan(headerIdx);
    expect(bannerIdx).toBeLessThan(chromeIdx);
  });

  test("no banner markup when the thunk is omitted", () => {
    const { layout } = createLayoutViews(noRunning);
    expect(layout("Today", "<p>body</p>", "timer", true)).not.toContain("trial-banner");
  });
});

describe("PostHog snippet (#928)", () => {
  test("no snippet when the thunk is omitted", () => {
    const { layout } = createLayoutViews(noRunning);
    const html = layout("T", "body");
    expect(html).not.toContain("posthog");
    expect(html).not.toContain("/static/analytics.js");
  });

  test("snippet renders with key, host, and user identify", () => {
    const { layout } = createLayoutViews(
      noRunning,
      undefined,
      undefined,
      () => posthogSnippet("phc_test123", "https://us.i.posthog.com", 42)
    );
    const html = layout("T", "body");
    expect(html).toContain("phc_test123");
    expect(html).toContain("https://us.i.posthog.com");
    expect(html).toContain('ph.identify("42")');
    expect(html).toContain("autocapture: false");
    expect(html).toContain("capture_pageview: false");
    expect(html).toContain("/static/analytics.js");
  });

  test("snippet omits identify when userId is null", () => {
    const html = posthogSnippet("phc_test123", "https://us.i.posthog.com", null);
    expect(html).not.toContain("ph.identify");
  });

  test("key is JSON-escaped, not interpolated raw", () => {
    const html = posthogSnippet('phc_"><script>alert(1)</script>', "https://us.i.posthog.com", 1);
    expect(html).not.toContain('"><script>alert(1)</script>');
    expect(html).not.toContain("</script><script>");
    expect(html).toContain("phc_");
  });
});

/** #949: on compact screens the icon-only app-bar actions are undiscoverable,
 *  so a hamburger opens a labeled navigation drawer carrying the same four
 *  actions as icon+text rows. Desktop keeps the #654 icon row. */
describe("layout navigation drawer (#949)", () => {
  test("app bar carries the hamburger and the desktop icon row", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    expect(body).toContain('id="appbar-menu-btn"');
    expect(body).toContain('id="appbar-settings-btn"');
  });

  test("drawer carries all four actions as labeled rows", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    expect(body).toContain('id="nav-drawer-scrim"');
    expect(body).toContain('id="drawer-settings-btn"');
    expect(body).toContain("<span>Settings</span>");
    expect(body).toContain("<span>Export entries CSV</span>");
    expect(body).toContain("<span>Download backup</span>");
    expect(body).toContain("<span>Log out</span>");
  });

  test("drawer logout is a POST form, like the app bar's", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    const drawer = body.slice(body.indexOf('id="nav-drawer-scrim"'));
    expect(drawer).toContain('<form method="POST" action="/logout" class="nav-drawer-logout">');
  });
});
