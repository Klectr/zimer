import type { Story } from "../.zandbox/story";
import { appSidebar } from "../site/ui/app-sidebar";
import { appHeader } from "../site/ui/app-header";
import { button, linkButton } from "../site/ui/button";
import { card } from "../site/ui/card";
import { tag } from "../site/ui/tag";
import { timerPanel } from "../site/ui/timer-display";
import { statBlock } from "../site/ui/stat";
import { progressBar } from "../site/ui/progress";
import { steps } from "../site/ui/steps";
import { entryRow, clientRow } from "../site/ui/rows";
import { icon } from "../site/lib/icons";
import { lineItemsTable } from "../site/ui/line-items";
import { statusChip } from "../site/ui/status-chip";
import { weekView, type WeekDay } from "../site/ui/week-view";
import { authCard } from "../site/ui/auth-card";
import { textField, selectField } from "../site/ui/field";
import { settingsSection } from "../site/ui/settings-section";
import { planCard } from "../site/ui/plan-card";
import { formSection, unbilledTable, invoiceSummary } from "../site/ui/zinvoice-form";
import { filterChips } from "../site/ui/filter-chips";
import { publicInvoice } from "../site/ui/public-invoice";
import { extensionPopup } from "../site/ui/extension-popup";
import { timerDisplay } from "../site/ui/timer-display";
import { changelogList } from "../site/ui/changelog";
import { heroSection, featureCard } from "../site/ui/landing";

const NAV = [
  { key: "timer", href: "/", label: "Zimer", icon: "timer" as const },
  { key: "calendar", href: "/calendar", label: "Calendar", icon: "calendar" as const },
  { key: "invoices", href: "/invoices", label: "Zinvoices", icon: "receipt" as const },
  { key: "manage", href: "/manage", label: "Clients", icon: "group" as const },
  { key: "settings", href: "/settings", label: "Settings", icon: "settings" as const },
];

function frame(active: string, title: string, sub: string, actions: string, content: string): string {
  return (
    `<div style="display:flex;min-height:600px;border:1px solid var(--color-border-secondary);border-radius:12px;overflow:hidden">` +
    appSidebar({ items: NAV, active, footer: `<div style="padding:4px 10px;font-size:var(--font-size-sm)"><div>Studio account</div><div style="color:var(--color-text-tertiary);margin-top:2px">Hosted · $12/mo</div></div>` }) +
    `<div style="flex:1;min-width:0;padding:20px;display:flex;flex-direction:column;gap:16px">` +
    appHeader({ title, sub, actions }) +
    content +
    `</div></div>`
  );
}

const runningTag = () => tag({ label: "Running", tone: "success", dot: true });
const runningPanel = () =>
  timerPanel({
    running: true,
    statusHtml: runningTag(),
    context: "Acme Studio — Website rebuild · Homepage design pass",
    startedLabel: "Started 9:04 AM",
    startedAt: "2026-11-08T09:04:00",
    elapsed: "01:24:08",
    metaHtml: tag({ label: "$85 / hr", tone: "primary" }) + tag({ label: "Billable" }) + tag({ label: "Worth $119.19 so far" }),
    actionsHtml: button({ label: "Stop", variant: "primary" }) + button({ label: "Pause" }),
  });

const WEEK: WeekDay[] = [
  { weekday: "Mon", dateLabel: "Nov 2", total: "6h 30m", entries: [{ title: "Acme — Design", meta: "Homepage pass", duration: "4h 00m" }, { title: "Northwind — Intake", meta: "Form fixes", duration: "2h 30m" }] },
  { weekday: "Tue", dateLabel: "Nov 3", total: "7h 15m", entries: [{ title: "Acme — Design", meta: "Build", duration: "5h 15m" }, { title: "Bluefin — Menu site", meta: "Layout", duration: "2h 00m" }] },
  { weekday: "Wed", dateLabel: "Nov 4", total: "5h 45m", entries: [{ title: "Northwind — Dashboard", meta: "Case list", duration: "5h 45m", invoiced: true }] },
  { weekday: "Thu", dateLabel: "Nov 5", total: "8h 00m", entries: [{ title: "Northwind — Dashboard", meta: "Shipped #1041", duration: "8h 00m", invoiced: true }] },
  { weekday: "Fri", dateLabel: "Nov 6", total: "4h 10m", entries: [{ title: "Acme — Review", meta: "Client call", duration: "1h 00m" }, { title: "Harbor — Booking", meta: "Page draft", duration: "3h 10m" }] },
  { weekday: "Sat", dateLabel: "Nov 7", total: "0h", entries: [] },
  {
    weekday: "Sun", dateLabel: "Nov 8", total: "5h 12m", isToday: true, logHref: "/",
    entries: [
      { title: "Acme — Homepage pass", meta: "Running now", duration: "1h 24m", running: true },
      { title: "Acme — Design", meta: "Homepage pass", duration: "3h 48m" },
    ],
  },
];

export const pagesStories: Story[] = [
  {
    id: "page-landing",
    group: "Pages",
    title: "Landing",
    render: () =>
      heroSection({
        tagLine: "Free forever self-hosted · $12/mo hosted",
        title: "Your Zimer is your Zinvoice.",
        sub: "Start a Zimer. Stop it. Send the Zinvoice. Two clicks, no seats, no meters, no surveillance — your data stays in your SQLite file.",
        actionsHtml: button({ label: "Start tracking — free", variant: "primary", size: "lg" }) + linkButton({ label: "See how it works", href: "#features", size: "lg" }),
        note: "14-day trial, no card. Cancel keeps your data.",
        productHtml: runningPanel(),
      }) +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:880px;margin:24px auto 0">` +
      featureCard({ icon: "timer", title: "One job, done well", body: "Timer to Zinvoice in two clicks. No projects-within-projects, no passive tracking watching your screen." }) +
      featureCard({ icon: "card", title: "Pricing you can trust", body: "Free forever self-hosted, or flat $12/mo hosted. No seats, no meters, no surprise tier." }) +
      featureCard({ icon: "database", title: "Your data stays yours", body: "One SQLite file holds everything. Export or back up any time — leaving is allowed, so the exports actually work." }) +
      `</div>` +
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:720px;margin:24px auto 32px">` +
      planCard({ name: "Self-host", amount: "$0", period: "forever", features: ["Unlimited clients, projects, and Zinvoices", "Full data ownership — export any time"], ctaHtml: button({ label: "Read the install guide", block: true }) }) +
      planCard({ name: "Hosted", amount: "$12", period: "/ month · flat, no seats", features: ["Everything in self-host", "Automatic backups", "14-day trial, no card"], ctaHtml: button({ label: "Start free trial", variant: "primary", block: true }) }) +
      `</div>`,
  },
  {
    id: "page-login",
    group: "Pages",
    title: "Login",
    render: () =>
      `<div style="padding:40px 0">` +
      authCard({
        action: "/login",
        headingLevel: 1,
        title: "Welcome back",
        sub: "Log in to your timers and Zinvoices.",
        fieldsHtml:
          textField({ id: "pg-auth-email", label: "Email", type: "email", value: "you@studio.com", autocomplete: "email" }) +
          textField({ id: "pg-auth-password", label: "Password", type: "password", value: "••••••••••", autocomplete: "current-password" }),
        submitLabel: "Log in",
        footerHtml: `<span>New here? <a href="/signup">Start free</a></span><a href="/forgot">Forgot password</a>`,
        note: "Self-hosting? Your instance, your login — same screen, nothing phones home.",
      }) +
      `</div>`,
  },
  {
    id: "page-timer",
    group: "Pages",
    title: "Timer",
    render: () =>
      frame("timer", "Good morning", "Sunday, Nov 8 — here's your day so far.", button({ label: "Add manual entry" }),
        runningPanel() +
        `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">` +
        card({ content: statBlock({ label: "Today", value: "5h 12m", sub: "Goal 8h · on pace" }) + progressBar({ value: 65, label: "Today's goal progress" }) }) +
        card({ content: statBlock({ label: "This week", value: "36h 52m", sub: "Across 4 clients" }) + progressBar({ value: 92, label: "Week progress" }) }) +
        card({ content: statBlock({ label: "Unbilled", value: "$2,340", sub: "27.5h across 3 clients" }) + button({ label: "Create Zinvoice", size: "sm" }) }) +
        `</div>` +
        card({
          content:
            `<div style="font-weight:600;margin-bottom:8px">Today's entries</div>` +
            entryRow({ title: "Acme Studio — Website rebuild", meta: "9:04 AM — now · Homepage design pass", duration: "1:24:08", amount: "$119.19", running: true }) +
            entryRow({ title: "Acme Studio — Website rebuild", meta: "5:16 AM — 9:04 AM · Homepage design pass", duration: "3h 48m", amount: "$323.00", actions: button({ label: "Edit", size: "sm" }) }),
        }),
      ),
  },
  {
    id: "page-calendar",
    group: "Pages",
    title: "Calendar",
    render: () =>
      frame("calendar", "Calendar", "Nov 2 — Nov 8 · 36h 52m tracked", button({ label: "This week" }) + button({ label: "Add manual entry" }),
        weekView({ days: WEEK }),
      ),
  },
  {
    id: "page-zinvoices",
    group: "Pages",
    title: "Zinvoices",
    render: () =>
      frame("invoices", "Zinvoices", "Outstanding $2,730.00 · Paid this month $425.00", linkButton({ label: "New Zinvoice", href: "/invoices/new", variant: "primary" }),
        `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">` +
        card({ content: statBlock({ label: "Outstanding", value: "$2,730.00", sub: "2 sent, 1 overdue" }) }) +
        card({ content: statBlock({ label: "Drafts", value: "1", sub: "$1,827.50 ready to send" }) }) +
        card({ content: statBlock({ label: "Paid · November", value: "$425.00", sub: "Avg. 3 days to pay" }) }) +
        `</div>` +
        `<div style="display:flex;gap:8px;align-items:flex-end">` +
        filterChips({
          items: [
            { key: "all", label: "All", href: "/invoices" },
            { key: "draft", label: "Draft", href: "/invoices?status=draft" },
            { key: "sent", label: "Sent", href: "/invoices?status=sent" },
            { key: "paid", label: "Paid", href: "/invoices?status=paid" },
            { key: "overdue", label: "Overdue", href: "/invoices?status=overdue" },
          ],
          active: "all",
          label: "Filter zinvoices by status",
        }) +
        `<span style="margin-left:auto;min-width:220px">` + textField({ id: "pg-zi-search", label: "Search Zinvoices", placeholder: "Client or number" }) + `</span></div>` +
        card({
          content:
            `<table class="ui-table"><thead><tr><th scope="col">Number</th><th scope="col">Client</th><th scope="col">Issued</th><th scope="col">Due</th><th scope="col">Status</th><th scope="col" class="num">Total</th></tr></thead><tbody>` +
            `<tr><td><a class="inv-num-link" href="/invoices?invoice=1042">Zinvoice #1042</a></td><td>Acme Studio</td><td>—</td><td>—</td><td>${statusChip("draft")}</td><td class="num">$1,827.50</td></tr>` +
            `<tr><td><a class="inv-num-link" href="/invoices?invoice=1041">Zinvoice #1041</a></td><td>Northwind Legal</td><td>Nov 5</td><td>Nov 19</td><td>${statusChip("sent")}</td><td class="num">$2,090.00</td></tr>` +
            `<tr><td><a class="inv-num-link" href="/invoices?invoice=1040">Zinvoice #1040</a></td><td>Bluefin Bakery</td><td>Oct 28</td><td>Nov 4</td><td><span class="ui-chip ui-chip-overdue">Overdue 4d</span></td><td class="num">$640.00</td></tr>` +
            `<tr><td><a class="inv-num-link" href="/invoices?invoice=1039">Zinvoice #1039</a></td><td>Harbor Dental</td><td>Oct 24</td><td>Nov 7</td><td><span class="ui-chip ui-chip-paid">${icon("check")}Paid Oct 30</span></td><td class="num">$425.00</td></tr>` +
            `</tbody></table>`,
        }),
      ),
  },
  {
    id: "page-new-zinvoice",
    group: "Pages",
    title: "New Zinvoice",
    render: () =>
      frame("invoices", "New Zinvoice", "Acme Studio · unbilled through Nov 8", "",
        steps({ items: ["Client & period", "Pick time", "Review & send"], current: 1 }) +
        `<div style="display:grid;grid-template-columns:1.15fr .85fr;gap:12px;align-items:start">` +
        card({
          content:
            formSection({
              step: 1, title: "Client & period",
              bodyHtml: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">` +
                selectField({ id: "pg-zi-client", label: "Client", options: [{ value: "acme", label: "Acme Studio" }, { value: "northwind", label: "Northwind Legal" }], value: "acme" }) +
                textField({ id: "pg-zi-period", label: "Period", value: "Oct 26 — Nov 8" }) + `</div>`,
            }) +
            formSection({
              step: 2, title: "Unbilled time — uncheck to exclude",
              bodyHtml: unbilledTable([
                { id: "e1", label: "Design — homepage pass", hours: "12.5h", amount: "$1,062.50", included: true },
                { id: "e2", label: "Development — build", hours: "8.0h", amount: "$680.00", included: true },
                { id: "e3", label: "Review call", hours: "1.0h", amount: "$85.00", included: true },
                { id: "e4", label: "Internal planning (non-billable)", hours: "0.7h", amount: "$0.00", included: false },
              ]),
            }),
        }) +
        invoiceSummary({
          title: "Live preview — #1042",
          chipHtml: statusChip("draft"),
          lines: [
            { label: "Design — 12.5h", amount: "$1,062.50" },
            { label: "Development — 8h", amount: "$680.00" },
            { label: "Review call — 1h", amount: "$85.00" },
          ],
          totalLabel: "Total due",
          total: "$1,827.50",
          bodyHtml: textField({ id: "pg-zi-due", label: "Due date", value: "Nov 22, 2026" }) +
            `<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">` +
            button({ label: "Save draft", variant: "primary", block: true }) + button({ label: "Send Zinvoice", block: true }) + `</div>` +
            `<p class="inv-send-note">Sending creates the public pay link.</p>`,
        }) +
        `</div>`,
      ),
  },
  {
    id: "page-zinvoice-detail",
    group: "Pages",
    title: "Zinvoice detail",
    render: () =>
      frame("invoices", "Zinvoice #1041 — Northwind Legal", "Issued Nov 5 · Due Nov 19 · Net 14",
        button({ label: "Copy pay link", size: "sm" }) + button({ label: "Download PDF", size: "sm" }) + button({ label: "Send reminder", variant: "primary", size: "sm" }),
        `<div style="display:grid;grid-template-columns:1.15fr .85fr;gap:12px;align-items:start">` +
        card({
          content: lineItemsTable({
            items: [
              { dateRange: "Nov 3 — Nov 5", description: "Intake form fixes", hours: "9.5", rate: "$95", amount: "$902.50" },
              { dateRange: "Nov 3 — Nov 5", description: "Case dashboard", hours: "11.0", rate: "$95", amount: "$1,045.00" },
              { dateRange: "Nov 5", description: "Review call", hours: "1.5", rate: "$95", amount: "$142.50" },
            ],
            totals: [
              { label: "Time breakdown total", amount: "22.0h" },
              { label: "Total due", amount: "$2,090.00" },
            ],
          }),
        }) +
        `<div style="display:flex;flex-direction:column;gap:12px">` +
        card({
          content:
            `<div class="ui-card-head"><span class="ui-section-title">Status</span><span class="ui-card-head-end">${statusChip("sent")}</span></div>` +
            progressBar({ value: 50, label: "Zinvoice progress" }) +
            `<p style="color:var(--color-text-secondary);margin-top:8px">Due in 11 days · Due Nov 19</p>` +
            `<div class="inv-activity"><div class="inv-activity-row">Nov 5 — Created from 22h of tracked time</div></div>`,
        }) +
        card({
          content:
            `<div class="ui-section-title" style="margin-bottom:8px">Public link</div>` +
            `<p style="color:var(--color-text-secondary)">invoice.klectr.dev/i/…x7f2 — anyone with it can view and pay. No login for your client.</p>` +
            `<div style="display:flex;gap:8px;margin-top:12px">` + button({ label: "Copy link", size: "sm" }) + button({ label: "Regenerate", size: "sm" }) + `</div>`,
        }) +
        `</div></div>`,
      ),
  },
  {
    id: "page-public",
    group: "Pages",
    title: "Public Zinvoice",
    render: () =>
      `<div style="padding:40px 0">` +
      publicInvoice({
        business: "Studio — Triston Armstrong",
        meta: "Zinvoice #1041 · Issued Nov 5, 2026",
        chipHtml: tag({ label: "Due Nov 19", tone: "warning" }),
        lines: [
          { label: "Intake form fixes — 9.5h", amount: "$902.50" },
          { label: "Case dashboard — 11.0h", amount: "$1,045.00" },
          { label: "Review call — 1.5h", amount: "$142.50" },
        ],
        totalLabel: "Total due",
        total: "$2,090.00",
        pay: { label: "Pay $2,090.00", href: "https://pay.example/i/x7f2" },
        note: "Secure payment by card. Questions? Reply to the email this link came in.",
        footer: "Powered by Zimer · This page never asks for your Zimer password — you don't have one.",
      }) +
      `</div>`,
  },
  {
    id: "page-manage",
    group: "Pages",
    title: "Manage",
    render: () =>
      frame("manage", "Manage", "4 clients · 6 projects", "",
        card({
          content:
            `<div style="font-weight:600;margin-bottom:12px">Add a client</div>` +
            `<div style="display:flex;gap:8px;align-items:flex-end">` +
            textField({ id: "pg-mg-name", label: "Client name", placeholder: "e.g. Harbor Dental" }) +
            textField({ id: "pg-mg-email", label: "Email", type: "email", placeholder: "billing@client.example" }) +
            textField({ id: "pg-mg-rate", label: "Default rate", placeholder: "$ / hr" }) +
            button({ label: "Add client", variant: "primary" }) +
            `</div>`,
          className: "",
          tracking: true,
        }) +
        card({
          content:
            clientRow({ name: "Acme Studio", meta: "$85/hr · Website rebuild, Brand refresh · $2,340 unbilled", actions: button({ label: "Edit", size: "sm" }) }) +
            clientRow({ name: "Northwind Legal", meta: "$95/hr · Intake, Case dashboard · $0 unbilled", actions: button({ label: "Edit", size: "sm" }) }) +
            clientRow({ name: "Bluefin Bakery", meta: "$60/hr · Menu site · $640 overdue", actions: button({ label: "Edit", size: "sm" }) }) +
            clientRow({ name: "Harbor Dental", meta: "$75/hr · Booking page · last Zinvoice paid Oct 30", actions: button({ label: "Edit", size: "sm" }) }),
        }) +
        card({
          content:
            `<div style="font-weight:600;margin-bottom:10px">Projects</div>` +
            `<div style="display:flex;gap:8px;flex-wrap:wrap">` +
            tag({ label: "Acme — Website rebuild", tone: "primary" }) + tag({ label: "Acme — Brand refresh" }) +
            tag({ label: "Northwind — Intake" }) + tag({ label: "Northwind — Dashboard" }) + tag({ label: "Bluefin — Menu site" }) + tag({ label: "Harbor — Booking page" }) +
            `</div>` +
            `<p style="color:var(--color-text-secondary);margin-top:10px">Projects live under their client. Archive one and its time stays on past Zinvoices.</p>`,
        }),
      ),
  },
  {
    id: "page-settings",
    group: "Pages",
    title: "Settings",
    render: () =>
      frame("settings", "Settings", "Changes save per section — the button tells you it saved.", "",
        `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-items:start">` +
        settingsSection({
          title: "Business profile",
          hint: "Shows on Zinvoices",
          bodyHtml: `<div style="display:flex;flex-direction:column;gap:12px">` +
            textField({ id: "pg-set-name", label: "Business name", value: "Triston Armstrong — Studio" }) +
            textField({ id: "pg-set-email", label: "Email on Zinvoices", type: "email", value: "billing@studio.example" }) +
            textField({ id: "pg-set-terms", label: "Default payment terms", value: "Net 14" }) + `</div>`,
          actionsHtml: button({ label: "Save profile", variant: "primary" }) + `<span style="color:var(--color-success);font-size:var(--font-size-sm)">Saved Nov 7</span>`,
        }) +
        settingsSection({
          title: "Billing — Hosted plan",
          bodyHtml:
            `<div style="display:flex;align-items:baseline;gap:8px"><span class="ui-plan-amount">$12</span><span style="color:var(--color-text-secondary)">/ month · flat, no seats</span><span style="margin-left:auto">${tag({ label: "Active", tone: "success" })}</span></div>` +
            `<p style="color:var(--color-text-secondary);margin-top:10px;line-height:var(--line-height)">Next charge Dec 1, 2026. Early rate locked — your price doesn't rise when new signups move to $20.</p>` +
            `<div style="border-top:1px solid var(--color-border-secondary);margin-top:14px;padding-top:12px"><div style="font-weight:600;margin-bottom:4px">Accent color</div>` +
            `<p style="color:var(--color-text-secondary);font-size:var(--font-size-sm)">Pumpkin is home. Picking another changes your app only — Zinvoices keep your brand.</p>` +
            `<div style="display:flex;gap:8px;margin-top:10px">` +
            `<span style="width:26px;height:26px;border-radius:50%;background:#fb923c;border:2px solid #fff"></span>` +
            `<span style="width:26px;height:26px;border-radius:50%;background:#ffb4a8"></span>` +
            `<span style="width:26px;height:26px;border-radius:50%;background:#a8c7fa"></span>` +
            `<span style="width:26px;height:26px;border-radius:50%;background:#9be1a0"></span>` +
            `<span style="width:26px;height:26px;border-radius:50%;background:#ffe07d"></span></div></div>`,
          actionsHtml: button({ label: "Manage subscription" }) + button({ label: "Zinvoices from Zimer" }),
        }) +
        settingsSection({
          title: "Your data",
          bodyHtml: `<p style="color:var(--color-text-secondary);line-height:var(--line-height)">One SQLite file holds everything. Export or back up any time — leaving is allowed, so the exports actually work.</p>`,
          actionsHtml: button({ label: "Download backup" }) + button({ label: "Entries CSV" }) + button({ label: "Zinvoices CSV" }),
        }) +
        settingsSection({
          title: "License — self-host",
          bodyHtml: `<p style="color:var(--color-text-secondary);line-height:var(--line-height)">Running the hosted plan. Self-hosting is free forever — same code, your server, your SQLite file.</p>`,
          actionsHtml: button({ label: "Read the install guide" }),
        }) +
        `</div>`,
      ),
  },
  {
    id: "page-extension",
    group: "Pages",
    title: "Extension popup",
    render: () =>
      `<div style="display:grid;place-items:center;padding:40px 0">` +
      extensionPopup({
        statusHtml: runningTag(),
        bodyHtml:
          `<div style="margin-top:16px"><div style="font-weight:600">Acme Studio — Website rebuild</div>` +
          `<div style="color:var(--color-text-secondary);font-size:var(--font-size-sm)">Homepage design pass</div></div>` +
          timerDisplay({ elapsed: "01:24:08", size: "sm", start: "2026-11-08T09:04:00" }) +
          `<div style="display:flex;gap:8px;margin-top:8px">${tag({ label: "$85/hr", tone: "primary" })}${tag({ label: "Today 5h 12m" })}</div>` +
          `<div style="display:flex;gap:8px;margin-top:16px"><span style="flex:1">${button({ label: "Stop", variant: "primary", block: true })}</span>${button({ label: "Pause" })}</div>`,
        footerHtml:
          `<div style="font-size:var(--font-size-sm);color:var(--color-text-tertiary);margin-bottom:8px">Start new</div>` +
          `<div style="display:flex;gap:8px;align-items:flex-end">${textField({ id: "pg-ext-desc", label: "Description", placeholder: "What are you working on?" })}${button({ label: "Start" })}</div>` +
          `<div style="display:flex;align-items:flex-end;gap:8px;margin-top:10px">${selectField({ id: "pg-ext-client", label: "Client", options: [{ value: "acme", label: "Acme Studio" }, { value: "northwind", label: "Northwind Legal" }], value: "acme" })}<a href="/" style="margin-left:auto;font-size:var(--font-size-sm)">Open app</a></div>`,
      }) +
      `</div>`,
  },
  {
    id: "page-changelog",
    group: "Pages",
    title: "Changelog",
    render: () =>
      `<div style="max-width:640px;margin:0 auto;padding:24px 0 40px">` +
      `<h1 style="font-size:var(--font-size-heading-3);font-weight:600;margin-bottom:6px">What's new in Zimer</h1>` +
      `<p style="color:var(--color-text-secondary);margin-bottom:16px">Small, finished changes. Shipped means live, not announced.</p>` +
      changelogList([
        { date: "Nov 6, 2026", kind: "fix", body: "Calendar: a timer crossing midnight now stays on the day it started, matching how the entry is billed." },
        { date: "Nov 2, 2026", kind: "new", body: "Zinvoice breakdown now rounds exactly like the billed lines, so the totals always agree to the cent." },
        { date: "Oct 27, 2026", kind: "new", body: "Public Zinvoice pages show a due-date badge — due soon in amber, overdue in red, paid in green." },
        { date: "Oct 20, 2026", kind: "improved", body: "Extension popup opens instantly and shows today's total next to the running timer." },
      ]) +
      `</div>`,
  },
];
