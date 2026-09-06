'use strict';
/* ---------- command palette and quick switcher ----------
   One box, two modes. As the palette (Ctrl+Shift+P) it lists every menu action, tab, note in the folder and
   heading. As the quick switcher (Ctrl+O) it lists only tabs and notes, newest first, and offers to create the
   note when nothing of that name exists. Enter opens in the current tab, Ctrl+Enter in a new one. */
const pal={open:false,items:[],idx:0,mode:'cmd'};
const cap=s=>s[0].toUpperCase()+s.slice(1);
function palCommands(){
  const out=[];
  const walk=(items,cat)=>{ let sect=''; for(const it of items){ if(it==='-'){ sect=''; continue; } if(it.h){ sect=it.h; continue; } if(it.dis) continue; if(it.sub){ walk(it.sub(),cat+' › '+it.l); continue; } out.push({cat:cat+(sect?' › '+sect:''),label:it.l,sc:it.sc||'',run:it.f}); } };
  for(const name of MENU_ORDER) walk(menus[name](),cap(name));
  out.push(...palNotes());
  for(const h of A().headings()) out.push({cat:'Heading',label:h.body||'(untitled)',sc:'',run:()=>A().revealRow(h.i)});
  return out;
}
/* the open tabs first, then the rest of the folder with the most recently changed notes first */
function palNotes(){
  const out=[];
  A().docs.forEach((d,k)=>out.push({cat:'Tab',label:labelOf(d.name),sc:k<9?'Alt+'+(k+1):'',run:()=>A().switchTab(k),alt:()=>splitPane(A(),'row',d)}));
  for(const p of panes) if(p!==A()) p.docs.forEach(d=>out.push({cat:'Tab · other pane',label:labelOf(d.name),sc:'',run:()=>focusDoc(d)}));
  const rest=[...vx.notes.values()].filter(e=>!openDocAt(e.path)).sort((a,b)=>(b.mtime||0)-(a.mtime||0));
  for(const e of rest) out.push({cat:'Note',label:labelOf(e.name),sc:parentOf(e.path).slice(0,-1),run:()=>openNote(e),alt:()=>openNote(e,'tab')});
  return out;
}
/* substring matches rank first, then in-order character matches */
function fuzzy(q,s){
  if(!q) return {score:0,idx:[]}; const l=s.toLowerCase(), k=l.indexOf(q);
  if(k>=0) return {score:(k===0?300:200)-k,idx:Array.from({length:q.length},(_,t)=>k+t)};
  const idx=[]; let j=0; for(let t=0;t<l.length&&j<q.length;t++) if(l[t]===q[j]){ idx.push(t); j++; }
  return j===q.length?{score:100-idx[idx.length-1],idx}:null;
}
function palRun(){
  const raw=palInput.value.trim(), q=raw.toLowerCase(), scored=[], notes=pal.mode==='notes';
  (notes?palNotes():palCommands()).forEach((c,k)=>{ let f=fuzzy(q,c.label); if(!f&&!notes){ const g=fuzzy(q,c.cat+' '+c.label); if(g) f={score:g.score-150,idx:[]}; } if(f) scored.push({c,f,k}); });
  scored.sort((a,b)=>b.f.score-a.f.score||a.k-b.k);
  pal.items=scored.slice(0,14);
  if(notes&&raw&&!BAD_NAME.test(raw)&&!scored.some(x=>x.c.label.toLowerCase()===q)) pal.items.push({c:{cat:'New',label:'Create "'+raw+'"',sc:'',run:()=>openWiki(raw),alt:()=>openWiki(raw,'tab')},f:{score:0,idx:[]},k:1e9});
  pal.idx=0; palRender();
}
function palRender(){
  if(!pal.items.length){ const d=el('div','none'); d.textContent=pal.mode==='notes'?'No note of that name':'No matching command'; palList.replaceChildren(d); return; }
  palList.replaceChildren(...pal.items.map((it,k)=>{
    const d=el('div','pi'+(k===pal.idx?' sel':'')); d.dataset.k=k; d.setAttribute('role','option');
    const cat=el('span','cat'); cat.textContent=it.c.cat; const lbl=el('span','lbl'), set=new Set(it.f.idx), L=it.c.label;
    let run='', mode=null; const flush=()=>{ if(!run) return; if(mode){ const mk=el('mark'); mk.textContent=run; lbl.append(mk); } else lbl.append(run); run=''; };
    for(let t=0;t<L.length;t++){ const m=set.has(t); if(m!==mode){ flush(); mode=m; } run+=L[t]; } flush();
    const sc=el('span','sc'); sc.textContent=it.c.sc; d.append(cat,lbl,sc); return d;
  }));
  const s=palList.querySelector('.sel'); if(s) s.scrollIntoView({block:'nearest'});
}
function openPalette(mode){
  hideMenu(); A().dismiss(); pal.open=true; pal.mode=mode==='notes'?'notes':'cmd'; palEl.hidden=false;
  palInput.placeholder=pal.mode==='notes'?'Open a note by name, or type a new name… (Ctrl+Enter opens a new tab)':'Type a command, a tab name, or a heading…';
  palInput.value=''; palRun(); palInput.focus();
}
function openSwitcher(){ if(pal.open&&pal.mode==='notes') closePalette(true); else openPalette('notes'); }
function closePalette(refocus){ if(!pal.open) return; pal.open=false; palEl.hidden=true; if(refocus) A().refocus(); }
function palPick(it,alt){ closePalette(true); if(!it) return; if(alt&&it.c.alt) it.c.alt(); else it.c.run(); }
palInput.addEventListener('input',palRun);
palInput.addEventListener('keydown',e=>{
  e.stopPropagation();
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); if(pal.items.length){ pal.idx=(pal.idx+(e.key==='ArrowDown'?1:-1)+pal.items.length)%pal.items.length; palRender(); } }
  else if(e.key==='Enter'){ e.preventDefault(); palPick(pal.items[pal.idx],e.ctrlKey||e.metaKey); }
  else if(e.key==='Escape'){ e.preventDefault(); closePalette(true); }
});
palList.addEventListener('mousedown',e=>e.preventDefault());
palList.addEventListener('click',e=>{ const d=e.target.closest('.pi'); if(d) palPick(pal.items[+d.dataset.k],e.ctrlKey||e.metaKey); });
document.addEventListener('mousedown',e=>{ if(pal.open&&!e.target.closest('#pal')) closePalette(false); },true);
