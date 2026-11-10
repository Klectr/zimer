/** Calendar views: the week presentations (ui visualizer grid + ui week
 *  agenda), supporting pane, the entry dialog + inline calendar script,
 *  and the edit-entry page. Week data arrives through injected queries
 *  and helpers; every existing call site keeps working unchanged. */

import type { Database, Statement } from "bun:sqlite";
import { addDays, durationSeconds, entryInvoiceMark, entryIsLocked, esc, fmtDur, schemeColor } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import { workspaceEmpty } from "../lib/demo.ts"; /* #300: first-run hint */
import { button, linkButton } from "../ui/button.ts";
import { selectField, textField } from "../ui/field.ts";
import { weekView, type WeekDay, type WeekEntry } from "../ui/week-view.ts";
import { iconButton } from "../ui/icon-button.ts";
import { tag } from "../ui/tag.ts";
import { visualizer, type VizDay, type VizEntry } from "../ui/visualizer.ts";
import type { Entry } from "../lib/types.ts";

export interface CalendarViewDeps {
  db: Database;
  qOne: Statement;
  qRange: Statement;
  entrySelect: string;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean) => string;
  projectOptionRows: () => { id: number; name: string; client: string | null }[];
  weekTargetBar: (weekTotalSecs: number) => string;
  calHourPx: number;
}

export function createCalendarViews(deps: CalendarViewDeps) {
  const { db, qOne, qRange, entrySelect: ENTRY_SELECT, layout, projectOptionRows, weekTargetBar, calHourPx } = deps;

  /* #1121: the project pickers' options as data — the same rows and
     "Name (Client)" labels the Timer panel's picker uses. */
  function projectSelectOptions() {
    return [{ value: "", label: "No project" },
      ...projectOptionRows().map(r => ({ value: String(r.id), label: r.client ? `${r.name} (${r.client})` : r.name }))];
  }

  /* #578: description suggestions for the entry dialog — the 15 most recently
     used non-blank descriptions, deduped. Same pattern as the timer start
     form (#546): a browser-native datalist, zero visual surface until the
     field is focused or typed in. Own id so it never collides with the
     timer page's tk-desc-suggest. */
  const qDescSuggest = db.query(`
    SELECT description FROM time_entries
    WHERE description IS NOT NULL AND TRIM(description) != ''
    GROUP BY description ORDER BY MAX(start_time) DESC LIMIT 15`);

  function descDatalist(): string {
    const rows = qDescSuggest.all() as { description: string }[];
    if (!rows.length) return "";
    return `<datalist id="tk-desc-suggest-dialog">${rows.map(r => `<option value="${esc(r.description)}">`).join("")}</datalist>`;
  }

  /* #256: the server may be in another timezone (VPS is UTC), so every
     "local" computation — day bucketing, entry positioning, today highlight,
     week bounds — is done in the *client's* IANA zone, plumbed through as
     ?tz= on week requests. Without a valid tz we keep the legacy server-local
     behavior. */
  const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const ymdOf = (p: { y: number; m: number; d: number }) =>
    `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  /** Wall-clock parts of an instant in the client's zone. */
  function tzParts(d: Date, tz: string | null): { y: number; m: number; d: number; hh: number; mm: number } {
    if (!tz) return { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), hh: d.getHours(), mm: d.getMinutes() };
    const p: Record<string, string> = {};
    for (const x of new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d)) p[x.type] = x.value;
    return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour, mm: +p.minute };
  }
  /** Validate an IANA zone string; null when absent or invalid. */
  function validTz(tz: string | null | undefined): string | null {
    if (!tz || tz.length > 64 || !/^[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+)+$/.test(tz)) return null;
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return null; }
  }
  /** UTC offset of a zone at an instant, in minutes (CDT = -300). */
  function zoneOffsetMin(tz: string, at: Date): number {
    const p: Record<string, string> = {};
    for (const x of new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(at)) p[x.type] = x.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return Math.round((asUTC - at.getTime()) / 60000);
  }
  /** Sunday of the week containing a YYYY-MM-DD, from the calendar date alone
      (weekday-safe in every zone, unlike noon-anchored Date parsing). */
  function sundayOfYmd(dateStr: string): string {
    const [y, m, d] = dateStr.split("-").map(Number);
    return addDays(dateStr, -new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay());
  }
  const weekdayOf = (y: number, m: number, d: number) => WEEKDAYS[new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()];
  /** [from, to] ISO instants covering the client's week starting Sunday `sun`.
      Both bounds are computed independently so DST-transition weeks stay
      contiguous with their neighbors. Falls back to the legacy naive-local
      strings without a tz. */
  function weekBoundsISO(sun: string, tz: string | null): [string, string] {
    if (!tz) return [sun + "T00:00:00", addDays(sun, 7) + "T00:00:00"];
    return [new Date(localMidnightUTC(tz, sun)).toISOString(),
            new Date(localMidnightUTC(tz, addDays(sun, 7))).toISOString()];
  }
  /** UTC instant of 00:00 local on a YYYY-MM-DD in tz. Iterative: the offset
      is sampled at the guess and refined, converging across DST transitions. */
  function localMidnightUTC(tz: string, dateStr: string): number {
    const [y, m, d] = dateStr.split("-").map(Number);
    let guess = Date.UTC(y, m - 1, d);
    for (let i = 0; i < 3; i++) guess = Date.UTC(y, m - 1, d) - zoneOffsetMin(tz, new Date(guess)) * 60000;
    return guess;
  }

  /** #572: week-scoped data shared by the carousel strips, the week grid
      and the agenda — the week's entries bucketed by client-local day, plus
      the summary figures the supporting pane shows (always week-scoped). */
  interface CalWeekData {
    tz: string | null;
    today: string;
    sun: string;
    rows: Entry[];
    byDay: Map<string, Entry[]>;
    weekTotal: number;
    weekBillable: number;
    clientRows: { name: string; color: string | null; secs: number }[];
    uninvoiced: number;
    prevBillable: number;
  }

  function weekData(sun: string, tz: string | null): CalWeekData {
    /* "today" in the client's zone — the server may be on a different date. */
    const today = ymdOf(tzParts(new Date(), tz));
    // Fetch the whole week in one query, then bucket entries by the client's local day.
    const [wFrom, wTo] = weekBoundsISO(sun, tz);
    const rows = db.query(
      `${ENTRY_SELECT} WHERE e.start_time >= ? AND e.start_time < ? ORDER BY e.start_time`).all(wFrom, wTo) as Entry[];
    const byDay = new Map<string, Entry[]>();
    for (const e of rows) {
      const key = ymdOf(tzParts(new Date(e.start_time), tz));
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(e);
    }
    /* Per-client week totals from the same query (no extra DB hit), sorted
       descending. Entries without a client roll into a "No client" bucket. */
    const byClient = new Map<string, { name: string; color: string | null; secs: number }>();
    let weekTotal = 0, weekBillable = 0;
    for (const e of rows) {
      const secs = durationSeconds(e.start_time, e.end_time);
      weekTotal += secs;
      /* Billable = entry has a project (hence a client); non-billable = no project. */
      if (e.project_id != null) weekBillable += secs;
      const key = e.client_name ?? "__none";
      const cur = byClient.get(key) ?? { name: e.client_name ?? "No client", color: e.client_color, secs: 0 };
      cur.secs += secs;
      byClient.set(key, cur);
    }
    const clientRows = [...byClient.values()].sort((a, b) => b.secs - a.secs);
    /* #351: only invoiceable time counts as "not yet invoiced" — entries with a
       project. Non-project time can never land on an invoice. */
    const uninvoiced = rows.reduce(
      (s, e) => s + (e.invoice_id == null && e.project_id != null ? durationSeconds(e.start_time, e.end_time) : 0), 0);
    /* #351: week-over-week delta vs the immediately preceding week — billable
       vs billable, since it sits next to the billable figure. */
    const [pFrom, pTo] = weekBoundsISO(addDays(sun, -7), tz);
    const prevRows = qRange.all(pFrom, pTo) as Entry[];
    const prevBillable = prevRows.reduce(
      (a, e) => a + (e.project_id != null ? durationSeconds(e.start_time, e.end_time) : 0), 0);
    return { tz, today, sun, rows, byDay, weekTotal, weekBillable, clientRows, uninvoiced, prevBillable };
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const toHM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  /** 12-hour wall-clock label ("9:02 AM") for agenda rows. */
  function fmt12(mins: number): string {
    const h24 = Math.floor(mins / 60);
    const suffix = h24 >= 12 ? "PM" : "AM";
    const h = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h}:${String(mins % 60).padStart(2, "0")} ${suffix}`;
  }

  /** One day's entries as positioned blocks, shared by both week
      presentations: client-local start/end minutes, running entries
      extended to now (never shorter than 15 minutes), sorted by start. */
  function dayBlocks(day: string, data: CalWeekData): { e: Entry; a: number; b: number }[] {
    const toMin = (iso: string) => { const p = tzParts(new Date(iso), data.tz); return p.hh * 60 + p.mm; };
    const nowP = tzParts(new Date(), data.tz);
    const nowMin = nowP.hh * 60 + nowP.mm;
    return (data.byDay.get(day) ?? [])
      .map((e) => {
        const a = toMin(e.start_time);
        const b = Math.max(e.end_time ? toMin(e.end_time) : nowMin, a + 15);
        return { e, a, b };
      })
      .sort((x, y) => x.a - y.a);
  }

  function entryTitle(e: Entry): string {
    return e.project_name
      ? `${e.project_name} — ${e.description || "No description"}`
      : (e.description || "No description");
  }

  function dayTotalSecs(day: string, data: CalWeekData): number {
    return (data.byDay.get(day) ?? []).reduce((s, e) => s + durationSeconds(e.start_time, e.end_time), 0);
  }

  /** The week's days as visualizer input — the wide time-grid presentation. */
  function vizDays(wd: CalWeekData): VizDay[] {
    const days: VizDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(wd.sun, i);
      const [y, m, d] = day.split("-").map(Number);
      const blocks = dayBlocks(day, wd);
      const entries: VizEntry[] = blocks.map(({ e, a, b }) => {
        const locked = entryIsLocked(e); /* #334: sent/paid time is a frozen record */
        return {
          id: String(e.id),
          title: entryTitle(e),
          desc: e.description || undefined,
          projectId: e.project_id != null ? String(e.project_id) : undefined,
          startMin: a,
          endMin: b,
          running: !e.end_time,
          invoiced: !!entryInvoiceMark(e),
          locked,
          lockedLabel: locked ? (e.invoice_number || "1") : undefined,
          /* Entries render full-width; an entry involved in an overlap
             gets the layered shadow so it reads as elevated above the
             entry beneath it. */
          overlap: blocks.some((o) => o.e !== e && o.a < b && o.b > a),
        };
      });
      days.push({
        date: day,
        label: `${weekdayOf(y, m, d).slice(0, 3)} ${d}`,
        total: dayTotalSecs(day, wd) > 0 ? fmtDur(dayTotalSecs(day, wd)) : "0h",
        isToday: day === wd.today,
        entries,
      });
    }
    return days;
  }

  /** The week's days as weekView input — the narrow agenda presentation.
      Entry rows carry the same data-* attributes as the grid blocks, so
      the edit dialog opens unchanged. */
  function agendaDays(wd: CalWeekData): WeekDay[] {
    const days: WeekDay[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(wd.sun, i);
      const [y, m, d] = day.split("-").map(Number);
      const wdName = weekdayOf(y, m, d);
      const totalSecs = dayTotalSecs(day, wd);
      const entries: WeekEntry[] = dayBlocks(day, wd).map(({ e, a, b }) => {
        const running = !e.end_time;
        const locked = entryIsLocked(e); /* #334: sent/paid time is a frozen record */
        const mark = entryInvoiceMark(e);
        const markA11y = mark ? `, ${mark.label} ${e.invoice_number || ""}` : "";
        /* #479: the aria-label is a plain-text accessible name — no markup. */
        const label = `${e.description || "No description"}, ${fmtDur(durationSeconds(e.start_time, e.end_time))}${markA11y}`;
        return {
          title: entryTitle(e),
          meta: `${fmt12(a)} – ${running ? "now" : fmt12(b)}`,
          duration: fmtDur(durationSeconds(e.start_time, e.end_time)),
          running,
          invoiced: !!mark,
          attrs: `data-entry-row data-id="${e.id}" data-desc="${esc(e.description)}" data-project-id="${e.project_id ?? ""}" data-date="${day}" data-start="${toHM(a)}" data-end="${running ? "" : toHM(Math.min(b, 1439))}" data-locked="${locked ? esc(e.invoice_number || "") : ""}" tabindex="0" role="button" aria-label="${esc(label)}"`,
        };
      });
      days.push({
        weekday: wdName.slice(0, 3),
        dateLabel: `${MONTHS[m - 1]} ${d}`,
        date: day,
        total: totalSecs > 0 ? fmtDur(totalSecs) : "",
        isToday: day === wd.today,
        addHtml: iconButton({ icon: "add", label: `Log time ${wdName}`, tip: null, attrs: `data-ag-new="${day}"` }),
        entries,
      });
    }
    return days;
  }

  /** #572: the supporting pane's inner HTML for one week. Rendered live in
      the aside and once per carousel strip inside a <template>, so the pane
      swaps instantly (no fetch) when a pan settles on a pre-rendered week. */
  function paneInner(wd: CalWeekData): string {
    const { sun, today, weekTotal, weekBillable, clientRows, uninvoiced, prevBillable } = wd;
    const prev = addDays(sun, -7), next = addDays(sun, 7);
    const isThisWeek = sun === sundayOfYmd(today);
    const weekLabel = new Date(sun + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });
    const navTitle = isThisWeek ? "This week" : `Week of ${weekLabel}`;
    const navActions = `
      ${isThisWeek ? "" : `<a class="ui-btn ui-btn-ghost" href="/calendar" hx-get="/partial/week" hx-target="#week" hx-swap="innerHTML" hx-push-url="/calendar">Today</a>`}
      <a class="ui-icon-btn" href="/calendar?week=${prev}" hx-get="/partial/week?week=${prev}" hx-target="#week" hx-swap="innerHTML" hx-push-url="/calendar?week=${prev}" data-slide="prev" data-tip="Previous week" aria-label="Previous week">${icon("chevron_left")}</a>
      <a class="ui-icon-btn tip-right" href="/calendar?week=${next}" hx-get="/partial/week?week=${next}" hx-target="#week" hx-swap="innerHTML" hx-push-url="/calendar?week=${next}" data-slide="next" data-tip="Next week" aria-label="Next week">${icon("chevron_right")}</a>`;
    const showChipAmount = uninvoiced < weekBillable;
    const nudgeChip = uninvoiced > 0 ? `
      <a class="nudge-chip${showChipAmount ? "" : " nudge-chip--solo"}" href="/invoices/new?from=${sun}&to=${addDays(sun, 7)}">
        ${showChipAmount ? `<span>${fmtDur(uninvoiced)} not yet zinvoiced</span>` : ""}
        ${/* #592: the link invoices the VIEWED week, so "this week" lies on
           past/future weeks. Keep it on the current week, "this period"
           everywhere else. */ ""}
        <span class="nudge-go">${icon("receipt")} ${isThisWeek ? "Zinvoice this week" : "Zinvoice this period"}</span>
      </a>` : "";
    const clientStrip = clientRows.length === 0 ? "" : `
      <div class="week-clients">
        ${clientRows.map(c => `
          <span class="week-client">
            <span class="week-client-dot"${c.color ? ` style="background:${esc(schemeColor(c.color))}"` : ""}></span>
            <span>${esc(c.name)}</span>
            <span class="muted">${fmtDur(c.secs)}</span>
          </span>`).join("")}
      </div>`;
    const deltaHtml = (() => {
      /* #524: no previous-week data → omit the delta AND its separator. A
         dangling "· —" reads like a half-loaded widget. */
      if (prevBillable <= 0) return "";
      const pct = Math.round(((weekBillable - prevBillable) / prevBillable) * 100);
      /* #542: trend icon comes from the icon system, not a text glyph (↑/↓/→)
         — house rule, see #448. The svg is aria-hidden; the direction word
         lives in the span's accessible label so the info survives the swap. */
      const trend = pct > 0 ? "trend_up" : pct < 0 ? "trend_down" : "trend_flat";
      const dirWord = pct > 0 ? "up" : pct < 0 ? "down" : "unchanged";
      const abs = Math.abs(pct);
      /* #590: the direction word belongs in the VISIBLE text, not just the
         icon and the aria-label — "100% vs prev week" reads ambiguous at a
         glance (100% of what, which direction?). */
      return ` · <span class="muted cal-delta" aria-label="${abs}% ${dirWord} vs prev week">${icon(trend)} ${abs}% ${dirWord} vs prev week</span>`;
    })();
    return `
      <div class="week-nav">
        <h1 class="ui-page-title">${esc(navTitle)}</h1>
        <div class="week-nav-actions">
          ${navActions}
        </div>
      </div>
      <div class="cal-summary">
        <div class="ui-page-title cal-summary-total">${fmtDur(weekTotal)}</div>
        <div class="ui-row-meta cal-summary-sub">${fmtDur(weekBillable)} billable${deltaHtml}</div>
        ${nudgeChip}
      </div>
      ${weekTargetBar(weekTotal)}
      ${clientStrip}
      ${/* #781: the create gesture differs per presentation — drag-to-create on
         the 24h grid, the per-day + button on the narrow agenda. Both variants
         render in place; the client picks by strip width (see syncCalHint). */ ""}
      <p class="muted tiny cal-hint"><span class="cal-hint-grid">Drag across the calendar to log time. Click an entry to edit it.</span><span class="cal-hint-agenda">Tap + to log time, tap an entry to edit.</span></p>
      ${workspaceEmpty(db) ? `<div class="cal-first-run">
        ${icon("info")}
        <p><strong>New here?</strong> Load fictional sample data to explore the calendar.</p>
        <form method="post" action="/demo/load" class="inline">${button({ label: "Load demo data", variant: "ghost", type: "submit" })}</form>
      </div>` : ""}`;
  }

  /** #572: a carousel strip's inner HTML for one week — the visualizer
      grid, the narrow agenda, and the week's supporting pane in a
      <template>. */
  function stripInnerHtml(sun: string, tz: string | null): string {
    const wd = weekData(sun, tz);
    const nowP = tzParts(new Date(), tz);
    const nowMin = nowP.hh * 60 + nowP.mm;
    return `
      <div class="cal-scroll" data-enter="3">${visualizer({ days: vizDays(wd), startHour: 0, endHour: 24, hourPx: calHourPx, nowMin })}</div>
      <div class="cal-legend">
        ${tag({ label: "Billable", tone: "primary" })}
        ${tag({ label: "Invoiced", tone: "success" })}
        ${linkButton({ label: "Export week CSV", href: `/export/entries.csv?from=${sun}&to=${addDays(sun, 7)}`, size: "sm", download: true, className: "cal-legend-export" })}
      </div>
      ${weekView({ agendaOnly: true, days: agendaDays(wd) })}
      <template class="cal-pane-tpl">${paneInner(wd)}</template>`;
  }

  /** #572: one carousel strip — a full week, tagged with its Sunday. */
  function stripHtml(sun: string, tz: string | null): string {
    return `<div class="cal-strip" data-sun="${sun}">${stripInnerHtml(sun, tz)}</div>`;
  }

  /** Inner HTML of the #week section (everything that changes when entries do).
      Served full-page via weekGrid() and in-place via GET /partial/week (#65).
      #572: a three-week carousel — previous, current, and next week strips
      pre-rendered side by side. Chevron pans translate the track; the far
      strip is recycled and repopulated in the background after each settle. */
  function weekInner(weekStr?: string, tzParam?: string): string {
    const tz = validTz(tzParam);
    /* "today" in the client's zone — the server may be on a different date. */
    const today = ymdOf(tzParts(new Date(), tz));
    const sun = weekStr && /^\d{4}-\d{2}-\d{2}$/.test(weekStr) ? weekStr : sundayOfYmd(today);
    const wd = weekData(sun, tz);
    const strips = [addDays(sun, -7), sun, addDays(sun, 7)].map((s) => stripHtml(s, tz)).join("");
    return `
    <div class="cal-pane-layout">
      <aside class="cal-supporting" data-enter="3" aria-label="Week summary">
        ${paneInner(wd)}
      </aside>
      <div class="cal-carousel">
        <div class="cal-track">
          ${strips}
        </div>
      </div>
    </div>
    `;
  }

  /** #572: a single strip's inner HTML — GET /partial/week?week=&strip=1, the
      background fill when a pan recycles the far strip. */
  function weekStrip(weekStr?: string, tzParam?: string): string {
    const tz = validTz(tzParam);
    const today = ymdOf(tzParts(new Date(), tz));
    const sun = weekStr && /^\d{4}-\d{2}-\d{2}$/.test(weekStr) ? weekStr : sundayOfYmd(today);
    return stripInnerHtml(sun, tz);
  }

  /** Full calendar week section: the #week wrapper plus the persistent entry
      dialog and calendar script. The dialog and script live outside #week so an
      in-place week refresh (#65) never destroys dialog bindings or duplicates
      listeners.
      #256: the grid loads via htmx (tz is appended by calScript's
      htmx:configRequest) so the first paint is already in the client's zone —
      a server-rendered grid would flash server-timezone positions. */
  /** The persistent entry dialog — lives outside #week so an in-place week
      refresh (#65) never destroys its bindings. Rendered once in the page
      skeleton; the carousel strips never include it. */
  function calDialog(): string {
    return `<div class="cal-scrim ui-scrim" id="cal-scrim" hidden>
        <div class="cal-dialog ui-dialog" role="dialog" aria-modal="true" aria-labelledby="cal-dialog-title">
          <div class="cal-dialog-head">
            <h2 class="ui-dialog-title" id="cal-dialog-title">New entry</h2>
            ${iconButton({ icon: "close", label: "Close dialog", id: "cal-close", tip: null })}
          </div>
          <p class="muted" id="cal-dialog-date"></p>
          ${textField({ id: "cal-desc", label: "Description", autocomplete: "off", list: "tk-desc-suggest-dialog" })}
          ${descDatalist()}
          ${selectField({ id: "cal-project", label: "Project", options: projectSelectOptions() })}
          <div class="cal-time-row">
            ${textField({ id: "cal-start", label: "Start", type: "time", required: true })}
            ${textField({ id: "cal-end", label: "End", type: "time", required: true })}
            <span id="cal-dur"></span>
          </div>
          <p class="muted tiny" id="cal-locked" hidden></p>
          <p class="error tiny" id="cal-error" hidden></p>
          <div class="cal-dialog-actions">
            ${button({ label: "Delete", variant: "ghost", danger: true, id: "cal-delete", attrs: "hidden" })}
            <span class="cal-spacer"></span>
            ${button({ label: "Cancel", variant: "ghost", id: "cal-cancel" })}
            ${button({ label: "Save", variant: "primary", id: "cal-save" })}
          </div>
        </div>
      </div>`;
  }

  function weekGrid(weekStr?: string): string {
    const q = weekStr && /^\d{4}-\d{2}-\d{2}$/.test(weekStr) ? `?week=${weekStr}` : "";
    /* #322: the skeleton mirrors the carousel pane layout (summary aside
       with the week-nav skeleton at its top) so the htmx swap lands
       without a layout flash. */
    const skelStrip = `<div class="cal-strip"><div class="cal-scroll" style="padding:4px"><div class="skel" style="height:100%"></div></div></div>`;
    return `<div id="week" hx-get="/partial/week${q}" hx-trigger="load" hx-swap="innerHTML">
      <div class="cal-pane-layout" style="--i:3">
        <aside class="cal-supporting">
          <div class="week-nav">
            <div class="skel cal-skel-nav-title"></div>
            <div class="skel cal-skel-nav-actions"></div>
          </div>
          <div class="skel cal-skel-summary"></div>
        </aside>
        <div class="cal-carousel">
          <div class="cal-track">
            ${skelStrip}
            ${skelStrip}
            ${skelStrip}
          </div>
        </div>
      </div>
    </div>
    ${calDialog()}
    <script>${calScript()}</script>
  `;
  }

  /** Inline script: drag-to-create, click-to-edit, now-line ticking. No htmx needed. */
  function calScript(): string {
    return `(function(){
    var HOUR=${calHourPx}, START=0;
    /* The visualizer root carries the same geometry in its dataset; prefer
       it when a grid is already in the DOM, fall back to the injected
       constants. All strips share one geometry. */
    (function(){
      var v=document.querySelector('.ui-viz');
      if(v){ HOUR=parseFloat(v.getAttribute('data-hour-px'))||HOUR;
        START=parseFloat(v.getAttribute('data-start-min'))||0; }
    })();
    function hourOf(el){ var v=el&&el.closest?el.closest('.ui-viz'):null;
      var h=v?parseFloat(v.getAttribute('data-hour-px')):NaN; return isNaN(h)?HOUR:h; }
    function startOf(el){ var v=el&&el.closest?el.closest('.ui-viz'):null;
      var s=v?parseFloat(v.getAttribute('data-start-min')):NaN; return isNaN(s)?START:s; }
    function endOf(el){ var v=el&&el.closest?el.closest('.ui-viz'):null;
      var s=v?parseFloat(v.getAttribute('data-end-min')):NaN; return isNaN(s)?1440:s; }
    /* #256: the client's IANA zone. Appended to every /partial/week request
       (htmx:configRequest covers nav links; refreshWeek appends it to fetch),
       and as a ±HH:MM suffix on posted datetimes so the server stores the
       right instant instead of parsing wall-clock time in its own zone. */
    var TZ=""; try{ TZ=Intl.DateTimeFormat().resolvedOptions().timeZone||""; }catch(e){}
    function tzSuffix(){var o=-new Date().getTimezoneOffset();var s=o<0?"-":"+",a=Math.abs(o);
      return s+String(Math.floor(a/60)).padStart(2,"0")+":"+String(a%60).padStart(2,"0");}
    document.body.addEventListener("htmx:configRequest",function(e){
      if(e.detail&&e.detail.path&&e.detail.path.indexOf("/partial/week")===0&&TZ)
        e.detail.parameters.tz=TZ;});
    /* #572: week carousel state. Three pre-rendered week strips sit side by
       side in .cal-track (translateX(-100%) at rest); chevron pans translate
       ±100% on a pure transform. stripWeeks tracks each strip's Sunday in
       DOM order. */
    var trackEl=null, stripWeeks=[], panning=false;
    var panReduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    function trackStrips(){ return trackEl?Array.prototype.slice.call(trackEl.children):[]; }
    function initCarousel(){
      trackEl=document.querySelector('#week .cal-track');
      stripWeeks=trackStrips().map(function(s){return s.getAttribute('data-sun');});
      panning=false;
      if(trackEl){ trackEl.classList.add('no-anim');
        trackEl.style.transform='translateX(-100%)';
        void trackEl.offsetWidth; trackEl.classList.remove('no-anim'); }
    }
    function ymdUTC(d){var p=function(x){return String(x).padStart(2,"0");};
      return d.getUTCFullYear()+"-"+p(d.getUTCMonth()+1)+"-"+p(d.getUTCDate());}
    function shiftYmd(ymd,n){var p=ymd.split("-");
      return ymdUTC(new Date(Date.UTC(+p[0],+p[1]-1,+p[2])+n*864e5));}
    function stripUrl(sun){
      var u='/partial/week?week='+encodeURIComponent(sun)+'&strip=1';
      return u+(TZ?'&tz='+encodeURIComponent(TZ):'');
    }

    var scrim=document.getElementById('cal-scrim');
    var dialog=scrim.querySelector('.cal-dialog');
    /* Dialog motion: .open drives scrim fade + dialog scale/fade.
       Generation counter keeps rapid open/close/open sequences sane. */
    var scrimGen=0;
    function showScrim(){
      scrimGen++;
      scrim.hidden=false;
      void scrim.offsetWidth; /* commit unhide so the transition runs */
      scrim.classList.add('open');
    }
    function hideScrim(){
      var gen=++scrimGen;
      scrim.classList.remove('open');
      var done=false;
      var finish=function(){ if(done||gen!==scrimGen) return; done=true; scrim.hidden=true; };
      var onEnd=function(e){
        if(e.target===dialog&&e.propertyName==='transform'){
          dialog.removeEventListener('transitionend',onEnd); finish();
        }
      };
      dialog.addEventListener('transitionend',onEnd);
      setTimeout(finish,400);
    }
    var title=document.getElementById('cal-dialog-title');
    var dateLine=document.getElementById('cal-dialog-date');
    var desc=document.getElementById('cal-desc');
    var project=document.getElementById('cal-project');
    var startI=document.getElementById('cal-start');
    var endI=document.getElementById('cal-end');
    var dur=document.getElementById('cal-dur');
    var err=document.getElementById('cal-error');
    var lockNote=document.getElementById('cal-locked');
    var delBtn=document.getElementById('cal-delete');
    var saveBtn=document.getElementById('cal-save');
    var mode='create', editId=null, dayStr='', opener=null;
    var saving=false; /* #930: one in-flight save at a time — double-tap on
      Save used to multi-submit and create duplicate entries. */
    /* grid owns the scroll: land near the current time when today is in view */
    var scroller=document.querySelector('.cal-scroll'), nowEl=document.querySelector('[data-now]');
    if(scroller&&nowEl){var r=nowEl.getBoundingClientRect(),s=scroller.getBoundingClientRect();
      scroller.scrollTop=Math.max(0,r.top-s.top+scroller.scrollTop-scroller.clientHeight*0.35);}
    function toMin(t){var p=t.split(':');return (+p[0])*60+(+p[1]);}
    function toHM(m){m=((m%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
    function fmtD(mins){var h=Math.floor(mins/60),m=mins%60;return (h?h+'h ':'')+m+'m';}
    function fmt12(mins){var h24=Math.floor(mins/60),m=mins%60,s=h24>=12?'PM':'AM',
      h=h24%12===0?12:h24%12;return h+':'+String(m).padStart(2,'0')+' '+s;}
    function updDur(){var s=toMin(startI.value||'00:00'),e=toMin(endI.value||'00:00');
      dur.textContent=e>s?fmtD(e-s):'';}
    startI.addEventListener('input',updDur); endI.addEventListener('input',updDur);
    function openCreate(date,a,b){
      mode='create'; editId=null; dayStr=date; opener=null; /* drag — no keyboard trigger */
      saving=false; saveBtn.disabled=false; /* #930 */
      title.textContent='New entry'; delBtn.hidden=true; err.hidden=true;
      var d=new Date(date+'T12:00:00');
      dateLine.textContent=d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
      desc.value=''; project.value='';
      startI.value=toHM(a); endI.value=toHM(b); updDur();
      lockNote.hidden=true; /* #334: the dialog is reused — clear locked state */
      desc.disabled=false; project.disabled=false; startI.disabled=false; endI.disabled=false;
      saveBtn.hidden=false;
      showScrim(); desc.focus();
    }
    function openEdit(el){
      mode='edit'; editId=el.dataset.id; dayStr=el.dataset.date; opener=el;
      saving=false; saveBtn.disabled=false; /* #930 */
      var locked=el.dataset.locked||''; /* #334: sent/paid time opens read-only */
      var running=el.classList.contains('is-running'); /* #462: the timer card owns
        the running entry — deleting it here orphaned the card. */
      title.textContent=locked?'Entry (zinvoiced)':'Edit entry';
      delBtn.hidden=!!locked||running; err.hidden=true;
      var d=new Date(dayStr+'T12:00:00');
      dateLine.textContent=d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
      desc.value=el.dataset.desc||''; project.value=el.dataset.projectId||'';
      startI.value=el.dataset.start||'09:00'; endI.value=el.dataset.end||toHM(toMin(startI.value)+60); updDur();
      if(locked){
        lockNote.textContent='Zinvoiced on '+locked+' — this time can\u2019t be edited.';
        lockNote.hidden=false;
        desc.disabled=true; project.disabled=true; startI.disabled=true; endI.disabled=true;
        saveBtn.hidden=true;
      }else{
        lockNote.hidden=true;
        desc.disabled=false; project.disabled=false; startI.disabled=false; endI.disabled=false;
        saveBtn.hidden=false;
      }
      showScrim(); if(!locked) desc.focus();
    }
    /* #513: hand focus back to the entry that opened the dialog — keyboard
       users strand on a hidden Cancel button otherwise. Save/delete
       re-render the grid right after close, so the contains guard makes it
       a no-op when the entry is gone. */
    function close(){ hideScrim(); if(opener&&document.contains(opener)) opener.focus(); opener=null; }
    document.getElementById('cal-cancel').addEventListener('click',close);
    document.getElementById('cal-close').addEventListener('click',close);
    scrim.addEventListener('click',function(e){ if(e.target===scrim) close(); });
    /* #456: keep Tab cycling inside the modal entry dialog — it's
       aria-modal="true", so focus must not wander behind the scrim. The
       scrim's only child is the dialog itself. */
    /* #572: the narrow week agenda has no hour lanes — each day gets a +
       button that opens the create dialog for that day (9–10 AM default). */
    document.addEventListener('click',function(e){
      var b=e.target&&e.target.closest?e.target.closest('[data-ag-new]'):null;
      if(!b) return;
      openCreate(b.getAttribute('data-ag-new'),540,600);
    });
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'&&!scrim.hidden) close();
      else if(e.key==='Tab'&&!scrim.hidden&&window.tkTrapTab) window.tkTrapTab(scrim,e);
      /* #530: entry blocks/rows are tabindex="0" role="button" — Enter/Space
         must activate them like real buttons. openEdit sets the focus-return
         opener, and preventDefault stops Space from scrolling the page. */
      else if(e.key==='Enter'||e.key===' '){
        var card=e.target&&e.target.closest?e.target.closest('.ui-viz-block,[data-entry-row]'):null;
        if(card){ e.preventDefault(); openEdit(card); }
      }
      /* Arrow keys move an unlocked, finished block in 15-minute steps
         (Shift resizes its end); paint is live, the save lands on keyup. */
      else if(e.key.indexOf('Arrow')===0){
        var block=e.target&&e.target.closest?e.target.closest('.ui-viz-block'):null;
        if(!block||block.dataset.locked||block.classList.contains('is-running')) return;
        var s=toMin(block.dataset.start||'00:00'),en=toMin(block.dataset.end||'00:00'),used=true;
        var S=startOf(block),E=endOf(block);
        if(e.key==='ArrowDown'&&e.shiftKey) en=Math.min(Math.max(en+15,s+15),E);
        else if(e.key==='ArrowUp'&&e.shiftKey) en=Math.min(Math.max(en-15,s+15),E);
        else if(e.key==='ArrowDown'){ var d=Math.min(s+15,E-(en-s)); en+=d-s; s=d; }
        else if(e.key==='ArrowUp'){ var u=Math.max(s-15,S); en+=u-s; s=u; }
        else used=false;
        if(used){ e.preventDefault(); paint(block,s,en); }
      }
    });
    /* Keyboard edits persist on keyup when the focused block's times moved
       since focus landed (originals tracked on focusin). */
    var kbBlock=null,kbStart='',kbEnd='';
    document.addEventListener('focusin',function(e){
      var b=e.target&&e.target.closest?e.target.closest('.ui-viz-block'):null;
      kbBlock=b; if(b){ kbStart=b.dataset.start; kbEnd=b.dataset.end; }
    });
    document.addEventListener('keyup',function(e){
      if(!kbBlock||e.target!==kbBlock) return;
      if(kbBlock.dataset.start!==kbStart||kbBlock.dataset.end!==kbEnd){
        kbStart=kbBlock.dataset.start; kbEnd=kbBlock.dataset.end;
        persistBlock(kbBlock,true);
      }
    });
    function fail(msg){ err.textContent=msg; err.hidden=false; }
    /* In-place week refresh (#65): re-render the #week section without a full
       page reload. Load-entrance animations are suppressed for the swap
       (no-enter), the grid scroll position is preserved, and the new/updated
       entry gets a one-time highlight. */
    /* Week-nav buttons (#77) swap #week via HTMX: suppress the load-entrance
       animations for the swap, same as refreshWeek above. Unlike refreshWeek,
       grid scroll is intentionally NOT preserved — a fresh week centers the
       now-line when today is visible (#215), else starts at the top. */
    document.body.addEventListener('htmx:beforeSwap',function(e){
      if(e.detail && e.detail.target && e.detail.target.id==='week')
        document.getElementById('week').classList.add('no-enter');
    });
    /* In-place week refresh (#65): re-render the whole carousel window
       (three strips + pane) without a full page reload. Load-entrance
       animations are suppressed for the swap (no-enter); the visible strip
       keeps its scroll position, and the new/updated entry gets a one-time
       highlight. */
    function refreshWeek(highlightId,refocus){
      var weekEl=document.getElementById('week');
      var mid=trackStrips()[1];
      var sc=mid&&mid.querySelector('.cal-scroll');
      var st=sc?sc.scrollTop:0;
      var sun=stripWeeks[1]||'';
      var u='/partial/week?week='+encodeURIComponent(sun)+(TZ?'&tz='+encodeURIComponent(TZ):'');
      fetch(u).then(function(r){ if(!r.ok) throw new Error('refresh failed'); return r.text(); })
      .then(function(html){
        weekEl.classList.add('no-enter');
        weekEl.innerHTML=html;
        initCarousel();
        var mid2=trackStrips()[1];
        var sc2=mid2&&mid2.querySelector('.cal-scroll');
        if(sc2) sc2.scrollTop=st;
        if(highlightId){
          var el=weekEl.querySelector('.ui-viz-block[data-id="'+highlightId+'"]');
          if(el){ el.classList.add('cal-flash');
            /* Keyboard saves replace the focused block — hand focus back
               to its re-rendered twin so arrow-key editing can continue. */
            if(refocus) el.focus(); }
        }
        placeNow();
      }).catch(function(){ location.reload(); /* last resort: never leave stale data */ });
    }
    /* #572: chevron week navigation pans the pre-rendered carousel — no
       fetch on the critical path. On settle the far strip is recycled to the
       other end and its new week populates in the background; the supporting
       pane swaps instantly from the incoming strip's <template>.
       Capture-phase click interception beats htmx to the link; the href
       stays as the no-JS fallback. During a pan, further nav clicks are
       consumed. */
    document.addEventListener('click',function(e){
      var a=e.target&&e.target.closest?e.target.closest('a[data-slide]'):null;
      if(!a) return;
      if(panning){ e.preventDefault(); e.stopPropagation(); return; }
      if(!trackEl||stripWeeks.length!==3) return; /* foreign content — let htmx handle it */
      e.preventDefault(); e.stopPropagation();
      pan(a.getAttribute('data-slide')==='prev'?-1:1);
    },true);
    function pan(dir){
      panning=true;
      if(panReduce){ settlePan(dir); return; }
      trackEl.style.transform=dir>0?'translateX(-200%)':'translateX(0)';
      var done=false;
      function onEnd(){ if(done) return; done=true; settlePan(dir); }
      trackEl.addEventListener('transitionend',onEnd,{once:true});
      setTimeout(onEnd,450); /* transitionend can be swallowed (tab hidden) */
    }
    function settlePan(dir){
      var strips=trackStrips();
      var newWeeks=dir>0
        ? [stripWeeks[1],stripWeeks[2],shiftYmd(stripWeeks[2],7)]
        : [shiftYmd(stripWeeks[0],-7),stripWeeks[0],stripWeeks[1]];
      var recycle=dir>0?strips[0]:strips[2];
      if(dir>0) trackEl.appendChild(recycle);
      else trackEl.insertBefore(recycle,trackEl.firstChild);
      stripWeeks=newWeeks;
      var farSun=dir>0?newWeeks[2]:newWeeks[0];
      recycle.setAttribute('data-sun',farSun);
      /* Reset to the resting position without animating. */
      trackEl.classList.add('no-anim');
      trackEl.style.transform='translateX(-100%)';
      void trackEl.offsetWidth;
      trackEl.classList.remove('no-anim');
      /* The pane is week-scoped: swap it instantly from the incoming
         (middle) strip's pre-rendered template. */
      var mid=trackStrips()[1];
      var tpl=mid.querySelector('.cal-pane-tpl');
      var aside=document.querySelector('#week .cal-supporting');
      if(tpl&&aside) aside.innerHTML=tpl.innerHTML;
      try{ history.pushState(null,'','/calendar?week='+newWeeks[1]); }catch(e){}
      panning=false;
      placeNow();
      initStripScroll(mid);
      populateStrip(recycle,farSun);
    }
    /* Fill a recycled strip with its new week in the background. A generation
       guard drops the response if the strip was recycled again meanwhile. */
    function populateStrip(strip,sun){
      strip.classList.add('no-enter');
      fetch(stripUrl(sun)).then(function(r){ if(!r.ok) throw 0; return r.text(); })
      .then(function(html){
        if(strip.getAttribute('data-sun')!==sun) return;
        strip.innerHTML=html;
        placeNow(); initStripScroll(strip);
      }).catch(function(){ /* keep the stale strip; the next pan recycles it again */ });
    }

    document.getElementById('cal-save').addEventListener('click',function(){
      if(saving) return; /* #930: swallow repeat taps while a save is in flight */
      var s=toMin(startI.value),e=toMin(endI.value);
      if(!(e>s)) return fail('End time must be after start time.');
      saving=true; saveBtn.disabled=true; /* #930: block further submits */
      var fd=new URLSearchParams();
      fd.set('description',desc.value);
      fd.set('project_id',project.value);
      fd.set('start_time',dayStr+'T'+startI.value+tzSuffix());
      fd.set('end_time',dayStr+'T'+endI.value+tzSuffix());
      var url=mode==='create'?'/entries':'/entries/'+editId;
      var hid=mode==='edit'?editId:null;
      fetch(url,{method:'POST',body:fd}).then(function(r){
        if(!r.ok) throw new Error('save failed');
        return r.json().catch(function(){ return {}; });
      }).then(function(data){
        if(mode==='create'&&data&&data.id) hid=data.id;
        close();
        refreshWeek(hid);
      }).catch(function(ex){ saving=false; saveBtn.disabled=false; fail(ex.message); });
    });
    delBtn.addEventListener('click',function(){
      /* #464: native confirm() replaced by the shared confirm dialog. */
      window.tkConfirm('Delete this entry? This cannot be undone.').then(function(ok){
        if(!ok) return;
        fetch('/entries/'+editId,{method:'DELETE'}).then(function(r){
          if(!r.ok) throw new Error('delete failed'); /* #334: locked entries 403 */
          close(); refreshWeek(null);
        }).catch(function(ex){ fail(ex.message); });
      });
    });
    /* Pointer interactions on the visualizer grid, delegated on document
       so they survive in-place #week refreshes: resize handles drag an
       edge, blocks drag to move (a plain tap opens the editor), empty
       column space drags to create. */
    function minsRaw(ev,col){
      var r=col.getBoundingClientRect();
      return startOf(col)+(ev.clientY-r.top)/hourOf(col)*60;
    }
    function minsAt(ev,col){
      var S=startOf(col);
      var m=S+Math.round((minsRaw(ev,col)-S)/15)*15;
      return Math.max(0,Math.min(1439,m));
    }
    function paintGeo(el,a,b){
      var H=hourOf(el),S=startOf(el);
      var h=Math.max((b-a)/60*H-4,22);
      /* Same bottom clamp as the component: a floored short block near the
         window's end shifts up instead of painting past the column. */
      el.style.top=Math.min((a-S)/60*H+2,(endOf(el)-S)/60*H-h)+'px';
      el.style.height=h+'px';
    }
    function paint(block,a,b){
      paintGeo(block,a,b);
      block.dataset.start=toHM(a); block.dataset.end=toHM(b);
      var meta=block.querySelector('.ui-viz-block-meta');
      if(meta) meta.textContent=block.classList.contains('is-running')
        ? fmt12(a)+' \u2013 now' : fmt12(a)+' \u2013 '+fmt12(b);
      var col=block.closest('.ui-viz-col'), viz=block.closest('.ui-viz');
      if(!col||!viz) return;
      var cols=Array.prototype.slice.call(viz.querySelectorAll('.ui-viz-col'));
      var totalEl=viz.querySelectorAll('[data-day-total]')[cols.indexOf(col)];
      if(!totalEl) return;
      var sum=0, blocks=col.querySelectorAll('.ui-viz-block');
      for(var i=0;i<blocks.length;i++)
        sum+=toMin(blocks[i].dataset.end||'00:00')-toMin(blocks[i].dataset.start||'00:00');
      totalEl.textContent=fmtD(sum);
    }
    /* Move/resize persistence — the same POST shape the dialog save uses;
       the week re-renders with the entry highlighted, or reverts on failure. */
    function persistBlock(block,refocus){
      var id=block.dataset.id;
      var fd=new URLSearchParams();
      fd.set('description',block.dataset.desc||'');
      fd.set('project_id',block.dataset.projectId||'');
      fd.set('start_time',block.dataset.date+'T'+block.dataset.start+tzSuffix());
      fd.set('end_time',block.dataset.date+'T'+block.dataset.end+tzSuffix());
      fetch('/entries/'+id,{method:'POST',body:fd}).then(function(resp){
        if(!resp.ok) throw new Error('save failed');
        refreshWeek(id,refocus);
      }).catch(function(){ refreshWeek(null); /* revert on failure */ });
    }
    /* #946: on touch, starting a scroll with the finger on an entry opened
       the editor — pointerdown fired before the browser knew it was a
       scroll. Distinguish tap from scroll: only open the editor on
       pointerup if the pointer barely moved; a drift past 10px or a
       browser-takeover (pointercancel) cancels the pending tap. */
    function startTap(e,tapEl){
      var tapX=e.clientX,tapY=e.clientY,tapId=e.pointerId;
      function tapMove(ev){
        if(ev.pointerId!==tapId) return;
        if(Math.abs(ev.clientX-tapX)>10||Math.abs(ev.clientY-tapY)>10) tapCancel();
      }
      function tapUp(ev){
        if(ev.pointerId!==tapId) return;
        tapCancel(); openEdit(tapEl);
      }
      function tapCancel(){
        window.removeEventListener('pointermove',tapMove);
        window.removeEventListener('pointerup',tapUp);
        window.removeEventListener('pointercancel',tapCancel);
      }
      window.addEventListener('pointermove',tapMove);
      window.addEventListener('pointerup',tapUp);
      window.addEventListener('pointercancel',tapCancel);
    }
    document.addEventListener('pointerdown',function(e){
      if(!e.target||!e.target.closest) return;
      var handle=e.target.closest('[data-resize]');
      if(handle){
        var block=handle.closest('.ui-viz-block');
        if(!block) return;
        var col=block.closest('.ui-viz-col');
        var edge=handle.getAttribute('data-resize'); /* "start" or "end" */
        e.preventDefault(); e.stopPropagation();
        var start0=toMin(block.dataset.start||'00:00'), end0=toMin(block.dataset.end||'00:00');
        block.classList.add('is-selected');
        function rmove(ev){
          var m=minsAt(ev,col);
          if(edge==='start') paint(block,Math.max(startOf(block),Math.min(m,end0-15)),end0);
          else paint(block,start0,Math.min(Math.max(m,start0+15),1439));
        }
        function rup(){
          window.removeEventListener('pointermove',rmove);
          window.removeEventListener('pointerup',rup);
          window.removeEventListener('pointercancel',rup);
          block.classList.remove('is-selected');
          if(toMin(block.dataset.start)!==start0||toMin(block.dataset.end)!==end0) persistBlock(block);
        }
        window.addEventListener('pointermove',rmove);
        window.addEventListener('pointerup',rup);
        window.addEventListener('pointercancel',rup);
        return;
      }
      var block=e.target.closest('.ui-viz-block');
      if(block){
        /* Locked and running blocks never drag — a tap opens the editor
           (read-only for locked, delete-less for running). */
        if(block.dataset.locked||block.classList.contains('is-running')){ startTap(e,block); return; }
        var col=block.closest('.ui-viz-col');
        var start0=toMin(block.dataset.start||'00:00'), end0=toMin(block.dataset.end||'00:00');
        var dur=end0-start0, grabOffset=minsRaw(e,col)-start0;
        var downX=e.clientX, downY=e.clientY, moved=false;
        e.preventDefault();
        function mvmove(ev){
          if(!moved){
            if(Math.abs(ev.clientX-downX)<=6&&Math.abs(ev.clientY-downY)<=6) return;
            moved=true; block.classList.add('is-selected');
          }
          var s=Math.round((minsRaw(ev,col)-grabOffset)/15)*15;
          s=Math.max(startOf(block),Math.min(s,endOf(block)-dur));
          paint(block,s,s+dur);
        }
        function mvup(){
          window.removeEventListener('pointermove',mvmove);
          window.removeEventListener('pointerup',mvup);
          window.removeEventListener('pointercancel',mvcancel);
          block.classList.remove('is-selected');
          if(!moved){ openEdit(block); return; }
          if(toMin(block.dataset.start)!==start0||toMin(block.dataset.end)!==end0) persistBlock(block);
        }
        function mvcancel(){
          window.removeEventListener('pointermove',mvmove);
          window.removeEventListener('pointerup',mvup);
          window.removeEventListener('pointercancel',mvcancel);
          block.classList.remove('is-selected');
          if(moved) paint(block,start0,end0); /* revert the preview */
        }
        window.addEventListener('pointermove',mvmove);
        window.addEventListener('pointerup',mvup);
        window.addEventListener('pointercancel',mvcancel);
        return;
      }
      var row=e.target.closest('[data-entry-row]');
      if(row){ startTap(e,row); return; }
      var col=e.target.closest('.ui-viz-col');
      if(!col) return;
      e.preventDefault();
      var a=minsAt(e,col);
      var pv=document.createElement('div');
      pv.className='ui-viz-block is-preview';
      col.appendChild(pv); paintGeo(pv,a,a+15);
      var dragMoved=false;
      function cmove(ev){ dragMoved=true; var m=minsAt(ev,col);
        var x=Math.min(a,m),y=Math.max(a,m); paintGeo(pv,x,Math.max(y,x+15)); }
      function cup(ev){
        window.removeEventListener('pointermove',cmove);
        window.removeEventListener('pointerup',cup);
        window.removeEventListener('pointercancel',ccancel);
        var m=dragMoved?minsAt(ev,col):a+60;
        var x=Math.min(a,m),y=Math.max(a,m);
        if(y-x<15) y=x+15;
        pv.remove();
        openCreate(col.dataset.date,x,Math.min(y,1439));
      }
      function ccancel(){
        window.removeEventListener('pointermove',cmove);
        window.removeEventListener('pointerup',cup);
        window.removeEventListener('pointercancel',ccancel);
        pv.remove();
      }
      window.addEventListener('pointermove',cmove);
      window.addEventListener('pointerup',cup);
      window.addEventListener('pointercancel',ccancel);
    });
    /* #213: the server's clock may be in another timezone (e.g. a UTC VPS),
       so every "right now" presentation follows the viewer's local time:
       the now-line (column + position), the .today highlight, and running
       entry extents. Runs on load, every 30s, and after each in-place
       week refresh. */
    function clientToday(){
      var n=new Date();var p=function(x){return String(x).padStart(2,'0');};
      return n.getFullYear()+'-'+p(n.getMonth()+1)+'-'+p(n.getDate());
    }
    /* Position every strip's now-line; strips whose week has no today
       column hide theirs. The line is a client concept (the server may
       be in another timezone), so it is created/moved here rather than
       trusting the server-rendered column. */
    function placeNow(){
      var today=clientToday();
      var n=new Date();var nowMin=n.getHours()*60+n.getMinutes();
      var strips=document.querySelectorAll('#week .cal-strip');
      for(var s=0;s<strips.length;s++){
        (function(strip){
          var col=strip.querySelector('.ui-viz-col[data-date="'+today+'"]');
          var line=strip.querySelector('[data-now]');
          if(!col){ if(line) line.hidden=true; }
          else {
            if(!line){
              line=document.createElement('div');
              line.className='ui-viz-now'; line.setAttribute('data-now','');
            }
            if(line.parentNode!==col) col.appendChild(line);
            line.style.top=((nowMin-START)/60*HOUR).toFixed(1)+'px'; line.hidden=false;
            var run=col.querySelectorAll('.ui-viz-block.is-running');
            for(var i=0;i<run.length;i++){
              var st=run[i].getAttribute('data-start'); if(!st) continue;
              var pp=st.split(':'),sm=(+pp[0])*60+(+pp[1]);
              var trueH=((nowMin-sm)/60)*HOUR-4;
              /* the growth is capped at the lane's midnight edge */
              var capH=((1440-sm)/60)*HOUR-2;
              run[i].style.height=Math.min(Math.max(trueH,22),Math.max(capH,trueH)).toFixed(1)+'px';
            }
          }
          /* The today highlight follows the viewer, not the server: the
             server-rendered is-today can name the wrong day. Heads are
             offset by one — the first head cell is the hour gutter. */
          var cols=strip.querySelectorAll('.ui-viz-col');
          for(var c=0;c<cols.length;c++)
            cols[c].classList.toggle('is-today',cols[c].getAttribute('data-date')===today);
          var heads=strip.querySelector('.ui-viz-heads');
          if(heads){ var kids=heads.children;
            for(var k=1;k<kids.length;k++)
              kids[k].classList.toggle('is-today',!!cols[k-1]&&cols[k-1].getAttribute('data-date')===today); }
        })(strips[s]);
      }
    }
    /* Scroll one strip: center the now-line when today is visible, else top. */
    /* #781: the aside hint teaches the grid's drag-to-create gesture, which
       doesn't exist on the narrow agenda (creation is the per-day + button).
       The aside isn't a strip descendant, so the 639px container query can't
       reach it — mirror the breakpoint in JS against the strip's own width
       (the strip has no padding/border, so clientWidth IS the container width)
       and toggle the pre-rendered variant via a body class. */
    function syncCalHint(){
      var strip=document.querySelector('#week .cal-strip');
      if(!strip) return;
      document.body.classList.toggle('cal-agenda-hint',strip.clientWidth<=639);
    }
    function initStripScroll(strip){
      var sc=strip.querySelector('.cal-scroll'); if(!sc) return;
      var line=strip.querySelector('[data-now]');
      if(!line||line.hidden){ sc.scrollTop=0; return; }
      var lr=line.getBoundingClientRect(),sr=sc.getBoundingClientRect();
      sc.scrollTop=Math.max(0,sc.scrollTop+(lr.top-sr.top)-sr.height/2);
    }
    /* #219: the visible strip's centering smooth-glides (eased, ~600ms);
       every other path sets instantly. Reduced motion always sets instantly. */
    function centerVisible(smooth){
      var strips=trackStrips(); if(strips.length<2) return;
      var strip=strips[1];
      var line=strip.querySelector('[data-now]');
      var sc=strip.querySelector('.cal-scroll');
      if(!line||line.hidden||!sc) return;
      var lr=line.getBoundingClientRect(),sr=sc.getBoundingClientRect();
      var target=Math.max(0,sc.scrollTop+(lr.top-sr.top)-sr.height/2);
      if(!smooth||panReduce){ sc.scrollTop=target; return; }
      /* eased scrollTop animation; user input (wheel/touch) cancels it so the
         page never fights an in-progress gesture */
      var start=sc.scrollTop,dist=target-start,t0=null,DUR=600,cancelled=false;
      function cancel(){ cancelled=true;
        sc.removeEventListener('wheel',cancel); sc.removeEventListener('touchstart',cancel); }
      sc.addEventListener('wheel',cancel,{passive:true});
      sc.addEventListener('touchstart',cancel,{passive:true});
      function step(t){
        if(cancelled) return;
        if(t0===null) t0=t;
        var p=Math.min(1,(t-t0)/DUR),e=p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2;
        sc.scrollTop=start+dist*e;
        if(p<1) requestAnimationFrame(step); else cancel();
      }
      requestAnimationFrame(step);
    }
    initCarousel();
    placeNow();
    /* Side strips settle instantly; the visible strip smooth-glides to the
       now-line after the entrance animations finish (~590ms) — measuring
       mid-animation lands the scroll ~12px off. */
    (function initScroll(){
      var strips=trackStrips();
      for(var i=0;i<strips.length;i++) if(i!==1) initStripScroll(strips[i]);
      setTimeout(function(){ centerVisible(true); }, 650);
    })();
    setInterval(placeNow,30000);
    syncCalHint(); /* #781: hint variant follows the strip presentation */
    window.addEventListener('resize',syncCalHint);
    /* no-JS fallback: htmx swaps the whole window; re-init the carousel. */
    document.body.addEventListener('htmx:afterSwap',function(e){
      if(e.detail&&e.detail.target&&e.detail.target.id==='week'){
        initCarousel(); placeNow(); centerVisible(false); syncCalHint(); }
    });
  })();`;
  }

  function calendarPage(week?: string): string {
    return layout("Calendar", weekGrid(week), "calendar", true);
  }

  /** #903: entry edit form fields — shared by the full edit page and the
      timer-page edit dialog, so both stay in sync (#709 label wiring). */
  function editEntryFields(e: Entry, dis: string): string {
    return `
        ${textField({ id: "ee-desc", label: "Description", name: "description", value: e.description, attrs: dis ? "disabled" : undefined })}
        ${selectField({ id: "ee-project", label: "Project", name: "project_id", value: e.project_id ? String(e.project_id) : "", disabled: !!dis, options: projectSelectOptions() })}
        ${textField({ id: "ee-start", label: "Start", name: "start_time", type: "datetime-local", required: true, attrs: `data-iso="${esc(e.start_time)}"${dis}` })}
        ${textField({ id: "ee-end", label: "End (blank = still running)", name: "end_time", type: "datetime-local", attrs: `data-iso="${esc(e.end_time || "")}"${dis}` })}`;
  }

  /** #256: datetime-local inputs are prefilled client-side from the ISO instant
      (data-iso) — the server can't know the client's zone on a full page load.
      On submit, the offset is appended via hidden inputs (a raw ±HH:MM suffix
      is not a valid datetime-local value and would be sanitized to ""). */
  function editPage(id: number): string | null {
    const e = qOne.get(id) as Entry | null;
    if (!e) return null;
    const locked = entryIsLocked(e); /* #334: sent/paid time opens read-only */
    const dis = locked ? " disabled" : "";
    return layout(locked ? "Entry" : "Edit entry", `
      <h2 class="ui-page-title" data-enter="2">${locked ? "Entry" : "Edit entry"}</h2>
      ${locked ? `<p class="muted">Zinvoiced on ${esc(e.invoice_number || "")} — this time can\u2019t be edited.</p>` : ""}
      <form method="post" action="/entries/${e.id}" class="form" id="edit-entry-form">
        ${editEntryFields(e, dis)}
        <div class="row">
          ${locked ? "" : button({ label: "Save", variant: "primary", type: "submit" })}
          ${linkButton({ label: locked ? "Back" : "Cancel", href: "/calendar", variant: "ghost" })}
        </div>
      </form>
      <script>(function(){
        var p2=function(n){return String(n).padStart(2,"0");};
        function toLocalInput(iso){var d=new Date(iso);
          return d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate())+"T"+p2(d.getHours())+":"+p2(d.getMinutes());}
        var els=document.querySelectorAll('input[type=datetime-local][data-iso]');
        for(var i=0;i<els.length;i++){var iso=els[i].getAttribute("data-iso");if(iso)els[i].value=toLocalInput(iso);}
        var form=document.getElementById("edit-entry-form");
        form.addEventListener("submit",function(ev){
          ev.preventDefault();
          var o=-new Date().getTimezoneOffset(),s=o<0?"-":"+",a=Math.abs(o);
          var suf=s+p2(Math.floor(a/60))+":"+p2(a%60);
          for(var j=0;j<els.length;j++){if(els[j].value){
            var h=document.createElement("input");h.type="hidden";h.name=els[j].name;h.value=els[j].value+suf;
            form.appendChild(h);els[j].disabled=true;}}
          form.submit();
        });
      })();</script>`);
  }

  /** #903: entry edit dialog fragment for the timer page — served to htmx
      GET /entries/:id/edit and swapped into #entry-dialog-body. The form posts
      via htmx; the server answers HX-Trigger so #today-list refreshes in
      place and the dialog script closes the modal. */
  function editEntryDialog(id: number): string | null {
    const e = qOne.get(id) as Entry | null;
    if (!e) return null;
    const locked = entryIsLocked(e); /* #334: sent/paid time opens read-only */
    const dis = locked ? " disabled" : "";
    return `
      <div class="cal-dialog-head">
        <h2 class="ui-dialog-title" id="entry-dialog-title">${locked ? "Entry" : "Edit entry"}</h2>
        ${iconButton({ icon: "close", label: "Close dialog", tip: null, attrs: "data-close-entry" })}
      </div>
      ${locked ? `<p class="muted">Zinvoiced on ${esc(e.invoice_number || "")} — this time can\u2019t be edited.</p>` : ""}
      <form hx-post="/entries/${e.id}" hx-swap="none" class="form" id="edit-entry-form">
        ${editEntryFields(e, dis)}
        <div class="cal-dialog-actions">
          <span class="cal-spacer"></span>
          ${button({ label: locked ? "Back" : "Cancel", variant: "ghost", attrs: "data-close-entry" })}
          ${locked ? "" : button({ label: "Save", variant: "primary", type: "submit" })}
        </div>
      </form>
      <script>(function(){
        var p2=function(n){return String(n).padStart(2,"0");};
        function toLocalInput(iso){var d=new Date(iso);
          return d.getFullYear()+"-"+p2(d.getMonth()+1)+"-"+p2(d.getDate())+"T"+p2(d.getHours())+":"+p2(d.getMinutes());}
        var form=document.getElementById("edit-entry-form");
        var els=form.querySelectorAll('input[type=datetime-local][data-iso]');
        for(var i=0;i<els.length;i++){var iso=els[i].getAttribute("data-iso");if(iso)els[i].value=toLocalInput(iso);}
        /* htmx posts the form — rewrite the datetime params with the client
           tz offset before htmx gathers them (same suffix rule as the page).
           #975: assign unconditionally — detail.parameters is a Proxy over
           FormData with no has trap, so an in-membership check is always
           false and the suffix silently never landed (bare datetimes then
           hit the #964 400 guard and the dialog could not save at all). */
        form.addEventListener("htmx:configRequest",function(ev){
          var o=-new Date().getTimezoneOffset(),s=o<0?"-":"+",a=Math.abs(o);
          var suf=s+p2(Math.floor(a/60))+":"+p2(a%60);
          for(var j=0;j<els.length;j++){if(els[j].value){
            ev.detail.parameters[els[j].name]=els[j].value+suf;}}
        });
      })();</script>`;
  }

  return { weekInner, weekStrip, weekGrid, calendarPage, editPage, editEntryDialog };
}
