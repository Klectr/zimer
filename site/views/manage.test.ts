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
  db.query("INSERT INTO clients (name, color) VALUES ('Acme', '#fb923c')").run();
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
  test("project delete/add use data-tip, not native title", () => {
    const html = detailHtml();
    expect(html).toContain('data-tip="Delete"');
    expect(html).toContain('data-tip="Add project"');
    expect(html).not.toContain('title="Delete"');
    expect(html).not.toContain('title="Add project"');
  });

  test("accessible names are unchanged", () => {
    const html = detailHtml();
    expect(html).toContain('aria-label="Delete project Website"');
    expect(html).toContain('aria-label="Client settings for Acme"');
  });

  /* #488: the color label's title="Client color" duplicated its visible
     "Color" text. The field keeps its accessible name. */
  test("color label carries no redundant native title", () => {
    const page = pageHtml();
    expect(page).not.toContain('title="Client color"');
    expect(page).toContain('aria-label="Client color"');
  });
});

/* #863: the manage page's document title follows the H1, the nav label, and
   the layout.ts one-word naming note — "Clients", not "Clients & Projects". */
describe("manage document title (#863)", () => {
  test("title is the page heading (Clients), not Clients & Projects", () => {
    const { db, client } = testDb();
    let captured = "";
    const views = createManageViews({
      db,
      layout: (t: string, b: string) => { captured = t; return b; },
    });
    views.managePage({ kind: "client", client });
    expect(captured).toBe("Clients");
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
    /* #630: the cog sits where the color dot was — no dot left in the header. */
    expect(html).not.toContain("client-dot");
  });

  test("detail pane keeps only projects — no inline editable client forms", () => {
    const html = detailHtml();
    expect(html).not.toContain("Contact details");
    expect(html).not.toContain('action="/clients/1/contact"');
    expect(html).not.toContain('class="contact-form detail-form"');
    /* #630: rate and payment terms moved into the settings modal too */
    expect(html).not.toContain('action="/clients/1/rate"');
    expect(html).not.toContain('action="/clients/1/terms"');
    expect(html).not.toContain('class="rate-form detail-form"');
    expect(html).not.toContain('class="terms-form detail-form"');
    expect(html).not.toContain('name="payment_terms"');
    expect(html).toContain("Projects");
  });

  test("manage page renders the settings dialog shell once", () => {
    const html = pageHtml();
    expect(html).toContain('id="client-settings-scrim"');
    expect(html).toContain('id="client-settings-body"');
    expect(html).toContain('id="client-settings-title"');
    expect(html).toContain('role="dialog"');
  });

  test("settings form carries all seven client fields posting to /clients/:id/settings", () => {
    const { db, client } = testDb();
    db.query("UPDATE clients SET rate = ?, payment_terms = ?, email = ?, phone = ?, website = ?, address = ? WHERE id = ?")
      .run(45, "net_15", "ap@bytebot.io", "555-0100", "bytebot.io", "2643 Morningside Dr\nClearwater, FL 33759", client.id);
    const c = db.query("SELECT * FROM clients WHERE id = ?").get(client.id) as any;
    const views = createManageViews({ db, layout: (_t: string, b: string) => b });
    const html = views.clientSettingsForm(c);
    expect(html).toContain('id="client-settings-form"');
    expect(html).toContain(`action="/clients/${client.id}/settings"`);
    expect(html).toContain(`hx-post="/clients/${client.id}/settings"`);
    expect(html).toContain('name="name" value="Acme"');
    expect(html).toContain('name="rate" value="45"');
    expect(html).toContain('name="payment_terms"');
    expect(html).toContain('<option value="" data-desc="Falls back to the global payment terms.">Use global terms</option>');
    expect(html).toContain('<option value="net_15" data-desc="Payment is due within 15 days of the zinvoice date." selected>');
    expect(html).toContain('<option value="pay_when_paid"');
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
    expect(html).toContain('name="rate" value=""');
    expect(html).toContain('<option value="" data-desc="Falls back to the global payment terms." selected>Use global terms</option>');
    expect(html).toContain('name="email" value=""');
    expect(html).toContain("></textarea>");
  });
});

/** #805: first-client preselect — same contract as the zinvoices pane: the
 *  route defaults the two-pane detail to the first client; the view renders
 *  it without has-selection so single-pane (mobile) still opens on the list. */
describe("#805: client list-detail default selection", () => {
  function render(isDefault: boolean): string {
    const { db, client } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b });
    return views.managePage({ kind: "client", client }, isDefault);
  }
  test("explicit selection sets has-selection", () => {
    expect(render(false)).toContain("has-selection");
  });
  test("default selection renders the detail pane without has-selection", () => {
    const html = render(true);
    expect(html).not.toContain("has-selection");
    expect(html).toContain("Website");
  });
});

/** #827: the manage page's floating labels are wired to their fields —
 *  add-project, client settings, add-client, and business profile. */
describe("manage labels (#827)", () => {
  test("client settings form fields are wired via matching id/for", () => {
    const { db, client } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b });
    const html = views.clientSettingsForm(client);
    for (const id of ["cs-name", "cs-rate", "cs-terms", "cs-email", "cs-phone", "cs-website", "cs-address"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label for="${id}">`);
    }
  });

  test("add-project and add-client labels are wired via matching id/for", () => {
    expect(detailHtml()).toContain('<label for="mp-name">');
    expect(detailHtml()).toContain('id="mp-name"');
    const page = pageHtml();
    for (const id of ["mc-name", "mc-rate"]) {
      expect(page).toContain(`id="${id}"`);
      expect(page).toContain(`<label for="${id}">`);
    }
  });

  test("business profile labels are wired via matching id/for", () => {
    const { db } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b });
    const html = views.bizProfileSection();
    for (const id of ["bp-business_name", "bp-business_email", "bp-business_address", "bp-terms"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label for="${id}">`);
    }
  });
});
