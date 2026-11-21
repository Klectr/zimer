/** #486: finish the data-tip sweep — the manage page's icon buttons (delete /
 *  add project, save rate, save terms) used the OS-native title= tooltip
 *  while the rest of the app shows plain tooltips. */
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDb } from "../db.ts";
import { createManageViews } from "./manage.ts";
import { icon } from "../lib/icons.ts";

function testDb() {
  const db = createDb(mkdtempSync(join(tmpdir(), "tk-manage-"))).db;
  db.query("INSERT INTO clients (name, color) VALUES ('Acme', '#fb923c')").run();
  const client = db.query("SELECT * FROM clients").get() as any;
  db.query("INSERT INTO projects (client_id, name) VALUES (?, 'Website')").run(client.id);
  return { db, client };
}

function dialogHtml(): string {
  const { db, client } = testDb();
  const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
  return views.clientDialogBody({ kind: "client", client });
}

function pageHtml(): string {
  const { db } = testDb();
  const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
  return views.managePage();
}

describe("manage tooltips (#486)", () => {
  test("project delete/add use data-tip, not native title", () => {
    const html = dialogHtml();
    expect(html).toContain('data-tip="Delete project"');
    expect(html).toContain('data-tip="Add project"');
    expect(html).not.toContain('title="Delete"');
    expect(html).not.toContain('title="Add project"');
  });

  test("accessible names are unchanged", () => {
    const html = dialogHtml();
    expect(html).toContain('aria-label="Delete project Website"');
    expect(pageHtml()).toContain('aria-label="Edit client Acme"');
  });

  /* #488: the color label's title="Client color" duplicated its visible
     "Color" text. The field keeps its accessible name. */
  test("color label carries no redundant native title", () => {
    const page = pageHtml();
    expect(page).not.toContain('title="Client color"');
    expect(page).toContain('aria-label="Client color"');
  });
});

/* #1203: the manage page's document title follows the H1 — the suite
   mock's "Manage" (the nav label stays "Clients"; chrome is separate). */
describe("manage document title (#1203)", () => {
  test("title is the page heading (Manage)", () => {
    const { db } = testDb();
    let captured = "";
    const views = createManageViews({
      db,
      layout: (t: string, b: string) => { captured = t; return b; },
      unbilledByClient: () => [],
    });
    views.managePage();
    expect(captured).toBe("Manage");
  });
});

describe("client dialog (#1203)", () => {
  test("the table's Edit button opens the client dialog", () => {
    const html = pageHtml();
    expect(html).toContain('data-client-edit="1"');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Edit client Acme"');
    expect(html).toContain('data-client-edit="none"');
  });

  test("dialog body consolidates settings, projects, and delete — no legacy inline forms", () => {
    const html = dialogHtml();
    expect(html).toContain('id="client-settings-form"');
    expect(html).toContain('action="/clients/1/settings"');
    expect(html).toContain('id="client-dialog-projects"');
    expect(html).toContain("Projects");
    expect(html).toContain('action="/clients/1/delete"');
    expect(html).not.toContain('action="/clients/1/name"');
    expect(html).not.toContain('action="/clients/1/contact"');
    expect(html).not.toContain('action="/clients/1/rate"');
    expect(html).not.toContain('action="/clients/1/terms"');
    expect(html).not.toContain('class="name-form detail-form"');
    expect(html).not.toContain('class="contact-form detail-form"');
    expect(html).not.toContain('class="rate-form detail-form"');
    expect(html).not.toContain('class="terms-form detail-form"');
  });

  test("the No client dialog body holds only the unassigned projects", () => {
    const { db } = testDb();
    db.query("INSERT INTO projects (client_id, name) VALUES (NULL, 'Loose')").run();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.clientDialogBody({ kind: "none" });
    expect(html).toContain('data-client-name="No client"');
    expect(html).toContain("Loose");
    expect(html).not.toContain("client-settings-form");
    expect(html).not.toContain('action="/clients/');
  });

  test("manage page renders the client dialog shell once", () => {
    const html = pageHtml();
    expect(html).toContain('id="client-settings-scrim"');
    expect(html).toContain('id="client-settings-body"');
    expect(html).toContain('id="client-settings-title"');
    expect(html).toContain('id="client-settings-sub"');
    expect(html).toContain('role="dialog"');
  });

  test("settings dialog body starts on the loading placeholder", () => {
    const html = pageHtml();
    expect(html).toContain('<div id="client-settings-body"><p class="muted">Loading…</p></div>');
  });

  test("opener resets the body to the loading placeholder before the fragment load", () => {
    const html = pageHtml();
    const open = html.indexOf("function openClientDialog(key){");
    const reset = html.indexOf("dlgBody.innerHTML = '<p class=\"muted\">Loading…</p>';", open);
    const show = html.indexOf("dlgScrim.hidden = false;", open);
    const load = html.indexOf('window.htmx.ajax("GET", "/clients/" + key + "/dialog"', open);
    expect(open).toBeGreaterThan(-1);
    expect(reset).toBeGreaterThan(open);
    expect(show).toBeGreaterThan(reset);
    expect(load).toBeGreaterThan(reset);
  });

  test("opener bumps the load generation before the fragment load (#1189)", () => {
    const html = pageHtml();
    const open = html.indexOf("function openClientDialog(key){");
    const bump = html.indexOf("dlgGen++;", open);
    const load = html.indexOf('window.htmx.ajax("GET", "/clients/" + key + "/dialog"', open);
    expect(open).toBeGreaterThan(-1);
    expect(bump).toBeGreaterThan(open);
    expect(load).toBeGreaterThan(bump);
  });

  test("stale client dialog loads are stamped at request time and dropped before swap (#1189)", () => {
    const html = pageHtml();
    expect(html).toContain("e.detail.xhr.tkCsGen=dlgGen;");
    expect(html).toContain("if(g!=null && g!==dlgGen) e.detail.shouldSwap=false;");
    const close = html.indexOf("function closeClientDialog(refocus){");
    expect(close).toBeGreaterThan(-1);
    expect(html.indexOf("dlgGen++;", close)).toBeGreaterThan(close);
  });

  test("close captures the generation so a reopen during the fade cancels the hide (#1192)", () => {
    const html = pageHtml();
    const close = html.indexOf("function closeClientDialog(refocus){");
    expect(close).toBeGreaterThan(-1);
    const bump = html.indexOf("dlgGen++;", close);
    const capture = html.indexOf("var gen=dlgGen, done=false,", close);
    const guard = html.indexOf("if(done||gen!==dlgGen) return;", close);
    expect(capture).toBeGreaterThan(bump);
    expect(guard).toBeGreaterThan(capture);
  });

  test("settings form carries all eight client fields posting to /clients/:id/settings", () => {
    const { db, client } = testDb();
    db.query("UPDATE clients SET rate = ?, payment_terms = ?, email = ?, phone = ?, website = ?, address = ? WHERE id = ?")
      .run(45, "net_15", "ap@bytebot.io", "555-0100", "bytebot.io", "2643 Morningside Dr\nClearwater, FL 33759", client.id);
    const c = db.query("SELECT * FROM clients WHERE id = ?").get(client.id) as any;
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.clientSettingsForm(c);
    expect(html).toContain('id="client-settings-form"');
    expect(html).toContain(`action="/clients/${client.id}/settings"`);
    expect(html).toContain(`hx-post="/clients/${client.id}/settings"`);
    expect(html).toContain('name="name" value="Acme"');
    expect(html).toContain('name="rate" value="45"');
    expect(html).toContain('name="payment_terms"');
    expect(html).toContain('<option value="" data-desc="Falls back to the global payment terms.">Use global terms</option>');
    expect(html).toContain('<option value="net_15" data-desc="Payment is due within 15 days of the Zinvoice date." selected>');
    expect(html).toContain('<option value="pay_when_paid"');
    expect(html).toContain('name="email" value="ap@bytebot.io"');
    expect(html).toContain('name="phone" value="555-0100"');
    expect(html).toContain('name="website" value="bytebot.io"');
    expect(html).toContain(">2643 Morningside Dr\nClearwater, FL 33759</textarea>");
    /* #1160: color is editable here too, not just at creation. */
    expect(html).toContain('name="color" value="#fb923c"');
    expect(html).toContain('data-client-name="Acme"');
  });

  /* #1160: the dialog names the client, offers Cancel next to Save, and a
     failed save re-renders with the error line + submitted values. */
  test("settings form carries a Cancel button beside Save client", () => {
    const { db, client } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.clientSettingsForm(client);
    expect(html).toContain('id="client-settings-cancel"');
    expect(html.indexOf('id="client-settings-cancel"')).toBeLessThan(html.indexOf(">Save client</button>"));
  });

  test("settings form with an error renders the alert line and keeps submitted values", () => {
    const { db, client } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.clientSettingsForm({ ...client, name: "Renamed", rate: "-5" }, "Hourly rate must be a number at or above 0.");
    expect(html).toContain('<p class="error" role="alert">Hourly rate must be a number at or above 0.</p>');
    expect(html).toContain('name="name" value="Renamed"');
    const clean = views.clientSettingsForm(client);
    expect(clean).not.toContain('role="alert"');
  });

  test("settings form renders empty fields when the record has none", () => {
    const { db, client } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.clientSettingsForm(client);
    expect(html).toContain('name="name" value="Acme"');
    expect(html).toContain('name="rate" value=""');
    expect(html).toContain('<option value="" data-desc="Falls back to the global payment terms." selected>Use global terms</option>');
    expect(html).toContain('name="email" value=""');
    expect(html).toContain("></textarea>");
  });
});

/** #1203: the two-pane list-detail is gone — the page is one stack, so
 *  there is no selection state left to render. */
describe("#1203: stacked page, no selection state", () => {
  test("page carries no list-detail shell or selection classes", () => {
    const html = pageHtml();
    expect(html).toContain('class="manage-stack"');
    expect(html).not.toContain("client-list-detail");
    expect(html).not.toContain("client-detail-pane");
    expect(html).not.toContain("has-selection");
    expect(html).not.toContain("Select a client to manage");
  });
});

/** #827: the manage page's floating labels are wired to their fields —
 *  add-project, client settings, add-client, and business profile. */
describe("manage labels (#827)", () => {
  test("client settings form fields are wired via matching id/for", () => {
    const { db, client } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.clientSettingsForm(client);
    for (const id of ["cs-name", "cs-rate", "cs-terms", "cs-email", "cs-phone", "cs-website", "cs-address"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label class="ui-field-label" for="${id}">`);
    }
  });

  test("add-project and add-client labels are wired via matching id/for", () => {
    expect(dialogHtml()).toContain('<label class="ui-field-label" for="mp-name">');
    expect(dialogHtml()).toContain('id="mp-name"');
    const page = pageHtml();
    for (const id of ["mc-name", "mc-rate"]) {
      expect(page).toContain(`id="${id}"`);
      expect(page).toContain(`<label class="ui-field-label" for="${id}">`);
    }
  });

  test("business profile save button is verb + noun (#1217)", () => {
    const { db } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    expect(views.bizProfileSection()).toContain(">Save profile</button>");
    expect(views.dailyTargetSection()).toContain(">Save target</button>");
  });

  test("settings saves share one model: default variant, same size, no primary (#1216)", () => {
    const { db } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const profile = views.bizProfileSection();
    const prefs = views.preferencesSection();
    expect(profile).not.toContain("ui-btn-primary");
    expect(prefs).not.toContain("ui-btn-primary");
    expect(profile).toContain('<button type="submit" class="ui-btn">');
    expect(prefs).toContain('<button type="submit" class="ui-btn">');
    expect(prefs).not.toContain("ui-btn-sm");
    expect(profile).toContain(icon("save") + "Save profile</button>");
    expect(prefs).toContain(icon("save") + "Save target</button>");
  });

  test("business profile labels are wired via matching id/for", () => {
    const { db } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.bizProfileSection();
    for (const id of ["bp-business_name", "bp-business_email", "bp-business_address", "bp-terms"]) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(`<label class="ui-field-label" for="${id}"`);
    }
  });

  test("business profile fields carry placeholders and Address is a textarea (#1259)", () => {
    const { db } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.bizProfileSection();
    expect(html).toContain('placeholder="Your studio name"');
    expect(html).toContain('placeholder="billing@you.example"');
    expect(html).toContain('<textarea class="ui-input" id="bp-business_address" name="business_address" rows="3"');
    expect(html).toContain("placeholder=\"123 Main St\nSuite 200\nSpringfield, IL 62701\"");
    expect(html).not.toContain('<input class="ui-input" type="text" id="bp-business_address"');
  });

  test("business profile carries the payment instructions field (#1296)", () => {
    const { db } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.bizProfileSection();
    expect(html).toContain('<textarea class="ui-input" id="bp-payment_instructions" name="business_payment_instructions" rows="3"');
    expect(html).toContain("How to pay on the public Zinvoice");
  });
});

/** #1203: Manage follows the suite mock — one stacked page: appHeader
 *  with the counts sub, the add-client card open at the top, the client
 *  table (project names, unbilled in money), and the projects chip card. */
describe("manage suite-mock composition (#1203)", () => {
  test("page head is appHeader titled Manage with client/project counts", () => {
    const html = pageHtml();
    expect(html).toContain('<h1 class="ui-app-title">Manage</h1>');
    expect(html).toContain('<p class="ui-app-sub" id="mg-sub">1 client · 1 project</p>');
  });

  test("add-client form is open at the top of the stack — no toggle, no hidden form", () => {
    const html = pageHtml();
    expect(html).toContain('<form method="post" action="/clients" id="client-add-form" class="manage-add-form">');
    expect(html).not.toContain("client-add-toggle");
    expect(html.indexOf('id="client-add-form"')).toBeLessThan(html.indexOf('id="client-table-card"'));
    expect(html).toContain(">Add client</button>");
  });

  /* #1160: the page-manage mock's add form collects email at creation. */
  test("add-client form collects email and keeps the color picker", () => {
    const html = pageHtml();
    expect(html).toContain('id="mc-email"');
    expect(html).toContain('name="email"');
    expect(html).toContain('placeholder="billing@client.example"');
    expect(html).toContain('aria-label="Client color"');
    expect(html.indexOf('id="mc-email"')).toBeLessThan(html.indexOf('id="client-table-card"'));
  });

  /* #1344: one value per cell; project names and rate live in the row's
     hover card, not a Projects column. */
  test("client table shows month, unbilled, outstanding, last tracked; details move to the hover card", () => {
    const html = pageHtml();
    expect(html).toContain("<th>Client</th>");
    expect(html).toContain('<th class="col-month">This month</th>');
    expect(html).toContain('<th class="num">Unbilled</th>');
    expect(html).toContain('<th class="num">Outstanding</th>');
    expect(html).toContain('<th class="col-last">Last tracked</th>');
    expect(html).not.toContain("<th>Default rate</th>");
    expect(html).not.toContain('class="col-projects"');
    expect(html).toContain('<div class="mg-card" aria-hidden="true">');
    expect(html).toContain("No client");
  });

  test("unbilled column prices finished unbilled time at the client rate", () => {
    const { db, client } = testDb();
    db.query("UPDATE clients SET rate = 100 WHERE id = ?").run(client.id);
    const project = db.query("SELECT * FROM projects").get() as any;
    db.query("INSERT INTO time_entries (project_id, start_time, end_time) VALUES (?, '2026-11-02T09:00:00', '2026-11-02T10:30:00')").run(project.id);
    db.query("INSERT INTO time_entries (project_id, start_time, end_time) VALUES (?, '2026-11-03T09:00:00', NULL)").run(project.id);
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.managePage();
    expect(html).toContain('<td class="num">$150</td>');
  });

  /* The Projects card listed "Client — Project" chips that did nothing on
     click; projects are managed in each client's dialog instead. */
  test("the page has no standalone Projects card or New project dialog", () => {
    const { db } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.managePage();
    expect(html).not.toContain('id="projects-card"');
    expect(html).not.toContain('id="new-project-form"');
    expect(html).not.toContain('id="new-project-open"');
  });

  test("lists OOB refresh carries the client table and the header counts sub", () => {
    const { db } = testDb();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.manageListsOob();
    expect(html).toContain('id="client-table-card" hx-swap-oob="true"');
    expect(html).not.toContain('id="projects-card"');
    expect(html).toContain('<p class="ui-app-sub" id="mg-sub" hx-swap-oob="true">1 client · 1 project</p>');
  });
});

describe("theme section (#884)", () => {
  function themeHtml(): string {
    const { db } = testDb();
    return createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] }).themeSectionHtml();
  }
  test("renders the section with all five dots", () => {
    const html = themeHtml();
    expect(html).toContain('id="theme-section"');
    expect(html).toContain("<h2");
    expect(html).toContain("Theme");
    for (const name of ["Pumpkin", "Crimson", "Blue", "Green", "Yellow"])
      expect(html).toContain(`aria-label="${name} theme"`);
    expect(html.match(/theme-dot/g)!.length).toBeGreaterThanOrEqual(5);
  });
  test("pumpkin is selected by default; the stored theme wins", () => {
    expect(themeHtml()).toContain('aria-label="Pumpkin theme" aria-pressed="true"');
    const { db } = testDb();
    db.query("INSERT INTO meta (key, value) VALUES ('theme', 'blue')").run();
    const html = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] }).themeSectionHtml();
    expect(html).toContain('aria-label="Blue theme" aria-pressed="true"');
    expect(html).not.toContain('aria-label="Pumpkin theme" aria-pressed="true"');
  });
  test("every dot exposes its pressed state (#897)", () => {
    const html = themeHtml();
    const pressedTrue = html.match(/aria-pressed="true"/g) || [];
    const pressedFalse = html.match(/aria-pressed="false"/g) || [];
    const buttons = html.match(/<button[^>]*theme-dot[^>]*>/g) || [];
    expect(pressedTrue.length).toBe(1);
    expect(pressedFalse.length).toBe(buttons.length - 1);
    for (const b of buttons) expect(b).toMatch(/aria-pressed="(true|false)"/);
  });
});

/* #1218: the tracking card style means "a timer is running" — the
   add-client card must not borrow it as decoration. */
describe("add-client card (#1218)", () => {
  test("page carries no tracking-styled card", () => {
    const html = pageHtml();
    expect(html).not.toContain("ui-card tracking");
    expect(html).toContain("Add a client");
  });
});

/** The manage script is emitted through a template literal; a single
 *  backslash in a regex becomes nothing, so `/\/clients\/` turned into
 *  a `//` comment and killed the Edit handler. Parse the emitted script
 *  so that class of breakage fails here. */
describe("manage inline script syntax", () => {
  test("the emitted script parses", () => {
    const html = pageHtml();
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]!);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(() => new Function(script)).not.toThrow();
  });
});


/* #1344: the client row's insight — hours this month per project, last
   tracked, outstanding money on sent Zinvoices, overdue via the shared rule. */
describe("client insights (#1344)", () => {
  function setup() {
    const { db, client } = testDb();
    db.query("UPDATE clients SET rate = 100 WHERE id = ?").run(client.id);
    const web = db.query("SELECT id FROM projects WHERE client_id = ?").get(client.id) as any;
    const logo = Number(db.query("INSERT INTO projects (client_id, name) VALUES (?, 'Logo')").run(client.id).lastInsertRowid);
    db.query("INSERT INTO time_entries (project_id, start_time, end_time) VALUES (?, '2026-11-02T09:00:00', '2026-11-02T12:00:00')").run(web.id);
    db.query("INSERT INTO time_entries (project_id, start_time, end_time) VALUES (?, '2026-11-20T09:00:00', '2026-11-20T10:00:00')").run(logo);
    db.query("INSERT INTO time_entries (project_id, start_time, end_time) VALUES (?, '2026-10-28T09:00:00', '2026-10-28T17:00:00')").run(web.id);
    const inv = Number(db.query("INSERT INTO invoices (number, client_id, issue_date, due_date, status, tax_rate) VALUES ('INV-9', ?, '2026-10-01', '2026-10-31', 'sent', 10)").run(client.id).lastInsertRowid);
    db.query("INSERT INTO invoice_items (invoice_id, description, hours, rate, amount) VALUES (?, 'x', 10, 100, 1000)").run(inv);
    return { db, client };
  }
  const NOW = new Date(2026, 10, 21, 12, 0, 0);

  test("hours this month exclude last month and split by project, busiest first", () => {
    const { db } = setup();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    const html = views.clientTableCard(NOW);
    expect(html).toContain('<span class="">4h</span>');
    expect(html.indexOf("Website</span><span>3h</span>")).toBeGreaterThan(-1);
    expect(html.indexOf("Website</span><span>3h</span>")).toBeLessThan(html.indexOf("Logo</span><span>1h</span>"));
  });

  test("outstanding sums sent Zinvoices with tax and flags overdue via the shared rule", () => {
    const { db } = setup();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [], isOverdue: () => true });
    const html = views.clientTableCard(NOW);
    expect(html).toContain('<span class="ui-tag ui-tag-error mg-overdue">Overdue</span>$1,100');
    expect(html).toContain("INV-9 · overdue</span><span>$1,100</span>");
    const calm = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [], isOverdue: () => false }).clientTableCard(NOW);
    expect(calm).not.toContain("mg-overdue");
    expect(calm).toContain("INV-9 · due Oct 31");
  });

  test("last tracked reads as a relative day and turns quiet after 30 days", () => {
    const { db } = setup();
    const views = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] });
    expect(views.clientTableCard(NOW)).toContain('<td class="col-last">Yesterday</td>');
    expect(views.clientTableCard(new Date(2026, 11, 25))).toContain('<td class="col-last is-quiet">5 weeks ago</td>');
  });

  test("rows are focusable dialog openers; No client is a footnote that still opens its dialog", () => {
    const { db } = setup();
    const html = createManageViews({ db, layout: (_t: string, b: string) => b, unbilledByClient: () => [] }).clientTableCard(NOW);
    expect(html).toMatch(/<tr class="mg-row" tabindex="0" data-client-edit="\d+" aria-haspopup="dialog" aria-label="Edit client Acme">/);
    expect(html).toContain('data-client-edit="none"');
    expect(html).toContain("No client · 0h this month");
  });
});
