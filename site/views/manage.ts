/** Manage views: one stacked page in the suite mock's composition — the
 *  add-client form at the top, the client table, and the projects card.
 *  Editing a client opens a dialog holding its settings form, its
 *  projects, and its delete action. */

import type { Database } from "bun:sqlite";
import { clientColor, durationSeconds, esc, PAYMENT_TERMS, round2, schemeColor, termsDescription, termsKey } from "../lib/format.ts";
import type { PaymentTermsKey } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import { THEMES, themeKey } from "../lib/theme.ts"; /* #884 */
import { getMeta } from "../db.ts";
import { settingsSection } from "../ui/settings-section.ts";
import { selectField, textAreaField, textField } from "../ui/field.ts";
import { button } from "../ui/button.ts";
import { card } from "../ui/card.ts";
import { tag } from "../ui/tag.ts";
import { clientRow } from "../ui/rows.ts";
import { dayTargetSecs } from "../lib/domain.ts"; /* #908: daily target setting */
import { appHeader } from "../ui/app-header.ts";
import { iconButton } from "../ui/icon-button.ts";

/* The selection a client dialog opens for. "none" is the pseudo-client
   holding projects with no client assigned. */
export type ClientSel = { kind: "client"; client: any } | { kind: "none" };

export interface ManageViewDeps {
  db: Database;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean) => string;
  unbilledByClient: () => { id: number; name: string; secs: number }[];
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
    return { clients, projects, byClient, unassigned };
  }

  /* Resolve a dialog key — a numeric client id, "none", or null (unknown
     ids degrade to null, never an error). */
  function clientSelection(raw: string | null): ClientSel | null {
    if (raw === "none") return { kind: "none" };
    if (raw && /^\d+$/.test(raw)) {
      const c = db.query("SELECT * FROM clients WHERE id = ?").get(Number(raw)) as any;
      if (c) return { kind: "client", client: c };
    }
    return null;
  }

  function countsSub(): string {
    const { clients, projects } = manageData();
    return `${clients.length} client${clients.length === 1 ? "" : "s"} · ${projects.length} project${projects.length === 1 ? "" : "s"}`;
  }

  function unbilledMoneyByClient(): Map<number, number> {
    const rows = db.query(
      `SELECT c.id AS client_id, c.rate AS rate, p.id AS project_id, e.start_time, e.end_time
       FROM time_entries e
       JOIN projects p ON p.id = e.project_id
       JOIN clients c ON c.id = p.client_id
       WHERE e.invoice_id IS NULL AND e.end_time IS NOT NULL`).all() as any[];
    const groups = new Map<string, { clientId: number; rate: number; secs: number }>();
    for (const r of rows) {
      const key = `${r.client_id}:${r.project_id}`;
      const g = groups.get(key) ?? { clientId: r.client_id, rate: r.rate || 0, secs: 0 };
      const raw = durationSeconds(r.start_time, r.end_time);
      g.secs += raw > 0 ? Math.ceil(raw / 300) * 300 : raw;
      groups.set(key, g);
    }
    const totals = new Map<number, number>();
    for (const g of groups.values()) {
      const amount = round2(round2(g.secs / 3600) * g.rate);
      totals.set(g.clientId, round2((totals.get(g.clientId) ?? 0) + amount));
    }
    return totals;
  }

  const moneyCell = (n: number): string =>
    "$" + n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

  function addClientCard(): string {
    return card({
      tracking: true,
      content:
        `<h3 class="ui-block-title">Add a client</h3>` +
        `<form method="post" action="/clients" id="client-add-form" class="manage-add-form">` +
        `<div class="manage-add-grow">${textField({ id: "mc-name", label: "Client name", name: "name", required: true, placeholder: "e.g. Harbor Dental" })}</div>` +
        `<div class="manage-add-email">${textField({ id: "mc-email", label: "Email", name: "email", type: "email", placeholder: "billing@client.example" })}</div>` +
        `<div class="manage-add-rate">${textField({ id: "mc-rate", label: "Default rate", name: "rate", type: "number", min: "0", step: "0.01", prefix: "$", suffix: "/hr" })}</div>` +
        `<label class="ui-color-control">${icon("palette")}<span>Color</span><input type="color" name="color" value="#fb923c" aria-label="Client color"></label>` +
        button({ label: "Add client", icon: "add", type: "submit", variant: "primary" }) +
        `</form>`,
    });
  }

  function clientTableCard(): string {
    const { clients, byClient, unassigned } = manageData();
    const unbilled = unbilledMoneyByClient();
    const editBtn = (key: number | "none", label: string) =>
      button({ label: "Edit", size: "sm", attrs: `data-client-edit="${key}" aria-haspopup="dialog" aria-label="${esc(label)}"` });
    const projectNames = (list: any[]) => list.map(p => esc(p.name)).join(" · ") || "—";
    const rows = clients.map(c => `<tr>
        <td><span class="manage-client-name"><span class="ui-row-lead-dot" style="background:${esc(schemeColor(c.color) || "var(--color-primary)")}" aria-hidden="true"></span>${esc(c.name)}</span></td>
        <td>${c.rate ? `$${c.rate}/hr` : "—"}</td>
        <td class="col-projects">${projectNames(byClient.get(c.id) || [])}</td>
        <td class="num col-unbilled">${moneyCell(unbilled.get(c.id) || 0)}</td>
        <td class="manage-edit-cell">${editBtn(c.id, `Edit client ${c.name}`)}</td>
      </tr>`).join("");
    const noneRow = `<tr>
        <td><span class="manage-client-name"><span class="ui-row-lead-icon" aria-hidden="true">${icon("group")}</span>No client</span></td>
        <td>—</td>
        <td class="col-projects">${projectNames(unassigned)}</td>
        <td class="num col-unbilled">—</td>
        <td class="manage-edit-cell">${editBtn("none", "Edit projects with no client")}</td>
      </tr>`;
    return card({
      id: "client-table-card",
      className: "manage-table-card",
      content: `<table class="ui-table"><thead><tr><th>Client</th><th>Default rate</th><th class="col-projects">Projects</th><th class="num col-unbilled">Unbilled</th><th><span class="ui-sr-only">Actions</span></th></tr></thead><tbody>${rows}${noneRow}</tbody></table>`,
    });
  }

  function projectsCard(): string {
    const { clients, byClient, unassigned } = manageData();
    const chips: string[] = [];
    for (const c of clients)
      for (const p of byClient.get(c.id) || []) chips.push(tag({ label: `${c.name} — ${p.name}` }));
    for (const p of unassigned) chips.push(tag({ label: p.name }));
    return card({
      id: "projects-card",
      content:
        `<h3 class="ui-block-title">Projects</h3>` +
        `<div class="manage-chips">${chips.join("")}<button type="button" class="ui-tag ui-tag-neutral manage-new-project" id="new-project-open">${icon("add")}New project</button></div>` +
        `<p class="manage-note">Projects live under their client. Deleting a project never deletes time: its entries keep their history, and past Zinvoices keep their lines.</p>`,
    });
  }

  function manageListsOob(): string {
    return clientTableCard().replace(`id="client-table-card"`, `id="client-table-card" hx-swap-oob="true"`)
      + projectsCard().replace(`id="projects-card"`, `id="projects-card" hx-swap-oob="true"`)
      + `<p class="ui-app-sub" id="mg-sub" hx-swap-oob="true">${esc(countsSub())}</p>`;
  }

  const projectRow = (p: any) => clientRow({
    name: p.name,
    actions: `<form method="post" action="/projects/${p.id}/delete" class="inline" hx-post="/projects/${p.id}/delete" hx-target="#client-dialog-projects" hx-swap="outerHTML">${iconButton({ icon: "delete", label: `Delete project ${p.name}`, tip: "Delete", danger: true, type: "submit", attrs: `data-confirm="Delete project? Entries keep their history."` })}</form>`,
  });

  const addProjectForm = (clientId: number | null) => `
      <form method="post" action="/projects" class="ui-add-project-form" hx-post="/projects" hx-target="#client-dialog-projects" hx-swap="outerHTML">
        ${clientId == null ? "" : `<input type="hidden" name="client_id" value="${clientId}">`}
        <div class="ui-add-project-grow">${textField({ id: "mp-name", label: "New project", name: "name", required: true })}</div>
        ${iconButton({ icon: "add", label: "Add project", type: "submit" })}
      </form>`;

  function clientDialogProjects(sel: ClientSel): string {
    const { byClient, unassigned } = manageData();
    const isClient = sel.kind === "client";
    const projects = isClient ? (byClient.get(sel.client.id) || []) : unassigned;
    return `<div id="client-dialog-projects">
      <h3 class="ui-block-title">Projects</h3>
      ${addProjectForm(isClient ? sel.client.id : null)}
      <div class="ui-list">
        ${projects.map(projectRow).join("")}
      </div>
    </div>`;
  }

  function clientDialogBody(sel: ClientSel): string {
    if (sel.kind === "none") {
      return `<div data-client-name="No client">${clientDialogProjects(sel)}</div>`;
    }
    const c = sel.client;
    return clientSettingsForm(c) + clientDialogProjects(sel) + `
      <form method="post" action="/clients/${c.id}/delete" class="detail-form manage-delete-client">
        ${button({ label: "Delete client", variant: "ghost", danger: true, type: "submit", attrs: 'data-confirm="Delete this client? Its projects move to No client."' })}
      </form>`;
  }

  /* #630: client settings form — all eight editable client fields,
     lazy-loaded into the settings modal. Same trimming/NULL/CRLF rules as
     the old inline forms; the route enforces them. #1160: color joins the
     form (create no longer owns it), and a failed save re-renders through
     here with the route's error line and the submitted values. */
  function clientSettingsForm(c: any, error?: string): string {
    const options = [
      { value: "", label: "Use global terms", desc: "Falls back to the global payment terms." },
      ...termsOptions(),
    ];
    return `<form method="post" action="/clients/${c.id}/settings" id="client-settings-form" class="ui-settings-form" hx-post="/clients/${c.id}/settings" hx-swap="outerHTML" data-client-name="${esc(c.name || "")}">` +
      (error ? `<p class="error" role="alert">${esc(error)}</p>` : "") +
      textField({ id: "cs-name", label: "Client name", name: "name", value: c.name || "", required: true }) +
      `<div class="ui-form-row">` +
      `<div style="max-width:172px">${textField({ id: "cs-rate", label: "Hourly rate", name: "rate", type: "number", value: c.rate ? String(c.rate) : "", min: "0", step: "0.01", prefix: "$", suffix: "/hr" })}</div>` +
      `<label class="ui-color-control">
            ${icon("palette")}
            <span>Color</span>
            <input type="color" name="color" value="${clientColor(c.color)}" aria-label="Client color">
          </label>` +
      `</div>` +
      selectField({ id: "cs-terms", label: "Payment terms", name: "payment_terms", options, value: c.payment_terms || "", className: "terms-select" }) +
      `<p class="terms-desc ui-settings-note">${esc(termsDescription(termsKey(c.payment_terms, globalTerms())))}</p>` +
      textField({ id: "cs-email", label: "Email", name: "email", type: "email", value: c.email || "" }) +
      textField({ id: "cs-phone", label: "Phone", name: "phone", type: "tel", value: c.phone || "" }) +
      textField({ id: "cs-website", label: "Website", name: "website", value: c.website || "", attrs: 'autocapitalize="none" spellcheck="false"' }) +
      textAreaField({ id: "cs-address", label: "Address", name: "address", value: c.address || "", rows: 3 }) +
      `<div class="ui-settings-actions">${button({ label: "Cancel", type: "button", variant: "ghost", id: "client-settings-cancel" })}${button({ label: "Save", type: "submit", variant: "primary" })}</div>` +
      `</form>`;
  }

  function clientDialog(): string {
    return `<div class="cal-scrim ui-scrim" id="client-settings-scrim" hidden>
      <div class="settings-dialog ui-dialog" role="dialog" aria-modal="true" aria-labelledby="client-settings-title">
        <div class="settings-dialog-head">
          <div>
            <h2 class="ui-dialog-title" id="client-settings-title">Client</h2>
            <p class="ui-settings-note" id="client-settings-sub" hidden>Rate, terms, color, contact details, and projects.</p>
          </div>
          ${iconButton({ icon: "close", label: "Close client dialog", id: "client-settings-close", tip: null })}
        </div>
        <div id="client-settings-body"><p class="muted">Loading…</p></div>
      </div>
    </div>`;
  }

  function newProjectDialog(): string {
    const { clients } = manageData();
    const options = [
      { value: "", label: "No client" },
      ...clients.map(c => ({ value: String(c.id), label: c.name })),
    ];
    return `<div class="cal-scrim ui-scrim" id="new-project-scrim" hidden>
      <div class="settings-dialog ui-dialog" role="dialog" aria-modal="true" aria-labelledby="new-project-title">
        <div class="settings-dialog-head">
          <div>
            <h2 class="ui-dialog-title" id="new-project-title">New project</h2>
          </div>
          ${iconButton({ icon: "close", label: "Close new project", id: "new-project-close", tip: null })}
        </div>
        <form method="post" action="/projects" id="new-project-form" class="ui-settings-form" hx-post="/projects" hx-swap="none">
          <input type="hidden" name="context" value="page">
          ${selectField({ id: "np-client", label: "Client", name: "client_id", options, value: "" })}
          ${textField({ id: "np-name", label: "Project name", name: "name", required: true })}
          <div class="ui-settings-actions">${button({ label: "Cancel", type: "button", variant: "ghost", id: "new-project-cancel" })}${button({ label: "Add project", type: "submit", variant: "primary" })}</div>
        </form>
      </div>
    </div>`;
  }

  function managePage(): string {
    return layout("Manage", `
      ${appHeader({ title: "Manage", sub: countsSub(), subId: "mg-sub" })}
      <div class="manage-stack" data-enter="2">
        ${addClientCard()}
        ${clientTableCard()}
        ${projectsCard()}
      </div>
      ${clientDialog()}
      ${newProjectDialog()}
      <script>(function(){
        var stack = document.querySelector(".manage-stack");
        if (!stack || !window.htmx) return;
        var dlgScrim = document.getElementById("client-settings-scrim");
        var dlgBody = document.getElementById("client-settings-body");
        var dlgClose = document.getElementById("client-settings-close");
        var dlgTitle = document.getElementById("client-settings-title");
        var dlgSub = document.getElementById("client-settings-sub");
        var dlgGen = 0;
        function openClientDialog(key){
          if(!dlgScrim || !dlgBody) return;
          dlgGen++;
          if(dlgTitle) dlgTitle.textContent = "Client";
          if(dlgSub) dlgSub.hidden = true;
          dlgBody.innerHTML = '<p class="muted">Loading…</p>';
          dlgScrim.hidden = false; void dlgScrim.offsetWidth; dlgScrim.classList.add("open");
          window.htmx.ajax("GET", "/clients/" + key + "/dialog",
            { target: "#client-settings-body", swap: "innerHTML" });
          document.addEventListener("keydown", onClientDialogKey, true);
        }
        function closeClientDialog(refocus){
          if(!dlgScrim || dlgScrim.hidden) return;
          dlgGen++;
          dlgScrim.classList.remove("open");
          document.removeEventListener("keydown", onClientDialogKey, true);
          var gen=dlgGen, done=false, finish=function(){ if(done||gen!==dlgGen) return; done=true; dlgScrim.hidden=true; };
          var onEnd=function(e){ if(e.target===dlgScrim&&e.propertyName==="opacity"){ dlgScrim.removeEventListener("transitionend",onEnd); finish(); } };
          dlgScrim.addEventListener("transitionend",onEnd); setTimeout(finish,300);
          if(refocus){ var btn=stack.querySelector("[data-client-edit]"); if(btn) btn.focus(); }
        }
        function onClientDialogKey(e){
          if(e.key==="Escape"){ e.preventDefault(); closeClientDialog(true); }
          else if(e.key==="Tab" && window.tkTrapTab){ window.tkTrapTab(dlgScrim, e); }
        }
        if(dlgScrim){
          document.body.addEventListener("htmx:beforeRequest", function(e){
            var cfg=e.detail.requestConfig||{};
            var pi=e.detail.pathInfo||{};
            if(e.detail.target===dlgBody && (cfg.verb||"").toLowerCase()==="get" && /\/clients\/[^/]+\/dialog$/.test(pi.requestPath||cfg.path||""))
              e.detail.xhr.tkCsGen=dlgGen;
          });
          dlgBody.addEventListener("htmx:beforeSwap", function(e){
            var cfg=e.detail.requestConfig||{};
            if((cfg.verb||"").toLowerCase()!=="get") return;
            var g=e.detail.xhr ? e.detail.xhr.tkCsGen : null;
            if(g!=null && g!==dlgGen) e.detail.shouldSwap=false;
          });
          dlgScrim.addEventListener("pointerdown", function(e){ if(e.target===dlgScrim) closeClientDialog(false); });
          if(dlgClose) dlgClose.addEventListener("click", function(){ closeClientDialog(true); });
          dlgBody.addEventListener("htmx:afterSwap", function(){
            var holder=dlgBody.querySelector("[data-client-name]");
            var nm=holder ? (holder.getAttribute("data-client-name")||"").trim() : "";
            if(nm && dlgTitle){ dlgTitle.textContent=nm; if(dlgSub) dlgSub.hidden=false; }
            var f=dlgBody.querySelector("input"); if(f) f.focus();
          });
          dlgBody.addEventListener("click", function(ev){
            if(ev.target.closest("#client-settings-cancel")) closeClientDialog(true);
          });
        }
        document.body.addEventListener("htmx:beforeSwap", function(e){
          var cfg=e.detail.requestConfig||{};
          var pi=e.detail.pathInfo||{};
          var p=pi.requestPath||cfg.path||"";
          if(e.detail.xhr && e.detail.xhr.status===422 && (cfg.verb||"").toLowerCase()==="post" && /\/clients\/\d+\/settings$/.test(p)){
            e.detail.shouldSwap = true;
            e.detail.isError = false;
          }
        });
        document.body.addEventListener("htmx:afterRequest", function(e){
          var cfg=e.detail.requestConfig||{};
          var pi=e.detail.pathInfo||{};
          var m=(pi.requestPath||"").match(/\/clients\/(\d+)\/settings$/);
          if(m && e.detail.successful && (cfg.verb||"").toLowerCase()==="post"){
            if(window.tkSnackbar) window.tkSnackbar("Client settings saved");
            closeClientDialog(false);
          }
        });
        var npScrim = document.getElementById("new-project-scrim");
        var npForm = document.getElementById("new-project-form");
        var npClose = document.getElementById("new-project-close");
        var npCancel = document.getElementById("new-project-cancel");
        var npGen = 0;
        function openNewProject(){
          if(!npScrim) return;
          npGen++;
          npScrim.hidden = false; void npScrim.offsetWidth; npScrim.classList.add("open");
          document.addEventListener("keydown", onNewProjectKey, true);
          var f=npForm ? npForm.querySelector("select") : null; if(f) f.focus();
        }
        function closeNewProject(refocus){
          if(!npScrim || npScrim.hidden) return;
          npGen++;
          npScrim.classList.remove("open");
          document.removeEventListener("keydown", onNewProjectKey, true);
          var gen=npGen, done=false, finish=function(){ if(done||gen!==npGen) return; done=true; npScrim.hidden=true; };
          var onEnd=function(e){ if(e.target===npScrim&&e.propertyName==="opacity"){ npScrim.removeEventListener("transitionend",onEnd); finish(); } };
          npScrim.addEventListener("transitionend",onEnd); setTimeout(finish,300);
          if(refocus){ var chip=document.getElementById("new-project-open"); if(chip) chip.focus(); }
        }
        function onNewProjectKey(e){
          if(e.key==="Escape"){ e.preventDefault(); closeNewProject(true); }
          else if(e.key==="Tab" && window.tkTrapTab){ window.tkTrapTab(npScrim, e); }
        }
        if(npScrim){
          npScrim.addEventListener("pointerdown", function(e){ if(e.target===npScrim) closeNewProject(false); });
          if(npClose) npClose.addEventListener("click", function(){ closeNewProject(true); });
          if(npCancel) npCancel.addEventListener("click", function(){ closeNewProject(true); });
          if(npForm) npForm.addEventListener("htmx:afterRequest", function(e){
            if(e.detail.successful){ if(window.tkSnackbar) window.tkSnackbar("Project added"); npForm.reset(); closeNewProject(false); }
          });
        }
        stack.addEventListener("click", function(ev){
          var edit = ev.target.closest("[data-client-edit]");
          if(edit){ openClientDialog(edit.getAttribute("data-client-edit")); return; }
          if(ev.target.closest("#new-project-open")) openNewProject();
        });
      })();</script>`, "manage");
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
      `<div class="ui-settings-form-2col">` +
      textField({ id: "bp-business_name", label: "Business name", name: "business_name", value: name }) +
      textField({ id: "bp-business_email", label: "Email", name: "business_email", type: "email", value: email }) +
      textField({ id: "bp-business_address", label: "Address", name: "business_address", value: address }) +
      selectField({ id: "bp-terms", label: "Payment terms", name: "business_payment_terms", options, value: terms, className: "terms-select" }) +
      `</div>` +
      `<p class="terms-desc ui-settings-note">${esc(termsDescription(termsKey(null, terms)))}</p>` +
      `<div class="ui-settings-actions">${button({ label: "Save", type: "submit", variant: "primary", icon: "save" })}</div>` +
      `</form>`;
    return settingsSection({ level: 2, id: "biz-profile", title: "Business profile", hint: "Shown in the From block on zinvoices; the payment terms print on the zinvoice too.", bodyHtml: body });
  }

  /* #908: daily hours target — the pacing bars on the timer page (Today)
     and calendar (week = five days at this rate), plus the calendar's
     short-day tint, all follow this instead of the old 8h constant. Stored
     in meta; no migration. */
  function dailyTargetControl(): string {
    const hours = dayTargetSecs(db) / 3600;
    return `<div class="settings-pref-control" id="daily-target">` +
      `<form method="post" action="/daily-target" id="daily-target-form" class="settings-inline-form" hx-post="/daily-target" hx-target="#daily-target" hx-swap="outerHTML">` +
      `<div class="ui-input-wrap settings-hours"><input class="ui-input" type="number" id="dt-hours" name="day_target_hours" value="${esc(String(hours))}" min="1" max="24" step="0.5" inputmode="decimal" aria-label="Daily hours target"><span class="ui-affix ui-affix-suffix">hr</span></div>` +
      button({ label: "Save", type: "submit", variant: "primary", size: "sm" }) +
      `</form></div>`;
  }

  function dailyTargetSection(): string {
    return settingsSection({ level: 2, id: "daily-target", title: "Daily hours target", hint: "Drives the pacing bars on the timer and calendar pages — the week target is five days at this rate.", bodyHtml: dailyTargetControl() });
  }

  /* #884: theme section — a row of color dots that re-theme the app's
     accent. Each dot posts its key; the response re-renders this section
     and live-swaps the <style id="theme-style"> override via OOB, so the
     page behind the modal changes instantly. Pumpkin is the default. */
  function themeDotsHtml(): string {
    const current = themeKey(getMeta(db, "theme"));
    const dots = THEMES.map((t) => {
      const selected = t.key === current;
      return `<button type="button" class="ui-theme-dot${selected ? " selected" : ""}"
          style="--dot:${t.primary}" hx-post="/settings/theme" hx-vals='{"theme":"${t.key}"}'
          hx-target="#theme-section" hx-swap="outerHTML"
          aria-label="${t.name} theme" aria-pressed="${selected}">${selected ? icon("check") : ""}</button>`;
    }).join("");
    return `<div class="ui-theme-dots" id="theme-section" role="group" aria-label="Accent theme">${dots}</div>`;
  }

  function themeSectionHtml(): string {
    return settingsSection({ level: 2, id: "theme-section", title: "Theme", hint: "Pumpkin is the default. Pick any accent.", bodyHtml: themeDotsHtml() });
  }

  /* Daily target and accent color are app preferences, not separate
     destinations. One card with two rows keeps the settings page to five
     cards instead of seven scattered ones. */
  function preferencesSection(): string {
    return settingsSection({
      level: 2, id: "preferences", title: "Preferences",
      hint: "Defaults for the timer and calendar.",
      bodyHtml:
        `<div class="settings-pref-row">` +
        `<div class="settings-pref-text"><div class="settings-pref-title">Daily hours target</div><div class="settings-pref-hint">Drives the pacing bars on the timer and calendar; the week target is five days at this rate.</div></div>` +
        dailyTargetControl() +
        `</div>` +
        `<div class="settings-pref-row">` +
        `<div class="settings-pref-text"><div class="settings-pref-title">Accent color</div><div class="settings-pref-hint">Pumpkin is the default. Changes your app only; Zinvoices keep your brand.</div></div>` +
        `<div class="settings-pref-control">${themeDotsHtml()}</div>` +
        `</div>`,
    });
  }

  /* #693: full-page fallback for direct (non-htmx) visits to /settings.
     The modal fragment alone renders unstyled without the app layout. */
  function settingsPage(settingsBody: string): string {
    return layout("Settings", `
      <div data-enter="2">
      ${appHeader({ title: "Settings", sub: "Changes save per section — the button tells you it saved." })}
      ${settingsBody}
      </div>`, "settings");
  }

  return { managePage, clientSelection, clientDialogBody, clientDialogProjects, manageListsOob, bizProfileSection, dailyTargetSection, dailyTargetControl, preferencesSection, clientSettingsForm, settingsPage, themeSectionHtml, themeDotsHtml };
}
