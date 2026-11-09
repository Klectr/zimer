import type { Story } from "../.zandbox/story";
import { checkboxField, switchField, settingRow } from "../site/ui/choice";
import { authCard } from "../site/ui/auth-card";
import { settingsSection } from "../site/ui/settings-section";
import { planCard } from "../site/ui/plan-card";
import { formSection, unbilledTable, invoiceSummary } from "../site/ui/zinvoice-form";
import { textField, selectField } from "../site/ui/field";
import { button } from "../site/ui/button";
import { statusChip } from "../site/ui/status-chip";

const wrap = (inner: string) =>
  `<div style="max-width:560px;border:1px solid var(--color-border-secondary);border-radius:12px;padding:20px">${inner}</div>`;

export const formsStories: Story[] = [
  {
    id: "forms-entry-times",
    group: "Forms",
    title: "Entry times — datetime-local fields",
    render: () =>
      wrap(
        `<div style="display:flex;flex-direction:column;gap:12px">` +
          textField({ id: "story-start", label: "Start", name: "start_time", type: "datetime-local", required: true, attrs: 'data-iso="2026-11-02T14:00:00.000Z"' }) +
          textField({ id: "story-end", label: "End (blank = still running)", name: "end_time", type: "datetime-local", attrs: 'data-iso="2026-11-02T16:30:00.000Z"' }) +
          `</div>`,
      ),
  },
  {
    id: "forms-choices",
    group: "Forms",
    title: "Checkbox & switch rows",
    render: () =>
      wrap(
        checkboxField({ id: "cb-billable", label: "Billable by default", hint: "New entries start billable.", checked: true }) +
          checkboxField({ id: "cb-round", label: "Round to the nearest 15 minutes" }) +
          checkboxField({ id: "cb-locked", label: "Locked after sending", hint: "Sent Zinvoices freeze their entries.", checked: true, disabled: true }) +
          switchField({ id: "sw-weekend", label: "Show weekends on the calendar", checked: true }) +
          switchField({ id: "sw-colors", label: "Show project colors on the calendar" }),
      ),
  },
  {
    id: "forms-setting-rows",
    group: "Forms",
    title: "Setting rows",
    render: () =>
      wrap(
        settingsSection({
          title: "Preferences",
          bodyHtml:
            settingRow({ title: "Weekend days", hint: "Shown faded on the week grid.", controlHtml: switchField({ id: "set-weekends", label: "Weekend days", checked: true, bare: true }) }) +
            settingRow({ title: "Round up entries", hint: "Bills each entry up to the next 15 minutes.", controlHtml: checkboxField({ id: "set-round", label: "Round up entries", checked: true, bare: true }) }) +
            settingRow({ title: "Billing email", hint: "billing@studio.example", controlHtml: button({ label: "Change email", size: "sm" }) }),
        }),
      ),
  },
  {
    id: "forms-auth",
    group: "Forms",
    title: "Auth card",
    render: () =>
      authCard({
        action: "/login",
        title: "Welcome back",
        sub: "Log in to your timers and Zinvoices.",
        fieldsHtml:
          textField({ id: "auth-email", label: "Email", type: "email", value: "you@studio.com", autocomplete: "email" }) +
          textField({ id: "auth-password", label: "Password", type: "password", value: "••••••••••", autocomplete: "current-password" }),
        submitLabel: "Log in",
        footerHtml: `<span>New here? <a href="/signup">Start free</a></span><a href="/forgot">Forgot password</a>`,
        note: "Self-hosting? Your instance, your login — same screen, nothing phones home.",
      }),
  },
  {
    id: "forms-settings-profile",
    group: "Forms",
    title: "Settings — profile & billing sections",
    render: () =>
      `<div style="display:flex;flex-direction:column;gap:16px;max-width:560px">` +
      settingsSection({
        title: "Business profile",
        hint: "Shows on Zinvoices",
        bodyHtml:
          `<div style="display:flex;flex-direction:column;gap:12px">` +
          textField({ id: "prof-name", label: "Business name", value: "Triston Armstrong — Studio" }) +
          textField({ id: "prof-email", label: "Email on Zinvoices", type: "email", value: "billing@studio.example" }) +
          textField({ id: "prof-terms", label: "Default payment terms", value: "Net 14" }) +
          `</div>`,
        actionsHtml: button({ label: "Save profile", variant: "primary" }) + `<span style="color:var(--color-success);font-size:var(--font-size-sm)">Saved Nov 7</span>`,
      }) +
      settingsSection({
        title: "Your data",
        bodyHtml: `<p style="color:var(--color-text-secondary)">One SQLite file holds everything. Export or back up any time — leaving is allowed, so the exports actually work.</p>`,
        actionsHtml: button({ label: "Download backup" }) + button({ label: "Entries CSV" }) + button({ label: "Zinvoices CSV" }),
      }) +
      `</div>`,
  },
  {
    id: "forms-plans",
    group: "Forms",
    title: "Plan cards",
    render: () =>
      `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;max-width:720px">` +
      planCard({
        name: "Self-host",
        amount: "$0",
        period: "forever",
        blurb: "Your server, your SQLite file.",
        features: ["Unlimited clients, projects, and Zinvoices", "Full data ownership — export any time", "Community support"],
        ctaHtml: button({ label: "Read the install guide", block: true }),
      }) +
      planCard({
        name: "Hosted",
        amount: "$12",
        period: "/ month · flat, no seats",
        blurb: "We run it, you just track. Early rate locked — your price doesn't rise when new signups move to $20.",
        features: ["Everything in self-host", "Automatic backups", "Public pay links on your domain", "14-day trial, no card"],
        ctaHtml: button({ label: "Manage subscription", block: true }),
        current: true,
      }) +
      `</div>`,
  },
  {
    id: "forms-zinvoice",
    group: "Forms",
    title: "New Zinvoice — form pieces",
    render: () =>
      `<div style="display:grid;grid-template-columns:1.15fr .85fr;gap:12px;max-width:880px;align-items:start">` +
      wrap(
        formSection({
          step: 1,
          title: "Client & period",
          bodyHtml:
            `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">` +
            selectField({ id: "zi-client", label: "Client", options: [{ value: "acme", label: "Acme Studio" }, { value: "northwind", label: "Northwind Legal" }], value: "acme" }) +
            textField({ id: "zi-period", label: "Period", value: "Oct 26 — Nov 8" }) +
            `</div>`,
        }) +
          formSection({
            step: 2,
            title: "Unbilled time — uncheck to exclude",
            bodyHtml: unbilledTable([
              { id: "e1", label: "Design — homepage pass", hours: "12.5h", amount: "$1,062.50", included: true },
              { id: "e2", label: "Development — build", hours: "8.0h", amount: "$680.00", included: true },
              { id: "e3", label: "Review call", hours: "1.0h", amount: "$85.00", included: true },
              { id: "e4", label: "Internal planning (non-billable)", hours: "0.7h", amount: "$0.00", included: false },
            ]),
          }),
      ) +
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
        bodyHtml:
          textField({ id: "zi-due", label: "Due date", value: "Nov 22, 2026" }) +
          `<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">` +
          button({ label: "Save draft", variant: "primary", block: true }) +
          button({ label: "Send Zinvoice", block: true }) +
          `</div>`,
      }) +
      `</div>`,
  },
];
