/** Manage views: clients with nested projects (in-place fragment) and the
 *  manage page shell. */

import type { Database } from "bun:sqlite";
import { esc } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import { getMeta } from "../db.ts";

export interface ManageViewDeps {
  db: Database;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean) => string;
}

export function createManageViews(deps: ManageViewDeps) {
  const { db, layout } = deps;

  /* #267: projects nest inside their client's list — one column of client
     sections, trailing "No client" section for unassigned projects.
     Actions still swap #manage-cols in place. */
  function manageCols(): string {
    const clients = db.query("SELECT * FROM clients ORDER BY name").all() as any[];
    const projects = db.query("SELECT * FROM projects ORDER BY name").all() as any[];
    const clientIds = new Set(clients.map(c => c.id));
    const byClient = new Map<number, any[]>();
    const unassigned: any[] = [];
    for (const p of projects) {
      /* Dangling client_id (possible in DBs written before #267, when the
         unenforced ON DELETE SET NULL left stale ids) counts as unassigned. */
      if (p.client_id == null || !clientIds.has(p.client_id)) unassigned.push(p);
      else {
        const list = byClient.get(p.client_id);
        if (list) list.push(p); else byClient.set(p.client_id, [p]);
      }
    }
    const projectRow = (p: any) => `<li class="md-list-item project-nest" style="min-height:56px">
              <div class="md-list-item-content"><div class="md-list-item-headline">${esc(p.name)}</div></div>
              <div class="md-list-item-trailing">
                <form method="post" action="/projects/${p.id}/delete" class="inline" hx-post="/projects/${p.id}/delete" hx-target="#manage-cols" hx-swap="outerHTML"><button class="md-icon-button danger" hx-confirm="Delete project? Entries keep their history." aria-label="Delete project ${esc(p.name)}" title="Delete">${icon("delete")}</button></form>
              </div>
            </li>`;
    const addProjectRow = (clientId: number | null, label: string) => `<li class="md-list-item add-project-row" style="min-height:56px">
              <form method="post" action="/projects" class="add-project-form" hx-post="/projects" hx-target="#manage-cols" hx-swap="outerHTML">
                ${clientId == null ? "" : `<input type="hidden" name="client_id" value="${clientId}">`}
                <div class="md-text-field compact">
                  <input type="text" name="name" placeholder=" " required aria-label="${esc(label)}">
                  <label>New project</label>
                </div>
                <button class="md-icon-button" type="submit" title="Add project" aria-label="${esc(label)}">${icon("add")}</button>
              </form>
            </li>`;
    const clientBlock = (c: any) => `<ul class="md-list">
            <li class="md-list-item" style="min-height:56px">
              <div class="md-list-item-content"><div class="md-list-item-headline"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${esc(c.color)};margin-right:8px"></span>${esc(c.name)}</div></div>
              <div class="md-list-item-trailing">
                <form method="post" action="/clients/${c.id}/rate" class="inline rate-form" hx-post="/clients/${c.id}/rate" hx-target="#manage-cols" hx-swap="outerHTML" title="Hourly rate">
                  <div class="md-text-field has-prefix has-suffix compact" style="width:104px">
                    <span class="affix prefix" aria-hidden="true">$</span>
                    <input type="number" name="rate" value="${c.rate || ""}" min="0" step="0.01" placeholder="0" aria-label="Hourly rate for ${esc(c.name)}">
                    <span class="affix suffix" aria-hidden="true">/hr</span>
                  </div>
                  <button class="md-icon-button" type="submit" title="Save" aria-label="Save hourly rate for ${esc(c.name)}">${icon("save")}</button>
                </form>
                <form method="post" action="/clients/${c.id}/delete" class="inline" hx-post="/clients/${c.id}/delete" hx-target="#manage-cols" hx-swap="outerHTML"><button class="md-icon-button danger" hx-confirm="Delete client? Its projects move to No client." aria-label="Delete client ${esc(c.name)}" title="Delete">${icon("delete")}</button></form>
              </div>
            </li>
            ${(byClient.get(c.id) || []).map(projectRow).join("")}
            ${addProjectRow(c.id, `Add project to ${c.name}`)}
          </ul>`;
    return `<div id="manage-cols">
        <section>
          <h2 class="md-headline-small">Clients</h2>
          <form method="post" action="/clients" class="manage-form" hx-post="/clients" hx-target="#manage-cols" hx-swap="outerHTML">
            <div class="md-text-field">
              <input type="text" name="name" placeholder=" " required aria-label="Client name">
              <label>Client name</label>
            </div>
            <div class="manage-form-row">
              <div class="md-text-field has-prefix has-suffix" style="max-width:172px">
                <span class="affix prefix" aria-hidden="true">$</span>
                <input type="number" name="rate" min="0" step="0.01" placeholder=" " aria-label="Hourly rate">
                <label>Hourly rate</label>
                <span class="affix suffix" aria-hidden="true">/hr</span>
              </div>
              <label class="md-color-control" title="Client color">
                ${icon("palette")}
                <span>Color</span>
                <input type="color" name="color" value="#f2c14e" aria-label="Client color">
              </label>
              <span class="manage-form-spacer"></span>
              <button class="md-filled-button" type="submit">${icon("add")}Add</button>
            </div>
          </form>
          ${clients.length ? clients.map(clientBlock).join("") : `<p class="muted">No clients yet.</p>`}
          <h3 class="md-title-medium manage-subhead">No client</h3>
          <ul class="md-list">
            ${unassigned.map(projectRow).join("")}
            ${addProjectRow(null, "Add project with no client")}
          </ul>
        </section>
      </div>`;
  }

  /* #233: business profile — name/email/address printed in the FROM block
     of the Modern PDF template. Stored in meta; empty degrades gracefully.
     #243 added payment terms. */
  function bizProfileSection(): string {
    const name = getMeta(db, "business_name");
    const email = getMeta(db, "business_email");
    const address = getMeta(db, "business_address");
    const terms = getMeta(db, "business_payment_terms");
    const field = (fname: string, label: string, val: string, type = "text") => `
            <div class="md-text-field">
              <input type="${type}" name="${fname}" value="${esc(val)}" placeholder=" " aria-label="${label}">
              <label>${label}</label>
            </div>`;
    return `<section id="biz-profile">
          <h2 class="md-headline-small">Business profile</h2>
          <p class="muted" style="margin:0 0 12px">Shown in the <em>From</em> block on invoices; the payment terms print on the invoice too.</p>
          <form method="post" action="/business-profile" id="biz-profile-form" class="manage-form" hx-post="/business-profile" hx-target="#biz-profile" hx-swap="outerHTML">
            ${field("business_name", "Business name", name)}
            ${field("business_email", "Email", email, "email")}
            ${field("business_address", "Address", address)}
            ${field("business_payment_terms", "Payment terms", terms)}
            <div class="manage-form-row">
              <span class="manage-form-spacer"></span>
              <button class="md-filled-button" type="submit">${icon("save")}Save</button>
            </div>
          </form>
        </section>`;
  }

  function managePage(): string {
    /* #71: data-enter sits on the shell HTMX never replaces, so the entrance
       plays once per page load and never replays on swaps.
       #245: the business profile section moved into the settings modal
       behind the account menu button; the Manage page is clients & projects only. */
    return layout("Clients & Projects", `
      <div class="scroll-region">
      <div data-enter="2" id="manage-wrap">${manageCols()}</div>
      </div>`, "manage", true);
  }

  function clientOptions(selected: number | null = null): string {
    const rows = db.query("SELECT id, name, rate FROM clients ORDER BY name").all() as any[];
    return rows.map(c =>
      `<option value="${c.id}" data-rate="${c.rate || 0}"${c.id === selected ? " selected" : ""}>${esc(c.name)}</option>`
    ).join("");
  }


  return { manageCols, managePage, clientOptions, bizProfileSection };
}
