/** Manage views: clients in an M3 list-detail layout (#367, mirrors the
 *  invoices list-detail from #364). The leading pane lists clients; the
 *  detail pane manages the selected client's rate, payment terms, projects,
 *  and deletion. */

import type { Database } from "bun:sqlite";
import { esc, PAYMENT_TERMS, termsDays, termsDescription, termsKey } from "../lib/format.ts";
import type { PaymentTermsKey } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import { getMeta } from "../db.ts";

/* #367: the detail-pane selection. "none" is the pseudo-client holding
   projects with no client assigned. */
export type ClientSel = { kind: "client"; client: any } | { kind: "none" };

export interface ManageViewDeps {
  db: Database;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean) => string;
}

export function createManageViews(deps: ManageViewDeps) {
  const { db, layout } = deps;

  /* #293: global terms value for the fallback chain. */
  const globalTerms = () => getMeta(db, "business_payment_terms");

  /* #293: option list for the payment-terms dropdowns. The canned
     description rides on data-desc so the helper text can update live. */
  function termsOptions(selected: string | null): string {
    return (Object.entries(PAYMENT_TERMS) as [PaymentTermsKey, { label: string; description: string }][]).map(([k, v]) =>
      `<option value="${k}" data-desc="${esc(v.description)}"${k === selected ? " selected" : ""}>${esc(v.label)}</option>`
    ).join("");
  }

  function manageData() {
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
    return { clients, byClient, unassigned };
  }

  /* #367: resolve ?client= — a numeric id, "none", or null (nothing
     selected). Unknown ids degrade to null (placeholder), never an error. */
  function clientSelection(raw: string | null): ClientSel | null {
    if (raw === "none") return { kind: "none" };
    if (raw && /^\d+$/.test(raw)) {
      const c = db.query("SELECT * FROM clients WHERE id = ?").get(Number(raw)) as any;
      if (c) return { kind: "client", client: c };
    }
    return null;
  }

  const selKey = (sel: ClientSel | null): number | "none" | null =>
    !sel ? null : sel.kind === "client" ? sel.client.id : "none";

  const dot = (color: string, large = false) =>
    `<span class="client-dot${large ? " large" : ""}" style="background:${esc(color)}" aria-hidden="true"></span>`;

  function clientListHtml(sel: ClientSel | null): string {
    const { clients, byClient, unassigned } = manageData();
    const sk = selKey(sel);
    const row = (href: string, dotHtml: string, name: string, supporting: string, selected: boolean, label: string) =>
      `<li class="md-list-item client-row${selected ? " selected" : ""}">
        <a class="client-row-hit" href="${href}" aria-label="${esc(label)}">
          ${dotHtml}
          <div class="md-list-item-content">
            <div class="md-list-item-headline">${esc(name)}</div>
            <div class="md-list-item-supporting">${supporting}</div>
          </div>
          <div class="md-list-item-trailing">${icon("chevron_right")}</div>
        </a>
      </li>`;
    const rows = clients.map(c => {
      const n = (byClient.get(c.id) || []).length;
      return row(`/manage?client=${c.id}`, dot(c.color || "#f2c14e"), c.name,
        `${n} project${n === 1 ? "" : "s"}${c.rate ? ` · $${c.rate}/hr` : ""}`,
        sk === c.id, `Manage client ${c.name}`);
    }).join("");
    const noneRow = row("/manage?client=none",
      `<span class="client-dot none" aria-hidden="true">${icon("group")}</span>`,
      "No client", `${unassigned.length} unassigned project${unassigned.length === 1 ? "" : "s"}`,
      sk === "none", "Manage projects with no client");
    return `<ul class="md-list" id="client-list">${rows}${noneRow}</ul>`;
  }

  /* #367: out-of-band list refresh after a detail-pane action — the row
     supporting text (project count) must not go stale, and the pushed-URL
     history snapshot restores the right selection on back. */
  function clientListOob(sel: ClientSel | null): string {
    return clientListHtml(sel).replace(`id="client-list"`, `id="client-list" hx-swap-oob="true"`);
  }

  const projectRow = (p: any) => `<li class="md-list-item" style="min-height:56px">
            <div class="md-list-item-content"><div class="md-list-item-headline">${esc(p.name)}</div></div>
            <div class="md-list-item-trailing">
              <form method="post" action="/projects/${p.id}/delete" class="inline" hx-post="/projects/${p.id}/delete" hx-target="#client-detail" hx-swap="outerHTML"><button class="md-icon-button danger" data-confirm="Delete project? Entries keep their history." aria-label="Delete project ${esc(p.name)}" data-tip="Delete">${icon("delete")}</button></form>
            </div>
          </li>`;

  const addProjectForm = (clientId: number | null) => `<li class="md-list-item add-project-row" style="min-height:56px">
            <form method="post" action="/projects" class="add-project-form" hx-post="/projects" hx-target="#client-detail" hx-swap="outerHTML">
              ${clientId == null ? "" : `<input type="hidden" name="client_id" value="${clientId}">`}
              <div class="md-text-field compact">
                <input type="text" name="name" placeholder=" " required aria-label="New project name">
                <label>New project</label>
              </div>
              <button class="md-icon-button" type="submit" data-tip="Add project" aria-label="Add project">${icon("add")}</button>
            </form>
          </li>`;

  /* #367: detail body as a fragment — rate/terms/project actions swap
     #client-detail in place instead of reloading the page. */
  function clientDetailBody(sel: ClientSel): string {
    const hxDetail = `hx-target="#client-detail" hx-swap="outerHTML"`;
    const { byClient, unassigned } = manageData();
    const isClient = sel.kind === "client";
    const c = isClient ? sel.client : null;
    const projects = isClient ? (byClient.get(c.id) || []) : unassigned;
    return `<div id="client-detail">
      <div class="page-head no-print">
        <a class="md-text-button detail-back" href="/manage">${icon("arrow_left")}Clients</a>
      </div>
      <div class="client-detail-head">
        ${isClient ? dot(c.color || "#f2c14e", true) : `<span class="client-dot large none" aria-hidden="true">${icon("group")}</span>`}
        <div>
          <h2 class="md-headline-small">${isClient ? esc(c.name) : "No client"}</h2>
          <p class="muted" style="margin:4px 0 0">${isClient
            ? `${projects.length} project${projects.length === 1 ? "" : "s"}${c.rate ? ` · $${c.rate}/hr` : ""}`
            : "Projects not assigned to a client"}</p>
        </div>
        ${/* #630: name + contact details moved into the settings modal. */
          isClient ? `<button class="md-icon-button client-settings-open" type="button" data-client-id="${c.id}" data-tip="Client settings" aria-label="Client settings for ${esc(c.name)}" aria-haspopup="dialog">${icon("settings")}</button>` : ""}
      </div>
      ${isClient ? `
      <form method="post" action="/clients/${c.id}/rate" class="rate-form detail-form" hx-post="/clients/${c.id}/rate" ${hxDetail}>
        <div class="md-text-field has-prefix has-suffix compact" style="width:104px">
          <span class="affix prefix" aria-hidden="true">$</span>
          <input type="number" name="rate" value="${c.rate || ""}" min="0" step="0.01" placeholder="0" aria-label="Hourly rate for ${esc(c.name)}">
          <span class="affix suffix" aria-hidden="true">/hr</span>
        </div>
        <button class="md-icon-button" type="submit" data-tip="Save" aria-label="Save hourly rate for ${esc(c.name)}">${icon("save")}</button>
      </form>
      <form method="post" action="/clients/${c.id}/terms" class="terms-form detail-form" hx-post="/clients/${c.id}/terms" ${hxDetail}>
        <div class="md-text-field compact" style="flex:1;min-width:120px">
          <select name="payment_terms" class="terms-select" aria-label="Payment terms for ${esc(c.name)}">
            <option value="" data-desc="Falls back to the global payment terms."${c.payment_terms ? "" : " selected"}>Use global terms</option>
            ${termsOptions(c.payment_terms)}
          </select>
          <label>Payment terms</label>
        </div>
        <button class="md-icon-button" type="submit" data-tip="Save" aria-label="Save payment terms for ${esc(c.name)}">${icon("save")}</button>
      </form>
      <p class="terms-desc muted">${esc(termsDescription(termsKey(c.payment_terms, globalTerms())))}</p>` : ""}
      <h3 class="md-title-medium manage-subhead">Projects</h3>
      <ul class="md-list">
        ${projects.map(projectRow).join("")}
        ${addProjectForm(isClient ? c.id : null)}
      </ul>
      ${isClient ? `
      <form method="post" action="/clients/${c.id}/delete" class="detail-form">
        <button class="md-text-button danger" type="submit" data-confirm="Delete this client? Its projects move to No client.">Delete client</button>
      </form>` : ""}
    </div>`;
  }

  function detailPlaceholder(): string {
    return `<div class="detail-placeholder">${icon("group")}<p class="muted">Select a client to manage its projects, rate, and payment terms.</p></div>`;
  }

  /* #630: client settings form — name + contact details, lazy-loaded into
     the settings modal. Same trimming/NULL/CRLF rules as the old inline
     #627 contact form; the route enforces them. */
  function clientSettingsForm(c: any): string {
    const field = (type: string, name: string, label: string, val: string, extra = "") => `
          <div class="md-text-field">
            <input type="${type}" name="${name}" value="${esc(val)}" placeholder=" " aria-label="${label}"${extra}>
            <label>${label}</label>
          </div>`;
    return `<form method="post" action="/clients/${c.id}/settings" id="client-settings-form" class="manage-form" hx-post="/clients/${c.id}/settings" hx-swap="outerHTML">
        ${field("text", "name", "Client name", c.name || "", " required")}
        ${field("email", "email", "Email", c.email || "")}
        ${field("tel", "phone", "Phone", c.phone || "")}
        ${field("text", "website", "Website", c.website || "", ' autocapitalize="none" spellcheck="false"')}
        <div class="md-text-field">
          <textarea name="address" placeholder=" " rows="3" aria-label="Client address">${esc(c.address || "")}</textarea>
          <label>Address</label>
        </div>
        <button class="md-filled-button" type="submit">Save</button>
      </form>`;
  }

  /* #630: client settings modal. Same scrim/dialog pattern as the #245
     settings modal (scrim fade + dialog scale/fade, Escape/scrim/close,
     focus trap, lazy-loaded body). Rendered once per manage page, outside
     every HTMX-swapped region. */
  function clientSettingsDialog(): string {
    return `<div class="cal-scrim" id="client-settings-scrim" hidden>
      <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="client-settings-title">
        <div class="settings-dialog-head">
          <h2 class="md-headline-small" id="client-settings-title">Client settings</h2>
          <button class="md-icon-button" id="client-settings-close" type="button" aria-label="Close client settings">${icon("close")}</button>
        </div>
        <div id="client-settings-body"><p class="muted md-body-medium">Loading…</p></div>
      </div>
    </div>`;
  }

  /* Add-client lives in the list pane behind a toggle — a plain POST so the
     new client opens selected on every width (an in-place HTMX swap could
     not flip the single-pane shell to the detail on phones). */
  function addClientForm(): string {
    return `<div class="client-add">
      <button class="md-text-button" type="button" id="client-add-toggle">${icon("add")}Add client</button>
      <form method="post" action="/clients" id="client-add-form" class="manage-form" hidden>
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
          <label class="md-color-control">
            ${icon("palette")}
            <span>Color</span>
            <input type="color" name="color" value="#f2c14e" aria-label="Client color">
          </label>
          <span class="manage-form-spacer"></span>
          <button class="md-filled-button" type="submit">${icon("add")}Add</button>
        </div>
      </form>
    </div>`;
  }

  function managePage(sel: ClientSel | null): string {
    /* #71: data-enter sits on the shell HTMX never replaces, so the entrance
       plays once per page load and never replays on swaps.
       #245: the business profile section moved into the settings modal
       behind the account menu button; the Manage page is clients & projects only. */
    return layout("Clients & Projects", `
      <div class="client-list-detail${sel ? " has-selection" : ""}" data-enter="2">
        <section class="client-list-pane" aria-label="Client list">
          <h2 class="md-headline-small">Clients</h2>
          ${addClientForm()}
          ${clientListHtml(sel)}
        </section>
        <section class="client-detail-pane" id="client-detail-pane" aria-label="Client detail">
          ${sel ? clientDetailBody(sel) : detailPlaceholder()}
        </section>
      </div>
      ${clientSettingsDialog()}
      <script>(function(){
        /* #367: add-client toggle. The form is outside every HTMX-swapped
           region, so its id is safe to query directly. */
        var tgl = document.getElementById("client-add-toggle");
        var frm = document.getElementById("client-add-form");
        if (tgl && frm) tgl.addEventListener("click", function(){
          frm.hidden = !frm.hidden;
          if (!frm.hidden) { var i = frm.querySelector('input[name="name"]'); if (i) i.focus(); }
        });
        /* #367: two-pane selection, mirrors the invoices list-detail (#364).
           At ≥840px a row click swaps the detail pane in place (the fragment
           pushes ?client=<id> and OOB-marks the selected row); below that
           the link navigates to the single-pane detail screen. Delegated so
           it survives the list's OOB swaps. */
        var wrap = document.querySelector(".client-list-detail");
        if (!wrap || !window.htmx) return;
        var mq = window.matchMedia("(min-width: 840px)");
        wrap.addEventListener("click", function(ev){
          var link = ev.target.closest(".client-row-hit");
          if (!link || !mq.matches) return;
          ev.preventDefault();
          window.htmx.ajax("GET", link.getAttribute("href") + "&fragment=detail",
            { target: "#client-detail-pane", swap: "innerHTML" });
        });
        /* #630: client settings modal — cog opens it (delegated: the button
           lives inside HTMX-swapped detail HTML), the form lazy-loads, and a
           successful save closes the modal and refreshes the detail pane
           (the fragment carries the OOB list update for renames). */
        var dlgScrim = document.getElementById("client-settings-scrim");
        var dlgBody = document.getElementById("client-settings-body");
        var dlgClose = document.getElementById("client-settings-close");
        function openClientSettings(id){
          if(!dlgScrim || !dlgBody || !window.htmx) return;
          dlgScrim.hidden = false; void dlgScrim.offsetWidth; dlgScrim.classList.add("open");
          window.htmx.ajax("GET", "/clients/" + id + "/settings",
            { target: "#client-settings-body", swap: "innerHTML" });
          document.addEventListener("keydown", onClientSettingsKey, true);
        }
        function closeClientSettings(refocus){
          if(!dlgScrim || dlgScrim.hidden) return;
          dlgScrim.classList.remove("open");
          document.removeEventListener("keydown", onClientSettingsKey, true);
          var done=false, finish=function(){ if(done) return; done=true; dlgScrim.hidden=true; };
          var onEnd=function(e){ if(e.target===dlgScrim&&e.propertyName==="opacity"){ dlgScrim.removeEventListener("transitionend",onEnd); finish(); } };
          dlgScrim.addEventListener("transitionend",onEnd); setTimeout(finish,300);
          if(refocus){ var btn=wrap.querySelector(".client-settings-open"); if(btn) btn.focus(); }
        }
        function onClientSettingsKey(e){
          if(e.key==="Escape"){ e.preventDefault(); closeClientSettings(true); }
          else if(e.key==="Tab" && window.tkTrapTab){ window.tkTrapTab(dlgScrim, e); }
        }
        if(dlgScrim){
          dlgScrim.addEventListener("pointerdown", function(e){ if(e.target===dlgScrim) closeClientSettings(false); });
          if(dlgClose) dlgClose.addEventListener("click", function(){ closeClientSettings(true); });
          dlgBody.addEventListener("htmx:afterSwap", function(){
            var f=dlgBody.querySelector("input"); if(f) f.focus();
          });
        }
        wrap.addEventListener("click", function(ev){
          var cog = ev.target.closest(".client-settings-open");
          if(cog) openClientSettings(cog.getAttribute("data-client-id"));
        });
        document.body.addEventListener("htmx:afterRequest", function(e){
          var elt=e.detail.elt;
          if(elt && elt.id==="client-settings-form" && e.detail.successful){
            if(window.tkSnackbar) window.tkSnackbar("Client settings saved");
            closeClientSettings(false);
            var m=elt.getAttribute("action").match(/\\/clients\\/(\\d+)\\/settings/);
            if(m) window.htmx.ajax("GET", "/manage?client=" + m[1] + "&fragment=detail",
              { target: "#client-detail-pane", swap: "innerHTML" });
          }
        });
      })();</script>`, "manage", true);
  }

  function clientOptions(selected: number | null = null): string {
    const rows = db.query("SELECT id, name, rate, payment_terms FROM clients ORDER BY name").all() as any[];
    const g = globalTerms();
    return rows.map(c => {
      /* #293: effective terms days ride along so the new-invoice form can
         derive the due date when the client changes. */
      const days = termsDays(c.payment_terms || g);
      return `<option value="${c.id}" data-rate="${c.rate || 0}"${days === null ? "" : ` data-terms-days="${days}"`}${c.id === selected ? " selected" : ""}>${esc(c.name)}</option>`;
    }).join("");
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
            <div class="md-text-field">
              <select name="business_payment_terms" class="terms-select" aria-label="Payment terms">
                ${termsOptions(terms || null)}
              </select>
              <label>Payment terms</label>
            </div>
            <p class="terms-desc muted">${esc(termsDescription(termsKey(null, terms)))}</p>
            <div class="manage-form-row">
              <span class="manage-form-spacer"></span>
              <button class="md-filled-button" type="submit">${icon("save")}Save</button>
            </div>
          </form>
        </section>`;
  }

  return { managePage, clientSelection, clientDetailBody, clientListOob, clientOptions, bizProfileSection, clientSettingsForm };
}
