/** #519: tests for exe-relative resource resolution. */

import { describe, expect, test, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { resourcePath } from "./paths.ts";

const FAKE_BIN = "/tmp/tk519-fakebin";

afterEach(() => {
  delete process.env.TIMEKEEP_RESOURCES;
  rmSync(FAKE_BIN, { recursive: true, force: true });
});

describe("resourcePath", () => {
  test("env override wins over everything", () => {
    process.env.TIMEKEEP_RESOURCES = "/tmp/tk519-resources";
    expect(resourcePath("static", "/dev/static")).toBe("/tmp/tk519-resources/static");
    expect(resourcePath("VERSION", "/dev/VERSION")).toBe("/tmp/tk519-resources/VERSION");
  });

  test("falls back to the dev path when no resources dir exists", () => {
    // execPath points somewhere with no resources/ sibling — dev behavior.
    expect(resourcePath("static", "/dev/static", "/nonexistent/bun")).toBe("/dev/static");
  });

  test("resolves exe-relative when a resources dir ships next to the binary", () => {
    mkdirSync(join(FAKE_BIN, "resources", "static"), { recursive: true });
    const got = resourcePath("static", "/dev/static", join(FAKE_BIN, "timekeep"));
    expect(got).toBe(join(FAKE_BIN, "resources", "static"));
  });

  test("exe-relative applies per resource (missing name falls back)", () => {
    mkdirSync(join(FAKE_BIN, "resources", "static"), { recursive: true });
    const exec = join(FAKE_BIN, "timekeep");
    expect(resourcePath("static", "/dev/static", exec))
      .toBe(join(FAKE_BIN, "resources", "static"));
    // VERSION not shipped in this fixture -> dev path
    expect(resourcePath("VERSION", "/dev/VERSION", exec)).toBe("/dev/VERSION");
  });
});
