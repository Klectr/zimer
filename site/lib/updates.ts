/** #340: release feed + "check for updates".
 *
 *  The feed lives at https://invoices.tristonarmstrong.com/releases/feed.json:
 *    { "releases": { "1": { "version": "1.2.3",
 *                           "url": "https://.../releases/timekeep-1.2.3.tgz",
 *                           "sha256": "<hex>" } } }
 *  One entry per major version; empty until v1.0.0 is cut.
 *
 *  Privacy: the check is MANUAL — a button in Settings, never automatic.
 *  Nothing phones home unless the user asks. The fetch runs server-side
 *  (the browser never sees the feed URL) and fails soft to "unreachable".
 */

import { appVersion, appMajor } from "./version.ts";
import { esc } from "./format.ts";
import { icon } from "./icons.ts";
import { licenseBuyUrl, licensePrice } from "./license.ts";

const DEFAULT_FEED_URL = "https://invoices.tristonarmstrong.com/releases/feed.json";

export function releasesFeedUrl(): string {
  return (process.env.TIMEKEEP_RELEASES_URL || "").trim() || DEFAULT_FEED_URL;
}

/** install.sh sits next to feed.json in the releases dir. */
export function installScriptUrl(): string {
  return releasesFeedUrl().replace(/feed\.json$/, "install.sh");
}

export interface ReleaseInfo {
  version: string;
  url: string;
  sha256: string;
}

export type UpdateStatus =
  | { kind: "up-to-date"; version: string }
  | { kind: "no-releases" }
  | { kind: "update-available"; current: string; latest: ReleaseInfo }
  | { kind: "major-available"; current: string; latest: ReleaseInfo }
  | { kind: "unreachable" }
  | { kind: "dev" };

/* Numeric dot-separated compare: 1.10.0 > 1.9.0. Non-numeric tails are
   ignored ("1.0.0-dev" compares as 1.0.0). */
export function cmpVersions(a: string, b: string): number {
  const pa = a.split(".").map(s => parseInt(s, 10) || 0);
  const pb = b.split(".").map(s => parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  const current = appVersion();
  const major = appMajor();
  if (major === 0) return { kind: "dev" };
  let feed: { releases?: Record<string, ReleaseInfo> };
  try {
    const res = await fetch(releasesFeedUrl(), { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return { kind: "unreachable" };
    feed = (await res.json()) as typeof feed;
  } catch {
    return { kind: "unreachable" };
  }
  const releases = feed?.releases ?? {};
  /* A newer major than this install's key covers: the v1 key won't validate
     on v2, so say so plainly and point at the buy flow. */
  const newerMajors = Object.keys(releases)
    .map(Number)
    .filter(n => Number.isInteger(n) && n > major)
    .sort((x, y) => x - y);
  if (newerMajors.length > 0) {
    const latest = releases[String(newerMajors[newerMajors.length - 1])];
    if (latest?.version) return { kind: "major-available", current, latest };
  }
  const same = releases[String(major)];
  if (!same?.version) return { kind: "no-releases" };
  return cmpVersions(same.version, current) > 0
    ? { kind: "update-available", current, latest: same }
    : { kind: "up-to-date", version: current };
}

/* Rendered into #update-status via hx-post /check-updates. */
export function updateStatusHtml(s: UpdateStatus): string {
  switch (s.kind) {
    case "up-to-date":
      return `<p class="licensed-ok">${icon("check")}<span>You're up to date — <strong>v${esc(s.version)}</strong>.</span></p>`;
    case "no-releases":
      return `<p class="muted">No releases published yet — you're running a pre-release build.</p>`;
    case "update-available": {
      const cmd = `curl -fsSL ${installScriptUrl()} | bash`;
      return `<p><strong>v${esc(s.latest.version)} is available</strong> (you're on v${esc(s.current)}).</p>
        <p class="muted">Update by re-running the installer — your data, token, and settings are preserved:</p>
        <p><code class="update-cmd">${esc(cmd)}</code></p>`;
    }
    case "major-available": {
      const buyUrl = licenseBuyUrl();
      const buy = buyUrl
        ? `<p><a class="md-filled-button" href="${esc(buyUrl)}" target="_blank" rel="noopener">${icon("card")}<span>Buy a v${esc(String(s.latest.version).split(".")[0])} license — ${esc(licensePrice())}</span></a></p>`
        : "";
      return `<p><strong>v${esc(s.latest.version)} is available</strong> — it's a new major version, so it needs a new license key (your current key keeps working on v${esc(s.current.split(".")[0])}.x forever).</p>
        ${buy}`;
    }
    case "unreachable":
      return `<p class="license-error" role="alert">Couldn't reach the update server. Check your connection and try again.</p>`;
    case "dev":
      return `<p class="muted">Development build — update checks are disabled.</p>`;
  }
}

/* #340: Updates section in the Settings modal. Shown in beta and to licensed
   users in launch mode; hidden when unpaid in launch mode (#345). The check
   itself is manual. */
export function updateSectionHtml(): string {
  return `<section id="update-section">
      <h2 class="md-headline-small">Updates</h2>
      <div id="update-status"><p class="muted">Timekeep v${esc(appVersion())}. Press the button to check for new releases.</p></div>
      <div class="manage-form-row">
        <span class="manage-form-spacer"></span>
        <button class="md-tonal-button" type="button" hx-post="/check-updates" hx-target="#update-status" hx-swap="innerHTML">${icon("refresh")}Check for updates</button>
      </div>
    </section>`;
}
