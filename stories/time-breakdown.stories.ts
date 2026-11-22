import type { Story } from "../.zandbox/story";
import { timeBreakdownChart } from "../site/ui/time-breakdown";

/* Fictional data. */
const bars = (rows: [string, number][]) => rows.map(([label, hours]) => ({ label, hours, tip: `${label}: ${hours} h tracked` }));

export const timeBreakdownStories: Story[] = [
  {
    id: "time-breakdown-chart",
    group: "Data",
    title: "Time breakdown — per day, per week, one bar",
    render: () =>
      `<div style="max-width:640px;display:flex;flex-direction:column;gap:24px">` +
      timeBreakdownChart({ per: "day", totalLabel: "18.5 h", bars: bars([["Nov 3", 4.5], ["Nov 4", 2], ["Nov 5", 0.25], ["Nov 6", 6], ["Nov 7", 3.25], ["Nov 10", 2.5]]) }) +
      timeBreakdownChart({ per: "week", totalLabel: "96 h", bars: bars([["Wk of Sep 1", 22], ["Wk of Sep 8", 31], ["Wk of Sep 15", 18], ["Wk of Sep 22", 25]]) }) +
      timeBreakdownChart({ per: "day", totalLabel: "1.75 h", bars: bars([["Nov 3", 1.75]]) }) +
      `</div>`,
  },
];
