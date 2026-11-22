import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetVersion, servedVersion, staticUrl } from "./static-assets.ts";

const hashOf = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex").slice(0, 12);

describe("static asset versioning (#993)", () => {
  test("staticUrl carries the file's content hash", () => {
    const css = readFileSync(join(import.meta.dir, "../static/style.css"));
    expect(assetVersion("style.css")).toBe(hashOf(css));
    expect(staticUrl("style.css")).toBe(`/static/style.css?v=${hashOf(css)}`);
  });

  test("a missing asset falls back to the plain URL", () => {
    expect(assetVersion("no-such-file.css")).toBe("");
    expect(staticUrl("no-such-file.css")).toBe("/static/no-such-file.css");
    expect(servedVersion(join(tmpdir(), "no-such-file.css"))).toBe("");
  });

  test("servedVersion is stable for an unchanged file", () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-assets-"));
    const p = join(dir, "app.js");
    writeFileSync(p, "console.log('ok');");
    expect(servedVersion(p)).toBe(hashOf("console.log('ok');"));
    expect(servedVersion(p)).toBe(servedVersion(p));
  });

  test("a same-size edit with a preserved mtime still rehashes (ctime moves)", () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-assets-"));
    const p = join(dir, "app.js");
    const when = new Date(1700000000000);
    writeFileSync(p, "aaaa");
    utimesSync(p, when, when);
    const v1 = servedVersion(p);
    expect(v1).toBe(hashOf("aaaa"));
    writeFileSync(p, "bbbb");
    utimesSync(p, when, when);
    const v2 = servedVersion(p);
    expect(v2).toBe(hashOf("bbbb"));
    expect(v2).not.toBe(v1);
  });
});
