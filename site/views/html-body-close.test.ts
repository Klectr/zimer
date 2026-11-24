/** #1503: every page shell that opens <body> also closes it before </html> —
 *  the public invoice, privacy, changelog, and terms shells and the public
 *  error shell were the only ones missing the closing tag. */
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

describe("html body close (#1503)", () => {
  test("every <body> opened in site sources is closed in the same file", () => {
    const offenders: string[] = [];
    for (const path of sources(siteDir)) {
      const text = readFileSync(path, "utf8");
      const opened = (text.match(/<body(?=[\s>])/g) ?? []).length;
      const closed = (text.match(/<\/body>/g) ?? []).length;
      if (opened !== closed) offenders.push(`${path}: ${opened} opened, ${closed} closed`);
    }
    expect(offenders).toEqual([]);
  });
});
