import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VERSION } from "./version";

test("engine VERSION matches the zandbox package version", () => {
  const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
    name?: string;
    version?: string;
  };
  if (pkg.name === "zandbox") expect(pkg.version).toBe(VERSION);
  expect(typeof VERSION).toBe("string");
});
