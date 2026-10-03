/** #731: hosted landing page view. Public, no auth — marketing copy.
 *  Served only to logged-out visitors on GET / in HOSTED mode (see
 *  routes/landing.ts). Self-host mode never shows it (/ keeps bouncing
 *  to /login); authed hosted users fall through to the app.
 *
 *  Same minimal public chrome as /pricing: no app nav, noindex, M3 dark
 *  theme, gold #f2c14e for the CTA only, no emoji. Copy stays short:
 *  headline, what it does, $12/mo + 14-day trial, CTA to /signup. */

import { logo } from "../lib/icons.ts";

export function createLandingViews() {
  function landingPage(): string {
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Zimer: your timer is your invoice</title>
  <meta name="description" content="Self-hosted time tracking for invoicing. Track your time, hit one button, send the invoice. $12/month with a 14-day free trial.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/svg+xml" href="/static/logo.svg">
  <script src="/static/motion.js" defer></script>
  </head>
  <body>
  <main class="page-landing">
  <h1 class="landing-brand">${logo(32)}<span>Zimer</span></h1>
  <p class="md-headline-small landing-headline">Your timer is your invoice.</p>
  <p class="md-body-medium landing-sub">Time tracking for invoicing. Track your time, hit one button, send the invoice.</p>
  <p class="landing-price"><strong>$12/month.</strong> 14-day free trial. Cancel anytime.</p>
  <p class="landing-cta"><a class="md-filled-button landing-cta-btn" href="/signup">Start free trial</a></p>
  <p><a href="/pricing">See pricing</a></p>
  <p class="muted landing-selfhost">Prefer to run it yourself? Self-host is free forever.</p>
  <p class="muted tiny public-foot landing-foot"><a href="/pricing">Pricing</a> · <a href="/terms">License terms</a> · <a href="/privacy">Privacy</a> · <a href="/changelog">Changelog</a></p>
  <p class="muted tiny landing-support">Questions: <a href="mailto:support@klectr.dev">support@klectr.dev</a></p>
  </main>
  </html>`;
  }

  return { landingPage };
}
