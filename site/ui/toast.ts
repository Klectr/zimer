import { esc } from "../lib/format";
import { icon } from "../lib/icons";

export type ToastTone = "success" | "error" | "info";

const TONE_ICON: Record<ToastTone, string> = {
  success: "check",
  error: "alert",
  info: "info",
};

export interface ToastOptions {
  tone: ToastTone;
  title: string;
  body?: string;
}

export function toast(opts: ToastOptions): string {
  const body = opts.body ? `<div class="ui-toast-body">${esc(opts.body)}</div>` : "";
  const role = opts.tone === "error" ? "alert" : "status";
  return (
    `<div class="ui-toast ui-toast-${opts.tone}" role="${role}">` +
    `<span class="ui-toast-chip">${icon(TONE_ICON[opts.tone])}</span>` +
    `<div><div class="ui-toast-title">${esc(opts.title)}</div>${body}</div></div>`
  );
}
