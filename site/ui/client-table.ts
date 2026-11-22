import { esc } from "../lib/format";
import { icon } from "../lib/icons";
import { button } from "./button";
import { card } from "./card";

/** The quiet client table (#1344): one value per cell, with the detail
 *  (per-project split, open Zinvoices) offloaded to a hover card that follows
 *  the mouse. Presentational only — the view maps data into these options. */

/** Bar and project-dot shades: the first projects get the strongest tint. */
const SHADES = [100, 70, 45, 30];
const shade = (color: string, i: number) =>
  `color-mix(in srgb, ${esc(color)} ${SHADES[Math.min(i, SHADES.length - 1)]}%, transparent)`;

export interface ClientCardLine {
  label: string;
  value: string;
  tone?: "muted" | "error";
}

export interface ClientHoverCardOptions {
  title: string;
  /** Client color; project dots are shades of it. */
  color: string;
  /** e.g. "$120/hr · Net 30 · 8 projects" */
  meta: string;
  /** Active projects, busiest first (dots are shaded by position). */
  projects: { name: string; dur: string }[];
  /** Muted follow-up lines under the projects ("6 more projects"). */
  extra?: ClientCardLine[];
  /** Open Zinvoices, shown under a divider. */
  invoices?: ClientCardLine[];
  hint?: string;
}

const cardLine = (l: ClientCardLine, lead = "") =>
  `<div class="mg-card-row${l.tone ? ` is-${l.tone}` : ""}"><span>${lead}${esc(l.label)}</span><span>${esc(l.value)}</span></div>`;

export function clientHoverCard(o: ClientHoverCardOptions): string {
  const projects = o.projects
    .map((p, i) => cardLine({ label: p.name, value: p.dur }, `<i class="mg-card-dot" style="background:${shade(o.color, i)}"></i>`))
    .join("");
  const extra = (o.extra || []).map((l) => cardLine({ tone: "muted", ...l })).join("");
  const invoices = o.invoices && o.invoices.length ? `<div class="mg-card-sep"></div>${o.invoices.map((l) => cardLine(l)).join("")}` : "";
  return (
    `<div class="mg-card" aria-hidden="true"><div class="mg-card-title">${esc(o.title)}</div>` +
    `<div class="mg-card-meta">${esc(o.meta)}</div>` +
    projects + extra + invoices +
    `<div class="mg-card-hint">${esc(o.hint ?? "Click to open")}</div></div>`
  );
}

export interface ClientTableRow {
  /** Goes on data-client-edit; the page opens the client dialog with it. */
  key: string;
  name: string;
  color: string;
  month: {
    label: string;
    /** 0 h this month: dims the label and draws an empty bar. */
    muted?: boolean;
    /** Bar fill width relative to the busiest client, 0–100. */
    widthPct: number;
    /** Per-project segment weights (seconds), busiest first. */
    segments: number[];
  };
  /** Formatted amount, or omit for an em dash. */
  unbilled?: string;
  outstanding?: string;
  overdue?: boolean;
  last: { text: string; quiet?: boolean };
  card: Omit<ClientHoverCardOptions, "title" | "color">;
}

export interface ClientTableOptions {
  rows: ClientTableRow[];
  /** Footer line, e.g. "No client · 2h this month". Omit to drop the footer. */
  noClientLabel?: string;
  emptyText?: string;
  id?: string;
}

const dash = `<span class="mg-muted">—</span>`;

function clientTableRow(r: ClientTableRow): string {
  const bar = !r.month.muted && r.month.segments.length
    ? `<span class="mg-bar" aria-hidden="true"><span class="mg-bar-fill" style="width:${r.month.widthPct}%">` +
      r.month.segments.map((w, i) => `<i style="flex:${w};background:${shade(r.color, i)}"></i>`).join("") +
      `</span></span>`
    : `<span class="mg-bar" aria-hidden="true"></span>`;
  const outstanding = r.outstanding
    ? `${r.overdue ? `<span class="ui-tag ui-tag-error mg-overdue">Overdue</span>` : ""}${esc(r.outstanding)}`
    : dash;
  const hover = clientHoverCard({ title: r.name, color: r.color, ...r.card });
  return `<tr class="mg-row" tabindex="0" data-client-edit="${esc(r.key)}" aria-haspopup="dialog" aria-label="${esc(`Edit client ${r.name}`)}">
        <td><span class="manage-client-name"><span class="ui-row-lead-dot" style="background:${esc(r.color)}" aria-hidden="true"></span>${esc(r.name)}</span>${hover}</td>
        <td class="col-month"><span class="mg-hours"><span class="${r.month.muted ? "mg-muted" : ""}">${esc(r.month.label)}</span>${bar}</span></td>
        <td class="num">${r.unbilled ? esc(r.unbilled) : dash}</td>
        <td class="num">${outstanding}</td>
        <td class="col-last${r.last.quiet ? " is-quiet" : ""}">${esc(r.last.text)}</td>
        <td class="mg-chev" aria-hidden="true">${icon("chevron_right")}</td>
      </tr>`;
}

/** Mouse-only: the hover card sits 16px below-right of the pointer, flips
 *  left/up at the table card's edge or the viewport bottom, and returns to
 *  its anchored CSS spot (keyboard focus) when the pointer leaves the row.
 *  Guarded so re-swapped tables (htmx OOB) never stack listeners. */
export const CLIENT_TABLE_SCRIPT = `<script>(function(){
  if(window.__tkClientCardFollow) return; window.__tkClientCardFollow = true;
  var cur = null;
  function clear(){ if(!cur) return; var c = cur.querySelector(".mg-card"); if(c){ c.style.left = ""; c.style.top = ""; } cur = null; }
  document.addEventListener("pointermove", function(ev){
    if(ev.pointerType !== "mouse") return;
    var row = ev.target && ev.target.closest ? ev.target.closest("tr.mg-row") : null;
    if(row !== cur) clear();
    if(!row) return;
    var c = row.querySelector(".mg-card"), box = row.closest(".manage-table-card");
    if(!c || !box) return;
    cur = row;
    var r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
    var w = c.offsetWidth, h = c.offsetHeight, gap = 16;
    var x = ev.clientX + gap, y = ev.clientY + gap;
    if(x + w > b.right - 8) x = ev.clientX - gap - w;
    if(x < b.left + 8) x = b.left + 8;
    if(y + h > window.innerHeight - 8) y = ev.clientY - gap - h;
    c.style.left = (x - r.left) + "px";
    c.style.top = (y - r.top) + "px";
  });
  document.addEventListener("pointerleave", clear);
})();</script>`;

export function clientTable(o: ClientTableOptions): string {
  const empty = o.rows.length ? "" : `<tr><td colspan="6" class="mg-muted">${esc(o.emptyText ?? "No clients yet.")}</td></tr>`;
  const foot = o.noClientLabel != null
    ? `<p class="mg-foot"><span>${esc(o.noClientLabel)}</span>` +
      button({ label: "View projects", size: "sm", variant: "ghost", attrs: `data-client-edit="none" aria-haspopup="dialog" aria-label="View projects with no client"` }) + `</p>`
    : "";
  return card({
    id: o.id,
    className: "manage-table-card",
    content:
      `<table class="ui-table mg-table"><thead><tr><th>Client</th><th class="col-month">This month</th><th class="num">Unbilled</th><th class="num">Outstanding</th><th class="col-last">Last tracked</th><th><span class="ui-sr-only">Open</span></th></tr></thead>` +
      `<tbody>${o.rows.map(clientTableRow).join("")}${empty}</tbody></table>` +
      foot + CLIENT_TABLE_SCRIPT,
  });
}
