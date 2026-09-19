/* Timekeep motion: M3 press ripple. Zero dependencies.
 * Delegated on document so HTMX-swapped buttons ripple too. */
(function () {
  "use strict";
  if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var SEL = ".md-filled-button,.md-tonal-button,.md-text-button,.md-icon-button";

  function spawn(host, x, y) {
    var r = host.getBoundingClientRect();
    var size = Math.max(r.width, r.height) * 2.4;
    var s = document.createElement("span");
    s.className = "md-ripple";
    s.style.width = s.style.height = size + "px";
    s.style.left = (x - r.left) + "px";
    s.style.top = (y - r.top) + "px";
    host.appendChild(s);
    void s.offsetWidth; /* commit initial state so the transition runs */
    s.classList.add("go");
    var dead = false;
    var cleanup = function () { if (!dead) { dead = true; s.remove(); } };
    /* only the fade-out's opacity transition retires the span; the expand
       phase fires its own transitionend events first and must be ignored */
    s.addEventListener("transitionend", function (e) {
      if (s.classList.contains("fade") && e.propertyName === "opacity") cleanup();
    });
    setTimeout(cleanup, 900); /* fallback: host removed mid-press */
    return s;
  }

  var pressed = null;
  function release() {
    if (!pressed) return;
    pressed.classList.add("fade");
    pressed = null;
  }

  document.addEventListener("pointerdown", function (e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    var host = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (!host || host.disabled) return;
    release();
    pressed = spawn(host, e.clientX, e.clientY);
  });
  document.addEventListener("pointerup", release);
  document.addEventListener("pointercancel", release);

  /* keyboard activation: ripple from the center */
  document.addEventListener("keydown", function (e) {
    if ((e.key !== "Enter" && e.key !== " ") || e.repeat) return;
    var host = e.target && e.target.closest ? e.target.closest(SEL) : null;
    if (!host || host.disabled) return;
    var r = host.getBoundingClientRect();
    var s = spawn(host, r.left + r.width / 2, r.top + r.height / 2);
    setTimeout(function () { s.classList.add("fade"); }, 200);
  });
})();

/* #375: M3 top app bar scroll lift — surface at rest, surface-container once
 * content scrolls. Fixed-viewport pages scroll an inner region below the bar
 * rather than under it; any scrolled region counts, since the lift's purpose
 * is separating the bar from content once the user moves into the page.
 * Separate IIFE so it runs even under prefers-reduced-motion (this is a
 * state change, not motion). */
(function () {
  "use strict";
  var bar = document.querySelector(".md-top-app-bar");
  if (!bar) return;
  var SEL = ".scroll-region,.cal-scroll,.cal-supporting,.pane-layout," +
    ".client-list-pane,.client-detail-pane,.invoice-list-pane,.invoice-detail-pane";
  function update() {
    var scrolled = window.scrollY > 0;
    if (!scrolled) {
      var els = document.querySelectorAll(SEL);
      for (var i = 0; i < els.length; i++) {
        if (els[i].scrollTop > 0) { scrolled = true; break; }
      }
    }
    bar.classList.toggle("scrolled", scrolled);
  }
  /* scroll doesn't bubble; capture catches inner-region scrolls too */
  document.addEventListener("scroll", update, { capture: true, passive: true });
  document.addEventListener("htmx:afterSwap", update);
  update();
})();
