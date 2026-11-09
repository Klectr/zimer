import { esc } from "../lib/format";
import { button } from "./button";
import { iconButton } from "./icon-button";

export interface DialogOptions {
  id: string;
  title: string;
  body: string;
  actions?: string;
  open?: boolean;
  role?: "dialog" | "alertdialog";
}

export function dialog(opts: DialogOptions): string {
  const actions = opts.actions ? `<div class="ui-dialog-actions">${opts.actions}</div>` : "";
  const hidden = opts.open ? "" : " hidden";
  const describedBy = opts.body ? ` aria-describedby="${esc(opts.id)}-desc"` : "";
  const body = opts.body ? `<div class="ui-dialog-body" id="${esc(opts.id)}-desc">${opts.body}</div>` : "";
  return (
    `<div class="ui-scrim" id="${esc(opts.id)}"${hidden}>` +
    `<div class="ui-dialog" role="${opts.role ?? "dialog"}" aria-modal="true" aria-labelledby="${esc(opts.id)}-title"${describedBy}>` +
    `<div class="ui-dialog-head"><h2 class="ui-dialog-title" id="${esc(opts.id)}-title">${esc(opts.title)}</h2>` +
    iconButton({ icon: "close", label: "Close dialog", attrs: "data-close" }) +
    `</div>${body}${actions}</div></div>`
  );
}

export interface ConfirmDialogOptions {
  id: string;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  open?: boolean;
}

export function confirmDialog(opts: ConfirmDialogOptions): string {
  const actions =
    button({ label: opts.cancelLabel ?? "Cancel", variant: "ghost", attrs: "data-close data-autofocus" }) +
    button({ label: opts.confirmLabel, variant: "primary", danger: opts.danger, attrs: "data-confirm-action" });
  return dialog({
    id: opts.id,
    title: opts.title,
    body: `<p>${esc(opts.body)}</p>`,
    actions,
    open: opts.open,
    role: "alertdialog",
  });
}
