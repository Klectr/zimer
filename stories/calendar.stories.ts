import type { Story } from "../.zandbox/story";
import { weekView, type WeekDay } from "../site/ui/week-view";
import { visualizer } from "../site/ui/visualizer";

const DAYS: WeekDay[] = [
  { weekday: "Mon", dateLabel: "Nov 2", total: "6h 24m", logHref: "/timer", entries: [
    { title: "Acme Studio — homepage pass", meta: "9:02 AM – 10:26 AM", duration: "1h 24m" },
    { title: "Northwind — intake fixes", meta: "11:00 AM – 1:05 PM", duration: "2h 05m" },
    { title: "Bluefin — menu update", meta: "2:15 PM – 3:10 PM", duration: "0h 55m" },
    { title: "Harbor — billing call", meta: "4:00 PM – 4:30 PM", duration: "0h 30m" },
    { title: "Acme Studio — review", meta: "5:00 PM – 6:30 PM", duration: "1h 30m" },
  ]},
  { weekday: "Tue", dateLabel: "Nov 3", total: "5h 12m", isToday: true, logHref: "/timer", entries: [
    { title: "Northwind — case dashboard", meta: "9:00 AM – 12:00 PM", duration: "3h 00m" },
    { title: "Acme Studio — deploy", meta: "1:00 PM – 3:12 PM", duration: "2h 12m", invoiced: true },
  ]},
  { weekday: "Wed", dateLabel: "Nov 4", total: "0h", logHref: "/timer", entries: [] },
  { weekday: "Thu", dateLabel: "Nov 5", total: "7h 05m", logHref: "/timer", entries: [
    { title: "Harbor — records import", meta: "8:30 AM – 12:00 PM", duration: "3h 30m" },
    { title: "Bluefin — POS fixes", meta: "1:00 PM – 4:35 PM", duration: "3h 35m" },
  ]},
  { weekday: "Fri", dateLabel: "Nov 6", total: "4h 40m", logHref: "/timer", entries: [
    { title: "Acme Studio — QA pass", meta: "9:00 AM – 1:40 PM", duration: "4h 40m" },
  ]},
  { weekday: "Sat", dateLabel: "Nov 7", total: "1h 05m", logHref: "/timer", entries: [
    { title: "Northwind — review call", meta: "10:00 AM – 11:05 AM", duration: "1h 05m" },
  ]},
  { weekday: "Sun", dateLabel: "Nov 8", total: "0h", logHref: "/timer", entries: [] },
];

const DRAG_SCRIPT = `<script>
(function () {
  var viz = document.querySelector(".ui-viz");
  if (!viz) return;
  var HOUR = +viz.dataset.hourPx, START = +viz.dataset.startMin, END = +viz.dataset.endMin;
  function toMin(hhmm) { var p = hhmm.split(":"); return (+p[0]) * 60 + (+p[1]); }
  function hhmm(min) { return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); }
  function snap(min) { return Math.round(min / 15) * 15; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function fmt(min) {
    var h24 = Math.floor(min / 60), m = min % 60, s = h24 >= 12 ? "PM" : "AM", h = h24 % 12 === 0 ? 12 : h24 % 12;
    return h + ":" + String(m).padStart(2, "0") + " " + s;
  }
  function fmtDur(min) { return Math.floor(min / 60) + "h " + String(min % 60).padStart(2, "0") + "m"; }
  function paint(block, start, end) {
    block.style.top = ((start - START) / 60 * HOUR + 2) + "px";
    block.style.height = Math.max((end - start) / 60 * HOUR - 4, 22) + "px";
    block.dataset.start = hhmm(start); block.dataset.end = hhmm(end);
    if (!block.classList.contains("is-running")) {
      block.querySelector(".ui-viz-block-meta").textContent = fmt(start) + " – " + fmt(end);
    }
    var col = block.closest(".ui-viz-col");
    var cols = Array.prototype.slice.call(viz.querySelectorAll(".ui-viz-col"));
    var totals = viz.querySelectorAll("[data-day-total]");
    var totalEl = totals[cols.indexOf(col)];
    if (totalEl) {
      var sum = 0;
      col.querySelectorAll(".ui-viz-block").forEach(function (b) { sum += toMin(b.dataset.end) - toMin(b.dataset.start); });
      totalEl.textContent = fmtDur(sum);
    }
  }
  function locked(block) { return block.classList.contains("is-running") || block.classList.contains("is-locked"); }
  var active = null;
  viz.addEventListener("pointerdown", function (e) {
    var block = e.target.closest(".ui-viz-block");
    if (!block || locked(block) || active) return;
    var handle = e.target.closest("[data-resize]");
    var col = block.closest(".ui-viz-col");
    var pointerMin = START + (e.clientY - col.getBoundingClientRect().top) / HOUR * 60;
    active = {
      id: e.pointerId, block: block, col: col,
      mode: handle ? handle.getAttribute("data-resize") : "move",
      grabOffset: pointerMin - toMin(block.dataset.start),
      origStart: toMin(block.dataset.start), origEnd: toMin(block.dataset.end)
    };
    block.classList.add("is-selected");
    e.preventDefault();
  });
  window.addEventListener("pointermove", function (e) {
    if (!active || e.pointerId !== active.id) return;
    var pointerMin = START + (e.clientY - active.col.getBoundingClientRect().top) / HOUR * 60;
    var s = active.origStart, en = active.origEnd, dur = en - s;
    if (active.mode === "move") { s = clamp(snap(pointerMin - active.grabOffset), START, END - dur); en = s + dur; }
    if (active.mode === "start") { s = clamp(snap(pointerMin), START, active.origEnd - 15); }
    if (active.mode === "end") { en = clamp(snap(pointerMin), active.origStart + 15, END); }
    paint(active.block, s, en);
  });
  function endDrag(e) {
    if (!active || (e && e.pointerId !== active.id)) return;
    active.block.classList.remove("is-selected");
    active = null;
  }
  window.addEventListener("pointerup", endDrag);
  window.addEventListener("pointercancel", endDrag);
  viz.addEventListener("keydown", function (e) {
    var block = e.target.closest(".ui-viz-block");
    if (!block || locked(block)) return;
    var s = toMin(block.dataset.start), en = toMin(block.dataset.end), used = true;
    if (e.key === "ArrowDown" && e.shiftKey) en = clamp(en + 15, s + 15, END);
    else if (e.key === "ArrowUp" && e.shiftKey) en = clamp(en - 15, s + 15, END);
    else if (e.key === "ArrowDown") { var d = clamp(s + 15, START, END - (en - s)); en += d - s; s = d; }
    else if (e.key === "ArrowUp") { var u = clamp(s - 15, START, END - (en - s)); en += u - s; s = u; }
    else used = false;
    if (used) { e.preventDefault(); paint(block, s, en); }
  });
})();
</script>`;

export const calendarStories: Story[] = [
  {
    id: "calendar-week-grid",
    group: "Calendar",
    title: "Week view (grid at wide, agenda at narrow)",
    render: () => weekView({ days: DAYS }),
  },
  {
    id: "calendar-agenda",
    group: "Calendar",
    title: "Agenda (narrow container)",
    render: () => `<div style="max-width:520px">${weekView({ days: DAYS })}</div>`,
  },
  {
    id: "calendar-visualizer",
    group: "Calendar",
    title: "Visualizer — drag to move, handles to resize",
    render: () =>
      visualizer({
        nowMin: 845,
        days: [
          { date: "2026-11-02", label: "Mon Nov 2", total: "1h 24m", entries: [{ id: "e1", title: "Acme — homepage pass", startMin: 542, endMin: 626 }] },
          { date: "2026-11-03", label: "Tue Nov 3", total: "6h 57m", isToday: true, entries: [
            { id: "e2", title: "Northwind — case dashboard", startMin: 540, endMin: 720 },
            { id: "e3", title: "Acme — deploy", startMin: 780, endMin: 912, invoiced: true, locked: true },
            { id: "e4", title: "Bluefin — POS fixes", startMin: 845, endMin: 905, running: true },
            { id: "e5", title: "Harbor — overlap demo", startMin: 690, endMin: 750, overlap: true },
          ]},
          { date: "2026-11-04", label: "Wed Nov 4", total: "3h 00m", entries: [{ id: "e6", title: "Harbor — import", startMin: 510, endMin: 690 }] },
          { date: "2026-11-05", label: "Thu Nov 5", total: "0h", entries: [] },
          { date: "2026-11-06", label: "Fri Nov 6", total: "4h 40m", entries: [{ id: "e7", title: "Acme — QA pass", startMin: 540, endMin: 820 }] },
          { date: "2026-11-07", label: "Sat Nov 7", total: "0h", entries: [] },
          { date: "2026-11-08", label: "Sun Nov 8", total: "0h", entries: [] },
        ],
      }) + DRAG_SCRIPT,
  },
];
