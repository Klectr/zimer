import { esc } from "../lib/format";
import type { Story } from "../../zandbox/story";
import { button } from "./button";
import { statusChip } from "./status-chip";

export interface CardOptions {
  content: string;
  tracking?: boolean;
  id?: string;
}

export function card(opts: CardOptions): string {
  const cls = "md-card" + (opts.tracking ? " tracking" : "");
  const id = opts.id ? ` id="${esc(opts.id)}"` : "";
  return `<div class="${cls}"${id}>${opts.content}</div>`;
}

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
