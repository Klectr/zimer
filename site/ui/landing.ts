import { esc } from "../lib/format";
import { icon } from "../lib/icons";

type IconName = Parameters<typeof icon>[0];
import { card } from "./card";
import { tag } from "./tag";

export interface HeroSectionOptions {
  tagLine: string;
  title: string;
  sub: string;
  actionsHtml: string;
  note?: string;
  productHtml?: string;
}

export function heroSection(opts: HeroSectionOptions): string {
  const note = opts.note ? `<p class="ui-hero-note">${esc(opts.note)}</p>` : "";
  const product = opts.productHtml ? `<div class="ui-hero-product">${opts.productHtml}</div>` : "";
  return (
    `<section class="ui-hero">` +
    tag({ label: opts.tagLine, tone: "neutral", dot: true }) +
    `<h1 class="ui-hero-title">${esc(opts.title)}</h1>` +
    `<p class="ui-hero-sub">${esc(opts.sub)}</p>` +
    `<div class="ui-hero-actions">${opts.actionsHtml}</div>${note}${product}</section>`
  );
}

export interface FeatureCardOptions {
  icon: IconName;
  title: string;
  body: string;
  bodyHtml?: string;
}

export function featureCard(opts: FeatureCardOptions): string {
  const body = opts.body ? `<p class="ui-feature-body">${esc(opts.body)}</p>` : "";
  const inner =
    `<div class="ui-feature-icon">${icon(opts.icon)}</div>` +
    `<h3 class="ui-section-title">${esc(opts.title)}</h3>` +
    body +
    (opts.bodyHtml ?? "");
  return card({ content: inner, className: "ui-feature" });
}
