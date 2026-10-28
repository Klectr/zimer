/** #731: hosted landing page view. Public, no auth — marketing copy.
 *  Served only to logged-out visitors on GET / in HOSTED mode (see
 *  routes/landing.ts). Self-host mode never shows it (/ keeps bouncing
 *  to /login); authed hosted users fall through to the app.
 *
 *  Same minimal public chrome as /pricing: no app nav, M3 dark
 *  theme, pumpkin #fb923c for the CTA only, no emoji. Copy stays short:
 *  headline, what it does, $12/mo + 14-day trial, CTA to /signup. */

import { icon, logo } from "../lib/icons.ts";

export function createLandingViews(posthogHead?: () => string) {
  function landingPage(origin: string): string {
    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="${origin}/">
  <title>Zimer: the time tracker that turns your hours into an invoice</title>
  <meta name="description" content="Self-hosted time tracking for zinvoicing. Track your time, hit one button, send the Zinvoice. $12/month with a 14-day free trial.">
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32.png">
  <link rel="apple-touch-icon" href="/static/alien-180.png">
  <meta property="og:title" content="Zimer: the time tracker that turns your hours into an invoice">
  <meta property="og:description" content="Track your time, hit one button, send the Zinvoice. $12/month with a 14-day free trial.">
  <meta property="og:image" content="${origin}/static/og-image-v2.png">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Klectr the alien with a laptop beside the headline 'Turn your hours into an invoice.'">
  <meta property="og:url" content="${origin}/">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${origin}/static/og-image-v2.png">
  <meta name="twitter:image:alt" content="Klectr the alien with a laptop beside the headline 'Turn your hours into an invoice.'">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Zimer","url":"${origin}/","logo":"${origin}/static/alien-180.png","sameAs":["https://github.com/Klectr/zimer"]},{"@type":"WebSite","name":"Zimer","url":"${origin}/"}]}
  </script>
  <script src="/static/motion.js" defer></script>
  <script src="/static/utm.js" defer></script>
  ${posthogHead ? posthogHead() : ""}
  </head>
  <body>
  <main class="page-landing">
  <header class="landing-topbar">
  <p class="landing-brand">${logo(28)}<span>Zimer</span></p>
  <a class="md-text-button landing-signin" href="/login">Sign in</a>
  </header>
  <section class="landing-hero">
  <div class="landing-hero-copy" data-enter>
  <p class="landing-eyebrow"><span class="landing-eyebrow-dot" aria-hidden="true"></span>Time tracking to zinvoicing</p>
  <h1 class="landing-headline">The time tracker that turns your hours into an invoice.</h1>
  <p class="landing-sub">Your Zimer is your Zinvoice. Start the Zimer while you work. When the work is done, Zimer turns your tracked hours into a clean Zinvoice you can send in one step.</p>
  <div class="landing-cta-row">
  <a class="md-filled-button landing-cta-btn" href="/signup">Start free trial</a>
  <a class="md-text-button landing-text-btn" href="#pricing">See pricing</a>
  </div>
  <p class="muted landing-price"><strong>$12/month.</strong> 14-day free trial. Cancel anytime.</p>
  <p class="muted landing-selfhost">Prefer to run it yourself? Self-host is free forever.</p>
  </div>
  <div class="landing-hero-visual" data-enter="2">
  <picture>
  <source srcset="/static/mascot.webp" type="image/webp">
  <img class="landing-mascot" src="/static/mascot.png" alt="Klectr the Alien, the Zimer mascot" width="720" height="720" fetchpriority="low">
  </picture>
  </div>
  <figure class="landing-shot" data-enter="3">
  <img src="/static/app-shot.webp" alt="The Zimer app on a phone: this week's tracked time by day, with totals per client and a Zinvoice this week button" width="780" height="1688" fetchpriority="high">
  </figure>
  </section>
  <section class="landing-section" data-enter="4">
  <h2 class="landing-section-title">Everything from first tap to paid</h2>
  <p class="muted landing-section-sub">One app for the whole loop: track the time, send the Zinvoice, watch the money land.</p>
  <div class="landing-feature-grid">
  <article class="landing-feature">
  <span class="landing-feature-icon">${icon("timer")}</span>
  <h3 class="landing-feature-title">One-tap Zimer</h3>
  <p class="md-body-medium muted">Start, stop, and switch projects in a click. Every entry lands on your calendar on its own.</p>
  </article>
  <article class="landing-feature">
  <span class="landing-feature-icon">${icon("calendar")}</span>
  <h3 class="landing-feature-title">Week at a glance</h3>
  <p class="md-body-medium muted">A Toggl-style week grid. Drag to create, click to edit, see the billable split for every day.</p>
  </article>
  <article class="landing-feature">
  <span class="landing-feature-icon">${icon("receipt")}</span>
  <h3 class="landing-feature-title">Zinvoice in one step</h3>
  <p class="md-body-medium muted">Pick a date range, adjust the line items, download the PDF. Sent zinvoices freeze as snapshots.</p>
  </article>
  <article class="landing-feature">
  <span class="landing-feature-icon">${icon("group")}</span>
  <h3 class="landing-feature-title">Clients and rates</h3>
  <p class="md-body-medium muted">Keep clients, projects, and rates in one place, with revenue broken down per client.</p>
  </article>
  </div>
  </section>
  <section class="landing-section" id="pricing" data-enter="5">
  <h2 class="landing-section-title">Simple, honest pricing</h2>
  <p class="muted landing-section-sub">Hosted for $12 a month, or self-host it for nothing. Both get the whole app.</p>
  <div class="landing-plan-grid">
  <article class="landing-plan landing-plan-featured">
  <p class="landing-plan-label">Hosted</p>
  <p class="landing-plan-price"><span class="landing-plan-amount">$12</span><span class="muted">/month</span></p>
  <p class="md-body-medium landing-plan-copy">Your own workspace on our servers. Nothing to run, nothing to maintain.</p>
  <ul class="landing-plan-list">
  <li>${icon("check")}<span>14-day free trial, no card up front</span></li>
  <li>${icon("check")}<span>Zimer, calendar, zinvoices, clients</span></li>
  <li>${icon("check")}<span>Cancel anytime</span></li>
  </ul>
  <a class="md-filled-button landing-cta-btn" href="/signup">Start free trial</a>
  </article>
  <article class="landing-plan">
  <p class="landing-plan-label">Self-host</p>
  <p class="landing-plan-price"><span class="landing-plan-amount">$0</span><span class="muted"> forever</span></p>
  <p class="md-body-medium landing-plan-copy">One Bun process and one SQLite file on your own server. Your data never leaves it.</p>
  <ul class="landing-plan-list">
  <li>${icon("check")}<span>Every feature, no account</span></li>
  <li>${icon("check")}<span>Browser extension included</span></li>
  <li>${icon("check")}<span>Back up by copying one file</span></li>
  </ul>
  <a class="md-text-button landing-cta-btn" href="https://github.com/Klectr/zimer" target="_blank" rel="noopener">View on GitHub</a>
  </article>
  </div>
  </section>
  <footer class="landing-foot">
  <p class="muted tiny landing-foot-links"><a href="/terms">License terms</a> · <a href="/privacy">Privacy</a> · <a href="/changelog">Changelog</a></p>
  <p class="muted tiny landing-support">Questions: <a href="mailto:support@klectr.dev">support@klectr.dev</a></p>
  </footer>
  </main>
  </body>
  </html>`;
  }

  return { landingPage };
}
