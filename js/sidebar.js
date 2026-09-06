'use strict';
/* ---------- the sidebar ----------
   One panel on the left with four views: files, search, tags and the outline. It is collapsed and opened as a
   whole; on a narrow screen it floats over the page instead of pushing it aside, and closes once a note is opened.
   Which view is showing, whether it is open and how wide it is are remembered in settings.side. */
const sideEl=$('side'), sideBg=$('sideBg'), sideTabs=$('sideTabs'), sideToggle=$('sideToggle');
const SIDE_VIEWS=['files','search','tags','outline'];
const narrowMq=matchMedia('(max-width:720px)');
let overlayOpen=false;
const isNarrow=()=>narrowMq.matches;
function sideVisible(){ return isNarrow()?overlayOpen:settings.side.open; }
function sideShowing(v){ return sideVisible()&&settings.side.view===v; }
function renderSide(){
  const vis=sideVisible(), view=settings.side.view;
  sideEl.hidden=!vis; sideBg.hidden=!(vis&&isNarrow());
  document.body.classList.toggle('side-open',vis);
  sideToggle.setAttribute('aria-pressed',vis);
  for(const b of sideTabs.querySelectorAll('.stab')) b.setAttribute('aria-selected',b.dataset.view===view);
  for(const v of SIDE_VIEWS) $(v).hidden=!(vis&&v===view);
  if(!vis) return;
  if(view==='files') renderTree();
  else if(view==='search') renderSearch();
  else if(view==='tags') renderTags();
  else if(view==='outline'&&A()) A().renderOutline();
}
function setSideOpen(on){ if(isNarrow()) overlayOpen=on; else settings.side.open=on; renderSide(); scheduleDraft(); }
/* shows a view, opening the sidebar if need be; with toggle, a view that is already showing collapses the sidebar instead */
function showView(v,toggle){
  if(!SIDE_VIEWS.includes(v)) return;
  if(toggle&&sideShowing(v)){ setSideOpen(false); if(A()) A().focusEditor(); return; }
  settings.side.view=v; setSideOpen(true);
  if(v==='search'){ searchInput.focus(); searchInput.select(); }
  else if(v==='files'){ if(A()&&A().D()&&A().D().wsPath) selectRow(A().D().wsPath); treeEl.focus({preventScroll:true}); }
}
function toggleSide(){ setSideOpen(!sideVisible()); if(!sideVisible()&&A()) A().focusEditor(); }
/* on a narrow screen the floating sidebar goes away once it has done its job */
function sideAutoClose(){ if(isNarrow()&&overlayOpen){ overlayOpen=false; renderSide(); } }
function setSideWidth(w){ settings.side.w=Math.max(160,Math.min(600,Math.round(w))); document.documentElement.style.setProperty('--sw',settings.side.w+'px'); }
sideTabs.addEventListener('click',e=>{ const b=e.target.closest('.stab'); if(b) showView(b.dataset.view); });
sideToggle.addEventListener('click',toggleSide);
sideBg.addEventListener('mousedown',e=>{ e.preventDefault(); setSideOpen(false); });
sideEl.addEventListener('keydown',e=>{ if(e.key==='Escape'&&isNarrow()&&!e.target.closest('input')){ e.preventDefault(); setSideOpen(false); if(A()) A().focusEditor(); } });
narrowMq.addEventListener('change',()=>{ overlayOpen=false; renderSide(); });
$('fResize').addEventListener('mousedown',e=>{
  e.preventDefault(); const x0=e.clientX, w0=settings.side.w;
  const mv=ev=>setSideWidth(w0+ev.clientX-x0), up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); scheduleDraft(); };
  addEventListener('mousemove',mv); addEventListener('mouseup',up);
});
