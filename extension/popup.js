/* Timekeep extension popup — vanilla JS, no build step. */

const $ = (id) => document.getElementById(id);

let siteUrl = "";
let token = "";
let tickTimer = null;

async function getSettings() {
  const s = await chrome.storage.sync.get(["siteUrl", "token"]);
  siteUrl = (s.siteUrl || "").replace(/\/+$/, "");
  token = s.token || "";
  return siteUrl && token;
}

async function api(path, opts = {}) {
  const res = await fetch(siteUrl + path, {
    ...opts,
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (res.status === 401) throw new Error("Bad token — check settings.");
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

function show(view) {
  $("view-setup").classList.toggle("hidden", view !== "setup");
  $("view-main").classList.toggle("hidden", view !== "main");
}

function stopTicking() {
  if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
}

function startTicking(startIso) {
  stopTicking();
  const t0 = new Date(startIso).getTime();
  const el = $("run-elapsed");
  const tick = () => {
    const d = Math.max(0, Date.now() - t0);
    const h = Math.floor(d / 36e5), m = Math.floor((d % 36e5) / 6e4), s = Math.floor((d % 6e4) / 1e3);
    el.textContent = (h ? h + ":" : "") + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  };
  tick();
  tickTimer = setInterval(tick, 1000);
}

async function refresh() {
  $("main-error").textContent = "";
  try {
    const { running } = await api("/api/status");
    const isRunning = !!running;
    $("timer-running").classList.toggle("hidden", !isRunning);
    $("timer-idle").classList.toggle("hidden", isRunning);
    if (isRunning) {
      $("run-desc").textContent = running.description || "No description";
      $("run-proj").textContent = [running.project_name, running.client_name].filter(Boolean).join(" · ");
      startTicking(running.start_time);
    } else {
      stopTicking();
      await loadProjects();
    }
  } catch (e) {
    $("main-error").textContent = e.message;
  }
}

async function loadProjects() {
  try {
    const projects = await api("/api/projects");
    const sel = $("in-project");
    sel.innerHTML = `<option value="">No project</option>` + projects.map((p) =>
      `<option value="${p.id}">${escapeHtml(p.name)}${p.client_name ? ` (${escapeHtml(p.client_name)})` : ""}</option>`
    ).join("");
  } catch { /* leave the empty default */ }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* wiring */
$("btn-save").addEventListener("click", async () => {
  const url = $("site-url").value.trim().replace(/\/+$/, "");
  const tok = $("api-token").value.trim();
  $("setup-error").textContent = "";
  if (!url || !tok) { $("setup-error").textContent = "Both fields are required."; return; }
  let origin;
  try { origin = new URL(url).origin + "/*"; }
  catch { $("setup-error").textContent = "That URL doesn't look valid."; return; }
  try {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (!granted) { $("setup-error").textContent = "Permission denied — can't talk to that site."; return; }
    await chrome.storage.sync.set({ siteUrl: url, token: tok });
    siteUrl = url; token = tok;
    show("main");
    await refresh();
  } catch (e) {
    $("setup-error").textContent = e.message;
  }
});

$("btn-start").addEventListener("click", async () => {
  $("main-error").textContent = "";
  $("btn-start").disabled = true;
  try {
    const pid = $("in-project").value;
    const desc = $("in-desc").value.trim();
    await api("/api/timer/start", {
      method: "POST",
      body: JSON.stringify({ description: desc, project_id: pid ? Number(pid) : null }),
    });
    // remember for the global hotkey (Milestone 16)
    await chrome.storage.sync.set({ lastTimer: { description: desc, projectId: pid ? Number(pid) : null } });
    $("in-desc").value = "";
    await refresh();
  } catch (e) {
    $("main-error").textContent = e.message;
  } finally {
    $("btn-start").disabled = false;
  }
});

$("btn-stop").addEventListener("click", async () => {
  $("main-error").textContent = "";
  try {
    await api("/api/timer/stop", { method: "POST" });
    await refresh();
  } catch (e) {
    $("main-error").textContent = e.message;
  }
});

$("btn-open").addEventListener("click", () => chrome.tabs.create({ url: siteUrl || "http://localhost:3000" }));
$("btn-settings").addEventListener("click", () => {
  stopTicking();
  $("site-url").value = siteUrl;
  $("api-token").value = token;
  show("setup");
});

/* init */
(async () => {
  if (await getSettings()) { show("main"); await refresh(); }
  else show("setup");
})();
