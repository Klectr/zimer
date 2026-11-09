import { esc } from "../lib/format";
import { icon } from "../lib/icons";
import { card } from "./card";

export interface PlanCardOptions {
  name: string;
  amount: string;
  period?: string;
  blurb?: string;
  features: string[];
  ctaHtml: string;
  current?: boolean;
  statusHtml?: string;
}

export function planCard(opts: PlanCardOptions): string {
  const chip = opts.current ? `<span class="ui-plan-chip">Current plan</span>` : "";
  const headEnd = chip + (opts.statusHtml ?? "");
  const period = opts.period ? `<span class="ui-plan-period">${esc(opts.period)}</span>` : "";
  const blurb = opts.blurb ? `<p class="ui-section-hint">${esc(opts.blurb)}</p>` : "";
  const features = opts.features
    .map((f) => `<li>${icon("check")}<span>${esc(f)}</span></li>`)
    .join("");
  const inner =
    `<div class="ui-card-head"><span class="ui-section-title">${esc(opts.name)}</span><span class="ui-card-head-end">${headEnd}</span></div>` +
    `<div class="ui-plan-price"><span class="ui-plan-amount">${esc(opts.amount)}</span>${period}</div>` +
    blurb +
    `<ul class="ui-plan-features">${features}</ul>` +
    `<div class="ui-plan-cta">${opts.ctaHtml}</div>`;
  return card({ content: inner, className: "ui-plan" + (opts.current ? " is-current" : "") });
}
