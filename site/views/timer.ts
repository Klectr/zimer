/** Timer page views: dashboard, timer card, today's entries, and the
 *  today-vs-target pacing bar. Domain data arrives through injected
 *  helpers; layout and demo banner come from their owning slices, so every
 *  call site keeps working unchanged. */

import type { Database, Statement } from "bun:sqlite";
import { addDays, dayBounds, durationSeconds, entryInvoiceMark, entryIsLocked, esc, fmtDur, greeting, money, schemeColor, sundayOf, todayStr } from "../lib/format.ts";
import { timerPanel } from "../ui/timer-display.ts";
import { card } from "../ui/card.ts";
import { selectField, textField } from "../ui/field.ts";
import { button, linkButton } from "../ui/button.ts";
import { entryRow as uiEntryRow } from "../ui/rows.ts";
import { progressBar } from "../ui/progress.ts";
import { appHeader } from "../ui/app-header.ts";
import { iconButton } from "../ui/icon-button.ts";
import { statBlock } from "../ui/stat.ts";
import { tag } from "../ui/tag.ts";
import type { Entry } from "../lib/types.ts";

export interface TimerViewDeps {
  db: Database;
  qRunning: Statement;
  qRange: Statement;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean) => string;
  demoBanner: (db: Database) => string;
  projectOptions: (selected?: number | null) => string;
  projectOptionRows: () => { id: number; name: string; client: string | null }[];
  /* #908: per-request getter — the daily target is a user setting now, and
     the view deps are built once at server startup. */
  dayTargetSecs: () => number;
}

export function createTimerViews(deps: TimerViewDeps) {
  const { db, qRunning, qRange, layout, demoBanner, projectOptions, projectOptionRows, dayTargetSecs } = deps;

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
    /* #330: mark time that's already on an invoice (sent/paid) or in a draft. */
    const mark = entryInvoiceMark(e);
    /* #498: house plain tooltip (data-tip) instead of the native title. */
    const invMark = mark ? `<span class="ui-inv-mark${mark.cls ? ` ${mark.cls}` : ""}" data-tip="${esc(mark.title)}">${esc(mark.label)}</span>` : "";
    const title = e.project_name
      ? (e.client_name ? `${e.client_name} — ${e.project_name}` : e.project_name)
      : (e.client_name || e.description || "No description");
    const descPart = (e.project_name || e.client_name) && e.description ? ` · ${esc(e.description)}` : "";
    const metaHtml = `${invMark}<span>${startTs} – ${endTs}</span>${descPart}`;
    let actions = "";
    if (!entryIsLocked(e)) {
      const parts: string[] = [];
      parts.push(iconButton({ icon: "edit", label: "Edit entry", tip: "Edit", attrs: `data-edit-entry="${e.id}"` }));
      if (e.end_time) {
        /* #462: the timer card owns the running entry — deleting it from the
           list orphaned the card. Stop there first; delete lands on the
           finished row. */
        if (canRepeat) {
          /* #473: repeat posts the row's description + project to the
             existing /timer/start route (mini-form: hidden inputs survive
             quotes and apostrophes where hx-vals JSON would not). */
          parts.push(`<form class="ui-repeat-form" hx-post="/timer/start" hx-target="#timer-card" hx-swap="outerHTML swap:200ms">
          <input type="hidden" name="description" value="${esc(e.description ?? "")}">
          <input type="hidden" name="project_id" value="${e.project_id ?? ""}">
          ${iconButton({ icon: "repeat", label: "Repeat entry", tip: "Repeat", type: "submit" })}
        </form>`);
        }
        parts.push(iconButton({ icon: "delete", label: "Delete entry", tip: "Delete", danger: true, attrs: `hx-delete="/entries/${e.id}" hx-target="#entry-${e.id}" hx-swap="outerHTML swap:220ms" data-confirm="Delete this entry? This cannot be undone."` }));
      }
      actions = parts.join("");
    }
    const amount = e.end_time && e.client_rate
      ? money((durationSeconds(e.start_time, e.end_time) * e.client_rate) / 3600)
      : undefined;
    return uiEntryRow({
      id: `entry-${e.id}`,
      title,
      dot: e.client_color ? schemeColor(e.client_color) : undefined,
      metaHtml,
      duration: dur,
      amount,
      running: !e.end_time,
      actions,
    });
  }

  /** Timer card: running entry with live ticking, or the start form. */
  function timerPartial(): string {
    const running = qRunning.get() as Entry | null;
    if (running) {
      const projLine = running.project_name
        ? (running.client_name ? `${running.client_name} — ${running.project_name}` : running.project_name)
        : (running.client_name ?? "");
      const context = [projLine, running.description ?? ""].filter(Boolean).join(" · ") || "No description";
      const rate = running.client_rate ?? 0;
      const metaHtml = rate > 0
        ? tag({ label: `${rate % 1 === 0 ? `$${rate}` : money(rate)} / hr`, tone: "primary" }) +
          `<span class="ui-tag" id="timer-worth" data-rate="${rate}">Worth ${money((durationSeconds(running.start_time, null) * rate) / 3600)} so far</span>`
        : "";
      return timerPanel({
        id: "timer-card",
        elapsedId: "elapsed",
        running: true,
        statusHtml: tag({ label: "Running", tone: "success", dot: true }),
        context,
        startedAt: running.start_time,
        elapsed: "…",
        metaHtml: metaHtml || undefined,
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
    const options = [{ value: "", label: "No project" },
      ...projectOptionRows()
        .map(r => ({ value: String(r.id), label: r.client ? `${r.name} (${r.client})` : r.name }))];
    return card({ id: "timer-card", content:
      `<div class="ui-timer-top">${tag({ label: "Not tracking" })}</div>` +
      `<form hx-post="/timer/start" hx-target="#timer-card" hx-swap="outerHTML swap:200ms" class="ui-timer-form">` +
      `<div class="ui-timer-form-grow">${textField({ id: "tm-desc", label: "What are you working on?", name: "description", autocomplete: "off", list: "tk-desc-suggest" })}</div>` +
      descDatalist() +
      `<div class="ui-timer-form-project">${selectField({ id: "tm-project", label: "Project", name: "project_id", options })}</div>` +
      button({ label: "Start", type: "submit", variant: "primary", icon: "play", attrs: 'data-tip="Start (t)" aria-keyshortcuts="t"' }) +
      `</form>` +
      `<script>(function(){
        if(window.__tkTick){clearInterval(window.__tkTick);window.__tkTick=null;}
      })();</script>`,
    });
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
    if (!entries.length) return `${bar}<p class="ui-note">Nothing tracked today yet.</p>`;
    /* #473: repeat is only offered when nothing is running — /timer/start
       409s while a timer runs, so showing it then would be a silent no-op. */
    const canRepeat = !qRunning.get();
    return `${bar}
      <div class="ui-list">${entries.map((e, i) => entryRow(e, i, canRepeat)).join("")}</div>`;
  }

  /* #1121: the mock's stat-card row above the panes — today vs the
     daily target, the Sun–Sat week vs five days of target, and unbilled
     value with the #328 per-entry 5-minute round-up the Zinvoices page
     uses. The dashboard's initial render uses the server day; the
     #today-stats region re-fetches with the client's bounds on load
     (#255), and again on every timer start/stop. */
  function statRow(from?: string, to?: string, weekFrom?: string, weekTo?: string): string {
    const target = dayTargetSecs();
    const [tf, tt] = from && to ? [from, to] : dayBounds(todayStr());
    const todayEntries = qRange.all(tf, tt) as Entry[];
    const todaySecs = todayEntries.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
    const sun = sundayOf(todayStr());
    const [dwf] = dayBounds(sun);
    const [dwt] = dayBounds(addDays(sun, 7));
    const [wf, wt] = weekFrom && weekTo ? [weekFrom, weekTo] : [dwf, dwt];
    const weekEntries = qRange.all(wf, wt) as Entry[];
    const weekSecs = weekEntries.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
    const weekClients = new Set(weekEntries.map(e => e.client_name).filter(Boolean)).size;
    const unbilledRows = db.query(
      `SELECT c.id AS cid, c.rate AS rate, e.start_time, e.end_time FROM time_entries e
       JOIN projects p ON p.id = e.project_id
       JOIN clients c ON c.id = p.client_id
       WHERE e.invoice_id IS NULL AND e.end_time IS NOT NULL`).all() as any[];
    let unbilledSecs = 0, unbilledValue = 0;
    const unbilledClients = new Set<number>();
    for (const r of unbilledRows) {
      const secs = Math.ceil(durationSeconds(r.start_time, r.end_time) / 300) * 300;
      if (secs <= 0) continue;
      unbilledSecs += secs;
      unbilledValue += (secs / 3600) * (r.rate || 0);
      unbilledClients.add(r.cid);
    }
    const across = (n: number) => `across ${n} client${n === 1 ? "" : "s"}`;
    return `<div class="ui-stat-row">` +
      card({ content: statBlock({ label: "Today", value: fmtDur(todaySecs), sub: `Goal ${fmtDur(target)}${todaySecs >= target ? " · Target met" : ""}` }) + progressBar({ value: (todaySecs / target) * 100, label: "Today's goal progress" }) }) +
      card({ content: statBlock({ label: "This week", value: fmtDur(weekSecs), sub: `Across ${weekClients} client${weekClients === 1 ? "" : "s"}` }) + progressBar({ value: (weekSecs / (target * 5)) * 100, label: "Week progress" }) }) +
      card({ content: statBlock({ label: "Unbilled", value: money(unbilledValue), sub: `${fmtDur(unbilledSecs)} ${across(unbilledClients.size)}` }) + linkButton({ label: "Create Zinvoice", href: "/invoices/new", size: "sm" }) }) +
      `</div>`;
  }

  /* #1121: the stat row as a partial — the client passes its own day and
     week bounds (#255 pattern, same as /partial/today) so the figures
     agree with the today list below them in every timezone. */
  function todayStatsPartial(from?: string, to?: string, weekFrom?: string, weekTo?: string): string {
    return statRow(from, to, weekFrom, weekTo);
  }

  function dashboardPage(): string {
    const dateSub = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${todayStr()}T12:00:00Z`));
    const title = greeting();
    return layout(title, `
      ${demoBanner(db)}
      ${appHeader({ title, sub: `${dateSub} — here's your day so far.`, actions: linkButton({ label: "Zinvoice this week", href: "/invoices/new", icon: "receipt", id: "invoice-week" }) })}
      <div id="today-stats" hx-get="/partial/today-stats" hx-trigger="load, timer-updated from:body">${statRow()}</div>
      <div class="scroll-region timer-home" data-enter="2" aria-label="Zimer and today's entries">
        ${timerPartial()}
        <section class="ui-card">
          <div class="ui-block-title">Today's entries</div>
          <div id="today-list" hx-get="/partial/today" hx-trigger="load, timer-updated from:body">
            <div class="skel-stack" aria-hidden="true">
              <div class="skel skel-row"></div>
              <div class="skel skel-row"></div>
              <div class="skel skel-row"></div>
            </div>
          </div>
        </section>
        <script>(function(){/* #255: client day bounds + client-side time formatting.
              Runs at parse time, before htmx's load trigger fires. */
              var el=document.getElementById('today-list');if(!el)return;
              var d=new Date();
              var sub=document.querySelector('.ui-app-head .ui-app-sub');
              if(sub)sub.textContent=d.toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'})+" — here's your day so far.";
              var hr=d.getHours();var greet=hr<12?"Good morning":hr<17?"Good afternoon":"Good evening";
              var ttl=document.querySelector('.ui-app-head .ui-app-title');
              if(ttl)ttl.textContent=greet;
              document.title=greet+" · Zimer";
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
              var stats=document.getElementById('today-stats');
              if(stats){var wsun=new Date(d.getFullYear(),d.getMonth(),d.getDate()-d.getDay());
                var wend=new Date(wsun.getFullYear(),wsun.getMonth(),wsun.getDate()+7);
                stats.setAttribute('hx-get','/partial/today-stats?from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to)+'&wfrom='+encodeURIComponent(wsun.toISOString())+'&wto='+encodeURIComponent(wend.toISOString()));}
              window.__tkFmtTimes=function(root){
                var els=(root||document).querySelectorAll('[data-ts]');
                for(var i=0;i<els.length;i++){var t=els[i];
                  t.textContent=new Date(t.getAttribute('data-ts')).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});}};
              document.body.addEventListener('htmx:afterSwap',function(e){
                if(e.detail&&e.detail.target&&e.detail.target.id==='today-list')window.__tkFmtTimes(e.detail.target);});
          window.__tkFmtTimes(el);})();</script>
      </div>`, "timer", true);
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
      <div class="ui-target">
        ${progressBar({ value: pct, label: `Today's hours target, ${target / 3600} hours` })}
        <div class="ui-target-label">Today · ${fmtDur(totalSecs)} / ${fmtDur(target)}${met ? " · Target met" : ""}</div>
      </div>`;
  }

  return { entryRow, timerPartial, todayPartial, todayStatsPartial, dashboardPage };
}
