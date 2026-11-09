import { esc } from "../lib/format";

export interface VizEntry {
  id: string;
  title: string;
  desc?: string;
  projectId?: string;
  startMin: number;
  endMin: number;
  running?: boolean;
  invoiced?: boolean;
  locked?: boolean;
  overlap?: boolean;
}

export interface VizDay {
  date: string;
  label: string;
  total: string;
  isToday?: boolean;
  entries: VizEntry[];
}

export interface VisualizerOptions {
  days: VizDay[];
  startHour?: number;
  endHour?: number;
  hourPx?: number;
  nowMin?: number;
}

function fmtMin(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${String(m).padStart(2, "0")} ${suffix}`;
}

function fmtHour(min: number): string {
  const h24 = Math.floor(min / 60);
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h} ${suffix}`;
}

function hhmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function visualizer(opts: VisualizerOptions): string {
  const startHour = opts.startHour ?? 6;
  const endHour = opts.endHour ?? 18;
  const hourPx = opts.hourPx ?? 48;
  const dayStart = startHour * 60;
  const dayEnd = endHour * 60;
  const height = (endHour - startHour) * hourPx;

  const heads =
    `<div></div>` +
    opts.days
      .map(
        (day) =>
          `<div class="ui-viz-day-head${day.isToday ? " is-today" : ""}">` +
          `<span class="ui-viz-day-name">${esc(day.label)}</span>` +
          (day.isToday ? `<span class="ui-day-dot"></span>` : "") +
          `<span class="ui-viz-day-total" data-day-total>${esc(day.total)}</span></div>`,
      )
      .join("");

  const hours: string[] = [];
  for (let h = startHour; h <= endHour; h++) {
    hours.push(
      `<span class="ui-viz-hour" style="top:${(h - startHour) * hourPx}px">${esc(fmtHour(h * 60))}</span>`,
    );
  }

  const cols = opts.days
    .map((day) => {
      const blocks = day.entries
        .map((e) => {
          const top = ((e.startMin - dayStart) / 60) * hourPx + 2;
          const blockHeight = Math.max(((e.endMin - e.startMin) / 60) * hourPx - 4, 22);
          const cls =
            "ui-viz-block" +
            (e.invoiced ? " is-invoiced" : "") +
            (e.locked ? " is-locked" : "") +
            (e.overlap ? " is-overlap" : "") +
            (e.running ? " is-running" : "");
          const handles =
            e.running || e.locked || e.endMin - e.startMin < 60
              ? ""
              : `<div class="ui-viz-handle" data-resize="start" aria-hidden="true"><span class="ui-viz-grip"></span></div>` +
                `<div class="ui-viz-handle" data-resize="end" aria-hidden="true"><span class="ui-viz-grip"></span></div>`;
          const meta = e.running
            ? `${fmtMin(e.startMin)} – now`
            : `${fmtMin(e.startMin)} – ${fmtMin(e.endMin)}`;
          const state = e.running ? ", running" : e.locked ? ", locked" : "";
          return (
            `<div class="${cls}" tabindex="0" role="button" aria-label="${esc(e.title)}, ${esc(meta)}${state}" ` +
            `data-id="${esc(e.id)}" data-date="${esc(day.date)}" data-start="${hhmm(e.startMin)}" data-end="${hhmm(e.endMin)}"` +
            (e.projectId ? ` data-project-id="${esc(e.projectId)}"` : "") +
            (e.desc ? ` data-desc="${esc(e.desc)}"` : "") +
            (e.locked ? ` data-locked="1"` : "") +
            ` style="top:${top}px;height:${blockHeight}px">${handles}` +
            `<div class="ui-viz-block-title">${esc(e.title)}</div>` +
            `<div class="ui-viz-block-meta">${esc(meta)}</div></div>`
          );
        })
        .join("");
      const nowTop =
        opts.nowMin != null
          ? Math.min(Math.max(((opts.nowMin - dayStart) / 60) * hourPx, 0), height)
          : 0;
      const now =
        day.isToday && opts.nowMin != null && opts.nowMin >= dayStart && opts.nowMin <= dayEnd
          ? `<div class="ui-viz-now" data-now style="top:${nowTop}px"></div>`
          : "";
      return `<div class="ui-viz-col${day.isToday ? " is-today" : ""}" data-date="${esc(day.date)}" style="height:${height}px">${blocks}${now}</div>`;
    })
    .join("");

  return (
    `<div class="ui-viz" style="--viz-hour:${hourPx}px" data-hour-px="${hourPx}" data-start-min="${dayStart}" data-end-min="${dayEnd}">` +
    `<div class="ui-viz-heads">${heads}</div>` +
    `<div class="ui-viz-hours" style="height:${height}px">${hours.join("")}</div>${cols}</div>`
  );
}
