import type { Story } from "../.zandbox/story";
import { wizardLayout, wizardLinesSection, wizardPreviewCard, wizardStep1, type WizardLine } from "../site/ui/zinvoice-wizard";
import { statusChip } from "../site/ui/status-chip";

/* Fictional data only. The wizard script is not loaded here: these show
   the server-rendered states; behavior is exercised in the app. */
const clientOptions = [
  { value: "", label: "Choose a client…" },
  { value: "1", label: "Harbor Dental", data: { rate: 120, "terms-days": 30 } },
  { value: "2", label: "Quill & Ledger", data: { rate: 95, "terms-days": 15 } },
];
const lines: WizardLine[] = [
  { description: "Website rebuild", hours: 10.5, rate: 120, amount: "$1,260.00", dateFrom: "2026-11-03", dateTo: "2026-11-14", dateLabel: "Nov 3 – Nov 14", entryIds: [11, 12, 13] },
  { description: "Brand refresh", hours: 9.5, rate: 120, amount: "$1,140.00", dateFrom: "2026-11-04", dateTo: "2026-11-12", dateLabel: "Nov 4 – Nov 12", entryIds: [14, 15] },
];
const preview = (disabled: boolean) => wizardPreviewCard({
  number: "INV-1047", chipHtml: statusChip("draft"),
  lines: disabled ? [] : [{ label: "Website rebuild — 10.50 h", amount: "$1,260.00" }, { label: "Brand refresh — 9.50 h", amount: "$1,140.00" }],
  total: disabled ? "$0.00" : "$2,400.00",
  dueDate: "2026-12-21", issueDate: "2026-11-21", taxRate: "0", notes: "", internalNotes: "", disabled,
});
/* The same page shell the app renders, so the layout's container queries
   behave here exactly as in the app. */
const page = (step1: string, step2: string, right: string, current: number) =>
  `<div style="max-width:1080px">` +
  wizardLayout({ stepItems: ["Client & period", "Pick time", "Review & send"], current, step1Html: step1, step2Html: step2, previewHtml: right }) +
  `</div>`;

export const zinvoiceWizardStories: Story[] = [
  {
    id: "zinvoice-wizard-start",
    group: "Zinvoice wizard",
    title: "Before a client is picked",
    render: () => page(wizardStep1({ clientOptions, clientId: "", from: "2026-11-01", to: "2026-11-21", rate: "" }), wizardLinesSection({}), preview(true), 0),
  },
  {
    id: "zinvoice-wizard-lines",
    group: "Zinvoice wizard",
    title: "Unbilled time loaded, with rounding note",
    render: () => page(wizardStep1({ clientOptions, clientId: "1", from: "2026-11-01", to: "2026-11-21", rate: "120" }), wizardLinesSection({ lines, roundingMinutes: 15 }), preview(false), 1),
  },
  {
    id: "zinvoice-wizard-no-time",
    group: "Zinvoice wizard",
    title: "No unbilled time — manual lines only",
    render: () => page(wizardStep1({ clientOptions, clientId: "2", from: "2026-11-01", to: "2026-11-21", rate: "95" }), wizardLinesSection({ lines: [], emptyMsg: "No unbilled time for Quill & Ledger in this period. Add a manual line to bill one-time work." }), preview(true), 1),
  },
];
