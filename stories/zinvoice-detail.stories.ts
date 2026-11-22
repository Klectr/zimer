import type { Story } from "../.zandbox/story";
import {
  internalNotes, paymentProofSection, shareLine, stripePaidChip, timeBreakdownChart,
  zinvoiceDetailHead, zinvoiceShareCard, zinvoiceStatusCard,
} from "../site/ui/zinvoice-detail";
import { statusChip } from "../site/ui/status-chip";
import { button, linkButton } from "../site/ui/button";
import { iconButton } from "../site/ui/icon-button";

/* Fictional data only. Action forms are inert here (no endpoints). */
const rail = (inner: string) => `<div style="max-width:360px;display:flex;flex-direction:column;gap:16px">${inner}</div>`;
const main = (inner: string) => `<div style="max-width:640px;display:flex;flex-direction:column;gap:16px">${inner}</div>`;
const copy = iconButton({ icon: "copy", label: "Copy link" });
const regen = iconButton({ icon: "refresh", label: "Regenerate link" });
const revoke = iconButton({ icon: "delete", label: "Revoke link", danger: true });
const url = "https://zimer.example/i/x7f2demo-token-123456";

export const zinvoiceDetailStories: Story[] = [
  {
    id: "zinvoice-detail-head",
    group: "Zinvoice detail",
    title: "Head — draft and paid",
    render: () =>
      main(
        zinvoiceDetailHead({
          backHref: "#", title: "Zinvoice INV-1046 — Harbor Dental", sub: "Issued Nov 20 · Due Dec 20 · Net 30",
          actionsHtml: iconButton({ icon: "download", label: "Download PDF" }) + button({ label: "Mark Zinvoice sent", variant: "primary", icon: "check" }) + iconButton({ icon: "delete", label: "Delete draft", danger: true }),
        }) +
        zinvoiceDetailHead({
          backHref: "#", title: "Zinvoice INV-1038 — Harbor Dental", sub: "Issued Oct 1 · Due Oct 31 · Net 30",
          actionsHtml: statusChip("paid", { icon: "check", suffix: "Oct 18" }) + iconButton({ icon: "copy", label: "Copy pay link" }) + iconButton({ icon: "download", label: "Download PDF" }),
        }),
      ),
  },
  {
    id: "zinvoice-detail-status",
    group: "Zinvoice detail",
    title: "Status card — every state",
    render: () =>
      rail(
        zinvoiceStatusCard({ chipHtml: statusChip("draft"), progress: 0, line: "Created Nov 20 · Not sent yet", activity: ["Nov 20 — Created from 18.5 h of tracked time"] }) +
        zinvoiceStatusCard({ chipHtml: statusChip("sent"), progress: 50, tone: "warning", line: "Due in 3 days · Due Nov 24", activity: ["Nov 10 — Created"] }) +
        zinvoiceStatusCard({ chipHtml: statusChip("sent", { overdue: true }), progress: 50, tone: "error", line: "Overdue 20d · Due Nov 1", activity: ["Oct 2 — Created"] }) +
        zinvoiceStatusCard({ chipHtml: statusChip("paid", { icon: "check" }), extraChipHtml: stripePaidChip(), progress: 100, line: "Paid Oct 18", activity: ["Oct 18 — Paid via Stripe", "Oct 1 — Created"] }),
      ),
  },
  {
    id: "zinvoice-detail-share",
    group: "Zinvoice detail",
    title: "Public link card — link, none, warnings",
    render: () =>
      rail(
        zinvoiceShareCard({ canPay: true, linesHtml: shareLine({ label: "Client link", url, actionsHtml: copy + regen + revoke }) }) +
        zinvoiceShareCard({ canPay: false, linesHtml: shareLine({ label: "Client link", actionsHtml: button({ label: "Create client link", icon: "add" }) }) }) +
        zinvoiceShareCard({
          canPay: false,
          linesHtml:
            shareLine({ label: "Client link", url, actionsHtml: copy + regen + revoke }) +
            shareLine({ label: "Payment link", warn: true, text: "Couldn't create it — the client won't see a Pay button", actionsHtml: regen }) +
            shareLine({ label: "How to pay", warn: true, note: "Your client won't see how to pay.", actionsHtml: linkButton({ label: "Add payment instructions", href: "#", size: "sm" }) }),
        }),
      ),
  },
  {
    id: "zinvoice-detail-breakdown",
    group: "Zinvoice detail",
    title: "Time breakdown — per day",
    render: () =>
      main(timeBreakdownChart({
        per: "day", totalLabel: "18.5 h",
        bars: [["Nov 3", 4.5], ["Nov 4", 2], ["Nov 5", 0.25], ["Nov 6", 6], ["Nov 7", 3.25], ["Nov 10", 2.5]].map(([label, hours]) => ({ label: String(label), hours: Number(hours), tip: `${label}: ${hours} h tracked` })),
      })),
  },
  {
    id: "zinvoice-detail-proof",
    group: "Zinvoice detail",
    title: "Proof of payment — files, and the paid-without-proof nudge",
    render: () =>
      main(
        paymentProofSection({
          invoiceId: "story-a", uploadAction: "#",
          proofs: [
            { filename: "bank-receipt-oct-18.pdf", href: "#", meta: "84 KB · Oct 18", deleteHtml: iconButton({ icon: "delete", label: "Delete proof", danger: true }) },
            { filename: "remittance.png", href: "#", meta: "212 KB · Oct 19", deleteHtml: iconButton({ icon: "delete", label: "Delete proof", danger: true }) },
          ],
        }) +
        paymentProofSection({ invoiceId: "story-b", uploadAction: "#", proofs: [], nudge: true }),
      ),
  },
  {
    id: "zinvoice-detail-internal-notes",
    group: "Zinvoice detail",
    title: "Internal notes",
    render: () => main(internalNotes("Agreed a 10% discount on the next one if this lands before Dec 1.")),
  },
];
