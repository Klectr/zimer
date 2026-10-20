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

  test("with a key -> one $exception POST in the SDK shape", () => {
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
    expect(body.properties.$exception_type).toBe("TypeError");
    expect(body.properties.$exception_message).toBe("cannot read properties of undefined");
    expect(body.properties.$exception_stack_trace_raw).toContain("TypeError");
    expect(body.properties.$exception_list).toHaveLength(1);
    expect(body.properties.$exception_list[0].type).toBe("TypeError");
    expect(body.properties.$exception_list[0].stack_trace.type).toBe("raw");
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
});
