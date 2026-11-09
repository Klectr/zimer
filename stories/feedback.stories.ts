import type { Story } from "../.zandbox/story";
import { dialog, confirmDialog } from "../site/ui/dialog";
import { toast } from "../site/ui/toast";
import { menu } from "../site/ui/menu";
import { emptyState } from "../site/ui/empty-state";
import { button } from "../site/ui/button";

const DEMO_SCRIPT = `<script>
(function () {
  var lastOpener = null;
  function openDialog(scrim, opener) {
    lastOpener = opener;
    scrim.hidden = false;
    var target = scrim.querySelector("[data-autofocus]") || scrim.querySelector("button, a[href], input, select, textarea");
    if (target) target.focus();
  }
  function closeDialog(scrim) {
    scrim.hidden = true;
    if (lastOpener) lastOpener.focus();
  }
  document.querySelectorAll("[data-open-dialog]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      openDialog(document.getElementById(btn.getAttribute("data-open-dialog")), btn);
    });
  });
  document.querySelectorAll(".ui-scrim").forEach(function (scrim) {
    scrim.addEventListener("click", function (e) {
      if (e.target === scrim || e.target.closest("[data-close]")) closeDialog(scrim);
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") document.querySelectorAll(".ui-scrim:not([hidden])").forEach(closeDialog);
  });
})();
</script>`;

export const feedbackStories: Story[] = [
  {
    id: "feedback-dialog",
    group: "Feedback",
    title: "Dialog (click to open)",
    render: () =>
      `<button type="button" class="ui-btn" data-open-dialog="demo-dialog">Open dialog</button>` +
      `<button type="button" class="ui-btn ui-btn-danger" data-open-dialog="demo-confirm" style="margin-left:8px">Delete something…</button>` +
      dialog({
        id: "demo-dialog",
        title: "Edit entry",
        body: "<p>The dialog body is a raw slot: forms and fields render here. Escape closes it, and clicking the scrim or the close button dismisses it in this demo wiring.</p>",
        actions: button({ label: "Cancel", variant: "ghost", attrs: "data-close" }) + button({ label: "Save entry", variant: "primary" }),
      }) +
      confirmDialog({
        id: "demo-confirm",
        title: "Delete this entry?",
        body: "This removes the 2h 05m entry for Northwind Legal. Zinvoices that already include it are not changed.",
        confirmLabel: "Delete entry",
        danger: true,
      }) +
      DEMO_SCRIPT,
  },
  {
    id: "feedback-dialog-open",
    group: "Feedback",
    title: "Confirm dialog (shown open)",
    render: () =>
      confirmDialog({
        id: "demo-confirm-open",
        title: "Delete draft Zinvoice?",
        body: "INV-0043 for Harbor Dental ($1,827.00) will be permanently deleted.",
        confirmLabel: "Delete draft",
        danger: true,
        open: true,
      }),
  },
  {
    id: "feedback-toasts",
    group: "Feedback",
    title: "Toasts — tinted icon chip, no side border",
    render: () =>
      `<div style="display:grid;gap:12px">` +
      toast({ tone: "success", title: "Zinvoice sent", body: "Zinvoice #1042 sent to Northwind Legal." }) +
      toast({ tone: "error", title: "Payment failed", body: "Your card was declined. Update billing to keep the hosted plan active." }) +
      toast({ tone: "info", title: "Timer already running", body: "Starting a new one stops the current entry." }) +
      `</div>`,
  },
  {
    id: "feedback-menu",
    group: "Feedback",
    title: "Dropdown menu",
    render: () =>
      menu({
        label: "Zinvoice actions",
        items: [
          { label: "View", icon: "receipt" },
          { label: "Download PDF", icon: "download" },
          { label: "Copy link", icon: "copy" },
          { label: "Mark as paid", icon: "check" },
          { label: "Delete draft", icon: "delete", danger: true },
          { label: "Send (already sent)", icon: "save", disabled: true },
        ],
      }),
  },
  {
    id: "feedback-empty",
    group: "Feedback",
    title: "Empty states",
    render: () =>
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">` +
      emptyState({
        icon: "timer",
        title: "No entries yet",
        body: "Start the timer and your first entry lands here.",
        action: button({ label: "Start timer", variant: "primary" }),
      }) +
      emptyState({
        icon: "group",
        title: "No clients yet",
        body: "Add a client to organize projects and Zinvoices.",
        action: button({ label: "Add client" }),
      }) +
      emptyState({ icon: "receipt", title: "Nothing overdue", body: "Every sent Zinvoice is paid or still within terms." }) +
      `</div>`,
  },
];
