/** #731: hosted landing page view. Public, no auth — marketing copy.
 *  Served only to logged-out visitors on GET / in HOSTED mode (see
 *  routes/landing.ts). Self-host mode never shows it (/ keeps bouncing
 *  to /login); authed hosted users fall through to the app.
 *
 *  Layout follows the suite mock's landing: one centered hero (offer
 *  pill, promise, two CTAs, trial note) with the product working in a
 *  split timer + Zinvoice card below it, a three-card bento, and the
 *  two-plan price grid. The copy stays inside the shipped offer:
 *  $12/month flat + 14-day trial, self-host free forever. */

import { button, linkButton } from "../ui/button.ts";
import { featureCard, heroSection } from "../ui/landing.ts";
import { logoLockup } from "../ui/logo-lockup.ts";
import { planCard } from "../ui/plan-card.ts";
import { tag } from "../ui/tag.ts";

const MINI_PRODUCT =
  `<div class="ui-landing-mini">` +
  `<div class="ui-landing-mini-main">` +
  `<div class="ui-stat-label">Running now</div>` +
  `<div class="ui-landing-mini-title">Acme Studio · Website rebuild</div>` +
  `<div class="ui-landing-mini-sub">Homepage design pass</div>` +
  `<div class="ui-timer ui-timer-sm ui-landing-mini-timer">01:24:08</div>` +
  `<div class="ui-landing-mini-chips">` +
  tag({ label: "$85 / hr", tone: "primary" }) +
  tag({ label: "Billable" }) +
  tag({ label: "Today 5h 12m" }) +
  `</div>` +
  `<div class="ui-landing-mini-actions">` +
  button({ label: "Stop & add to Zinvoice", variant: "primary" }) +
  button({ label: "Pause" }) +
  `</div>` +
  `</div>` +
  `<div class="ui-landing-mini-side">` +
  `<div class="ui-card-head"><span class="ui-section-title">Zinvoice #1042</span>` +
  `<span class="ui-card-head-end">${tag({ label: "Ready", tone: "success" })}</span></div>` +
  `<div class="ui-landing-mini-row"><span>Design · 12.5h</span><span>$1,062.50</span></div>` +
  `<div class="ui-landing-mini-row"><span>Development · 8h</span><span>$680.00</span></div>` +
  `<div class="ui-landing-mini-total"><span>Total due</span><span class="ui-landing-mini-amount">$1,827.50</span></div>` +
  button({ label: "Send Zinvoice", block: true }) +
  `</div>` +
  `</div>`;

const BENTO =
  `<section class="ui-landing-section" id="features">` +
  `<h2 class="ui-landing-title">Everything from first tap to paid</h2>` +
  `<p class="ui-landing-sub">One job, done well: track the time, send the Zinvoice, keep the file.</p>` +
  `<div class="ui-landing-cards">` +
  featureCard({
    icon: "timer",
    title: "Timer to Zinvoice in two clicks",
    body: "Stopped time lands on the draft already priced. No export, no re-typing.",
  }) +
  featureCard({
    icon: "database",
    title: "Your data, your file",
    body: "One SQLite database. Back it up, walk away with it. No lock-in.",
  }) +
  featureCard({
    icon: "card",
    title: "No surveillance",
    body: "No screenshots, no keystrokes, no passive tracking. A Zimer you start, nothing else.",
  }) +
  `</div></section>`;

const PRICING =
  `<section class="ui-landing-pricing" id="pricing">` +
  `<h2 class="ui-landing-title">Start with your next job</h2>` +
  `<p class="ui-landing-sub">Two ways to run it: self-hosted free forever, or hosted at $12/month flat. No seats, no meters, no per-client pricing.</p>` +
  `<div class="ui-landing-plans">` +
  planCard({
    name: "Self-hosted",
    amount: "$0",
    period: "free forever",
    blurb: "Unlimited clients, projects, and Zinvoices.",
    features: [
      "One Bun process and one SQLite file",
      "Every feature, no account",
      "Back up or export any time",
    ],
    ctaHtml: linkButton({
      label: "Download",
      href: "https://github.com/Klectr/zimer",
      external: true,
      block: true,
    }),
  }) +
  planCard({
    name: "Hosted",
    amount: "$12",
    period: "/ month flat",
    blurb: "We run it. No per-seat math, early rate locked.",
    features: [
      "Everything in self-hosted",
      "Automatic backups",
      "14-day free trial, no card",
    ],
    ctaHtml: linkButton({
      label: "Start trial",
      href: "/signup",
      variant: "primary",
      block: true,
    }),
  }) +
  `</div>` +
  `<p class="ui-landing-offer">14-day free trial, no card. Cancel keeps your data. $12/month flat.</p>` +
  `</section>`;

export function createLandingViews(posthogHead?: () => string) {
  function landingPage(origin: string): string {
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
  <script src="/static/utm.js" defer></script>
  ${posthogHead ? posthogHead() : ""}
  </head>
  <body class="ui-landing-body">
  <header class="ui-landing-top">
  <div class="ui-landing-top-in">
  <div class="ui-landing-brand">
  ${logoLockup()}
  <img class="ui-hero-mascot" src="/static/mascot.png" alt="" width="28" height="28" style="width:28px;height:28px;border-radius:50%;object-fit:cover">
  </div>
  <div class="ui-landing-top-actions">
  ${linkButton({ label: "View on GitHub", href: "https://github.com/Klectr/zimer", external: true })}
  ${linkButton({ label: "Sign in", href: "/login" })}
  </div>
  </div>
  </header>
  <main class="page-landing">
  ${heroSection({
    tagLine: "Free forever self-hosted · $12/mo hosted",
    title: "Your Zimer is your Zinvoice.",
    sub: "Start a Zimer. Stop it. Send the Zinvoice. Two clicks, no seats, no meters, no surveillance, and your data stays in your SQLite file.",
    actionsHtml:
      linkButton({ label: "Start tracking free", href: "/signup", variant: "primary", size: "lg" }) +
      linkButton({ label: "See how it works", href: "#features", size: "lg" }),
    note: "14-day trial, no card. Cancel keeps your data.",
    productHtml: MINI_PRODUCT,
  })}
  ${BENTO}
  ${PRICING}
  <footer class="ui-landing-foot">
  <span>The time tracker that turns your hours into an invoice.</span>
  <span><a href="/terms">License terms</a> · <a href="/privacy">Privacy</a> · <a href="/changelog">Changelog</a> · <a href="mailto:support@klectr.dev">support@klectr.dev</a></span>
  </footer>
  </main>
  </body>
  </html>`;
  }

  return { landingPage };
}
