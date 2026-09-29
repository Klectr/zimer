/* Timekeep extension — pure autotracker rule helpers.
 *
 * No DOM, no chrome APIs: popup.js imports this as a module and bun:test
 * imports it directly. Keep it side-effect free. */

/* Milestone 15: rule-based project suggestions. Rules are
 * [{id, pattern, projectId, projectName}] in chrome.storage.sync.
 * Returns the first rule whose pattern appears in the page title or URL. */
export function matchRule(rules, title, url) {
  const hay = `${title || ""} ${url || ""}`.toLowerCase();
  return (rules || []).find((r) => r.pattern && hay.includes(String(r.pattern).toLowerCase())) || null;
}

/* #641: adding a pattern that already has a rule must update that rule's
 * project, not stack a dead duplicate the matcher would never reach
 * (matchRule only ever returns the first hit). Comparison is on the
 * trimmed, case-insensitive pattern; the stored pattern keeps its original
 * casing. Returns { rules, updated } — `rules` is the same array. */
export function upsertRule(rules, pattern, projectId, projectName) {
  const list = rules || [];
  const key = String(pattern).trim().toLowerCase();
  const existing = list.find((r) => String(r.pattern).trim().toLowerCase() === key);
  if (existing) {
    existing.projectId = Number(projectId);
    existing.projectName = projectName || "";
    return { rules: list, updated: true };
  }
  list.push({
    id: "r" + Date.now().toString(36),
    pattern: String(pattern).trim(),
    projectId: Number(projectId),
    projectName: projectName || "",
  });
  return { rules: list, updated: false };
}
