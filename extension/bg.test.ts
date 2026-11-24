import { describe, expect, test } from "bun:test";

const src = await Bun.file(new URL("bg.js", import.meta.url)).text();

function loadBg(chromeMock: any, fetchMock: any) {
  const mod = { exports: {} as any };
  const fn = new Function("chrome", "fetch", "module", "exports", "console", src);
  fn(chromeMock, fetchMock, mod, mod.exports, console);
  return mod.exports;
}

function makeHarness(opts: { running?: boolean; lastTimer?: any; validProjectId?: number | null }) {
  const store: Record<string, any> = {
    siteUrl: "https://example.test",
    token: "test-token",
    lastTimer: opts.lastTimer,
  };
  const startBodies: any[] = [];
  const chromeMock = {
    storage: {
      sync: {
        get: async (keys: string[]) => {
          const out: Record<string, any> = {};
          for (const k of keys) out[k] = store[k];
          return out;
        },
        set: async (values: Record<string, any>) => {
          Object.assign(store, values);
        },
      },
    },
  };
  const fetchMock = async (url: string, init: any = {}) => {
    if (url.endsWith("/api/status")) {
      return { ok: true, status: 200, json: async () => ({ running: !!opts.running }) };
    }
    if (url.endsWith("/api/timer/stop")) {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (url.endsWith("/api/timer/start")) {
      const body = JSON.parse(init.body);
      startBodies.push(body);
      if (body.project_id !== null && body.project_id !== opts.validProjectId) {
        return { ok: false, status: 400, json: async () => ({ error: "project_id not found" }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }
    throw new Error("unexpected fetch: " + url);
  };
  return { store, startBodies, bg: loadBg(chromeMock, fetchMock) };
}

describe("extension bg dropStaleProject (#1460)", () => {
  test("clears projectId, keeps the rest, does not mutate the original", () => {
    const { bg } = makeHarness({});
    const original = { description: "Deep work", projectId: 999 };
    const cleared = bg.dropStaleProject(original);
    expect(cleared).toEqual({ description: "Deep work", projectId: null });
    expect(original.projectId).toBe(999);
  });

  test("passes through a missing lastTimer", () => {
    const { bg } = makeHarness({});
    expect(bg.dropStaleProject(null)).toBeNull();
    expect(bg.dropStaleProject(undefined)).toBeUndefined();
  });
});

describe("extension bg hotkey toggle with a stale project (#1460)", () => {
  test("a 400 on start clears the stored project and retries without it", async () => {
    const h = makeHarness({ lastTimer: { description: "Deep work", projectId: 999 }, validProjectId: null });
    await expect(h.bg.toggleTimer()).resolves.toBe("started");
    expect(h.startBodies.length).toBe(2);
    expect(h.startBodies[0].project_id).toBe(999);
    expect(h.startBodies[1].project_id).toBeNull();
    expect(h.startBodies[1].description).toBe("Deep work");
    expect(h.store.lastTimer).toEqual({ description: "Deep work", projectId: null });
  });

  test("a valid stored project starts on the first try and stays stored", async () => {
    const h = makeHarness({ lastTimer: { description: "Deep work", projectId: 5 }, validProjectId: 5 });
    await expect(h.bg.toggleTimer()).resolves.toBe("started");
    expect(h.startBodies.length).toBe(1);
    expect(h.store.lastTimer.projectId).toBe(5);
  });

  test("a 400 with no stored project is not retried", async () => {
    let starts = 0;
    const bg = loadBg(
      {
        storage: {
          sync: {
            get: async (keys: string[]) =>
              keys.includes("lastTimer")
                ? { lastTimer: { description: "", projectId: null } }
                : { siteUrl: "https://example.test", token: "test-token" },
            set: async () => {},
          },
        },
      },
      async (url: string) => {
        if (url.endsWith("/api/status")) return { ok: true, status: 200, json: async () => ({ running: false }) };
        starts++;
        return { ok: false, status: 400, json: async () => ({ error: "bad request" }) };
      },
    );
    await expect(bg.toggleTimer()).rejects.toThrow("bad request");
    expect(starts).toBe(1);
  });

  test("an unrelated 400 with a stored project does not clear it or retry", async () => {
    let starts = 0;
    const store: Record<string, any> = { lastTimer: { description: "Deep work", projectId: 5 } };
    const bg = loadBg(
      {
        storage: {
          sync: {
            get: async (keys: string[]) =>
              keys.includes("lastTimer")
                ? { lastTimer: store.lastTimer }
                : { siteUrl: "https://example.test", token: "test-token" },
            set: async (values: Record<string, any>) => Object.assign(store, values),
          },
        },
      },
      async (url: string) => {
        if (url.endsWith("/api/status")) return { ok: true, status: 200, json: async () => ({ running: false }) };
        starts++;
        return { ok: false, status: 400, json: async () => ({ error: "description too long" }) };
      },
    );
    await expect(bg.toggleTimer()).rejects.toThrow("description too long");
    expect(starts).toBe(1);
    expect(store.lastTimer.projectId).toBe(5);
  });

  test("a 500 with a stored project does not clear it or retry", async () => {
    let starts = 0;
    const store: Record<string, any> = { lastTimer: { description: "Deep work", projectId: 999 } };
    const bg = loadBg(
      {
        storage: {
          sync: {
            get: async (keys: string[]) =>
              keys.includes("lastTimer")
                ? { lastTimer: store.lastTimer }
                : { siteUrl: "https://example.test", token: "test-token" },
            set: async (values: Record<string, any>) => Object.assign(store, values),
          },
        },
      },
      async (url: string) => {
        if (url.endsWith("/api/status")) return { ok: true, status: 200, json: async () => ({ running: false }) };
        starts++;
        return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
      },
    );
    await expect(bg.toggleTimer()).rejects.toThrow("boom");
    expect(starts).toBe(1);
    expect(store.lastTimer.projectId).toBe(999);
  });

  test("when the retry also fails, exactly two starts are attempted and the error propagates", async () => {
    let starts = 0;
    const bg = loadBg(
      {
        storage: {
          sync: {
            get: async (keys: string[]) =>
              keys.includes("lastTimer")
                ? { lastTimer: { description: "", projectId: 999 } }
                : { siteUrl: "https://example.test", token: "test-token" },
            set: async () => {},
          },
        },
      },
      async (url: string, init: any = {}) => {
        if (url.endsWith("/api/status")) return { ok: true, status: 200, json: async () => ({ running: false }) };
        starts++;
        const body = JSON.parse(init.body);
        if (body.project_id !== null) return { ok: false, status: 400, json: async () => ({ error: "project_id not found" }) };
        return { ok: false, status: 500, json: async () => ({ error: "boom" }) };
      },
    );
    await expect(bg.toggleTimer()).rejects.toThrow("boom");
    expect(starts).toBe(2);
  });

  test("a fresher lastTimer written mid-toggle wins over clearing the stale snapshot", async () => {
    let lastTimerReads = 0;
    const sets: any[] = [];
    const startBodies: any[] = [];
    const bg = loadBg(
      {
        storage: {
          sync: {
            get: async (keys: string[]) => {
              if (!keys.includes("lastTimer")) return { siteUrl: "https://example.test", token: "test-token" };
              lastTimerReads++;
              return lastTimerReads === 1
                ? { lastTimer: { description: "Old", projectId: 999 } }
                : { lastTimer: { description: "New", projectId: 7 } };
            },
            set: async (values: Record<string, any>) => sets.push(values),
          },
        },
      },
      async (url: string, init: any = {}) => {
        if (url.endsWith("/api/status")) return { ok: true, status: 200, json: async () => ({ running: false }) };
        const body = JSON.parse(init.body);
        startBodies.push(body);
        if (body.project_id === 999) return { ok: false, status: 400, json: async () => ({ error: "project_id not found" }) };
        return { ok: true, status: 200, json: async () => ({}) };
      },
    );
    await expect(bg.toggleTimer()).resolves.toBe("started");
    expect(startBodies.length).toBe(2);
    expect(startBodies[1]).toEqual({ description: "New", project_id: 7, tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
    expect(sets.length).toBe(0);
  });

  test("a running timer still stops and never starts", async () => {
    const h = makeHarness({ running: true, lastTimer: { description: "x", projectId: 999 } });
    await expect(h.bg.toggleTimer()).resolves.toBe("stopped");
    expect(h.startBodies.length).toBe(0);
  });
});
