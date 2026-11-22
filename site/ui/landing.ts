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

/** A landing section: centred title + sub over its body (the bento, the
 *  plans). "pricing" adds the plans' spacing and an offer line under them. */
export interface LandingSectionOptions {
  id: string;
  title: string;
  sub: string;
  bodyHtml: string;
  variant?: "pricing";
  /** e.g. the trial offer under the plans. */
  note?: string;
}

export function landingSection(o: LandingSectionOptions): string {
  const cls = o.variant === "pricing" ? "ui-landing-pricing" : "ui-landing-section";
  return `<section class="${cls}" id="${esc(o.id)}">` +
    `<h2 class="ui-landing-title">${esc(o.title)}</h2>` +
    `<p class="ui-landing-sub">${esc(o.sub)}</p>` +
    o.bodyHtml +
    (o.note ? `<p class="ui-landing-offer">${esc(o.note)}</p>` : "") +
    `</section>`;
}

/** The hero's product shot, as real UI: a running Zimer beside the Zinvoice
 *  it's filling. Static (fictional) — no clock, no actions wired. */
export interface ProductPreviewOptions {
  running: { title: string; sub: string; elapsed: string; chipsHtml: string; actionsHtml: string };
  zinvoice: { title: string; chipHtml: string; lines: { label: string; amount: string }[]; total: string; actionHtml: string };
}

export function productPreview(o: ProductPreviewOptions): string {
  const r = o.running, z = o.zinvoice;
  return `<div class="ui-landing-mini">` +
    `<div class="ui-landing-mini-main">` +
    `<div class="ui-stat-label">Running now</div>` +
    `<div class="ui-landing-mini-title">${esc(r.title)}</div>` +
    `<div class="ui-landing-mini-sub">${esc(r.sub)}</div>` +
    `<div class="ui-timer ui-timer-sm ui-landing-mini-timer">${esc(r.elapsed)}</div>` +
    `<div class="ui-landing-mini-chips">${r.chipsHtml}</div>` +
    `<div class="ui-landing-mini-actions">${r.actionsHtml}</div>` +
    `</div>` +
    `<div class="ui-landing-mini-side">` +
    `<div class="ui-card-head"><span class="ui-section-title">${esc(z.title)}</span>` +
    `<span class="ui-card-head-end">${z.chipHtml}</span></div>` +
    z.lines.map((l) => `<div class="ui-landing-mini-row"><span>${esc(l.label)}</span><span>${esc(l.amount)}</span></div>`).join("") +
    `<div class="ui-landing-mini-total"><span>Total due</span><span class="ui-landing-mini-amount">${esc(z.total)}</span></div>` +
    z.actionHtml +
    `</div>` +
    `</div>`;
}
