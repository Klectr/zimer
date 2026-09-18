/** #340: app version. Read once from the VERSION file at the repo root
 *  (baked into release tarballs). Working copies without one report
 *  0.0.0-dev, which never matches the release feed. node:fs (sync) because
 *  license validation needs the major version synchronously. */

import { readFileSync } from "node:fs";

let cached: string | null = null;

export function appVersion(): string {
  if (cached !== null) return cached;
  try {
    cached = readFileSync(new URL("../../VERSION", import.meta.url), "utf8").trim() || "0.0.0-dev";
  } catch {
    cached = "0.0.0-dev";
  }
  return cached;
}

/** Major version as an integer (1 for "1.2.3"). 0 for dev/unknown. */
export function appMajor(): number {
  const m = /^(\d+)\./.exec(appVersion());
  return m ? parseInt(m[1], 10) : 0;
}
