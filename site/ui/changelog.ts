import { esc } from "../lib/format";
import { tag, type TagTone } from "./tag";

export type ChangelogKind = "fix" | "new" | "improved";

const KIND_TAG: Record<ChangelogKind, { label: string; tone: TagTone }> = {
  fix: { label: "Fix", tone: "success" },
  new: { label: "New", tone: "info" },
  improved: { label: "Improved", tone: "neutral" },
};

export interface ChangelogEntry {
  date: string;
  kind?: ChangelogKind;
  body?: string;
  itemsHtml?: string[];
}

export function changelogList(entries: ChangelogEntry[]): string {
  if (!entries.length) return `<p class="ui-empty-note">Nothing shipped yet.</p>`;
  const items = entries
    .map((e) => {
      const k = e.kind ? KIND_TAG[e.kind] : undefined;
      const head =
        `<div class="ui-changelog-head"><span class="ui-changelog-date">${esc(e.date)}</span>` +
        `${k ? tag({ label: k.label, tone: k.tone }) : ""}</div>`;
      const body = e.itemsHtml?.length
        ? `<div class="ui-changelog-body"><ul>${e.itemsHtml.map((i) => `<li>${i}</li>`).join("")}</ul></div>`
        : `<p class="ui-changelog-body">${esc(e.body ?? "")}</p>`;
      return `<div class="ui-changelog-entry">${head}${body}</div>`;
    })
    .join("");
  return `<div class="ui-changelog">${items}</div>`;
}
