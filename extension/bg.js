/* Timekeep background worker — global hotkey toggles the timer. Vanilla JS, no build step.
   The toggle decision is a pure function so it can be unit-tested in Node. */

/* Returns "stop" when a timer is running, "start" otherwise. */
function decideToggle(running) {
  return running ? "stop" : "start";
}

async function api(path, opts = {}) {
  const { siteUrl, token } = await chrome.storage.sync.get(["siteUrl", "token"]);
  const base = (siteUrl || "").replace(/\/+$/, "");
  if (!base || !token) throw new Error("Extension not configured.");
  const res = await fetch(base + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.status === 204 ? null : res.json();
}

async function toggleTimer() {
  const { running } = await api("/api/status");
  if (decideToggle(running) === "stop") {
    await api("/api/timer/stop", { method: "POST" });
    return "stopped";
  }
  const { lastTimer } = await chrome.storage.sync.get(["lastTimer"]);
  await api("/api/timer/start", {
    method: "POST",
    body: JSON.stringify({
      description: (lastTimer && lastTimer.description) || "",
      project_id: (lastTimer && lastTimer.projectId) || null,
    }),
  });
  return "started";
}

if (typeof chrome !== "undefined" && chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "toggle-timer") return;
    try { await toggleTimer(); } catch (e) { console.warn("[timekeep] hotkey toggle failed:", e.message); }
  });
}

if (typeof module !== "undefined") module.exports = { decideToggle };
