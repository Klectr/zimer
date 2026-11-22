import type { Story } from "../.zandbox/story";
import { calFirstRun, calHint, calLegend, weekClients, weekDelta, weekNav, weekSummary, weekTargetBar, zinvoiceNudge } from "../site/ui/calendar-pane";

/* Fictional data only. */
const link = (w: string) => ({ href: `#${w}`, partial: `#${w}` });
/* Full width, like the stacked layout below 1280px (the wide side-pane
   layout only exists inside the calendar page grid). */
const pane = (inner: string) => `<div style="max-width:720px"><aside class="cal-supporting">${inner}</aside></div>`;
const clients = [
  { name: "Harbor Dental", color: "#fb923c", dur: "20h" },
  { name: "Quill & Ledger", color: "#60a5fa", dur: "11h" },
  { name: "Fernwood Bakery", color: "#a78bfa", dur: "7h 02m" },
];

export const calendarPaneStories: Story[] = [
  {
    id: "calendar-pane-this-week",
    group: "Calendar pane",
    title: "This week — up on last week, partly Zinvoiced",
    render: () => pane(
      /* Two nudge copies, as in the app: CSS shows the one that fits. */
      weekNav({ title: "This week", prev: link("prev"), next: link("next"), extraHtml: zinvoiceNudge({ href: "#", label: "Zinvoice this week", amount: "14h 30m not yet Zinvoiced", nav: true }) }) +
      weekSummary({
        total: "38h 02m", billable: "38h 02m",
        deltaHtml: weekDelta({ pct: 12, vs: "vs this time last week" }),
        nudgeHtml: zinvoiceNudge({ href: "#", label: "Zinvoice this week", amount: "14h 30m not yet Zinvoiced" }),
      }) +
      weekTargetBar({ pct: 95, label: "38h 02m / 40h", ariaLabel: "Weekly hours target, 40 hours" }) +
      weekClients(clients) + calHint(),
    ),
  },
  {
    id: "calendar-pane-past-week",
    group: "Calendar pane",
    title: "A past week — Today link, down, over target, all unbilled",
    render: () => pane(
      weekNav({ title: "Week of Nov 8", today: link("today"), prev: link("prev"), next: link("next"), extraHtml: zinvoiceNudge({ href: "#", label: "Zinvoice this period", nav: true }) }) +
      weekSummary({
        total: "44h 15m", billable: "41h",
        deltaHtml: weekDelta({ pct: -8, vs: "vs prev week" }),
        nudgeHtml: zinvoiceNudge({ href: "#", label: "Zinvoice this period" }),
      }) +
      weekTargetBar({ pct: 100, label: "44h 15m / 40h", over: true, ariaLabel: "Weekly hours target, 40 hours" }) +
      weekClients(clients.slice(0, 2)),
    ),
  },
  {
    id: "calendar-pane-first-run",
    group: "Calendar pane",
    title: "Empty workspace — first-run note",
    render: () => pane(
      weekNav({ title: "This week", prev: link("prev"), next: link("next") }) +
      weekSummary({ total: "0s", billable: "0s" }) +
      weekTargetBar({ pct: 0, label: "0s / 40h", ariaLabel: "Weekly hours target, 40 hours" }) +
      calHint() + calFirstRun(),
    ),
  },
  {
    id: "calendar-pane-legend",
    group: "Calendar pane",
    title: "Strip legend + week export",
    render: () => `<div style="max-width:640px">${calLegend({ exportHref: "#" })}</div>`,
  },
];
