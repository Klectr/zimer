import { esc } from "../lib/format";
import { progressBar } from "./progress";

/** Hours against a target (#908): the day on the Zimer page, the week on the
 *  calendar. Stacked: label under the bar. Inline: label beside it. */
export interface TargetBarOptions {
  /** 0–100; clamped. */
  pct: number;
  /** e.g. "Today · 1h 02m / 8h" or "38h 02m / 40h" */
  label: string;
  /** Accessible name for the bar, e.g. "Weekly hours target, 40 hours". */
  ariaLabel: string;
  /** Past the target: adds a quiet "over target". */
  over?: boolean;
  inline?: boolean;
}

export function targetBar(o: TargetBarOptions): string {
  const over = o.over ? ` · <span class="tiny">over target</span>` : "";
  return `
      <div class="ui-target${o.inline ? " ui-target-inline" : ""}">
        ${progressBar({ value: Math.min(100, Math.max(0, o.pct)), label: o.ariaLabel })}
        <div class="ui-target-label">${esc(o.label)}${over}</div>
      </div>`;
}
