/** #1317: every page shell declares lang="en" — screen readers use it to
 *  pick pronunciation. The standalone shells (billing wall, CSRF blocked,
 *  login, hosted auth) were the only ones missing it. */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const siteDir = join(import.meta.dir, "..");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(path);
  }
  return out;
}

describe("html lang (#1317)", () => {
  test("every <html> tag in site sources declares lang=\"en\"", () => {
    const offenders: string[] = [];
    for (const path of sources(siteDir)) {
      const text = readFileSync(path, "utf8");
      for (const m of text.matchAll(/<html[^>]*>/g)) {
        if (m[0] !== '<html lang="en">') offenders.push(`${path}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
