/** #369: malformed feed-input tests for the release-feed update check.
 *
 *  Decision under test: a feed that parses but isn't the documented shape
 *  reports "unreachable", not "no-releases" — claiming "no releases published
 *  yet" for a corrupt feed would mask a real feed problem.
 */
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { checkForUpdates, updateStatusFromFeed, updateSectionHtml } from "./updates.ts";

const CURRENT = "1.0.0";
const MAJOR = 1;
const good = (version: string) => ({
  version,
  url: "https://example.com/timekeep-1.0.0.tgz",
  sha256: "abc123",
});

describe("updateStatusFromFeed — malformed input is unreachable", () => {
  test("wrong top-level shape", () => {
    for (const feed of [[], "hello", null, 42, true]) {
      expect(updateStatusFromFeed(feed, CURRENT, MAJOR)).toEqual({ kind: "unreachable" });
    }
  });
  test("releases of the wrong type", () => {
    for (const releases of ["nope", [], 5, null]) {
      expect(updateStatusFromFeed({ releases }, CURRENT, MAJOR)).toEqual({ kind: "unreachable" });
    }
  });
  test("entry missing release fields", () => {
    expect(updateStatusFromFeed({ releases: { "1": { url: "x" } } }, CURRENT, MAJOR))
      .toEqual({ kind: "unreachable" });
    expect(updateStatusFromFeed({ releases: { "1": {} } }, CURRENT, MAJOR))
      .toEqual({ kind: "unreachable" });
    expect(updateStatusFromFeed({ releases: { "1": { version: 1, url: "x", sha256: "y" } } }, CURRENT, MAJOR))
      .toEqual({ kind: "unreachable" });
  });
  test("malformed newer-major entry is unreachable, not silently skipped", () => {
    expect(updateStatusFromFeed({ releases: { "2": {} } }, CURRENT, MAJOR))
      .toEqual({ kind: "unreachable" });
  });
});

describe("updateStatusFromFeed — well-formed input", () => {
  test("missing or empty releases is no-releases", () => {
    expect(updateStatusFromFeed({}, CURRENT, MAJOR)).toEqual({ kind: "no-releases" });
    expect(updateStatusFromFeed({ releases: {} }, CURRENT, MAJOR)).toEqual({ kind: "no-releases" });
  });
  test("up-to-date", () => {
    expect(updateStatusFromFeed({ releases: { "1": good("1.0.0") } }, CURRENT, MAJOR))
      .toEqual({ kind: "up-to-date", version: "1.0.0" });
  });
  test("update-available", () => {
    const s = updateStatusFromFeed({ releases: { "1": good("1.1.0") } }, CURRENT, MAJOR);
    expect(s.kind).toBe("update-available");
    if (s.kind === "update-available") expect(s.latest.version).toBe("1.1.0");
  });
  test("newer major renders as a plain update (no license key)", () => {
    const s = updateStatusFromFeed(
      { releases: { "1": good("1.0.0"), "2": good("2.0.0") } }, CURRENT, MAJOR);
    expect(s.kind).toBe("update-available");
    if (s.kind === "update-available") expect(s.latest.version).toBe("2.0.0");
  });
});

describe("checkForUpdates — transport failures are unreachable", () => {
  let server: ReturnType<typeof Bun.serve>;
  let body = "";
  let status = 200;
  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        return new URL(req.url).pathname === "/feed.json"
          ? new Response(body, { status, headers: { "Content-Type": "application/json" } })
          : new Response("not found", { status: 404 });
      },
    });
    process.env.TIMEKEEP_RELEASES_URL = `http://127.0.0.1:${server.port}/feed.json`;
  });
  afterAll(() => {
    server.stop();
    delete process.env.TIMEKEEP_RELEASES_URL;
  });

  test("invalid JSON body", async () => {
    body = "this is not json{{{";
    status = 200;
    expect(await checkForUpdates()).toEqual({ kind: "unreachable" });
  });
  test("non-OK status", async () => {
    body = "";
    status = 500;
    expect(await checkForUpdates()).toEqual({ kind: "unreachable" });
  });
  test("valid feed flows through to a real status", async () => {
    body = JSON.stringify({ releases: { "1": good("1.2.0") } });
    status = 200;
    const s = await checkForUpdates();
    expect(s.kind).toBe("update-available");
  });
});

/* #406: the check button carries the progress-state wiring — the squiggly
   logo (spinning clock hands) replaces the refresh icon while htmx has the
   request in flight, and the button disables itself for the duration. */
describe("check-for-updates button progress wiring (#406)", () => {
  test("button has the spinner + disabled-elt wiring", () => {
    const html = updateSectionHtml();
    expect(html).toContain('id="check-updates-btn"');
    expect(html).toContain('hx-disabled-elt="#check-updates-btn"');
    expect(html).toContain('class="btn-spinner"');
    expect(html).toContain("tk-logo-hands");
  });
});
