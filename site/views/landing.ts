/** #731: hosted landing page view. Public, no auth — marketing copy.
 *  Served only to logged-out visitors on GET / in HOSTED mode (see
 *  routes/landing.ts). Self-host mode never shows it (/ keeps bouncing
 *  to /login); authed hosted users fall through to the app.
 *
 *  Composed from the site/ui library (heroSection, featureCard,
 *  planCard, logoLockup, linkButton). Copy stays short: headline, what
 *  it does, $12/mo + 14-day trial, CTA to /signup. */

import { linkButton } from "../ui/button.ts";
import { featureCard, heroSection } from "../ui/landing.ts";
import { logoLockup } from "../ui/logo-lockup.ts";
import { planCard } from "../ui/plan-card.ts";

export function createLandingViews(posthogHead?: () => string) {
  function landingPage(origin: string): string {
    const hero = heroSection({
      tagLine: "Time tracking to zinvoicing",
      title: "The time tracker that turns your hours into an invoice.",
      sub: "Your Zimer is your Zinvoice. Start the Zimer while you work. When the work is done, Zimer turns your tracked hours into a clean Zinvoice you can send in one step.",
      actionsHtml:
        linkButton({ label: "Start free trial", href: "/signup", variant: "primary", size: "lg" }) +
        linkButton({ label: "See pricing", href: "#pricing", size: "lg" }),
      note: "$12/month. 14-day free trial. Cancel anytime. Prefer to run it yourself? Self-host is free forever.",
      productHtml:
        `<div class="ui-hero-mascot-wrap"><picture>` +
        `<source srcset="/static/mascot.webp" type="image/webp">` +
        `<img class="ui-hero-mascot" src="/static/mascot.png" alt="Klectr the Alien, the Zimer mascot" width="720" height="720" fetchpriority="low">` +
        `</picture></div>` +
        `<figure class="ui-hero-shot"><img src="/static/app-shot.webp" alt="The Zimer app on a phone: this week's tracked time by day, with totals per client and a Zinvoice this week button" width="780" height="1688" fetchpriority="high"></figure>`,
    });

    const featuresA =
      featureCard({ icon: "timer", title: "One-tap Zimer", body: "Start, stop, and switch projects in a click. Every entry lands on your calendar on its own." }) +
      featureCard({ icon: "calendar", title: "Week at a glance", body: "A Toggl-style week grid. Drag to create, click to edit, see the billable split for every day." }) +
      featureCard({ icon: "receipt", title: "Zinvoice in one step", body: "Pick a date range, adjust the line items, download the PDF. Sent zinvoices freeze as snapshots." }) +
      featureCard({ icon: "group", title: "Clients and rates", body: "Keep clients, projects, and rates in one place, with revenue broken down per client." });

    const featuresB =
      featureCard({ icon: "timer", title: "For one-person businesses", body: "Freelancers, contractors, and solo shops. No team seats, no payroll, no admin console to learn." }) +
      featureCard({ icon: "database", title: "Your data stays yours", body: "Self-hosted time tracking on your own server, in one SQLite file you can copy. On hosted, your data is never sold, never shared with advertisers, and never used to track you around the web." }) +
      featureCard({ icon: "card", title: "The bill stays the same", body: "Flat $12 a month. No per-seat pricing, no per-client meters. One tier, everything included." }) +
      featureCard({ icon: "bolt", title: "Switching takes minutes", body: "Coming from Toggl or a spreadsheet? Start fresh in minutes: add your clients, set your rates, start the Zimer." });

    const plans =
      planCard({
        name: "Hosted",
        amount: "$12",
        period: "/month",
        blurb: "Your own workspace on our servers. Nothing to run, nothing to maintain.",
        features: ["14-day free trial, no card up front", "Zimer, calendar, zinvoices, clients", "Cancel anytime"],
        ctaHtml: linkButton({ label: "Start free trial", href: "/signup", variant: "primary", block: true }),
      }) +
      planCard({
        name: "Self-host",
        amount: "$0",
        period: "forever",
        blurb: "One Bun process and one SQLite file on your own server. Your data never leaves it.",
        features: ["Every feature, no account", "Browser extension included", "Back up by copying one file"],
        ctaHtml: linkButton({ label: "View on GitHub", href: "https://github.com/Klectr/zimer", external: true, block: true }),
      });

    return `<!DOCTYPE html>
  <html lang="en">
  <head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="${origin}/">
  <title>Zimer: the time tracker that turns your hours into an invoice</title>
  <meta name="description" content="Time tracking for freelancers and solo work that turns hours into an invoice. Self-host it free forever, or hosted at $12/month flat with a 14-day free trial.">
  <link rel="stylesheet" href="/static/style.css">
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32.png">
  <link rel="apple-touch-icon" href="/static/alien-180.png">
  <meta property="og:title" content="Zimer: the time tracker that turns your hours into an invoice">
  <meta property="og:description" content="Time tracking for freelancers and solo work that turns hours into an invoice. Self-host it free forever, or hosted at $12/month flat with a 14-day free trial.">
  <meta property="og:image" content="${origin}/static/og-image-v3.png">
  <meta property="og:image:type" content="image/png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="Klectr the alien with a clock and books beside the headline 'Turn your hours into an invoice.'">
  <meta property="og:url" content="${origin}/">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="${origin}/static/og-image-v3.png">
  <meta name="twitter:image:alt" content="Klectr the alien with a clock and books beside the headline 'Turn your hours into an invoice.'">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Zimer","url":"${origin}/","logo":"${origin}/static/alien-180.png","sameAs":["https://github.com/Klectr/zimer"]},{"@type":"WebSite","name":"Zimer","url":"${origin}/"}]}
  </script>
  <script src="/static/motion.js" defer></script>
  <script src="/static/utm.js" defer></script>
  ${posthogHead ? posthogHead() : ""}
  </head>
  <body>
  <main class="page-landing">
  <header class="ui-landing-top">
  ${logoLockup()}
  ${linkButton({ label: "Sign in", href: "/login" })}
  </header>
  <div data-enter>${hero}</div>
  <section class="ui-landing-section" data-enter="4">
  <h2 class="ui-landing-title">Everything from first tap to paid</h2>
  <p class="ui-landing-sub">One app for the whole loop: track the time, send the Zinvoice, watch the money land.</p>
  <div class="ui-landing-grid">${featuresA}</div>
  </section>
  <section class="ui-landing-section" data-enter="5">
  <h2 class="ui-landing-title">Built for freelancers and solo work</h2>
  <p class="ui-landing-sub">Most time trackers are built for teams and payroll departments. Zimer is built for one person who bills by the hour.</p>
  <div class="ui-landing-grid">${featuresB}</div>
  </section>
  <section class="ui-landing-section" id="pricing" data-enter="6">
  <h2 class="ui-landing-title">Simple, honest pricing</h2>
  <p class="ui-landing-sub">Hosted for $12 a month, or self-host it for nothing. Both get the whole app.</p>
  <div class="ui-landing-plans">${plans}</div>
  </section>
  <footer class="ui-landing-foot">
  <p class="muted tiny ui-landing-foot-links"><a href="/terms">License terms</a> · <a href="/privacy">Privacy</a> · <a href="/changelog">Changelog</a></p>
  <p class="muted tiny ui-landing-support">Questions: <a href="mailto:support@klectr.dev">support@klectr.dev</a></p>
  </footer>
  </main>
  </body>
  </html>`;
  }

  return { landingPage };
}
