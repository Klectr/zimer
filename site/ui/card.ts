import { esc } from "../lib/format";

export interface CardOptions {
  content: string;
  tracking?: boolean;
  id?: string;
}

export function card(opts: CardOptions): string {
  const cls = "md-card" + (opts.tracking ? " tracking" : "");
  const id = opts.id ? ` id="${esc(opts.id)}"` : "";
  return `<div class="${cls}"${id}>${opts.content}</div>`;
}
