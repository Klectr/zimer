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

  /* #464: one shared M3 confirm dialog, replacing every native confirm() /
     hx-confirm in the app (delete entry x2, delete draft invoice, delete
     client, delete project, revoke client link). Returns a promise that
     resolves true on the confirm action, false on Cancel / Escape / scrim
     click. Reuses the .cal-scrim/.cal-dialog motion pattern; traps Tab via
     tkTrapTab; initial focus lands on Cancel, the safe action. The message is
     set as textContent, never HTML. */
  var confirmOpen = false;
  window.tkConfirm = function (message, confirmLabel) {
    if (confirmOpen) return Promise.resolve(false); /* never stack dialogs */
    confirmOpen = true;
    return new Promise(function (resolve) {
      var doc = document;
      /* #513: remember the trigger so close() can hand focus back to it —
         keyboard users strand on a hidden Cancel button otherwise. */
      var opener = doc.activeElement;
      var scrim = doc.createElement("div");
      scrim.className = "cal-scrim";
      var box = doc.createElement("div");
      box.className = "cal-dialog tk-confirm";
      box.setAttribute("role", "alertdialog");
      box.setAttribute("aria-modal", "true");
      var title = doc.createElement("h2");
      title.className = "md-headline-small";
      title.id = "tk-confirm-title";
      title.textContent = message || "";
      box.setAttribute("aria-labelledby", "tk-confirm-title");
      var actions = doc.createElement("div");
      actions.className = "cal-dialog-actions";
      var spacer = doc.createElement("span");
      spacer.className = "cal-spacer";
      var cancelBtn = doc.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "md-text-button";
      cancelBtn.textContent = "Cancel";
      var okBtn = doc.createElement("button");
      okBtn.type = "button";
      okBtn.className = "md-text-button danger";
      okBtn.textContent = confirmLabel || "Delete";
      actions.appendChild(spacer);
      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      box.appendChild(title);
      box.appendChild(actions);
      scrim.appendChild(box);

      var settled = false;
      function close(result) {
        if (settled) return;
        settled = true;
        doc.removeEventListener("keydown", onKey, true);
        /* #513: hand focus back to the trigger. The re-dispatched confirm
           click may swap the trigger out of the DOM — the contains guard
           keeps the restore a harmless no-op then. */
        if (opener && typeof opener.focus === "function" && doc.contains(opener)) opener.focus();
        scrim.classList.remove("open");
        /* #467: the guard stays raised until the fading dialog is actually
           removed — resetting it here opened a 220ms window where a second
           tkConfirm stacked a new dialog over the fading one. */
        setTimeout(function () {
          confirmOpen = false;
          scrim.remove();
          resolve(result);
        }, 220);
      }
      function onKey(e) {
        if (!e) return;
        if (e.key === "Escape") { e.preventDefault(); close(false); return; }
        window.tkTrapTab(box, e);
      }
      cancelBtn.addEventListener("click", function () { close(false); });
      okBtn.addEventListener("click", function () { close(true); });
      scrim.addEventListener("click", function (e) {
        if (e.target === scrim) close(false);
      });
      doc.addEventListener("keydown", onKey, true);
      doc.body.appendChild(scrim);
      /* next frame so the enter transition plays */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { scrim.classList.add("open"); });
      });
      cancelBtn.focus();
    });
  };

  /* #464: [data-confirm] replaces hx-confirm / onclick="return confirm()".
     Capture phase at the document runs before htmx's element-level listener,
     so preventDefault + stopPropagation fully pre-empts it; on OK the click
     is re-dispatched with a one-shot flag, and both the htmx path and the
     plain-form submit path proceed untouched. Keyboard activation (Enter /
     Space on the button) dispatches a click too, so it flows through here. */
  document.addEventListener("click", function (e) {
    var t = e.target;
    var el = t && t.closest ? t.closest("[data-confirm]") : null;
    if (!el || el.disabled) return;
    if (el.dataset.tkConfirmed) { delete el.dataset.tkConfirmed; return; }
    e.preventDefault();
    e.stopPropagation();
    window.tkConfirm(el.getAttribute("data-confirm") || "",
      el.getAttribute("data-confirm-label")).then(function (ok) {
      if (!ok) return;
      el.dataset.tkConfirmed = "1";
      el.click();
    });
  }, true);
})();
