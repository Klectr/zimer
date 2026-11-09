/** #1185: GET /api/status — while a timer runs, the payload also carries
 *  the running entry's client rate (client_rate, null when the entry has
 *  no client) and the account's tracked seconds for the caller's day
 *  (today_seconds). The day window follows the #255 pattern: the client
 *  passes its own day bounds as ?from=&to= ISO instants, strictly
 *  validated, with the server's day (dayBounds(todayStr())) as fallback —
 *  the same bucketing /partial/today uses. Nothing runs → the payload is
 *  exactly { running: null }, as before. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { createDb } from "../db.ts";
import { createApiRouter } from "./api.ts";
import { dayBounds, entryToJson, todayStr } from "../lib/format.ts";

function setup() {
  const bundle = createDb(mkdtempSync(join(tmpdir(), "tk-status-")));
  const tenant = {
    db: bundle.db,
    qRunning: bundle.qRunning,
    qOne: bundle.qOne,
    qRange: bundle.qRange,
    qInvoice: bundle.qInvoice,
    qInvoices: bundle.qInvoices,
    groupToLineItems: () => [],
    unbilledEntries: () => [],
    getInvoice: () => null,
    invoiceTotals: () => ({ subtotal: 0, tax: 0, total: 0 }),
    nextInvoiceNumber: () => "INV-0001",
    mintPublicToken: () => "",
    stripeLinkFor: async () => ({}),
    revenueTotals: () => null,
    revenueMonthly: () => [],
    revenueByClient: () => [],
    revenueOverdue: () => [],
    freezeInvoiceSnapshots: () => {},
  };
  const { handleApi } = createApiRouter({
    getTenant: () => tenant as any,
    TOKEN: "test-token",
    authedApi: () => true,
    json: (data: unknown, status = 200) => Response.json(data, { status }),
    entryToJson,
    verifyWebhookSignature: () => false,
    shareOrigin: () => "",
  });
  async function status(query = "") {
    const url = new URL(`http://localhost/api/status${query}`);
    const req = new Request(url);
    const res = (await handleApi(req, url, "/api/status", "GET"))!;
    return { code: res.status, body: (await res.json()) as any };
  }
  return { db: bundle.db, status };
}

function client(db: Database, name: string, rate: number): number {
  return (db.query("INSERT INTO clients (name, rate) VALUES (?, ?) RETURNING id")
    .get(name, rate) as any).id;
}

function project(db: Database, name: string, clientId: number | null): number {
  return (db.query("INSERT INTO projects (name, client_id) VALUES (?, ?) RETURNING id")
    .get(name, clientId) as any).id;
}

function entry(db: Database, projectId: number | null, description: string, start: string, end: string | null): void {
  db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, ?, ?, ?)")
    .run(projectId, description, start, end);
}

const iso = (ms: number) => new Date(ms).toISOString();

describe("GET /api/status (#1185)", () => {
  test("nothing running: payload is exactly { running: null }", async () => {
    const { status } = setup();
    const { code, body } = await status();
    expect(code).toBe(200);
    expect(body).toEqual({ running: null });
  });

  test("running: client_rate plus today_seconds over the caller's day window", async () => {
    const { db, status } = setup();
    const cid = client(db, "Acme Studio", 85);
    const pid = project(db, "Website rebuild", cid);
    const now = Date.now();
    entry(db, pid, "Earlier today", iso(now - 2 * 3600e3), iso(now - 3600e3));
    entry(db, pid, "Outside the window", iso(now - 5 * 3600e3), iso(now - 4 * 3600e3));
    entry(db, pid, "Running entry", iso(now - 30 * 60e3), null);
    const q = `?from=${encodeURIComponent(iso(now - 3 * 3600e3))}&to=${encodeURIComponent(iso(now + 3600e3))}`;
    const { code, body } = await status(q);
    expect(code).toBe(200);
    expect(body.running.project_name).toBe("Website rebuild");
    expect(body.running.client_name).toBe("Acme Studio");
    expect(body.running.client_rate).toBe(85);
    expect(body.today_seconds).toBeGreaterThanOrEqual(5400);
    expect(body.today_seconds).toBeLessThanOrEqual(5415);
  });

  test("running with no project: client_rate is null, not 0", async () => {
    const { db, status } = setup();
    entry(db, null, "Running entry", new Date().toISOString(), null);
    const { body } = await status();
    expect(body.running).not.toBeNull();
    expect(body.running.client_rate).toBeNull();
    expect(typeof body.today_seconds).toBe("number");
  });

  test("no bounds: server-day fallback; an entry started yesterday never counts", async () => {
    const { db, status } = setup();
    const cid = client(db, "Acme Studio", 85);
    const pid = project(db, "Website rebuild", cid);
    const dayStart = new Date(dayBounds(todayStr())[0]).getTime();
    entry(db, pid, "Yesterday", iso(dayStart - 3600e3), iso(dayStart + 3600e3));
    entry(db, pid, "Today", iso(dayStart + 600e3), iso(dayStart + 1200e3));
    entry(db, null, "Running entry", new Date().toISOString(), null);
    const { body } = await status();
    expect(body.today_seconds).toBeGreaterThanOrEqual(600);
    expect(body.today_seconds).toBeLessThan(700);
  });

  test("garbage bounds fall back to the server day", async () => {
    const { db, status } = setup();
    const cid = client(db, "Acme Studio", 85);
    const pid = project(db, "Website rebuild", cid);
    const dayStart = new Date(dayBounds(todayStr())[0]).getTime();
    entry(db, pid, "Today", iso(dayStart + 600e3), iso(dayStart + 1200e3));
    entry(db, null, "Running entry", new Date().toISOString(), null);
    const { body } = await status("?from=banana&to=later");
    expect(body.today_seconds).toBeGreaterThanOrEqual(600);
    expect(body.today_seconds).toBeLessThan(700);
  });
});
