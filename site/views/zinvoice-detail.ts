/** Page sections for the single-Zinvoice page — single-use view helpers, not Zandbox
 *  components (Zandbox is for small reusable pieces; see AGENTS.md). */
import { esc } from "../lib/format";
import { icon } from "../lib/icons";
import { card } from "../ui/card";
import { linkButton } from "../ui/button";
import { progressBar } from "../ui/progress";

/** The single-Zinvoice page (suite mock): a head with back link, title and
 *  actions; a main column (lines, time breakdown, internal notes, proof of
 *  payment) and a rail (status, public link). Presentational — the view
 *  decides state and builds the action forms (they carry htmx endpoints). */

export interface ZinvoiceDetailHeadOptions {
  backHref: string;
  title: string;
  sub: string;
  /** The actions row: paid chip, copy, PDF, Mark sent/paid, delete. */
  actionsHtml: string;
}

export function zinvoiceDetailHead(o: ZinvoiceDetailHeadOptions): string {
  return `<div class="invoice-detail-head no-print">
        ${linkButton({ label: "Zinvoices", href: o.backHref, icon: "arrow_left", variant: "ghost", className: "detail-back" })}
      </div>
      <div class="detail-title no-print">
        <h2 class="ui-section-title">${esc(o.title)}</h2>
        <p class="ui-app-sub">${esc(o.sub)}</p>
      </div>
      <div class="page-head no-print">
        <div class="row">${o.actionsHtml}</div>
      </div>`;
}

export interface ZinvoiceStatusCardOptions {
  chipHtml: string;
  /** e.g. the "Paid via Stripe" chip. */
  extraChipHtml?: string;
  /** 0 draft · 50 sent · 100 paid */
  progress: number;
  tone?: "neutral" | "warning" | "error";
  line: string;
  /** Newest first; only events the data records. */
  activity?: string[];
}

export function zinvoiceStatusCard(o: ZinvoiceStatusCardOptions): string {
  const activity = o.activity && o.activity.length
    ? `<div class="inv-activity">${o.activity.map((a) => `<div class="inv-activity-row">${esc(a)}</div>`).join("")}</div>`
    : "";
  return card({ className: "no-print", content: `
      <div class="ui-card-head"><span class="ui-section-title">Status</span><span class="ui-card-head-end">${o.chipHtml}${o.extraChipHtml ?? ""}</span></div>
      ${progressBar({ value: o.progress, label: "Zinvoice progress", tone: o.tone ?? "neutral" })}
      <p class="inv-status-line">${esc(o.line)}</p>
      ${activity}` });
}

export interface ZinvoiceShareCardOptions {
  /** Whether the client can also pay from the page. */
  canPay: boolean;
  linesHtml: string;
}

export function zinvoiceShareCard(o: ZinvoiceShareCardOptions): string {
  return `
      <section class="ui-card share-lines no-print" aria-label="Public link">
        <div class="ui-card-head"><span class="ui-section-title">Public link</span></div>
        <p class="muted">Anyone with the link can view${o.canPay ? " and pay" : ""} — no login for your client.</p>
        ${o.linesHtml}
      </section>`;
}

/** Copy-to-clipboard for any [data-copy][data-url] inside #invoice-detail.
 *  #621: falls back to execCommand where the Clipboard API is missing (plain
 *  HTTP on a Tailscale IP). Wires once per detail root, so htmx swaps are safe. */
export const ZINVOICE_COPY_SCRIPT = `<script>(function(){
      function copyText(text, done){
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done, function(){ legacyCopy(text, done); });
        } else {
          legacyCopy(text, done);
        }
      }
      function legacyCopy(text, done){
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try { if (document.execCommand("copy")) done(); } catch (e) { /* keep it honest: no fake success */ }
        document.body.removeChild(ta);
      }
      function wire(sec){
        if (sec.dataset.copyWired) return;
        sec.dataset.copyWired = "1";
        sec.addEventListener("click", function(ev){
          var btn = ev.target.closest("[data-copy]");
          if (!btn || !btn.dataset.url) return;
          copyText(btn.dataset.url, function(){
            btn.classList.add("copied");
            setTimeout(function(){ btn.classList.remove("copied"); }, 1200);
          });
        });
      }
      document.querySelectorAll("#invoice-detail").forEach(wire);
    })();</script>`;

/** #302: internal-only notes — app surface only, never printed or shared. */
export function internalNotes(text: string): string {
  return `
      <aside class="internal-notes no-print" aria-label="Internal notes">
        <div class="internal-notes-label">Internal notes</div>
        <p>${esc(text)}</p>
      </aside>`;
}

export interface PaymentProofItem {
  filename: string;
  href: string;
  /** e.g. "84 KB · Nov 3" */
  meta: string;
  /** The delete form, built by the view (it carries the endpoint + confirm). */
  deleteHtml: string;
}

export interface PaymentProofSectionOptions {
  invoiceId: number | string;
  proofs: PaymentProofItem[];
  /** Paid with nothing attached: nudge to add a receipt. */
  nudge?: boolean;
  uploadAction: string;
}

/** #956: proof of payment. The file picker uploads on change and swaps just
 *  this section (no full reload); the listener is a guarded global. */
export function paymentProofSection(o: PaymentProofSectionOptions): string {
  const rows = o.proofs.map((p) => `
      <div class="proof-row">
        <a class="proof-name" href="${esc(p.href)}" target="_blank" rel="noopener">${esc(p.filename)}</a>
        <span class="proof-meta muted">${esc(p.meta)}</span>
        <span class="proof-icons">
          <a class="ui-icon-btn" href="${esc(p.href)}" download="${esc(p.filename)}" data-tip="Download" aria-label="Download proof">${icon("download")}</a>
          ${p.deleteHtml}
        </span>
      </div>`).join("");
  const nudge = o.nudge ? `
      <p class="proof-nudge muted">No proof attached — add the bank receipt or payment confirmation so this payment stays verifiable.</p>` : "";
  const id = esc(String(o.invoiceId));
  return `<section class="payment-proof no-print" id="proof" aria-label="Proof of payment">
      <div class="ui-block-title">${icon("receipt")} Proof of payment</div>
      ${rows}
      ${nudge}
      <form method="post" action="${esc(o.uploadAction)}" enctype="multipart/form-data" class="proof-upload" data-invoice-id="${id}">
        <label class="ui-btn proof-file-label" for="proof-file-${id}">${icon("upload")} Attach proof</label>
        <input id="proof-file-${id}" class="proof-file-input" type="file" name="proof" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf" required>
      </form>
      <p class="proof-hint muted">PNG, JPEG, GIF, WebP or PDF, up to 10 MB. Optional — cash payments have no file.</p>
      <script>(function(){
        /* Upload proof without full page refresh. Guarded global so htmx
           re-renders of the detail pane don't stack listeners. */
        if (window.__proofPickerWired) return;
        window.__proofPickerWired = true;
        document.addEventListener("change", function(ev){
          var t = ev.target;
          if (!t || t.type !== "file" || !t.classList || !t.classList.contains("proof-file-input")) return;
          var form = t.closest("form");
          if (!t.files || !t.files[0] || !form) return;
          var fd = new FormData(form);
          fetch(form.action, { method: "POST", body: fd, headers: { "X-Proof-Upload": "1" } })
            .then(function(res){ if (!res.ok) throw new Error("upload failed"); return res.text(); })
            .then(function(){
              /* Re-fetch the invoice detail and swap just the proof section */
              var invId = form.getAttribute("data-invoice-id");
              return fetch("/invoices?invoice=" + invId, { headers: { "X-Proof-Refresh": "1" } });
            })
            .then(function(res){ return res.text(); })
            .then(function(pageHtml){
              var doc = new DOMParser().parseFromString(pageHtml, "text/html");
              var fresh = doc.getElementById("proof");
              var current = document.getElementById("proof");
              if (fresh && current) current.outerHTML = fresh.outerHTML;
            })
            .catch(function(){ form.submit(); });
        });
      })();</script>
    </section>`;
}
