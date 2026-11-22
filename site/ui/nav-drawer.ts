import { esc } from "../lib/format";
import { icon } from "../lib/icons";

type IconName = Parameters<typeof icon>[0];

/** #949: the navigation drawer on compact screens — labelled rows (icon-only
 *  buttons are undiscoverable on touch). Opened by #appbar-menu-btn; Escape,
 *  a scrim tap, a swipe toward the edge, or any row closes it. Render it as a
 *  direct body child (#355 stacking context). */
export type NavDrawerRow =
  | { icon: IconName; label: string; href: string }
  | { icon: IconName; label: string; postAction: string };

export function navDrawerRow(r: NavDrawerRow): string {
  const inner = `${icon(r.icon)}<span>${esc(r.label)}</span>`;
  if ("href" in r) return `<a class="nav-drawer-row" href="${esc(r.href)}">${inner}</a>`;
  return `<form method="POST" action="${esc(r.postAction)}" class="nav-drawer-logout">
        <button class="nav-drawer-row" type="submit">${inner}</button>
      </form>`;
}

export function navDrawer(o: { rows: NavDrawerRow[]; extraHtml?: string }): string {
  return `<div class="nav-drawer-scrim" id="nav-drawer-scrim" hidden>
    <nav class="nav-drawer" role="dialog" aria-modal="true" aria-label="Menu">
      <div class="nav-drawer-head">Menu</div>
      ${o.rows.map(navDrawerRow).join("\n      ")}
      ${o.extraHtml ?? ""}
    </nav>
  </div>
  <script>(function(){
    var scrim=document.getElementById('nav-drawer-scrim');
    var btn=document.getElementById('appbar-menu-btn');
    if(!scrim||!btn) return;
    var open_=false;
    var drawerGen=0;
    function open(){
      open_=true; drawerGen++;
      scrim.hidden=false; void scrim.offsetWidth; scrim.classList.add('open');
      document.addEventListener('keydown',onKey,true);
      var first=scrim.querySelector('.nav-drawer-row'); if(first) first.focus();
    }
    function close(refocus){
      if(!open_) return; open_=false; drawerGen++;
      scrim.classList.remove('open');
      document.removeEventListener('keydown',onKey,true);
      var gen=drawerGen, done=false, finish=function(){ if(done||gen!==drawerGen) return; done=true; scrim.hidden=true; };
      var onEnd=function(e){ if(e.target===scrim&&e.propertyName==='opacity'){ scrim.removeEventListener('transitionend',onEnd); finish(); } };
      scrim.addEventListener('transitionend',onEnd); setTimeout(finish,300);
      if(refocus) btn.focus();
    }
    function onKey(e){ if(e.key==='Escape'){ e.preventDefault(); close(true); }
      else if(e.key==='Tab'&&window.tkTrapTab){ window.tkTrapTab(scrim,e); } }
    scrim.addEventListener('pointerdown',function(e){ if(e.target===scrim) close(false); });
    btn.addEventListener('click',open);
    var panel=scrim.querySelector('.nav-drawer');
    var dragX=null, dragDx=0;
    panel.addEventListener('pointerdown',function(e){
      dragX=e.clientX; dragDx=0; panel.style.transition='none';
    });
    window.addEventListener('pointermove',function(e){
      if(dragX===null) return;
      dragDx=Math.min(0,e.clientX-dragX);
      panel.style.transform='translateX('+dragDx+'px)';
    });
    window.addEventListener('pointerup',function(){
      if(dragX===null) return;
      var past=dragDx<-(panel.offsetWidth/3);
      dragX=null; panel.style.transition=''; panel.style.transform='';
      if(past) close(false);
    });
    scrim.querySelectorAll('.nav-drawer-row').forEach(function(row){
      row.addEventListener('click',function(){ close(false); });
    });
  })();</script>`;
}
