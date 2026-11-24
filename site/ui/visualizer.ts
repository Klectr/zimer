import { esc, safeCssColor } from "../lib/format";
import { tooltip } from "./tooltip";

export interface VizEntry {
  id: string;
  title: string;
  desc?: string;
  projectId?: string;
  startMin: number;
  endMin: number;
  running?: boolean;
  invoiced?: boolean;
  color?: string;
  locked?: boolean;
  lockedLabel?: string;
  overlap?: boolean;
  /** #1082: time that will never be invoiced — drawn outline-only. */
  nonBillable?: boolean;
}

export interface VizDay {
  date: string;
  label: string;
  total: string;
  detail?: string;
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

function fmtCompact(min: number, withMeridiem: boolean): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const suffix = h24 >= 12 ? " PM" : " AM";
  return `${h}${m ? `:${String(m).padStart(2, "0")}` : ""}${withMeridiem ? suffix : ""}`;
}

/* #1219: the visible block meta is compact — a day column is ~95px wide, so
   the full "9:00 AM – 12:30 PM" clipped the end time, the one thing the line
   exists to show. The start drops its meridiem when it matches the end's and
   ":00" minutes are dropped. The aria-label keeps the full format. */
function fmtRangeCompact(startMin: number, endMin: number): string {
  const sameMeridiem = Math.floor(startMin / 720) === Math.floor(endMin / 720);
  return `${fmtCompact(startMin, !sameMeridiem)}–${fmtCompact(endMin, true)}`;
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
      .map((day, i) => {
        const align = i === 0 ? "start" : i === opts.days.length - 1 ? "end" : "center";
        const content =
          `<span class="ui-viz-day-inner">` +
          `<span class="ui-viz-day-name">${esc(day.label)}</span>` +
          (day.isToday ? `<span class="ui-day-dot"></span>` : "") +
          `<span class="ui-viz-day-total" data-day-total>${esc(day.total)}</span></span>`;
        return `<div class="ui-viz-day-head${day.isToday ? " is-today" : ""}">` +
          tooltip({
            id: `viz-day-${day.date}`,
            label: day.detail || `${day.label} · ${day.total || "0h"} tracked`,
            placement: "bottom",
            align,
            contentHtml: content,
          }) +
          `</div>`;
      })
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
          const blockHeight = Math.max(((e.endMin - e.startMin) / 60) * hourPx - 4, 22);
          const top = Math.min(((e.startMin - dayStart) / 60) * hourPx + 2, height - blockHeight);
          const cls =
            "ui-viz-block" +
            (e.endMin - e.startMin >= 60 && blockHeight >= 64 ? " is-tall" : "") +
            (e.invoiced ? " is-invoiced" : "") +
            (e.nonBillable ? " is-nonbillable" : "") +
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
          /* #1219: below ~40px the meta line half-renders under the title —
             render it hidden instead of omitting it, so the drag paint and
             the running-block growth can reveal it without a re-render.
             The full range stays in the aria-label either way. */
          const metaHtml = `<div class="ui-viz-block-meta"${blockHeight >= 40 ? "" : ` style="display:none"`}>${esc(e.running ? meta : fmtRangeCompact(e.startMin, e.endMin))}</div>`;
          const state = (e.running ? ", running" : e.locked ? ", locked" : "") + (e.nonBillable ? ", non-billable" : "");
          return (
            `<div class="${cls}" tabindex="0" role="button" aria-label="${esc(e.title)}, ${esc(meta)}${state}" ` +
            `data-id="${esc(e.id)}" data-date="${esc(day.date)}" data-start="${hhmm(e.startMin)}" data-end="${hhmm(e.endMin)}"` +
            (e.projectId ? ` data-project-id="${esc(e.projectId)}"` : "") +
            (e.desc ? ` data-desc="${esc(e.desc)}"` : "") +
            (e.locked ? ` data-locked="${esc(e.lockedLabel || "1")}"` : "") +
            (e.nonBillable ? ` data-billable="0"` : "") +
            ` style="--entry:${safeCssColor(e.color) ?? "var(--color-text-tertiary)"};top:${top}px;height:${blockHeight}px">${handles}` +
            `<div class="ui-viz-block-title">${esc(e.title)}</div>` +
            `${metaHtml}</div>`
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
