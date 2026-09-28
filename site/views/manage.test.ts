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

describe("client settings modal (#630)", () => {
  test("detail pane drops the inline name form for a header cog", () => {
    const html = detailHtml();
    expect(html).not.toContain('action="/clients/1/name"');
    expect(html).not.toContain('class="name-form detail-form"');
    expect(html).toContain('class="md-icon-button client-settings-open"');
    expect(html).toContain('data-client-id="1"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Client settings for Acme"');
  });

  test("detail pane drops the inline contact form", () => {
    const html = detailHtml();
    expect(html).not.toContain("Contact details");
    expect(html).not.toContain('action="/clients/1/contact"');
    expect(html).not.toContain('class="contact-form detail-form"');
    /* rate, terms, and projects stay inline */
    expect(html).toContain('action="/clients/1/rate"');
    expect(html).toContain('action="/clients/1/terms"');
    expect(html).toContain("Projects");
  });

  test("manage page renders the settings dialog shell once", () => {
    const html = pageHtml();
    expect(html).toContain('id="client-settings-scrim"');
    expect(html).toContain('id="client-settings-body"');
    expect(html).toContain('id="client-settings-title"');
    expect(html).toContain('role="dialog"');
  });

  test("settings form carries name + contact fields posting to /clients/:id/settings", () => {
    const { db, client } = testDb();
    db.query("UPDATE clients SET email = ?, phone = ?, website = ?, address = ? WHERE id = ?")
      .run("ap@bytebot.io", "555-0100", "bytebot.io", "2643 Morningside Dr\nClearwater, FL 33759", client.id);
    const c = db.query("SELECT * FROM clients WHERE id = ?").get(client.id) as any;
    const views = createManageViews({ db, layout: (_t: string, b: string) => b });
    const html = views.clientSettingsForm(c);
    expect(html).toContain('id="client-settings-form"');
    expect(html).toContain(`action="/clients/${client.id}/settings"`);
    expect(html).toContain(`hx-post="/clients/${client.id}/settings"`);
    expect(html).toContain('name="name" value="Acme"');
    expect(html).toContain('name="email" value="ap@bytebot.io"');
    expect(html).toContain('name="phone" value="555-0100"');
    expect(html).toContain('name="website" value="bytebot.io"');
    expect(html).toContain(">2643 Morningside Dr\nClearwater, FL 33759</textarea>");
  });

  test("settings form renders empty fields when the record has none", () => {
    const { db, client } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b });
    const html = views.clientSettingsForm(client);
    expect(html).toContain('name="name" value="Acme"');
    expect(html).toContain('name="email" value=""');
    expect(html).toContain("></textarea>");
  });
});
