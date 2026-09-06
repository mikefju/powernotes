'use strict';
/* ---------- search across the folder ----------
   Every open tab by its live text, then every other note in the folder by its file. Files are read on demand and
   their text kept while the file's size and mtime are unchanged, so the second search over a folder is quick.
   Results come grouped by note, one line per hit; a click opens the note and selects the match. */
const searchInput=$('searchInput'), searchList=$('searchList'), searchCount=$('searchCount'), searchCaseBtn=$('searchCase');
const search={q:'',cs:false,timer:0,run:0,shown:''};
const textCache=new Map();
const SEARCH_MAX_HITS=500, SEARCH_MAX_PER_NOTE=50;
async function noteText(e){
  const c=textCache.get(e.path); if(c&&c.mtime===e.mtime&&c.size===e.size) return c.text;
  if(!e.handle) return null;
  try{ const f=await e.handle.getFile(), text=await f.text(); textCache.set(e.path,{mtime:f.lastModified,size:f.size,text}); return text; }catch(x){ return null; }
}
/* the lines of a note with the fences and front matter marked, so hits are reported in body offsets the editor understands */
function searchLines(arr){
  const out=[]; let inF=false; const fmEnd=frontMatterEnd(arr);
  for(let j=0;j<arr.length;j++){
    const t=arr[j]; if(j<fmEnd){ out.push(t); continue; }
    const f=RE_FENCE.test(t); if(f||inF){ out.push(t); if(f) inF=!inF; continue; }
    out.push(parse(t).body);
  }
  return out;
}
function hitsIn(body,nd,cs){
  const hay=cs?body:body.toLowerCase(), cols=[]; let k=0;
  while((k=hay.indexOf(nd,k))>=0){ cols.push([k,k+nd.length]); k+=nd.length; if(cols.length>20) break; }
  return cols;
}
function searchFor(q){ showView('search'); searchInput.value=q; searchInput.select(); search.q=q; search.shown=''; runSearch(); }
function scheduleSearch(){ clearTimeout(search.timer); search.timer=setTimeout(runSearch,200); }
function renderSearch(){ if(search.q!==search.shown) runSearch(); }
async function runSearch(){
  search.timer=0; const q=search.q=searchInput.value, run=++search.run, cs=search.cs, nd=cs?q:q.toLowerCase();
  if(!q.trim()){ searchList.replaceChildren(); searchCount.textContent=''; search.shown=q; return; }
  const groups=[]; let hits=0, notes=0;
  const scan=(arr,mk)=>{ const rows=[]; arr.forEach((body,j)=>{ if(rows.length>=SEARCH_MAX_PER_NOTE) return; const cols=hitsIn(body,nd,cs); if(cols.length) rows.push({j,body,cols}); }); if(rows.length){ hits+=rows.reduce((n,r)=>n+r.cols.length,0); notes++; groups.push(Object.assign({rows},mk)); } };
  const open=allDocs().filter(d=>!isBlank(d));
  for(const d of open) scan(searchLines(d.lines.map(l=>l.text)),{d,name:d.name,path:d.wsPath||''});
  const rest=[...vx.notes.values()].filter(e=>!openDocAt(e.path)&&e.handle).sort((a,b)=>a.path.localeCompare(b.path));
  const draw=(done)=>{ if(run!==search.run) return; searchCount.textContent=(hits?hits+' hit'+(hits===1?'':'s')+' in '+notes+' note'+(notes===1?'':'s'):'No hits')+(done?'':' · searching…'); renderResults(groups,q,cs); search.shown=q; };
  draw(!rest.length);
  let k=0;
  for(const e of rest){
    if(hits>=SEARCH_MAX_HITS) break;
    const text=await noteText(e); if(run!==search.run) return; if(text==null) continue;
    scan(searchLines(text.split('\n')),{e,name:e.name,path:e.path});
    if(++k%15===0) draw(false);
  }
  if(hits>=SEARCH_MAX_HITS) searchCount.textContent='More than '+SEARCH_MAX_HITS+' hits · narrow the search';
  draw(true);
}
function renderResults(groups,q,cs){
  const frag=document.createDocumentFragment();
  if(!groups.length){ frag.append(Object.assign(el('div','snone'),{textContent:'Nothing found for "'+q+'"'+(ws.dir?'':' in the open tabs. Open a folder to search a whole vault.')})); searchList.replaceChildren(frag); return; }
  groups.forEach((g,gi)=>{
    const n=g.rows.reduce((s,r)=>s+r.cols.length,0);
    const h=el('div','sg'); h.dataset.g=gi; h.title=g.path||g.name; const nm=el('span'); nm.textContent=labelOf(g.name); const tn=el('span','tn'); tn.textContent=n; h.append(nm,tn); frag.append(h);
    for(const r of g.rows){
      const row=el('div','sr'); row.dataset.g=gi; row.dataset.j=r.j; row.dataset.s=r.cols[0][0]; row.dataset.e=r.cols[0][1];
      /* the line is trimmed so the first hit is in view, and every hit on it is lit */
      const [s0]=r.cols[0], from=Math.max(0,s0-30), body=r.body; let last=from;
      if(from>0) row.append('…');
      for(const [a,b] of r.cols){ if(a<last) continue; row.append(body.slice(last,a)); const m=el('mark'); m.textContent=body.slice(a,b); row.append(m); last=b; }
      row.append(body.slice(last)); row.title=body;
      frag.append(row);
    }
  });
  searchList.replaceChildren(frag); searchList._groups=groups;
}
async function openHit(g,j,s,e,how){
  let d=g.d;
  if(!d){ if(!g.e) return; d=await openNote(g.e,how); if(!d) return; }
  else { if(how==='tab'&&!allDocs().includes(d)) return; focusDoc(d); }
  const p=paneOf(d); if(!p) return;
  if(j==null) p.focusEditor(); else p.revealRange(j,s,e);
  sideAutoClose();
}
searchInput.addEventListener('input',scheduleSearch);
searchInput.addEventListener('keydown',e=>{
  if(e.key==='Escape'){ e.preventDefault(); if(searchInput.value){ searchInput.value=''; runSearch(); } else A().focusEditor(); }
  else if(e.key==='Enter'){ e.preventDefault(); const r=searchList.querySelector('.sr'); if(r) r.click(); }
});
searchCaseBtn.addEventListener('click',()=>{ search.cs=!search.cs; searchCaseBtn.setAttribute('aria-pressed',search.cs); runSearch(); searchInput.focus(); });
searchList.addEventListener('click',e=>{
  const groups=searchList._groups||[], how=(e.ctrlKey||e.metaKey)?'tab':undefined;
  const r=e.target.closest('.sr'); if(r){ openHit(groups[+r.dataset.g],+r.dataset.j,+r.dataset.s,+r.dataset.e,how); return; }
  const h=e.target.closest('.sg'); if(h) openHit(groups[+h.dataset.g],null,0,0,how);
});
