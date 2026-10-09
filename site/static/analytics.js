/* PostHog product analytics (#928).
 * Only active when the PostHog snippet loaded (POSTHOG_KEY is set on the
 * server). All tracking goes through track(), which safely no-ops when
 * PostHog isn't present — so this file is harmless on instances without
 * a configured key. Autocapture and pageviews are disabled in the snippet;
 * we only send the explicit timer → invoice funnel events below. */
(function () {
  "use strict";
  function track(event, props) {
    if (window.posthog && typeof window.posthog.capture === "function") {
      window.posthog.capture(event, props || {});
    }
  }
  /* Server fires these via the HX-Trigger response header on the matching
     routes (see web.ts). HTMX dispatches them as DOM events on <body>. */
  document.body.addEventListener("timer-started", function () { track("timer_started"); });
  document.body.addEventListener("timer-stopped", function () { track("timer_stopped"); });
  document.body.addEventListener("entry-created", function () { track("entry_created"); });
  document.body.addEventListener("invoice-created", function () { track("invoice_created"); });
  /* HTMX form posts that return JSON (no HX-Trigger): infer the funnel event
     from the request path. */
  document.body.addEventListener("htmx:afterRequest", function (e) {
    if (!e.detail || !e.detail.successful) return;
    var path = (e.detail.pathInfo && e.detail.pathInfo.requestPath) || "";
    var verb = (e.detail.verb || "").toLowerCase();
    if (verb !== "post") return;
    if (path === "/entries") track("entry_created");
    else if (path === "/invoices") track("invoice_created");
  });
  /* Direct callers (e.g. the keyboard shortcut's raw-fetch timer toggle). */
  window.zimerTrack = track;
  /* #928: after logout the server redirects to /login?logged_out=1 — reset
     the PostHog identity so the next browser user doesn't inherit it. */
  try {
    if (new URLSearchParams(window.location.search).get("logged_out") === "1") {
      if (window.posthog && typeof window.posthog.reset === "function") {
        window.posthog.reset();
      }
      /* Clean the param so a refresh doesn't reset again. */
      window.history.replaceState(null, "", window.location.pathname);
    }
  } catch (e) { /* non-browser or old engine — ignore */ }
})();
