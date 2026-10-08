/** #903: entryEditModal — the edit-entry form as a lazy-loaded dialog fragment
 *  for the timer page, sharing the full page's form builder. */
import { describe, expect, test } from "bun:test";
import type { Database, Statement } from "bun:sqlite";
import { createCalendarViews } from "./calendar.ts";

const entry = {
  id: 7, description: "deep work", project_id: null, project_name: null,
  client_name: null, client_color: null, invoice_id: null,
  invoice_number: null, invoice_status: null,
  start_time: "2026-10-07T14:00:00.000Z", end_time: "2026-10-07T15:00:00.000Z",
};

function views(qOneResult: unknown) {
  const db = { query: (_sql: string) => ({ get: () => null, all: () => [] }) } as unknown as Database;
  return createCalendarViews({
    db,
    qOne: { get: () => qOneResult } as unknown as Statement,
    qRange: { get: () => null, all: () => [] } as unknown as Statement,
    entrySelect: "SELECT",
    layout: (_t: string, b: string) => b,
    projectOptions: () => "",
    weekTargetBar: () => "",
    calHourPx: 64,
  } as any);
}

describe("entryEditModal (#903)", () => {
  test("returns the form posting via htmx, with a dialog-closing Cancel", () => {
    const html = views(entry).entryEditModal(7)!;
    expect(html).toContain('hx-post="/entries/7"');
    expect(html).toContain('hx-swap="none"');
    expect(html).not.toContain('method="post"');
    expect(html).toContain('value="deep work"');
    expect(html).toContain("data-entry-edit-cancel");
    expect(html).not.toContain('href="/calendar"');
  });

  test("null for a missing entry", () => {
    expect(views(null).entryEditModal(999)).toBeNull();
  });

  test("null for a locked (invoiced) entry — the route 403s those", () => {
    expect(views({ ...entry, invoice_status: "sent" }).entryEditModal(7)).toBeNull();
  });

  test("full page keeps the plain POST form and the /calendar cancel link", () => {
    const html = views(entry).editPage(7)!;
    expect(html).toContain('method="post" action="/entries/7"');
    expect(html).not.toContain("hx-post");
    expect(html).toContain('href="/calendar"');
    expect(html).not.toContain("data-entry-edit-cancel");
  });
});
