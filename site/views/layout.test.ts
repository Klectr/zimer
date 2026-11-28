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
  test("the stylesheet URL carries its content-hash version (#993)", () => {
    const { layout } = createLayoutViews(noRunning, () => "");
    const head = layout("T", "body");
    expect(head).toMatch(/href="\/static\/style\.css\?v=[0-9a-f]{12}"/);
    expect(head).toMatch(/src="\/static\/dialog\.js\?v=[0-9a-f]{12}"/);
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

/** #1177: the lazy shell dialogs reset their body on open, so a stale form
 *  from the previous open can't paint or be submitted while the next
 *  fragment loads. Same treatment as the client settings dialog. */
describe("layout lazy dialogs reset their body on open (#1177)", () => {
  test("entry dialog body starts on the loading placeholder", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    expect(body).toContain('<div id="entry-dialog-body"><p class="muted">Loading…</p></div>');
  });

  test("entry opener resets the body before the dialog shows and the fragment load", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    const script = body.indexOf("getElementById('entry-dialog-body')");
    const open = body.indexOf("function open(id){", script);
    const reset = body.indexOf("body.innerHTML='<p class=\"muted\">Loading…</p>';", open);
    const show = body.indexOf("scrim.hidden=false;", open);
    const load = body.indexOf("htmx.ajax('GET','/entries/'+id+'/edit','#entry-dialog-body');", open);
    expect(open).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(open);
    expect(show).toBeGreaterThan(reset);
    expect(load).toBeGreaterThan(reset);
  });
});

/** #1189: a lazy load that lands after a close/reopen for another record
 *  must not swap in — each opener bumps a load generation, the request is
 *  stamped with it, and a stale stamp is dropped at beforeSwap. */
describe("layout lazy dialogs drop stale loads (#1189)", () => {
  test("entry opener bumps the load generation before the fragment load", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    const script = body.indexOf("getElementById('entry-dialog-body')");
    const open = body.indexOf("function open(id){", script);
    const bump = body.indexOf("loadGen++;", open);
    const load = body.indexOf("htmx.ajax('GET','/entries/'+id+'/edit','#entry-dialog-body');", open);
    expect(open).toBeGreaterThan(-1);
    expect(bump).toBeGreaterThan(open);
    expect(load).toBeGreaterThan(bump);
  });

  test("entry loads are stamped at request time and dropped before swap when stale", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    expect(body).toContain("e.detail.xhr.tkEntryGen=loadGen;");
    expect(body).toContain("if(g!=null&&g!==loadGen) e.detail.shouldSwap=false;");
  });

  test("the entry dialog bumps the load generation on close too", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    const eScript = body.indexOf("getElementById('entry-dialog-body')");
    const eClose = body.indexOf("function closeDialog(refocus){", eScript);
    expect(eClose).toBeGreaterThan(-1);
    expect(body.indexOf("loadGen++;", eClose)).toBeGreaterThan(eClose);
  });

  test("the entry dialog's close captures the generation so a reopen during the fade cancels the hide (#1192)", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    const eScript = body.indexOf("getElementById('entry-dialog-body')");
    const eClose = body.indexOf("function closeDialog(refocus){", eScript);
    expect(eClose).toBeGreaterThan(-1);
    const eBump = body.indexOf("loadGen++;", eClose);
    const eCapture = body.indexOf("var gen=loadGen, done=false,", eClose);
    expect(eCapture).toBeGreaterThan(eBump);
    expect(body.indexOf("if(done||gen!==loadGen) return;", eClose)).toBeGreaterThan(eCapture);
  });
});

/** #1195: the nav drawer's close fade gets the #1192 treatment — a reopen
 *  during the fade bumps the drawer generation, so the stale finish()
 *  captured at close time no-ops instead of hiding the reopened drawer. */
describe("layout nav drawer close fade (#1195)", () => {
  test("drawer opener and close both bump the drawer generation", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    const script = body.indexOf("getElementById('nav-drawer-scrim')");
    const open = body.indexOf("function open(){", script);
    expect(open).toBeGreaterThan(-1);
    expect(body.indexOf("drawerGen++;", open)).toBeGreaterThan(open);
    const close = body.indexOf("function close(refocus){", script);
    expect(close).toBeGreaterThan(-1);
    expect(body.indexOf("drawerGen++;", close)).toBeGreaterThan(close);
  });

  test("drawer close captures the generation so a reopen during the fade cancels the hide", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    const script = body.indexOf("getElementById('nav-drawer-scrim')");
    const close = body.indexOf("function close(refocus){", script);
    expect(close).toBeGreaterThan(-1);
    const bump = body.indexOf("drawerGen++;", close);
    const capture = body.indexOf("var gen=drawerGen, done=false,", close);
    expect(capture).toBeGreaterThan(bump);
    expect(body.indexOf("if(done||gen!==drawerGen) return;", close)).toBeGreaterThan(capture);
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

  test("CTA posts to /billing/checkout with the pumpkin primary button", () => {
    const html = trialBannerHtml(baseOpts(12));
    expect(html).toContain('method="POST" action="/billing/checkout"');
    expect(html).toContain('class="ui-btn ui-btn-primary"');
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
  test("renders the banner in the content column above main when provided", () => {
    const { layout } = createLayoutViews(noRunning, undefined, () => banner);
    const html = layout("Today", "<p>body</p>", "timer", true);
    expect(html).toContain(banner);
    const sidebarIdx = html.indexOf('<aside class="ui-side">');
    const mainIdx = html.indexOf('<main id="main"');
    const bannerIdx = html.indexOf(banner);
    expect(bannerIdx).toBeGreaterThan(sidebarIdx);
    expect(bannerIdx).toBeLessThan(mainIdx);
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
    expect(html).toContain("capture_exceptions: true"); /* #1023 */
    expect(html).toContain("request_batching: false");
    expect(html).toContain('defaults: "2026-05-30"');
    expect(html).toContain('localStorage.getItem("zimer_utm")');
    expect(html).toContain('localStorage.removeItem("zimer_utm")');
    expect(html).toContain('ph.capture("$set", { $set_once: u.p })');
    expect(html).toContain("/static/analytics.js");
  });

  test("#981: utm stash script reads the utm params and stores them", async () => {
    const src = await Bun.file("site/static/utm.js").text();
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"])
      expect(src).toContain(`"${k}"`);
    expect(src).toContain('localStorage.setItem("zimer_utm"');
    expect(src).toContain("Date.now()");
    expect(src).toContain("URLSearchParams");
  });

  test("snippet omits identify when userId is null", () => {
    const html = posthogSnippet("phc_test123", "https://us.i.posthog.com", null);
    expect(html).not.toContain("ph.identify");
  });

  test("#998/#1001: landing snippet captures pageviews and clicks, recording on", () => {
    const html = posthogSnippet("phc_test123", "https://us.i.posthog.com", null, { landing: true });
    expect(html).toContain("autocapture: true");
    expect(html).toContain("capture_pageview: true");
    expect(html).toContain("capture_exceptions: true"); /* #1023 */
    expect(html).toContain("disable_session_recording: false");
    expect(html).toContain('person_profiles: "identified_only"');
    expect(html).not.toContain("ph.identify");
    expect(html).not.toContain("zimer_utm");
  });

  test("#1438: both modes pin surveys, dead clicks and web vitals off in init", () => {
    for (const html of [
      posthogSnippet("phc_test123", "https://us.i.posthog.com", 42),
      posthogSnippet("phc_test123", "https://us.i.posthog.com", null, { landing: true }),
    ]) {
      expect(html).toContain("disable_surveys: true");
      expect(html).toContain("capture_dead_clicks: false");
      expect(html).toContain("capture_performance: false");
    }
  });

  test("#1239: app snippet disables session recording in init and keeps capture off", () => {
    const html = posthogSnippet("phc_test123", "https://us.i.posthog.com", 42);
    expect(html).toContain("disable_session_recording: true");
    expect(html).not.toContain("person_profiles");
    expect(html).toContain("autocapture: false");
    expect(html).toContain("capture_pageview: false");
  });

  test("key is JSON-escaped, not interpolated raw", () => {
    const html = posthogSnippet('phc_"><script>alert(1)</script>', "https://us.i.posthog.com", 1);
    expect(html).not.toContain('"><script>alert(1)</script>');
    expect(html).not.toContain("</script><script>");
    expect(html).toContain("phc_");
  });
});

/** #949: on compact screens the icon-only actions are undiscoverable,
 *  so a hamburger opens a labeled navigation drawer carrying the same four
 *  actions as icon+text rows. #1223 trimmed both the drawer and the sidebar
 *  footer to Settings (page link) + Log out. */
describe("layout navigation drawer (#949)", () => {
  test("compact head carries the hamburger; the sidebar footer keeps only Log out (#1223)", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body", "timer");
    expect(body).toContain('id="appbar-menu-btn"');
    expect(body).not.toContain('id="appbar-settings-btn"');
    const foot = body.slice(body.indexOf('<div class="ui-side-foot">'), body.indexOf("</aside>"));
    expect(foot).toContain('action="/logout"');
    expect(foot).not.toContain('href="/backup"');
    expect(foot).not.toContain('href="/export/entries.csv"');
    expect(body).toContain('<aside class="ui-side">');
    expect(body).toContain('class="ui-navitem is-active" aria-current="page"');
    expect(body).toContain('href="/settings"');
  });

  test("drawer carries Settings (a link to the page) and Log out (#1223)", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    const drawer = body.slice(body.indexOf('id="nav-drawer-scrim"'), body.indexOf("</nav>", body.indexOf('id="nav-drawer-scrim"')));
    expect(drawer).toContain('<a class="nav-drawer-row" href="/settings">');
    expect(drawer).toContain("<span>Settings</span>");
    expect(drawer).toContain("<span>Log out</span>");
    expect(drawer).not.toContain("Export entries CSV");
    expect(drawer).not.toContain("Download backup");
  });

  test("there is one Settings surface: no settings dialog in the shell (#1223)", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    expect(body).not.toContain('id="settings-scrim"');
    /* #1335: toasts come from the server's HX-Trigger tk-toast event. */
    expect(body).toContain("document.body.addEventListener('tk-toast',function(e){");
    expect(body).toContain("window.tkSnackbar(msg);");
    expect(body).not.toContain("elt.id==='daily-target-form'");
  });

  test("drawer header is the spec headline — no close button", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    const drawer = body.slice(body.indexOf('id="nav-drawer-scrim"'), body.indexOf("</nav>", body.indexOf('id="nav-drawer-scrim"')));
    expect(drawer).toContain('<div class="nav-drawer-head">Menu</div>');
    expect(drawer).not.toContain('id="nav-drawer-close"');
  });

  test("the demo row thunk renders inside the drawer", () => {
    const { layout } = createLayoutViews(noRunning, undefined, undefined, undefined,
      () => `<form method="POST" action="/demo/load" class="nav-drawer-form nav-drawer-demo"><button class="nav-drawer-row" type="submit"><span>Load demo data</span></button></form>`);
    const body = layout("T", "body");
    const drawer = body.slice(body.indexOf('id="nav-drawer-scrim"'), body.indexOf("</nav>", body.indexOf('id="nav-drawer-scrim"')));
    expect(drawer).toContain('action="/demo/load"');
    expect(drawer).toContain("<span>Load demo data</span>");
  });

  test("drawer logout is a POST form, like the app bar's", () => {
    const { layout } = createLayoutViews(noRunning);
    const body = layout("T", "body");
    const drawer = body.slice(body.indexOf('id="nav-drawer-scrim"'));
    expect(drawer).toContain('<form method="POST" action="/logout" class="nav-drawer-logout">');
  });
});

/** Same template-literal trap in the entry-dialog script: escaped path
 *  regexes must survive into the page. */
describe("layout inline scripts parse", () => {
  test("every inline script parses", () => {
    const { layout } = createLayoutViews(noRunning);
    const html = layout("T", "body");
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});

describe("client_tz on every POST (#1081)", () => {
  test("htmx posts and plain form posts both carry the browser's zone", () => {
    const html = createLayoutViews(noRunning).layout("T", "<p>x</p>");
    expect(html).toContain("e.detail.parameters['client_tz']=tz");
    expect(html).toContain("put(f,'client_tz',tz)");
  });
});

describe("client_day script", () => {
  test("the layout ships the script that adds the local day to every POST", () => {
    const html = createLayoutViews(noRunning).layout("T", "<p>x</p>");
    expect(html).toContain("htmx:configRequest");
    expect(html).toContain("e.detail.parameters['client_day']=day()");
    expect(html).toContain("put(f,'client_day',day())");
  });
});
