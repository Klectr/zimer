import { esc } from "../lib/format";
import { icon } from "../lib/icons";

/** An inline notice inside a card or form: tinted by tone, a leading icon,
 *  one sentence, and an optional action. For something the user should fix
 *  or know before acting — not a toast (transient) and not a dialog
 *  (blocking). Warnings and errors are announced (role="alert"). */
export interface InlineAlertOptions {
  tone: "info" | "warning" | "error";
  text: string;
  actionHtml?: string;
  id?: string;
}

const ICON = { info: "info", warning: "alert", error: "alert" } as const;

export function inlineAlert(o: InlineAlertOptions): string {
  const role = o.tone === "info" ? "status" : "alert";
  const id = o.id ? ` id="${esc(o.id)}"` : "";
  const action = o.actionHtml ? `<span class="ui-alert-action">${o.actionHtml}</span>` : "";
  return `<div class="ui-alert ui-alert-${o.tone}" role="${role}"${id}>${icon(ICON[o.tone])}<p>${esc(o.text)}</p>${action}</div>`;
}
