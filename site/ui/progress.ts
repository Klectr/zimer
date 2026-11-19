import { esc } from "../lib/format";

export type ProgressTone = "primary" | "neutral" | "warning" | "error";

export interface ProgressBarOptions {
  value: number;
  label: string;
  tone?: ProgressTone;
}

export function progressBar(opts: ProgressBarOptions): string {
  const pct = Number.isFinite(opts.value) ? Math.min(100, Math.max(0, Math.round(opts.value))) : 0;
  const toneCls = opts.tone && opts.tone !== "primary" ? ` ui-progress-fill-${opts.tone}` : "";
  return (
    `<div class="ui-progress" role="progressbar" aria-label="${esc(opts.label)}" ` +
    `aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">` +
    `<span class="ui-progress-fill${toneCls}" style="width:${pct}%"></span></div>`
  );
}
