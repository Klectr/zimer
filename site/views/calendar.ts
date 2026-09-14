/** Calendar views: week grid, day columns, entry blocks, supporting pane,
 *  the entry dialog + inline calendar script, and the edit-entry page.
 *  Week data arrives through injected queries and helpers; every existing
 *  call site keeps working unchanged. */

import type { Database, Statement } from "bun:sqlite";
import { addDays, durationSeconds, esc, fmtDur, mondayOf, todayStr } from "../lib/format.ts";
import { icon } from "../lib/icons.ts";
import type { Entry } from "../lib/types.ts";

export interface CalendarViewDeps {
  db: Database;
  qOne: Statement;
  qRange: Statement;
  entrySelect: string;
  layout: (title: string, body: string, active?: "timer" | "calendar" | "manage" | "invoices", fixed?: boolean) => string;
  projectOptions: (selected?: number | null) => string;
  weekTargetBar: (weekTotalSecs: number) => string;
  calHourPx: number;
}

export function createCalendarViews(deps: CalendarViewDeps) {
  const { db, qOne, qRange, entrySelect: ENTRY_SELECT, layout, projectOptions, weekTargetBar, calHourPx } = deps;

  /** Inner HTML of the #week section (everything that changes when entries do).
      Served full-page via weekGrid() and in-place via GET /partial/week (#65). */
  function weekInner(weekStr?: string): string {
    const mon = mondayOf(weekStr);
    const prev = addDays(mon, -7), next = addDays(mon, 7);
    const isThisWeek = mon === mondayOf();
    const today = todayStr();

    // Fetch the whole week in one query, then bucket entries by local day.
    const [wFrom, wTo] = [mon + "T00:00:00", addDays(mon, 7) + "T00:00:00"];
    const rows = db.query(
      `${ENTRY_SELECT} WHERE e.start_time >= ? AND e.start_time < ? ORDER BY e.start_time`).all(wFrom, wTo) as Entry[];
    const byDay = new Map<string, Entry[]>();
    for (const e of rows) {
      const d = new Date(e.start_time);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key)!.push(e);
    }

    /* Per-client week totals from the same query (no extra DB hit), sorted
       descending. Entries without a client roll into a "No client" bucket. */
    const byClient = new Map<string, { name: string; color: string | null; secs: number }>();
    for (const e of rows) {
      const key = e.client_name ?? "__none";
      const cur = byClient.get(key) ?? { name: e.client_name ?? "No client", color: e.client_color, secs: 0 };
      cur.secs += durationSeconds(e.start_time, e.end_time);
      byClient.set(key, cur);
    }
    const clientRows = [...byClient.values()].sort((a, b) => b.secs - a.secs);
    const uninvoiced = rows.reduce(
      (s, e) => s + (e.invoice_id == null ? durationSeconds(e.start_time, e.end_time) : 0), 0);
    const nudgeChip = uninvoiced > 0 ? `
      <a class="nudge-chip" href="/invoices/new">
        <span class="md-label-large">${fmtDur(uninvoiced)} not yet invoiced</span>
        <span class="md-label-large nudge-go">→ New invoice</span>
      </a>` : "";
    const clientStrip = clientRows.length === 0 ? "" : `
      <div class="week-clients">
        ${clientRows.map(c => `
          <span class="week-client">
            <span class="week-client-dot"${c.color ? ` style="background:${esc(c.color)}"` : ""}></span>
            <span class="md-label-medium">${esc(c.name)}</span>
            <span class="md-label-medium muted">${fmtDur(c.secs)}</span>
          </span>`).join("")}
      </div>`;

    const toMin = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
    const toHM = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

    let weekTotal = 0;
    let weekBillable = 0;
    const days: string[] = [];
    for (let i = 0; i < 7; i++) {
      const day = addDays(mon, i);
      const [y, m, d] = day.split("-").map(Number);
      const dt = new Date(y, m - 1, d);
      const wd = dt.toLocaleDateString([], { weekday: "short" });
      const entries = byDay.get(day) ?? [];
      const total = entries.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
      /* Billable = entry has a project (hence a client); non-billable = no project. */
      const billable = entries.reduce(
        (a, e) => a + (e.project_id != null ? durationSeconds(e.start_time, e.end_time) : 0), 0);
      weekTotal += total;
      weekBillable += billable;
      const isToday = day === today;
      /* Subtle tint for past days under 8h; never tint today or future days. */
      const pastShort = day < today && total < 8 * 3600;

      // Entries render full-width; an entry involved in an overlap gets a top
      // drop shadow so it reads as elevated above the entry beneath it.
      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const sortedBlocks = entries
        .map((e) => {
          const a = toMin(e.start_time);
          const b = Math.max(e.end_time ? toMin(e.end_time) : nowMin, a + 15);
          return { e, a, b };
        })
        .sort((x, y) => x.a - y.a);
      const entryHtml = sortedBlocks
        .map(({ e, a, b }) => {
        const top = (a / 60) * calHourPx;
        const h = Math.max(((b - a) / 60) * calHourPx, 26);
        const color = e.client_color || "#9aa0a6"; // no-client: neutral gray, distinct from client colors
        const running = !e.end_time;
        const overlap = sortedBlocks.some((o) => o.e !== e && o.a < b && o.b > a);
        const desc = e.description ? esc(e.description) : "<em>No description</em>";
        const dur = fmtDur(durationSeconds(e.start_time, e.end_time));
        return `<div class="cal-entry${running ? " running" : ""}${overlap ? " overlap" : ""}"
            style="top:${top.toFixed(1)}px;height:${h.toFixed(1)}px;--c:${esc(color)}"
            data-id="${e.id}" data-desc="${esc(e.description)}" data-project-id="${e.project_id ?? ""}"
            data-date="${day}" data-start="${toHM(a)}" data-end="${running ? "" : toHM(Math.min(b, 1439))}"
            tabindex="0" role="button" aria-label="${desc}, ${dur}">
          <div class="cal-entry-desc">${e.project_name ? `<strong>${esc(e.project_name)}</strong> · ` : ""}${desc}</div>
          <div class="cal-entry-dur">${dur}</div>
          ${running ? "" : `<div class="cal-resize top" data-resize="start" title="Drag to change start" aria-hidden="true"></div><div class="cal-resize" data-resize="end" title="Drag to resize" aria-hidden="true"></div>`}
        </div>`;
      }).join("");
      const nowLine = isToday
        ? `<div class="cal-now" id="cal-now" style="top:${((nowMin / 60) * calHourPx).toFixed(1)}px"></div>` : "";
      // #69: day stats live in an M3 plain tooltip on the header (hover / focus / long-press),
      // not in the layout — the header stays two lines so time slots sit higher.
      const tip = total > 0 ? `${fmtDur(total)} total · ${fmtDur(billable)} billable` : "";
      const headAttrs = tip
        ? ` tabindex="0" data-tip="${tip}" aria-label="${esc(wd)} ${d}: ${tip}"`
        : "";
      days.push(`<div class="cal-day${isToday ? " today" : ""}${pastShort ? " paced-short" : ""}" style="animation-delay:${i * 40}ms">
        <div class="cal-day-head"${headAttrs}>
          <div class="md-label-large muted">${esc(wd)}</div>
          <div class="cal-day-num${isToday ? " today" : ""}">${d}</div>
        </div>
        <div class="cal-day-col" data-date="${day}">${entryHtml}${nowLine}</div>
      </div>`);
    }

    // Week-over-week delta vs the immediately preceding week.
    const prevRows = qRange.all(addDays(mon, -7) + "T00:00:00", mon + "T00:00:00") as Entry[];
    const prevTotal = prevRows.reduce((a, e) => a + durationSeconds(e.start_time, e.end_time), 0);
    const deltaHtml = (() => {
      if (prevTotal <= 0) return `<span class="muted">—</span>`;
      const pct = Math.round(((weekTotal - prevTotal) / prevTotal) * 100);
      const arrow = pct > 0 ? "↑" : pct < 0 ? "↓" : "→";
      return `<span class="muted">${arrow} ${Math.abs(pct)}% vs prev week</span>`;
    })();

    const hourLabels = Array.from({ length: 24 }, (_, h) => {
      const ampm = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
      return `<span class="cal-hour-label" style="top:${(h * calHourPx - 8).toFixed(0)}px">${ampm}</span>`;
    }).join("");

    const weekLabel = new Date(mon + "T12:00:00").toLocaleDateString([], { month: "short", day: "numeric" });

    return `
    <div class="cal-pane-layout">
      <div class="week-nav" data-enter="2">
        <h2 class="md-headline-small">${isThisWeek ? "This week" : `Week of ${esc(weekLabel)}`}</h2>
        <div class="week-nav-actions">
          ${isThisWeek ? "" : `<a class="md-text-button" href="/calendar" hx-get="/partial/week" hx-target="#week" hx-swap="innerHTML" hx-push-url="/calendar">Today</a>`}
          <a class="md-icon-button" href="/calendar?week=${prev}" hx-get="/partial/week?week=${prev}" hx-target="#week" hx-swap="innerHTML" hx-push-url="/calendar?week=${prev}" title="Previous week" aria-label="Previous week">${icon("chevron_left")}</a>
          <a class="md-icon-button" href="/calendar?week=${next}" hx-get="/partial/week?week=${next}" hx-target="#week" hx-swap="innerHTML" hx-push-url="/calendar?week=${next}" title="Next week" aria-label="Next week">${icon("chevron_right")}</a>
        </div>
      </div>
      <aside class="cal-supporting" data-enter="3" aria-label="Week summary">
        <div class="cal-summary">
          <div class="md-headline-small">${fmtDur(weekTotal)}</div>
          <div class="md-label-medium muted">${fmtDur(weekBillable)} billable · ${deltaHtml}</div>
        </div>
        ${nudgeChip}
        ${weekTargetBar(weekTotal)}
        ${clientStrip}
        <p class="muted tiny cal-hint">Drag on the grid to log time. Click an entry to edit it.</p>
      </aside>
      <div class="cal-scroll" data-enter="3">
        <div class="cal-grid" id="cal-body" style="--cal-hour:${calHourPx}px">
          <div class="cal-gutter-col">
            <div class="cal-gutter-spacer"></div>
            <div class="cal-gutter cal-hours">${hourLabels}</div>
          </div>
          ${days.join("")}
        </div>
      </div>
    </div>
    `;
  }

  /** Full calendar week section: the #week wrapper plus the persistent entry
      dialog and calendar script. The dialog and script live outside #week so an
      in-place week refresh (#65) never destroys dialog bindings or duplicates
      listeners. */
  function weekGrid(weekStr?: string): string {
    return `<div id="week">${weekInner(weekStr)}</div>
      <div class="cal-scrim" id="cal-scrim" hidden>
        <div class="cal-dialog" role="dialog" aria-modal="true" aria-labelledby="cal-dialog-title">
          <h2 class="md-headline-small" id="cal-dialog-title">New entry</h2>
          <p class="muted md-body-medium" id="cal-dialog-date"></p>
          <div class="md-text-field">
            <input type="text" id="cal-desc" placeholder=" " autocomplete="off">
            <label for="cal-desc">Description</label>
          </div>
          <div class="md-text-field filled">
            <select id="cal-project" aria-label="Project"><option value="">No project</option>${projectOptions()}</select>
            <label for="cal-project">Project</label>
          </div>
          <div class="cal-time-row">
            <div class="md-text-field filled">
              <input type="time" id="cal-start" required>
              <label for="cal-start">Start</label>
            </div>
            <div class="md-text-field filled">
              <input type="time" id="cal-end" required>
              <label for="cal-end">End</label>
            </div>
            <span class="md-title-small" id="cal-dur"></span>
          </div>
          <p class="error tiny" id="cal-error" hidden></p>
          <div class="cal-dialog-actions">
            <button class="md-text-button danger" id="cal-delete" hidden>Delete</button>
            <span class="cal-spacer"></span>
            <button class="md-text-button" id="cal-cancel">Cancel</button>
            <button class="md-filled-button" id="cal-save">Save</button>
          </div>
        </div>
      </div>
      <script>${calScript()}</script>
  `;
  }

  /** Inline script: drag-to-create, click-to-edit, now-line ticking. No htmx needed. */
  function calScript(): string {
    return `(function(){
    var HOUR=${calHourPx};
    var scrim=document.getElementById('cal-scrim');
    var dialog=scrim.querySelector('.cal-dialog');
    /* M3 dialog motion: .open drives scrim fade + dialog scale/fade.
       Generation counter keeps rapid open/close/open sequences sane. */
    var scrimGen=0;
    function showScrim(){
      scrimGen++;
      scrim.hidden=false;
      void scrim.offsetWidth; /* commit unhide so the transition runs */
      scrim.classList.add('open');
    }
    function hideScrim(){
      var gen=++scrimGen;
      scrim.classList.remove('open');
      var done=false;
      var finish=function(){ if(done||gen!==scrimGen) return; done=true; scrim.hidden=true; };
      var onEnd=function(e){
        if(e.target===dialog&&e.propertyName==='transform'){
          dialog.removeEventListener('transitionend',onEnd); finish();
        }
      };
      dialog.addEventListener('transitionend',onEnd);
      setTimeout(finish,400);
    }
    var title=document.getElementById('cal-dialog-title');
    var dateLine=document.getElementById('cal-dialog-date');
    var desc=document.getElementById('cal-desc');
    var project=document.getElementById('cal-project');
    var startI=document.getElementById('cal-start');
    var endI=document.getElementById('cal-end');
    var dur=document.getElementById('cal-dur');
    var err=document.getElementById('cal-error');
    var delBtn=document.getElementById('cal-delete');
    var mode='create', editId=null, dayStr='';
    /* grid owns the scroll: land near the current time when today is in view */
    var scroller=document.querySelector('.cal-scroll'), nowEl=document.getElementById('cal-now');
    if(scroller&&nowEl){var r=nowEl.getBoundingClientRect(),s=scroller.getBoundingClientRect();
      scroller.scrollTop=Math.max(0,r.top-s.top+scroller.scrollTop-scroller.clientHeight*0.35);}
    function toMin(t){var p=t.split(':');return (+p[0])*60+(+p[1]);}
    function toHM(m){m=((m%1440)+1440)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
    function fmtD(mins){var h=Math.floor(mins/60),m=mins%60;return (h?h+'h ':'')+m+'m';}
    function updDur(){var s=toMin(startI.value||'00:00'),e=toMin(endI.value||'00:00');
      dur.textContent=e>s?fmtD(e-s):'';}
    startI.addEventListener('input',updDur); endI.addEventListener('input',updDur);
    function openCreate(date,a,b){
      mode='create'; editId=null; dayStr=date;
      title.textContent='New entry'; delBtn.hidden=true; err.hidden=true;
      var d=new Date(date+'T12:00:00');
      dateLine.textContent=d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
      desc.value=''; project.value='';
      startI.value=toHM(a); endI.value=toHM(b); updDur();
      showScrim(); desc.focus();
    }
    function openEdit(el){
      mode='edit'; editId=el.dataset.id; dayStr=el.dataset.date;
      title.textContent='Edit entry'; delBtn.hidden=false; err.hidden=true;
      var d=new Date(dayStr+'T12:00:00');
      dateLine.textContent=d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
      desc.value=el.dataset.desc||''; project.value=el.dataset.projectId||'';
      startI.value=el.dataset.start||'09:00'; endI.value=el.dataset.end||toHM(toMin(startI.value)+60); updDur();
      showScrim(); desc.focus();
    }
    function close(){ hideScrim(); }
    document.getElementById('cal-cancel').addEventListener('click',close);
    scrim.addEventListener('click',function(e){ if(e.target===scrim) close(); });
    document.addEventListener('keydown',function(e){ if(e.key==='Escape'&&!scrim.hidden) close(); });
    function fail(msg){ err.textContent=msg; err.hidden=false; }
    /* In-place week refresh (#65): re-render the #week section without a full
       page reload. Load-entrance animations are suppressed for the swap
       (no-enter), the grid scroll position is preserved, and the new/updated
       entry gets a one-time highlight. */
    /* Week-nav buttons (#77) swap #week via HTMX: suppress the load-entrance
       animations for the swap, same as refreshWeek above. Unlike refreshWeek,
       grid scroll is intentionally NOT preserved — a fresh week starts at the
       top, matching full-load behavior. */
    document.body.addEventListener('htmx:beforeSwap',function(e){
      if(e.detail && e.detail.target && e.detail.target.id==='week')
        document.getElementById('week').classList.add('no-enter');
    });
    function refreshWeek(highlightId){
      var weekEl=document.getElementById('week');
      var scroller=weekEl.querySelector('.cal-scroll');
      var st=scroller?scroller.scrollTop:0;
      var wk='';
      try{ wk=new URLSearchParams(location.search).get('week')||''; }catch(e){}
      fetch('/partial/week?week='+encodeURIComponent(wk)).then(function(r){
        if(!r.ok) throw new Error('refresh failed');
        return r.text();
      }).then(function(html){
        weekEl.classList.add('no-enter');
        weekEl.innerHTML=html;
        var sc2=weekEl.querySelector('.cal-scroll');
        if(sc2) sc2.scrollTop=st;
        if(highlightId){
          var el=weekEl.querySelector('.cal-entry[data-id="'+highlightId+'"]');
          if(el) el.classList.add('cal-flash');
        }
      }).catch(function(){ location.reload(); /* last resort: never leave stale data */ });
    }
    document.getElementById('cal-save').addEventListener('click',function(){
      var s=toMin(startI.value),e=toMin(endI.value);
      if(!(e>s)) return fail('End time must be after start time.');
      var fd=new URLSearchParams();
      fd.set('description',desc.value);
      fd.set('project_id',project.value);
      fd.set('start_time',dayStr+'T'+startI.value);
      fd.set('end_time',dayStr+'T'+endI.value);
      var url=mode==='create'?'/entries':'/entries/'+editId;
      var hid=mode==='edit'?editId:null;
      fetch(url,{method:'POST',body:fd}).then(function(r){
        if(!r.ok) throw new Error('save failed');
        return r.json().catch(function(){ return {}; });
      }).then(function(data){
        if(mode==='create'&&data&&data.id) hid=data.id;
        close();
        refreshWeek(hid);
      }).catch(function(ex){ fail(ex.message); });
    });
    delBtn.addEventListener('click',function(){
      if(!confirm('Delete this entry?')) return;
      fetch('/entries/'+editId,{method:'DELETE'}).then(function(){ close(); refreshWeek(null); });
    });
    // drag-to-create on empty grid space
    var drag=null;
    function minsAt(ev,col){
      var r=col.getBoundingClientRect();
      var y=Math.max(0,Math.min(r.height,ev.clientY-r.top));
      return Math.floor(y/HOUR*(60/15))*(15);
    }
    function place(el,a,b){
      el.style.top=(a/60*HOUR)+'px';
      el.style.height=Math.max((b-a)/60*HOUR,10)+'px';
    }
    /* Milestone 17: drag the bottom edge of a finished entry to resize it.
       Delegated on document so it survives in-place #week refreshes. */
    var resize=null;
    document.addEventListener('pointerdown',function(e){
      var handle=e.target.closest('[data-resize]');
      if(handle){
        var entryEl=handle.closest('.cal-entry');
        var col=entryEl.closest('.cal-day-col');
        var edge=handle.getAttribute('data-resize'); /* "start" or "end" */
        e.preventDefault(); e.stopPropagation();
        resize={entry:entryEl,col:col,edge:edge,
          start:toMin(entryEl.dataset.start||'00:00'),
          end:toMin(entryEl.dataset.end||'00:00'),
          date:entryEl.dataset.date, id:entryEl.dataset.id,
          desc:entryEl.dataset.desc||'', projectId:entryEl.dataset.projectId||''};
        entryEl.classList.add('resizing');
        function rmove(ev){
          var m=minsAt(ev,col);
          if(resize.edge==='start'){
            var a=Math.min(resize.end-15,Math.max(m,0));
            resize.newStart=a;
            place(entryEl,a,resize.end);
          } else {
            var b=Math.max(resize.start+15,Math.min(m,1439));
            resize.newEnd=b;
            place(entryEl,resize.start,b);
          }
        }
        function rup(){
          window.removeEventListener('pointermove',rmove);
          window.removeEventListener('pointerup',rup);
          entryEl.classList.remove('resizing');
          var r=resize; resize=null;
          var ns=r.newStart!=null?r.newStart:r.start, ne=r.newEnd!=null?r.newEnd:r.end;
          if(ns===r.start&&ne===r.end) return; /* no change */
          var fd=new URLSearchParams();
          fd.set('description',r.desc);
          fd.set('project_id',r.projectId);
          fd.set('start_time',r.date+'T'+toHM(ns));
          fd.set('end_time',r.date+'T'+toHM(ne));
          fetch('/entries/'+r.id,{method:'POST',body:fd}).then(function(resp){
            if(!resp.ok) throw new Error('resize failed');
            refreshWeek(r.id);
          }).catch(function(){ refreshWeek(null); /* revert on failure */ });
        }
        window.addEventListener('pointermove',rmove);
        window.addEventListener('pointerup',rup);
        return;
      }
      var entryEl=e.target.closest('.cal-entry');
      if(entryEl){ openEdit(entryEl); return; }
      var col=e.target.closest('.cal-day-col');
      if(!col) return;
      e.preventDefault();
      var a=minsAt(e,col);
      var pv=document.createElement('div');
      pv.className='cal-drag-preview';
      col.appendChild(pv); place(pv,a,a+15);
      drag={col:col,a:a,pv:pv,moved:false};
      function move(ev){ drag.moved=true; var m=minsAt(ev,col);
        var x=Math.min(drag.a,m),y=Math.max(drag.a,m); place(pv,x,Math.max(y,x+15)); }
      function up(ev){
        window.removeEventListener('pointermove',move);
        window.removeEventListener('pointerup',up);
        var m=drag.moved?minsAt(ev,col):drag.a+60;
        var x=Math.min(drag.a,m),y=Math.max(drag.a,m);
        if(y-x<15) y=x+15;
        drag.pv.remove(); var d={col:drag.col,x:x,y:y}; drag=null;
        openCreate(d.col.dataset.date,d.x,Math.min(d.y,1439));
      }
      window.addEventListener('pointermove',move);
      window.addEventListener('pointerup',up);
    });
    /* #69: long-press (450ms) reveals the day-head stats tooltip on touch, where hover doesn't exist. */
    var tipTimer=null,tipEl=null;
    document.addEventListener('pointerdown',function(e){
      var head=e.target.closest('.cal-day-head[data-tip]');
      if(!head) return;
      tipEl=head;
      tipTimer=setTimeout(function(){ head.classList.add('tip-show'); },450);
    });
    ['pointerup','pointercancel'].forEach(function(t){
      document.addEventListener(t,function(){
        if(tipTimer){ clearTimeout(tipTimer); tipTimer=null; }
        if(tipEl){ tipEl.classList.remove('tip-show'); tipEl=null; }
      },{passive:true});
    });
    // keep the now-line pinned to the current time
    function tickNow(){
      var el=document.getElementById('cal-now'); if(!el) return;
      var n=new Date();
      el.style.top=((n.getHours()*60+n.getMinutes())/60*HOUR)+'px';
    }
    setInterval(tickNow,60000);
  })();`;
  }

  function calendarPage(week?: string): string {
    return layout("Calendar", weekGrid(week), "calendar", true);
  }

  function editPage(id: number): string | null {
    const e = qOne.get(id) as Entry | null;
    if (!e) return null;
    const toLocal = (iso: string) => {
      const d = new Date(iso);
      const p = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    };
    return layout("Edit entry", `
      <h2 class="md-headline-small" data-enter="2">Edit entry</h2>
      <form method="post" action="/entries/${e.id}" class="form">
        <div class="md-text-field">
          <input type="text" name="description" value="${esc(e.description)}" placeholder=" ">
          <label>Description</label>
        </div>
        <div class="md-text-field filled">
          <select name="project_id"><option value="">No project</option>${projectOptions(e.project_id)}</select>
          <label>Project</label>
        </div>
        <div class="md-text-field filled">
          <input type="datetime-local" name="start_time" value="${toLocal(e.start_time)}" required placeholder=" ">
          <label>Start</label>
        </div>
        <div class="md-text-field filled">
          <input type="datetime-local" name="end_time" value="${e.end_time ? toLocal(e.end_time) : ""}" placeholder=" ">
          <label>End (blank = still running)</label>
        </div>
        <div class="row">
          <button class="md-filled-button" type="submit">Save</button>
          <a class="md-text-button" href="/calendar">Cancel</a>
        </div>
      </form>`);
  }

  return { weekInner, weekGrid, calendarPage, editPage };
}
