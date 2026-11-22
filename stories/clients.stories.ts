import type { Story } from "../.zandbox/story";
import { clientHoverCard, clientTable, type ClientTableRow } from "../site/ui/client-table";

/* Fictional data only. */
const rows: ClientTableRow[] = [
  {
    key: "1", name: "Harbor Dental", color: "#fb923c",
    month: { label: "20h", widthPct: 100, segments: [37800, 34200] },
    unbilled: "$2,400", last: { text: "Today" },
    card: {
      meta: "$120/hr · Net 30 · 8 projects",
      projects: [{ name: "Website rebuild", dur: "10h 30m" }, { name: "Brand refresh", dur: "9h 30m" }],
      extra: [{ label: "6 more projects", value: "0h" }],
    },
  },
  {
    key: "2", name: "Quill & Ledger", color: "#60a5fa",
    month: { label: "11h", widthPct: 55, segments: [39600] },
    unbilled: "$1,045", outstanding: "$1,757.50", overdue: true, last: { text: "Today" },
    card: {
      meta: "$95/hr · Net 15 · 4 projects",
      projects: [{ name: "Mobile app", dur: "11h" }],
      extra: [{ label: "3 more projects", value: "0h" }],
      invoices: [{ label: "INV-1041 · overdue", value: "$1,757.50", tone: "error" }, { label: "INV-1044 · draft", value: "$380", tone: "muted" }],
    },
  },
  {
    key: "3", name: "Fernwood Bakery", color: "#a78bfa",
    month: { label: "0h", muted: true, widthPct: 0, segments: [] },
    last: { text: "6 weeks ago", quiet: true },
    card: { meta: "$80/hr · Net 30 · 1 project", projects: [], extra: [{ label: "No time this month", value: "0h" }] },
  },
];

/** Hover cards are hidden until :hover; this pins one open for review. */
const pinOpen = `<style>.zb-pin-card .mg-card{position:static;opacity:1;visibility:visible;transform:none;width:280px}</style>`;

export const clientsStories: Story[] = [
  {
    id: "clients-table",
    group: "Clients",
    title: "Client table — hover a row",
    render: () =>
      `<div style="max-width:880px">` +
      clientTable({ rows, noClientLabel: "No client · 2h this month" }) +
      `</div>`,
  },
  {
    id: "clients-table-narrow",
    group: "Clients",
    title: "Client table — narrow card (columns step down)",
    render: () =>
      `<div style="display:flex;flex-direction:column;gap:16px">` +
      `<div style="max-width:600px">${clientTable({ rows, noClientLabel: "No client · 2h this month" })}</div>` +
      `<div style="max-width:360px">${clientTable({ rows, noClientLabel: "No client · 2h this month" })}</div>` +
      `</div>`,
  },
  {
    id: "clients-table-empty",
    group: "Clients",
    title: "Client table — no clients",
    render: () => `<div style="max-width:880px">${clientTable({ rows: [], emptyText: "No clients yet. Add one above." })}</div>`,
  },
  {
    id: "clients-hover-card",
    group: "Clients",
    title: "Hover card — projects and open Zinvoices",
    render: () =>
      pinOpen +
      `<div class="zb-pin-card" style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">` +
      clientHoverCard({ title: "Harbor Dental", color: "#fb923c", ...rows[0].card }) +
      clientHoverCard({ title: "Quill & Ledger", color: "#60a5fa", ...rows[1].card }) +
      clientHoverCard({ title: "Fernwood Bakery", color: "#a78bfa", ...rows[2].card }) +
      `</div>`,
  },
];
