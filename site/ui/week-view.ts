import { esc } from "../lib/format";
import { entryRow } from "./rows";

export interface WeekEntry {
  title: string;
  meta: string;
  duration: string;
  running?: boolean;
  invoiced?: boolean;
  attrs?: string;
}

export interface WeekDay {
  weekday: string;
  dateLabel: string;
  total: string;
  isToday?: boolean;
  logHref?: string;
  date?: string;
  addHtml?: string;
  entries: WeekEntry[];
}

export interface WeekViewOptions {
  days: WeekDay[];
  agendaOnly?: boolean;
}

const MAX_GRID_ENTRIES = 4;

function dayHead(day: WeekDay): string {
  const dot = day.isToday ? `<span class="ui-day-dot"></span>` : "";
  return (
    `<div class="ui-day-head"><span class="ui-day-name">${esc(day.weekday)} ${esc(day.dateLabel)}</span>${dot}` +
    `<span class="ui-day-total">${esc(day.total)}</span>${day.addHtml ?? ""}</div>`
  );
}

function gridDay(day: WeekDay): string {
  const shown = day.entries.slice(0, MAX_GRID_ENTRIES);
  const more =
    day.entries.length > MAX_GRID_ENTRIES
      ? `<div class="ui-day-more">+${day.entries.length - MAX_GRID_ENTRIES} more</div>`
      : "";
  const entries = shown
    .map(
      (e) =>
        `<div class="ui-week-entry"><div class="ui-week-entry-title">${esc(e.title)}</div>` +
        `<div class="ui-week-entry-meta">${e.running ? "Running · " : ""}${esc(e.duration)}</div></div>`,
    )
    .join("");
  return `<div class="ui-day${day.isToday ? " is-today" : ""}">${dayHead(day)}<div class="ui-day-entries">${entries}${more}</div></div>`;
}

function agendaDay(day: WeekDay): string {
  const entries =
    day.entries.length === 0
      ? `<div class="ui-row-meta">No entries</div>` +
        (day.logHref ? ` <a class="ui-btn ui-btn-ghost ui-btn-sm" href="${esc(day.logHref)}">Log time</a>` : "")
      : `<div class="ui-list">` +
        day.entries
          .map((e) =>
            entryRow({
              title: e.title,
              meta: e.meta,
              duration: e.duration,
              running: e.running,
              mark: e.invoiced ? "Zinvoiced" : undefined,
              attrs: e.attrs,
            }),
          )
          .join("") +
        `</div>`;
  return `<section class="ui-agenda-day"${day.date ? ` data-date="${esc(day.date)}"` : ""}>${dayHead(day)}${entries}</section>`;
}

export function weekView(opts: WeekViewOptions): string {
  if (opts.agendaOnly) {
    return `<div class="ui-week ui-week-agenda-only"><div class="ui-week-agenda">${opts.days.map(agendaDay).join("")}</div></div>`;
  }
  return (
    `<div class="ui-week"><div class="ui-week-grid">${opts.days.map(gridDay).join("")}</div>` +
    `<div class="ui-week-agenda">${opts.days.map(agendaDay).join("")}</div></div>`
  );
}
