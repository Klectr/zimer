import { esc } from "../lib/format";

export type TagTone = "neutral" | "success" | "info" | "warning" | "error" | "primary";

export interface TagOptions {
  label: string;
  tone?: TagTone;
  dot?: boolean;
}

export function tag(opts: TagOptions): string {
  const tone = opts.tone ?? "neutral";
  const dot = opts.dot ? `<span class="ui-tag-dot"></span>` : "";
  return `<span class="ui-tag ui-tag-${tone}">${dot}${esc(opts.label)}</span>`;
}
