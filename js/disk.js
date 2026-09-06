'use strict';
/* ---------- renaming a file on disk, and the folders that makes it possible ---------- */
async function renameOnDisk(d,name){
  const h=d.handle, old=d.name;
  const finish=async nh=>{ d.handle=nh; d.name=nh.name||name; idb.set('handles',d.id,nh); renderBacklinksAll(); renderTabsAll(); scheduleDraft(); await addRecent(nh,d.name); await dropRecent(old,nh); return 'done'; };
  /* 1. permission to change the file itself */
  if(!(await ensurePerm(h,'readwrite'))){
    const a=await askAccess({title:'Allow access to '+old,msg:'PowerNotes needs your permission to change "'+old+'" before it can rename it on disk.',ok:'Allow access',alt:'Rename tab only'});
    if(a!=='ok') return a==='alt'?'tabonly':'cancel';
    if(!(await ensurePerm(h,'readwrite'))){ alert('Access was not granted, so "'+old+'" keeps its name.'); return 'cancel'; }
  }
  /* 2. rename in place where the browser supports it */
  if(typeof h.move==='function'){ try{ await h.move(name); return finish(h); }catch(e){ if(e.name==='AbortError') return 'cancel'; } }
  /* 3. find the folder that holds the file, asking for it when no known folder does */
  let parent=await findParent(h), where=null;
  while(!parent){
    const a=await askAccess({title:'Choose the folder that contains '+old,
      msg:where?'"'+old+'" is not inside "'+where+'". Choose the folder that contains it.'
               :'The browser can only rename a file through its folder. Choose the folder that contains "'+old+'" and PowerNotes will remember it for next time.',
      hint:'The picker opens at the file\'s location, so you can usually just choose Select Folder.',ok:'Choose folder…',alt:'Rename tab only'});
    if(a!=='ok') return a==='alt'?'tabonly':'cancel';
    const r=await pickParent(h); if(!r) return 'cancel';
    parent=r.parent; where=r.dir.name;
  }
  /* 4. write the file under its new name, then remove the old one */
  try{
    let exists=null; try{ exists=await parent.getFileHandle(name); }catch(e){}
    const same=exists?await exists.isSameEntry(h).catch(()=>false):false;
    if(exists&&!same&&!confirm('"'+name+'" already exists in '+parent.name+'. Replace it?')) return 'cancel';
    flushDoc(d);
    const nh=await parent.getFileHandle(name,{create:true}); const w=await nh.createWritable(); await w.write(serializeLines(d.lines)); await w.close();
    if(!same) await parent.removeEntry(h.name);
    d.dirty=false; return finish(nh);
  }catch(e){ console.error(e); alert('Could not rename the file: '+e.message); return 'cancel'; }
}
/* the directory handle directly containing h, reached from dir, or null */
async function descend(dir,h){
  let path=null; try{ path=await dir.resolve(h); }catch(e){ return null; }
  if(!path) return null;
  let p=dir; try{ for(const seg of path.slice(0,-1)) p=await p.getDirectoryHandle(seg); }catch(e){ return null; }
  return p;
}
async function knownDirs(){ const v=await idb.get('handles','dirs').catch(()=>null); return Array.isArray(v)?v:[]; }
async function rememberDir(dir){
  const dirs=await knownDirs(); for(const k of dirs) if(await k.isSameEntry(dir).catch(()=>false)) return;
  dirs.unshift(dir); await idb.set('handles','dirs',dirs.slice(0,12));
}
/* the open folder first, then folders granted before; a folder that is not already permitted is asked about,
   which is fine here because this runs inside the click or keypress that started the rename */
async function findParent(h){
  const cands=ws.dir?[ws.dir]:[]; for(const k of await knownDirs()) if(!ws.dir||!(await k.isSameEntry(ws.dir).catch(()=>false))) cands.push(k);
  for(const dir of cands){ if(await ensurePerm(dir,'readwrite')){ const p=await descend(dir,h); if(p) return p; } }
  return null;
}
/* asks the user for the folder; opens at the file itself. Returns {dir,parent} (parent null when the file is not in dir), or null when cancelled */
async function pickParent(h){
  if(!window.showDirectoryPicker){ alert('This browser cannot open folders, so the file keeps its name.'); return null; }
  let dir=null;
  try{ dir=await showDirectoryPicker({mode:'readwrite',startIn:h}); }
  catch(e){ if(e.name==='AbortError') return null; try{ dir=await showDirectoryPicker({mode:'readwrite'}); }catch(e2){ return null; } }
  rememberDir(dir);
  return {dir,parent:await descend(dir,h)};
}
/* a small modal with a primary action, an optional alternative and Cancel; resolves 'ok', 'alt' or 'cancel'.
   The button click is what gives the following permission request or picker its user gesture */
function askAccess({title,msg,hint,ok,alt}){
  return new Promise(res=>{
    $('accessTitle').textContent=title; $('accessMsg').textContent=msg;
    const hp=$('accessHint'); hp.textContent=hint||''; hp.hidden=!hint;
    const bOk=$('accessOk'), bAlt=$('accessAlt'), bCancel=$('accessCancel'); bOk.textContent=ok; bAlt.textContent=alt||''; bAlt.hidden=!alt;
    /* settled straight from the buttons and Escape: the dialog's own close event can arrive late in a hidden tab */
    let settled=false; const fin=v=>{ if(settled) return; settled=true; if(accessDlg.open) accessDlg.close(); res(v); };
    bOk.onclick=()=>fin('ok'); bAlt.onclick=()=>fin('alt'); bCancel.onclick=()=>fin('cancel');
    accessDlg.oncancel=e=>{ e.preventDefault(); fin('cancel'); };
    accessDlg.onclose=()=>{ if(!accessDlg.open) fin('cancel'); };
    hideMenu(); accessDlg.showModal(); bOk.focus();
  });
}
async function dropRecent(name,keep){
  await loadRecent();
  for(const r of recent) if(r.name===name&&!(await r.handle.isSameEntry(keep).catch(()=>false))) await idb.del('recent',r.key);
  await loadRecent();
}
function isBlank(d){ return !d.dirty&&!d.handle&&d.lines.length===1&&d.lines[0].text===''; }
async function sameFile(a,b){ return a===b||(a.name===b.name&&await a.isSameEntry(b).catch(()=>false)); }
