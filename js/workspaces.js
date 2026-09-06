'use strict';
/* ---------- workspaces: a folder with the tabs open in it, or a chosen set of files from anywhere ----------
   A workspace is kept in IndexedDB as the folder handle, the paths of the tabs open from it, and the file handles
   of tabs from elsewhere. Every folder that is opened gets an entry of its own (auto), brought up to date whenever
   the folder is left, so choosing the folder again brings its tabs back. Workspaces saved by name are snapshots. */
async function refreshWorkspaces(){
  const v=await idb.all('workspaces'), k=await idb.keys('workspaces');
  workspaces=(v||[]).map((w,i)=>Object.assign({key:k[i]},w)).filter(w=>w&&w.name).sort((a,b)=>(a.auto?1:0)-(b.auto?1:0)||(a.auto?(b.t||0)-(a.t||0):a.name.localeCompare(b.name,undefined,{sensitivity:'base'})));
  if(ws.key&&!workspaces.some(w=>w.key===ws.key)) ws.key=null;
}
const namedWs=()=>workspaces.filter(w=>!w.auto), folderWs=()=>workspaces.filter(w=>w.auto);
async function autoKeyFor(dir){ if(!dir) return null; await refreshWorkspaces(); for(const w of folderWs()) if(w.dir&&await w.dir.isSameEntry(dir).catch(()=>false)) return w.key; return null; }
/* like ensurePerm, but when the browser wants a fresh click before it will show its prompt (one prompt per click),
   a small dialog supplies one. true, false, or null when the user cancelled outright */
async function grantHandle(h,mode,what){
  try{ if((await h.queryPermission({mode}))==='granted') return true; }catch(e){ return false; }
  let r=null; try{ r=await h.requestPermission({mode}); }catch(e){}
  if(r==='granted') return true; if(r==='denied') return false;
  const a=await askAccess({title:'Allow access to '+h.name,msg:'PowerNotes needs your permission to open '+(what||'"'+h.name+'"')+'.',ok:'Allow access',alt:'Skip it'});
  if(a!=='ok') return a==='alt'?false:null;
  try{ return (await h.requestPermission({mode}))==='granted'; }catch(e){ return false; }
}
/* takes handles or {path,handle} entries; the path says where the file sits in the folder */
async function readHandles(list){
  const items=[], failed=[];
  for(const n of list){ const h=n.handle||n; try{ const f=await h.getFile(); items.push({name:f.name,text:await f.text(),handle:h,path:n.handle?n.path:undefined,mtime:f.lastModified}); }catch(e){ failed.push(h.name); } }
  return {items,failed};
}
/* closes every tab that has nothing unsaved, in every pane; tabs with changes stay, so nothing is lost */
function closeCleanTabs(){ for(const p of panes.slice().sort((a,b)=>(a===activePane)-(b===activePane))) if(panes.includes(p)) p.closeClean(); }
/* the tabs that are files on disk, in tab order, leaving out those inside dir since their paths are kept instead */
async function wsFiles(dir){
  const out=[];
  for(const d of allDocs()){ if(!d.handle) continue; let inDir=false; if(dir){ try{ inDir=!!(await dir.resolve(d.handle)); }catch(e){} } if(!inDir) out.push(d.handle); }
  return out;
}
/* remembers the open folder's tabs under the folder itself */
async function stashSession(){
  if(!ws.dir||!A()) return;
  const paths=allDocs().filter(d=>d.wsPath).map(d=>d.wsPath), files=await wsFiles(ws.dir);
  const key=ws.autoKey||await autoKeyFor(ws.dir)||('auto-'+uid());
  await idb.set('workspaces',key,{name:ws.dir.name,dir:ws.dir,files,paths,curName:A().D().name,t:Date.now(),auto:true});
  ws.autoKey=key; await refreshWorkspaces();
}
/* the tabs a folder had when it was last left; files from elsewhere come back only if they need no new permission */
async function restoreSession(dir){
  const key=await autoKeyFor(dir); ws.autoKey=key; if(!key) return;
  const w=workspaces.find(x=>x.key===key); if(!w) return;
  await openPaths(w,false);
}
async function openPaths(w,loud){
  const items=[], failed=[];
  for(const p of w.paths||[]){ try{ const h=await handleAt(p), f=await h.getFile(); items.push({name:f.name,text:await f.text(),handle:h,path:p,mtime:f.lastModified}); }catch(e){ failed.push(p); } }
  for(const h of w.files||[]){ let ok=false; try{ ok=(await h.queryPermission({mode:'read'}))==='granted'; }catch(e){} if(!ok){ failed.push(h.name); continue; } try{ const f=await h.getFile(); items.push({name:f.name,text:await f.text(),handle:h,mtime:f.lastModified}); }catch(e){ failed.push(h.name); } }
  if(items.length) await A().addDocs(items);
  if(w.curName){ const d=allDocs().find(d=>d.name===w.curName); if(d) focusDoc(d); }
  if(loud&&failed.length) alert('Not opened: '+failed.join(', ')+'. Files may have been moved or deleted, or need permission again (File › Open…).');
}
async function saveWorkspace(as){
  const dir=ws.dir, files=await wsFiles(dir), paths=allDocs().filter(d=>d.wsPath).map(d=>d.wsPath), loose=allDocs().filter(d=>!d.handle&&!isBlank(d));
  if(!dir&&!files.length){ alert('Nothing to put in a workspace yet: open a folder or some files, or save this tab to disk, first.'); return; }
  if(loose.length){
    const many=loose.length>1, them=many?'them':'it';
    const a=await askAccess({title:'Some tabs are not files yet',msg:'"'+loose[0].name+'"'+(many?' and '+(loose.length-1)+' more':'')+' ha'+(many?'ve':'s')+' never been saved to disk, so the workspace cannot bring '+them+' back. Save with Ctrl+S first to keep '+them+'.',ok:'Save workspace anyway'});
    if(a!=='ok') return;
  }
  let key=ws.key, name=ws.name;
  if(as||!key){
    const v=prompt('Workspace name',name||(dir?dir.name:'')); if(v===null) return; name=v.trim(); if(!name) return;
    await refreshWorkspaces(); const dup=namedWs().find(w=>w.name.toLowerCase()===name.toLowerCase());
    if(dup){ if(dup.key!==ws.key&&!confirm('A workspace called "'+dup.name+'" already exists. Replace it?')) return; key=dup.key; } else key=uid();
  }
  await idb.set('workspaces',key,{name,dir:dir||null,files,paths,curName:A().D().name,t:Date.now()});
  await refreshWorkspaces(); ws.key=key; ws.name=name; renderTabsAll(); scheduleDraft();
}
async function openWorkspace(w){
  if(w.dir&&!(await grantHandle(w.dir,'readwrite','the folder "'+w.dir.name+'"'))) return;
  if(!w.auto) for(const h of w.files||[]){ const g=await grantHandle(h,'read'); if(g===null) return; }
  await stashSession(); closeCleanTabs();
  if(w.auto){ setWs(null,w.dir?w.dir.name:w.name,w.dir||null); ws.autoKey=w.key; }
  else { setWs(w.key,w.name,w.dir||null); ws.autoKey=await autoKeyFor(w.dir); }
  await openPaths(w,true); renderTabsAll(); scheduleDraft();
}
async function deleteWorkspace(w){
  if(!confirm(w.auto?'Forget the folder "'+w.name+'" and the tabs remembered for it? The folder itself stays on disk.':'Forget the workspace "'+w.name+'"? Its files stay on disk.')) return;
  await idb.del('workspaces',w.key); if(ws.autoKey===w.key) ws.autoKey=null; await refreshWorkspaces(); renderTabsAll(); scheduleDraft();
}
async function renameWorkspace(w){
  const v=prompt('Workspace name',w.name); if(v===null) return; const name=v.trim(); if(!name||name===w.name) return;
  const {key,...rest}=w; await idb.set('workspaces',key,Object.assign(rest,{name})); if(ws.key===key){ ws.name=name; renderTabsAll(); scheduleDraft(); }
  await refreshWorkspaces();
}
function workspaceMenu(){
  const items=[], nm=namedWs(), fw=folderWs();
  items.push({h:'Workspaces'});
  if(nm.length) items.push(...nm.slice(0,12).map(w=>({l:w.name,chk:w.key===ws.key,f:()=>openWorkspace(w)}))); else items.push({l:'None saved yet',dis:true});
  if(fw.length) items.push({h:'Folders'},...fw.slice(0,10).map(w=>({l:w.name,chk:!!ws.autoKey&&w.key===ws.autoKey,f:()=>openWorkspace(w)})));
  items.push('-',{l:'Open folder…',f:()=>openVault(null)});
  if(ws.key) items.push({l:'Save workspace',f:()=>saveWorkspace(false)});
  items.push({l:ws.key?'Save workspace as…':'Save tabs as a workspace…',f:()=>saveWorkspace(true)});
  items.push({l:'Manage workspaces…',f:openWsDialog,dis:!workspaces.length});
  items.push('-',{l:'Close folder',f:closeVault,dis:!ws.dir});
  return items;
}

function openWsDialog(){
  const list=$('wsList'); list.replaceChildren();
  for(const w of workspaces){
    const li=el('li'), n=el('span','n'), b=el('b'); b.textContent=w.name; n.append(b); if(w.dir&&!w.auto&&w.dir.name!==w.name) n.append(' · '+w.dir.name);
    const tabs=(w.paths||[]).length+(w.files||[]).length, k=el('span','k'); k.textContent=(w.auto?'Folder':'Workspace')+' · '+tabs+' tab'+(tabs===1?'':'s')+((w.auto?w.key===ws.autoKey:w.key===ws.key)?' · open':'');
    const mk=(t,f)=>{ const x=el('button','btn'); x.type='button'; x.textContent=t; x.onclick=f; return x; };
    li.append(n,k,mk('Open',()=>{ wsDlg.close(); openWorkspace(w); }),mk('Rename',async()=>{ await renameWorkspace(w); openWsDialog(); }),mk('Forget',async()=>{ await deleteWorkspace(w); openWsDialog(); }));
    list.append(li);
  }
  if(!workspaces.length){ const li=el('li'); li.textContent='Nothing remembered yet.'; list.append(li); }
  if(!wsDlg.open){ hideMenu(); wsDlg.showModal(); }
}
