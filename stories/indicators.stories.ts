import type { Story } from "../.zandbox/story";
import { targetBar } from "../site/ui/target-bar";
import { trendDelta } from "../site/ui/trend-delta";
import { invoiceMark } from "../site/ui/invoice-mark";
import { skeletonRows } from "../site/ui/skeleton";
import { statusChip, stripePaidChip } from "../site/ui/status-chip";

/* One small component per story, in its states. Fictional data. */
const col = (inner: string, w = 480) => `<div style="max-width:${w}px;display:flex;flex-direction:column;gap:16px">${inner}</div>`;

export const indicatorStories: Story[] = [
  {
    id: "indicators-target-bar",
    group: "Indicators",
    title: "Target bar — stacked, inline, met, over",
    render: () => col(
      targetBar({ pct: 13, label: "Today · 1h 02m / 8h", ariaLabel: "Today's hours target, 8 hours" }) +
      targetBar({ pct: 100, label: "Today · 8h 20m / 8h · Target met", ariaLabel: "Today's hours target, 8 hours" }) +
      targetBar({ inline: true, pct: 95, label: "38h 02m / 40h", ariaLabel: "Weekly hours target, 40 hours" }) +
      targetBar({ inline: true, pct: 110, over: true, label: "44h 15m / 40h", ariaLabel: "Weekly hours target, 40 hours" }),
    ),
  },
  {
    id: "indicators-trend-delta",
    group: "Indicators",
    title: "Trend delta — up, down, unchanged",
    render: () => col(
      trendDelta({ pct: 12, vs: "vs this time last week" }) +
      trendDelta({ pct: -8, vs: "vs prev week" }) +
      trendDelta({ pct: 0, vs: "vs prev week" }),
    ),
  },
  {
    id: "indicators-invoice-mark",
    group: "Indicators",
    title: "Invoice mark — on an entry's meta line",
    render: () => col(
      `<div class="ui-row-meta">${invoiceMark({ label: "Sent", tip: "On INV-1045 (sent)" })}<span>7:30 AM – 8:45 AM</span></div>` +
      `<div class="ui-row-meta">${invoiceMark({ label: "Draft", tip: "In draft INV-1046", cls: "is-draft" })}<span>9:00 AM – 12:30 PM</span></div>`,
    ),
  },
  {
    id: "indicators-paid-via-stripe",
    group: "Indicators",
    title: "Paid via Stripe — beside the paid chip",
    render: () => `<div>${statusChip("paid", { icon: "check" })}${stripePaidChip()}</div>`,
  },
  {
    id: "indicators-skeleton-rows",
    group: "Indicators",
    title: "Skeleton rows — loading placeholder",
    render: () => col(skeletonRows() + skeletonRows(1)),
  },
];
