import { esc } from "../lib/format";

export interface ProgressBarOptions {
  value: number;
  label: string;
}

export function progressBar(opts: ProgressBarOptions): string {
  const pct = Number.isFinite(opts.value) ? Math.min(100, Math.max(0, Math.round(opts.value))) : 0;
  return (
    `<div class="ui-progress" role="progressbar" aria-label="${esc(opts.label)}" ` +
    `aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">` +
    `<span class="ui-progress-fill" style="width:${pct}%"></span></div>`
  );
}
