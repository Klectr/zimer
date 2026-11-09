/** Manage views: clients in an M3 list-detail layout (#367, mirrors the
 *  invoices list-detail from #364). The leading pane lists clients; the
 *  detail pane manages the selected client's rate, payment terms, projects,
 *  and deletion. */

import type { Database } from "bun:sqlite";
import { esc, PAYMENT_TERMS, schemeColor, termsDescription, termsKey } from "../lib/format.ts";
import type { PaymentTermsKey } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import { THEMES, themeKey } from "../lib/theme.ts"; /* #884 */
import { getMeta } from "../db.ts";
import { settingsSection } from "../ui/settings-section.ts";
import { selectField, textAreaField, textField } from "../ui/field.ts";
import { button, linkButton } from "../ui/button.ts";
import { clientRow } from "../ui/rows.ts";
import { dayTargetSecs } from "../lib/domain.ts"; /* #908: daily target setting */

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
  function termsOptions(): { value: string; label: string; desc: string }[] {
    return (Object.entries(PAYMENT_TERMS) as [PaymentTermsKey, { label: string; description: string }][]).map(([k, v]) =>
      ({ value: k, label: v.label, desc: v.description }));
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

  function clientListHtml(sel: ClientSel | null): string {
    const { clients, byClient, unassigned } = manageData();
    const sk = selKey(sel);
    const rows = clients.map(c => {
      const n = (byClient.get(c.id) || []).length;
      return clientRow({
        name: c.name,
        meta: `${n} project${n === 1 ? "" : "s"}${c.rate ? ` · $${c.rate}/hr` : ""}`,
        href: `/manage?client=${c.id}`,
        ariaLabel: `Manage client ${c.name}`,
        dot: schemeColor(c.color) || "var(--color-primary)",
        selected: sk === c.id,
        chevron: true,
      });
    }).join("");
    const noneRow = clientRow({
      name: "No client",
      meta: `${unassigned.length} unassigned project${unassigned.length === 1 ? "" : "s"}`,
      href: "/manage?client=none",
      ariaLabel: "Manage projects with no client",
      iconDot: "group",
      selected: sk === "none",
      chevron: true,
    });
    return `<div class="ui-list" id="client-list">${rows}${noneRow}</div>`;
  }

  /* #367: out-of-band list refresh after a detail-pane action — the row
     supporting text (project count) must not go stale, and the pushed-URL
     history snapshot restores the right selection on back. */
  function clientListOob(sel: ClientSel | null): string {
    return clientListHtml(sel).replace(`id="client-list"`, `id="client-list" hx-swap-oob="true"`);
  }

  const projectRow = (p: any) => clientRow({
    name: p.name,
    actions: `<form method="post" action="/projects/${p.id}/delete" class="inline" hx-post="/projects/${p.id}/delete" hx-target="#client-detail" hx-swap="outerHTML"><button class="ui-icon-btn ui-icon-btn-danger" type="submit" data-confirm="Delete project? Entries keep their history." aria-label="Delete project ${esc(p.name)}" data-tip="Delete">${icon("delete")}</button></form>`,
  });

  const addProjectForm = (clientId: number | null) => `
      <form method="post" action="/projects" class="ui-add-project-form" hx-post="/projects" hx-target="#client-detail" hx-swap="outerHTML">
        ${clientId == null ? "" : `<input type="hidden" name="client_id" value="${clientId}">`}
        <div class="ui-add-project-grow">${textField({ id: "mp-name", label: "New project", name: "name", required: true })}</div>
        <button class="ui-icon-btn" type="submit" data-tip="Add project" aria-label="Add project">${icon("add")}</button>
      </form>`;

  /* #367: detail body as a fragment — project actions swap
     #client-detail in place instead of reloading the page.
     #630: rate and payment terms moved into the client settings modal;
     the detail pane keeps the header, projects, and deletion. */
  function clientDetailBody(sel: ClientSel): string {
    const { byClient, unassigned } = manageData();
    const isClient = sel.kind === "client";
    const c = isClient ? sel.client : null;
    const projects = isClient ? (byClient.get(c.id) || []) : unassigned;
    return `<div id="client-detail">
      <div class="page-head no-print">
        ${linkButton({ label: "Clients", href: "/manage", icon: "arrow_left", variant: "ghost", className: "detail-back" })}
      </div>
      <div class="client-detail-head${isClient ? " has-settings" : ""}">
        ${isClient
          ? `<div>
          <h2 class="ui-page-title">${esc(c.name)}</h2>
          <p class="muted" style="margin:4px 0 0">${projects.length} project${projects.length === 1 ? "" : "s"}${c.rate ? ` · $${c.rate}/hr` : ""}</p>
        </div>
        <button class="ui-icon-btn client-settings-open" type="button" data-client-id="${c.id}" data-tip="Client settings" aria-label="Client settings for ${esc(c.name)}" aria-haspopup="dialog">${icon("settings")}</button>`
          : `<span class="ui-row-lead-icon" aria-hidden="true">${icon("group")}</span>
        <div>
          <h2 class="ui-page-title">No client</h2>
          <p class="muted" style="margin:4px 0 0">Projects not assigned to a client</p>
        </div>`}
      </div>
      <h3 class="ui-block-title">Projects</h3>
      ${addProjectForm(isClient ? c.id : null)}
      <div class="ui-list">
        ${projects.map(projectRow).join("")}
      </div>
      ${isClient ? `
      <form method="post" action="/clients/${c.id}/delete" class="detail-form">
        ${button({ label: "Delete client", variant: "ghost", danger: true, type: "submit", attrs: 'data-confirm="Delete this client? Its projects move to No client."' })}
      </form>` : ""}
    </div>`;
  }

  function detailPlaceholder(): string {
    return `<div class="detail-placeholder">${icon("group")}<p class="muted">Select a client to manage its projects and settings.</p></div>`;
  }

  /* #630: client settings form — all seven editable client fields,
     lazy-loaded into the settings modal. Same trimming/NULL/CRLF rules as
     the old inline forms; the route enforces them. */
  function clientSettingsForm(c: any): string {
    const options = [
      { value: "", label: "Use global terms", desc: "Falls back to the global payment terms." },
      ...termsOptions(),
    ];
    return `<form method="post" action="/clients/${c.id}/settings" id="client-settings-form" class="ui-settings-form" hx-post="/clients/${c.id}/settings" hx-swap="outerHTML">` +
      textField({ id: "cs-name", label: "Client name", name: "name", value: c.name || "", required: true }) +
      textField({ id: "cs-rate", label: "Hourly rate", name: "rate", type: "number", value: c.rate ? String(c.rate) : "", min: "0", step: "0.01", prefix: "$", suffix: "/hr" }) +
      selectField({ id: "cs-terms", label: "Payment terms", name: "payment_terms", options, value: c.payment_terms || "", className: "terms-select" }) +
      `<p class="terms-desc ui-settings-note">${esc(termsDescription(termsKey(c.payment_terms, globalTerms())))}</p>` +
      textField({ id: "cs-email", label: "Email", name: "email", type: "email", value: c.email || "" }) +
      textField({ id: "cs-phone", label: "Phone", name: "phone", type: "tel", value: c.phone || "" }) +
      textField({ id: "cs-website", label: "Website", name: "website", value: c.website || "", attrs: 'autocapitalize="none" spellcheck="false"' }) +
      textAreaField({ id: "cs-address", label: "Address", name: "address", value: c.address || "", rows: 3 }) +
      `<div class="ui-settings-actions">${button({ label: "Save", type: "submit", variant: "primary" })}</div>` +
      `</form>`;
  }

  /* #630: client settings modal. Same scrim/dialog pattern as the #245
     settings modal (scrim fade + dialog scale/fade, Escape/scrim/close,
     focus trap, lazy-loaded body). Rendered once per manage page, outside
     every HTMX-swapped region. */
  function clientSettingsDialog(): string {
    return `<div class="cal-scrim" id="client-settings-scrim" hidden>
      <div class="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="client-settings-title">
        <div class="settings-dialog-head">
          <h2 class="ui-dialog-title" id="client-settings-title">Client settings</h2>
          <button class="ui-icon-btn" id="client-settings-close" type="button" aria-label="Close client settings">${icon("close")}</button>
        </div>
        <div id="client-settings-body"><p class="muted">Loading…</p></div>
      </div>
    </div>`;
  }

  /* Add-client lives in the list pane behind a toggle — a plain POST so the
     new client opens selected on every width (an in-place HTMX swap could
     not flip the single-pane shell to the detail on phones). */
  function addClientForm(): string {
    return `<div class="client-add">
      ${button({ label: "Add client", icon: "add", variant: "ghost", id: "client-add-toggle" })}
      <form method="post" action="/clients" id="client-add-form" class="ui-settings-form" hidden>
        ${textField({ id: "mc-name", label: "Client name", name: "name", required: true })}
        <div class="ui-form-row">
          <div style="max-width:172px">${textField({ id: "mc-rate", label: "Hourly rate", name: "rate", type: "number", min: "0", step: "0.01", prefix: "$", suffix: "/hr" })}</div>
          <label class="ui-color-control">
            ${icon("palette")}
            <span>Color</span>
            <input type="color" name="color" value="#fb923c" aria-label="Client color">
          </label>
          <span class="ui-form-spacer"></span>
          ${button({ label: "Add", icon: "add", type: "submit", variant: "primary" })}
        </div>
      </form>
    </div>`;
  }

  /* #805: isDefault marks the route's first-client fallback — same deal
     as the zinvoices pane: content on desktop, no has-selection so the
     single-pane (mobile) still opens on the list. */
  function managePage(sel: ClientSel | null, isDefault = false): string {
    /* #71: data-enter sits on the shell HTMX never replaces, so the entrance
       plays once per page load and never replays on swaps.
       #245: the business profile section moved into the settings modal
       behind the account menu button; the Manage page is clients & projects only. */
    return layout("Clients", `
      <div class="client-list-detail${sel && !isDefault ? " has-selection" : ""}" data-enter="2">
        <section class="client-list-pane" aria-label="Client list">
          <h1 class="ui-page-title">Clients</h1>
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
          /* #630: match the settings SAVE (POST) only — htmx 2.x reports the
             swap container (not the form) as detail.elt for this request, and
             the form's own GET load must not trigger the save flow. */
          var cfg=e.detail.requestConfig||{};
          var pi=e.detail.pathInfo||{};
          var m=(pi.requestPath||"").match(/\\/clients\\/(\\d+)\\/settings$/);
          if(m && e.detail.successful && (cfg.verb||"").toLowerCase()==="post"){
            if(window.tkSnackbar) window.tkSnackbar("Client settings saved");
            closeClientSettings(false);
            window.htmx.ajax("GET", "/manage?client=" + m[1] + "&fragment=detail",
              { target: "#client-detail-pane", swap: "innerHTML" });
          }
        });
      })();</script>`, "manage", true);
  }

  /* #233: business profile — name/email/address printed in the FROM block
     of the Modern PDF template. Stored in meta; empty degrades gracefully.
     #243 added payment terms. */
  function bizProfileSection(): string {
    const name = getMeta(db, "business_name");
    const email = getMeta(db, "business_email");
    const address = getMeta(db, "business_address");
    const terms = getMeta(db, "business_payment_terms");
    const options = (Object.entries(PAYMENT_TERMS) as [PaymentTermsKey, { label: string; description: string }][])
      .map(([k, v]) => ({ value: k, label: v.label, desc: v.description }));
    const body =
      `<form method="post" action="/business-profile" id="biz-profile-form" class="ui-settings-form" hx-post="/business-profile" hx-target="#biz-profile" hx-swap="outerHTML">` +
      textField({ id: "bp-business_name", label: "Business name", name: "business_name", value: name }) +
      textField({ id: "bp-business_email", label: "Email", name: "business_email", type: "email", value: email }) +
      textField({ id: "bp-business_address", label: "Address", name: "business_address", value: address }) +
      selectField({ id: "bp-terms", label: "Payment terms", name: "business_payment_terms", options, value: terms, className: "terms-select" }) +
      `<p class="terms-desc ui-settings-note">${esc(termsDescription(termsKey(null, terms)))}</p>` +
      `<div class="ui-settings-actions">${button({ label: "Save", type: "submit", variant: "primary", icon: "save" })}</div>` +
      `</form>`;
    return settingsSection({ level: 2, id: "biz-profile", title: "Business profile", hint: "Shown in the From block on zinvoices; the payment terms print on the zinvoice too.", bodyHtml: body });
  }

  /* #908: daily hours target — the pacing bars on the timer page (Today)
     and calendar (week = five days at this rate), plus the calendar's
     short-day tint, all follow this instead of the old 8h constant. Stored
     in meta; no migration. */
  function dailyTargetSection(): string {
    const hours = dayTargetSecs(db) / 3600;
    const body =
      `<form method="post" action="/daily-target" id="daily-target-form" class="ui-settings-form" hx-post="/daily-target" hx-target="#daily-target" hx-swap="outerHTML">` +
      textField({ id: "dt-hours", label: "Daily hours target", name: "day_target_hours", type: "number", value: String(hours), min: "1", max: "24", step: "0.5", inputmode: "decimal", suffix: "hr" }) +
      `<div class="ui-settings-actions">${button({ label: "Save", type: "submit", variant: "primary", icon: "save" })}</div>` +
      `</form>`;
    return settingsSection({ level: 2, id: "daily-target", title: "Daily hours target", hint: "Drives the pacing bars on the timer and calendar pages — the week target is five days at this rate.", bodyHtml: body });
  }

  /* #884: theme section — a row of color dots that re-theme the app's
     accent. Each dot posts its key; the response re-renders this section
     and live-swaps the <style id="theme-style"> override via OOB, so the
     page behind the modal changes instantly. Pumpkin is the default. */
  function themeSectionHtml(): string {
    const current = themeKey(getMeta(db, "theme"));
    const dots = THEMES.map((t) => {
      const selected = t.key === current;
      return `<button type="button" class="ui-theme-dot${selected ? " selected" : ""}"
          style="--dot:${t.primary}" hx-post="/settings/theme" hx-vals='{"theme":"${t.key}"}'
          hx-target="#theme-section" hx-swap="outerHTML"
          aria-label="${t.name} theme" aria-pressed="${selected}">${selected ? icon("check") : ""}</button>`;
    }).join("");
    return settingsSection({ level: 2, id: "theme-section", title: "Theme", hint: "Pumpkin is the default. Pick any accent.", bodyHtml: `<div class="ui-theme-dots" role="group" aria-label="Accent theme">${dots}</div>` });
  }

  /* #693: full-page fallback for direct (non-htmx) visits to /settings.
     The modal fragment alone renders unstyled without the app layout. */
  function settingsPage(settingsBody: string): string {
    return layout("Settings", `
      <div class="page-narrow" data-enter="2">
      <div class="ui-settings-head">
        <h1 class="ui-page-title">Settings</h1>
      </div>
      <div class="ui-settings-stack">${settingsBody}</div>
      </div>`, "settings");
  }

  return { managePage, clientSelection, clientDetailBody, clientListOob, bizProfileSection, dailyTargetSection, clientSettingsForm, settingsPage, themeSectionHtml };
}
