import type { Story } from "../zandbox/story";
import { statusChip } from "../site/ui/status-chip";

export const statusChipStories: Story[] = [
  {
    id: "status-chip-all",
    group: "Status chip",
    title: "All statuses",
    render: () =>
      `<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">` +
      STATUSES.map((s) => statusChip(s)).join("") +
      `</div>`,
  },
  {
    id: "status-chip-invoice-row",
    group: "Status chip",
    title: "On a Zinvoice row",
    render: () =>
      `<div style="display:flex;gap:10px;align-items:center">` +
      `<span>Zinvoice #1041 · Northwind Legal</span>` +
      statusChip("sent") +
      `<span style="opacity:.65">$2,550.00</span></div>`,
  },
];
