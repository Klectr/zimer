import type { Story } from "../.zandbox/story";
import { card } from "../site/ui/card";
import { statBlock } from "../site/ui/stat";
import { progressBar } from "../site/ui/progress";
import { steps } from "../site/ui/steps";
import { zinvoiceRow, entryRow, clientRow } from "../site/ui/rows";
import { lineItemsTable } from "../site/ui/line-items";
import { iconButton } from "../site/ui/icon-button";

const wrap = (inner: string) => `<div style="max-width:560px">${inner}</div>`;

export const dataStories: Story[] = [
  {
    id: "data-stats",
    group: "Data",
    title: "Stat blocks",
    render: () =>
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;max-width:640px">` +
      card({ content: statBlock({ label: "Outstanding", value: "$3,915", sub: "3 sent, 1 overdue" }) }) +
      card({ content: statBlock({ label: "Drafts", value: "2", sub: "$1,827 ready to send" }) }) +
      card({
        content:
          statBlock({ label: "Today", value: "5h 12m" }) +
          `<div style="margin-top:10px">` +
          progressBar({ value: 65, label: "Today's goal progress" }) +
          `</div><div class="ui-stat-sub">Goal 8h · on pace</div>`,
      }) +
      `</div>`,
  },
  {
    id: "data-progress",
    group: "Data",
    title: "Progress bar",
    render: () =>
      wrap(
        progressBar({ value: 65, label: "Day goal" }) +
          `<div style="height:12px"></div>` +
          progressBar({ value: 100, label: "Fully billed" }) +
          `<div style="height:12px"></div>` +
          progressBar({ value: 8, label: "Just started" }),
      ),
  },
  {
    id: "data-steps",
    group: "Data",
    title: "Steps — New Zinvoice",
    render: () => wrap(steps({ items: ["Details", "Entries", "Review"], current: 1 })),
  },
  {
    id: "data-zinvoice-rows",
    group: "Data",
    title: "Zinvoice rows",
    render: () =>
      wrap(
        `<div class="ui-list">` +
          zinvoiceRow({ number: "INV-0042", client: "Northwind Legal", status: "sent", overdueDays: 12, amount: "$2,550.00", meta: "Due Oct 27", href: "/invoices?invoice=1042" }) +
          zinvoiceRow({ number: "INV-0041", client: "Bluefin Bakery", status: "paid", amount: "$902.50", meta: "Paid Oct 28", href: "/invoices?invoice=1041" }) +
          zinvoiceRow({ number: "INV-0043", client: "Harbor Dental", status: "draft", amount: "$1,827.00", meta: "Not sent", href: "/invoices?invoice=1043" }) +
          zinvoiceRow({ number: "INV-0044", client: "", clientHtml: "<em>No client</em> · due Nov 12", status: "sent", amount: "$310.00", meta: "", href: "/invoices?invoice=1044", ariaLabel: "View zinvoice INV-0044", selected: true, className: "inv-row-hit" }) +
          `</div>`,
      ),
  },
  {
    id: "data-entry-rows",
    group: "Data",
    title: "Entry rows",
    render: () =>
      wrap(
        `<div class="ui-list">` +
          entryRow({
            title: "Website redesign — homepage pass",
            meta: "Acme Studio · 9:02 AM – 10:26 AM",
            duration: "1h 24m",
            amount: "$119.00",
            actions: iconButton({ icon: "edit", label: "Edit entry" }) + iconButton({ icon: "delete", label: "Delete entry", danger: true }),
          }) +
          entryRow({ title: "Intake form fixes", meta: "Northwind Legal · Yesterday", duration: "2h 05m", amount: "$197.75", mark: "Zinvoiced" }) +
          `</div>`,
      ),
  },
  {
    id: "data-client-rows",
    group: "Data",
    title: "Client rows",
    render: () =>
      wrap(
        `<div class="ui-list">` +
          clientRow({
            name: "Northwind Legal",
            meta: "3 projects · $4,120.00 unbilled",
            actions: iconButton({ icon: "edit", label: "Edit Northwind Legal" }) + iconButton({ icon: "add", label: "New project for Northwind Legal" }),
          }) +
          clientRow({
            name: "Bluefin Bakery",
            meta: "1 project · $0.00 unbilled",
            actions: iconButton({ icon: "edit", label: "Edit Bluefin Bakery" }) + iconButton({ icon: "add", label: "New project for Bluefin Bakery" }),
          }) +
          `</div>`,
      ),
  },
  {
    id: "data-client-rows-linked",
    group: "Data",
    title: "Client rows — linked (list-detail)",
    render: () =>
      wrap(
        `<div class="ui-list">` +
          clientRow({
            name: "Acme Studio",
            meta: "2 projects · $85/hr",
            href: "/manage?client=1",
            ariaLabel: "Manage client Acme Studio",
            dot: "#fb923c",
            selected: true,
            chevron: true,
          }) +
          clientRow({
            name: "Northwind Legal",
            meta: "3 projects",
            href: "/manage?client=2",
            ariaLabel: "Manage client Northwind Legal",
            dot: "#60a5fa",
            chevron: true,
          }) +
          clientRow({
            name: "No client",
            meta: "1 unassigned project",
            href: "/manage?client=none",
            ariaLabel: "Manage projects with no client",
            iconDot: "group",
            chevron: true,
          }) +
          `</div>`,
      ),
  },
  {
    id: "data-line-items",
    group: "Data",
    title: "Line items table",
    render: () =>
      wrap(
        lineItemsTable({
          items: [
            { dateRange: "Oct 20 – Oct 24", description: "Intake form fixes", hours: "9.5h", rate: "$95", amount: "$902.50" },
            { dateRange: "Oct 27 – Oct 31", description: "Case dashboard", hours: "11.0h", rate: "$95", amount: "$1,045.00" },
            { dateRange: "Nov 3", description: "Review call", hours: "1.5h", rate: "$95", amount: "$140.00" },
          ],
          totals: [
            { label: "Subtotal", amount: "$2,087.50" },
            { label: "Total due", amount: "$2,087.50" },
          ],
        }),
      ),
  },
];
