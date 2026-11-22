import { esc } from "../lib/format";
import { icon } from "../lib/icons";

/** A change against a comparison period, e.g. "12% up vs prev week".
 *  #542/#590: icon from the icon system, direction word in the visible text. */
export interface TrendDeltaOptions {
  /** Signed percent. */
  pct: number;
  /** e.g. "vs prev week" */
  vs: string;
}

export function trendDelta(o: TrendDeltaOptions): string {
  const trend = o.pct > 0 ? "trend_up" : o.pct < 0 ? "trend_down" : "trend_flat";
  const dir = o.pct > 0 ? "up" : o.pct < 0 ? "down" : "unchanged";
  const text = `${Math.abs(o.pct)}% ${dir} ${o.vs}`;
  return `<span class="muted cal-delta" aria-label="${esc(text)}">${icon(trend)} ${esc(text)}</span>`;
}
