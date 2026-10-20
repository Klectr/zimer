/** #1023: server-side exception reporting to PostHog error tracking.
 *  Zero-dependency by design (repo rule): a plain fetch POST of an
 *  $exception event to the ingestion endpoint, in the same shape the JS
 *  SDK sends. Gated on POSTHOG_KEY exactly like the browser snippet —
 *  hosted sets it; a self-host instance stays silent unless its owner
 *  configured their own key.
 *
 *  Fire-and-forget and total-failure-proof: reporting must never break
 *  request handling, so every failure mode (no key, network down, bad
 *  payload) ends in silence, never a throw. */

export function captureException(err: unknown, extra?: Record<string, unknown>): void {
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
        { type: e.name, value: e.message, stack_trace: { type: "raw", value: stack } },
      ],
      $exception_level: "error",
      $exception_source: "zimer-server",
      ...(extra ?? {}),
    },
  };
  try {
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
