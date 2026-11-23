/* Timekeep background worker — global hotkey toggles the timer. Vanilla JS, no build step.
   The toggle decision is a pure function so it can be unit-tested in Node. */

/* Returns "stop" when a timer is running, "start" otherwise. */
function decideToggle(running) {
  return running ? "stop" : "start";
}

function dropStaleProject(lastTimer) {
  if (!lastTimer) return lastTimer;
  return { ...lastTimer, projectId: null };
}

function isStaleProjectError(e) {
  return !!e && e.status === 400 && e.serverError === "project_id not found";
}

async function api(path, opts = {}) {
  const { siteUrl, token } = await chrome.storage.sync.get(["siteUrl", "token"]);
  const base = (siteUrl || "").replace(/\/+$/, "");
  if (!base || !token) throw new Error("Extension not configured.");
  const res = await fetch(base + path, {
    ...opts,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let serverError = "";
    try {
      const data = await res.json();
      serverError = (data && data.error) || "";
    } catch {}
    const err = new Error(serverError || `Request failed (${res.status})`);
    err.status = res.status;
    err.serverError = serverError;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function startTimer(lastTimer) {
  await api("/api/timer/start", {
    method: "POST",
    body: JSON.stringify({
      description: (lastTimer && lastTimer.description) || "",
      project_id: (lastTimer && lastTimer.projectId) || null,
    }),
  });
}

async function toggleTimer() {
  const { running } = await api("/api/status");
  if (decideToggle(running) === "stop") {
    await api("/api/timer/stop", { method: "POST" });
    return "stopped";
  }
  const { lastTimer } = await chrome.storage.sync.get(["lastTimer"]);
  try {
    await startTimer(lastTimer);
  } catch (e) {
    if (!isStaleProjectError(e) || !(lastTimer && lastTimer.projectId)) throw e;
    const { lastTimer: current } = await chrome.storage.sync.get(["lastTimer"]);
    if (current && current.projectId === lastTimer.projectId) {
      const cleared = dropStaleProject(current);
      await chrome.storage.sync.set({ lastTimer: cleared });
      await startTimer(cleared);
    } else {
      await startTimer(current || dropStaleProject(lastTimer));
    }
  }
  return "started";
}

if (typeof chrome !== "undefined" && chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command !== "toggle-timer") return;
    try { await toggleTimer(); } catch (e) { console.warn("[zimer] hotkey toggle failed:", e.message); }
  });
}

if (typeof module !== "undefined") module.exports = { decideToggle, dropStaleProject, isStaleProjectError, toggleTimer };
