/** App chrome views: layout, public shell, styled error pages, account menu.
 *  layout() reads the running-timer flag through the prepared qRunning
 *  statement passed in; createLayoutViews() keeps every existing call site
 *  working unchanged. */

import type { Statement } from "bun:sqlite";
import { esc } from "../lib/format.ts";
import { ICONS, icon, logo } from "../lib/icons.ts";

export function createLayoutViews(qRunning: Statement, themeCss?: () => string) {
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
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Zimer</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <link rel="stylesheet" href="/static/style.css">
  ${themeStyle()}
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32.png">
  <link rel="apple-touch-icon" href="/static/alien-180.png">
  <script src="/static/motion.js" defer></script>
  <script src="/static/shortcut.js" defer></script>
  <script src="/static/terms.js" defer></script>
  <script src="/static/dialog.js" defer></script>
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
       reason (#903). */ settingsDialog()}${entryDialog()}
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
    the menu's text labels; the settings dialog still opens from the cog. */
function appBarActions(): string {
  return `<div class="app-bar-actions">
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
    if(!scrim||!body||!closeBtn||!menuItem) return;
    var open_=false, focusOnSwap=false;
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
      if(refocus&&menuItem) menuItem.focus();
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
