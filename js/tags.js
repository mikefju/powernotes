'use strict';
/* ---------- the tags view ----------
   Every #tag in the open tabs and the folder, with how often it is used. Tags with a slash in them (#work/urgent)
   nest under their parent. A click searches the folder for the tag; Ctrl+click filters the current note by it. */
const tagList=$('tagList'), tagExp=new Set();
let tagTimer=0;
function tagTree(){
  const root={kids:new Map(),n:0};
  for(const t of collectTags()){
    const segs=t.label.split('/'); let node=root, full='';
    segs.forEach((s,k)=>{ full+=(k?'/':'')+s; let c=node.kids.get(s.toLowerCase()); if(!c){ c={name:s,full,k:full.toLowerCase(),own:0,n:0,kids:new Map()}; node.kids.set(s.toLowerCase(),c); } c.n+=t.n; if(k===segs.length-1) c.own+=t.n; node=c; });
  }
  return root;
}
function sortedTags(nodes){
  const arr=[...nodes.values()];
  return settings.side.tagSort==='name'?arr.sort((a,b)=>a.name.localeCompare(b.name,undefined,{sensitivity:'base'})):arr.sort((a,b)=>b.n-a.n||a.name.localeCompare(b.name,undefined,{sensitivity:'base'}));
}
function renderTags(){
  if(!sideShowing('tags')) return;
  const root=tagTree(), frag=document.createDocumentFragment();
  $('tagSort').title='Sorted by '+(settings.side.tagSort==='name'?'name':'count')+' · click to sort by '+(settings.side.tagSort==='name'?'count':'name');
  const walk=(node,depth)=>{ for(const t of sortedTags(node.kids)){
    const has=t.kids.size>0, open=has&&tagExp.has(t.k), r=el('div','fr '+(has?'dir':'file')+(open?' open':'')); r.dataset.k=t.k; r.style.setProperty('--d',depth); r.setAttribute('role','treeitem');
    if(has){ const c=el('span','fchev'); c.innerHTML=CHEV; r.append(c); r.setAttribute('aria-expanded',open); }
    const n=el('span','fn'); n.textContent=(depth?'':'#')+t.name; n.title='#'+t.full+' · click to search, Ctrl+click to filter this note'; const tn=el('span','tn'); tn.textContent=t.n; r.append(n,tn); frag.append(r);
    if(open) walk(t,depth+1);
  } };
  walk(root,0);
  if(!root.kids.size) frag.append(Object.assign(el('div','fempty'),{textContent:'No tags yet. Type #tag anywhere on a line.'}));
  tagList.replaceChildren(frag);
}
function scheduleTags(){ if(!sideShowing('tags')) return; clearTimeout(tagTimer); tagTimer=setTimeout(renderTags,300); }
tagList.addEventListener('click',e=>{
  const r=e.target.closest('.fr'); if(!r) return; const k=r.dataset.k;
  if(e.target.closest('.fchev')){ if(tagExp.has(k)) tagExp.delete(k); else tagExp.add(k); renderTags(); return; }
  if(e.ctrlKey||e.metaKey){ toggleFilterTag(k); return; }
  searchFor('#'+k);
});
$('tagSort').addEventListener('click',()=>{ settings.side.tagSort=settings.side.tagSort==='name'?'count':'name'; renderTags(); scheduleDraft(); });
