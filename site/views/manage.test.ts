/** #486: finish the data-tip sweep — the manage page's icon buttons (delete /
 *  add project, save rate, save terms) used the OS-native title= tooltip
 *  while the rest of the app shows M3 plain tooltips. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db.ts";
import { createManageViews } from "./manage.ts";

function testDb() {
  const db = createDb(mkdtempSync(join(tmpdir(), "tk-manage-"))).db;
  db.query("INSERT INTO clients (name, color) VALUES ('Acme', '#f2c14e')").run();
  const client = db.query("SELECT * FROM clients").get() as any;
  db.query("INSERT INTO projects (client_id, name) VALUES (?, 'Website')").run(client.id);
  return { db, client };
}

function detailHtml(): string {
  const { db, client } = testDb();
  const views = createManageViews({ db, layout: (_t: string, b: string) => b });
  return views.clientDetailBody({ kind: "client", client });
}

/* The color control lives in the list pane's add-client form, not the
   client detail — render the full page for assertions covering it. */
function pageHtml(): string {
  const { db, client } = testDb();
  const views = createManageViews({ db, layout: (_t: string, b: string) => b });
  return views.managePage({ kind: "client", client });
}

describe("manage tooltips (#486)", () => {
  test("project delete/add and rate/terms save use data-tip, not native title", () => {
    const html = detailHtml();
    expect(html).toContain('data-tip="Delete"');
    expect(html).toContain('data-tip="Add project"');
    expect(html).toContain('data-tip="Save"');
    expect(html).not.toContain('title="Delete"');
    expect(html).not.toContain('title="Add project"');
    expect(html).not.toContain('title="Save"');
  });

  test("accessible names are unchanged", () => {
    const html = detailHtml();
    expect(html).toContain('aria-label="Delete project Website"');
    expect(html).toContain('aria-label="Save hourly rate for Acme"');
    expect(html).toContain('aria-label="Save payment terms for Acme"');
  });

  /* #488: the rate form's title="Hourly rate" fired the OS-native tooltip on
     top of the Save button's data-tip bubble (two tooltips at once); the
     color label's title="Client color" duplicated its visible "Color" text.
     Both fields keep their accessible names. */
  test("rate form and color label carry no redundant native title", () => {
    const detail = detailHtml();
    expect(detail).not.toContain('title="Hourly rate"');
    expect(detail).toContain('aria-label="Save hourly rate for Acme"');
    const page = pageHtml();
    expect(page).not.toContain('title="Client color"');
    expect(page).toContain('aria-label="Client color"');
  });
});
