import type { Story } from "../.zandbox/story";
import { tag } from "../site/ui/tag";
import { timerDisplay, timerPanel } from "../site/ui/timer-display";
import { extensionPopup } from "../site/ui/extension-popup";
import { publicInvoice } from "../site/ui/public-invoice";
import { changelogList } from "../site/ui/changelog";
import { heroSection, featureCard } from "../site/ui/landing";
import { button } from "../site/ui/button";
import { textField, selectField } from "../site/ui/field";

const runningTag = () => tag({ label: "Running", tone: "success", dot: true });

export const surfacesStories: Story[] = [
  {
    id: "surfaces-timer",
    group: "Surfaces",
    title: "Timer panel — running & idle",
    render: () =>
      `<div style="display:flex;flex-direction:column;gap:16px;max-width:640px">` +
      timerPanel({
        running: true,
        statusHtml: runningTag(),
        context: "Acme Studio — Website rebuild · Homepage design pass",
        startedLabel: "Started 9:04 AM",
        startedAt: "2026-11-08T09:04:00",
        elapsed: "01:24:08",
        metaHtml: tag({ label: "$85 / hr", tone: "primary" }) + tag({ label: "Billable" }) + tag({ label: "Worth $119.19 so far" }),
        actionsHtml: button({ label: "Stop", variant: "primary" }) + button({ label: "Pause" }),
      }) +
      timerPanel({
        running: false,
        statusHtml: tag({ label: "Not tracking" }),
        context: "Start a Zimer, or add a manual entry.",
        elapsed: "00:00:00",
        actionsHtml: button({ label: "Start Zimer", variant: "primary" }) + button({ label: "Add manual entry" }),
      }) +
      `</div>`,
  },
  {
    id: "surfaces-extension",
    group: "Surfaces",
    title: "Extension popup",
    render: () =>
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
          `<div style="display:flex;gap:8px">${textField({ id: "ext-desc", label: "Description" })}${button({ label: "Start" })}</div>` +
          `<div style="display:flex;align-items:center;margin-top:10px">${selectField({ id: "ext-client", label: "Client", options: [{ value: "acme", label: "Acme Studio" }, { value: "northwind", label: "Northwind Legal" }], value: "acme" })}<a href="/" style="margin-left:auto;font-size:var(--font-size-sm)">Open app</a></div>`,
      }),
  },
  {
    id: "surfaces-public",
    group: "Surfaces",
    title: "Public Zinvoice sheet",
    render: () =>
      publicInvoice({
        business: "Studio — Triston Armstrong",
        meta: "Zinvoice #1041 · Issued Nov 5, 2026",
        chipHtml: tag({ label: "Due Nov 19", tone: "warning" }),
        lines: [
          { label: "Intake form fixes — 9.5h", amount: "$902.50" },
          { label: "Case dashboard — 11.0h", amount: "$1,045.00" },
          { label: "Review call — 1.5h", amount: "$140.00" },
        ],
        totalLabel: "Total due",
        total: "$2,087.50",
        pay: { label: "Pay $2,087.50", href: "https://pay.example/i/x7f2" },
        note: "Secure payment by card. Questions? Reply to the email this link came in.",
        footer: "Powered by Zimer · This page never asks for your Zimer password — you don't have one.",
      }),
  },
  {
    id: "surfaces-landing",
    group: "Surfaces",
    title: "Landing — hero & features",
    render: () =>
      heroSection({
        tagLine: "Free forever self-hosted · $12/mo hosted",
        title: "Your Zimer is your Zinvoice.",
        sub: "Start a Zimer. Stop it. Send the Zinvoice. Two clicks, no seats, no meters, no surveillance — your data stays in your SQLite file.",
        actionsHtml: button({ label: "Start tracking — free", variant: "primary", size: "lg" }) + button({ label: "See how it works", size: "lg" }),
        note: "14-day trial, no card. Cancel keeps your data.",
        productHtml: timerPanel({
          running: true,
          statusHtml: runningTag(),
          context: "Acme Studio — Website rebuild",
          startedLabel: "Started 9:04 AM",
          startedAt: "2026-11-08T09:04:00",
          elapsed: "01:24:08",
          metaHtml: tag({ label: "$85 / hr", tone: "primary" }) + tag({ label: "Billable" }),
          actionsHtml: button({ label: "Stop & add to Zinvoice", variant: "primary" }),
        }),
      }) +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;max-width:880px;margin:0 auto">` +
      featureCard({ icon: "timer", title: "One job, done well", body: "Timer to Zinvoice in two clicks. No projects-within-projects, no passive tracking watching your screen." }) +
      featureCard({ icon: "card", title: "Pricing you can trust", body: "Free forever self-hosted, or flat $12/mo hosted. No seats, no meters, no surprise tier." }) +
      featureCard({ icon: "database", title: "Your data stays yours", body: "One SQLite file holds everything. Export or back up any time — leaving is allowed, so the exports actually work." }) +
      `</div>`,
  },
  {
    id: "surfaces-changelog",
    group: "Surfaces",
    title: "Changelog list",
    render: () =>
      `<div style="max-width:640px">` +
      changelogList([
        { date: "Nov 6, 2026", kind: "fix", body: "Calendar: a timer crossing midnight now stays on the day it started, matching how the entry is billed." },
        { date: "Nov 2, 2026", kind: "new", body: "Zinvoice breakdown now rounds exactly like the billed lines, so the totals always agree to the cent." },
        { date: "Oct 27, 2026", kind: "new", body: "Public Zinvoice pages show a due-date badge — due soon in amber, overdue in red, paid in green." },
        { date: "Oct 20, 2026", kind: "improved", body: "Extension popup opens instantly and shows today's total next to the running timer." },
      ]) +
      `</div>`,
  },
];
