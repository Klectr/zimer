/** Estimate views: list page, new-estimate wizard, line-item row fragment,
 *  and the printable detail page. */

import type { Database } from "bun:sqlite";
import { addDays, esc, money, todayStr } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";

export interface EstimateViewDeps {
  db: Database;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices" | "estimates", fixed?: boolean) => string;
  clientOptions: (selected?: number | null) => string;
  nextEstimateNumber: () => string;
  statusPill: (status: string) => string;
}

export function createEstimateViews(deps: EstimateViewDeps) {
  const { db, layout, clientOptions, nextEstimateNumber, statusPill } = deps;

  function estimatesPage(): string {
    const rows = db.query(`SELECT e.*, c.name AS client_name,
        (SELECT COALESCE(SUM(amount),0) FROM estimate_items WHERE estimate_id = e.id) AS total
      FROM estimates e LEFT JOIN clients c ON c.id = e.client_id ORDER BY e.id DESC`).all() as any[];
    const list = rows.length ? `<ul class="md-list">${rows.map(r => `<li class="md-list-item">
        <div class="md-list-item-content">
          <div class="md-list-item-headline"><a href="/estimates/${r.id}" class="inv-link">${esc(r.number)}</a> ${statusPill(r.status)}</div>
          <div class="md-list-item-supporting">${r.client_name ? esc(r.client_name) : "<em>No client</em>"} · issued ${esc(r.issue_date)}${r.valid_until ? ` · valid until ${esc(r.valid_until)}` : ""}</div>
        </div>
        <div class="md-list-item-trailing"><span class="dur">${money(r.total)}</span></div>
      </li>`).join("")}</ul>`
      : `<p class="muted">No estimates yet. Quote a client in seconds.</p>`;
    return layout("Estimates", `
      <div class="page-head" data-enter="2">
        <h2 class="md-headline-small">Estimates</h2>
        <a class="md-filled-button" href="/estimates/new">${icon("add")}New estimate</a>
      </div>
      <div class="scroll-region" data-enter="3">${list}</div>`, "estimates", true);
  }

  function estimateItemRow(): string {
    return `<div class="est-item-row">
      <div class="md-text-field filled grow"><input type="text" name="item_desc" placeholder=" " aria-label="Item description"><label>Description</label></div>
      <div class="md-text-field filled" style="max-width:110px"><input type="number" name="item_hours" min="0" step="0.25" placeholder=" " aria-label="Hours"><label>Hours</label></div>
      <div class="md-text-field filled has-prefix" style="max-width:130px"><span class="affix prefix" aria-hidden="true">$</span><input type="number" name="item_rate" min="0" step="0.01" placeholder=" " aria-label="Rate"><label>Rate</label></div>
      <button class="md-icon-button" type="button" title="Remove line" onclick="this.parentElement.remove()">${icon("delete")}</button>
    </div>`;
  }

  function estimateNewPage(): string {
    const t = todayStr();
    return layout("New estimate", `
      <div class="page-head" data-enter="2">
        <h2 class="md-headline-small">New estimate</h2>
        <a class="md-text-button" href="/estimates">Cancel</a>
      </div>
      <div class="scroll-region" data-enter="3">
      <form method="post" action="/estimates" class="form md-card form-card">
        <div class="two-field">
          <div class="md-text-field filled"><select name="client_id" aria-label="Client"><option value="">No client…</option>${clientOptions(null)}</select><label>Client</label></div>
          <div class="md-text-field filled"><input type="text" name="number" value="${nextEstimateNumber()}" required placeholder=" "><label>Estimate number</label></div>
        </div>
        <div class="two-field">
          <div class="md-text-field filled"><input type="date" name="issue_date" value="${t}" required placeholder=" "><label>Issue date</label></div>
          <div class="md-text-field filled"><input type="date" name="valid_until" value="${addDays(t, 30)}" placeholder=" "><label>Valid until</label></div>
        </div>
        <h3 class="md-title-medium">Line items</h3>
        <div id="est-items">${estimateItemRow()}</div>
        <div class="row"><button class="md-text-button" type="button" id="est-add">${icon("add")}Add line</button></div>
        <div class="md-text-field"><input type="text" name="notes" placeholder=" "><label>Notes (optional)</label></div>
        <div class="row end"><button class="md-filled-button" type="submit">${icon("check")}Create estimate</button></div>
      </form>
      </div>
      <script>(function(){
        var tpl = ${JSON.stringify(estimateItemRow())};
        document.getElementById('est-add').addEventListener('click', function(){
          document.getElementById('est-items').insertAdjacentHTML('beforeend', tpl);
        });
      })();</script>`, "estimates", true);
  }

  function estimateDetailPage(e: any): string {
    const items = (e.items as any[]).map(it => `<li class="md-list-item">
        <div class="md-list-item-content"><div class="md-list-item-headline">${esc(it.description)}</div>
        <div class="md-list-item-supporting">${Number(it.hours)}h × ${money(Number(it.rate))}</div></div>
        <div class="md-list-item-trailing"><span class="dur">${money(Number(it.amount))}</span></div>
      </li>`).join("");
    return layout(`Estimate ${esc(e.number)}`, `
      <div class="page-head" data-enter="2">
        <h2 class="md-headline-small">Estimate ${esc(e.number)}</h2>
        <a class="md-text-button" href="/estimates">Back</a>
      </div>
      <div class="scroll-region" data-enter="3">
        <div class="md-card form-card">
          <p class="md-title-medium">${e.client_name ? esc(e.client_name) : "<em>No client</em>"} ${statusPill(e.status)}</p>
          <p class="muted">Issued ${esc(e.issue_date)}${e.valid_until ? ` · valid until ${esc(e.valid_until)}` : ""}</p>
          ${e.notes ? `<p>${esc(e.notes)}</p>` : ""}
          <ul class="md-list">${items}</ul>
          <p class="md-title-large">Total: <strong>${money(e.total)}</strong></p>
          ${e.converted_invoice_id
            ? `<p><a class="md-text-button" href="/invoices/${e.converted_invoice_id}">View converted invoice</a></p>`
            : `<form method="post" action="/estimates/${e.id}/convert" class="inline"><button class="md-filled-button" type="submit">${icon("receipt")}Convert to invoice</button></form>`}
        </div>
      </div>`, "estimates", true);
  }

  return { estimatesPage, estimateItemRow, estimateNewPage, estimateDetailPage };
}
