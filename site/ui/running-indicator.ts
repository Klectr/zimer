import { esc } from "../lib/format";

export interface RunningIndicatorOptions {
  label: string;
  elapsed: string;
  href: string;
}

export function runningIndicator(opts: RunningIndicatorOptions): string {
  return (
    `<a href="${esc(opts.href)}" class="ui-running">` +
    `<span class="ui-running-dot"></span><span>${esc(opts.label)}</span>` +
    `<span class="ui-running-time">${esc(opts.elapsed)}</span></a>`
  );
}
