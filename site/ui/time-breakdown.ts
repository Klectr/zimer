import { esc } from "../lib/format";

/** Bars per day (or week) of tracked time — hand-rolled SVG, no chart
 *  library. Heights scale to the busiest bar; tiny bars keep 3px. */
export interface TimeBreakdownBar {
  label: string;
  hours: number;
  /** Hover title, e.g. "Nov 3: 4.5 h tracked". */
  tip: string;
}

export interface TimeBreakdownChartOptions {
  per: "day" | "week";
  /** e.g. "18.5 h" */
  totalLabel: string;
  bars: TimeBreakdownBar[];
}

/** Hand-rolled SVG bars (no chart library). Heights scale to the busiest bar;
 *  every bar keeps a 3px minimum so tiny days stay visible. */
export function timeBreakdownChart(o: TimeBreakdownChartOptions): string {
  const max = Math.max(1, ...o.bars.map((b) => b.hours));
  const W = 600, baseline = 150, areaH = 120, n = Math.max(1, o.bars.length);
  const slot = W / n, bw = Math.min(34, slot * 0.62);
  const bars = o.bars.map((b, i) => {
    const h = Math.max(3, Math.round(b.hours / max * areaH));
    const x = (i * slot + (slot - bw) / 2).toFixed(1);
    const cx = (i * slot + slot / 2).toFixed(1);
    return `<g><title>${esc(b.tip)}</title>` +
      `<rect x="${x}" y="${baseline - h}" width="${bw.toFixed(1)}" height="${h}" rx="4" class="tb-bar"/>` +
      `<text x="${cx}" y="${baseline + 18}" text-anchor="middle">${esc(b.label)}</text></g>`;
  }).join("");
  return `<section class="inv-breakdown" aria-label="Time breakdown">` +
    `<div class="ui-block-title">Time breakdown</div>` +
    `<p class="muted inv-breakdown-sub">Tracked time per ${o.per} — ${esc(o.totalLabel)} total</p>` +
    `<svg class="tb-chart" viewBox="0 0 ${W} 180" role="img" aria-label="Tracked time per ${o.per}">${bars}</svg>` +
    `</section>`;
}
