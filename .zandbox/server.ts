import { readFileSync } from "node:fs";
import { join } from "node:path";
import { esc } from "./esc";
import type { Story } from "./story";
import type { ZandboxConfig } from "./config";
import { parseDesignTokens } from "./design-tokens";
import { VERSION } from "./version";

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

const TOKENS: [string, string][] = cfg.designMd
  ? parseDesignTokens(readFileSync(join(ROOT, cfg.designMd), "utf8"))
  : [];

function tokenStories(): Story[] {
  if (!cfg.designMd) return [];
  const tokens = TOKENS;
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
  :root{--zb-border:rgba(127,127,127,.35);--zb-side-bg:#101012;--zb-hover:rgba(127,127,127,.14);--zb-active:rgba(127,127,127,.22)}
  html,body{height:100%}
  body{margin:0}
  .zb-shell{display:flex;min-height:100vh}
  .zb-side{width:264px;flex:none;background:var(--zb-side-bg);border-right:1px solid var(--zb-border);padding:18px 12px;position:sticky;top:0;height:100vh;overflow-y:auto;box-sizing:border-box}
  .zb-brand{font-size:17px;font-weight:600;padding:0 10px}
  .zb-brand-sub{font-size:12px;opacity:.55;padding:2px 10px 14px}
  .zb-filter{padding:0 10px 6px}
  .zb-filter input{width:100%;box-sizing:border-box;background:rgba(127,127,127,.08);border:1px solid var(--zb-border);border-radius:6px;padding:7px 10px;color:inherit;font-size:14px;font-family:inherit}
  .zb-filter input:focus-visible{outline:2px solid rgba(127,127,127,.6);outline-offset:1px}
  .zb-no-matches{font-size:13px;opacity:.55;padding:10px}
  .zb-group{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.55;padding:14px 10px 5px}
  .zb-item{display:block;padding:6px 10px;border-radius:6px;color:inherit;text-decoration:none;font-size:14px}
  .zb-item:hover{background:var(--zb-hover)}
  .zb-item.is-active{background:var(--zb-active);font-weight:600}
  .zb-main{flex:1;min-width:0;padding:24px 28px;box-sizing:border-box}
  .zb-stage-head{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  .zb-stage-head h2{font-size:16px;margin:0}
  .zb-stage-head .zb-id{font-size:12px;opacity:.5;font-family:ui-monospace,Menlo,Consolas,monospace}
  .zb-stage-head a{font-size:12px;margin-left:auto;color:inherit;opacity:.75}
  .zb-frame{border:1px dashed var(--zb-border);border-radius:12px;padding:20px}
  @media (max-width:760px){
    .zb-shell{flex-direction:column}
    .zb-side{width:auto;height:auto;position:static}
    .zb-main{padding:18px}
  }
`;

const NAV_SCRIPT = `
  document.addEventListener("click", (e) => {
    const a = e.target.closest(".zb-item");
    if (!a) return;
    document.querySelectorAll(".zb-item.is-active").forEach((el) => el.classList.remove("is-active"));
    a.classList.add("is-active");
  });
  const zbFilterInput = document.getElementById("zb-filter-input");
  function zbApplyFilter() {
    const q = zbFilterInput.value.trim().toLowerCase();
    let anyVisible = false;
    document.querySelectorAll(".zb-group-wrap").forEach((wrap) => {
      let groupVisible = false;
      wrap.querySelectorAll(".zb-item").forEach((item) => {
        const show = !q || item.dataset.search.includes(q);
        item.style.display = show ? "" : "none";
        if (show) groupVisible = true;
      });
      wrap.style.display = groupVisible ? "" : "none";
      if (groupVisible) anyVisible = true;
    });
    const empty = document.querySelector(".zb-no-matches");
    if (empty) empty.hidden = anyVisible || !q;
  }
  if (zbFilterInput) {
    zbFilterInput.addEventListener("input", zbApplyFilter);
    zbFilterInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { zbFilterInput.value = ""; zbApplyFilter(); }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) {
        e.preventDefault();
        zbFilterInput.focus();
      }
    });
  }
  window.addEventListener("popstate", () => {
    const id = location.pathname.match(/\\/story\\/([\\w-]+)/)?.[1];
    if (!id) return;
    document.querySelectorAll(".zb-item").forEach((el) =>
      el.classList.toggle("is-active", el.getAttribute("href") === "/story/" + id));
  });
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

const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180" viewBox="0 0 180 180"><rect width="180" height="180" rx="55" fill="#fb923c"/><text x="90" y="92" font-family="ui-monospace, Menlo, Consolas, monospace" font-weight="700" font-size="97" fill="#442100" text-anchor="middle" dominant-baseline="central">Z</text></svg>`;
const FAVICON_LINK = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(FAVICON_SVG)}" type="image/svg+xml">`;

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
${FAVICON_LINK}
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

function renderStory(story: Story): string {
  try {
    return story.render();
  } catch (err) {
    return `<p style="color:#f87171">Story failed to render: ${esc(err instanceof Error ? err.message : String(err))}</p>`;
  }
}

function sidebar(activeId: string): string {
  const groups = new Map<string, Story[]>();
  for (const s of STORIES) {
    const list = groups.get(s.group) ?? [];
    list.push(s);
    groups.set(s.group, list);
  }
  const nav = [...groups.entries()]
    .map(
      ([group, stories]) =>
        `<div class="zb-group-wrap"><div class="zb-group">${esc(group)}</div>` +
        stories
          .map(
            (s) =>
              `<a class="zb-item${s.id === activeId ? " is-active" : ""}" href="/story/${esc(s.id)}" ` +
              `data-search="${esc(`${group} ${s.title} ${s.id}`.toLowerCase())}" ` +
              `hx-get="/story/${esc(s.id)}/fragment" hx-target="#zb-stage-wrap" hx-push-url="/story/${esc(s.id)}">${esc(s.title)}</a>`,
          )
          .join("") +
        `</div>`,
    )
    .join("");
  return (
    `<aside class="zb-side"><div class="zb-brand">${esc(NAME)}</div>` +
    `<div class="zb-brand-sub">dev only · fictional data</div>` +
    `<div class="zb-filter"><input id="zb-filter-input" type="search" placeholder="Filter stories" aria-label="Filter stories"></div>` +
    `${nav}<div class="zb-no-matches" hidden>No stories match</div></aside>`
  );
}

function stageFragment(story: Story): string {
  return (
    `<div class="zb-stage-head"><h2>${esc(story.group)} — ${esc(story.title)}</h2>` +
    `<span class="zb-id">${esc(story.id)}</span>` +
    `<a href="/canvas/${esc(story.id)}">open bare canvas</a></div>` +
    `<div class="zb-frame">${renderStory(story)}</div>`
  );
}

function shellPage(active: Story): string {
  return page(
    `${active.group} — ${active.title}`,
    `<div class="zb-shell">${sidebar(active.id)}` +
      `<main class="zb-main"><div id="zb-stage-wrap">${stageFragment(active)}</div></main></div>` +
      `<script>${NAV_SCRIPT}</script>`,
  );
}

function canvasPage(story: Story): string {
  return page(`${story.group} — ${story.title}`, `<div style="padding:20px">${renderStory(story)}</div>`);
}

function handle(req: Request): Response {
    const url = new URL(req.url);
    const html = { "content-type": "text/html; charset=utf-8" };
    if (url.pathname === "/favicon.ico") {
      return new Response(FAVICON_SVG, { headers: { "content-type": "image/svg+xml" } });
    }
    if (url.pathname === "/") {
      if (STORIES.length === 0) return new Response("No stories registered", { headers: html });
      return new Response(shellPage(STORIES[0]), { headers: html });
    }
    const storyMatch = url.pathname.match(/^\/story\/([\w-]+)(\/fragment)?$/);
    if (storyMatch) {
      const story = STORIES.find((s) => s.id === storyMatch[1]);
      if (story) {
        return storyMatch[2]
          ? new Response(stageFragment(story), { headers: html })
          : new Response(shellPage(story), { headers: html });
      }
    }
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
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(req) {
    const started = performance.now();
    const res = handle(req);
    const path = new URL(req.url).pathname;
    if (path !== "/favicon.ico") {
      console.log(`${req.method} ${path} ${res.status} ${Math.max(0, Math.round(performance.now() - started))}ms`);
    }
    return res;
  },
});

const groupCount = new Set(STORIES.map((s) => s.group)).size;
const failures: { id: string; message: string }[] = [];
for (const s of STORIES) {
  try {
    s.render();
  } catch (err) {
    failures.push({ id: s.id, message: err instanceof Error ? err.message : String(err) });
  }
}
const assetEntries = Object.entries(cfg.assets ?? {});
console.log(`${NAME} · engine ${VERSION}`);
console.log(`→ http://127.0.0.1:${server.port}`);
console.log(`Stories: ${STORIES.length} in ${groupCount} groups`);
console.log(
  assetEntries.length === 0
    ? "Assets: none mapped (stories render unstyled)"
    : `Assets: ${assetEntries.map(([href, file]) => `${href} → ${file}`).join(" · ")}`,
);
if (cfg.designMd) console.log(`Tokens: ${TOKENS.length} colors from ${cfg.designMd}`);
console.log(
  failures.length === 0
    ? `Render check: all ${STORIES.length} stories render`
    : `Render check: ${failures.length} of ${STORIES.length} stories FAILED`,
);
for (const f of failures) console.log(`  FAILED ${f.id}: ${f.message}`);
