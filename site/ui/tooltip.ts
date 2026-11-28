import { esc } from "../lib/format";

export interface TooltipOptions {
  id: string;
  label: string;
  placement?: "top" | "bottom";
  align?: "center" | "end" | "start";
  contentHtml: string;
}

export function tooltip(opts: TooltipOptions): string {
  const placement = opts.placement === "bottom" ? " is-bottom" : "";
  const align = opts.align === "end" ? " is-align-end" : opts.align === "start" ? " is-align-start" : "";
  return (
    `<span class="ui-tooltip${placement}${align}">` +
    `<span class="ui-tooltip-bubble" role="tooltip" id="${esc(opts.id)}">${esc(opts.label)}</span>` +
    `${opts.contentHtml}</span>`
  );
}
