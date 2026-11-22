import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  });

  test("servedVersion rehashes when size or mtime changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "tk-assets-"));
    const p = join(dir, "app.js");
    writeFileSync(p, "one");
    const v1 = servedVersion(p, 3, 1000);
    expect(v1).toBe(hashOf("one"));
    expect(servedVersion(p, 3, 1000)).toBe(v1);
    writeFileSync(p, "two!!");
    const v2 = servedVersion(p, 5, 2000);
    expect(v2).toBe(hashOf("two!!"));
    expect(v2).not.toBe(v1);
  });
});
