import type { Story } from "../.zandbox/story";
import { featureCard, landingSection, productPreview } from "../site/ui/landing";
import { docSections, publicFoot } from "../site/ui/doc-sections";
import { button } from "../site/ui/button";
import { tag } from "../site/ui/tag";

/* Fictional data only. */
export const publicPagesStories: Story[] = [
  {
    id: "public-product-preview",
    group: "Public pages",
    title: "Landing — product preview (running Zimer + Zinvoice)",
    render: () => `<div style="max-width:880px">` + productPreview({
      running: {
        title: "Harbor Dental · Website rebuild", sub: "Homepage design pass", elapsed: "01:24:08",
        chipsHtml: tag({ label: "$120 / hr", tone: "primary" }) + tag({ label: "Billable" }) + tag({ label: "Today 5h 12m" }),
        actionsHtml: button({ label: "Stop & add to Zinvoice", variant: "primary" }) + button({ label: "Pause" }),
      },
      zinvoice: {
        title: "Zinvoice #1042", chipHtml: tag({ label: "Ready", tone: "success" }),
        lines: [{ label: "Design · 12.5h", amount: "$1,500.00" }, { label: "Development · 8h", amount: "$960.00" }],
        total: "$2,460.00", actionHtml: button({ label: "Send Zinvoice", block: true }),
      },
    }) + `</div>`,
  },
  {
    id: "public-landing-section",
    group: "Public pages",
    title: "Landing — section and pricing variant",
    render: () => `<div style="max-width:960px">` +
      landingSection({
        id: "story-features", title: "Everything from first tap to paid", sub: "One job, done well: track the time, send the Zinvoice, keep the file.",
        bodyHtml: `<div class="ui-landing-cards">` +
          featureCard({ icon: "timer", title: "Timer to Zinvoice in two clicks", body: "Stopped time lands on the draft already priced." }) +
          featureCard({ icon: "database", title: "Your data, your file", body: "One SQLite database. Back it up, walk away with it." }) +
          featureCard({ icon: "card", title: "No surveillance", body: "A Zimer you start, nothing else." }) + `</div>`,
      }) +
      landingSection({ id: "story-pricing", variant: "pricing", title: "Start with your next job", sub: "Self-hosted free forever, or hosted at $12/month flat.", bodyHtml: "", note: "14-day free trial, no card. Cancel keeps your data." }) +
      `</div>`,
  },
  {
    id: "public-doc-sections",
    group: "Public pages",
    title: "Privacy / terms — sections and footer",
    render: () => `<main class="page-public page-changelog" style="margin:0">` +
      docSections([
        { heading: "What we store", body: "Your clients, projects, time entries and Zinvoices — nothing else." },
        { heading: "Analytics", html: true, body: "The hosted site uses <a href=\"#\">a product analytics tool</a>. Self-hosted instances send us nothing." },
        { heading: "Deletion", body: "Email support from your account address and we'll delete everything." },
      ]) +
      publicFoot([{ label: "Changelog", href: "#" }, { label: "Terms", href: "#" }]) +
      `</main>`,
  },
];
