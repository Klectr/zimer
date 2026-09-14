/** App chrome views: layout, public shell, styled error pages, account menu.
 *  layout() reads the running-timer flag through the prepared qRunning
 *  statement passed in; createLayoutViews() keeps every existing call site
 *  working unchanged. */

import type { Statement } from "bun:sqlite";
import { esc } from "../lib/format.ts";
import { ICONS, icon } from "../lib/icons.ts";

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
  <script src="/static/motion.js" defer></script>
  <script src="/static/shortcut.js" defer></script>
  </head>
  <body${fixed ? ' class="app-fixed"' : ""} data-timer-running="${qRunning.get() ? 1 : 0}">
  <header class="md-top-app-bar" data-enter="1">
    <span class="md-top-app-bar-title">${icon("timer")}<span>Timekeep</span></span>
    <nav class="md-top-nav" aria-label="Primary">
      ${navItem("/", "Timer", "timer", "timer")}
      ${navItem("/calendar", "Calendar", "calendar", "calendar")}
      ${navItem("/invoices", "Invoices", "invoices", "receipt")}
      ${navItem("/estimates", "Estimates", "estimates", "doc")}
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

function accountMenu(): string {
  return `<div class="m3-menu-wrap">
    <button class="avatar-button" id="account-menu-btn" aria-label="Account"
      aria-haspopup="menu" aria-expanded="false" aria-controls="account-menu"><img src="/static/avatar.svg" alt="" width="40" height="40"></button>
    <div class="m3-menu" id="account-menu" role="menu" aria-label="Account" hidden>
      <a class="m3-menu-item" role="menuitem" href="/export/entries.csv" download>${icon("download")}<span>Export entries CSV</span></a>
      <a class="m3-menu-item" role="menuitem" href="/backup" download>${icon("download")}<span>Download backup</span></a>
      <div class="m3-menu-divider" role="separator"></div>
      <a class="m3-menu-item" role="menuitem" href="/logout">${icon("logout")}<span>Log out</span></a>
    </div>
  </div>
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
