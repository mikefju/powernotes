'use strict';
/* ---------- command palette ---------- */
const pal={open:false,items:[],idx:0};
const cap=s=>s[0].toUpperCase()+s.slice(1);
function palCommands(){
  const out=[];
  const walk=(items,cat)=>{ let sect=''; for(const it of items){ if(it==='-'){ sect=''; continue; } if(it.h){ sect=it.h; continue; } if(it.dis) continue; if(it.sub){ walk(it.sub(),cat+' › '+it.l); continue; } out.push({cat:cat+(sect?' › '+sect:''),label:it.l,sc:it.sc||'',run:it.f}); } };
  for(const name of MENU_ORDER) walk(menus[name](),cap(name));
  A().docs.forEach((d,k)=>out.push({cat:'Tab',label:labelOf(d.name),sc:k<9?'Alt+'+(k+1):'',run:()=>A().switchTab(k)}));
  for(const p of panes) if(p!==A()) p.docs.forEach(d=>out.push({cat:'Tab · other pane',label:labelOf(d.name),sc:'',run:()=>focusDoc(d)}));
  for(const e of vx.notes.values()) if(!openDocAt(e.path)) out.push({cat:'Note',label:labelOf(e.name),sc:parentOf(e.path).slice(0,-1),run:()=>openNote(e)});
  for(const h of A().headings()) out.push({cat:'Heading',label:h.body||'(untitled)',sc:'',run:()=>A().revealRow(h.i)});
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
  const q=palInput.value.trim().toLowerCase(), scored=[];
  palCommands().forEach((c,k)=>{ let f=fuzzy(q,c.label); if(!f){ const g=fuzzy(q,c.cat+' '+c.label); if(g) f={score:g.score-150,idx:[]}; } if(f) scored.push({c,f,k}); });
  scored.sort((a,b)=>b.f.score-a.f.score||a.k-b.k);
  pal.items=scored.slice(0,14); pal.idx=0; palRender();
}
function palRender(){
  if(!pal.items.length){ const d=el('div','none'); d.textContent='No matching command'; palList.replaceChildren(d); return; }
  palList.replaceChildren(...pal.items.map((it,k)=>{
    const d=el('div','pi'+(k===pal.idx?' sel':'')); d.dataset.k=k; d.setAttribute('role','option');
    const cat=el('span','cat'); cat.textContent=it.c.cat; const lbl=el('span','lbl'), set=new Set(it.f.idx), L=it.c.label;
    let run='', mode=null; const flush=()=>{ if(!run) return; if(mode){ const mk=el('mark'); mk.textContent=run; lbl.append(mk); } else lbl.append(run); run=''; };
    for(let t=0;t<L.length;t++){ const m=set.has(t); if(m!==mode){ flush(); mode=m; } run+=L[t]; } flush();
    const sc=el('span','sc'); sc.textContent=it.c.sc; d.append(cat,lbl,sc); return d;
  }));
  const s=palList.querySelector('.sel'); if(s) s.scrollIntoView({block:'nearest'});
}
function openPalette(){ hideMenu(); A().dismiss(); pal.open=true; palEl.hidden=false; palInput.value=''; palRun(); palInput.focus(); }
function closePalette(refocus){ if(!pal.open) return; pal.open=false; palEl.hidden=true; if(refocus) A().refocus(); }
function palPick(it){ closePalette(true); if(it) it.c.run(); }
palInput.addEventListener('input',palRun);
palInput.addEventListener('keydown',e=>{
  e.stopPropagation();
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); if(pal.items.length){ pal.idx=(pal.idx+(e.key==='ArrowDown'?1:-1)+pal.items.length)%pal.items.length; palRender(); } }
  else if(e.key==='Enter'){ e.preventDefault(); palPick(pal.items[pal.idx]); }
  else if(e.key==='Escape'){ e.preventDefault(); closePalette(true); }
});
palList.addEventListener('mousedown',e=>e.preventDefault());
palList.addEventListener('click',e=>{ const d=e.target.closest('.pi'); if(d) palPick(pal.items[+d.dataset.k]); });
document.addEventListener('mousedown',e=>{ if(pal.open&&!e.target.closest('#pal')) closePalette(false); },true);
