/** #303: public changelog. Reads CHANGELOG.md (repo root, deployed with the
 *  app), parses "## YYYY-MM-DD" sections and "- " bullets, and renders them
 *  with a tiny markdown subset (paragraphs, **bold**). Zero dependencies.
 *  #519: in a compiled binary the file ships in the exe-relative
 *  resources dir instead. */

import { esc } from "./format.ts";
import { resourcePath } from "./paths.ts";

export interface ChangelogEntry {
  date: string;
  items: string[];
}

let cache: ChangelogEntry[] | null = null;

function inlineMd(s: string): string {
  /* **bold** -> <strong>. Escape first, then restore the strong tags. */
  return esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export async function loadChangelog(): Promise<ChangelogEntry[]> {
  if (cache) return cache;
  const path = resourcePath("CHANGELOG.md", new URL("../../CHANGELOG.md", import.meta.url).pathname);
  let text = "";
  try {
    text = await Bun.file(path).text();
  } catch {
    cache = [];
    return cache;
  }
  const entries: ChangelogEntry[] = [];
  let cur: ChangelogEntry | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (line.startsWith("## ")) {
      cur = { date: line.slice(3).trim(), items: [] };
      entries.push(cur);
    } else if (line.startsWith("- ") && cur) {
      cur.items.push(inlineMd(line.slice(2).trim()));
    }
  }
  cache = entries.filter(e => e.items.length > 0);
  return cache;
}
