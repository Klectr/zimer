/* #293: payment-terms dropdowns show their canned description as helper
   text, updated live on change. Delegated on document so it survives HTMX
   swaps (manage list re-renders, settings modal loads lazily). */
document.addEventListener("change", function (e) {
  var t = e.target;
  if (!t || !t.classList || !t.classList.contains("terms-select")) return;
  var scope = t.closest("li") || t.closest("#biz-profile") || t.closest("form");
  var desc = scope && scope.querySelector(".terms-desc");
  var opt = t.options[t.selectedIndex];
  if (desc && opt) desc.textContent = opt.getAttribute("data-desc") || "";
});
