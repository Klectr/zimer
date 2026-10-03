/** #729: hosted pricing page view. Public, no auth — marketing copy.
 *  One tier: $12/month with a 14-day free trial; self-host stays free
 *  forever as the free tier underneath. CTA adapts to HOSTED mode:
 *  hosted → "Start free trial" (/signup); self-host → free-forever note
 *  (there is no /signup in self-host mode).
 *
 *  Same minimal public chrome as /terms and /changelog: no app nav,
 *  noindex, M3 dark theme, gold #f2c14e for the CTA only. */

import { logo } from "../lib/icons.ts";

export function createPricingViews({ hosted }: { hosted: boolean }) {
  function pricingPage(): string {
    const cta = hosted
      ? `<p class="pricing-cta"><a class="md-filled-button pricing-cta-btn" href="/signup">Start free trial</a></p>`
      : `<p class="muted">You're self-hosting — free forever.</p>`;
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Pricing · Zimer</title>
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script>
  </head>
  <body>
  <main class="page-public page-pricing">
  <h1 class="md-headline-small changelog-title">${logo(28)}<span>Zimer pricing</span></h1>
  <section class="md-card pricing-card">
    <h2 class="md-title-large pricing-plan">Hosted</h2>
    <p class="pricing-price"><span class="pricing-amount">$12</span><span class="muted">/month</span></p>
    <p>14-day free trial, then $12/month. The whole app: timer, calendar, invoices, clients.</p>
    ${cta}
  </section>
  <section class="md-card pricing-card">
    <h2 class="md-title-large pricing-plan">Self-host</h2>
    <p class="pricing-price"><span class="pricing-amount">$0</span><span class="muted"> forever</span></p>
    <p>Run Zimer on your own server. All features, no account, no trial.</p>
  </section>
  <section>
    <h2 class="md-title-large">FAQ</h2>
    <p><strong>What happens when the trial ends?</strong><br>Your subscription starts at $12/month. Cancel before it ends and you're never charged.</p>
    <p><strong>Can I cancel?</strong><br>Anytime, from the customer billing portal.</p>
    <p><strong>Is self-hosting really free?</strong><br>Yes — free forever, all features included.</p>
  </section>
  <p class="muted tiny no-print public-foot"><a href="/terms">License terms</a></p>
  </main>
  </html>`;
  }

  return { pricingPage };
}
