import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esc } from "./esc";
import type { Story } from "./story";
import type { ZandboxConfig } from "./config";
import { parseDesignTokens } from "./design-tokens";

const ROOT = process.cwd();
let cfgModule: { default?: unknown };
try {
  cfgModule = await import(join(ROOT, "zandbox.config.ts"));
} catch (err) {
  throw new Error(
    `Zandbox: could not load zandbox.config.ts from ${ROOT} — run Zandbox from a project root containing zandbox.config.ts (${err instanceof Error ? err.message : String(err)})`,
  );
}
if (!cfgModule.default || typeof cfgModule.default !== "object" || !Array.isArray((cfgModule.default as ZandboxConfig).stories)) {
  throw new Error("Zandbox: zandbox.config.ts must default-export a config object with a stories array");
}
const cfg = cfgModule.default as ZandboxConfig;
const NAME = cfg.name ?? "Zandbox";
const PORT = Number(process.env.ZANDBOX_PORT || cfg.port || 8935);
if (!Number.isFinite(PORT)) throw new Error(`Zandbox port is not a number: ${process.env.ZANDBOX_PORT ?? cfg.port}`);

function tokenStories(): Story[] {
  if (!cfg.designMd) return [];
  const tokens = parseDesignTokens(readFileSync(join(ROOT, cfg.designMd), "utf8"));
  return [
    {
      id: "tokens-color",
      group: "Tokens",
      title: "Color — from DESIGN.md",
      render: () =>
        `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px">` +
        tokens
          .map(
            ([name, value]) =>
              `<div style="border:1px solid var(--zb-border);border-radius:12px;overflow:hidden">` +
              `<div style="height:44px;background:${esc(value)}"></div>` +
              `<div style="padding:8px 10px"><div style="font-size:12px">${esc(name)}</div>` +
              `<div style="font-size:12px;opacity:.65">${esc(value)}</div></div></div>`,
          )
          .join("") +
        `</div>`,
    },
  ];
}

const STORIES: Story[] = [...tokenStories(), ...(cfg.stories ?? [])];

const seenIds = new Set<string>();
for (const s of STORIES) {
  if (!s || typeof s.render !== "function" || typeof s.group !== "string" || typeof s.title !== "string") {
    throw new Error(`Invalid story (needs id, group, title, render): ${JSON.stringify(s)?.slice(0, 80)}`);
  }
  if (!/^[a-z0-9-]+$/.test(s.id)) throw new Error(`Story id must be lowercase letters, digits, dashes: ${s.id}`);
  if (seenIds.has(s.id)) throw new Error(`Duplicate story id: ${s.id}`);
  seenIds.add(s.id);
}

const LAB_CSS = `
  :root{--zb-border:rgba(127,127,127,.35)}
  body{margin:0}
  .zb-wrap{max-width:1080px;margin:0 auto;padding:24px}
  .zb-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:6px}
  .zb-head h1{font-size:22px;margin:0}
  .zb-head span{opacity:.6;font-size:13px}
  .zb-nav{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 22px}
  .zb-nav a{font-size:13px;padding:5px 11px;border:1px solid var(--zb-border);border-radius:999px;color:inherit;text-decoration:none}
  .zb-story{margin-bottom:30px}
  .zb-story h2{font-size:15px;margin:0 0 4px}
  .zb-story h2 span{opacity:.55;font-weight:400}
  .zb-frame{border:1px dashed var(--zb-border);border-radius:12px;padding:20px}
`;

const ASSET_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function assetType(path: string): string {
  const dot = path.lastIndexOf(".");
  return ASSET_TYPES[dot === -1 ? "" : path.slice(dot)] ?? "application/octet-stream";
}

function page(title: string, body: string): string {
  const hrefs = Object.keys(cfg.assets ?? {});
  const links = hrefs
    .filter((href) => href.endsWith(".css"))
    .map((href) => `<link rel="stylesheet" href="${esc(href)}">`)
    .join("\n");
  const scripts = hrefs
    .filter((href) => href.endsWith(".js") || href.endsWith(".mjs"))
    .map((href) => `<script src="${esc(href)}" defer></script>`)
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(NAME)}</title>
<script src="${esc(cfg.htmxUrl ?? "https://unpkg.com/htmx.org@2.0.4")}"></script>
${links}
${scripts}
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
      body = `<p style="color:#f87171">Story failed to render: ${esc(err instanceof Error ? err.message : String(err))}</p>`;
    }
    return (
      `<section class="zb-story" id="${esc(s.id)}"><h2>${esc(s.group)} — ${esc(s.title)} ` +
      `<span><a href="/canvas/${esc(s.id)}">open canvas</a></span></h2>` +
      `<div class="zb-frame">${body}</div></section>`
    );
  }).join("\n");
  return page(
    "Components",
    `<div class="zb-wrap"><div class="zb-head"><h1>${esc(NAME)}</h1>` +
      `<span>dev only · fictional data · styles: the project's own assets</span></div>` +
      `<nav class="zb-nav">${nav}</nav>${sections}</div>`,
  );
}

function canvasPage(story: Story): string {
  let body: string;
  try {
    body = story.render();
  } catch (err) {
    body = `<p style="color:#f87171">Story failed to render: ${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
  return page(`${story.group} — ${story.title}`, `<div style="padding:20px">${body}</div>`);
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    const html = { "content-type": "text/html; charset=utf-8" };
    if (url.pathname === "/") return new Response(indexPage(), { headers: html });
    const asset = (cfg.assets ?? {})[url.pathname];
    if (asset) {
      try {
        return new Response(readFileSync(join(ROOT, asset)), { headers: { "content-type": assetType(asset) } });
      } catch {
        return new Response("Asset not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    }
    const canvas = url.pathname.match(/^\/canvas\/([\w-]+)$/);
    if (canvas) {
      const story = STORIES.find((s) => s.id === canvas[1]);
      if (story) return new Response(canvasPage(story), { headers: html });
    }
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  },
});

console.log(`${NAME} → http://127.0.0.1:${server.port} (${STORIES.length} stories)`);
