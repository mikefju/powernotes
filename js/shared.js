'use strict';
/* ---------- shared bits of the editor: links, find bar, filter bar, suggestions, palette, agenda items ---------- */
function wikiTargets(name){ const n=name.replace(/\.md$/i,'').toLowerCase(); return allDocs().filter(d=>d.name.replace(/\.md$/i,'').toLowerCase()===n); }
outlineEl.addEventListener('click',e=>{ const a=e.target.closest('.oi'); if(!a) return; A().revealRow(+a.dataset.i); sideAutoClose(); });
findInput.addEventListener('input',()=>A().runFind(true));
findInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); A().findStep(e.shiftKey?-1:1); } else if(e.key==='Escape'){ e.preventDefault(); A().closeFind(); } });
replInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); A().replaceOne(); } else if(e.key==='Escape'){ e.preventDefault(); A().closeFind(); } });
$('findNext').onclick=()=>A().findStep(1); $('findPrev').onclick=()=>A().findStep(-1); $('findClose').onclick=()=>A().closeFind();
findCaseBtn.onclick=()=>{ const P=A(); P.find.cs=!P.find.cs; findCaseBtn.setAttribute('aria-pressed',P.find.cs); P.runFind(true); };
replToggle.onclick=()=>{ replWrap.hidden=false; replToggle.hidden=true; replInput.focus(); };
$('replOne').onclick=()=>A().replaceOne(); $('replAll').onclick=()=>A().replaceAll();

/* ---------- filter bar: one setting, applied in every pane, shown for the active one ---------- */
function setFilter(patch){ Object.assign(settings.filter,patch); renderAll(); A().restoreSel(); scheduleDraft(); }
function toggleFilterBar(){ setFilter({on:!settings.filter.on}); }
function closeFilter(){ setFilter({on:false}); A().refocus(); }
function toggleFilterTag(t){ const tags=settings.filter.tags.slice(); const k=tags.indexOf(t); if(k>=0) tags.splice(k,1); else tags.push(t); setFilter({on:true,tags}); }
filterBar.addEventListener('mousedown',e=>{ if(e.target.closest('button')) e.preventDefault(); });
fStatus.addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) setFilter({status:b.dataset.v}); });
fDue.addEventListener('change',()=>{ setFilter({due:fDue.value}); A().refocus(); });
fPri.addEventListener('change',()=>{ setFilter({pri:fPri.value}); A().refocus(); });
fTags.addEventListener('click',e=>{ const b=e.target.closest('button'); if(b) toggleFilterTag(b.dataset.k); });
fParents.addEventListener('click',()=>setFilter({parents:!settings.filter.parents}));
fChildren.addEventListener('click',()=>setFilter({children:!settings.filter.children}));
fDim.addEventListener('click',()=>setFilter({dim:!settings.filter.dim}));
$('fClear').addEventListener('click',()=>setFilter(Object.assign({},FILTER_DEFAULTS,{tags:[]})));
$('fToday').addEventListener('click',()=>setFilter({on:true,status:'open',due:'due',pri:'any',tags:[]}));
$('fClose').addEventListener('click',closeFilter);
filterBar.addEventListener('keydown',e=>{ if(e.key==='Escape'){ e.preventDefault(); e.stopPropagation(); closeFilter(); } });

/* ---------- suggestions for #tags, [[notes]] and @dates draw on every open tab and the folder index ---------- */
function collectTags(){
  const m=new Map(), bump=(k,label,n)=>{ const e=m.get(k); if(e) e.n+=n; else m.set(k,{k,label,n}); };
  for(const d of allDocs()) for(const l of d.lines){ RE_TAG.lastIndex=0; let x; while((x=RE_TAG.exec(l.text))) bump(x[1].toLowerCase(),x[1],1); }
  for(const e of vx.notes.values()) if(!openDocAt(e.path)) for(const k in e.tags) bump(k,e.tags[k][0],e.tags[k][1]);
  return [...m.values()].sort((a,b)=>b.n-a.n||a.k.localeCompare(b.k));
}
function noteNames(){
  const seen=new Set(), out=[];
  const add=n=>{ const b=baseOf(n), k=b.toLowerCase(); if(!seen.has(k)){ seen.add(k); out.push(b); } };
  allDocs().forEach(d=>add(d.name)); for(const e of vx.notes.values()) add(e.name); return out;
}
const DAYS_FULL=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
function usedDates(){
  const s=new Set(); for(const d of allDocs()) for(const l of d.lines){ const re=/@(\d{4}-\d{2}-\d{2})(?![\w-])/g; let m; while((m=re.exec(l.text))) s.add(m[1]); }
  for(const e of vx.notes.values()) if(!openDocAt(e.path)) for(const iso of e.dates) s.add(iso);
  return [...s].sort();
}
/* after @: the date the typed text already means, dates used in any tab, then the next two weeks; matched on the ISO form, the weekday and words like tomorrow, shown the way the chip will read */
function dateSuggestions(q){
  const ql=q.toLowerCase(), out=[], seen=new Set(), today=todayStr();
  if(/^\d{4}-\d{2}-\d{2}$/.test(ql)) return out;
  const add=iso=>{ if(seen.has(iso)) return; seen.add(iso); out.push({label:dueLabel(iso),text:'@'+iso+' '}); };
  if(ql){ const iso=parseDateToken(ql); if(iso) add(iso); }
  const used=usedDates();
  for(const iso of used) if(iso>=today&&iso.startsWith(ql)) add(iso);
  for(let d=0;d<=14;d++){
    const iso=shiftDate(d), [y,mo,dd]=iso.split('-').map(Number), names=[iso,dueLabel(iso).slice(1).toLowerCase(),DAYS_FULL[new Date(y,mo-1,dd).getDay()]];
    if(d===7) names.push('next week');
    if(!ql||names.some(n=>n.startsWith(ql))) add(iso);
  }
  if(ql) for(const iso of used) if(iso.startsWith(ql)) add(iso);
  return out;
}
/* open tabs by their live text, the rest of the folder by the index */
function agendaItems(){
  const out=[];
  for(const d of allDocs()){ let inF=false; d.lines.forEach((l,j)=>{
    if(RE_FENCE.test(l.text)){ inF=!inF; return; } if(inF) return;
    const p=parse(l.text); if(p.checked!==false) return; const iso=dueOf(p.body); if(iso) out.push({iso,d,j,body:p.body,name:d.name});
  }); }
  for(const e of vx.notes.values()) if(!openDocAt(e.path)) for(const it of e.items) out.push({iso:it.iso,p:e.path,j:it.j,body:it.body,name:e.name});
  return out.sort((a,b)=>a.iso.localeCompare(b.iso)||(a.d==null)-(b.d==null)||(a.d!=null?0:a.p.localeCompare(b.p))||a.j-b.j);
}
function agendaDay(iso,today){ const lab=dueLabel(iso).slice(1); return iso<today?'Overdue · '+lab:lab; }
