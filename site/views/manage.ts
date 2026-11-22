/** Manage views: one stacked page in the suite mock's composition — the
 *  add-client form at the top, the client table, and the projects card.
 *  Editing a client opens a dialog holding its settings form, its
 *  projects, and its delete action. */

import type { Database } from "bun:sqlite";
import { clientColor, durationSeconds, esc, fmtDur, PAYMENT_TERMS, round2, schemeColor, termsDescription, termsKey } from "../lib/format.ts";
import type { PaymentTermsKey } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import { THEMES, themeKey } from "../lib/theme.ts"; /* #884 */
import { getMeta } from "../db.ts";
import { settingsSection } from "../ui/settings-section.ts";
import { selectField, textAreaField, textField } from "../ui/field.ts";
import { button } from "../ui/button.ts";
import { card } from "../ui/card.ts";
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
  /* #1344: the shared terms-aware overdue rule (lib/revenue.ts). Optional so
     view-only callers fall back to "sent and past its due date". */
  isOverdue?: (row: { status: string; due_date: string | null; client_payment_terms?: string | null }) => boolean;
}

type ProjectHours = { name: string; secs: number };
type OpenZinvoice = { number: string; status: string; due: string | null; total: number; overdue: boolean };
export type ClientInsight = { monthSecs: number; projects: ProjectHours[]; last: string | null; outstanding: number; overdue: boolean; open: OpenZinvoice[] };

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

  /* #1344: what a client row surfaces — hours this month (per project),
     last tracked, and money on sent Zinvoices. Month and "today" follow the
     server's local clock, like the rest of the manage page. */
  function clientInsights(now: Date = new Date()): { byClient: Map<number, ClientInsight>; noClientSecs: number } {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const since = new Date(monthStart - 2 * 86_400_000).toISOString().slice(0, 10);
    const { clients, byClient: projectsByClient } = manageData();
    const known = new Set(clients.map(c => c.id));
    const byClient = new Map<number, ClientInsight>();
    for (const c of clients) {
      const projects = (projectsByClient.get(c.id) || []).map(p => ({ name: String(p.name), secs: 0 }));
      byClient.set(c.id, { monthSecs: 0, projects, last: null, outstanding: 0, overdue: false, open: [] });
    }
    let noClientSecs = 0;
    const entries = db.query(
      `SELECT e.start_time, e.end_time, p.name AS project_name, p.client_id AS client_id
       FROM time_entries e LEFT JOIN projects p ON p.id = e.project_id
       WHERE e.start_time >= ?`).all(since) as any[];
    for (const e of entries) {
      if (new Date(e.start_time).getTime() < monthStart) continue;
      const secs = durationSeconds(e.start_time, e.end_time);
      const ins = e.client_id != null && known.has(e.client_id) ? byClient.get(e.client_id) : undefined;
      if (!ins) { noClientSecs += secs; continue; }
      ins.monthSecs += secs;
      const proj = ins.projects.find(p => p.name === e.project_name);
      if (proj) proj.secs += secs;
    }
    const lasts = db.query(
      `SELECT p.client_id AS client_id, MAX(e.start_time) AS last
       FROM time_entries e JOIN projects p ON p.id = e.project_id
       WHERE p.client_id IS NOT NULL GROUP BY p.client_id`).all() as any[];
    for (const r of lasts) { const ins = byClient.get(r.client_id); if (ins) ins.last = r.last; }
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const overdueRule = deps.isOverdue ?? ((r: { status: string; due_date: string | null }) => r.status === "sent" && !!r.due_date && r.due_date < today);
    const invoices = db.query(
      `SELECT i.number, i.status, i.due_date, i.tax_rate, i.client_id, c.payment_terms AS client_payment_terms,
              (SELECT COALESCE(SUM(amount), 0) FROM invoice_items WHERE invoice_id = i.id) AS subtotal
       FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.status IN ('sent', 'draft') ORDER BY i.due_date`).all() as any[];
    for (const r of invoices) {
      const ins = byClient.get(r.client_id);
      if (!ins) continue;
      const total = round2(Number(r.subtotal) * (1 + (Number(r.tax_rate) || 0) / 100));
      const overdue = r.status === "sent" && overdueRule(r);
      ins.open.push({ number: String(r.number), status: r.status, due: r.due_date, total, overdue });
      if (r.status === "sent") { ins.outstanding = round2(ins.outstanding + total); if (overdue) ins.overdue = true; }
    }
    for (const ins of byClient.values()) ins.projects.sort((a, b) => b.secs - a.secs || a.name.localeCompare(b.name));
    return { byClient, noClientSecs };
  }

  /* Today / Yesterday / N days, weeks or months ago — the "last tracked"
     column. Day math on local calendar dates, not 24h windows. */
  function lastTrackedLabel(iso: string | null, now: Date = new Date()): { text: string; quiet: boolean } {
    if (!iso) return { text: "—", quiet: false };
    const d = new Date(iso);
    const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const days = Math.max(0, Math.round((day(now) - day(d)) / 86_400_000));
    const text = days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 14 ? `${days} days ago`
      : days < 60 ? `${Math.round(days / 7)} weeks ago` : `${Math.round(days / 30)} months ago`;
    return { text, quiet: days >= 30 };
  }

  const moneyCell = (n: number): string =>
    "$" + n.toLocaleString("en-US", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 });

  function addClientCard(): string {
    return card({
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

  function clientTableCard(now: Date = new Date()): string {
    const { clients } = manageData();
    const unbilled = unbilledMoneyByClient();
    const { byClient, noClientSecs } = clientInsights(now);
    const maxSecs = Math.max(1, ...[...byClient.values()].map(i => i.monthSecs));
    const shades = [100, 70, 45, 30];
    const rows = clients.map(c => {
      const ins = byClient.get(c.id)!;
      const color = schemeColor(c.color) || "var(--color-primary)";
      const active = ins.projects.filter(p => p.secs > 0);
      const segs = [...active.slice(0, 3), ...(active.length > 3 ? [{ name: "Other projects", secs: active.slice(3).reduce((a, p) => a + p.secs, 0) }] : [])];
      const bar = ins.monthSecs > 0
        ? `<span class="mg-bar" aria-hidden="true"><span class="mg-bar-fill" style="width:${round2(ins.monthSecs / maxSecs * 100)}%">` +
          segs.map((p, i) => `<i style="flex:${p.secs};background:color-mix(in srgb, ${esc(color)} ${shades[i]}%, transparent)"></i>`).join("") +
          `</span></span>`
        : `<span class="mg-bar" aria-hidden="true"></span>`;
      const last = lastTrackedLabel(ins.last, now);
      const terms = PAYMENT_TERMS[termsKey(c.payment_terms, globalTerms()) as PaymentTermsKey]?.label ?? "";
      const meta = [c.rate ? `$${c.rate}/hr` : "", terms, `${ins.projects.length} project${ins.projects.length === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
      const idle = ins.projects.length - active.length;
      const projLines = active.slice(0, 4).map((p, i) =>
          `<div class="mg-card-row"><span><i class="mg-card-dot" style="background:color-mix(in srgb, ${esc(color)} ${shades[Math.min(i, 3)]}%, transparent)"></i>${esc(p.name)}</span><span>${fmtDur(p.secs)}</span></div>`).join("") +
        (active.length > 4 ? `<div class="mg-card-row is-muted"><span>${active.length - 4} more active</span><span></span></div>` : "") +
        (idle ? `<div class="mg-card-row is-muted"><span>${active.length ? `${idle} more project${idle === 1 ? "" : "s"}` : "No time this month"}</span><span>0h</span></div>` : "");
      const zinvoices = ins.open.map(z => {
        const when = z.status === "draft" ? "draft" : z.overdue ? "overdue" : z.due ? `due ${shortDate(z.due)}` : "sent";
        return `<div class="mg-card-row${z.overdue ? " is-error" : z.status === "draft" ? " is-muted" : ""}"><span>${esc(z.number)} · ${when}</span><span>${moneyCell(z.total)}</span></div>`;
      }).join("");
      const hoverCard = `<div class="mg-card" aria-hidden="true"><div class="mg-card-title">${esc(c.name)}</div><div class="mg-card-meta">${esc(meta)}</div>` +
        projLines + (zinvoices ? `<div class="mg-card-sep"></div>${zinvoices}` : "") +
        `<div class="mg-card-hint">Click to open</div></div>`;
      const outstanding = ins.outstanding > 0
        ? `${ins.overdue ? `<span class="ui-tag ui-tag-error mg-overdue">Overdue</span>` : ""}${moneyCell(ins.outstanding)}`
        : `<span class="mg-muted">—</span>`;
      const unbilledAmt = unbilled.get(c.id) || 0;
      return `<tr class="mg-row" tabindex="0" data-client-edit="${c.id}" aria-haspopup="dialog" aria-label="${esc(`Edit client ${c.name}`)}">
        <td><span class="manage-client-name"><span class="ui-row-lead-dot" style="background:${esc(color)}" aria-hidden="true"></span>${esc(c.name)}</span>${hoverCard}</td>
        <td class="col-month"><span class="mg-hours"><span class="${ins.monthSecs ? "" : "mg-muted"}">${ins.monthSecs ? fmtDur(ins.monthSecs) : "0h"}</span>${bar}</span></td>
        <td class="num">${unbilledAmt ? moneyCell(unbilledAmt) : `<span class="mg-muted">—</span>`}</td>
        <td class="num">${outstanding}</td>
        <td class="col-last${last.quiet ? " is-quiet" : ""}">${esc(last.text)}</td>
        <td class="mg-chev" aria-hidden="true">${icon("chevron_right")}</td>
      </tr>`;
    }).join("");
    const empty = clients.length ? "" : `<tr><td colspan="6" class="mg-muted">No clients yet. Add one above.</td></tr>`;
    return card({
      id: "client-table-card",
      className: "manage-table-card",
      content: `<table class="ui-table mg-table"><thead><tr><th>Client</th><th class="col-month">This month</th><th class="num">Unbilled</th><th class="num">Outstanding</th><th class="col-last">Last tracked</th><th><span class="ui-sr-only">Open</span></th></tr></thead><tbody>${rows}${empty}</tbody></table>` +
        `<p class="mg-foot"><span>No client · ${noClientSecs ? fmtDur(noClientSecs) : "0h"} this month</span>` +
        button({ label: "View projects", size: "sm", variant: "ghost", attrs: `data-client-edit="none" aria-haspopup="dialog" aria-label="View projects with no client"` }) + `</p>`,
    });
  }

  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const shortDate = (ymd: string): string => { const [, m, d] = ymd.split("-").map(Number); return m && d ? `${MONTHS[m - 1]} ${d}` : ymd; };

  function manageListsOob(): string {
    return clientTableCard().replace(`id="client-table-card"`, `id="client-table-card" hx-swap-oob="true"`)
      + `<p class="ui-app-sub" id="mg-sub" hx-swap-oob="true">${esc(countsSub())}</p>`;
  }

  const projectRow = (p: any) => clientRow({
    name: p.name,
    actions: `<form method="post" action="/projects/${p.id}/delete" class="inline" hx-post="/projects/${p.id}/delete" hx-target="#client-dialog-projects" hx-swap="outerHTML">${iconButton({ icon: "delete", label: `Delete project ${p.name}`, tip: "Delete project", danger: true, type: "submit", attrs: `data-confirm="Delete project? Entries keep their history." data-confirm-label="Delete project"` })}</form>`,
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
    /* Projects lead: they're what people open a client for most. The
       contact form follows under its own Details heading. */
    return clientDialogProjects(sel) + `<h3 class="ui-block-title cd-details-title">Details</h3>` + clientSettingsForm(c) + `
      <form method="post" action="/clients/${c.id}/delete" class="detail-form manage-delete-client">
        ${button({ label: "Delete client", variant: "ghost", danger: true, type: "submit", attrs: 'data-confirm="Delete this client? Its projects move to No client." data-confirm-label="Delete client"' })}
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
      `<div class="ui-settings-actions">${button({ label: "Cancel", type: "button", variant: "ghost", id: "client-settings-cancel" })}${button({ label: "Save client", type: "submit", variant: "primary" })}</div>` +
      `</form>`;
  }

  function clientDialog(): string {
    return `<div class="cal-scrim ui-scrim" id="client-settings-scrim" hidden>
      <div class="settings-dialog ui-dialog" role="dialog" aria-modal="true" aria-labelledby="client-settings-title">
        <div class="settings-dialog-head">
          <div>
            <h2 class="ui-dialog-title" id="client-settings-title">Client</h2>
            <p class="ui-settings-note" id="client-settings-sub" hidden>Projects, rate, terms, color, and contact details.</p>
          </div>
          ${iconButton({ icon: "close", label: "Close client dialog", id: "client-settings-close", tip: null })}
        </div>
        <div id="client-settings-body"><p class="muted">Loading…</p></div>
      </div>
    </div>`;
  }

  function managePage(): string {
    return layout("Manage", `
      ${appHeader({ title: "Manage", sub: countsSub(), subId: "mg-sub" })}
      <div class="manage-stack" data-enter="2">
        ${addClientCard()}
        ${clientTableCard()}
      </div>
      ${clientDialog()}
      <script>(function(){
        var stack = document.querySelector(".manage-stack");
        if (!stack) return;
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
            if(e.detail.target===dlgBody && (cfg.verb||"").toLowerCase()==="get" && /\\/clients\\/[^/]+\\/dialog$/.test(pi.requestPath||cfg.path||""))
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
          if(e.detail.xhr && e.detail.xhr.status===422 && (cfg.verb||"").toLowerCase()==="post" && /\\/clients\\/\\d+\\/settings$/.test(p)){
            e.detail.shouldSwap = true;
            e.detail.isError = false;
          }
        });
        document.body.addEventListener("htmx:afterRequest", function(e){
          var cfg=e.detail.requestConfig||{};
          var pi=e.detail.pathInfo||{};
          var m=(pi.requestPath||"").match(/\\/clients\\/(\\d+)\\/settings$/);
          if(m && e.detail.successful && (cfg.verb||"").toLowerCase()==="post"){
            if(window.tkSnackbar) window.tkSnackbar("Client settings saved");
            closeClientDialog(false);
          }
        });
        /* #1344: client rows are focusable; Enter or Space opens them like a button. */
        document.addEventListener("keydown", function(ev){
          if(ev.key !== "Enter" && ev.key !== " ") return;
          var row = ev.target && ev.target.closest ? ev.target.closest("tr[data-client-edit]") : null;
          if(!row || ev.target !== row) return;
          ev.preventDefault();
          openClientDialog(row.getAttribute("data-client-edit"));
        });
        /* Delegate on the document: the table can be swapped by htmx
           without losing the handler, and the dialog works even if htmx
           finished loading after this inline script ran. */
        document.addEventListener("click", function(ev){
          var edit = ev.target.closest("[data-client-edit]");
          if(edit) openClientDialog(edit.getAttribute("data-client-edit"));
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
    const payInstructions = getMeta(db, "business_payment_instructions");
    const options = (Object.entries(PAYMENT_TERMS) as [PaymentTermsKey, { label: string; description: string }][])
      .map(([k, v]) => ({ value: k, label: v.label, desc: v.description }));
    const body =
      `<form method="post" action="/business-profile" id="biz-profile-form" class="ui-settings-form" hx-post="/business-profile" hx-target="#biz-profile" hx-swap="outerHTML">` +
      `<div class="ui-settings-form-2col">` +
      textField({ id: "bp-business_name", label: "Business name", name: "business_name", value: name, placeholder: "Your studio name" }) +
      textField({ id: "bp-business_email", label: "Email", name: "business_email", type: "email", value: email, placeholder: "billing@you.example" }) +
      textAreaField({ id: "bp-business_address", label: "Address", name: "business_address", value: address, rows: 3, placeholder: "123 Main St\nSuite 200\nSpringfield, IL 62701" }) +
      `<div class="ui-settings-field">` +
      selectField({ id: "bp-terms", label: "Payment terms", name: "business_payment_terms", options, value: terms, className: "terms-select" }) +
      `<p class="terms-desc ui-settings-note">${esc(termsDescription(termsKey(null, terms)))}</p>` +
      `</div>` +
      `</div>` +
      textAreaField({ id: "bp-payment_instructions", label: "Payment instructions", name: "business_payment_instructions", value: payInstructions, rows: 3, placeholder: "Bank transfer to …\nOr mail a check to …" }) +
      `<p class="ui-settings-note">Shown as How to pay on the public Zinvoice when there is no card payment link.</p>` +
      `<div class="ui-settings-actions">${button({ label: "Save profile", type: "submit", icon: "save" })}</div>` +
      `</form>`;
    return settingsSection({ level: 2, id: "biz-profile", title: "Business profile", hint: "Shown in the From block on Zinvoices; the payment terms print on the Zinvoice too.", bodyHtml: body });
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
      button({ label: "Save target", type: "submit", icon: "save" }) +
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
        `<div class="settings-pref-list">` +
        `<div class="settings-pref-row">` +
        `<div class="settings-pref-text"><div class="settings-pref-title">Daily hours target</div><div class="settings-pref-hint">Drives the pacing bars on the timer and calendar; the week target is five days at this rate.</div></div>` +
        dailyTargetControl() +
        `</div>` +
        `<div class="settings-pref-row">` +
        `<div class="settings-pref-text"><div class="settings-pref-title">Accent color</div><div class="settings-pref-hint">Pumpkin is the default. Changes your app only; Zinvoices keep your brand.</div></div>` +
        `<div class="settings-pref-control">${themeDotsHtml()}</div>` +
        `</div>` +
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

  return { managePage, clientTableCard, clientSelection, clientDialogBody, clientDialogProjects, manageListsOob, bizProfileSection, dailyTargetSection, dailyTargetControl, preferencesSection, clientSettingsForm, settingsPage, themeSectionHtml, themeDotsHtml };
}
