/** Demo data onboarding (milestone 11): fictional workspace seeding, reset,
 *  and the demo banner. The Database is passed in explicitly; demoBanner()
 *  renders HTML via the icon system. */

import type { Database } from "bun:sqlite";
import { icon } from "./icons.ts";

export function workspaceEmpty(db: Database): boolean {
  const c = (db.query("SELECT COUNT(*) AS n FROM clients").get() as any).n
    + (db.query("SELECT COUNT(*) AS n FROM time_entries").get() as any).n
    + (db.query("SELECT COUNT(*) AS n FROM invoices").get() as any).n;
  return c === 0;
}
export function demoIds(db: Database): any | null {
  const r = db.query("SELECT value FROM meta WHERE key = 'demo_ids'").get() as any;
  return r ? JSON.parse(r.value) : null;
}
export function seedDemoData(db: Database): void {
  const ids: any = { clients: [], projects: [], entries: [], invoices: [] };
  const insClient = db.query("INSERT INTO clients (name, color, rate) VALUES (?, ?, ?)");
  const insProject = db.query("INSERT INTO projects (name, client_id) VALUES (?, ?)");
  const insEntry = db.query("INSERT INTO time_entries (project_id, description, start_time, end_time) VALUES (?, ?, ?, ?)");
  const demoClients: [string, string, number][] = [
    ["Acme Studios", "#f2c14e", 120],
    ["Brightline Co", "#7cc4ff", 95],
    ["Northwind Traders", "#b39ddb", 150],
  ];
  const clientIds: number[] = [];
  for (const [name, color, rate] of demoClients) {
    clientIds.push(Number(insClient.run(name, color, rate).lastInsertRowid));
  }
  ids.clients = clientIds;
  const demoProjects: [string, number][] = [
    ["Brand refresh", clientIds[0]], ["Website rebuild", clientIds[0]],
    ["Mobile app", clientIds[1]], ["Advisory retainer", clientIds[2]],
  ];
  const projectIds: number[] = [];
  for (const [name, cid] of demoProjects) {
    projectIds.push(Number(insProject.run(name, cid).lastInsertRowid));
  }
  ids.projects = projectIds;
  /* A week of entries ending yesterday, ~7h/day, mostly billable. */
  const tasks = [
    [0, "Logo concepts", "09:00", "12:30"], [0, "Style guide", "13:30", "16:00"],
    [1, "Homepage build", "09:15", "12:45"], [1, "CMS integration", "13:30", "17:00"],
    [2, "Onboarding flow", "09:00", "12:00"], [2, "Push notifications", "13:00", "16:30"],
    [3, "Architecture review", "10:00", "12:00"],
    [0, "Client feedback round", "09:30", "11:30"],
    [null, "Inbox zero", "08:30", "09:00"],
  ];
  const days = [6, 5, 4, 3, 2];
  let ti = 0;
  for (const d of days) {
    const dt = new Date();
    dt.setDate(dt.getDate() - d);
    const day = dt.toISOString().slice(0, 10);
    for (let k = 0; k < 2 && ti < tasks.length; k++, ti++) {
      const [pj, desc, st, en] = tasks[ti] as any[];
      ids.entries.push(Number(insEntry.run(
        pj === null ? null : projectIds[pj], desc, `${day}T${st}:00`, `${day}T${en}:00`
      ).lastInsertRowid));
    }
  }
  /* #300: remember the seeded week so the demo banner can link straight into
     the invoice prefill flow (/invoices/new?from=&to=). `to` is exclusive. */
  const dayStr = (d: Date) => d.toISOString().slice(0, 10);
  const fromD = new Date(); fromD.setDate(fromD.getDate() - 6);
  const toD = new Date(); toD.setDate(toD.getDate() - 1);
  const demoFrom = dayStr(fromD), demoTo = dayStr(toD);
  db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('demo_from', ?), ('demo_to', ?)")
    .run(demoFrom, demoTo);
  /* Three invoices: paid, sent, draft. #492: items carry date ranges so the
     invoice sheet's Date column renders — NULL dates left empty cells on
     every first-run demo invoice. */
  const invQ = db.query("INSERT INTO invoices (client_id, number, issue_date, due_date, status, tax_rate, notes) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const itemQ = db.query("INSERT INTO invoice_items (invoice_id, description, hours, rate, amount, date_from, date_to) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const mk = (cid: number | null, num: string, issue: string, due: string, status: string,
              items: [string, number, number, string?, string?][], notes = "") => {
    const id = Number(invQ.run(cid, num, issue, due, status, 0, notes).lastInsertRowid);
    for (const [desc, hours, rate, from, to] of items)
      itemQ.run(id, desc, hours, rate, hours * rate, from ?? null, to ?? from ?? null);
    ids.invoices.push(id);
  };
  const lastMonth = new Date(); lastMonth.setMonth(lastMonth.getMonth() - 1);
  const lm = lastMonth.toISOString().slice(0, 10);
  const today = dayStr(new Date());
  const monthStart = today.slice(0, 8) + "01";
  mk(clientIds[0], "DEMO-001", lm, lm, "paid",
    [["Brand refresh — design", 24, 120, lm, lm]], "Paid in full. Thank you!");
  mk(clientIds[1], "DEMO-002", new Date().toISOString().slice(0, 10),
    new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), "sent",
    [["Mobile app — onboarding flow", 18.5, 95, demoFrom, demoTo]]);
  mk(clientIds[2], "DEMO-003", new Date().toISOString().slice(0, 10),
    new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10), "draft",
    [["Advisory retainer — September", 1, 150, monthStart, today]], "Demo draft — not a real invoice.");
  db.query("INSERT OR REPLACE INTO meta (key, value) VALUES ('demo_ids', ?)")
    .run(JSON.stringify(ids));
}
export function removeDemoData(db: Database): number {
  const ids = demoIds(db);
  if (!ids) return 0;
  const del = (table: string, list: number[]) => {
    if (!list.length) return 0;
    const marks = list.map(() => "?").join(",");
    return db.query(`DELETE FROM ${table} WHERE id IN (${marks})`).run(...list).changes;
  };
  let n = 0;
  for (const iid of ids.invoices as number[]) n += del("invoice_items", db.query("SELECT id FROM invoice_items WHERE invoice_id = ?").all(iid).map((r: any) => r.id));
  n += del("invoices", ids.invoices);
  n += del("time_entries", ids.entries);
  n += del("projects", ids.projects);
  n += del("clients", ids.clients);
  db.query("DELETE FROM meta WHERE key = 'demo_ids'").run();
  db.query("DELETE FROM meta WHERE key IN ('demo_from', 'demo_to')").run(); /* #300 */
  return n;
}
/** #300: the seeded week, for deep-linking into the invoice prefill flow. */
export function demoRange(db: Database): { from: string; to: string } | null {
  const f = db.query("SELECT value FROM meta WHERE key = 'demo_from'").get() as any;
  const t = db.query("SELECT value FROM meta WHERE key = 'demo_to'").get() as any;
  return f && t ? { from: f.value, to: t.value } : null;
}
/** Demo banner: load prompt when empty, "viewing demo" + reset when demo present. */
export function demoBanner(db: Database): string {
  if (demoIds(db)) {
    /* #300: guide the fresh install to a prefilled invoice — the sample week
       lands on the client picker with the range already filled in. */
    const r = demoRange(db);
    const tryIt = r ? `<a class="md-filled-button" href="/invoices/new?from=${r.from}&amp;to=${r.to}">${icon("receipt")}<span>Invoice the sample week</span></a>` : "";
    return `<div class="demo-banner" data-enter="1">
    ${icon("info")}
    <span><strong>Demo data.</strong> This workspace is filled with fictional examples — poke around, then remove them when you're ready.</span>
    ${tryIt}
    <form method="post" action="/demo/reset" class="inline"><button class="md-text-button" type="submit">Remove demo data</button></form>
  </div>`;
  }
  if (workspaceEmpty(db)) return `<div class="demo-banner" data-enter="1">
    ${icon("info")}
    <span><strong>New here?</strong> Load a fictional workspace — clients, a week of entries, invoices — and try every page in 30 seconds.</span>
    <form method="post" action="/demo/load" class="inline"><button class="md-filled-button" type="submit">Load demo data</button></form>
  </div>`;
  return "";
}
