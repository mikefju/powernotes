'use strict';
/* ---------- the folder ----------
   One folder is open at a time, like an Obsidian vault: ws.dir is its handle, the files pane shows it as a tree, a
   new note is a file in it from the start, edits are written as you type, and what other programs do to it shows
   up here. Every note in it has an index entry (links, dated items, tags, first lines, mtime) so backlinks, the
   agenda, link previews and autocomplete cover the whole folder and not only the open tabs. Entries are cached in
   IndexedDB and reused while a file's size and mtime are unchanged, so reopening a big folder does not re-read it. */
const NOTE_EXT=/\.(md|markdown|txt)$/i, SKIP_DIR=/^(\.|node_modules$|\$RECYCLE)/i, VX_MAX=20000, VX_DEPTH=16;
let ws={key:null,name:'',dir:null,autoKey:null}, workspaces=[];
const vx={root:null,dirs:new Map(),notes:new Map(),media:new Map(),perm:false,scanning:false,busy:0,sig:'',msig:''};
const filesEl=$('files'), treeEl=$('fTree'), fNameEl=$('fName'), rows=new Map();
let exp=new Set(), fsel=null;
const tick=()=>new Promise(r=>setTimeout(r,0));
const byName=(a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'});
const baseOf=n=>n.replace(NOTE_EXT,'');
const labelOf=n=>/\.md$/i.test(n)?n.slice(0,-3):n;
const isDirPath=p=>p===''||p.endsWith('/');
/* paths: 'a/b.md' for a file, 'a/b/' for a folder, '' for the folder itself */
const parentOf=p=>{ const s=p.endsWith('/')?p.slice(0,-1):p; return s.slice(0,s.lastIndexOf('/')+1); };
const nodeAt=p=>isDirPath(p)?vx.dirs.get(p):vx.notes.get(p);
const openDocAt=p=>allDocs().find(d=>d.wsPath===p);
/* the note called n (extension optional), anywhere in the folder */
function noteNamed(n){ const k=baseOf(n).toLowerCase(); for(const e of vx.notes.values()) if(baseOf(e.name).toLowerCase()===k) return e; return null; }
async function handleAt(p){ let h=ws.dir; const segs=p.split('/').filter(Boolean), dir=p.endsWith('/'); for(let i=0;i<segs.length;i++) h=(i===segs.length-1&&!dir)?await h.getFileHandle(segs[i]):await h.getDirectoryHandle(segs[i]); return h; }
async function pathIn(dir,h){ try{ const p=await dir.resolve(h); return p?p.join('/'):null; }catch(e){ return null; } }

/* the folder as a tree of {path,name,handle,dirs,files}; notes only, hidden folders left out */
async function walkTree(dir){
  const root={path:'',name:dir.name,handle:dir,dirs:[],files:[],media:new Map()}; let count=0;
  const walk=async(node,depth)=>{
    try{ for await(const h of node.handle.values()){
      if(h.kind==='file'){ if(NOTE_EXT.test(h.name)&&count<VX_MAX){ count++; node.files.push({path:node.path+h.name,name:h.name,handle:h}); } else if(IMG_EXT.test(h.name)&&root.media.size<VX_MAX) root.media.set(node.path+h.name,h); }
      else if(h.kind==='directory'&&!SKIP_DIR.test(h.name)&&depth<VX_DEPTH) node.dirs.push({path:node.path+h.name+'/',name:h.name,handle:h,dirs:[],files:[]});
    } }catch(e){}
    node.files.sort(byName); node.dirs.sort(byName);
    for(const d of node.dirs) await walk(d,depth+1);
  };
  await walk(root,0); return root;
}
/* what the rest of the app wants to know about a note without opening it */
function indexText(text,name){
  const links=new Set(), dates=new Set(), items=[], tags={}, head=[], title=baseOf(name).toLowerCase(); let inF=false, n=0;
  text.split('\n').forEach((t,j)=>{
    if(RE_FENCE.test(t)){ inF=!inF; return; } if(inF) return;
    let m; const rl=/\[\[([^\]\n]+?)\]\]/g; while((m=rl.exec(t))) links.add(baseOf(m[1].trim()).toLowerCase());
    RE_TAG.lastIndex=0; while((m=RE_TAG.exec(t))){ const k=m[1].toLowerCase(); if(tags[k]) tags[k][1]++; else tags[k]=[m[1],1]; }
    const rd=/@(\d{4}-\d{2}-\d{2})(?![\w-])/g; while((m=rd.exec(t))) dates.add(m[1]);
    if(!t.trim()) return;
    const p=parse(t);
    if(p.checked===false){ const iso=dueOf(p.body); if(iso) items.push({iso,j,body:p.body}); }
    if(!n&&p.type==='h'&&plainText(p.body).toLowerCase()===title) return;   /* the note's own title line */
    n++; if(head.length<8) head.push({h:p.type==='h',ind:p.indent,li:isList(p),chk:p.checked,txt:plainText(p.body)});
  });
  return {links:[...links],dates:[...dates],items,tags,head,n};
}
const ownWrites=new Map();
function setEntry(e,text,file){ Object.assign(e,indexText(text,e.name),{mtime:file.lastModified,size:file.size}); ownWrites.set(e.path,Date.now()); scheduleCache(); }

/* scans: a walk of the folder, then a stat of every file (full) or only of the new ones and those named (partial).
   Files whose size or mtime changed are re-read and re-indexed. Requests are merged and run one at a time. */
const pend={full:false,paths:new Set(),any:false}; let scanTimer=0, cacheTimer=0, lastFull=0;
function requestScan(full,paths,ms){
  if(!ws.dir||!vx.perm) return;
  pend.any=true; if(full) pend.full=true; if(paths) for(const p of paths) pend.paths.add(p);
  clearTimeout(scanTimer); scanTimer=setTimeout(runScan,ms==null?250:ms);
}
async function runScan(){
  scanTimer=0; if(vx.scanning||!pend.any) return;
  if(vx.busy){ scanTimer=setTimeout(runScan,400); return; }
  vx.scanning=true;
  try{ while(pend.any&&ws.dir&&vx.perm&&!vx.busy){ const full=pend.full, paths=pend.paths; pend.full=false; pend.paths=new Set(); pend.any=false; if(!(await scanOnce(full,paths))){ pend.any=true; pend.full=pend.full||full; break; } } }
  catch(e){ console.warn('folder scan',e); }
  finally{ vx.scanning=false; if(pend.any&&ws.dir) requestScan(false,null,500); }
}
async function scanOnce(full,paths){
  const dir=ws.dir, root=await walkTree(dir); if(ws.dir!==dir||vx.busy) return false;
  const files=[], dirs=new Map();
  (function collect(n){ dirs.set(n.path,n); files.push(...n.files); n.dirs.forEach(collect); })(root);
  const seen=new Set(), changed=[]; let k=0;
  for(const f of files){
    seen.add(f.path); let e=vx.notes.get(f.path);
    if(e&&e.handle&&!full&&!paths.has(f.path)){ e.handle=f.handle; continue; }
    if(++k%25===0){ await tick(); if(ws.dir!==dir||vx.busy) return false; }
    let file=null; try{ file=await f.handle.getFile(); }catch(x){ seen.delete(f.path); continue; }
    if(e&&e.mtime===file.lastModified&&e.size===file.size){ e.handle=f.handle; continue; }
    let text=''; try{ text=await file.text(); }catch(x){ seen.delete(f.path); continue; }
    e=Object.assign({path:f.path,name:f.name,handle:f.handle,mtime:file.lastModified,size:file.size,ctime:(e&&e.ctime)||fmCreated(text)||null},indexText(text,f.name));
    vx.notes.set(f.path,e); changed.push({e,text});
  }
  let gone=0; for(const p of [...vx.notes.keys()]) if(!seen.has(p)){ vx.notes.delete(p); gone++; }
  (function link(n){ n.files=n.files.map(f=>vx.notes.get(f.path)).filter(Boolean); n.dirs.forEach(link); })(root);
  vx.root=root; vx.dirs=dirs; vx.media=root.media; if(full) lastFull=Date.now();
  const msig=[...root.media.keys()].join('\n');   /* pictures drawn before the scan knew their files get another go */
  if(msig!==vx.msig){ vx.msig=msig; for(const p of panes) p.refreshMedia(); }
  const sig=[...dirs.keys()].join('\n')+'\n|'+files.map(f=>f.path).join('\n');   /* the tree is redrawn only when its shape changed */
  /* the tabs: paths for files opened before the tree existed, tabs whose file went away, tabs whose file changed on disk */
  let placed=false;
  for(const d of allDocs()) if(d.handle&&d.wsPath===undefined){ d.wsPath=await pathIn(dir,d.handle); placed=true; }
  for(const d of allDocs()) if(d.wsPath&&!vx.notes.has(d.wsPath)&&!d.dirty) removeDoc(d);
  for(const d of allDocs()){ const e=d.wsPath?vx.notes.get(d.wsPath):null; if(!e) continue; if(d.ctime==null&&e.ctime){ d.ctime=e.ctime; placed=true; } if(d.mtime==null&&!changed.some(c=>c.e===e)){ d.mtime=e.mtime; placed=true; } }
  for(const c of changed){ const d=openDocAt(c.e.path); if(!d) continue; if(d.mtime==null){ d.mtime=c.e.mtime; continue; } if(c.e.mtime!==d.mtime&&!d.dirty){ d.mtime=c.e.mtime; reloadDoc(d,c.text); } }
  if(sig!==vx.sig){ vx.sig=sig; renderTree(); }
  if(placed) renderTabsAll();
  if(changed.length||gone){ renderBacklinksAll(); renderAgendaAll(); scheduleCache(); }
  return true;
}
function scheduleCache(){ clearTimeout(cacheTimer); cacheTimer=setTimeout(saveCache,3000); }
function saveCache(){
  cacheTimer=0; if(!ws.dir) return; const notes={};
  for(const [p,e] of vx.notes) notes[p]={mtime:e.mtime,size:e.size,ctime:e.ctime||null,links:e.links,dates:e.dates,items:e.items,tags:e.tags,head:e.head,n:e.n};
  idb.set('index','vault',{name:ws.dir.name,notes});
}
async function loadCache(){
  const c=await idb.get('index','vault'); if(!c||!c.notes||!ws.dir||c.name!==ws.dir.name) return;
  for(const p in c.notes){ if(vx.notes.has(p)) continue; const e=c.notes[p]; if(e&&typeof e.mtime==='number') vx.notes.set(p,Object.assign({path:p,name:p.slice(p.lastIndexOf('/')+1),handle:null},e)); }
}

/* opening and closing the folder. The picker is shown when no handle is given; tabs with nothing unsaved close */
async function openVault(dir){
  if(!dir){
    if(!window.showDirectoryPicker){ alert('This browser cannot open folders. Chrome or Edge can.'); return; }
    try{ dir=await showDirectoryPicker({mode:'readwrite'}); }catch(e){ if(e.name!=='AbortError') console.error(e); return; }
  } else if(!(await grantHandle(dir,'readwrite','the folder "'+dir.name+'"'))) return;
  if(ws.dir&&await ws.dir.isSameEntry(dir).catch(()=>false)){ settings.files=true; await grantVault(); return; }
  await stashSession(); closeCleanTabs(); setWs(null,dir.name,dir); await restoreSession(dir);
}
function setWs(key,name,dir){
  syncStop(); dropMediaUrls(); ws={key,name,dir:dir||null,autoKey:null}; for(const d of allDocs()) d.wsPath=undefined;
  vx.root=null; vx.dirs=new Map(); vx.notes=new Map(); vx.media=new Map(); vx.perm=false; vx.sig=''; vx.msig=''; exp=new Set(); fsel=null;
  if(dir){ idb.set('handles','folder',dir); rememberDir(dir); settings.files=true; grantVault(); }
  else idb.del('handles','folder');
  renderTree(); renderTabsAll(); scheduleDraft();
}
/* with permission in hand: the cached index, the tree, a first full scan, and the watch on the folder */
async function grantVault(){
  if(!ws.dir) return false;
  if(!(await ensurePerm(ws.dir,'readwrite'))){ vx.perm=false; renderTree(); return false; }
  vx.perm=true; await loadCache(); renderTree(); requestScan(true,null,0); syncStart(); return true;
}
async function restoreVault(){
  const h=await idb.get('handles','folder'); if(!h) return;
  ws.dir=h; if(!ws.name) ws.name=h.name;
  let ok=false; try{ ok=(await h.queryPermission({mode:'readwrite'}))==='granted'; }catch(e){}
  if(ok) await grantVault(); else renderTree();
}
async function closeVault(){ await stashSession(); closeCleanTabs(); setWs(null,'',null); }

/* ---------- following the folder ----------
   Where the browser has FileSystemObserver, changes arrive as records and only the files named are re-read; a
   full scan then runs every few minutes as a check. Elsewhere the folder is scanned every 45 seconds while the
   page is visible. Either way a scan runs when the window gets focus after a while away. */
let syncTimer=0, observer=null, autoTimer=0, autoBusy=false;
const OBS=typeof FileSystemObserver==='function';
function syncStart(){
  syncStop(); if(!ws.dir||!settings.sync||!vx.perm) return;
  if(OBS){ try{ observer=new FileSystemObserver(onRecords); observer.observe(ws.dir,{recursive:true}).catch(()=>{ observer=null; syncSoon(45000); }); }catch(e){ observer=null; } }
  syncSoon(observer?300000:45000);
}
function syncStop(){ clearTimeout(syncTimer); syncTimer=0; if(observer){ try{ observer.disconnect(); }catch(e){} observer=null; } }
function syncSoon(ms){ if(!ws.dir||!settings.sync) return; clearTimeout(syncTimer); syncTimer=setTimeout(syncPoll,ms); }
function syncPoll(){ syncTimer=0; if(!ws.dir||!settings.sync) return; if(!document.hidden) requestScan(true); syncSoon(observer?300000:45000); }
/* records for the app's own writes (and the browser's swap files) are dropped, so typing does not set off scans;
   anything touching a folder, or that cannot be placed, brings a full scan */
function onRecords(recs){
  let full=false; const paths=new Set(), now=Date.now();
  for(const r of recs){
    const p=(r.relativePathComponents||[]).join('/'), kind=r.changedHandle?r.changedHandle.kind:null;
    if(r.type==='unknown'||r.type==='errored'||kind==='directory'){ full=true; continue; }
    if(/\.crswap$/i.test(p)) continue;
    if(!NOTE_EXT.test(p)){ if(kind!=='file') full=true; continue; }
    if(ownWrites.has(p)&&now-ownWrites.get(p)<5000&&r.type!=='disappeared') continue;
    if(r.type==='moved') full=true; else paths.add(p);
  }
  if(full) requestScan(true); else if(paths.size) requestScan(false,paths);
}
function syncWake(){ if(ws.dir&&settings.sync&&Date.now()-lastFull>15000) requestScan(true,null,200); }
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) syncWake(); });
window.addEventListener('focus',syncWake);


/* ---------- tabs and the folder ---------- */
function removeDoc(d){ idb.del('handles',d.id); for(const p of panes.slice()) p.detach(d); renderBacklinksAll(); scheduleDraft(); }
function reloadDoc(d,text){ const p=paneOf(d); if(p) p.reload(d,text); else { d.lines=fromTextRaw(text); d.indentUnit=detectIndent(d.lines); d.sel=null; } renderBacklinksAll(); scheduleDraft(); }
/* opens a note from the folder: in the active pane's current tab (how 'here', the default), in a new tab ('tab'),
   or in a new pane beside it ('split'). A note already open anywhere is brought to the front instead */
async function openNote(e,how){
  const open=allDocs().find(d=>d.wsPath===e.path);
  if(open){ if(how==='split') splitPane(A(),'row',open); else focusDoc(open); return open; }
  if(!e.handle) return null;
  let f=null, text=''; try{ f=await e.handle.getFile(); text=await f.text(); }catch(x){ alert('Could not open '+e.name+'.'); requestScan(true,null,0); return null; }
  const P=A(), meta={path:e.path,mtime:f.lastModified,ctime:e.ctime||null}; let d;
  if(how==='split'){ const N=splitPane(P,'row'); d=N.replaceCur(text,e.name,e.handle,meta); }
  else if(how==='tab'||!(await P.canReplace())){ d=await P.openInto(text,e.name,e.handle,meta); }
  else { d=P.replaceCur(text,e.name,e.handle,meta); A().focusEditor(); }
  filesMarkCur(); return d;
}
/* writes a tab to its file and brings the index entry along; true when the tab is clean afterwards */
async function writeDoc(d){
  flushDoc(d);
  const text=serializeLines(d.lines), w=await d.handle.createWritable(); await w.write(text); await w.close();
  const f=await d.handle.getFile(); d.mtime=f.lastModified;
  const e=d.wsPath?vx.notes.get(d.wsPath):null; if(e) setEntry(e,text,f);
  if(serializeLines(d.lines)===text){ d.dirty=false; return true; } return false;
}
async function freeName(dir,name){
  const taken=new Set(); try{ for await(const n of dir.keys()) taken.add(n.toLowerCase()); }catch(e){}
  if(!taken.has(name.toLowerCase())) return name;
  const m=NOTE_EXT.exec(name), ext=m?m[0]:'', base=name.slice(0,name.length-ext.length); let k=1, v;
  do{ v=base+' '+(++k)+ext; }while(taken.has(v.toLowerCase())); return v;
}
function addNote(node,handle,name,file,text,ctime){
  const path=node.path+name, e=Object.assign({path,name,handle,mtime:file.lastModified,size:file.size,ctime:ctime||fmCreated(text)||null},indexText(text,name));
  vx.notes.set(path,e); node.files=node.files.filter(f=>f.path!==path); node.files.push(e); node.files.sort(byName);
  ownWrites.set(path,Date.now()); exp.add(node.path); vx.sig=''; renderTree(); scheduleCache(); return e;
}
/* a new tab becomes Untitled.md (or Untitled 2.md, …, or its own name if it was renamed first) in the folder, or in
   the subfolder given. Resolves to the new path, or null when there is no folder to create it in */
async function createInFolder(d,node){
  if(!ws.dir||!vx.perm||!vx.root||d.handle) return null;
  node=node||vx.root;
  try{
    const name=await freeName(node.handle,(baseOf(d.name||'Untitled.md')||'Untitled')+(NOTE_EXT.exec(d.name||'')||['.md'])[0]);
    if(d.handle||!allDocs().includes(d)) return null;
    const text=serializeLines(d.lines), h=await node.handle.getFileHandle(name,{create:true}), w=await h.createWritable(); await w.write(text); await w.close();
    const f=await h.getFile(), path=node.path+name;
    d.handle=h; d.name=name; d.wsPath=path; d.mtime=f.lastModified; d.created=true;
    if(serializeLines(d.lines)===text) d.dirty=false; else scheduleAutosave();
    idb.set('handles',d.id,h); addNote(node,h,name,f,text,d.ctime); renderTabsAll(); renderBacklinksAll(); scheduleDraft(); return path;
  }catch(e){ console.warn('create note',e); return null; }
}
/* a tab that is not a file yet is saved into the folder, asking for a name when it is still Untitled */
async function saveToVault(d,text){
  if(!ws.dir||!vx.perm||!vx.root) return false;
  let name=d.name;
  if(!name||/^Untitled(\s*\d*)?\.md$/i.test(name)){ const v=prompt('Save in '+ws.dir.name+' as',name); if(v===null) return null; name=v.trim(); if(!name) return null; if(!NOTE_EXT.test(name)) name+='.md'; }
  if(BAD_NAME.test(name)){ alert('A file name cannot contain any of  \\ / : * ? " < > |'); return null; }
  const h=await ws.dir.getFileHandle(name,{create:true}), w=await h.createWritable(); await w.write(text); await w.close();
  const f=await h.getFile(); d.handle=h; d.name=name; d.wsPath=name; d.mtime=f.lastModified; idb.set('handles',d.id,h); addRecent(h,name);
  addNote(vx.root,h,name,f,text,d.ctime||Date.now()); return true;
}
/* an auto-created note that is still empty and still called Untitled is removed from the folder when its tab closes */
async function discardEmpty(d){
  if(!d.created||!d.handle||!ws.dir||!d.wsPath||!/^Untitled( \d+)?\.(md|markdown|txt)$/i.test(d.name)||serializeLines(d.lines).trim()) return;
  const dir=vx.dirs.get(parentOf(d.wsPath)); if(!dir) return;
  try{ if(!(await (await d.handle.getFile()).text()).trim()){ await dir.handle.removeEntry(d.name); vx.notes.delete(d.wsPath); requestScan(false,null,0); } }catch(e){}
}
/* edits to files in the folder are written about a second after the last keystroke */
function scheduleAutosave(){ if(!settings.autosave||!ws.dir) return; clearTimeout(autoTimer); autoTimer=setTimeout(autosave,1000); }
async function autosave(){
  autoTimer=0; if(!settings.autosave||!ws.dir) return;
  if(autoBusy||vx.busy||panes.some(p=>p.composing())){ scheduleAutosave(); return; }
  autoBusy=true; let changed=false;
  try{
    for(const d of allDocs()){
      if(!d.dirty||!d.handle) continue;
      if(d.wsPath===undefined) d.wsPath=await pathIn(ws.dir,d.handle);
      if(!d.wsPath) continue;
      try{ if((await d.handle.queryPermission({mode:'readwrite'}))!=='granted') continue; if(await writeDoc(d)) changed=true; else scheduleAutosave(); }
      catch(e){ console.warn('autosave',e); }
    }
  } finally{ autoBusy=false; }
  if(changed){ renderTabsAll(); renderBacklinksAll(); scheduleDraft(); }
}
/* an open item in a note that is not open: checked off in the file itself */
async function checkOffInFile(e,j){
  if(!e.handle) return;
  try{
    const ls=(await (await e.handle.getFile()).text()).split('\n'); if(ls[j]==null) return;
    const iu=detectIndent(ls.map(text=>({text}))), p=parseLine(ls[j],iu); if(p.checked!==false) return; p.checked=true; ls[j]=buildLine(p,iu);
    const text=ls.join('\n'), w=await e.handle.createWritable(); await w.write(text); await w.close();
    setEntry(e,text,await e.handle.getFile());
  }catch(x){ console.warn('agenda',x); }
}

/* ---------- moving, renaming and deleting in the folder ----------
   The browser can move a file in place only in some cases; otherwise it is copied and the original removed. Folders
   are always copied. Open tabs inside follow along, and so do their index entries. Deleting moves into a .trash
   folder at the top of the folder, so a mistake can be undone in Explorer. */
async function copyDir(src,parent,name){
  const nd=await parent.getDirectoryHandle(name,{create:true});
  for await(const h of src.values()){
    if(h.kind==='file'){ const f=await h.getFile(), nh=await nd.getFileHandle(h.name,{create:true}), w=await nh.createWritable(); await w.write(f); await w.close(); }
    else await copyDir(h,nd,h.name);
  }
  return nd;
}
async function relocateFile(h,fromDir,dir,name){
  if(typeof h.move==='function'){ try{ if(fromDir===dir) await h.move(name); else await h.move(dir,name); return await dir.getFileHandle(name); }catch(e){ if(e.name==='AbortError') throw e; } }
  const f=await h.getFile(), nh=await dir.getFileHandle(name,{create:true}), w=await nh.createWritable(); await w.write(f); await w.close();
  await fromDir.removeEntry(h.name); return nh;
}
async function relocateDir(h,fromDir,dir,name){ const nd=await copyDir(h,dir,name); await fromDir.removeEntry(h.name,{recursive:true}); return nd; }
const insideOf=(path,isDir)=>allDocs().filter(d=>d.wsPath&&(isDir?d.wsPath.startsWith(path):d.wsPath===path));
/* moves the file or folder at path into the folder at destPath, under newName when given. Resolves to the new path, or null */
async function moveEntry(path,destPath,newName){
  const isDir=path.endsWith('/'), src=nodeAt(path), dest=vx.dirs.get(destPath), from=vx.dirs.get(parentOf(path));
  if(!path||!src||!dest||!from||!vx.perm) return null;
  let name=(newName||src.name).trim(); if(!name) return null;
  if(!isDir&&!NOTE_EXT.test(name)) name+=(NOTE_EXT.exec(src.name)||['.md'])[0];
  if(BAD_NAME.test(name)){ alert('A name cannot contain any of  \\ / : * ? " < > |'); return null; }
  const newPath=destPath+name+(isDir?'/':'');
  if(newPath===path) return null;
  if(isDir&&newPath.startsWith(path)){ alert('A folder cannot be moved into itself.'); return null; }
  const caseOnly=newPath.toLowerCase()===path.toLowerCase();
  if(!caseOnly){
    let taken=false; try{ if(isDir) await dest.handle.getDirectoryHandle(name); else await dest.handle.getFileHandle(name); taken=true; }catch(e){}
    if(taken){ alert('"'+name+'" already exists in '+(dest.path?dest.path.slice(0,-1):dest.name)+'.'); return null; }
  }
  const inside=insideOf(path,isDir), reloc=isDir?relocateDir:relocateFile;
  vx.busy++;
  try{
    for(const d of inside) if(d.dirty&&d.handle) await writeDoc(d).catch(()=>{});
    let h=src.handle;
    if(caseOnly){ const tmp=await freeName(dest.handle,'~'+name); h=await reloc(h,from.handle,dest.handle,tmp); }
    h=await reloc(h,caseOnly?dest.handle:from.handle,dest.handle,name);
    for(const d of inside){
      const np=newPath+d.wsPath.slice(path.length);
      try{ const nh=isDir?await handleAt(np):h; d.handle=nh; d.wsPath=np; d.name=nh.name; d.mtime=(await nh.getFile()).lastModified; idb.set('handles',d.id,nh); }catch(e){ d.wsPath=null; }
    }
    for(const [p,e] of [...vx.notes]) if(isDir?p.startsWith(path):p===path){ vx.notes.delete(p); const np=newPath+p.slice(path.length); vx.notes.set(np,Object.assign(e,{path:np,name:np.slice(np.lastIndexOf('/')+1),handle:null})); }
    if(isDir) for(const p of [...exp]) if(p.startsWith(path)){ exp.delete(p); exp.add(newPath+p.slice(path.length)); }
    exp.add(destPath); if(fsel===path) fsel=newPath;
  }catch(e){ console.error(e); if(e.name!=='AbortError') alert('Could not move "'+src.name+'": '+e.message); vx.busy--; requestScan(true,null,0); return null; }
  vx.busy--;
  renderTabsAll(); renderBacklinksAll(); requestScan(false,null,0); return newPath;
}
async function trashEntry(path){
  const isDir=path.endsWith('/'), src=nodeAt(path), from=vx.dirs.get(parentOf(path)); if(!path||!src||!from||!vx.perm) return;
  const inside=insideOf(path,isDir), dirty=inside.filter(d=>d.dirty).length;
  if(!confirm('Move "'+(isDir?src.name:labelOf(src.name))+'"'+(isDir?' and everything in it':'')+' to the .trash folder?'+(dirty?' Unsaved changes in '+dirty+' open tab'+(dirty>1?'s':'')+' will be lost.':''))) return;
  vx.busy++;
  try{
    const trash=await ws.dir.getDirectoryHandle('.trash',{create:true}), name=await freeName(trash,src.name);
    for(const d of inside) removeDoc(d);
    await (isDir?relocateDir:relocateFile)(src.handle,from.handle,trash,name);
    for(const p of [...vx.notes.keys()]) if(isDir?p.startsWith(path):p===path) vx.notes.delete(p);
    if(isDir) for(const p of [...exp]) if(p.startsWith(path)) exp.delete(p);
    if(fsel&&(isDir?fsel.startsWith(path):fsel===path)) fsel=null;
  }catch(e){ console.error(e); alert('Could not delete "'+src.name+'": '+e.message); }
  vx.busy--;
  renderBacklinksAll(); renderAgendaAll(); requestScan(false,null,0);
}
async function newNoteIn(node){
  if(!vx.root) return; node=node||vx.root;
  const p=await A().newTab(null,null,null,node); if(p){ renderTree(); selectRow(p); startTreeRename(p); }
}
async function newFolderIn(node){
  if(!vx.root||!vx.perm) return; node=node||vx.root;
  try{
    const name=await freeName(node.handle,'New folder'), h=await node.handle.getDirectoryHandle(name,{create:true}), path=node.path+name+'/';
    const nd={path,name,handle:h,dirs:[],files:[]}; node.dirs.push(nd); node.dirs.sort(byName); vx.dirs.set(path,nd); exp.add(node.path);
    renderTree(); selectRow(path); startTreeRename(path); requestScan(false,null,2000);
  }catch(e){ console.error(e); alert('Could not create the folder: '+e.message); }
}
