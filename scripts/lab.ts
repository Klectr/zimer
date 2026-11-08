import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esc } from "../site/lib/format";
import type { Story } from "../site/ui/story";
import { buttonStories } from "../site/ui/button";
import { parseDesignTokens } from "./design-tokens";

const LAB_NAME = "Zandbox";
const ROOT = join(import.meta.dir, "..");
const PORT = Number(process.env.LAB_PORT || 8935);
if (!Number.isFinite(PORT)) throw new Error(`LAB_PORT is not a number: ${process.env.LAB_PORT}`);

function designTokens(): [string, string][] {
  return parseDesignTokens(readFileSync(join(ROOT, "DESIGN.md"), "utf8"));
}

const tokenStories: Story[] = [
  {
    id: "tokens-color",
    group: "Tokens",
    title: "Color — from DESIGN.md",
    render: () =>
      `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">` +
      designTokens()
        .map(
          ([name, value]) =>
            `<div style="border:1px solid var(--md-sys-color-outline-variant);border-radius:12px;overflow:hidden">` +
            `<div style="height:44px;background:${esc(value)}"></div>` +
            `<div style="padding:8px 10px"><div style="font-size:12px">${esc(name)}</div>` +
            `<div style="font-size:12px;opacity:.65">${esc(value)}</div></div></div>`,
        )
        .join("") +
      `</div>`,
  },
];

const STORIES: Story[] = [...tokenStories, ...buttonStories];

const seenIds = new Set<string>();
for (const s of STORIES) {
  if (!/^[a-z0-9-]+$/.test(s.id)) throw new Error(`Story id must be lowercase letters, digits, dashes: ${s.id}`);
  if (seenIds.has(s.id)) throw new Error(`Duplicate story id: ${s.id}`);
  seenIds.add(s.id);
}

const LAB_CSS = `
  body{margin:0}
  .lab-wrap{max-width:1080px;margin:0 auto;padding:24px}
  .lab-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px}
  .lab-head h1{font-size:22px;margin:0}
  .lab-head span{opacity:.6;font-size:13px}
  .lab-nav{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 22px}
  .lab-nav a{font-size:13px;padding:5px 11px;border:1px solid var(--md-sys-color-outline-variant);border-radius:999px;color:inherit;text-decoration:none}
  .lab-story{margin-bottom:30px}
  .lab-story h2{font-size:15px;margin:0 0 4px}
  .lab-story h2 span{opacity:.55;font-weight:400}
  .lab-frame{border:1px dashed var(--md-sys-color-outline-variant);border-radius:12px;padding:20px}
  .lab-frame a{font-size:12px;opacity:.6;color:inherit}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(LAB_NAME)}</title>
<script src="https://unpkg.com/htmx.org@2.0.4"></script>
<link rel="stylesheet" href="/static/style.css">
<style>${LAB_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}

function indexPage(): string {
  const nav = STORIES.map(
    (s) => `<a href="#${esc(s.id)}">${esc(s.group)} · ${esc(s.title)}</a>`,
  ).join("");
  const sections = STORIES.map((s) => {
    let body: string;
    try {
      body = s.render();
    } catch (err) {
      body = `<p style="color:var(--md-sys-color-error)">Story failed to render: ${esc(err instanceof Error ? err.message : String(err))}</p>`;
    }
    return (
      `<section class="lab-story" id="${esc(s.id)}"><h2>${esc(s.group)} — ${esc(s.title)} ` +
      `<span><a href="/canvas/${esc(s.id)}">open canvas</a></span></h2>` +
      `<div class="lab-frame">${body}</div></section>`
    );
  }).join("\n");
  return page(
    "Components",
    `<div class="lab-wrap"><div class="lab-head"><h1>${esc(LAB_NAME)}</h1>` +
      `<span>dev only · fictional data · styles: the app's real style.css</span></div>` +
      `<nav class="lab-nav">${nav}</nav>${sections}</div>`,
  );
}

function canvasPage(story: Story): string {
  return page(
    `${story.group} — ${story.title}`,
    `<div style="padding:20px">${story.render()}</div>`,
  );
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/") return new Response(indexPage(), { headers: { "content-type": "text/html; charset=utf-8" } });
    if (url.pathname === "/static/style.css") {
      return new Response(readFileSync(join(ROOT, "site/static/style.css"), "utf8"), {
        headers: { "content-type": "text/css; charset=utf-8" },
      });
    }
    const canvas = url.pathname.match(/^\/canvas\/([\w-]+)$/);
    if (canvas) {
      const story = STORIES.find((s) => s.id === canvas[1]);
      if (story) return new Response(canvasPage(story), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
});

console.log(`${LAB_NAME} → http://127.0.0.1:${server.port}`);
