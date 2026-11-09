import type { Story } from "../.zandbox/story";
import { card } from "../site/ui/card";
import { button } from "../site/ui/button";
import { statusChip } from "../site/ui/status-chip";

export const cardStories: Story[] = [
  {
    id: "card-plain",
    group: "Card",
    title: "Plain",
    render: () =>
      card({
        content:
          `<h3 class="md-title-medium" style="margin-top:0">Northwind Legal</h3>` +
          `<p class="muted">3 projects · $4,120.00 unbilled</p>` +
          button({ label: "New Zinvoice", variant: "tonal" }),
      }),
  },
  {
    id: "card-tracking",
    group: "Card",
    title: "Tracking (running Zimer)",
    render: () =>
      card({
        tracking: true,
        content:
          `<p class="md-label-large" style="margin-top:0">Tracking</p>` +
          `<p>Website redesign — homepage pass</p>` +
          `<p class="muted">Started 9:02 AM · 1h 24m</p>`,
      }),
  },
  {
    id: "card-with-chip",
    group: "Card",
    title: "With status chip",
    render: () =>
      card({
        content:
          `<p style="margin-top:0">Zinvoice #1042 · Bluefin Bakery ` +
          statusChip("paid") +
          `</p><p class="muted">$960.00 · Paid Nov 3</p>`,
      }),
  },
];
