/** Page sections for the new-Zinvoice wizard — single-use view helpers, not Zandbox
 *  components (Zandbox is for small reusable pieces; see AGENTS.md). */
import { esc } from "../lib/format";
import { icon } from "../lib/icons";
import { button } from "../ui/button";
import { card } from "../ui/card";
import { steps } from "../ui/steps";
import { checkboxField } from "../ui/choice";
import { selectField, textField, type SelectOption } from "../ui/field";
import { formSection, invoiceSummary, type SummaryLine } from "../ui/zinvoice-form";

/** The new-Zinvoice wizard (suite mock, #1121): step 1 Client & period,
 *  step 2 editable unbilled-time lines, and the live preview card with the
 *  create actions. Presentational — the view computes the preview and the
 *  defaults; the wizard script keeps the preview in step with edits. */

/** Shared header row for Zinvoice line tables (#526: scope="col"). */
export function lineItemsHeadRow(): string {
  return `<tr><th scope="col">Date</th><th scope="col">Description</th>` +
    `<th scope="col" class="num">Hours</th><th scope="col" class="num">Rate</th>` +
    `<th scope="col" class="num">Amount</th></tr>`;
}

/** An info line (icon + sentence) inside a wizard step. */
export function formInfo(text: string): string {
  return `<div class="form-info">${icon("info")}<p>${esc(text)}</p></div>`;
}

export interface WizardStep1Options {
  clientOptions: SelectOption[];
  clientId: string;
  from: string;
  to: string;
  rate: string;
}

export function wizardStep1(o: WizardStep1Options): string {
  return formSection({ step: 1, title: "Client & period", bodyHtml: `
        <div class="inv-step1-grid">
          <div class="inv-step1-client">
            ${selectField({ id: "inv-client", label: "Client", name: "client_id", required: true, value: o.clientId, options: o.clientOptions })}
          </div>
          <div class="inv-step1-range" id="inv-range">
            ${textField({ id: "inv-from", label: "From", name: "from", type: "date", value: o.from, required: true })}
            ${textField({ id: "inv-to", label: "To", name: "to", type: "date", value: o.to, required: true })}
          </div>
          <div class="inv-step1-rate">
            ${textField({ id: "inv-rate", label: "Hourly rate", name: "rate", type: "number", value: o.rate, min: "0", step: "0.01", prefix: "$", suffix: "/hr" })}
          </div>
        </div>
        <p class="muted tiny">Only finished, unbilled entries on this client's projects are included. Rates come from the client default; edit the rate to override this Zinvoice.</p>` });
}

export interface WizardLine {
  description: string;
  hours: number | string;
  rate: number | string;
  /** Formatted amount. */
  amount: string;
  dateFrom?: string;
  dateTo?: string;
  /** Formatted range shown beside the include checkbox. */
  dateLabel?: string;
  entryIds: (number | string)[];
}

/** One editable line. Field names (g{i}_desc …) are what the create
 *  handler reads; hidden inputs stay inside their td (#536). */
function wizardLineRow(l: WizardLine, i: number): string {
  return `
        <tr>
          <td>${checkboxField({ id: `inc-${i}`, label: `Include ${l.description}`, bare: true, checked: true })}<span class="inv-cell-dates">${esc(l.dateLabel ?? "")}</span><input type="hidden" name="g${i}_date_from" value="${esc(l.dateFrom ?? "")}"><input type="hidden" name="g${i}_date_to" value="${esc(l.dateTo ?? "")}"></td>
          <td><input type="text" name="g${i}_desc" value="${esc(l.description)}" class="cell-input" aria-label="Item description"></td>
          <td><input type="number" name="g${i}_hours" value="${esc(String(l.hours))}" min="0" step="0.01" class="cell-input num" aria-label="Hours"></td>
          <td><input type="number" name="g${i}_rate" value="${esc(String(l.rate))}" min="0" step="0.01" class="cell-input num" aria-label="Rate"></td>
          <td class="num"><span class="inv-row-amount">${esc(l.amount)}</span><input type="hidden" name="g${i}_ids" value="${esc(l.entryIds.join(","))}"></td>
        </tr>`;
}

export interface WizardLinesOptions {
  /** Omit before a client is picked: an empty table with the manual-line action. */
  lines?: WizardLine[];
  /** e.g. "No unbilled time …" (#668: never a dead end). */
  emptyMsg?: string;
  /** Minutes entries round up to, when rounding is on. */
  roundingMinutes?: number | null;
}

export function wizardLinesSection(o: WizardLinesOptions): string {
  const picked = o.lines !== undefined;
  const lines = o.lines ?? [];
  const intro = picked
    ? (o.emptyMsg ? formInfo(o.emptyMsg) : "") +
      (o.roundingMinutes ? formInfo(`Entry durations are rounded up to ${o.roundingMinutes}-minute increments.`) : "")
    : `<p class="ui-note">Pick a client to load unbilled time, or add a manual line.</p>`;
  const foot = picked ? `
        <p class="muted tiny">Amounts recalculate on save. Entries are marked billed when the Zinvoice is created.</p>` : "";
  return formSection({ step: 2, title: "Unbilled time — uncheck to exclude", bodyHtml: `
        ${intro}
        <input type="hidden" name="groups" value="${lines.length}">
        <div class="table-wrap"><table class="ui-table inv-lines-edit">
          <thead>${lineItemsHeadRow()}</thead>
          <tbody>${lines.map(wizardLineRow).join("")}</tbody>
        </table></div>
        <div class="row">${button({ label: "Add manual line", icon: "add", variant: "ghost", attrs: "data-add-item" })}</div>${foot}` });
}

export interface WizardPreviewOptions {
  number: string;
  chipHtml: string;
  lines: SummaryLine[];
  total: string;
  dueDate: string;
  issueDate: string;
  taxRate: string;
  notes: string;
  internalNotes: string;
  /** No lines yet: both create actions stay disabled. */
  disabled: boolean;
}

/** The live preview: checked lines, total, due date, more details, and the
 *  create actions. Its fields round-trip through the preview POST. */
export function wizardPreviewCard(o: WizardPreviewOptions): string {
  return invoiceSummary({
    title: `Live preview — ${o.number}`,
    chipHtml: o.chipHtml,
    lines: o.lines,
    totalLabel: "Total due",
    total: o.total,
    bodyHtml: `
        ${textField({ id: "inv-due", label: "Due date", name: "due_date", type: "date", value: o.dueDate })}
        <details class="inv-more">
          <summary>More details</summary>
          ${textField({ id: "inv-number", label: "Zinvoice number", name: "number", value: o.number, required: true })}
          ${textField({ id: "inv-issue", label: "Issue date", name: "issue_date", type: "date", value: o.issueDate, required: true })}
          ${textField({ id: "inv-tax", label: "Tax", name: "tax_rate", type: "number", value: o.taxRate, min: "0", step: "0.01", suffix: "%" })}
          ${textField({ id: "inv-notes", label: "Notes (optional)", name: "notes", value: o.notes })}
          ${textField({ id: "inv-internal", label: "Internal notes (only you see this)", name: "internal_notes", value: o.internalNotes })}
        </details>
        <div class="inv-summary-actions">
          ${button({ label: "Save draft", type: "submit", variant: "primary", block: true, disabled: o.disabled })}
          ${button({ label: "Send Zinvoice", type: "submit", block: true, disabled: o.disabled, attrs: 'name="intent" value="send"' })}
        </div>
        <p class="inv-send-note">Sending creates the public pay link.</p>`,
  });
}

export interface WizardLayoutOptions {
  stepItems: string[];
  current: number;
  step1Html: string;
  /** Swapped in place by the preview POST (#invoice-step2). */
  step2Html: string;
  /** Swapped out of band (#inv-preview). */
  previewHtml: string;
}

/** The page shell: steps, then one form holding the lines card and the
 *  preview rail. The form is the grid's size container, so the layout
 *  stacks by its own width (the sidebar eats into the viewport). */
export function wizardLayout(o: WizardLayoutOptions): string {
  return `<div id="inv-steps">${steps({ items: o.stepItems, current: o.current })}</div>
      <form method="post" action="/invoices" class="form inv-new-form" id="inv-create-form">
        <div class="inv-new-grid">
          <div>${card({ className: "form-card", content: `${o.step1Html}<div id="invoice-step2">${o.step2Html}</div>` })}</div>
          <div id="inv-preview">${o.previewHtml}</div>
        </div>
      </form>`;
}

/** The wizard's client-side behavior: prefill rate and due date from the
 *  client (#293), load the "rest" range (#328) and the step-2 preview,
 *  recompute amounts and the live total on every edit, include/exclude
 *  rows, and add manual lines (#668). Delegated so HTMX swaps keep it. */
export const ZINVOICE_WIZARD_SCRIPT = `<script>(function(){
        var sel=document.getElementById('inv-client'), rate=document.getElementById('inv-rate'),
            form=document.getElementById('inv-create-form'),
            rangeEl=document.getElementById('inv-range'), rangeTouched=false;
        if(!sel||!form) return;
        var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        function addDaysStr(ymd,n){var p=ymd.split('-').map(Number);var d=new Date(p[0],p[1]-1,p[2]+n);
          return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
        function shortYmdStr(ymd){var p=String(ymd||'').split('-').map(Number);
          return p.length===3&&p[0] ? MONTHS[p[1]-1]+' '+p[2] : '';}
        function moneyFmt(n){return '$'+n.toFixed(2).replace(/\\B(?=(\\d{3})+(?!\\d))/g,',');}
        function fmtH(h){return (Math.round(h*100)/100).toFixed(2)+' h';}
        function dueEl(){return document.getElementById('inv-due');}
        function issueEl(){return document.getElementById('inv-issue');}
        function syncActions(){
          var wrap=document.getElementById('inv-preview');
          if(!wrap||!form) return;
          var has=form.querySelector('#invoice-step2 tbody tr')!==null;
          wrap.querySelectorAll('.inv-summary-actions button').forEach(function(b){ b.disabled=!has; });
        }
        function deriveDue(){
          var opt=sel.options[sel.selectedIndex], due=dueEl(), issue=issueEl();
          if(opt&&opt.dataset.termsDays&&issue&&issue.value&&due) due.value=addDaysStr(issue.value,parseInt(opt.dataset.termsDays,10));
        }
        function updateSub(){
          var sub=document.getElementById('inv-new-sub');
          if(!sub) return;
          var opt=sel.options[sel.selectedIndex];
          var to=document.getElementById('inv-to');
          sub.textContent=sel.value&&opt ? opt.text+' · unbilled through '+shortYmdStr(to?to.value:'') : '';
        }
        function loadPreview(){
          if(!window.htmx||!sel.value) return;
          window.htmx.ajax('POST','/invoices/preview',{source:'#inv-create-form',target:'#invoice-step2',swap:'innerHTML'});
        }
        function recompute(){
          var wrap=document.getElementById('inv-preview');
          if(!wrap||!form) return;
          var taxEl=document.getElementById('inv-tax');
          var tax=taxEl?parseFloat(taxEl.value)||0:0;
          var lines=[], subtotal=0;
          form.querySelectorAll('#invoice-step2 tbody tr').forEach(function(tr){
            var inc=tr.querySelector('input[type="checkbox"]');
            var desc=tr.querySelector('input[name$="_desc"]');
            var hrs=tr.querySelector('input[name$="_hours"]');
            var rateEl=tr.querySelector('input[name$="_rate"]');
            if(!desc||!hrs||!rateEl) return;
            var h=parseFloat(hrs.value)||0, r=parseFloat(rateEl.value)||0;
            var amt=Math.round(h*r*100)/100;
            var amtEl=tr.querySelector('.inv-row-amount');
            if(amtEl) amtEl.textContent=moneyFmt(amt);
            if(inc&&!inc.checked) return;
            subtotal+=amt;
            if(h>0||desc.value) lines.push({label:(desc.value||'Item')+' — '+fmtH(h),amount:amt});
          });
          var total=Math.round(subtotal*(1+tax/100)*100)/100;
          var totalEl=wrap.querySelector('.ui-summary-total .num');
          wrap.querySelectorAll('.ui-summary-line').forEach(function(el){el.remove();});
          var totalRow=wrap.querySelector('.ui-summary-total');
          if(totalRow){
            lines.forEach(function(l){
              var div=document.createElement('div');
              div.className='ui-summary-line';
              var a=document.createElement('span'); a.textContent=l.label;
              var b=document.createElement('span'); b.className='num'; b.textContent=moneyFmt(l.amount);
              div.appendChild(a); div.appendChild(b);
              totalRow.parentNode.insertBefore(div,totalRow);
            });
          }
          if(totalEl) totalEl.textContent=moneyFmt(total);
          syncActions();
        }
        if(rangeEl) rangeEl.addEventListener('change',function(){rangeTouched=true; if(sel.value) loadPreview();});
        sel.addEventListener('change',function(){
          var opt=sel.options[sel.selectedIndex];
          if(opt&&opt.dataset.rate&&!rate.value) rate.value=opt.dataset.rate;
          deriveDue();
          updateSub();
          if(!window.htmx) return;
          if(sel.value&&!rangeTouched){
            window.htmx.ajax('GET','/partial/invoice-rest?client_id='+encodeURIComponent(sel.value),{target:'#inv-range',swap:'innerHTML'})
              .then(function(){ loadPreview(); });
          } else if(sel.value) loadPreview();
        });
        document.addEventListener('change',function(ev){
          var t=ev.target;
          if(t&&t.id==='inv-issue') deriveDue();
          if(t&&t.type==='checkbox'&&t.closest&&t.closest('#invoice-step2')){
            var tr=t.closest('tr');
            if(tr) tr.querySelectorAll('input').forEach(function(inp){ if(inp!==t) inp.disabled=!t.checked; });
            recompute();
          }
        });
        form.addEventListener('input',function(ev){
          var t=ev.target;
          if(!t||!t.closest) return;
          if(t.closest('#invoice-step2')||t.id==='inv-tax') recompute();
        });
        document.addEventListener('click',function(ev){
          var btn=ev.target.closest('[data-add-item]');
          if(!btn) return;
          var f=btn.closest('form');
          if(!f) return;
          var groups=f.querySelector('input[name="groups"]');
          var body=f.querySelector('#invoice-step2 tbody');
          if(!groups||!body) return;
          var i=parseInt(groups.value,10)||0;
          var tr=document.createElement('tr');
          tr.innerHTML=
            '<td><label class="ui-choice" for="inc-'+i+'"><input class="ui-checkbox" type="checkbox" id="inc-'+i+'" checked aria-label="Include line item"></label>'+
            '<input type="hidden" name="g'+i+'_date_from" value="">'+
            '<input type="hidden" name="g'+i+'_date_to" value=""></td>'+
            '<td><input type="text" name="g'+i+'_desc" class="cell-input" aria-label="Item description"></td>'+
            '<td><input type="number" name="g'+i+'_hours" min="0" step="0.01" class="cell-input num" aria-label="Hours"></td>'+
            '<td><input type="number" name="g'+i+'_rate" min="0" step="0.01" class="cell-input num" aria-label="Rate"></td>'+
            '<td class="num"><span class="inv-row-amount">$0.00</span>'+
            '<input type="hidden" name="g'+i+'_ids" value=""></td>';
          body.appendChild(tr);
          groups.value=String(i+1);
          syncActions();
          var desc=tr.querySelector('input[name="g'+i+'_desc"]');
          if(desc) desc.focus();
        });
      })();</script>`;
