'use strict';
/* ---------- settings ---------- */
function applySettings(){
  const root=document.documentElement;
  if(settings.theme==='system') delete root.dataset.theme; else root.dataset.theme=settings.theme;
  if(settings.font==='system') delete root.dataset.font; else root.dataset.font=settings.font;
  for(const p of panes) p.applySpell();
  const test=$('setSpellTest'); if(settings.lang) test.lang=settings.lang; else test.removeAttribute('lang');
}
function openSettings(){
  $('setTheme').value=settings.theme; $('setFont').value=settings.font; $('setSpell').value=settings.spell?'on':'off'; $('setLang').value=settings.lang; $('setSync').value=settings.sync?'on':'off'; $('setAutosave').value=settings.autosave?'on':'off';
  settingsDlg.showModal();
}
$('setTheme').addEventListener('change',e=>{ settings.theme=e.target.value; applySettings(); scheduleDraft(); });
$('setFont').addEventListener('change',e=>{ settings.font=e.target.value; applySettings(); scheduleDraft(); });
$('setSpell').addEventListener('change',e=>{ settings.spell=e.target.value==='on'; applySettings(); scheduleDraft(); });
$('setSync').addEventListener('change',e=>{ settings.sync=e.target.value==='on'; syncStart(); scheduleDraft(); });
$('setAutosave').addEventListener('change',e=>{ settings.autosave=e.target.value==='on'; scheduleAutosave(); scheduleDraft(); });
$('setLang').addEventListener('change',e=>{ settings.lang=e.target.value.trim(); applySettings(); scheduleDraft(); });

/* ---------- zoom ---------- */
function setZoom(z){ z=Math.round(Math.max(0.5,Math.min(3,z))*100)/100; settings.zoom=z; document.documentElement.style.setProperty('--zoom',z); scheduleDraft(); }
/* sticky outline and scroll margins follow the real header height */
new ResizeObserver(()=>{ document.documentElement.style.setProperty('--hdr',headerEl.offsetHeight+'px'); for(const p of panes) p.scheduleCrumb(); }).observe(headerEl);
window.addEventListener('wheel',e=>{ if(e.ctrlKey){ e.preventDefault(); setZoom(settings.zoom+(e.deltaY<0?0.1:-0.1)); } },{passive:false});

/* ---------- global keys: they act on the active pane ---------- */
document.addEventListener('keydown',e=>{
  const mod=e.ctrlKey||e.metaKey, P=A(); if(!P) return;
  if(e.key==='F1'){ e.preventDefault(); toggleHelp(); return; }
  if(e.key==='Escape'&&P.agendaOn()&&!pal.open){ e.preventDefault(); P.setAgenda(false); return; }
  const inField=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA'||e.target.tagName==='SELECT';
  if(e.altKey&&!mod){
    const k=e.key.toLowerCase();
    if(k==='n'){ e.preventDefault(); P.newTab(); }
    else if(k==='w'){ e.preventDefault(); P.closeTab(P.cur); }
    else if(k==='f'||k==='e'||k==='v'){ e.preventDefault(); const name={f:'file',e:'edit',v:'view'}[k]; showMenu(name,menubar.querySelector('[data-menu="'+name+'"]'),true); }
    else if((e.key==='ArrowUp'||e.key==='ArrowDown')&&!inField&&!P.sourceOn()&&!P.agendaOn()){ e.preventDefault(); P.withSel(s=>P.moveBlock(s,e.key==='ArrowUp'?-1:1)); }
    else if((e.key==='ArrowLeft'||e.key==='ArrowRight')&&!inField&&!P.sourceOn()&&!P.agendaOn()){ e.preventDefault(); P.withSel(s=>e.key==='ArrowLeft'?P.collapseCurrent(s):P.expandCurrent(s)); }
    else if(e.key==='PageUp'||e.key==='PageDown'){ e.preventDefault(); const d=e.key==='PageUp'?-1:1; if(e.shiftKey) P.moveTab(P.cur,d); else P.cycleTab(d); }
    else if(/^[1-9]$/.test(e.key)&&P.docs[+e.key-1]){ e.preventDefault(); P.switchTab(+e.key-1); }
    return;
  }
  if(!mod) return;
  /* Ctrl+Tab reaches the page only where the browser does not keep it for itself (an installed app, for instance); Alt+PgUp/PgDn always works */
  if(e.key==='Tab'){ e.preventDefault(); P.cycleTab(e.shiftKey?-1:1); return; }
  if(e.key==='PageUp'||e.key==='PageDown'){ if(e.shiftKey){ e.preventDefault(); P.moveTab(P.cur,e.key==='PageUp'?-1:1); } return; }
  if(e.altKey&&(e.key==='ArrowLeft'||e.key==='ArrowRight')){ e.preventDefault(); if(e.key==='ArrowLeft') P.goBack(); else P.goForward(); return; }
  const k=e.key.toLowerCase();
  if(k==='s'){ e.preventDefault(); P.saveFile(e.shiftKey); }
  else if(k==='o'&&!e.shiftKey){ e.preventDefault(); openFile(); }
  else if(k==='o'&&e.shiftKey){ e.preventDefault(); viewToggle('outline')(); }
  else if(k==='e'&&e.shiftKey){ e.preventDefault(); toggleFiles(); }
  else if(k==='p'&&!e.shiftKey){ e.preventDefault(); window.print(); }
  else if(k==='p'&&e.shiftKey){ e.preventDefault(); if(pal.open) closePalette(true); else openPalette(); }
  else if(k==='a'&&e.shiftKey){ e.preventDefault(); P.setAgenda(!P.agendaOn()); }
  else if(k==='d'&&!e.shiftKey&&!inField&&!P.sourceOn()&&!P.agendaOn()){ e.preventDefault(); P.withSel(P.duplicateLines); }
  else if(k==='f'&&!e.shiftKey){ e.preventDefault(); P.openFind(false); }
  else if(k==='f'&&e.shiftKey){ e.preventDefault(); toggleFilterBar(); }
  else if(k==='h'&&!e.shiftKey){ e.preventDefault(); P.openFind(true); }
  else if(e.key==='\\'||e.code==='Backslash'){ e.preventDefault(); splitPane(P,'row'); }
  else if(k==='/'||e.key==='?'){ e.preventDefault(); toggleHelp(); }
  else if(e.key==='='||e.key==='+'){ e.preventDefault(); setZoom(settings.zoom+0.1); }
  else if(e.key==='-'||e.key==='_'){ e.preventDefault(); setZoom(settings.zoom-0.1); }
  else if(e.key==='0'){ e.preventDefault(); setZoom(1); }
  else if((k==='z'||k==='y')&&!inField){ e.preventDefault(); if(k==='y'||e.shiftKey) P.doRedo(); else P.doUndo(); }
});

/* ---------- files ---------- */
const TYPES=[{description:'Markdown',accept:{'text/markdown':['.md','.markdown','.txt']}}];
async function openFile(){
  if(window.showOpenFilePicker){
    try{ const hs=await showOpenFilePicker({types:TYPES,multiple:true}); await openHandles(hs); }
    catch(e){ if(e.name!=='AbortError') console.error(e); }
  } else { fileInput.value=''; fileInput.click(); }
}
fileInput.addEventListener('change',async()=>{ for(const f of [...fileInput.files]) await A().openInto(await f.text(),f.name,null,{mtime:f.lastModified}); });
/* one file opens into the current blank tab or a new one; several open as tabs in one go */
async function openHandles(hs){
  if(hs.length===1){ const f=await hs[0].getFile(); await A().openInto(await f.text(),f.name,hs[0],{mtime:f.lastModified}); return; }
  const {items,failed}=await readHandles(hs); await A().addDocs(items,false);
  if(failed.length) alert('Could not open '+failed.join(', ')+'.');
}
function download(name,text,type){ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([text],{type})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000); }
document.addEventListener('dragover',e=>{
  if(![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); document.body.classList.add('drag');
  const m=e.target.closest&&e.target.closest('.pane>.main'); document.querySelectorAll('.main.drop').forEach(x=>{ if(x!==m) x.classList.remove('drop'); }); if(m) m.classList.add('drop');
});
document.addEventListener('dragleave',e=>{ if(!e.relatedTarget){ document.body.classList.remove('drag'); document.querySelectorAll('.main.drop').forEach(x=>x.classList.remove('drop')); } });
/* files dropped on the page open as tabs, a folder opens as the folder, and images dropped on a note go into it */
document.addEventListener('drop',async e=>{
  document.body.classList.remove('drag'); document.querySelectorAll('.main.drop').forEach(x=>x.classList.remove('drop'));
  const files=[...(e.dataTransfer.files||[])]; if(!files.length) return;
  e.preventDefault();
  /* handles must be requested before the first await, while the drop data is still live */
  const hps=[...(e.dataTransfer.items||[])].map(it=>it&&it.getAsFileSystemHandle?it.getAsFileSystemHandle().catch(()=>null):null);
  const m=e.target.closest&&e.target.closest('.pane>.main'), pane=m?panes.find(p=>p.main===m):null, y=e.clientY;
  const isImg=f=>/^image\//.test(f.type)||IMG_EXT.test(f.name), items=[], imgs=[];
  for(let k=0;k<files.length;k++){
    if(isImg(files[k])){ if(pane) imgs.push(files[k]); continue; }
    const h=hps[k]?await hps[k]:null;
    if(h&&h.kind==='directory'){ await openVault(h); continue; }
    items.push({name:files[k].name,text:await files[k].text(),handle:h&&h.kind==='file'?h:null,mtime:files[k].lastModified});
  }
  if(imgs.length){ setActive(pane); await pane.insertImages(imgs,null,pane.rowAt(y)); }
  if(items.length===1) await A().openInto(items[0].text,items[0].name,items[0].handle,{mtime:items[0].mtime});
  else if(items.length) await A().addDocs(items,false);
});

/* ---------- persistence and init ---------- */
function scheduleDraft(){ clearTimeout(draftTimer); draftTimer=setTimeout(saveDraft,300); }
const docState=d=>({id:d.id,name:d.name,text:serializeLines(d.lines),collapsed:d.lines.map((l,i)=>l.collapsed?i:-1).filter(i=>i>=0),dirty:d.dirty,created:d.created||undefined,pinned:d.pinned||undefined,ctime:d.ctime||undefined});
function saveDraft(){
  try{ localStorage.setItem(KEY,JSON.stringify({settings,ws:{key:ws.key,name:ws.name,autoKey:ws.autoKey,exp:[...exp]},
    docs:allDocs().map(docState),panes:panes.map(p=>({tabs:p.docs.map(d=>d.id),cur:p.cur,size:p.size||0})),layout:{dir:layout.dir,active:Math.max(0,panes.indexOf(activePane))}})); }catch(e){}
}
/* the saved state: docs, and which pane holds which of them; older drafts had one list of docs and a current index */
function loadDraft(){
  try{
    const s=JSON.parse(localStorage.getItem(KEY)); if(!s||!Array.isArray(s.docs)||!s.docs.length) return null;
    const byId=new Map();
    const docs=s.docs.map(x=>{ const d=newDoc(x.name,x.text); if(x.id) d.id=x.id; (x.collapsed||[]).forEach(i=>{ if(d.lines[i]) d.lines[i].collapsed=true; }); d.dirty=!!x.dirty; d.created=!!x.created; d.pinned=!!x.pinned; d.ctime=typeof x.ctime==='number'?x.ctime:fmCreated(x.text||''); d.indentUnit=detectIndent(d.lines); byId.set(d.id,d); return d; });
    const st=s.settings||s; for(const k of Object.keys(settings)) if(k!=='filter'&&st[k]!==undefined&&typeof st[k]===typeof settings[k]) settings[k]=st[k];
    if(!FSORTS.some(x=>x[0]===settings.fsort)) settings.fsort='az';
    const f=Object.assign({on:false},FILTER_DEFAULTS,(st.filter&&typeof st.filter==='object')?st.filter:{});
    if(!Array.isArray(f.tags)) f.tags=[]; f.tags=f.tags.filter(t=>typeof t==='string');
    if(!['all','open','done'].includes(f.status)) f.status='all';
    if(!['any','due','overdue','today','week','has','none'].includes(f.due)) f.due='any';
    if(!['any','1','2','3'].includes(f.pri)) f.pri='any';
    if(st.today===true){ f.on=true; f.status='open'; f.due='due'; }
    settings.filter=f;
    if(s.ws&&typeof s.ws==='object'){ ws.key=typeof s.ws.key==='string'?s.ws.key:null; ws.name=typeof s.ws.name==='string'?s.ws.name:''; ws.autoKey=typeof s.ws.autoKey==='string'?s.ws.autoKey:null; if(Array.isArray(s.ws.exp)) exp=new Set(s.ws.exp.filter(p=>typeof p==='string')); }
    const paneSpecs=[];
    if(Array.isArray(s.panes)) for(const p of s.panes){ const tabs=(p.tabs||[]).map(id=>byId.get(id)).filter(Boolean); if(tabs.length) paneSpecs.push({tabs,cur:p.cur|0,size:+p.size||0}); }
    const placed=new Set(paneSpecs.flatMap(p=>p.tabs)), loose=docs.filter(d=>!placed.has(d));
    if(!paneSpecs.length) paneSpecs.push({tabs:loose,cur:s.cur|0,size:0}); else if(loose.length) paneSpecs[0].tabs.push(...loose);
    const lay=s.layout&&typeof s.layout==='object'?s.layout:{}; layout.dir=lay.dir==='col'?'col':'row';
    return {docs,paneSpecs,active:lay.active|0};
  }catch(e){ return null; }
}
async function init(){
  let st=loadDraft();
  if(!st){
    let old=null, d; try{ old=JSON.parse(localStorage.getItem(OLDKEY)); }catch(e){}
    if(old&&typeof old.text==='string'){ d=newDoc(old.name,old.text); d.dirty=!!old.dirty; d.indentUnit=detectIndent(d.lines); } else d=newDoc('Welcome.md',WELCOME);
    st={docs:[d],paneSpecs:[{tabs:[d],cur:0,size:0}],active:0};
  }
  applySettings(); setZoom(settings.zoom); setFw(settings.fw);
  for(const spec of st.paneSpecs){ const p=makePane(uid()); p.size=spec.size; panes.push(p); }
  layoutPanes();
  st.paneSpecs.forEach((spec,k)=>panes[k].init(spec.tabs,spec.cur));
  setActive(panes[st.active]||panes[0]);
  renderTree();
  /* the tabs' file handles come first, so the folder scan can tell which tabs are its notes */
  await Promise.all(st.docs.map(d=>idb.get('handles',d.id).then(h=>{ if(h) d.handle=h; })));
  /* when each file was last written, for the line under the title; a file that cannot be read yet is left alone */
  await Promise.all(st.docs.map(async d=>{ if(!d.handle||d.mtime!=null) return; try{ if((await d.handle.queryPermission({mode:'read'}))!=='granted') return; d.mtime=(await d.handle.getFile()).lastModified; }catch(e){} }));
  renderTabsAll(); loadRecent(); idb.del('handles','wsdir');
  await restoreVault();
  await refreshWorkspaces(); renderTabsAll();
}
const initDone=init();

/* ---------- PWA: offline shell, file handling, shortcuts ---------- */
if("serviceWorker" in navigator&&location.protocol!=="file:"){
  window.addEventListener("load",async()=>{
    try{
      const reg=await navigator.serviceWorker.register("sw.js");
      // A new version is applied as soon as it is ready; the page only reloads when nothing is unsaved
      // (drafts are already in localStorage, so a reload never loses work either way).
      const promote=w=>{ if(w) w.postMessage({type:"SKIP_WAITING"}); };
      promote(reg.waiting);
      reg.addEventListener("updatefound",()=>{ const w=reg.installing; if(!w) return; w.addEventListener("statechange",()=>{ if(w.state==="installed"&&navigator.serviceWorker.controller) promote(w); }); });
      let reloaded=false;
      navigator.serviceWorker.addEventListener("controllerchange",()=>{ if(reloaded) return; reloaded=true; if(!allDocs().some(d=>d.dirty)) location.reload(); });
    }catch(e){ console.warn("Service worker not registered:",e); }
  });
}
// File › Install app… uses the browser's install prompt when one has been offered; otherwise it explains how to install here.
let installPrompt=null;
window.addEventListener("beforeinstallprompt",e=>{ e.preventDefault(); installPrompt=e; });
window.addEventListener("appinstalled",()=>{ installPrompt=null; });
function isInstalled(){ return matchMedia("(display-mode: standalone)").matches||matchMedia("(display-mode: window-controls-overlay)").matches||navigator.standalone===true; }
async function installApp(){
  const p=installPrompt;
  if(p){ installPrompt=null; try{ await p.prompt(); const {outcome}=await p.userChoice; if(outcome!=="accepted") installPrompt=p; }catch(e){ console.warn(e); } return; }
  if(location.protocol==="file:"){ alert("Installing needs PowerNotes served from a web server over https or localhost, not opened from a file. Any static server works, then use File › Install app… from there."); return; }
  const ua=navigator.userAgent, safari=/Safari/.test(ua)&&!/Chrom|Edg/.test(ua), firefox=/Firefox/.test(ua);
  alert(safari?"In Safari, use Share › Add to Dock (Mac) or Add to Home Screen (iPhone and iPad) to install PowerNotes."
    :firefox?"Firefox on desktop does not install web apps. On Android, use the browser menu › Install."
    :"Your browser has not offered to install yet. Look for the install icon at the right end of the address bar, or use the browser menu › Save and share › Install PowerNotes. If PowerNotes is already installed, open it from your apps instead.");
}
// Files opened from the OS (manifest file_handlers) arrive here with a live handle, so Save writes back to disk.
if("launchQueue" in window&&"files" in LaunchParams.prototype){
  launchQueue.setConsumer(async p=>{
    await initDone;
    for(const h of p.files||[]){ try{ const f=await h.getFile(); await A().openInto(await f.text(),f.name,h,{mtime:f.lastModified}); }catch(e){ console.error(e); } }
  });
}
// App shortcut: "New note" opens with a fresh tab; the query is then dropped so a reload does not repeat it.
if(new URLSearchParams(location.search).has("new")) initDone.then(()=>{ A().newTab(); history.replaceState(null,"",location.pathname); });
