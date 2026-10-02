/** Calendar views: week grid, day columns, entry blocks, supporting pane,
 *  the entry dialog + inline calendar script, and the edit-entry page.
 *  Week data arrives through injected queries and helpers; every existing
 *  call site keeps working unchanged. */

import type { Database, Statement } from "bun:sqlite";
import { addDays, durationSeconds, entryInvoiceMark, entryIsLocked, esc, fmtDur } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import { workspaceEmpty } from "../lib/demo.ts"; /* #300: first-run hint */
import type { Entry } from "../lib/types.ts";

export interface CalendarViewDeps {
  db: Database;
  qOne: Statement;
  qRange: Statement;
  entrySelect: string;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean) => string;
  projectOptions: (selected?: number | null) => string;
  weekTargetBar: (weekTotalSecs: number) => string;
  calHourPx: number;
}

export function createCalendarViews(deps: CalendarViewDeps) {
  /** Night = 7 PM – 6 AM. Star scatter per night band, as [left%, top%] pairs. */
  const NIGHT_STARS_AM = [[12, 8], [68, 20], [34, 40], [82, 58], [50, 78], [22, 90]];
  const NIGHT_STARS_PM = [[30, 10], [70, 28], [48, 50], [16, 72], [62, 90]];
  /** Wavy horizon where day meets night: filled with the same translucent
      purple so it composites seamlessly with the band. */
  const WAVE_AM = `<svg class="cal-wave cal-wave-am" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true"><path d="M0 0H120V5Q105 11 90 5T60 5T30 5T0 5Z"/></svg>`;
  const WAVE_PM = `<svg class="cal-wave cal-wave-pm" viewBox="0 0 120 12" preserveAspectRatio="none" aria-hidden="true"><path d="M0 12H120V7Q105 1 90 7T60 7T30 7T0 7Z"/></svg>`;
  /** #324: each star gets a random twinkle phase (negative delay) and a
      slightly varied duration, so the night bands shimmer organically
      instead of twinkling in lockstep across all 7 day columns. */
  function nightStars(list: number[][]): string {
    return list.map(([x, y]) =>
      `<span class="cal-star" style="left:${x}%;top:${y}%;animation-delay:${(-(Math.random() * 3.2)).toFixed(2)}s;animation-duration:${(2.6 + Math.random() * 1.6).toFixed(2)}s">✦</span>`
    ).join("");
  }

  const { db, qOne, qRange, entrySelect: ENTRY_SELECT, layout, projectOptions, weekTargetBar, calHourPx } = deps;

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

  /** #521: one .cal-day column. Extracted from weekInner's loop body so the
      week grid and the day view render identical lanes. */
  function dayColumnHtml(day: string, data: CalWeekData, animDelay: number): string {
    const { tz, today } = data;
    const toMin = (iso: string) => { const p = tzParts(new Date(iso), tz); return p.hh * 60 + p.mm; };
    const toHM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

    const [y, m, d] = day.split("-").map(Number);
    const wd = weekdayOf(y, m, d).slice(0, 3);
    const entries = data.byDay.get(day) ?? [];
    const total = entries.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
    /* Billable = entry has a project (hence a client); non-billable = no project. */
    const billable = entries.reduce(
      (a, e) => a + (e.project_id != null ? durationSeconds(e.start_time, e.end_time) : 0), 0);
    const isToday = day === today;
    /* Subtle tint for past days under 8h; never tint today or future days. */
    const pastShort = day < today && total < 8 * 3600;

    // Entries render full-width; an entry involved in an overlap gets a top
    // drop shadow so it reads as elevated above the entry beneath it.
    const nowP = tzParts(new Date(), tz);
    const nowMin = nowP.hh * 60 + nowP.mm;
    const sortedBlocks = entries
      .map((e) => {
        const a = toMin(e.start_time);
        const b = Math.max(e.end_time ? toMin(e.end_time) : nowMin, a + 15);
        return { e, a, b };
      })
      .sort((x, y) => x.a - y.a);
    const entryHtml = sortedBlocks
      .map(({ e, a, b }, i) => {
      const top = (a / 60) * calHourPx;
      const trueH = ((b - a) / 60) * calHourPx;
      /* #275: sub-30-minute entries would be unreadably thin at true scale,
         but the old 26px floor read too chunky — floor at 22px with compact
         styling (tighter padding, smaller text, no duration line). */
      const compact = trueH < 26;
      /* #279: a floored short entry overflows its true slot and the next
         card paints over it, burying the 4px gap — cap the floor at the
         room before the next entry starts. Back-to-back short entries
         render at true height (thin but truthful, gap preserved); the
         floor still applies when there's room. Never shrink below true
         height, so overlapping entries keep full height. */
      const nextA = i + 1 < sortedBlocks.length ? sortedBlocks[i + 1].a : Infinity;
      const roomPx = ((nextA - a) / 60) * calHourPx;
      const h = Math.min(Math.max(trueH, 22), Math.max(roomPx, trueH));
      /* #273: 2px visual inset top and bottom so stacked cards don't touch.
         The positioning slot is unchanged; only the painted card shrinks. */
      const color = e.client_color || "#9aa0a6"; // no-client: neutral gray, distinct from client colors
      const running = !e.end_time;
      const overlap = sortedBlocks.some((o) => o.e !== e && o.a < b && o.b > a);
      /* #277: resize handles only on entries of 1 hour or more — the 12px
         hit areas swallow taps on short entries. Shorter entries stay
         fully tappable and resize via the edit dialog. */
      const locked = entryIsLocked(e); /* #334: sent/paid time is a frozen record */
      const resizable = !running && (b - a) >= 60 && !locked;
      const desc = e.description ? esc(e.description) : "<em>No description</em>";
      const dur = fmtDur(durationSeconds(e.start_time, e.end_time));
      /* #332: invoiced time dims instead of a chip — the week grid is too
         dense for a pill on every card. The invoice number lives in the
         hover tooltip + aria-label. */
      const mark = entryInvoiceMark(e);
      const markA11y = mark ? `, ${mark.label} ${esc(e.invoice_number || "")}` : "";
      /* #500: house M3 plain tooltip (data-tip) instead of the native title —
         same mark info the timer page's inv-mark chip shows via #498; hover,
         450ms touch long-press (site-wide [data-tip] handler), and
         :focus-visible (the card is keyboard-focusable). */
      const markTip = mark ? ` data-tip="${esc(mark.title)}"` : "";
      /* #504: resize handles carry no tooltip at all — they're aria-hidden
         and gestural (grip + resize cursor on entry hover). This removes
         the last two native title= tooltips in the app. */
      const resizeHandles = resizable
        ? `<div class="cal-resize top" data-resize="start" aria-hidden="true"></div><div class="cal-resize" data-resize="end" aria-hidden="true"></div>`
        : "";
      /* #479: the aria-label is a plain-text accessible name — `desc`
         carries <em> markup for untitled entries, which screen readers
         would announce as literal tags. */
      const label = `${esc(e.description || "No description")}, ${dur}${markA11y}`;
      return `<div class="cal-entry${running ? " running" : ""}${overlap ? " overlap" : ""}${compact ? " cal-compact" : ""}${mark ? " invoiced" : ""}"
          style="top:${(top + 2).toFixed(1)}px;height:${(h - 4).toFixed(1)}px;--c:${esc(color)}"
          data-id="${e.id}" data-desc="${esc(e.description)}" data-project-id="${e.project_id ?? ""}"
          data-date="${day}" data-start="${toHM(a)}" data-end="${running ? "" : toHM(Math.min(b, 1439))}"
          data-locked="${locked ? esc(e.invoice_number || "") : ""}"
          tabindex="0" role="button" aria-label="${label}"${markTip}>
        <div class="cal-entry-desc">${e.project_name ? `<strong>${esc(e.project_name)}</strong> · ` : ""}${desc}</div>
        <div class="cal-entry-dur">${dur}</div>
        ${resizeHandles}
      </div>`;
    }).join("");
    /* #213: "now" is a client concept (the server may be in another
       timezone). The line is placed by placeNow() in calScript. */
    const nowLine = "";
    // #69: day stats live in an M3 plain tooltip on the header (hover / focus / long-press),
    // not in the layout — the header stays two lines so time slots sit higher.
    const tip = total > 0 ? `${fmtDur(total)} total · ${fmtDur(billable)} billable` : "";
    const headAttrs = tip
      ? ` tabindex="0" data-tip="${tip}" aria-label="${esc(wd)} ${d}: ${tip}"`
      : "";
    return `<div class="cal-day${isToday ? " today" : ""}${pastShort ? " paced-short" : ""}" style="animation-delay:${animDelay}ms">
      <div class="cal-day-head"${headAttrs}>
        <div class="md-label-large muted">${esc(wd)}</div>
        <div class="cal-day-num${isToday ? " today" : ""}">${d}${isToday ? icon("pumpkin", "oct-today") : ""}</div>
      </div>
      <div class="cal-day-col" data-date="${day}"><div class="cal-night cal-night-am" aria-hidden="true">${WAVE_AM}${nightStars(NIGHT_STARS_AM)}</div><div class="cal-night cal-night-pm" aria-hidden="true">${WAVE_PM}${nightStars(NIGHT_STARS_PM)}</div>${entryHtml}${nowLine}</div>
    </div>`;
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
      ${isThisWeek ? "" : `<a class="md-text-button" href="/calendar" hx-get="/partial/week" hx-target="#week" hx-swap="innerHTML" hx-push-url="/calendar">Today</a>`}
      <a class="md-icon-button" href="/calendar?week=${prev}" hx-get="/partial/week?week=${prev}" hx-target="#week" hx-swap="innerHTML" hx-push-url="/calendar?week=${prev}" data-slide="prev" data-tip="Previous week" aria-label="Previous week">${icon("chevron_left")}</a>
      <a class="md-icon-button tip-right" href="/calendar?week=${next}" hx-get="/partial/week?week=${next}" hx-target="#week" hx-swap="innerHTML" hx-push-url="/calendar?week=${next}" data-slide="next" data-tip="Next week" aria-label="Next week">${icon("chevron_right")}</a>`;
    const nudgeChip = uninvoiced > 0 ? `
      <a class="nudge-chip" href="/invoices/new?from=${sun}&to=${addDays(sun, 7)}">
        <span class="md-label-large">${fmtDur(uninvoiced)} not yet invoiced</span>
        ${/* #592: the link invoices the VIEWED week, so "this week" lies on
           past/future weeks. Keep it on the current week, "this period"
           everywhere else. */ ""}
        <span class="md-label-large nudge-go">${icon("receipt")} ${isThisWeek ? "Invoice this week" : "Invoice this period"}</span>
      </a>` : "";
    const clientStrip = clientRows.length === 0 ? "" : `
      <div class="week-clients">
        ${clientRows.map(c => `
          <span class="week-client">
            <span class="week-client-dot"${c.color ? ` style="background:${esc(c.color)}"` : ""}></span>
            <span class="md-label-medium">${esc(c.name)}</span>
            <span class="md-label-medium muted">${fmtDur(c.secs)}</span>
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
        <h1 class="md-headline-small">${esc(navTitle)}</h1>
        <div class="week-nav-actions">
          ${navActions}
        </div>
      </div>
      <div class="cal-summary">
        <div class="md-headline-small">${fmtDur(weekTotal)}</div>
        <div class="md-label-medium muted">${fmtDur(weekBillable)} billable${deltaHtml}</div>
      </div>
      ${nudgeChip}
      ${weekTargetBar(weekTotal)}
      ${clientStrip}
      <p class="muted tiny cal-hint">Drag on the grid — or tap + on a day — to log time. Click an entry to edit it.</p>
      ${workspaceEmpty(db) ? `<div class="cal-first-run">
        ${icon("info")}
        <p class="md-label-large"><strong>New here?</strong> Load fictional sample data to explore the calendar.</p>
        <form method="post" action="/demo/load" class="inline"><button class="md-text-button" type="submit">Load demo data</button></form>
      </div>` : ""}`;
  }

  /** #572: the narrow-container week presentation — seven stacked day sections
      instead of hour lanes. Picked by container query (the strip is the
      container), so no JS mode-switching. Entry rows carry the same data-*
      attributes as grid cards, so the edit dialog opens unchanged. */
  function agendaHtml(wd: CalWeekData): string {
    const { tz, today } = wd;
    const toMin = (iso: string) => { const p = tzParts(new Date(iso), tz); return p.hh * 60 + p.mm; };
    const toHM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    const nowP = tzParts(new Date(), tz);
    const nowMin = nowP.hh * 60 + nowP.mm;
    const sections: string[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(wd.sun, i);
      const [y, m, d] = day.split("-").map(Number);
      const wdName = weekdayOf(y, m, d);
      const entries = (wd.byDay.get(day) ?? []).slice().sort((a, b) =>
        a.start_time < b.start_time ? -1 : a.start_time > b.start_time ? 1 : 0);
      const total = entries.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
      const rows = entries.map((e) => {
        const a = toMin(e.start_time);
        const b = e.end_time ? toMin(e.end_time) : nowMin;
        const color = e.client_color || "#9aa0a6"; // no-client: neutral gray, distinct from client colors
        const running = !e.end_time;
        const locked = entryIsLocked(e); /* #334: sent/paid time is a frozen record */
        const mark = entryInvoiceMark(e);
        const markA11y = mark ? `, ${mark.label} ${esc(e.invoice_number || "")}` : "";
        const label = `${esc(e.description || "No description")}, ${fmtDur(durationSeconds(e.start_time, e.end_time))}${markA11y}`;
        const desc = e.description ? esc(e.description) : "<em>No description</em>";
        return `<div class="cal-ag-row${running ? " running" : ""}${mark ? " invoiced" : ""}" style="--c:${esc(color)}"
            data-id="${e.id}" data-desc="${esc(e.description)}" data-project-id="${e.project_id ?? ""}"
            data-date="${day}" data-start="${toHM(a)}" data-end="${running ? "" : toHM(Math.min(b, 1439))}"
            data-locked="${locked ? esc(e.invoice_number || "") : ""}"
            tabindex="0" role="button" aria-label="${label}">
          <span class="cal-ag-time md-label-small muted">${toHM(a)}&ndash;${running ? "now" : toHM(Math.min(b, 1439))}</span>
          <span class="cal-ag-desc md-body-medium">${e.project_name ? `<strong>${esc(e.project_name)}</strong> · ` : ""}${desc}</span>
          <span class="cal-ag-dur md-label-medium">${fmtDur(durationSeconds(e.start_time, e.end_time))}</span>
        </div>`;
      }).join("");
      sections.push(`<section class="cal-ag-day${day === today ? " today" : ""}" data-date="${day}">
        <div class="cal-ag-head">
          <span class="md-title-small">${esc(wdName.slice(0, 3))}</span>
          <span class="cal-ag-num${day === today ? " today" : ""}">${d}</span>
          ${total > 0 ? `<span class="md-label-medium muted">${fmtDur(total)}</span>` : ""}
          <span class="cal-spacer"></span>
          <button class="md-icon-button cal-ag-new" data-ag-new="${day}" aria-label="Log time ${esc(wdName)}">${icon("add")}</button>
        </div>
        ${rows || `<p class="muted tiny cal-ag-empty">No entries</p>`}
      </section>`);
    }
    return `<div class="cal-agenda">${sections.join("")}</div>`;
  }

  /** #572: a carousel strip's inner HTML for one week — the 24h grid, the
      narrow agenda, and the week's supporting pane in a <template>. */
  function stripInnerHtml(sun: string, tz: string | null): string {
    const wd = weekData(sun, tz);
    const lanes: string[] = [];
    for (let i = 0; i < 7; i++) lanes.push(dayColumnHtml(addDays(sun, i), wd, i * 40));
    const hourLabels = Array.from({ length: 24 }, (_, h) => {
      const ampm = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
      const night = h < 6 || h >= 19;
      return `<span class="cal-hour-label${night ? " night" : ""}" style="top:${(h * calHourPx - 8).toFixed(0)}px">${ampm}</span>`;
    }).join("");
    return `
      <div class="cal-scroll" data-enter="3">
        <div class="cal-grid" style="--cal-hour:${calHourPx}px">
          <div class="cal-gutter-col">
            <div class="cal-gutter-spacer"></div>
            <div class="cal-gutter cal-hours">${hourLabels}</div>
          </div>
          ${lanes.join("")}
          <!-- data-now, not id: one line per strip; placeNow() positions each.
               htmx's settle restores server attributes on swapped nodes whose
               id already exists in the DOM, which would wipe placeNow()'s
               positioning ~20ms after every week swap (#215). -->
          <div class="cal-now" data-now hidden></div>
        </div>
      </div>
      ${agendaHtml(wd)}
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
    return `<div class="cal-scrim" id="cal-scrim" hidden>
        <div class="cal-dialog" role="dialog" aria-modal="true" aria-labelledby="cal-dialog-title">
          <div class="cal-dialog-head">
            <h2 class="md-headline-small" id="cal-dialog-title">New entry</h2>
            <button class="md-icon-button" id="cal-close" type="button" aria-label="Close dialog">${icon("close")}</button>
          </div>
          <p class="muted md-body-medium" id="cal-dialog-date"></p>
          <div class="md-text-field">
            <input type="text" id="cal-desc" placeholder=" " autocomplete="off" list="tk-desc-suggest-dialog">
            <label for="cal-desc">Description</label>
          </div>
          ${descDatalist()}
          <div class="md-text-field filled">
            <select id="cal-project" aria-label="Project"><option value="">No project</option>${projectOptions()}</select>
            <label for="cal-project">Project</label>
          </div>
          <div class="cal-time-row">
            <div class="md-text-field filled">
              <input type="time" id="cal-start" required>
              <label for="cal-start">Start</label>
            </div>
            <div class="md-text-field filled">
              <input type="time" id="cal-end" required>
              <label for="cal-end">End</label>
            </div>
            <span class="md-title-small" id="cal-dur"></span>
          </div>
          <p class="muted tiny" id="cal-locked" hidden></p>
          <p class="error tiny" id="cal-error" hidden></p>
          <div class="cal-dialog-actions">
            <button class="md-text-button danger" id="cal-delete" hidden>Delete</button>
            <span class="cal-spacer"></span>
            <button class="md-text-button" id="cal-cancel">Cancel</button>
            <button class="md-filled-button" id="cal-save">Save</button>
          </div>
        </div>
      </div>`;
  }

  function weekGrid(weekStr?: string): string {
    const q = weekStr && /^\d{4}-\d{2}-\d{2}$/.test(weekStr) ? `?week=${weekStr}` : "";
    /* #322: the skeleton mirrors the carousel pane layout (summary aside with
       the week-nav skeleton at its top, gutter + day columns with the hour
       rhythm) so the htmx swap lands without a layout flash. */
    const skelDay = `<div class="cal-skel-day"><div class="skel cal-skel-head"></div><div class="skel cal-skel-lane"></div></div>`;
    const skelGrid = `<div class="cal-skel-grid">${skelDay.repeat(8)}</div>`;
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
            <div class="cal-strip"><div class="cal-scroll" style="padding:4px">${skelGrid}</div></div>
            <div class="cal-strip"><div class="cal-scroll" style="padding:4px">${skelGrid}</div></div>
            <div class="cal-strip"><div class="cal-scroll" style="padding:4px">${skelGrid}</div></div>
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
    var HOUR=${calHourPx};
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
    /* M3 dialog motion: .open drives scrim fade + dialog scale/fade.
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
    /* grid owns the scroll: land near the current time when today is in view */
    var scroller=document.querySelector('.cal-scroll'), nowEl=document.querySelector('[data-now]');
    if(scroller&&nowEl){var r=nowEl.getBoundingClientRect(),s=scroller.getBoundingClientRect();
      scroller.scrollTop=Math.max(0,r.top-s.top+scroller.scrollTop-scroller.clientHeight*0.35);}
    function toMin(t){var p=t.split(':');return (+p[0])*60+(+p[1]);}
    function toHM(m){m=((m%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
    function fmtD(mins){var h=Math.floor(mins/60),m=mins%60;return (h?h+'h ':'')+m+'m';}
    function updDur(){var s=toMin(startI.value||'00:00'),e=toMin(endI.value||'00:00');
      dur.textContent=e>s?fmtD(e-s):'';}
    startI.addEventListener('input',updDur); endI.addEventListener('input',updDur);
    function openCreate(date,a,b){
      mode='create'; editId=null; dayStr=date; opener=null; /* drag — no keyboard trigger */
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
      var locked=el.dataset.locked||''; /* #334: sent/paid time opens read-only */
      var running=el.classList.contains('running'); /* #462: the timer card owns
        the running entry — deleting it here orphaned the card. */
      title.textContent=locked?'Entry (invoiced)':'Edit entry';
      delBtn.hidden=!!locked||running; err.hidden=true;
      var d=new Date(dayStr+'T12:00:00');
      dateLine.textContent=d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
      desc.value=el.dataset.desc||''; project.value=el.dataset.projectId||'';
      startI.value=el.dataset.start||'09:00'; endI.value=el.dataset.end||toHM(toMin(startI.value)+60); updDur();
      if(locked){
        lockNote.textContent='Invoiced on '+locked+' — this time can\u2019t be edited.';
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
      /* #530: entry cards are tabindex="0" role="button" — Enter/Space must
         activate them like real buttons. openEdit sets the focus-return
         opener, and preventDefault stops Space from scrolling the page. */
      else if(e.key==='Enter'||e.key===' '){
        var card=e.target&&e.target.closest?e.target.closest('.cal-entry,.cal-ag-row'):null;
        if(card){ e.preventDefault(); openEdit(card); }
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
    function refreshWeek(highlightId){
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
          var el=weekEl.querySelector('.cal-entry[data-id="'+highlightId+'"]');
          if(el) el.classList.add('cal-flash');
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
      var s=toMin(startI.value),e=toMin(endI.value);
      if(!(e>s)) return fail('End time must be after start time.');
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
      }).catch(function(ex){ fail(ex.message); });
    });
    delBtn.addEventListener('click',function(){
      /* #464: native confirm() replaced by the shared M3 confirm dialog. */
      window.tkConfirm('Delete this entry?').then(function(ok){
        if(!ok) return;
        fetch('/entries/'+editId,{method:'DELETE'}).then(function(r){
          if(!r.ok) throw new Error('delete failed'); /* #334: locked entries 403 */
          close(); refreshWeek(null);
        }).catch(function(ex){ fail(ex.message); });
      });
    });
    // drag-to-create on empty grid space
    var drag=null;
    function minsAt(ev,col){
      var r=col.getBoundingClientRect();
      var y=Math.max(0,Math.min(r.height,ev.clientY-r.top));
      return Math.floor(y/HOUR*(60/15))*(15);
    }
    function place(el,a,b){
      /* #273: same 2px inset as the server render, so resize/drag-preview
         cards match the painted cards. #275: keep the compact class in sync
         while resizing. */
      el.style.top=(a/60*HOUR+2)+'px';
      el.style.height=Math.max((b-a)/60*HOUR,22)-4+'px';
      el.classList.toggle('cal-compact',(b-a)/60*HOUR<26);
    }
    /* Milestone 17: drag the bottom edge of a finished entry to resize it.
       Delegated on document so it survives in-place #week refreshes. */
    var resize=null;
    document.addEventListener('pointerdown',function(e){
      var handle=e.target.closest('[data-resize]');
      if(handle){
        var entryEl=handle.closest('.cal-entry');
        var col=entryEl.closest('.cal-day-col');
        var edge=handle.getAttribute('data-resize'); /* "start" or "end" */
        e.preventDefault(); e.stopPropagation();
        resize={entry:entryEl,col:col,edge:edge,
          start:toMin(entryEl.dataset.start||'00:00'),
          end:toMin(entryEl.dataset.end||'00:00'),
          date:entryEl.dataset.date, id:entryEl.dataset.id,
          desc:entryEl.dataset.desc||'', projectId:entryEl.dataset.projectId||''};
        entryEl.classList.add('resizing');
        function rmove(ev){
          var m=minsAt(ev,col);
          if(resize.edge==='start'){
            var a=Math.min(resize.end-15,Math.max(m,0));
            resize.newStart=a;
            place(entryEl,a,resize.end);
          } else {
            var b=Math.max(resize.start+15,Math.min(m,1439));
            resize.newEnd=b;
            place(entryEl,resize.start,b);
          }
        }
        function rup(){
          window.removeEventListener('pointermove',rmove);
          window.removeEventListener('pointerup',rup);
          entryEl.classList.remove('resizing');
          var r=resize; resize=null;
          var ns=r.newStart!=null?r.newStart:r.start, ne=r.newEnd!=null?r.newEnd:r.end;
          if(ns===r.start&&ne===r.end) return; /* no change */
          var fd=new URLSearchParams();
          fd.set('description',r.desc);
          fd.set('project_id',r.projectId);
          fd.set('start_time',r.date+'T'+toHM(ns)+tzSuffix());
          fd.set('end_time',r.date+'T'+toHM(ne)+tzSuffix());
          fetch('/entries/'+r.id,{method:'POST',body:fd}).then(function(resp){
            if(!resp.ok) throw new Error('resize failed');
            refreshWeek(r.id);
          }).catch(function(){ refreshWeek(null); /* revert on failure */ });
        }
        window.addEventListener('pointermove',rmove);
        window.addEventListener('pointerup',rup);
        return;
      }
      var entryEl=e.target.closest('.cal-entry,.cal-ag-row');
      if(entryEl){ openEdit(entryEl); return; }
      var col=e.target.closest('.cal-day-col');
      if(!col) return;
      e.preventDefault();
      var a=minsAt(e,col);
      var pv=document.createElement('div');
      pv.className='cal-drag-preview';
      col.appendChild(pv); place(pv,a,a+15);
      drag={col:col,a:a,pv:pv,moved:false};
      function move(ev){ drag.moved=true; var m=minsAt(ev,col);
        var x=Math.min(drag.a,m),y=Math.max(drag.a,m); place(pv,x,Math.max(y,x+15)); }
      function up(ev){
        window.removeEventListener('pointermove',move);
        window.removeEventListener('pointerup',up);
        var m=drag.moved?minsAt(ev,col):drag.a+60;
        var x=Math.min(drag.a,m),y=Math.max(drag.a,m);
        if(y-x<15) y=x+15;
        drag.pv.remove(); var d={col:drag.col,x:x,y:y}; drag=null;
        openCreate(d.col.dataset.date,d.x,Math.min(d.y,1439));
      }
      window.addEventListener('pointermove',move);
      window.addEventListener('pointerup',up);
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
       column keep theirs hidden. */
    function placeNow(){
      var today=clientToday();
      var n=new Date();var nowMin=n.getHours()*60+n.getMinutes();
      var t=document.querySelectorAll('.cal-day.today');
      for(var i=0;i<t.length;i++) t[i].classList.remove('today');
      var nm=document.querySelectorAll('.cal-day-num.today');
      for(var i=0;i<nm.length;i++) nm[i].classList.remove('today');
      var ag=document.querySelectorAll('.cal-ag-day.today');
      for(var j=0;j<ag.length;j++) ag[j].classList.remove('today');
      var strips=document.querySelectorAll('#week .cal-strip');
      for(var s=0;s<strips.length;s++){
        (function(strip){
          var line=strip.querySelector('[data-now]');
          var col=strip.querySelector('.cal-day-col[data-date="'+today+'"]');
          var agd=strip.querySelector('.cal-ag-day[data-date="'+today+'"]');
          if(agd) agd.classList.add('today');
          if(!col){ if(line) line.hidden=true; return; }
          var day=col.closest('.cal-day');
          day.classList.add('today');
          var num=day.querySelector('.cal-day-num'); if(num) num.classList.add('today');
          day.classList.remove('paced-short'); /* the viewer's today is never "past" */
          if(line){ col.appendChild(line);
            line.style.top=((nowMin/60)*HOUR).toFixed(1)+'px'; line.hidden=false; }
          var run=col.querySelectorAll('.cal-entry.running');
          for(var i=0;i<run.length;i++){
            var st=run[i].getAttribute('data-start'); if(!st) continue;
            var pp=st.split(':'),sm=(+pp[0])*60+(+pp[1]);
            /* #704: the 30s tick grows the running card but never synced the
               compact pill class, so a timer started short kept its 999px
               radius and stretched into an oval. Toggle it on the true
               height, like the server render and the resize path do. */
            var trueH=((nowMin-sm)/60)*HOUR;
            run[i].style.height=Math.max(trueH,26).toFixed(1)+'px';
            run[i].classList.toggle('cal-compact',trueH<26);
          }
        })(strips[s]);
      }
    }
    /* Scroll one strip: center the now-line when today is visible, else top. */
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
    /* no-JS fallback: htmx swaps the whole window; re-init the carousel. */
    document.body.addEventListener('htmx:afterSwap',function(e){
      if(e.detail&&e.detail.target&&e.detail.target.id==='week'){
        initCarousel(); placeNow(); centerVisible(false); }
    });
  })();`;
  }

  function calendarPage(week?: string): string {
    return layout("Calendar", weekGrid(week), "calendar", true);
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
      <h2 class="md-headline-small" data-enter="2">${locked ? "Entry" : "Edit entry"}</h2>
      ${locked ? `<p class="muted md-body-medium">Invoiced on ${esc(e.invoice_number || "")} — this time can\u2019t be edited.</p>` : ""}
      <form method="post" action="/entries/${e.id}" class="form" id="edit-entry-form">
        <div class="md-text-field">
          <input type="text" id="ee-desc" name="description" value="${esc(e.description)}" placeholder=" "${dis}>
          <label for="ee-desc">Description</label>
        </div>
        <div class="md-text-field filled">
          <select id="ee-project" name="project_id"${dis}><option value="">No project</option>${projectOptions(e.project_id)}</select>
          <label for="ee-project">Project</label>
        </div>
        <div class="md-text-field filled">
          <input type="datetime-local" id="ee-start" name="start_time" data-iso="${esc(e.start_time)}" required placeholder=" "${dis}>
          <label for="ee-start">Start</label>
        </div>
        <div class="md-text-field filled">
          <input type="datetime-local" id="ee-end" name="end_time" data-iso="${esc(e.end_time || "")}" placeholder=" "${dis}>
          <label for="ee-end">End (blank = still running)</label>
        </div>
        <div class="row">
          ${locked ? "" : `<button class="md-filled-button" type="submit">Save</button>`}
          <a class="md-text-button" href="/calendar">${locked ? "Back" : "Cancel"}</a>
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

  return { weekInner, weekStrip, weekGrid, calendarPage, editPage };
}
