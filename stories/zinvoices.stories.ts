import type { Story } from "../.zandbox/story";
import { zinvoiceTable, type ZinvoiceTableRow } from "../site/ui/zinvoice-table";
import { linkButton } from "../site/ui/button";

/* Fictional data only. */
const rows: ZinvoiceTableRow[] = [
  { number: "INV-1046", href: "#", client: "Harbor Dental", status: "draft", total: "$1,240.00" },
  { number: "INV-1045", href: "#", client: "Quill & Ledger", status: "sent", issued: "Nov 12", due: "Dec 12", total: "$2,087.50" },
  { number: "INV-1041", href: "#", client: "Fernwood Bakery", status: "sent", issued: "Oct 2", due: "Nov 1", overdue: true, overdueDays: 20, total: "$1,757.50" },
  { number: "INV-1038", href: "#", client: "Harbor Dental", status: "paid", issued: "Oct 1", due: "Oct 31", paid: "Oct 18", total: "$3,600.00" },
  { number: "INV-1032", href: "#", status: "paid", issued: "Sep 3", due: "Oct 3", paid: "Sep 30", total: "$480.00" },
];

export const zinvoicesStories: Story[] = [
  {
    id: "zinvoices-table",
    group: "Zinvoices",
    title: "List table — every status",
    render: () => `<div style="max-width:960px">${zinvoiceTable({ rows })}</div>`,
  },
  {
    id: "zinvoices-table-narrow",
    group: "Zinvoices",
    title: "List table — phone width",
    render: () => `<div style="max-width:360px">${zinvoiceTable({ rows })}</div>`,
  },
  {
    id: "zinvoices-table-empty",
    group: "Zinvoices",
    title: "List table — no matches",
    render: () =>
      `<div style="max-width:960px">` +
      zinvoiceTable({ rows: [], emptyBody: "No Zinvoices match this filter.", emptyActionHtml: linkButton({ label: "Clear filter", href: "#", variant: "ghost" }) }) +
      `</div>`,
  },
];
