import { esc } from "../lib/format";
import { icon } from "../lib/icons";

type IconName = Parameters<typeof icon>[0];

/** A leading icon with a headline and a supporting line (#404). Used for the
 *  update check's every outcome in About & updates. */
export interface StatusRowOptions {
  icon: IconName;
  headline: string;
  supporting: string;
  /** primary: an action is waiting (update available). error: announced as an alert. */
  tone?: "primary" | "error";
}

export function statusRow(o: StatusRowOptions): string {
  const cls = `status-row${o.tone ? ` status-row-${o.tone}` : ""}`;
  const role = o.tone === "error" ? ` role="alert"` : "";
  return `<div class="${cls}"${role}>${icon(o.icon)}<div class="status-row-text">
        <p class="status-row-headline">${esc(o.headline)}</p>
        <p class="status-row-supporting">${esc(o.supporting)}</p>
      </div></div>`;
}

/** A shell command to copy, e.g. the installer one-liner. */
export function commandLine(o: { note: string; command: string }): string {
  return `
        <p class="muted">${esc(o.note)}</p>
        <p><code class="update-cmd">${esc(o.command)}</code></p>`;
}
