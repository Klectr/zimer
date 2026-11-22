import { esc, safeCssColor } from "../lib/format";
import { icon } from "../lib/icons";
import { button, linkButton } from "./button";
import { progressBar } from "./progress";
import { tag } from "./tag";

/** The calendar's supporting pane (#572): week nav, the week's totals and
 *  delta, the Zinvoice nudge, the weekly target, the client strip, the hint,
 *  the first-run note, and the strip legend. Presentational — the view
 *  computes the week; links carry the /partial/week htmx swap. */

export interface WeekLink {
  /** Full-page URL (also the pushed URL). */
  href: string;
  /** htmx partial for an in-place swap of #week. */
  partial: string;
}

const weekLinkAttrs = (l: WeekLink) =>
  `href="${esc(l.href)}" hx-get="${esc(l.partial)}" hx-target="#week" hx-swap="innerHTML" hx-push-url="${esc(l.href)}"`;

export interface WeekNavOptions {
  title: string;
  /** Shown off the current week: jump back to it. */
  today?: WeekLink;
  prev: WeekLink;
  next: WeekLink;
  /** e.g. the compact Zinvoice nudge beside the arrows. */
  extraHtml?: string;
}

export function weekNav(o: WeekNavOptions): string {
  return `
      <div class="week-nav">
        <h1 class="ui-page-title">${esc(o.title)}</h1>
        <div class="week-nav-actions">
          ${o.today ? `<a class="ui-btn ui-btn-ghost" ${weekLinkAttrs(o.today)}>Today</a>` : ""}
          <a class="ui-icon-btn" ${weekLinkAttrs(o.prev)} data-slide="prev" data-tip="Previous week" aria-label="Previous week">${icon("chevron_left")}</a>
          <a class="ui-icon-btn tip-right" ${weekLinkAttrs(o.next)} data-slide="next" data-tip="Next week" aria-label="Next week">${icon("chevron_right")}</a>
          ${o.extraHtml ?? ""}
        </div>
      </div>`;
}

export interface ZinvoiceNudgeOptions {
  href: string;
  /** "Zinvoice this week" / "Zinvoice this period" (#592). */
  label: string;
  /** e.g. "3h 10m not yet Zinvoiced" — omitted when it's all of the billable time. */
  amount?: string;
  /** The compact copy beside the week arrows (840–1279px layout). */
  nav?: boolean;
}

export function zinvoiceNudge(o: ZinvoiceNudgeOptions): string {
  const cls = `nudge-chip${o.nav ? " nudge-nav" : ""}${o.amount ? "" : " nudge-chip--solo"}`;
  return `
      <a class="${cls}" href="${esc(o.href)}">
        ${o.amount ? `<span>${esc(o.amount)}</span>` : ""}
        <span class="nudge-go">${icon("receipt")} ${esc(o.label)}</span>
      </a>`;
}

export interface WeekDeltaOptions {
  /** Signed percent vs the comparison week. */
  pct: number;
  /** "vs this time last week" / "vs prev week". */
  vs: string;
}

/** #542/#590: icon from the icon system, direction word in the visible text. */
export function weekDelta(o: WeekDeltaOptions): string {
  const trend = o.pct > 0 ? "trend_up" : o.pct < 0 ? "trend_down" : "trend_flat";
  const dir = o.pct > 0 ? "up" : o.pct < 0 ? "down" : "unchanged";
  const text = `${Math.abs(o.pct)}% ${dir} ${o.vs}`;
  return `<span class="muted cal-delta" aria-label="${esc(text)}">${icon(trend)} ${esc(text)}</span>`;
}

export interface WeekSummaryOptions {
  total: string;
  billable: string;
  deltaHtml?: string;
  nudgeHtml?: string;
}

export function weekSummary(o: WeekSummaryOptions): string {
  return `
      <div class="cal-summary">
        <div class="ui-page-title cal-summary-total">${esc(o.total)}</div>
        <div class="ui-row-meta cal-summary-sub">${esc(o.billable)} billable${o.deltaHtml ? ` · ${o.deltaHtml}` : ""}</div>
        ${o.nudgeHtml ?? ""}
      </div>`;
}

export interface WeekTargetBarOptions {
  pct: number;
  /** e.g. "38h 02m / 40h" */
  label: string;
  over?: boolean;
  ariaLabel: string;
}

/** Slim pacing bar under the week header (#908). */
export function weekTargetBar(o: WeekTargetBarOptions): string {
  return `
      <div class="week-target">
        ${progressBar({ value: Math.min(100, Math.max(0, o.pct)), label: o.ariaLabel })}
        <div class="ui-row-meta">${esc(o.label)}${o.over ? ` · <span class="tiny">over target</span>` : ""}</div>
      </div>`;
}

export function weekClients(rows: { name: string; color?: string | null; dur: string }[]): string {
  if (!rows.length) return "";
  return `
      <div class="week-clients">
        ${rows.map((c) => {
          const color = safeCssColor(c.color ?? undefined);
          return `
          <span class="week-client">
            <span class="week-client-dot"${color ? ` style="background:${esc(color)}"` : ""}></span>
            <span>${esc(c.name)}</span>
            <span class="muted">${esc(c.dur)}</span>
          </span>`;
        }).join("")}
      </div>`;
}

/** #781: both create gestures render; the client shows the one that
 *  matches the strip (drag on the grid, + on the agenda). */
export function calHint(): string {
  return `<p class="muted tiny cal-hint"><span class="cal-hint-grid">Drag across the calendar to log time. Click an entry to edit it.</span><span class="cal-hint-agenda">Tap + to log time, tap an entry to edit.</span></p>`;
}

/** #300: first-run note with the sample-data action. */
export function calFirstRun(o: { actionHtml?: string } = {}): string {
  const action = o.actionHtml ?? `<form method="post" action="/demo/load" class="inline">${button({ label: "Load demo data", variant: "ghost", type: "submit" })}</form>`;
  return `<div class="cal-first-run">
        ${icon("info")}
        <p><strong>New here?</strong> Load fictional sample data to explore the calendar.</p>
        ${action}
      </div>`;
}

/** The strip legend (#1326: Invoiced neutral, Running success + dot) and the week export. */
export function calLegend(o: { exportHref: string }): string {
  return `
      <div class="cal-legend">
        ${tag({ label: "Invoiced", tone: "neutral" })}
        ${tag({ label: "Running", tone: "success", dot: true })}
        ${linkButton({ label: "Export week CSV", href: o.exportHref, size: "sm", download: true, className: "cal-legend-export" })}
      </div>`;
}
