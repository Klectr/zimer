/** #1023: server-side exception reporting to PostHog error tracking.
 *  Zero-dependency by design (repo rule): a plain fetch POST of an
 *  $exception event to the ingestion endpoint. Payload follows PostHog's
 *  documented manual-install schema: $exception_list items carry
 *  { type, value, stacktrace: { type: "raw", frames } } with the V8 stack
 *  parsed into frames. Gated on POSTHOG_KEY exactly like the browser
 *  snippet — hosted sets it; a self-host instance stays silent unless its
 *  owner configured their own key.
 *
 *  Fire-and-forget and failure-proof: everything (coercion, parsing,
 *  serialization) happens inside the try, so reporting can never throw
 *  into request handling — a weird thrown value must not take the error
 *  handler itself down. */

type PhFrame = {
  platform: string;
  lang: string;
  function: string;
  filename: string;
  lineno: number;
  colno: number;
};

/** V8/Bun stack lines: "at fn (file:line:col)" or "at file:line:col". */
function parseFrames(stack: string): PhFrame[] {
  const frames: PhFrame[] = [];
  for (const line of stack.split("\n")) {
    const m = /^\s*at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/.exec(line);
    if (!m) continue;
    frames.push({
      platform: "custom",
      lang: "javascript",
      function: m[1] ?? "",
      filename: m[2],
      lineno: Number(m[3]),
      colno: Number(m[4]),
    });
  }
  return frames;
}

export function captureException(err: unknown, extra?: Record<string, unknown>): void {
  try {
    const key = (process.env.POSTHOG_KEY || "").trim();
    if (!key) return;
    const host = (process.env.POSTHOG_HOST || "https://us.i.posthog.com").trim().replace(/\/+$/, "");
    const e = err instanceof Error ? err : new Error(String(err));
    const stack = e.stack ?? "";
    const payload = {
      api_key: key,
      event: "$exception",
      distinct_id: "zimer-server",
      timestamp: new Date().toISOString(),
      properties: {
        $exception_type: e.name,
        $exception_message: e.message,
        $exception_stack_trace_raw: stack,
        $exception_list: [
          {
            type: e.name,
            value: e.message,
            stacktrace: { type: "raw", frames: parseFrames(stack) },
          },
        ],
        $exception_level: "error",
        $process_person_profile: false,
        ...(extra ?? {}),
      },
    };
    void fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {
    /* the reporter never throws */
  }
}
