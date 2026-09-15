/* Milestone 16.2: site-wide "t" shortcut toggles the timer. Vanilla JS, no build step. */
(function () {
  "use strict";

  function isEditable(el) {
    return !!el && (el.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName || ""));
  }

  let snackTimer = null;
  function snackbar(msg) {
    let bar = document.getElementById("tk-snackbar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "tk-snackbar";
      bar.className = "tk-snackbar";
      bar.setAttribute("role", "status");
      document.body.appendChild(bar);
    }
    bar.textContent = msg;
    bar.classList.add("show");
    clearTimeout(snackTimer);
    snackTimer = setTimeout(() => bar.classList.remove("show"), 3000);
  }
  /* #247: shared by the settings dialog (business-profile save confirmation). */
  window.tkSnackbar = snackbar;

  function refreshCard() {
    const card = document.getElementById("timer-card");
    if (card && window.htmx) htmx.ajax("GET", "/partial/timer", "#timer-card");
  }

  async function toggle() {
    const running = document.body.dataset.timerRunning === "1";
    const path = running ? "/timer/stop" : "/timer/start";
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "HX-Request": "true" },
        body: new FormData(), // keeps req.formData() on the route happy
      });
      if (!res.ok) throw new Error("toggle failed");
      document.body.dataset.timerRunning = running ? "0" : "1";
      refreshCard();
      snackbar(running ? "Timer stopped" : "Timer started — press t to stop");
    } catch (e) {
      snackbar("Couldn't toggle the timer");
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "t" && e.key !== "T") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isEditable(e.target)) return;
    e.preventDefault();
    toggle();
  });

  // keep the body flag in sync when the timer is toggled via the page buttons
  document.addEventListener("htmx:afterRequest", (e) => {
    const path = (e.detail && e.detail.pathInfo && e.detail.pathInfo.requestPath) || "";
    if (path === "/timer/start") document.body.dataset.timerRunning = "1";
    else if (path === "/timer/stop") document.body.dataset.timerRunning = "0";
  });
})();
