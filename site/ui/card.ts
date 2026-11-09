import { esc } from "../lib/format";

export interface CardOptions {
  content: string;
  tracking?: boolean;
  className?: string;
  id?: string;
}

export function card(opts: CardOptions): string {
  const cls = "ui-card" + (opts.tracking ? " tracking" : "") + (opts.className ? ` ${opts.className}` : "");
  const id = opts.id ? ` id="${esc(opts.id)}"` : "";
  return `<div class="${cls}"${id}>${opts.content}</div>`;
}
