import { esc } from "../lib/format";

export type ZinvoiceStatus = "draft" | "sent" | "paid";

const STATUSES: readonly ZinvoiceStatus[] = ["draft", "sent", "paid"];

export function statusChip(status: ZinvoiceStatus): string {
  if (!STATUSES.includes(status)) {
    throw new Error(`statusChip: unknown status ${JSON.stringify(status)} (expected ${STATUSES.join(", ")})`);
  }
  const label = status[0].toUpperCase() + status.slice(1);
  return `<span class="pill pill-${esc(status)}">${esc(label)}</span>`;
}
