/** #340: the VERSION file wiring. Moved from the /health tests when #989
 *  took version out of the public health payload — the updates UI still
 *  renders appVersion(), so a broken VERSION read degrading silently to
 *  0.0.0-dev needs a test signal somewhere. */
import { describe, expect, test } from "bun:test";
import { appMajor, appVersion } from "./version.ts";

describe("appVersion", () => {
  test("reads the repo VERSION file as a semver", () => {
    expect(appVersion()).not.toBe("0.0.0-dev");
    expect(/^\d+\.\d+\.\d+$/.test(appVersion())).toBe(true);
  });

  test("appMajor parses the leading number", () => {
    expect(appMajor()).toBeGreaterThanOrEqual(1);
  });
});
