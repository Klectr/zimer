import { esc } from "../lib/format";
import { card } from "./card";

export interface TimerDisplayOptions {
  elapsed: string;
  size?: "md" | "sm";
  start?: string;
}

export function timerDisplay(opts: TimerDisplayOptions): string {
  const cls = opts.size === "sm" ? "ui-timer ui-timer-sm" : "ui-timer";
  const start = opts.start ? ` data-start="${esc(opts.start)}"` : "";
  return `<div class="${cls}"${start}>${esc(opts.elapsed)}</div>`;
}

export interface TimerPanelOptions {
  running: boolean;
  statusHtml: string;
  context: string;
  startedLabel?: string;
  startedAt?: string;
  elapsed: string;
  metaHtml?: string;
  actionsHtml: string;
}

export function timerPanel(opts: TimerPanelOptions): string {
  const started = opts.startedLabel ? `<span class="ui-timer-started">${esc(opts.startedLabel)}</span>` : "";
  const meta = opts.metaHtml ? `<div class="ui-timer-meta">${opts.metaHtml}</div>` : "";
  const inner =
    `<div class="ui-timer-top">${opts.statusHtml}<span class="ui-timer-context">${esc(opts.context)}</span>${started}</div>` +
    timerDisplay({ elapsed: opts.elapsed, start: opts.startedAt }) +
    `<div class="ui-timer-bottom">${meta}<span class="ui-timer-actions">${opts.actionsHtml}</span></div>`;
  return card({ content: inner, tracking: opts.running, className: "ui-timer-panel" });
}
