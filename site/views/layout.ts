/** App chrome views: layout, public shell, styled error pages, account menu.
 *  layout() reads the running-timer flag through the prepared qRunning
 *  statement passed in; createLayoutViews() keeps every existing call site
 *  working unchanged. */

import type { Statement } from "bun:sqlite";
import { esc } from "../lib/format.ts";
import { ICONS, icon, logo } from "../lib/icons.ts";

export function createLayoutViews(qRunning: Statement) {
  function layout(title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean): string {
    const navItem = (href: string, label: string, key: string, ic: keyof typeof ICONS) =>
      `<a href="${href}" title="${label}" class="md-top-nav-item${active === key ? " active" : ""}"${active === key ? ` aria-current="page"` : ""}>${icon(ic)}<span>${label}</span></a>`;
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · Timekeep</title>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script>
  <script src="/static/shortcut.js" defer></script>
  </head>
  <body${fixed ? ' class="app-fixed"' : ""} data-timer-running="${qRunning.get() ? 1 : 0}">
  <header class="md-top-app-bar" data-enter="1">
    <span class="md-top-app-bar-title">${logo(34)}</span>
    <nav class="md-top-nav" aria-label="Primary">
      ${navItem("/", "Timer", "timer", "timer")}
      ${navItem("/calendar", "Calendar", "calendar", "calendar")}
      ${navItem("/invoices", "Invoices", "invoices", "receipt")}
      ${navItem("/manage", "Clients & projects", "manage", "group")}
    </nav>
    <span class="md-top-app-bar-spacer"></span>
    ${accountMenu()}
  </header>
  <main${active ? ` class="page-${active}"` : ""}>${body}</main>
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
  <title>${esc(title)} &middot; Timekeep</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
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
          <a class="md-filled-button" href="/">Timer</a>
          <a class="md-text-button" href="/calendar">Calendar</a>
          <a class="md-text-button" href="/invoices">Invoices</a>
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
          <a class="md-filled-button" href="/">Timer</a>
        </div>
      </div>`;
    if (authed) return layout("Something went wrong", body);
    return publicShell("Something went wrong", body);
  }


  return { layout, publicShell, notFoundPage, errorPage };
}

/** Issue #155: global account menu — hamburger button in the top app bar (every
    page), opening an M3 menu with data actions + log out. Replaces the
    manage-only overflow from #151 and the "Log out" text button.
    #251: the DiceBear "T" avatar was replaced with the brand mark; #253
    replaced that with a plain hamburger icon per Triston — no avatar image.
    #245: the menu gained a Settings item opening the settings modal
    (settingsDialog below); the business profile lives there now. */
function accountMenu(): string {
  return `<div class="m3-menu-wrap">
    <button class="account-menu-button" id="account-menu-btn" aria-label="Account"
      aria-haspopup="menu" aria-expanded="false" aria-controls="account-menu">${icon("menu")}</button>
    <div class="m3-menu" id="account-menu" role="menu" aria-label="Account" hidden>
      <button class="m3-menu-item" id="settings-menu-item" type="button" role="menuitem">${icon("settings")}<span>Settings</span></button>
      <a class="m3-menu-item" role="menuitem" href="/export/entries.csv" download>${icon("download")}<span>Export entries CSV</span></a>
      <a class="m3-menu-item" role="menuitem" href="/backup" download>${icon("download")}<span>Download backup</span></a>
      <div class="m3-menu-divider" role="separator"></div>
      <a class="m3-menu-item" role="menuitem" href="/logout">${icon("logout")}<span>Log out</span></a>
    </div>
  </div>
  ${settingsDialog()}
  <script>(function(){
    var btn=document.getElementById('account-menu-btn'), menu=document.getElementById('account-menu');
    if(!btn||!menu) return;
    var items=Array.prototype.slice.call(menu.querySelectorAll('.m3-menu-item'));
    var open_=false;
    function open(){
      open_=true; menu.hidden=false; void menu.offsetWidth;
      menu.classList.add('open'); btn.setAttribute('aria-expanded','true');
      if(items[0]) items[0].focus();
      document.addEventListener('keydown',onKey,true);
      document.addEventListener('pointerdown',onDoc,true);
    }
    function close(refocus){
      if(!open_) return; open_=false;
      menu.classList.remove('open'); btn.setAttribute('aria-expanded','false');
      document.removeEventListener('keydown',onKey,true);
      document.removeEventListener('pointerdown',onDoc,true);
      var done=false, finish=function(){ if(done) return; done=true; menu.hidden=true; };
      var onEnd=function(e){ if(e.target===menu&&(e.propertyName==='transform'||e.propertyName==='opacity')){ menu.removeEventListener('transitionend',onEnd); finish(); } };
      menu.addEventListener('transitionend',onEnd); setTimeout(finish,300);
      if(refocus) btn.focus();
    }
    /* #245: the settings dialog exposes its own opener; the menu just
       gets out of the way first. */
    window.__closeAccountMenu=function(){ close(false); };
    function onKey(e){
      var i=items.indexOf(document.activeElement);
      if(e.key==='Escape'){ e.preventDefault(); close(true); }
      else if(e.key==='ArrowDown'){ e.preventDefault(); items[(i+1+items.length)%items.length].focus(); }
      else if(e.key==='ArrowUp'){ e.preventDefault(); items[(i-1+items.length)%items.length].focus(); }
      else if(e.key==='Home'){ e.preventDefault(); items[0].focus(); }
      else if(e.key==='End'){ e.preventDefault(); items[items.length-1].focus(); }
      else if(e.key==='Tab'){ close(false); }
    }
    function onDoc(e){ if(!e.target.closest('.m3-menu-wrap')) close(false); }
    btn.addEventListener('click',function(){ open_?close(true):open(); });
  })();</script>`;
}

/** Issue #245: settings modal reached through the account menu button. The shell lives
    next to the account menu in the app bar; the business-profile form loads
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
    var menuItem=document.getElementById('settings-menu-item');
    var avatarBtn=document.getElementById('account-menu-btn');
    if(!scrim||!body||!closeBtn||!menuItem) return;
    var open_=false, focusOnSwap=false;
    function open(){
      open_=true;
      scrim.hidden=false; void scrim.offsetWidth; scrim.classList.add('open');
      /* Fresh form on every open — the profile may have changed elsewhere. */
      focusOnSwap=true;
      htmx.ajax('GET','/business-profile','#settings-body');
      document.addEventListener('keydown',onKey,true);
    }
    function close(refocus){
      if(!open_) return; open_=false; focusOnSwap=false;
      scrim.classList.remove('open');
      document.removeEventListener('keydown',onKey,true);
      var done=false, finish=function(){ if(done) return; done=true; scrim.hidden=true; };
      var onEnd=function(e){ if(e.target===scrim&&e.propertyName==='opacity'){ scrim.removeEventListener('transitionend',onEnd); finish(); } };
      scrim.addEventListener('transitionend',onEnd); setTimeout(finish,300);
      if(refocus&&avatarBtn) avatarBtn.focus();
    }
    function onKey(e){ if(e.key==='Escape'){ e.preventDefault(); close(true); } }
    body.addEventListener('htmx:afterSwap',function(){
      if(!focusOnSwap) return; focusOnSwap=false;
      var f=body.querySelector('input'); if(f) f.focus();
    });
    scrim.addEventListener('pointerdown',function(e){ if(e.target===scrim) close(false); });
    closeBtn.addEventListener('click',function(){ close(true); });
    menuItem.addEventListener('click',function(){
      if(window.__closeAccountMenu) window.__closeAccountMenu();
      open();
    });
    /* #247: visible save confirmation — the form re-renders silently, so
       announce success with the shared M3 snackbar. Delegated on body so it
       survives the #biz-profile outerHTML swap. */
    document.body.addEventListener('htmx:afterRequest',function(e){
      var elt=e.detail.elt;
      if(elt&&elt.id==='biz-profile-form'&&e.detail.successful&&window.tkSnackbar){
        window.tkSnackbar('Business profile saved');
      }
    });
  })();</script>`;
}
