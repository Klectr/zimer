/** Page sections for the Zimer (timer) page — single-use view helpers, not Zandbox
 *  components (Zandbox is for small reusable pieces; see AGENTS.md). */
import { esc } from "../lib/format";
import { button } from "../ui/button";
import { card } from "../ui/card";
import { selectField, textField, type SelectOption } from "../ui/field";
import { iconButton } from "../ui/icon-button";
import { skeletonRows } from "../ui/skeleton";
import { tag } from "../ui/tag";
import { timerPanel } from "../ui/timer-display";

/** The Zimer home (timer page): the Zimer card (running or idle), the
 *  Today's entries card with its target bar, and the small pieces of an
 *  entry row (invoice mark, repeat). Presentational — the view reads the
 *  running entry, today's entries, and the target. */

/** Clears any running tick (the card swaps between running and idle). */
const STOP_TICK = `<script>(function(){
        if(window.__tkTick){clearInterval(window.__tkTick);window.__tkTick=null;}
      })();</script>`;

export interface TimerStartCardOptions {
  projectOptions: SelectOption[];
  /** Recent descriptions offered as type-ahead (datalist). */
  suggestions?: string[];
}

/** Idle: "Not tracking" + what / project / Start. Posts to /timer/start
 *  and swaps itself (#timer-card) for the running card. */
export function timerStartCard(o: TimerStartCardOptions): string {
  const list = o.suggestions && o.suggestions.length
    ? `<datalist id="tk-desc-suggest">${o.suggestions.map((d) => `<option value="${esc(d)}">`).join("")}</datalist>`
    : "";
  return card({ id: "timer-card", content:
    `<div class="ui-timer-top">${tag({ label: "Not tracking" })}</div>` +
    `<form hx-post="/timer/start" hx-target="#timer-card" hx-swap="outerHTML swap:200ms" class="ui-timer-form">` +
    `<div class="ui-timer-form-grow">${textField({ id: "tm-desc", label: "What are you working on?", name: "description", autocomplete: "off", list: "tk-desc-suggest" })}</div>` +
    list +
    `<div class="ui-timer-form-project">${selectField({ id: "tm-project", label: "Project", name: "project_id", options: o.projectOptions })}</div>` +
    button({ label: "Start", type: "submit", variant: "primary", icon: "play", attrs: 'data-tip="Start (t)" aria-keyshortcuts="t"' }) +
    `</form>` + STOP_TICK,
  });
}

export interface TimerRunningCardOptions {
  /** "Client — Project · description" */
  context: string;
  /** ISO start instant; the clock ticks from it client-side. */
  startedAt: string;
  /** Hourly rate (0/omitted: no rate or worth tags). */
  rate?: number;
  rateLabel?: string;
  /** Formatted worth at render time; the tick keeps it live. */
  worth?: string;
}

/** Running: live clock, rate + "worth so far", Stop. The tick also keeps
 *  the running row's duration in #today-list current. */
export function timerRunningCard(o: TimerRunningCardOptions): string {
  const metaHtml = o.rate && o.rate > 0
    ? tag({ label: o.rateLabel ?? `$${o.rate} / hr`, tone: "primary" }) +
      `<span class="ui-tag ui-tag-neutral" id="timer-worth" data-rate="${o.rate}">Worth ${esc(o.worth ?? "$0.00")} so far</span>`
    : undefined;
  return timerPanel({
    id: "timer-card",
    elapsedId: "elapsed",
    running: true,
    statusHtml: tag({ label: "Running", tone: "success", dot: true }),
    context: o.context,
    startedAt: o.startedAt,
    elapsed: "…",
    metaHtml,
    actionsHtml: button({ label: "Stop", variant: "primary", icon: "stop", attrs: 'hx-post="/timer/stop" hx-target="#timer-card" hx-swap="outerHTML swap:200ms" data-tip="Stop (t)" aria-keyshortcuts="t"' }),
  }) + `
      <script>(function(){var el=document.getElementById('elapsed');if(!el)return;
          if(window.__tkTick){clearInterval(window.__tkTick);window.__tkTick=null;}
          var s=new Date(el.dataset.start).getTime();
          var st=document.querySelector('#timer-card time[data-ts]');
          if(st)st.textContent=new Date(st.getAttribute('data-ts')).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
          function fmtDurRow(d){var t=Math.floor(d/1000),
            h=Math.floor(t/3600),m=Math.floor(t%3600/60),sec=t%60;
            if(h>0)return m>0?h+'h '+String(m).padStart(2,'0')+'m':h+'h';
            if(m>0)return m+'m'+(sec>0?' '+String(sec).padStart(2,'0')+'s':'');
            return sec+'s';}
          function tick(){var d=Math.max(0,Date.now()-s);
            var h=Math.floor(d/36e5),m=Math.floor(d%36e5/6e4),sec=Math.floor(d%6e4/1e3);
            el.textContent=(h?h+':':'')+String(m).padStart(2,'0')+':'+String(sec).padStart(2,'0');
            var row=document.querySelector('#today-list [data-live-duration]');
            if(row)row.textContent=fmtDurRow(d);
            var w=document.getElementById('timer-worth');
            if(w){var r=parseFloat(w.getAttribute('data-rate'))||0;w.textContent='Worth $'+(d/3600000*r).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' so far';}}
          tick();window.__tkTick=setInterval(tick,1000);})();</script>`;
}

/** Today's entries: the card the today list (and its target bar) loads into. */
export function todayEntriesCard(o: { bodyHtml?: string; listAttrs?: string }): string {
  return `
        <section class="ui-card">
          <div class="ui-block-title">Today's entries</div>
          <div id="today-list"${o.listAttrs ? ` ${o.listAttrs}` : ""}>${o.bodyHtml ?? skeletonRows()}</div>
        </section>`;
}

/** #473: one-tap restart of a finished entry. Hidden inputs survive quotes
 *  and apostrophes where hx-vals JSON would not. */
export function repeatEntryForm(o: { description: string; projectId?: number | string | null }): string {
  return `<form class="ui-repeat-form" hx-post="/timer/start" hx-target="#timer-card" hx-swap="outerHTML swap:200ms">
          <input type="hidden" name="description" value="${esc(o.description)}">
          <input type="hidden" name="project_id" value="${esc(o.projectId == null ? "" : String(o.projectId))}">
          ${iconButton({ icon: "repeat", label: "Repeat entry", tip: "Repeat", type: "submit" })}
        </form>`;
}
