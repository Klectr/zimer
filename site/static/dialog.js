/* #456: shared focus trap for the modal dialogs. Both app dialogs are
   aria-modal="true" (calendar entry dialog, settings dialog), so Tab must
   cycle inside the open dialog instead of wandering behind the scrim.
   Vanilla JS, no build step — loaded from layout(). */
(function () {
  "use strict";

  /* Visible, enabled, keyboard-focusable elements, in DOM order. Computed at
     each Tab press so lazily-loaded dialog content (the settings form) and
     per-open state (hidden save/delete buttons) are always covered. */
  function tabbables(root) {
    var els = root.querySelectorAll(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    var out = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.disabled && el.getClientRects().length) out.push(el);
    }
    return out;
  }

  /* Keeps a Tab keydown cycling inside container. Call it from the dialog's
     own key handler only while the dialog is open. */
  window.tkTrapTab = function (container, e) {
    if (!e || e.key !== "Tab") return;
    var list = tabbables(container);
    if (!list.length) { e.preventDefault(); return; }
    var first = list[0], last = list[list.length - 1];
    var active = document.activeElement;
    if (e.shiftKey && (active === first || !container.contains(active))) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (active === last || !container.contains(active))) {
      e.preventDefault(); first.focus();
    }
  };
})();
