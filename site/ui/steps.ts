import { esc } from "../lib/format";

export interface StepsOptions {
  items: string[];
  current: number;
}

export function steps(opts: StepsOptions): string {
  const cur = Math.min(Math.max(0, opts.current), opts.items.length);
  const parts = opts.items
    .map((label, i) => {
      const state = i < cur ? " is-done" : i === cur ? " is-current" : "";
      const current = i === cur ? ` aria-current="step"` : "";
      return (
        `<div class="ui-step${state}"${current}><div class="ui-step-bar"></div>` +
        `<span class="ui-step-label">${esc(label)}</span></div>`
      );
    })
    .join("");
  return `<div class="ui-steps">${parts}</div>`;
}
