/** App chrome views: layout, public shell, styled error pages, account menu.
 *  layout() reads the running-timer flag through the prepared qRunning
 *  statement passed in; createLayoutViews() keeps every existing call site
 *  working unchanged. */

import type { Statement } from "bun:sqlite";
import { esc } from "../lib/format.ts";
import { ICONS, icon, logo } from "../lib/icons.ts";
import { TRIAL_NUDGE_DAYS, trialDaysLeft, type Billing } from "../lib/billing.ts";

/** #928: PostHog product analytics snippet. Rendered in <head> only when
 *  POSTHOG_KEY is set (self-hosters opt in by configuring it; the hosted
 *  instance sets it in start.sh). In the app, autocapture and pageviews are
 *  off — we only send the explicit timer → invoice funnel events from
 *  analytics.js. The user is identified by stable account ID (never email);
 *  posthog.reset() fires on logout so the next browser user doesn't inherit
 *  the identity. #998: landing mode flips pageview + autocapture on so ad
 *  arrivals and CTA clicks are visible, with no person profiles for
 *  anonymous visitors. #1001: session recording is enabled in landing
 *  mode (owner decision) so landing visits produce replays. */
export function posthogSnippet(key: string, host: string, userId: number | null, opts?: { landing?: boolean }): string {
  const landing = opts?.landing === true;
  /* JSON.stringify alone doesn't neutralize </script> inside the key — escape
     angle brackets so a malicious key can't break out of the script block. */
  const jsStr = (s: string) => JSON.stringify(s).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  return `<script>
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPrompt getFeatureFlags getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init(${jsStr(key)}, {
  api_host: ${jsStr(host)},
  defaults: "2026-05-30",
  request_batching: false,
  autocapture: ${landing},
  capture_pageview: ${landing},
  capture_exceptions: true, /* #1023: error tracking — unhandled errors + rejections become $exception events */
${landing ? `  disable_session_recording: false,
  person_profiles: "identified_only",
` : ""}  loaded: function(ph) { ${userId !== null ? `ph.identify(${jsStr(String(userId))}); try { var u = JSON.parse(localStorage.getItem("zimer_utm") || "null"); if (u) { localStorage.removeItem("zimer_utm"); if (u.p && Date.now() - (u.t || 0) < 2592000000) ph.capture("$set", { $set_once: u.p }); } } catch (e) {}` : ""} },
});
</script>`;
}

/** #923: trial-expiry nudge for the app layout — hosted pre-checkout trials
 *  with ≤3 days left. Dismissible (localStorage; the trial ends in days
 *  anyway, so the dismissal only needs to outlive the window). The
 *  Subscribe CTA posts straight to /billing/checkout: GET /billing 302s
 *  entitled users back to the app, so the wall can't be the link target.
 *  Pure function of its inputs — the per-tenant thunk in server.ts supplies
 *  the user. Returns "" when the banner must not show. */
export function trialBannerHtml(opts: {
  hosted: boolean;
  billing: Billing;
  userId: number;
  userCreatedAtMs: number | null;
  nowMs?: number;
}): string {
  if (!opts.hosted) return "";
  const daysLeft = trialDaysLeft(
    opts.billing,
    opts.userId,
    opts.userCreatedAtMs,
    opts.nowMs
  );
  if (daysLeft === null || daysLeft > TRIAL_NUDGE_DAYS) return "";
  const when = daysLeft === 1 ? "tomorrow" : `in ${daysLeft} days`;
  return `<div class="trial-banner" id="trial-banner" role="region" aria-label="Trial expiring soon">
    <p class="md-body-medium trial-banner-text">Your trial ends ${when} — subscribe to keep Zimer running.</p>
    <form class="trial-banner-cta" method="POST" action="/billing/checkout">
      <button class="md-filled-button" type="submit">Subscribe · $12/month</button>
    </form>
    <button class="md-icon-button" type="button" data-trial-banner-close aria-label="Dismiss trial reminder">${icon("close")}</button>
  </div>
  <script>(function(){
    var KEY="zimer-trial-banner-dismissed", el=document.getElementById("trial-banner");
    if(!el) return;
    try { if(localStorage.getItem(KEY)==="1") { el.remove(); return; } } catch(e){}
    el.addEventListener("click", function(e){
      var t = e.target && e.target.closest ? e.target.closest("[data-trial-banner-close]") : null;
      if(!t) return;
      try { localStorage.setItem(KEY,"1"); } catch(e){}
      el.remove();
    });
  })();</script>`;
}

export function createLayoutViews(qRunning: Statement, themeCss?: () => string, trialBanner?: () => string, posthogHead?: () => string, demoRow?: () => string) {
  /* #884: per-user accent theme — the override lands after style.css so it
     wins over the :root defaults. Always rendered (with the default theme's
     values when unset) so a theme POST can live-swap it via OOB by id. */
  const themeStyle = () => `<style id="theme-style">${themeCss ? themeCss() : ""}</style>`;
  /* #354: M3 navigation per window size class. The four destinations live in
     a bottom navigation bar on compact (<600px) or a collapsed leading
     navigation rail on medium+ (600px+), never both. The app bar keeps the
     brand mark and account actions only. Labels are one word
     ("Clients", not "Clients & projects") per the rail/bar guidelines. */
  const dests = [
    { href: "/", label: "Zimer", key: "timer", ic: "timer" as const },
    { href: "/calendar", label: "Calendar", key: "calendar", ic: "calendar" as const },
    { href: "/invoices", label: "Zinvoices", key: "invoices", ic: "receipt" as const },
    { href: "/manage", label: "Clients", key: "manage", ic: "group" as const },
  ];
  function layout(title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean): string {
    /* #444: the site-wide tab ticker (shortcut.js) needs the start instant
       of the running timer — the start form can't know it on a cold load. */
    const running = qRunning.get() as { start_time?: string } | null;
    const startAttr = running?.start_time ? ` data-timer-start="${esc(running.start_time)}"` : "";
    const dest = (d: (typeof dests)[number], cls: string) =>
      `<a href="${d.href}" class="${cls}${active === d.key ? " active" : ""}"${active === d.key ? ` aria-current="page"` : ""}>` +
      `<span class="nav-pill">${icon(d.ic as keyof typeof ICONS)}</span><span class="nav-label">${d.label}</span></a>`;
    /* #928: render the PostHog snippet once; the analytics.js helper only
       loads when the snippet is present. */
    const phHead = posthogHead ? posthogHead() : "";
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Zimer</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  ${phHead}
  <link rel="stylesheet" href="/static/style.css">
  ${themeStyle()}
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32.png">
  <link rel="apple-touch-icon" href="/static/alien-180.png">
  <!-- #936: PWA — installable app shell. Manifest + theme color; the service
       worker (scoped to /static/) makes static assets resilient and satisfies
       the installability check. Registration is a no-op when unsupported. -->
  <link rel="manifest" href="/static/manifest.webmanifest">
  <meta name="theme-color" content="#131318">
  <script>if("serviceWorker" in navigator){navigator.serviceWorker.register("/static/sw.js").catch(function(){});}</script>
  <script src="/static/motion.js" defer></script>
  <script src="/static/shortcut.js" defer></script>
  <script src="/static/terms.js" defer></script>
  <script src="/static/dialog.js" defer></script>
  ${phHead ? `<script src="/static/analytics.js" defer></script>` : ""}
  </head>
  <body class="app${fixed ? " app-fixed" : ""}" data-timer-running="${running ? 1 : 0}"${startAttr}>
  <!-- #511: skip link — keyboard users jump past the app bar and nav straight to content. -->
  <a class="skip-link" href="#main">Skip to content</a>
  <!-- #387: the app bar and nav rail sit chromeless on the page background;
       the rounded surface sheet wraps only the content column. -->
  <header class="md-top-app-bar" data-enter="1">
    <span class="md-top-app-bar-title">${logo(34)}</span>
    <span class="md-top-app-bar-spacer"></span>
    ${appBarActions()}
  </header>
  ${/* #923: trial-expiry nudge — full-width strip between the app bar and
       the page chrome; the thunk resolves the hosted trial state per user. */ trialBanner ? trialBanner() : ""}
  <div class="app-chrome">
    <nav class="md-nav-rail" aria-label="Primary">
      ${dests.map(d => dest(d, "md-rail-item")).join("")}
    </nav>
    <div class="app-sheet">
      <main id="main" tabindex="-1"${active ? ` class="page-${active}"` : ""}>${body}</main>
    </div>
  </div>
  <nav class="md-bottom-nav" aria-label="Primary">
    ${dests.map(d => dest(d, "md-bar-item")).join("")}
  </nav>
  ${/* #355: the settings scrim is a direct body child — inside the app bar it
       would be trapped in the header's stacking context and paint below the
       bottom navigation bar. The entry edit scrim rides along for the same
       reason (#903), and so does the #949 navigation drawer. */ navDrawer(demoRow ? demoRow() : "")}${settingsDialog()}${entryDialog()}
  </body>
  </html>`;
  }

  /* Minimal public chrome for error pages: no nav, no logout, no app
     structure leaked. Mirrors the public invoice page's head. */
  function publicShell(title: string, body: string): string {
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(title)} &middot; Zimer</title>
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32.png">
  <link rel="apple-touch-icon" href="/static/alien-180.png">
  <script src="/static/motion.js" defer></script>
  </head>
  <body>
  <main class="page-public-invoice">
  ${body}
  </main>
  </html>`;
  }

  /* Styled 404 page. Authed requests get the app layout with wayfinding;
     anonymous requests (bad /i/:token, logged-out misses) get the minimal
     public chrome — no nav, no logout, no app structure leaked. */
  function notFoundPage(authed: boolean): string {
    const body = `
      <div class="error-page">
        <h1 class="md-headline-small">Page not found</h1>
        <p class="muted">The page you&rsquo;re looking for doesn&rsquo;t exist or was moved.</p>
        ${authed ? `
        <div class="error-actions">
          <a class="md-filled-button" href="/">Zimer</a>
          <a class="md-text-button" href="/calendar">Calendar</a>
          <a class="md-text-button" href="/invoices">Zinvoices</a>
          <a class="md-text-button" href="/manage">Clients</a>
        </div>` : ""}
      </div>`;
    if (authed) return layout("Page not found", body);
    return publicShell("Page not found", body);
  }

  /* Styled 500 page, rendered by the page-route catch-all. Never includes
     error details — those go to the server log only. */
  function errorPage(authed: boolean): string {
    const body = `
      <div class="error-page">
        <h1 class="md-headline-small">Something went wrong</h1>
        <p class="muted">An unexpected error occurred. Please try again.</p>
        <div class="error-actions">
          <button class="md-tonal-button" onclick="history.back()">Go back</button>
          <a class="md-filled-button" href="/">Zimer</a>
        </div>
      </div>`;
    if (authed) return layout("Something went wrong", body);
    return publicShell("Something went wrong", body);
  }


  /* Dedicated dead-end for unknown /i/:token links on the public invoice
     subdomain (#305): same minimal public chrome, but the message names the
     situation instead of the generic 404. */
  function noSuchInvoicePage(): string {
    const body = `
      <div class="error-page">
        <div class="error-mark">${logo(40)}</div>
        <h1 class="md-headline-small">This zinvoice doesn&rsquo;t exist.</h1>
        <p class="muted">The link you followed doesn&rsquo;t match any zinvoice. Check the address, or ask the sender for a fresh link.</p>
      </div>`;
    return publicShell("Zinvoice not found", body);
  }

  /* Public 429 page (#308): minimal public chrome, no app nav leaked. */
  function rateLimitPage(): string {
    const body = `
      <div class="error-page">
        <div class="error-mark">${logo(40)}</div>
        <h1 class="md-headline-small">Too many requests.</h1>
        <p class="muted">Please slow down and try again in a bit.</p>
      </div>`;
    return publicShell("Too many requests", body);
  }

  return { layout, publicShell, notFoundPage, noSuchInvoicePage, rateLimitPage, errorPage };
}

/** Issue #654: the hamburger account menu (#155) is gone — Triston wanted the
    four global actions visible instead of two taps deep. Settings, Export
    entries CSV, Download backup, and Log out are now icon buttons on the
    right side of the top app bar on every page. Tooltips (data-tip) replace
    the menu's text labels; the settings dialog still opens from the cog.
    #949: on compact screens the icon row gives way to a hamburger that opens
    the labeled navigation drawer (navDrawer below) — tooltips don't exist on
    touch, so the four actions get text labels there instead. */
function appBarActions(): string {
  return `<button class="md-icon-button app-bar-menu-btn" id="appbar-menu-btn" type="button"
      aria-label="Open menu" aria-haspopup="dialog">${icon("menu")}</button>
  <div class="app-bar-actions">
    <button class="md-icon-button tip-right" id="appbar-settings-btn" type="button"
      data-tip="Settings" aria-label="Settings">${icon("settings")}</button>
    <a class="md-icon-button tip-right" href="/export/entries.csv" download
      data-tip="Export entries CSV" aria-label="Export entries CSV">${icon("table")}</a>
    <a class="md-icon-button tip-right" href="/backup" download
      data-tip="Download backup" aria-label="Download backup">${icon("database")}</a>
    <form method="POST" action="/logout" class="app-bar-logout">
      <button class="md-icon-button tip-right" type="submit"
        data-tip="Log out" aria-label="Log out">${icon("logout")}</button>
    </form>
  </div>`;
}

/** #949: M3 navigation drawer for compact screens — the four app-bar actions
    as labeled icon+text rows, since icon-only buttons are undiscoverable on
    touch. Rendered as a direct body child (same stacking-context reason as
    the settings scrim, #355). The Settings row carries its own id; the
    settings dialog script wires it as a second opener. Desktop never shows
    the hamburger, so the drawer is unreachable there. */
function navDrawer(demoRowHtml: string = ""): string {
  return `<div class="nav-drawer-scrim" id="nav-drawer-scrim" hidden>
    <nav class="nav-drawer" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="nav-drawer-head">Menu</div>
      <button class="nav-drawer-row" id="drawer-settings-btn" type="button">${icon("settings")}<span>Settings</span></button>
      <a class="nav-drawer-row" href="/export/entries.csv" download>${icon("table")}<span>Export entries CSV</span></a>
      <a class="nav-drawer-row" href="/backup" download>${icon("database")}<span>Download backup</span></a>
      <form method="POST" action="/logout" class="nav-drawer-logout">
        <button class="nav-drawer-row" type="submit">${icon("logout")}<span>Log out</span></button>
      </form>
      ${demoRowHtml}
    </nav>
  </div>
  <script>(function(){
    var scrim=document.getElementById('nav-drawer-scrim');
    var btn=document.getElementById('appbar-menu-btn');
    if(!scrim||!btn) return;
    var open_=false;
    function open(){
      open_=true;
      scrim.hidden=false; void scrim.offsetWidth; scrim.classList.add('open');
      document.addEventListener('keydown',onKey,true);
      var first=scrim.querySelector('.nav-drawer-row'); if(first) first.focus();
    }
    function close(refocus){
      if(!open_) return; open_=false;
      scrim.classList.remove('open');
      document.removeEventListener('keydown',onKey,true);
      var done=false, finish=function(){ if(done) return; done=true; scrim.hidden=true; };
      var onEnd=function(e){ if(e.target===scrim&&e.propertyName==='opacity'){ scrim.removeEventListener('transitionend',onEnd); finish(); } };
      scrim.addEventListener('transitionend',onEnd); setTimeout(finish,300);
      if(refocus) btn.focus();
    }
    function onKey(e){ if(e.key==='Escape'){ e.preventDefault(); close(true); }
      else if(e.key==='Tab'&&window.tkTrapTab){ window.tkTrapTab(scrim,e); } }
    scrim.addEventListener('pointerdown',function(e){ if(e.target===scrim) close(false); });
    btn.addEventListener('click',open);
    /* The spec's primary touch dismissal: swipe the panel toward the leading
       edge. The panel follows the pointer; releasing past a third of its
       width closes, otherwise it springs back. A plain tap never moves it,
       so row clicks are unaffected. */
    var panel=scrim.querySelector('.nav-drawer');
    var dragX=null, dragDx=0;
    panel.addEventListener('pointerdown',function(e){
      dragX=e.clientX; dragDx=0; panel.style.transition='none';
    });
    window.addEventListener('pointermove',function(e){
      if(dragX===null) return;
      dragDx=Math.min(0,e.clientX-dragX);
      panel.style.transform='translateX('+dragDx+'px)';
    });
    window.addEventListener('pointerup',function(){
      if(dragX===null) return;
      var past=dragDx<-(panel.offsetWidth/3);
      dragX=null; panel.style.transition=''; panel.style.transform='';
      if(past) close(false);
    });
    /* Any row activation closes the drawer: downloads navigate away or stay
       (download), logout submits, and Settings hands off to its dialog (its
       own listener, registered later, opens it after this close runs). */
    scrim.querySelectorAll('.nav-drawer-row').forEach(function(row){
      row.addEventListener('click',function(){ close(false); });
    });
  })();</script>`;
}

/** Issue #245: settings modal reached through the account menu button. The shell
    is a direct body child (rendered by layout(), not accountMenu()) so its
    scrim isn't trapped in the app bar's stacking context — #355: otherwise the
    bottom navigation bar would paint above it. The business-profile form loads
    lazily via htmx on open so layout() needs no db access. Follows the
    .cal-scrim/.cal-dialog motion pattern (scrim fade + dialog scale/fade). */
function settingsDialog(): string {
  return `<div class="cal-scrim" id="settings-scrim" hidden>
    <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
      <div class="settings-dialog-head">
        <h2 class="md-headline-small" id="settings-dialog-title">Settings</h2>
        <button class="md-icon-button" id="settings-close" type="button" aria-label="Close settings">${icon("close")}</button>
      </div>
      <div id="settings-body"><p class="muted md-body-medium">Loading…</p></div>
    </div>
  </div>
  <script>(function(){
    var scrim=document.getElementById('settings-scrim');
    var body=document.getElementById('settings-body');
    var closeBtn=document.getElementById('settings-close');
    var menuItem=document.getElementById('appbar-settings-btn');
    /* #949: the drawer Settings row is a second opener; on close, focus goes
       to the hamburger (the drawer row is hidden again by then). */
    var drawerItem=document.getElementById('drawer-settings-btn');
    var menuBtn=document.getElementById('appbar-menu-btn');
    if(!scrim||!body||!closeBtn||!menuItem) return;
    var open_=false, focusOnSwap=false, opener=menuItem;
    function open(){
      open_=true;
      scrim.hidden=false; void scrim.offsetWidth; scrim.classList.add('open');
      /* Fresh form on every open — the profile may have changed elsewhere. */
      focusOnSwap=true;
      htmx.ajax('GET','/settings','#settings-body');
      document.addEventListener('keydown',onKey,true);
    }
    function close(refocus){
      if(!open_) return; open_=false; focusOnSwap=false;
      scrim.classList.remove('open');
      document.removeEventListener('keydown',onKey,true);
      var done=false, finish=function(){ if(done) return; done=true; scrim.hidden=true; };
      var onEnd=function(e){ if(e.target===scrim&&e.propertyName==='opacity'){ scrim.removeEventListener('transitionend',onEnd); finish(); } };
      scrim.addEventListener('transitionend',onEnd); setTimeout(finish,300);
      if(refocus){ var t=(opener===drawerItem&&menuBtn)?menuBtn:opener; if(t) t.focus(); }
    }
    /* #456: trap Tab inside the modal while it's open. onKey only runs
       while open (attached on open, detached on close), so no extra open
       guard is needed. The scrim's only child is the dialog itself. */
    function onKey(e){ if(e.key==='Escape'){ e.preventDefault(); close(true); }
      else if(e.key==='Tab'&&window.tkTrapTab){ window.tkTrapTab(scrim,e); } }
    body.addEventListener('htmx:afterSwap',function(){
      if(!focusOnSwap) return; focusOnSwap=false;
      var f=body.querySelector('input'); if(f) f.focus();
    });
    scrim.addEventListener('pointerdown',function(e){ if(e.target===scrim) close(false); });
    closeBtn.addEventListener('click',function(){ close(true); });
    menuItem.addEventListener('click',function(){
      opener=menuItem;
      open();
    });
    if(drawerItem) drawerItem.addEventListener('click',function(){
      opener=drawerItem;
      open();
    });
    /* #247: visible save confirmation — the form re-renders silently, so
       announce success with the shared M3 snackbar. Delegated on body so it
       survives the #biz-profile outerHTML swap. */
    document.body.addEventListener('htmx:afterRequest',function(e){
      var elt=e.detail.elt;
      if(!elt||!e.detail.successful||!window.tkSnackbar) return;
      if(elt.id==='biz-profile-form') window.tkSnackbar('Business profile saved');
      else if(elt.id==='daily-target-form') window.tkSnackbar('Daily target saved'); /* #908 */
    });
  })();</script>`;
}

/** #903: entry edit dialog for the timer page. Same .cal-scrim pattern as the
    settings dialog above: the shell is a direct body child, the form
    lazy-loads via htmx on open, Escape/scrim-click close it, Tab is trapped
    via the shared tkTrapTab, and focus returns to the edit button. */
function entryDialog(): string {
  return `<div class="cal-scrim" id="entry-scrim" hidden>
    <div class="cal-dialog" role="dialog" aria-modal="true" aria-labelledby="entry-dialog-title">
      <div id="entry-dialog-body"><p class="muted md-body-medium">Loading…</p></div>
    </div>
  </div>
  <script>(function(){
    var scrim=document.getElementById('entry-scrim');
    var body=document.getElementById('entry-dialog-body');
    if(!scrim||!body) return;
    var open_=false, opener=null;
    function open(id){
      open_=true; opener=document.activeElement;
      scrim.hidden=false; void scrim.offsetWidth; scrim.classList.add('open');
      htmx.ajax('GET','/entries/'+id+'/edit','#entry-dialog-body');
      document.addEventListener('keydown',onKey,true);
    }
    function closeDialog(refocus){
      if(!open_) return; open_=false;
      scrim.classList.remove('open');
      document.removeEventListener('keydown',onKey,true);
      var done=false, finish=function(){ if(done) return; done=true; scrim.hidden=true; };
      var onEnd=function(e){ if(e.target===scrim&&e.propertyName==='opacity'){ scrim.removeEventListener('transitionend',onEnd); finish(); } };
      scrim.addEventListener('transitionend',onEnd); setTimeout(finish,300);
      if(refocus&&opener&&document.contains(opener)) opener.focus();
    }
    /* #456: trap Tab inside the modal while it's open. onKey only runs
       while open (attached on open, detached on close). */
    function onKey(e){ if(e.key==='Escape'){ e.preventDefault(); closeDialog(true); }
      else if(e.key==='Tab'&&window.tkTrapTab){ window.tkTrapTab(scrim,e); } }
    /* focus the first field once the form lands */
    body.addEventListener('htmx:afterSwap',function(){
      var f=body.querySelector('input:not([disabled]),select:not([disabled])'); if(f) f.focus();
    });
    scrim.addEventListener('pointerdown',function(e){ if(e.target===scrim) closeDialog(false); });
    /* edit buttons + the dialog's own close/cancel — delegated so today-list
       re-renders keep working without rebinding */
    document.addEventListener('click',function(e){
      var t=e.target&&e.target.closest?e.target.closest('[data-edit-entry],[data-close-entry]'):null;
      if(!t) return;
      if(t.hasAttribute('data-edit-entry')) open(t.getAttribute('data-edit-entry'));
      else closeDialog(true);
    });
    /* the dialog form posts via htmx — a successful save closes the modal;
       the server's HX-Trigger refreshes #today-list behind it */
    document.body.addEventListener('htmx:afterRequest',function(e){
      var elt=e.detail.elt;
      if(elt&&elt.id==='edit-entry-form'&&e.detail.successful) closeDialog(false);
    });
  })();</script>`;
}
