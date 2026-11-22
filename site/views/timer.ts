/** Timer page views: dashboard, timer card, today's entries, and the
 *  today-vs-target pacing bar. Domain data arrives through injected
 *  helpers; layout and demo banner come from their owning slices, so every
 *  call site keeps working unchanged. */

import type { Database, Statement } from "bun:sqlite";
import { addDays, dayBounds, durationSeconds, entryInvoiceMark, entryIsLocked, esc, fmtDur, greeting, money, schemeColor, sundayOf, todayStr } from "../lib/format.ts";
import { entryRow as uiEntryRow } from "../ui/rows.ts";
import { appHeader } from "../ui/app-header.ts";
import { iconButton } from "../ui/icon-button.ts";
import { statStrip } from "../ui/stat.ts";
import { invoiceMark, repeatEntryForm, targetBar, timerRunningCard, timerStartCard, todayEntriesCard } from "../ui/timer-home.ts";
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

  function descSuggestions(): string[] {
    return (qDescSuggest.all() as { description: string }[]).map(r => r.description);
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
    const invMark = mark ? invoiceMark({ label: mark.label, tip: mark.title, cls: mark.cls }) : "";
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
          parts.push(repeatEntryForm({ description: e.description ?? "", projectId: e.project_id }));
        }
        parts.push(iconButton({ icon: "delete", label: "Delete entry", tip: "Delete entry", danger: true, attrs: `hx-delete="/entries/${e.id}" hx-target="#entry-${e.id}" hx-swap="outerHTML swap:220ms" data-confirm="Delete this entry? This cannot be undone." data-confirm-label="Delete entry"` }));
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
      return timerRunningCard({
        context,
        startedAt: running.start_time,
        rate,
        rateLabel: `${rate % 1 === 0 ? `$${rate}` : money(rate)} / hr`,
        worth: money((durationSeconds(running.start_time, null) * rate) / 3600),
      });
    }
    const options = [{ value: "", label: "No project" },
      ...projectOptionRows()
        .map(r => ({ value: String(r.id), label: r.client ? `${r.name} (${r.client})` : r.name }))];
    return timerStartCard({ projectOptions: options, suggestions: descSuggestions() });
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
    const clients = (n: number) => `${n} client${n === 1 ? "" : "s"}`;
    return statStrip([
      {
        label: "Today",
        value: fmtDur(todaySecs),
        note: `of ${fmtDur(target)} goal${todaySecs >= target ? " · met" : ""}`,
        meter: (todaySecs / target) * 100,
      },
      {
        label: "This week",
        value: fmtDur(weekSecs),
        note: `of ${fmtDur(target * 5)} · ${clients(weekClients)}`,
        meter: (weekSecs / (target * 5)) * 100,
      },
      {
        label: "Unbilled",
        value: money(unbilledValue),
        note: `${fmtDur(unbilledSecs)} · ${clients(unbilledClients.size)}`,
        action: { label: "Create Zinvoice", href: "/invoices/new" },
      },
    ]);
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
      ${appHeader({ title, sub: `${dateSub} — here's your day so far.` })}
      <div id="today-stats" hx-get="/partial/today-stats" hx-trigger="load, timer-updated from:body">${statRow()}</div>
      <div class="timer-home" data-enter="2" aria-label="Zimer and today's entries">
        <div class="timer-home-grid">
        ${timerPartial()}
        ${todayEntriesCard({ listAttrs: `hx-get="/partial/today" hx-trigger="load, timer-updated from:body"` })}
        </div>
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
      </div>`, "timer");
  }


  /** Today-vs-target pacing bar at the top of the timer page's today list.
      Rendered inside todayPartial so it refreshes on every timer start/stop
      via the existing `timer-updated` trigger. #908: the target comes from
      the user's setting, not the old 8h constant. */
  function todayTargetBar(totalSecs: number): string {
    const target = dayTargetSecs();
    const met = totalSecs >= target;
    return targetBar({
      pct: (totalSecs / target) * 100,
      label: `Today · ${fmtDur(totalSecs)} / ${fmtDur(target)}${met ? " · Target met" : ""}`,
      ariaLabel: `Today's hours target, ${target / 3600} hours`,
    });
  }

  return { entryRow, timerPartial, todayPartial, todayStatsPartial, dashboardPage };
}
