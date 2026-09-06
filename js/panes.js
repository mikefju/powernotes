'use strict';
/* ---------- panes ----------
   Each pane is its own editor: tabs, document, caret, undo, find, agenda and source view, made by makePane below.
   The active pane is the one that was clicked or typed into last; menus, shortcuts, the outline and the filter bar
   act on it. One note may show in two panes at once, in which case they edit the same lines and follow each other. */
let panes=[], activePane=null, tabDrag=null;
const layout={dir:'row'};
const A=()=>activePane;
function allDocs(){ const s=new Set(); for(const p of panes) for(const d of p.docs) s.add(d); return [...s]; }
function paneOf(d){ if(activePane&&activePane.D()===d) return activePane; return panes.find(p=>p.D()===d)||panes.find(p=>p.docs.includes(d))||null; }
async function findOpen(handle){ for(const d of allDocs()){ if(d.handle&&await sameFile(d.handle,handle)) return d; } return null; }
/* brings a tab to the front, in whichever pane holds it */
function focusDoc(d){
  const order=activePane?[activePane,...panes.filter(p=>p!==activePane)]:panes;
  for(const p of order){ const k=p.docs.indexOf(d); if(k>=0){ setActive(p); p.switchTab(k); p.focusEditor(); return true; } }
  return false;
}
function renderTabsAll(){ for(const p of panes) p.renderTabs(); }
function renderAll(){ for(const p of panes) p.render(); }
function renderBacklinksAll(){ for(const p of panes) p.renderBacklinks(); }
function renderAgendaAll(){ for(const p of panes) if(p.agendaOn()) p.renderAgenda(); }
function flushDoc(d){ const p=paneOf(d); if(p) p.flush(d); }
/* a change made to a doc from outside its pane: dirty, saved, and redrawn wherever it shows */
function touchDoc(d){ d.dirty=true; renderTabsAll(); scheduleDraft(); scheduleAutosave(); for(const p of panes) if(p.D()===d) p.refresh(); }
function setActive(p){
  if(!p||p===activePane) return;
  const prev=activePane;
  if(prev&&panes.includes(prev)){ if(prev.find.open) prev.closeFind(true); prev.root.classList.remove('active'); prev.dismiss(); }
  activePane=p; p.root.classList.add('active');
  p.renderOutline(); p.renderFilterBar(); p.renderTabs(); filesMarkCur(true); scheduleDraft();
}
/* ---------- pane management: split, close, lay out, move tabs ---------- */
function mountTabs(){
  const single=panes.length===1;
  for(const p of panes){ if(single) tabSlot.append(p.tabsEl); else p.tabBar.append(p.tabsEl); }
  document.body.classList.toggle('split',!single);
}
function layoutPanes(){
  panesEl.classList.toggle('col',layout.dir==='col'); panesEl.replaceChildren();
  panes.forEach((p,k)=>{ if(k){ const s=el('div','psplit'); s.dataset.k=k; s.title='Drag to resize'; panesEl.append(s); } p.root.style.flex=(p.size||1)+' 1 0'; panesEl.append(p.root); });
  mountTabs(); for(const p of panes) p.scheduleCrumb();
}
/* a new pane beside (or under) P, showing the note given or P's own note */
function splitPane(P,dir,d){
  if(dir) layout.dir=dir;
  const N=makePane(uid()); panes.splice(panes.indexOf(P)+1,0,N); for(const p of panes) p.size=0;
  N.init([d||P.D()],0); layoutPanes(); setActive(N); N.focusEditor(); scheduleDraft(); return N;
}
/* closes a pane; its tabs move to the neighbour, so nothing is lost */
function closePane(P){
  if(panes.length<2) return; const k=panes.indexOf(P), nb=panes[k-1]||panes[k+1], curDoc=P.D();
  P.destroy(); panes.splice(k,1);
  for(const d of P.docs) nb.attach(d,null,d===curDoc);
  for(const p of panes) p.size=0; layoutPanes();
  if(activePane===P) activePane=null; setActive(activePane||nb); scheduleDraft();
}
function moveDocToPane(d,from,to,at){
  if(from===to||!panes.includes(to)) return;
  from.detach(d); if(!panes.includes(to)) return;
  to.attach(d,at,true); setActive(to); to.focusEditor();
}
panesEl.addEventListener('mousedown',e=>{
  const s=e.target.closest('.psplit'); if(!s) return; e.preventDefault();
  const k=+s.dataset.k, a=panes[k-1], b=panes[k], col=layout.dir==='col', dim=col?'height':'width';
  const ra=a.root.getBoundingClientRect(), rb=b.root.getBoundingClientRect(), total=ra[dim]+rb[dim], x0=col?e.clientY:e.clientX, sum=(a.size||1)+(b.size||1);
  const mv=ev=>{ let fa=(ra[dim]+(col?ev.clientY:ev.clientX)-x0)/total; fa=Math.max(.15,Math.min(.85,fa)); a.size=+(sum*fa).toFixed(3); b.size=+(sum*(1-fa)).toFixed(3); a.root.style.flex=a.size+' 1 0'; b.root.style.flex=b.size+' 1 0'; };
  const up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); scheduleDraft(); for(const p of panes) p.scheduleCrumb(); };
  addEventListener('mousemove',mv); addEventListener('mouseup',up);
});
/* opens the files pane at a note */
function revealInTree(path){ if(!path) return; let p=parentOf(path); while(p){ exp.add(p); p=parentOf(p); } showView('files'); selectRow(path); scheduleDraft(); }
/* a tab that is not in the folder gets a copy there, and the tab switches to the copy */
async function copyIntoVault(d){
  if(!ws.dir||!vx.perm||!vx.root) return; flushDoc(d);
  try{
    const name=await freeName(ws.dir,d.name), text=serializeLines(d.lines), h=await ws.dir.getFileHandle(name,{create:true}), w=await h.createWritable(); await w.write(text); await w.close();
    const f=await h.getFile(); d.handle=h; d.name=name; d.wsPath=name; d.mtime=f.lastModified; d.dirty=false; d.ctime=d.ctime||Date.now();
    idb.set('handles',d.id,h); addRecent(h,name); addNote(vx.root,h,name,f,text,d.ctime); renderTabsAll(); renderBacklinksAll(); scheduleDraft();
  }catch(e){ console.error(e); alert('Could not copy the file: '+e.message); }
}
/* works out where an opened file sits relative to the folder, and picks up what the index knows about it */
async function placeDoc(d){
  if(!ws.dir||!vx.perm||!d.handle||d.wsPath!==undefined) return;
  d.wsPath=await pathIn(ws.dir,d.handle);
  if(d.wsPath){ const e=vx.notes.get(d.wsPath); if(e){ if(d.ctime==null&&e.ctime) d.ctime=e.ctime; if(d.mtime==null) d.mtime=e.mtime; } }
  renderTabsAll();
}
