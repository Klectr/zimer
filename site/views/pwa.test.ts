/** #936: PWA — manifest, icons, service worker, and head wiring.
 *  Installability needs all four: a manifest link + theme color in the head,
 *  a valid manifest with 192/512 icons, and a registered service worker with
 *  a fetch handler. */
import { describe, expect, test } from "bun:test";
import type { Statement } from "bun:sqlite";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createLayoutViews } from "./layout.ts";

const noRunning = { get: () => null } as unknown as Statement;
const staticDir = join(dirname(fileURLToPath(import.meta.url)), "..", "static");

const head = () => createLayoutViews(noRunning).layout("T", "body");

describe("pwa head wiring (#936)", () => {
  test("manifest link is present", () => {
    expect(head()).toContain('<link rel="manifest" href="/static/manifest.webmanifest">');
  });
  test("theme-color matches the dark surface", () => {
    expect(head()).toContain('<meta name="theme-color" content="#131318">');
  });
  test("service worker registration is present", () => {
    expect(head()).toContain('navigator.serviceWorker.register("/static/sw.js")');
  });
});

/** PNG width/height live in the IHDR chunk (bytes 16..24, big-endian). */
function pngSize(path: string): [number, number] {
  const buf = readFileSync(path);
  expect(buf[0]).toBe(0x89); // PNG magic
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return [view.getUint32(16), view.getUint32(20)];
}

describe("pwa manifest (#936)", () => {
  const manifest = JSON.parse(readFileSync(join(staticDir, "manifest.webmanifest"), "utf8"));
  test("identity fields", () => {
    expect(manifest.name).toBe("Zimer");
    expect(manifest.short_name).toBe("Zimer");
    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBe("/");
    expect(manifest.display).toBe("standalone");
  });
  test("theme colors match the dark surface", () => {
    expect(manifest.theme_color).toBe("#131318");
    expect(manifest.background_color).toBe("#131318");
  });
  test("declares 192 and 512 png icons that exist at the right size", () => {
    const bySize = Object.fromEntries(
      (manifest.icons as { src: string; sizes: string; type: string }[]).map((i) => [i.sizes, i]),
    );
    for (const size of ["192x192", "512x512"]) {
      expect(bySize[size].type).toBe("image/png");
      const [w, h] = pngSize(join(staticDir, basename(bySize[size].src)));
      const px = parseInt(size, 10);
      expect([w, h]).toEqual([px, px]);
    }
  });
});

describe("pwa service worker (#936)", () => {
  const sw = readFileSync(join(staticDir, "sw.js"), "utf8");
  test("has a fetch handler (required for installability)", () => {
    expect(sw).toContain('addEventListener("fetch"');
  });
  test("only intercepts /static/ GETs — navigations, API, and auth pass through", () => {
    expect(sw).toContain('event.request.method !== "GET"');
    expect(sw).toContain('url.pathname.startsWith("/static/")');
  });
  test("network-first so deploys never serve stale assets", () => {
    expect(sw).toContain("fetch(event.request)");
    expect(sw).toContain("caches.match(event.request)");
  });
});
