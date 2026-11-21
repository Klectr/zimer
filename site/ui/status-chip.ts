import { esc } from "../lib/format";
import { icon } from "../lib/icons";

export type ZinvoiceStatus = "draft" | "sent" | "paid";

const STATUSES: readonly ZinvoiceStatus[] = ["draft", "sent", "paid"];

export interface StatusChipOptions {
  overdue?: boolean;
  suffix?: string;
  icon?: Parameters<typeof icon>[0];
}

export function statusChip(status: ZinvoiceStatus, opts: StatusChipOptions = {}): string {
  if (!STATUSES.includes(status)) {
    throw new Error(`statusChip: unknown status ${JSON.stringify(status)} (expected ${STATUSES.join(", ")})`);
  }
  if (opts.overdue && status !== "sent") {
    throw new Error(`statusChip: overdue applies to sent Zinvoices only (got ${JSON.stringify(status)})`);
  }
  const tone = opts.overdue ? "overdue" : status;
  const word = opts.overdue ? "Overdue" : status[0].toUpperCase() + status.slice(1);
  const label = opts.suffix ? `${word} ${opts.suffix}` : word;
  const lead = opts.icon ? icon(opts.icon) : "";
  return `<span class="ui-chip ui-chip-${tone}">${lead}${esc(label)}</span>`;
}
