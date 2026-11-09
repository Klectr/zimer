/** #731: hosted landing page view. Public, no auth — marketing copy.
 *  Served only to logged-out visitors on GET / in HOSTED mode (see
 *  routes/landing.ts). Self-host mode never shows it (/ keeps bouncing
 *  to /login); authed hosted users fall through to the app.
 *
 *  #1098 rebuild: a marketing surface in the suite's landing language
 *  (hero-glow wash, split hero with the mascot, the product shown
 *  working in a window vignette, demo-led cards, one closing band),
 *  built on the Lobe token scales. The window and card figures are
 *  depictions composed from fictional fixture data (the same world as
 *  the Zandbox stories); the timers in them tick via the inline
 *  script at the foot of the page. Copy stays short and within the
 *  shipped offer: $12/mo + 14-day trial, self-host free forever. */

import { linkButton } from "../ui/button.ts";
import { logoLockup } from "../ui/logo-lockup.ts";
import { statusChip } from "../ui/status-chip.ts";
import { tag } from "../ui/tag.ts";

const MASCOT =
  `<picture>` +
  `<source srcset="/static/mascot.webp" type="image/webp">` +
  `<img class="ui-hero-mascot" src="/static/mascot.png" alt="Klectr the Alien, the Zimer mascot" width="720" height="720" fetchpriority="low">` +
  `</picture>`;

function entry(color: string, name: string, time: string, hot = false): string {
  return `<div class="ui-landing-entry${hot ? " is-running" : ""}"><span class="ui-landing-cdot" style="background:${color}"></span><span>${name}<span class="ui-landing-entry-time">${time}</span></span></div>`;
}

function day(head: string, entries: string, total: string): string {
  return `<div class="ui-landing-day"><div class="ui-landing-day-head">${head}</div>${entries}<div class="ui-landing-day-total">${total}</div></div>`;
}

const RUNNING_BAR =
  `<div class="ui-landing-running"><span class="ui-running-dot"></span><span class="ui-landing-run-name">Acme Studio</span><span class="ui-landing-run-meta">Homepage redesign · started 9:04 AM</span><span class="ui-landing-run-time ui-landing-tick" data-base="8077" data-fmt="hh">02:14:37</span><span class="ui-landing-stop">Stop</span></div>`;

const WINDOW =
  `<div class="ui-landing-window ui-landing-arrive ui-landing-arrive-3">` +
  `<div class="ui-landing-winbar"><span class="ui-landing-dot" style="background:#ff5f57"></span><span class="ui-landing-dot" style="background:#febc2e"></span><span class="ui-landing-dot" style="background:#28c840"></span><span class="ui-landing-wintitle"><b>Zimer</b> · Week of Nov 2 - 8</span></div>` +
  `<div class="ui-landing-winbody">` +
  `<aside class="ui-landing-side">` +
  `<div class="ui-landing-nav">Timer</div>` +
  `<div class="ui-landing-nav is-on">Calendar</div>` +
  `<div class="ui-landing-nav">Zinvoices</div>` +
  `<div class="ui-landing-nav">Manage</div>` +
  `<div class="ui-landing-side-foot"><div class="ui-landing-nav"><span class="ui-running-dot"></span>Acme Studio<span class="ui-landing-tick" data-base="8077" data-fmt="h">2:14:37</span></div></div>` +
  `</aside>` +
  `<div class="ui-landing-winmain">` +
  RUNNING_BAR +
  `<div class="ui-landing-week">` +
  day(`Fri <b>6</b>`, entry("#60a5fa", "Northwind Legal", "9:00 - 1:00") + entry("#fb923c", "Acme Studio", "2:00 - 4:30"), `<b>6h 30m</b>`) +
  day(`Sat <b>7</b>`, entry("#a78bfa", "Harbor Dental", "10:00 - 12:07"), `<b>2h 07m</b>`) +
  day(`Sun <b>8</b>`, entry("#fb923c", "Acme Studio", "9:04 - running", true), `<b>2h 14m</b> · week <b>36h 52m</b>`) +
  `</div></div></div></div>`;

const TIMER_FIG =
  `<div class="ui-landing-fig"><div class="ui-landing-running is-fig"><span class="ui-running-dot"></span><span class="ui-landing-run-name">Northwind Legal</span><span class="ui-landing-run-meta">Contract review</span><span class="ui-landing-run-time ui-landing-tick" data-base="2530" data-fmt="hh">00:42:10</span><span class="ui-landing-stop">Stop</span></div></div>`;

const WEEK_FIG =
  `<div class="ui-landing-fig"><div class="ui-landing-miniweek">` +
  [["Mon", "8h 00m", false], ["Tue", "7h 00m", false], ["Wed", "5h 15m", false], ["Thu", "5h 00m", false], ["Fri", "6h 30m", false], ["Sat", "2h 07m", false], ["Sun", "2h 14m", true]]
    .map(([d, t, hot]) => `<div><div class="ui-landing-day-head">${d}</div><div class="ui-landing-entry${hot ? " is-running" : ""}">${t}</div></div>`)
    .join("") +
  `</div></div>`;

const SHEET_FIG =
  `<div class="ui-landing-fig">` +
  `<div class="ui-landing-sheet-head"><span class="ui-landing-sheet-title">ZINVOICE #1041</span>${statusChip("sent")}</div>` +
  `<div class="ui-landing-sheet-meta">Billed to Northwind Legal · Nov 2, 2026</div>` +
  `<div class="ui-landing-inv-row"><span>Contract review · 10h @ $100/hr</span><span>$1,000.00</span></div>` +
  `<div class="ui-landing-inv-row"><span>Discovery prep · 9h 05m @ $120/hr</span><span>$1,090.00</span></div>` +
  `<div class="ui-landing-inv-total"><span>Total due</span><span>$2,090.00</span></div>` +
  `</div>`;

const TERM_FIG =
  `<div class="ui-landing-fig"><div class="ui-landing-term">` +
  `<div><span class="ui-landing-term-dim">$</span> git clone https://github.com/Klectr/zimer</div>` +
  `<div><span class="ui-landing-term-dim">$</span> cd zimer &amp;&amp; bun site/server.ts</div>` +
  `<div><span class="ui-landing-term-ok">→</span> <span class="ui-landing-term-dim">Zimer running at</span> http://127.0.0.1:3000</div>` +
  `</div></div>`;

function demoCard(title: string, body: string, fig: string): string {
  return `<article class="ui-landing-card"><h3>${title}</h3><p>${body}</p>${fig}</article>`;
}

const TICK_SCRIPT = `<script>
(function () {
  var t0 = Date.now();
  function fmt(sec, mode) {
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = String(m).padStart(2, "0"), ss = String(s).padStart(2, "0");
    return mode === "h" ? h + ":" + mm + ":" + ss : String(h).padStart(2, "0") + ":" + mm + ":" + ss;
  }
  var els = document.querySelectorAll(".ui-landing-tick");
  function tick() {
    var elapsed = Math.floor((Date.now() - t0) / 1000);
    els.forEach(function (el) {
      el.textContent = fmt(parseInt(el.dataset.base, 10) + elapsed, el.dataset.fmt);
    });
  }
  tick();
  setInterval(tick, 1000);
})();
</script>`;

export function createLandingViews(posthogHead?: () => string) {
  function landingPage(origin: string): string {
    const cards =
      demoCard("One-tap Zimer", "Start, stop, and switch projects in a click. Every entry lands on your calendar on its own.", TIMER_FIG) +
      demoCard("Week at a glance", "A Toggl-style week grid. Drag to create, click to edit, see the billable split for every day.", WEEK_FIG) +
      demoCard("Zinvoice in one step", "Pick a date range, adjust the line items, download the PDF. Sent zinvoices freeze as snapshots.", SHEET_FIG) +
      demoCard("Your server, your data", "Self-host free forever: one Bun process, one SQLite file you can copy. Every feature, no account.", TERM_FIG);

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
  <main class="page-landing">
  <header class="ui-landing-top">
  ${logoLockup()}
  ${linkButton({ label: "Sign in", href: "/login" })}
  </header>
  <section class="ui-landing-hero">
  <div>
  ${tag({ label: "Time tracking to zinvoicing", dot: true })}
  <h1 class="ui-landing-h1 ui-landing-arrive ui-landing-arrive-1">The time tracker that turns your hours into an invoice.</h1>
  <p class="ui-landing-herosub ui-landing-arrive ui-landing-arrive-2">Your Zimer is your Zinvoice. Start the Zimer while you work. When the work is done, Zimer turns your tracked hours into a clean Zinvoice you can send in one step.</p>
  <div class="ui-landing-cta ui-landing-arrive ui-landing-arrive-3">${linkButton({ label: "Start free trial", href: "/signup", variant: "primary", size: "lg" })}</div>
  </div>
  <div class="ui-landing-hero-art ui-landing-arrive ui-landing-arrive-2">${MASCOT}</div>
  </section>
  ${WINDOW}
  <section class="ui-landing-section">
  <h2 class="ui-landing-title">Everything from first tap to paid</h2>
  <p class="ui-landing-sub">One app for the whole loop: track the time, send the Zinvoice, watch the money land.</p>
  <div class="ui-landing-cards">${cards}</div>
  </section>
  <section class="ui-landing-join" id="pricing">
  <h2 class="ui-landing-title">Start with your next job</h2>
  <p class="ui-landing-join-copy">Hosted at $12/month flat with a 14-day free trial, or self-host it free forever. No seats, no meters, no per-client pricing. Cancel anytime, and your data goes with you.</p>
  <div class="ui-landing-join-btns">${linkButton({ label: "Start free trial", href: "/signup", variant: "primary", size: "lg" })}${linkButton({ label: "View on GitHub", href: "https://github.com/Klectr/zimer", external: true, size: "lg" })}${linkButton({ label: "Changelog", href: "/changelog", size: "lg" })}</div>
  </section>
  <footer class="ui-landing-foot">
  <span>Zimer: the time tracker that turns your hours into an invoice.</span>
  <span><a href="/terms">License terms</a> · <a href="/privacy">Privacy</a> · <a href="/changelog">Changelog</a> · <a href="mailto:support@klectr.dev">support@klectr.dev</a></span>
  </footer>
  </main>
  ${TICK_SCRIPT}
  </body>
  </html>`;
  }

  return { landingPage };
}
