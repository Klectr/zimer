import { describe, expect, test } from "bun:test";
import { dialog, confirmDialog } from "./dialog";
import { toast } from "./toast";
import { menu } from "./menu";
import { emptyState } from "./empty-state";

describe("dialog", () => {
  test("renders the app dialog contract: scrim, aria-modal panel, labelledby/describedby, close hook", () => {
    const html = dialog({ id: "d1", title: "Edit entry", body: "<p>x</p>" });
    expect(html).toContain('<div class="ui-scrim" id="d1" hidden>');
    expect(html).toContain('role="dialog" aria-modal="true"');
    expect(html).toContain('aria-labelledby="d1-title"');
    expect(html).toContain('aria-describedby="d1-desc"');
    expect(html).toContain('<h2 class="ui-dialog-title" id="d1-title">Edit entry</h2>');
    expect(html).toContain("data-close");
    expect(html).toContain("ui-dialog-body");
  });

  test("open dialogs omit the hidden attribute on the scrim", () => {
    const html = dialog({ id: "d2", title: "T", body: "", open: true });
    expect(html).toContain('<div class="ui-scrim" id="d2">');
    expect(html).not.toContain('id="d2" hidden');
  });
});

describe("confirmDialog", () => {
  test("danger confirm: alertdialog role, danger primary, non-colliding hooks, safe-action autofocus", () => {
    const html = confirmDialog({ id: "c1", title: "Delete?", body: "Sure?", confirmLabel: "Delete it", danger: true });
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("data-confirm-action");
    expect(html).not.toContain('attrs: "data-confirm"');
    expect(html).not.toContain(' data-confirm>');
    expect(html).toContain("data-autofocus");
    expect(html).toContain("ui-btn-danger");
    expect(html).toContain("Cancel");
    expect(html).toContain("Delete it");
  });
});

describe("toast", () => {
  test("tones map to chip icons and live roles; no border-accent class exists", () => {
    const ok = toast({ tone: "success", title: "Sent" });
    expect(ok).toContain('role="status"');
    expect(ok).toContain("ui-toast-success");
    const err = toast({ tone: "error", title: "Failed" });
    expect(err).toContain('role="alert"');
    expect(err).not.toContain("border-left");
  });
});

describe("menu", () => {
  test("items render as links, buttons, or disabled spans with roles", () => {
    const html = menu({
      label: "Actions",
      items: [
        { label: "View", href: "/x" },
        { label: "Delete", danger: true },
        { label: "Send", disabled: true },
      ],
    });
    expect(html).toContain('role="menu"');
    expect(html).toContain('<a class="ui-menu-item" role="menuitem" href="/x">');
    expect(html).toContain("is-danger");
    expect(html).toContain('aria-disabled="true"');
  });
});

describe("emptyState", () => {
  test("renders icon, title, body, and the action slot", () => {
    const html = emptyState({ icon: "timer", title: "No entries", body: "Start one.", action: "<button>Go</button>" });
    expect(html).toContain("ui-empty-icon");
    expect(html).toContain("No entries");
    expect(html).toContain("<button>Go</button>");
    expect(emptyState({ icon: "timer", title: "T" })).not.toContain("ui-empty-action");
  });
});
