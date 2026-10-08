/** Timer page views: dashboard, timer card, today's entries, today-vs-target
 *  pacing bar, and the revenue pane (cards, 12-month chart, per-client
 *  breakdown, overdue attention). Domain data arrives through injected
 *  helpers; layout and demo banner come from their owning
 *  slices, so every call site keeps working unchanged. */

import type { Database, Statement } from "bun:sqlite";
import { dayBounds, durationSeconds, entryInvoiceMark, entryIsLocked, esc, fmtDur, money, schemeColor, todayStr } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import type { Entry } from "../lib/types.ts";

export interface TimerViewDeps {
  db: Database;
  qRunning: Statement;
  qRange: Statement;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean) => string;
  demoBanner: (db: Database) => string;
  projectOptions: (selected?: number | null) => string;
  revenueTotals: () => { invoiced: number; paid: number; outstanding: number };
  revenueMonthly: () => { label: string; invoiced: number; paid: number }[];
  revenueByClient: () => { name: string; color: string | null; invoiced: number; paid: number; outstanding: number }[];
  revenueOverdue: () => { id: number; number: string; client_name: string | null; due_date: string | null; total: number; days_past_due: number; bucket: string }[];
  m3ProgressBar: (pct: number, met: boolean, ariaLabel: string) => string;
  /* #908: per-request getter — the daily target is a user setting now, and
     the view deps are built once at server startup. */
  dayTargetSecs: () => number;
}

export function createTimerViews(deps: TimerViewDeps) {
  const { db, qRunning, qRange, layout, demoBanner, projectOptions,
    revenueTotals, revenueMonthly, revenueByClient, revenueOverdue, m3ProgressBar, dayTargetSecs } = deps;

  /* #546: description suggestions for the start form — the 15 most recently
     used non-blank descriptions, deduped. Rendered as a browser-native
     datalist: zero visual surface until the field is focused or typed in. */
  const qDescSuggest = db.query(`
    SELECT description FROM time_entries
    WHERE description IS NOT NULL AND TRIM(description) != ''
    GROUP BY description ORDER BY MAX(start_time) DESC LIMIT 15`);

  function descDatalist(): string {
    const rows = qDescSuggest.all() as { description: string }[];
    if (!rows.length) return "";
    return `<datalist id="tk-desc-suggest">${rows.map(r => `<option value="${esc(r.description)}">`).join("")}</datalist>`;
  }

  /* #473: canRepeat — one-tap restart of a finished entry. Hidden on the
     running row (no end_time) and while another timer is running (POST
     /timer/start 409s there); posts to the existing route, whose HX-Trigger
     already refreshes the Today list. */
  function entryRow(e: Entry, i = 0, canRepeat = false): string {
    const dur = fmtDur(durationSeconds(e.start_time, e.end_time));
    /* #255: times are a client concept (the server may be in another
       timezone — VPS is UTC). Emit the ISO instant and let the client format
       it; fmtTimes() in dashboardPage fills these in after every swap. */
    const startTs = `<time data-ts="${esc(e.start_time)}"></time>`;
    const endTs = e.end_time ? `<time data-ts="${esc(e.end_time)}"></time>` : "now";
    const chip = e.project_name
      ? `<span class="md-chip">${e.client_color ? `<span class="dot" style="background:${esc(schemeColor(e.client_color))}"></span>` : ""}${esc(e.project_name)}</span>`
      : "";
    const desc = e.description ? esc(e.description) : "<em>No description</em>";
    /* #330: mark time that's already on an invoice (sent/paid) or in a draft. */
    const mark = entryInvoiceMark(e);
    /* #498: house M3 plain tooltip (data-tip) instead of the native title —
       matches the site's tooltip language and gives touch users the 450ms
       long-press (#496). */
    const invMark = mark ? `<span class="inv-mark ${mark.cls}" data-tip="${esc(mark.title)}">${mark.label}</span>` : "";
    /* #469: the running row's duration ticks live from the card's 1s interval
       (found by data-live-start); finished rows stay static. */
    const durSpan = !e.end_time
      ? `<span class="dur" data-live-start="${esc(e.start_time)}">${dur}</span>`
      : `<span class="dur">${dur}</span>`;
    return `<li class="md-list-item" id="entry-${e.id}" style="animation-delay:${Math.min(i * 30, 300)}ms">
      <div class="md-list-item-content">
        <div class="md-list-item-headline">${desc}</div>
        <div class="md-list-item-supporting">${chip}${invMark}<span>${startTs} – ${endTs}${e.client_name && !e.project_name ? ` · ${esc(e.client_name)}` : ""}</span></div>
      </div>
      <div class="md-list-item-trailing">
        ${durSpan}
        ${entryIsLocked(e) ? "" : `
        <button class="md-icon-button" type="button" data-edit-entry="${e.id}" aria-label="Edit entry" data-tip="Edit">${icon("edit")}</button>
        ${/* #462: the timer card owns the running entry — deleting it from the
             list orphaned the card (ghost TRACKING + tab-title count). Stop
             there first; delete lands on the finished row. */ !e.end_time ? "" : `
        ${/* #473: repeat posts the row's description + project to the existing
             /timer/start route (mini-form: hidden inputs survive quotes and
             apostrophes where hx-vals JSON would not). */ canRepeat ? `
        <form class="repeat-form" hx-post="/timer/start" hx-target="#timer-card" hx-swap="outerHTML swap:200ms">
          <input type="hidden" name="description" value="${esc(e.description ?? "")}">
          <input type="hidden" name="project_id" value="${e.project_id ?? ""}">
          <button class="md-icon-button" type="submit" aria-label="Repeat entry" data-tip="Repeat">${icon("repeat")}</button>
        </form>` : ""}
        <button class="md-icon-button danger" hx-delete="/entries/${e.id}"
          hx-target="#entry-${e.id}" hx-swap="outerHTML swap:220ms" data-confirm="Delete this entry?"
          aria-label="Delete entry" data-tip="Delete">${icon("delete")}</button>`}`}
      </div>
    </li>`;
  }


  /** Timer card: running entry with live ticking, or the start form. */
  function timerPartial(): string {
    const running = qRunning.get() as Entry | null;
    if (running) {
      /* #718: the "· name" rides in one no-wrap span so the TRACKING label
         can't split the project name mid-phrase on narrow screens — the span
         ellipsizes instead. The separator lives INSIDE the span: as a bare
         text run next to the shrinking span, Chrome drops the "·" to the
         baseline (verified in QA). */
      const proj = running.project_name ? `<span class="timer-state-proj">· ${esc(running.project_name)}</span>` : "";
      /* #475: the stop class is what .timer-top-row .stop positions — the
         button once dropped it and sat below the TRACKING label in normal
         flow. This note lives outside the template literal: a JS-style comment
         inside the HTML renders as visible text in the card. */
      return `<div class="md-card tracking" id="timer-card">
        <div class="timer-top-row">
          <div class="timer-state-label"><span class="live-dot" aria-hidden="true"></span>TRACKING${proj}</div>
        <button class="md-filled-button stop" hx-post="/timer/stop" hx-target="#timer-card" hx-swap="outerHTML swap:200ms"
          data-tip="Stop (t)" aria-keyshortcuts="t">
            ${icon("stop")}Stop
          </button>
        </div>
        <div class="md-title-medium timer-desc">${running.description ? esc(running.description) : "No description"}</div>
        <div class="timer-elapsed" id="elapsed" data-start="${esc(running.start_time)}">…</div>
        <script>(function(){var el=document.getElementById('elapsed');if(!el)return;
          /* #444: the tab-title ticker moved to shortcut.js (site-wide) — the
             card keeps its own display interval, and still clears the previous
             one so re-renders don't orphan intervals on detached nodes. */
          if(window.__tkTick){clearInterval(window.__tkTick);window.__tkTick=null;}
          var s=new Date(el.dataset.start).getTime();
          /* #469: mirror fmtDur (site/lib/format.ts) for the running entry's
             duration in the Today list — it was frozen at render time while
             the card ticked. Same 1s interval, no extra timers. */
          function fmtDurRow(d){var t=Math.floor(d/1000),
            h=Math.floor(t/3600),m=Math.floor(t%3600/60),sec=t%60;
            /* #821: mirror of fmtDur — whole hours drop the 00m (#817). */
            if(h>0)return m>0?h+'h '+String(m).padStart(2,'0')+'m':h+'h';
            /* #596: mirror of fmtDur — whole minutes drop the 00s. */
            if(m>0)return m+'m'+(sec>0?' '+String(sec).padStart(2,'0')+'s':'');
            return sec+'s';}
          function tick(){var d=Math.max(0,Date.now()-s);
            var h=Math.floor(d/36e5),m=Math.floor(d%36e5/6e4),sec=Math.floor(d%6e4/1e3);
            el.textContent=(h?h+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
            var row=document.querySelector('#today-list [data-live-start]');
            if(row)row.textContent=fmtDurRow(d);}
          tick();window.__tkTick=setInterval(tick,1000);})();</script>
      </div>`;
    }
    return `<div class="md-card" id="timer-card">
      <div class="timer-state-label">ZIMER</div>
      <div class="md-title-medium muted">Nothing tracking</div>
      <form hx-post="/timer/start" hx-target="#timer-card" hx-swap="outerHTML swap:200ms" class="start-form">
        <div class="md-text-field grow">
          <input type="text" id="tm-desc" name="description" placeholder=" " autocomplete="off" aria-label="What are you working on?" list="tk-desc-suggest">
          <label for="tm-desc">What are you working on?</label>
        </div>
        ${descDatalist()}
        <div class="md-text-field shrink filled">
          <select name="project_id" id="tm-project" aria-label="Project"><option value="">No project</option>${projectOptions()}</select>
          <label for="tm-project">Project</label>
        </div>
        <button class="md-filled-button" type="submit" data-tip="Start (t)" aria-keyshortcuts="t">
          ${icon("play")}Start
        </button>
      </form>
      <script>(function(){
        /* #444: the card's display interval still needs retiring on stop —
           the tab title itself is restored by shortcut.js's site-wide ticker. */
        if(window.__tkTick){clearInterval(window.__tkTick);window.__tkTick=null;}
      })();</script>
    </div>`;
  }

  /* #255: "today" is a client concept — the server may be in another timezone.
     The client passes its own day bounds as UTC instants (?from=&to=, computed
     from client-local midnight); the server validates them and falls back to
     its own day. */
  function todayPartial(from?: string, to?: string): string {
    const [f, t] = from && to ? [from, to] : dayBounds(todayStr());
    const entries = qRange.all(f, t) as Entry[];
    const total = entries.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
    const bar = todayTargetBar(total);
    if (!entries.length) return `${bar}<p class="muted">Nothing tracked today yet.</p>`;
    /* #473: repeat is only offered when nothing is running — /timer/start
       409s while a timer runs, so showing it then would be a silent no-op. */
    const canRepeat = !qRunning.get();
    return `${bar}
      <ul class="md-list">${entries.map((e, i) => entryRow(e, i, canRepeat)).join("")}</ul>`;
  }

  function dashboardPage(): string {
    return layout("Today", `
      ${demoBanner(db)}
      <div class="pane-layout">
        <section class="pane-focus" data-enter="2" aria-label="Zimer and today's entries">
          ${timerPartial()}
          <div class="scroll-region">
            <div class="page-head">
              <h1 class="md-headline-small">Today</h1>
              <a class="md-text-button" id="invoice-week" href="/invoices/new">${icon("receipt")} Zinvoice this week</a>
            </div>
            <div id="today-list" hx-get="/partial/today" hx-trigger="load, timer-updated from:body">
              <div class="skel-stack" aria-hidden="true">
                <div class="skel skel-row"></div>
                <div class="skel skel-row"></div>
                <div class="skel skel-row"></div>
              </div>
            </div>
            <script>(function(){/* #255: client day bounds + client-side time formatting.
              Runs at parse time, before htmx's load trigger fires. */
              var el=document.getElementById('today-list');if(!el)return;
              var d=new Date();
              /* #299: point "Invoice this week" at the client-local week (Sun–Sat),
                 matching the calendar's week convention. Server can't know the tz. */
              var inv=document.getElementById('invoice-week');
              if(inv){var sun=new Date(d.getFullYear(),d.getMonth(),d.getDate()-d.getDay());
                var f2=function(x){return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');};
                var wend=new Date(sun.getFullYear(),sun.getMonth(),sun.getDate()+7);
                inv.setAttribute('href','/invoices/new?from='+f2(sun)+'&to='+f2(wend));}
              var s=new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
              var from=new Date(s).toISOString(), to=new Date(s+864e5).toISOString();
              el.setAttribute('hx-get','/partial/today?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to));
              window.__tkFmtTimes=function(root){
                var els=(root||document).querySelectorAll('[data-ts]');
                for(var i=0;i<els.length;i++){var t=els[i];
                  t.textContent=new Date(t.getAttribute('data-ts')).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}};
              document.body.addEventListener('htmx:afterSwap',function(e){
                if(e.detail&&e.detail.target&&e.detail.target.id==='today-list')window.__tkFmtTimes(e.detail.target);});
              window.__tkFmtTimes(el);})();</script>
          </div>
        </section>
        <aside class="pane-supporting" data-enter="3" aria-label="Revenue">
          <div class="scroll-region">
            <h2 class="md-headline-small">Revenue</h2>
            ${revenueSection()}
          </div>
        </aside>
      </div>`, "timer", true);
  }


  /** A1: revenue stat cards (invoiced / paid / outstanding). */
  function revenueCards(): string {
    const t = revenueTotals();
    const card = (label: string, val: number, cls = "") => `
      <div class="md-card rev-card">
        <div class="md-label-medium muted">${label}</div>
        <div class="md-title-large${cls ? ` ${cls}` : ""}">${money(val)}</div>
      </div>`;
    return `<div class="rev-cards">
      ${card("Zinvoiced", t.invoiced)}
      ${card("Paid", t.paid, "rev-paid")}
      ${card("Outstanding", t.outstanding)}
    </div>`;
  }


  /** A2: trailing-12-month bar chart, hand-rolled SVG. Pumpkin = paid, tonal = outstanding remainder. */
  function revenueChart(): string {
    const months = revenueMonthly();
    const max = Math.max(1, ...months.map(m => m.invoiced));
    const W = 600, baseline = 190, areaH = 160, n = months.length;
    const slot = W / n, bw = 30;
    const bars = months.map((m, i) => {
      const h = Math.round(m.invoiced / max * areaH);
      const hp = m.invoiced > 0 ? Math.round(m.paid / m.invoiced * h) : 0;
      const ho = h - hp;
      const x = Math.round(i * slot + (slot - bw) / 2);
      const cx = Math.round(i * slot + slot / 2);
      return `<g><title>${esc(`${m.label}: ${money(m.paid)} paid of ${money(m.invoiced)} zinvoiced`)}</title>` +
        (ho > 0 ? `<rect x="${x}" y="${baseline - h}" width="${bw}" height="${ho}" rx="4" class="bar-out" style="animation-delay:${i * 40}ms"/>` : "") +
        (hp > 0 ? `<rect x="${x}" y="${baseline - hp}" width="${bw}" height="${hp}" rx="4" class="bar-paid" style="animation-delay:${i * 40}ms"/>` : "") +
        `<text x="${cx}" y="${baseline + 18}" text-anchor="middle">${m.label}</text></g>`;
    }).join("");
    return `<div class="md-card rev-chart-card">
      <div class="md-title-medium rev-chart-title">Last 12 months</div>
      <svg class="rev-chart" viewBox="0 0 ${W} 215" role="img" aria-label="Monthly revenue, last 12 months">${bars}</svg>
      <div class="rev-legend"><span class="rev-swatch paid"></span>Paid<span class="rev-swatch out"></span>Zinvoiced</div>
    </div>`;
  }

  function revenueSection(): string {
    if (revenueTotals().invoiced === 0)
      return `<p class="muted">No zinvoices yet — revenue will show up here.</p>`;
    return revenueAttention() + revenueCards() + revenueChart() + revenueClients();
  }


  /** Milestone 7: overdue invoices needing attention, most overdue first. */
  function revenueAttention(): string {
    const overdue = revenueOverdue();
    const title = `<div class="md-title-medium rev-chart-title">Needs attention</div>`;
    if (!overdue.length)
      return `<div class="md-card rev-attention">${title}<p class="muted attn-ok">All caught up — nothing overdue.</p></div>`;
    const rows = overdue.map(o => `
      <li class="md-list-item">
        <a class="attn-link" href="/invoices?invoice=${o.id}">
          <div class="md-list-item-content">
            <div class="md-list-item-headline">${esc(o.client_name || "Unknown")}</div>
            <div class="md-list-item-supporting">${esc(o.number)} · Due ${esc(o.due_date || "")}</div>
          </div>
          <div class="md-list-item-trailing"><span class="dur">${money(o.total)}</span></div>
          <span class="attn-chip" data-bucket="${esc(o.bucket)}">${o.days_past_due}d overdue</span>
        </a>
      </li>`).join("");
    return `<div class="md-card rev-attention">${title}<ul class="md-list">${rows}</ul></div>`;
  }

  /** A3: per-client revenue breakdown, with an expressive collection-progress
      bar per row (#89): paid vs invoiced. Ripples while money is outstanding,
      settles with a sheen when fully paid. */
  function revenueClients(): string {
    const clients = revenueByClient();
    if (!clients.length) return "";
    const rows = clients.map(c => {
      const pct = c.invoiced > 0 ? Math.min(100, (c.paid / c.invoiced) * 100) : 0;
      const met = c.invoiced > 0 && c.outstanding <= 0;
      const bar = c.invoiced > 0
        ? `<div class="m3-progress rev-collection">${m3ProgressBar(pct, met, `${esc(c.name)}: ${money(c.paid)} paid of ${money(c.invoiced)} zinvoiced`)}</div>`
        : "";
      return `
      <li class="md-list-item">
        <span class="rev-dot" style="background:${esc(schemeColor(c.color) || "var(--md-sys-color-primary)")}"></span>
        <div class="md-list-item-content">
          <div class="md-list-item-headline">${esc(c.name)}</div>
          <div class="md-list-item-supporting">${money(c.paid)} paid · ${money(c.outstanding)} outstanding</div>
          ${bar}
        </div>
        <div class="md-list-item-trailing"><span class="dur">${money(c.invoiced)}</span></div>
      </li>`; }).join("");
    return `<div class="md-card rev-clients-card">
      <div class="md-title-medium rev-chart-title">By client</div>
      <ul class="md-list">${rows}</ul>
    </div>`;
  }

  /** Today-vs-target pacing bar at the top of the timer page's today list.
      Rendered inside todayPartial so it refreshes on every timer start/stop
      via the existing `timer-updated` trigger. #908: the target comes from
      the user's setting, not the old 8h constant. */
  function todayTargetBar(totalSecs: number): string {
    const target = dayTargetSecs();
    const pct = Math.min(100, (totalSecs / target) * 100);
    const met = totalSecs >= target;
    return `
      <div class="m3-progress today-target">
        ${m3ProgressBar(pct, met, `Today's hours target, ${target / 3600} hours`)}
        <div class="md-label-medium muted m3-progress-label">Today · ${fmtDur(totalSecs)} / ${fmtDur(target)}${met ? ` · <span class="tiny">target met</span>` : ""}</div>
      </div>`;
  }

  return { entryRow, timerPartial, todayPartial, dashboardPage, revenueSection };
}
