(function () {
  "use strict";
  try {
    var q = new URLSearchParams(window.location.search);
    var keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    var props = {};
    var found = false;
    for (var i = 0; i < keys.length; i++) {
      var v = q.get(keys[i]);
      if (v) {
        props[keys[i]] = v.slice(0, 200);
        found = true;
      }
    }
    if (found) localStorage.setItem("zimer_utm", JSON.stringify({ p: props, t: Date.now() }));
  } catch (e) {}
})();
