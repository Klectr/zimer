/** #1023: the server-side $exception reporter. Fetch is stubbed; the env
 *  gate is exercised both ways (hosted sets POSTHOG_KEY, self-host does
 *  not, and a silent reporter is the whole point there). */
import { afterEach, describe, expect, test } from "bun:test";
import { captureException } from "./error-tracking.ts";

const realFetch = globalThis.fetch;
const realKey = process.env.POSTHOG_KEY;
const realHost = process.env.POSTHOG_HOST;

type Call = { url: string; init: RequestInit };
function stubFetch(fail = false): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (fail) throw new Error("network down");
    return new Response("1");
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.POSTHOG_KEY;
  else process.env.POSTHOG_KEY = realKey;
  if (realHost === undefined) delete process.env.POSTHOG_HOST;
  else process.env.POSTHOG_HOST = realHost;
});

describe("captureException", () => {
  test("no POSTHOG_KEY -> sends nothing", () => {
    delete process.env.POSTHOG_KEY;
    const calls = stubFetch();
    captureException(new Error("boom"));
    expect(calls).toHaveLength(0);
  });

  test("with a key -> one $exception POST in PostHog's documented schema", () => {
    process.env.POSTHOG_KEY = "phc_test";
    delete process.env.POSTHOG_HOST;
    const calls = stubFetch();
    const err = new TypeError("cannot read properties of undefined");
    captureException(err);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://us.i.posthog.com/i/v0/e/");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.api_key).toBe("phc_test");
    expect(body.event).toBe("$exception");
    expect(body.distinct_id).toBe("zimer-server");
    /* The manual-install schema: $exception_list[0] = { type, value,
       stacktrace: { type: "raw", frames[] } }. Asserted against the docs,
       not against whatever the implementation happens to emit. */
    expect(body.properties.$exception_list).toHaveLength(1);
    const item = body.properties.$exception_list[0];
    expect(item.type).toBe("TypeError");
    expect(item.value).toBe("cannot read properties of undefined");
    expect(item.stacktrace.type).toBe("raw");
    expect(Array.isArray(item.stacktrace.frames)).toBe(true);
    expect(item.stacktrace.frames.length).toBeGreaterThan(0);
    const frame = item.stacktrace.frames[0];
    expect(frame.platform).toBe("custom");
    expect(frame.lang).toBe("javascript");
    expect(typeof frame.function).toBe("string");
    expect(frame.filename).toContain("error-tracking.test");
    expect(frame.lineno).toBeGreaterThan(0);
    expect(frame.colno).toBeGreaterThan(0);
    expect(body.properties.$process_person_profile).toBe(false);
  });

  test("non-Error input is coerced, extra properties ride along", () => {
    process.env.POSTHOG_KEY = "phc_test";
    const calls = stubFetch();
    captureException("a string failure", { route: "/invoices" });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.properties.$exception_message).toBe("a string failure");
    expect(body.properties.route).toBe("/invoices");
  });

  test("a failing network never throws back at the caller", () => {
    process.env.POSTHOG_KEY = "phc_test";
    stubFetch(true);
    expect(() => captureException(new Error("boom"))).not.toThrow();
  });

  test("hostile thrown values cannot make the reporter throw", () => {
    process.env.POSTHOG_KEY = "phc_test";
    stubFetch();
    expect(() => captureException(Object.create(null))).not.toThrow();
    const evil = { toString() { throw new Error("evil toString"); } };
    expect(() => captureException(evil)).not.toThrow();
  });
});
