'use strict';
/* ---------- files pane ---------- */
function fempty(msg,btn,fn){ const d=el('div','fempty'); d.append(msg); if(btn){ const b=el('button','btn'); b.type='button'; b.textContent=btn; b.addEventListener('click',fn); d.append(el('br'),b); } return d; }
let treeStale=false;
function renderTree(){
  filesEl.hidden=!settings.files; if(filesEl.hidden) return;
  if(treeEl.querySelector('input.frename')){ treeStale=true; return; }   /* not under a rename in progress */
  treeStale=false;
  const ready=!!(ws.dir&&vx.perm&&vx.root); rows.clear();
  filesEl.classList.toggle('ready',ready); fNameEl.firstElementChild.textContent=ws.dir?ws.dir.name:'Files'; fNameEl.title=(ws.dir?ws.dir.name+' · ':'')+'Switch workspace or folder';
  if(!ws.dir){ treeEl.replaceChildren(fempty('No folder is open. Notes in a folder show here, and new notes are saved into it.','Open folder…',()=>openVault(null))); return; }
  if(!vx.perm){ treeEl.replaceChildren(fempty('PowerNotes needs your permission to read "'+ws.dir.name+'" again.','Allow access',()=>grantVault())); return; }
  if(!vx.root){ treeEl.replaceChildren(fempty('Reading the folder…')); return; }
  const frag=document.createDocumentFragment(), curPath=A()&&A().D()?A().D().wsPath:null;
  const row=(kind,path,name,depth)=>{
    const r=el('div','fr '+kind); r.dataset.p=path; r.style.setProperty('--d',depth); r.draggable=true; r.setAttribute('role','treeitem');
    if(kind==='dir'){ const c=el('span','fchev'); c.innerHTML=CHEV; r.append(c); const open=exp.has(path); r.setAttribute('aria-expanded',open); if(open) r.classList.add('open'); }
    const n=el('span','fn'); n.textContent=kind==='dir'?name:labelOf(name); n.title=name; r.append(n);
    if(path===curPath) r.classList.add('cur'); if(path===fsel) r.classList.add('sel');
    rows.set(path,r); return r;
  };
  const walk=(node,depth)=>{ for(const d of sortedDirs(node.dirs)){ frag.append(row('dir',d.path,d.name,depth)); if(exp.has(d.path)) walk(d,depth+1); } for(const f of sortedFiles(node.files)) frag.append(row('file',f.path,f.name,depth)); };
  walk(vx.root,0);
  if(!vx.root.dirs.length&&!vx.root.files.length) frag.append(fempty('No notes in this folder yet. Alt+N makes one.'));
  treeEl.replaceChildren(frag);
}
function filesMarkCur(reveal){ if(filesEl.hidden) return; const p=A()&&A().D()?A().D().wsPath:null; for(const [k,r] of rows) r.classList.toggle('cur',k===p); if(reveal&&p){ const r=rows.get(p); if(r) r.scrollIntoView({block:'nearest'}); } }
/* the sort orders Obsidian offers; folders keep their place at the top and follow the name order */
const FSORTS=[['az','File name (A to Z)'],['za','File name (Z to A)'],['mnew','Modified time (new to old)'],['mold','Modified time (old to new)'],['cnew','Created time (new to old)'],['cold','Created time (old to new)']];
function sortedFiles(files){
  const s=settings.fsort; if(s==='az') return files; if(s==='za') return files.slice().sort((a,b)=>byName(b,a));
  const key=e=>(s[0]==='m'?e.mtime:(e.ctime||e.mtime))||0, desc=s.endsWith('new');
  return files.slice().sort((a,b)=>(desc?key(b)-key(a):key(a)-key(b))||byName(a,b));
}
function sortedDirs(dirs){ return settings.fsort==='za'?dirs.slice().sort((a,b)=>byName(b,a)):dirs; }
function setFsort(v){ settings.fsort=v; renderTree(); scheduleDraft(); }
const sortMenu=()=>FSORTS.map(([v,l])=>({l,chk:settings.fsort===v,f:()=>setFsort(v)}));
function selectRow(p){ fsel=p; for(const [k,r] of rows) r.classList.toggle('sel',k===p); const r=rows.get(p); if(r) r.scrollIntoView({block:'nearest'}); }
function toggleDir(p){ if(exp.has(p)) exp.delete(p); else exp.add(p); renderTree(); scheduleDraft(); }
function activateRow(p,how){ if(isDirPath(p)) toggleDir(p); else { const e=vx.notes.get(p); if(e) openNote(e,how); } }
function toggleFiles(){ settings.files=!settings.files; renderTree(); scheduleDraft(); }
function setFw(w){ settings.fw=Math.max(160,Math.min(600,Math.round(w))); document.documentElement.style.setProperty('--fw',settings.fw+'px'); }
/* the folder a new note or folder goes into: the selected folder, else the one holding the selected note, else the
   one holding the current note, else the top */
function selDir(){
  if(!vx.root) return null;
  const p=fsel!=null?fsel:(D()&&D().wsPath)||'';
  return vx.dirs.get(isDirPath(p)?p:parentOf(p))||vx.root;
}
function treeMenu(path){
  const isDir=path==null||isDirPath(path), node=path==null?vx.root:nodeAt(path), dirNode=isDir?node:vx.dirs.get(parentOf(path)), items=[];
  if(!node) return [];
  if(path!=null&&!isDir) items.push({l:'Open',f:()=>openNote(node)},{l:'Open in new tab',f:()=>openNote(node,'tab')},{l:'Open to the right',f:()=>openNote(node,'split')});
  items.push({l:'New note',f:()=>newNoteIn(dirNode)},{l:'New folder',f:()=>newFolderIn(dirNode)});
  if(path!=null) items.push('-',{l:'Rename',sc:'F2',f:()=>startTreeRename(path)},{l:'Delete',sc:'Del',f:()=>trashEntry(path)});
  items.push('-',{l:'Sort by',sub:sortMenu},{l:'Collapse all',f:()=>{ exp.clear(); renderTree(); scheduleDraft(); }},{l:'Refresh',f:()=>requestScan(true,null,0)});
  if(path==null) items.push('-',{l:'Change folder…',f:()=>openVault(null)},{l:'Close folder',f:closeVault});
  return items;
}
function startTreeRename(path){
  const r=rows.get(path), node=nodeAt(path); if(!r||!node) return;
  const n=r.querySelector('.fn'), inp=el('input','frename'), ext=isDirPath(path)?'':(NOTE_EXT.exec(node.name)||[''])[0];
  inp.value=node.name.slice(0,node.name.length-ext.length); inp.spellcheck=false; inp.setAttribute('aria-label','Name');
  n.replaceWith(inp); r.draggable=false; inp.focus(); inp.select();
  let done=false;
  const finish=async ok=>{
    if(done) return; done=true; const v=inp.value.trim(); inp.replaceWith(n); r.draggable=true;
    if(treeStale) renderTree();
    if(ok&&v&&v+ext!==node.name){ const np=await moveEntry(path,parentOf(path),v+ext); if(np){ fsel=np; } }
    treeEl.focus({preventScroll:true});
  };
  inp.addEventListener('blur',()=>finish(true));
  inp.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter'){ e.preventDefault(); finish(true); } else if(e.key==='Escape'){ e.preventDefault(); finish(false); } });
  inp.addEventListener('mousedown',e=>e.stopPropagation());
}
/* a click shows the note in the current tab; Ctrl+click opens a new tab (so does the middle button), Ctrl+Alt+click a new pane */
treeEl.addEventListener('click',e=>{
  const r=e.target.closest('.fr'); if(!r||r.querySelector('input')) return;
  selectRow(r.dataset.p); activateRow(r.dataset.p,(e.ctrlKey||e.metaKey)?(e.altKey?'split':'tab'):'here');
});
treeEl.addEventListener('auxclick',e=>{ const r=e.target.closest('.fr'); if(!r||e.button!==1||isDirPath(r.dataset.p)) return; e.preventDefault(); selectRow(r.dataset.p); activateRow(r.dataset.p,'tab'); });
treeEl.addEventListener('dblclick',e=>{ const r=e.target.closest('.fr'); if(r&&e.target.closest('.fn')) startTreeRename(r.dataset.p); });
treeEl.addEventListener('contextmenu',e=>{
  e.preventDefault(); const r=e.target.closest('.fr'); if(r) selectRow(r.dataset.p);
  const items=treeMenu(r?r.dataset.p:null); if(items.length) showContextMenu(e.clientX,e.clientY,items);
});
treeEl.addEventListener('keydown',e=>{
  if(e.target!==treeEl) return;
  const list=[...treeEl.querySelectorAll('.fr')]; if(!list.length) return;
  const k=list.findIndex(r=>r.dataset.p===fsel), go=j=>selectRow(list[Math.max(0,Math.min(j,list.length-1))].dataset.p);
  if(e.key==='ArrowDown') go(k+1);
  else if(e.key==='ArrowUp') go(k<0?0:k-1);
  else if(e.key==='Home') go(0);
  else if(e.key==='End') go(list.length-1);
  else if(e.key==='ArrowRight'&&fsel!=null){ if(isDirPath(fsel)&&!exp.has(fsel)) toggleDir(fsel); else go(k+1); }
  else if(e.key==='ArrowLeft'&&fsel!=null){ if(isDirPath(fsel)&&exp.has(fsel)) toggleDir(fsel); else if(parentOf(fsel)) selectRow(parentOf(fsel)); }
  else if((e.key==='Enter'||e.key===' ')&&fsel!=null) activateRow(fsel);
  else if(e.key==='F2'&&fsel!=null) startTreeRename(fsel);
  else if(e.key==='Delete'&&fsel!=null) trashEntry(fsel);
  else if(e.key==='Escape'){ A().focusEditor(); }
  else return;
  e.preventDefault(); e.stopPropagation();
});
$('fNew').addEventListener('click',()=>newNoteIn(selDir()));
$('fNewDir').addEventListener('click',()=>newFolderIn(selDir()));
$('fFold').addEventListener('click',()=>{ exp.clear(); renderTree(); scheduleDraft(); });
$('fSort').addEventListener('click',e=>{ const r=e.currentTarget.getBoundingClientRect(); showContextMenu(r.left,r.bottom+4,[{h:'Sort by'},...sortMenu()]); });
fNameEl.addEventListener('click',e=>{ const r=e.currentTarget.getBoundingClientRect(); showContextMenu(r.left,r.bottom+4,workspaceMenu()); });
$('fResize').addEventListener('mousedown',e=>{
  e.preventDefault(); const x0=e.clientX, w0=settings.fw;
  const mv=ev=>setFw(w0+ev.clientX-x0), up=()=>{ removeEventListener('mousemove',mv); removeEventListener('mouseup',up); scheduleDraft(); };
  addEventListener('mousemove',mv); addEventListener('mouseup',up);
});
/* dragging a note or folder onto a folder row (or onto the pane's empty space, for the top) moves it there */
let treeDrag=null, treeDrop=null;
function dropDirOf(e){ const r=e.target.closest('.fr'); if(!r) return ''; const p=r.dataset.p; return isDirPath(p)?p:parentOf(p); }
function clearTreeDrop(){ if(treeDrop){ treeDrop.classList.remove('drop'); treeDrop=null; } }
function endTreeDrag(){ treeDrag=null; clearTreeDrop(); treeEl.querySelectorAll('.dragging').forEach(x=>x.classList.remove('dragging')); }
treeEl.addEventListener('dragstart',e=>{
  const r=e.target.closest('.fr'); if(!r||!r.dataset.p||r.querySelector('input')){ e.preventDefault(); return; }
  treeDrag=r.dataset.p; e.dataTransfer.setData('text/plain',treeDrag); e.dataTransfer.effectAllowed='move'; r.classList.add('dragging');
});
treeEl.addEventListener('dragover',e=>{
  if(treeDrag==null) return; e.preventDefault(); const dest=dropDirOf(e); clearTreeDrop();
  const ok=dest!==parentOf(treeDrag)&&!(treeDrag.endsWith('/')&&dest.startsWith(treeDrag));
  e.dataTransfer.dropEffect=ok?'move':'none'; if(!ok) return;
  treeDrop=dest?rows.get(dest):treeEl; if(treeDrop) treeDrop.classList.add('drop');
});
treeEl.addEventListener('dragleave',e=>{ if(!treeEl.contains(e.relatedTarget)) clearTreeDrop(); });
treeEl.addEventListener('drop',async e=>{
  if(treeDrag==null) return; e.preventDefault(); const dest=dropDirOf(e), src=treeDrag; endTreeDrag();
  if(dest===parentOf(src)||(src.endsWith('/')&&dest.startsWith(src))) return;
  const np=await moveEntry(src,dest); if(np) fsel=np;
});
treeEl.addEventListener('dragend',endTreeDrag);
