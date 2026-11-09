import { esc } from "../lib/format";
import { icon } from "../lib/icons";
import { card } from "./card";

export interface PlanCardOptions {
  name?: string;
  amount: string;
  period?: string;
  blurb?: string;
  features: string[];
  ctaHtml: string;
  current?: boolean;
  statusHtml?: string;
  bare?: boolean;
}

export function planCard(opts: PlanCardOptions): string {
  const chip = opts.current ? `<span class="ui-plan-chip">Current plan</span>` : "";
  const headEnd = chip + (opts.statusHtml ?? "");
  const period = opts.period ? `<span class="ui-plan-period">${esc(opts.period)}</span>` : "";
  const blurb = opts.blurb ? `<p class="ui-section-hint">${esc(opts.blurb)}</p>` : "";
  const features = opts.features
    .map((f) => `<li>${icon("check")}<span>${esc(f)}</span></li>`)
    .join("");
  const title = opts.name ? `<span class="ui-section-title">${esc(opts.name)}</span>` : "";
  const head = title || headEnd
    ? `<div class="ui-card-head">${title}<span class="ui-card-head-end">${headEnd}</span></div>`
    : "";
  const inner =
    head +
    `<div class="ui-plan-price"><span class="ui-plan-amount">${esc(opts.amount)}</span>${period}</div>` +
    blurb +
    `<ul class="ui-plan-features">${features}</ul>` +
    `<div class="ui-plan-cta">${opts.ctaHtml}</div>`;
  const cls = "ui-plan" + (opts.current ? " is-current" : "");
  if (opts.bare) return `<div class="${cls}">${inner}</div>`;
  return card({ content: inner, className: cls });
}
