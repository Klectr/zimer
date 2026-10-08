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

  /* #534: ignore presses while a toggle request is in flight — a fast
     double-press races the first request, and the loser 409s on the start
     path, flashing a bogus "Couldn't toggle the timer" error. */
  let toggling = false;
  async function toggle() {
    if (toggling) return;
    toggling = true;
    const running = document.body.dataset.timerRunning === "1";
    const path = running ? "/timer/stop" : "/timer/start";
    try {
      /* #538: the t shortcut mirrors the Start button — serialize the card's
         start form on the start path, so a typed description (and the picked
         project) isn't silently dropped the way the old empty-FormData post
         dropped it. The stop route reads nothing from the body, and there's
         no card form on other pages, so both keep the empty body. */
      const form = running ? null : document.querySelector("#timer-card .start-form");
      const res = await fetch(path, {
        method: "POST",
        headers: { "HX-Request": "true" },
        body: form ? new FormData(form) : new FormData(), // keeps req.formData() on the route happy
      });
      if (!res.ok) throw new Error("toggle failed");
      if (running) disarmTicker(); else armTicker();
      refreshCard();
      /* #454: the button path fires timer-updated via the server's HX-Trigger
         header; this raw-fetch path never did, so the today list kept showing
         stale data after a t toggle. Fire the same event for parity. */
      if (window.htmx) htmx.trigger(document.body, "timer-updated");
      /* #928: the raw-fetch path bypasses the server's HX-Trigger, so fire
         the analytics event directly. */
      if (window.zimerTrack) window.zimerTrack(running ? "timer_stopped" : "timer_started");
      snackbar(running ? "Zimer stopped" : "Zimer started — press t to stop");
    } catch (e) {
      snackbar("Couldn't toggle the timer");
    } finally {
      toggling = false;
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "t" && e.key !== "T") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    /* #534: holding t must not machine-gun the timer via key auto-repeat. */
    if (e.repeat) return;
    if (isEditable(e.target)) return;
    /* #540: a modal dialog is open — M3 modal dialogs capture all
       interaction until dismissed, so the shortcut must not toggle the
       timer behind the scrim. Both dialogs (calendar, settings) use
       .cal-scrim, hidden when closed. */
    if (document.querySelector(".cal-scrim:not([hidden])")) return;
    e.preventDefault();
    toggle();
  });

  /* #444: site-wide tab-title ticker. #440's ticker lived in the timer card's
     inline script, so full page loads (e.g. opening the Calendar) wiped its
     interval — exactly where ambient awareness matters. This one runs on
     every app page: layout renders body[data-timer-start] from the running
     entry, and /timer/start|stop swaps re-arm it. */
  const ticker = (() => {
    let tick = null;
    let baseTitle = document.title;
    function fmt(ms) {
      const h = Math.floor(ms / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
      return (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    }
    function start(startIso) {
      stop();
      baseTitle = document.title;
      const t0 = new Date(startIso).getTime();
      if (!isFinite(t0)) return;
      const render = () => {
        document.title = fmt(Math.max(0, Date.now() - t0)) + " · Zimer";
      };
      render();
      tick = setInterval(render, 1000);
    }
    function stop() {
      if (tick) { clearInterval(tick); tick = null; }
      if (document.title !== baseTitle) document.title = baseTitle;
    }
    if (document.body.dataset.timerRunning === "1" && document.body.dataset.timerStart) {
      start(document.body.dataset.timerStart);
    }
    return { start, stop };
  })();

  // keep the body flag in sync when the timer is toggled via the page buttons
  document.addEventListener("htmx:afterRequest", (e) => {
    const path = (e.detail && e.detail.pathInfo && e.detail.pathInfo.requestPath) || "";
    if (path === "/timer/start") armTicker();
    else if (path === "/timer/stop") disarmTicker();
  });

  /* #444: the t shortcut posts via raw fetch, so no htmx:afterRequest fires —
     arm/disarm the ticker here too. */
  function armTicker() {
    document.body.dataset.timerRunning = "1";
    /* client clock approximates the server start; cold page loads get the
       exact instant from layout's data-timer-start instead. */
    document.body.dataset.timerStart = new Date().toISOString();
    ticker.start(document.body.dataset.timerStart);
  }
  function disarmTicker() {
    document.body.dataset.timerRunning = "0";
    delete document.body.dataset.timerStart;
    ticker.stop();
  }

  /* #496: M3 plain tooltips need a 450ms long-press on touch, where hover
     doesn't exist. Used to live inline per page (#69 calendar day heads,
     #432 invoice icon buttons); now site-wide so timer/manage icon buttons
     get it too. Document-level delegation survives htmx swaps. */
  (() => {
    let tipTimer = null, tipEl = null;
    document.addEventListener("pointerdown", (e) => {
      const t = e.target && e.target.closest && e.target.closest("[data-tip]");
      if (!t) return;
      tipEl = t;
      tipTimer = setTimeout(() => t.classList.add("tip-show"), 450);
    });
    ["pointerup", "pointercancel"].forEach((type) => {
      document.addEventListener(type, () => {
        if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
        if (tipEl) { tipEl.classList.remove("tip-show"); tipEl = null; }
      }, { passive: true });
    });
  })();
})();
