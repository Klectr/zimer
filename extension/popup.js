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
      await maybeSuggest();
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

/* Milestone 15: autotracker — rule-based project suggestions. Rules live in
   chrome.storage.sync as [{id, pattern, projectId, projectName}]. Matching is a
   pure function so it can be unit-tested outside the browser. */
function matchRule(rules, title, url) {
  const hay = `${title || ""} ${url || ""}`.toLowerCase();
  return (rules || []).find((r) => r.pattern && hay.includes(String(r.pattern).toLowerCase())) || null;
}
async function getRules() {
  const s = await chrome.storage.sync.get(["rules"]);
  return Array.isArray(s.rules) ? s.rules : [];
}
async function saveRules(rules) {
  await chrome.storage.sync.set({ rules });
}
async function activeTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ? { title: tab.title || "", url: tab.url || "" } : { title: "", url: "" };
  } catch { return { title: "", url: "" }; }
}
function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}
async function renderRules() {
  const rules = await getRules();
  const projects = await api("/api/projects").catch(() => []);
  const pmap = Object.fromEntries(projects.map((p) => [String(p.id), p]));
  const list = $("rules-list");
  list.innerHTML = rules.length ? "" : `<div class="muted tiny">No rules yet — add one for the site you're on.</div>`;
  for (const r of rules) {
    const p = pmap[String(r.projectId)];
    const label = p ? `${escapeHtml(p.name)}${p.client_name ? ` (${escapeHtml(p.client_name)})` : ""}` : escapeHtml(r.projectName || "Unknown project");
    const row = document.createElement("div");
    row.className = "rule-row";
    row.innerHTML = `<span class="rule-pat">${escapeHtml(r.pattern)}</span><span class="rule-proj">${label}</span>`;
    const del = document.createElement("button");
    del.className = "ghost tiny-btn";
    del.textContent = "Delete";
    del.addEventListener("click", async () => {
      await saveRules((await getRules()).filter((x) => x.id !== r.id));
      await renderRules();
    });
    row.appendChild(del);
    list.appendChild(row);
  }
  // project picker for the add form
  const sel = $("rule-project");
  sel.innerHTML = projects.map((p) =>
    `<option value="${p.id}">${escapeHtml(p.name)}${p.client_name ? ` (${escapeHtml(p.client_name)})` : ""}</option>`
  ).join("");
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
    await api("/api/timer/start", {
      method: "POST",
      body: JSON.stringify({ description: $("in-desc").value.trim(), project_id: pid ? Number(pid) : null }),
    });
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

$("btn-rules").addEventListener("click", async () => {
  const panel = $("rules-panel");
  panel.classList.toggle("hidden");
  if (!panel.classList.contains("hidden")) {
    const { url } = await activeTabInfo();
    if (!$("rule-pattern").value) $("rule-pattern").value = domainOf(url);
    await renderRules();
  }
});
$("btn-add-rule").addEventListener("click", async () => {
  $("rules-error").textContent = "";
  const pattern = $("rule-pattern").value.trim();
  const projectId = $("rule-project").value;
  if (!pattern || !projectId) { $("rules-error").textContent = "Pattern and project are required."; return; }
  const projects = await api("/api/projects").catch(() => []);
  const p = projects.find((x) => String(x.id) === String(projectId));
  const rules = await getRules();
  rules.push({ id: "r" + Date.now().toString(36), pattern, projectId: Number(projectId),
               projectName: p ? p.name : "" });
  await saveRules(rules);
  $("rule-pattern").value = "";
  await renderRules();
});

/* Milestone 15.2: one-tap suggestion from the active tab. Never auto-starts. */
let suggestedRuleId = null;
async function maybeSuggest() {
  const panel = $("suggest-panel");
  panel.classList.add("hidden");
  suggestedRuleId = null;
  const rules = await getRules();
  if (!rules.length) return;
  const { title, url } = await activeTabInfo();
  if (!title && !url) return;
  const rule = matchRule(rules, title, url);
  if (!rule) return;
  const projects = await api("/api/projects").catch(() => []);
  const p = projects.find((x) => String(x.id) === String(rule.projectId));
  if (!p) return; // project gone from server — leave the rule alone
  suggestedRuleId = rule.id;
  $("suggest-text").innerHTML = `Start <strong>${escapeHtml(p.name)}</strong>${p.client_name ? ` (${escapeHtml(p.client_name)})` : ""}?`;
  $("suggest-desc").textContent = title || url;
  panel.classList.remove("hidden");
}
$("btn-suggest-start").addEventListener("click", async () => {
  $("main-error").textContent = "";
  const rules = await getRules();
  const rule = rules.find((r) => r.id === suggestedRuleId);
  if (!rule) return;
  const { title } = await activeTabInfo();
  $("btn-suggest-start").disabled = true;
  try {
    await api("/api/timer/start", {
      method: "POST",
      body: JSON.stringify({ description: (title || "").slice(0, 200), project_id: Number(rule.projectId) }),
    });
    await refresh();
  } catch (e) {
    $("main-error").textContent = e.message;
  } finally {
    $("btn-suggest-start").disabled = false;
  }
});
$("btn-suggest-dismiss").addEventListener("click", () => {
  $("suggest-panel").classList.add("hidden");
  suggestedRuleId = null;
});

/* init */
(async () => {
  if (await getSettings()) { show("main"); await refresh(); }
  else show("setup");
})();
