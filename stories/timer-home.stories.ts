import type { Story } from "../.zandbox/story";
import { invoiceMark, repeatEntryForm, skeletonRows, targetBar, timerRunningCard, timerStartCard, todayEntriesCard } from "../site/ui/timer-home";
import { entryRow } from "../site/ui/rows";
import { iconButton } from "../site/ui/icon-button";

/* Fictional data only. */
const projectOptions = [
  { value: "", label: "No project" },
  { value: "1", label: "Website rebuild (Harbor Dental)" },
  { value: "2", label: "Brand refresh (Harbor Dental)" },
  { value: "3", label: "Mobile app (Quill & Ledger)" },
];
const wrap = (inner: string, w = 560) => `<div style="max-width:${w}px;display:flex;flex-direction:column;gap:16px">${inner}</div>`;
const startedAt = new Date(Date.now() - (1 * 3600 + 24 * 60 + 8) * 1000).toISOString();

const edit = iconButton({ icon: "edit", label: "Edit entry", tip: "Edit" });
const del = iconButton({ icon: "delete", label: "Delete entry", tip: "Delete entry", danger: true });
const rows = [
  entryRow({ id: "s-1", title: "Harbor Dental — Website rebuild", dot: "#fb923c", metaHtml: `<span>1:15 PM – now</span> · Homepage pass`, duration: "1h 24m", running: true, actions: edit }),
  entryRow({ id: "s-2", title: "Quill & Ledger — Mobile app", dot: "#60a5fa", metaHtml: `<span>9:00 AM – 12:30 PM</span> · Beta feedback fixes`, duration: "3h 30m", amount: "$332.50", actions: edit + repeatEntryForm({ description: "Beta feedback fixes", projectId: 3 }) + del }),
  entryRow({ id: "s-3", title: "Harbor Dental — Brand refresh", dot: "#fb923c", metaHtml: invoiceMark({ label: "Sent", tip: "On INV-1045 (sent)" }) + `<span>7:30 AM – 8:45 AM</span>`, duration: "1h 15m", amount: "$150.00" }),
].join("");

export const timerHomeStories: Story[] = [
  {
    id: "timer-home-idle",
    group: "Zimer home",
    title: "Zimer card — not tracking",
    render: () => wrap(timerStartCard({ projectOptions, suggestions: ["Homepage pass", "Beta feedback fixes", "Logo concepts"] })),
  },
  {
    id: "timer-home-running",
    group: "Zimer home",
    title: "Zimer card — running, with rate and worth",
    render: () => wrap(
      timerRunningCard({ context: "Harbor Dental — Website rebuild · Homepage pass", startedAt, rate: 120, rateLabel: "$120 / hr", worth: "$168.27" }) +
      `<div style="height:8px"></div>`,
    ),
  },
  {
    id: "timer-home-today",
    group: "Zimer home",
    title: "Today's entries — target bar, running row, repeat, invoice mark",
    render: () => wrap(todayEntriesCard({ bodyHtml: targetBar({ pct: 77, label: "Today · 6h 09m / 8h", ariaLabel: "Today's hours target, 8 hours" }) + `<div class="ui-list">${rows}</div>` }), 640),
  },
  {
    id: "timer-home-today-states",
    group: "Zimer home",
    title: "Today's entries — loading, empty, target met",
    render: () => wrap(
      todayEntriesCard({ bodyHtml: skeletonRows() }) +
      todayEntriesCard({ bodyHtml: targetBar({ pct: 0, label: "Today · 0s / 8h", ariaLabel: "Today's hours target, 8 hours" }) + `<p class="ui-note">Nothing tracked today yet.</p>` }) +
      todayEntriesCard({ bodyHtml: targetBar({ pct: 100, label: "Today · 8h 20m / 8h · Target met", ariaLabel: "Today's hours target, 8 hours" }) }),
      640,
    ),
  },
];
