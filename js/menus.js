'use strict';
/* ---------- menus ---------- */
function viewToggle(key){ return ()=>{ settings[key]=!settings[key]; renderAll(); A().restoreSel(); scheduleDraft(); }; }
const recentMenu=()=>recent.slice(0,10).map(r=>({l:r.name,f:()=>openRecent(r)}));
/* the tab actions that are not everyday: history, order, pinning */
function tabsMenu(){ const P=A(); return [
  {l:'Back',sc:'Ctrl+Alt+←',f:()=>P.goBack(),dis:!P.canBack()},
  {l:'Forward',sc:'Ctrl+Alt+→',f:()=>P.goForward(),dis:!P.canFwd()},
  {l:'Reopen closed tab',sc:'Ctrl+Shift+T',f:reopenClosed,dis:!closedTabs.length},
  '-',
  {l:'Next tab',sc:'Ctrl+Tab',f:()=>P.cycleTab(1),dis:P.docs.length<2},
  {l:'Previous tab',sc:'Ctrl+Shift+Tab',f:()=>P.cycleTab(-1),dis:P.docs.length<2},
  {l:'Move tab left',sc:'Ctrl+Shift+PgUp',f:()=>P.moveTab(P.cur,-1),dis:P.cur===0},
  {l:'Move tab right',sc:'Ctrl+Shift+PgDn',f:()=>P.moveTab(P.cur,1),dis:P.cur>=P.docs.length-1},
  '-',
  {l:P.D().pinned?'Unpin tab':'Pin tab',f:()=>P.togglePin(P.cur)},
  {l:'Close other tabs',f:()=>P.closeOthers(P.cur),dis:P.docs.length<2}]; }
/* the three menus keep the everyday actions at the top level; the rest sits one submenu down */
const menus={
  file:()=>{ const P=A(); return [
    {l:'New note',sc:'Alt+N',f:()=>P.newTab()},
    {l:'Today\'s daily note',sc:'Ctrl+Alt+D',f:()=>openDaily(0),dis:!vx.root},
    {l:'Open note…',sc:'Ctrl+O',f:openSwitcher},
    {l:'Open file…',sc:'Ctrl+Alt+O',f:openFile},
    {l:'Recent files',sub:recentMenu,dis:!recent.length},
    '-',
    {h:ws.dir?'Folder: '+ws.dir.name:'Folder'},
    {l:ws.dir?'Change folder…':'Open folder…',f:()=>openVault(null)},
    {l:'Workspaces',sub:workspaceMenu},
    ...(ws.dir?[{l:'New folder',f:()=>newFolderIn(vx.root),dis:!vx.root},{l:'Unused attachments…',f:openAttachments,dis:!vx.root},{l:'Close folder',f:closeVault}]:[]),
    '-',
    {l:'Save',sc:'Ctrl+S',f:()=>P.saveFile(false)},
    {l:'Save as…',sc:'Ctrl+Shift+S',f:()=>P.saveFile(true)},
    {l:'Rename note',f:()=>P.startRename(P.cur)},
    {l:'Export',sub:()=>[{l:'HTML…',f:()=>P.exportHtml()},{l:'Print / save as PDF…',sc:'Ctrl+P',f:()=>window.print()}]},
    '-',
    {l:'Tabs',sub:tabsMenu},
    {l:'Close tab',sc:'Alt+W',f:()=>P.closeTab(P.cur)},
    '-',
    ...(isInstalled()?[]:[{l:'Install app…',f:installApp}]),
    {l:'Help',sc:'F1',f:toggleHelp}]; },
  edit:()=>{ const P=A(), cmd=P.cmd; return [
    {l:'Undo',sc:'Ctrl+Z',f:()=>P.doUndo(),dis:!P.undoLen()},
    {l:'Redo',sc:'Ctrl+Y',f:()=>P.doRedo(),dis:!P.redoLen()},
    '-',
    {l:'Find…',sc:'Ctrl+F',f:()=>P.openFind(false)},
    {l:'Replace…',sc:'Ctrl+H',f:()=>P.openFind(true)},
    '-',
    cmd.check(),
    cmd.heading(),
    cmd.due(),
    cmd.indent(),
    cmd.outdent(),
    '-',
    {l:'Line',sub:()=>[cmd.checkbox(),cmd.priUp(),cmd.priDown(),'-',cmd.up(),cmd.down(),cmd.below(),cmd.above(),cmd.dup()]},
    cmd.format(),
    cmd.sort(),
    {l:'Insert template',sub:templateMenu}]; },
  view:()=>{ const P=A(), fs=P.foldState(); return [
    {l:'Command palette…',sc:'Ctrl+Shift+P',f:()=>openPalette()},
    '-',
    {l:'Sidebar',sc:'Ctrl+Shift+B',chk:sideVisible(),f:toggleSide},
    {l:'Files',sc:'Ctrl+Shift+E',chk:sideShowing('files'),f:()=>showView('files',true)},
    {l:'Search',sc:'Ctrl+Shift+F',chk:sideShowing('search'),f:()=>showView('search',true)},
    {l:'Tags',chk:sideShowing('tags'),f:()=>showView('tags',true)},
    {l:'Outline',sc:'Ctrl+Shift+O',chk:sideShowing('outline'),f:()=>showView('outline',true)},
    '-',
    {l:'Agenda',sc:'Ctrl+Shift+A',chk:P.agendaOn(),f:()=>P.setAgenda(!P.agendaOn())},
    {l:'Filter…',sc:'Ctrl+Shift+L',chk:settings.filter.on,f:toggleFilterBar},
    {l:'Hide done items',chk:settings.hideDone,f:viewToggle('hideDone')},
    '-',
    {l:'Panes',sub:()=>[
      {l:'Split right',sc:'Ctrl+\\',f:()=>splitPane(P,'row')},
      {l:'Split down',f:()=>splitPane(P,'col')},
      {l:'Focus other pane',f:()=>{ const n=panes[(panes.indexOf(P)+1)%panes.length]; setActive(n); n.focusEditor(); },dis:panes.length<2},
      {l:'Close pane',f:()=>closePane(P),dis:panes.length<2}]},
    {l:'Fold',sub:()=>[
      {l:fs.anyExpanded?'Collapse all':'Expand all',sc:'Ctrl+Shift+.',f:()=>P.foldAll(),dis:!fs.any},
      {l:'Collapse current',sc:'Alt+←',f:()=>P.withSel(P.collapseCurrent)},
      {l:'Expand current',sc:'Alt+→',f:()=>P.withSel(P.expandCurrent)}]},
    {l:'Zoom',sub:()=>[
      {l:'Zoom in',sc:'Ctrl+=',f:()=>setZoom(settings.zoom+0.1)},
      {l:'Zoom out',sc:'Ctrl+−',f:()=>setZoom(settings.zoom-0.1)},
      {l:'Reset zoom',sc:'Ctrl+0',f:()=>setZoom(1)}]},
    '-',
    {l:'Source',chk:P.sourceOn(),f:()=>P.setSource(!P.sourceOn())},
    {l:'Indented headings',chk:settings.indentHeadings,f:viewToggle('indentHeadings')},
    '-',
    {l:'Settings…',f:openSettings}]; },
  context:()=>{ const cmd=A().cmd; return [
    cmd.check(),cmd.checkbox(),cmd.due(),cmd.priUp(),cmd.priDown(),cmd.heading(),
    '-',
    cmd.indent(),cmd.outdent(),cmd.up(),cmd.down(),cmd.dup(),
    '-',
    cmd.format(),cmd.sort(),{l:'Insert template',sub:templateMenu},
    '-',
    cmd.fold()]; }
};
const MENU_ORDER=['file','edit','view'];
let openMenu=null, subTimer=0;
/* each item gets an access key: the first free letter that starts a word, else any free letter */
function assignKeys(items){
  const used=new Set();
  const pick=(l,wordStart)=>{ for(let k=0;k<l.length;k++){ const c=l[k].toLowerCase(); if(!/[a-z0-9]/.test(c)||used.has(c)) continue; if(!wordStart||k===0||l[k-1]===' ') return k; } return -1; };
  for(const it of items){ if(it==='-'||it.h) continue; let k=pick(it.l,true); if(k<0) k=pick(it.l,false); it.kpos=k; it.key=k>=0?it.l[k].toLowerCase():''; if(k>=0) used.add(it.key); }
}
function buildMenu(items,kb){
  const box=el('div','menu'+(kb?' kb':'')); box.setAttribute('role','menu'); assignKeys(items);
  for(const it of items){
    if(it==='-'){ box.append(el('hr')); continue; }
    if(it.h){ const h=el('div','mh'); h.textContent=it.h; box.append(h); continue; }
    const mi=el('div','mi'+(it.dis?' disabled':'')+(it.sub?' has-sub':'')); mi.setAttribute('role','menuitem'); mi._it=it;
    const chk=el('span','chk'); chk.textContent=it.chk?'✓':''; const lbl=el('span','lbl');
    if(it.kpos>=0){ const u=el('u'); u.textContent=it.l[it.kpos]; lbl.append(it.l.slice(0,it.kpos),u,it.l.slice(it.kpos+1)); } else lbl.textContent=it.l;
    const sc=el('span','sc'); sc.textContent=it.sub?'›':(it.sc||'');
    mi.append(chk,lbl,sc); mi.addEventListener('mousedown',e=>e.preventDefault());
    if(it.sub){
      mi.addEventListener('click',()=>openSub(mi,false));
      mi.addEventListener('mouseenter',()=>{ clearTimeout(subTimer); subTimer=setTimeout(()=>openSub(mi,false),120); });
      mi.addEventListener('mouseleave',()=>clearTimeout(subTimer));
    } else {
      mi.addEventListener('click',()=>{ hideMenu(); it.f(); });
      /* hovering a sibling of the open submenu's parent closes it, after a moment so a diagonal path into the submenu survives */
      mi.addEventListener('mouseenter',()=>{ clearTimeout(subTimer); if(openMenu&&openMenu.sub&&openMenu.sub.parent.parentNode===box) subTimer=setTimeout(closeSub,250); });
    }
    box.append(mi);
  }
  return box;
}
function placeFixed(box,x,y){ const w=box.offsetWidth, h=box.offsetHeight; box.style.left=Math.max(4,Math.min(x,innerWidth-w-4))+'px'; box.style.top=Math.max(4,Math.min(y,innerHeight-h-4))+'px'; }
function focusItem(box,k){ const items=[...box.querySelectorAll('.mi:not(.disabled)')]; items.forEach(x=>x.classList.remove('focus')); const t=items[(k+items.length)%items.length]; if(t){ t.classList.add('focus'); t.scrollIntoView({block:'nearest'}); } }
function openSub(mi,kb){
  if(!openMenu||!mi._it.sub) return;
  if(openMenu.sub){ if(openMenu.sub.parent===mi){ if(kb) focusItem(openMenu.sub.box,0); return; } closeSub(); }
  const box=buildMenu(mi._it.sub(),kb||openMenu.box.classList.contains('kb')); box.classList.add('sub');
  box.addEventListener('mouseenter',()=>clearTimeout(subTimer));
  document.body.append(box);
  const r=mi.getBoundingClientRect(); let x=r.right-2; if(x+box.offsetWidth>innerWidth-4) x=r.left-box.offsetWidth+2;
  placeFixed(box,x,r.top-6);
  mi.classList.add('open'); openMenu.sub={box,parent:mi};
  if(kb) focusItem(box,0);
}
function closeSub(){ clearTimeout(subTimer); const sub=openMenu&&openMenu.sub; if(!sub) return; sub.box.remove(); sub.parent.classList.remove('open'); openMenu.sub=null; }
function showMenu(name,btn,focusFirst){
  hideMenu(); const box=buildMenu(menus[name](),focusFirst);
  box.style.left=btn.offsetLeft+'px'; menubar.append(box); btn.classList.add('open'); openMenu={name,btn,box,sub:null};
  if(focusFirst) focusItem(box,0);
}
function showContextMenu(x,y,items){
  hideMenu(); if(A()) A().dismiss();
  const box=buildMenu(items||menus.context(),false); box.classList.add('ctx'); document.body.append(box); placeFixed(box,x,y);
  openMenu={name:'context',btn:null,box,sub:null};
}
function hideMenu(){ if(!openMenu) return; closeSub(); openMenu.box.remove(); if(openMenu.btn) openMenu.btn.classList.remove('open'); openMenu=null; }
menubar.addEventListener('mousedown',e=>{ const b=e.target.closest('.mbtn[data-menu]'); if(!b) return; e.preventDefault(); if(openMenu&&openMenu.name===b.dataset.menu) hideMenu(); else showMenu(b.dataset.menu,b); });
menubar.addEventListener('mouseover',e=>{ const b=e.target.closest('.mbtn[data-menu]'); if(b&&openMenu&&MENU_ORDER.includes(openMenu.name)&&openMenu.name!==b.dataset.menu) showMenu(b.dataset.menu,b); });
document.addEventListener('mousedown',e=>{ if(openMenu&&!e.target.closest('.menubar,.menu')) hideMenu(); },true);
function toggleHelp(){ hideMenu(); if(helpDlg.open) helpDlg.close(); else { helpDlg.showModal(); helpDlg.scrollTop=0; } }
document.addEventListener('keydown',e=>{
  if(!openMenu) return;
  const mod=e.ctrlKey||e.metaKey, box=openMenu.sub?openMenu.sub.box:openMenu.box, top=MENU_ORDER.includes(openMenu.name);
  const items=[...box.querySelectorAll('.mi:not(.disabled)')], idx=items.findIndex(x=>x.classList.contains('focus')), cur=items[idx];
  const stop=()=>{ e.preventDefault(); e.stopPropagation(); };
  const switchTop=d=>{ let k=MENU_ORDER.indexOf(openMenu.name); k=(k+d+MENU_ORDER.length)%MENU_ORDER.length; showMenu(MENU_ORDER[k],menubar.querySelector('[data-menu="'+MENU_ORDER[k]+'"]'),true); };
  const back=()=>{ const p=openMenu.sub.parent; closeSub(); p.classList.add('focus'); };
  const run=mi=>{ if(mi._it.sub) openSub(mi,true); else mi.click(); };
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){ stop(); const d=e.key==='ArrowDown'?1:-1; if(items.length) focusItem(box,idx<0?(d>0?0:-1):idx+d); }
  else if(e.key==='Home'||e.key==='End'){ stop(); if(items.length) focusItem(box,e.key==='Home'?0:-1); }
  else if(e.key==='ArrowRight'){ stop(); if(cur&&cur._it.sub) openSub(cur,true); else if(top&&!openMenu.sub) switchTop(1); }
  else if(e.key==='ArrowLeft'){ stop(); if(openMenu.sub) back(); else if(top) switchTop(-1); }
  else if(e.key==='Enter'||e.key===' '){ stop(); if(cur) run(cur); }
  else if(e.key==='Escape'){ stop(); if(openMenu.sub) back(); else hideMenu(); }
  else if(e.key==='Tab'){ stop(); hideMenu(); }
  else if(e.altKey&&!mod&&/^[fev]$/i.test(e.key)){ stop(); const name={f:'file',e:'edit',v:'view'}[e.key.toLowerCase()]; showMenu(name,menubar.querySelector('[data-menu="'+name+'"]'),true); }
  /* the underlined letter runs an item, or opens its submenu */
  else if(!mod&&e.key.length===1){ stop(); const c=e.key.toLowerCase(), hit=items.find(x=>x._it.key===c); if(hit) run(hit); }
  else if(!/^(Alt|Shift|Control|Meta)$/.test(e.key)) stop();
},true);
document.addEventListener('keydown',e=>{ if(e.key==='Alt') document.body.classList.add('altnav'); });
document.addEventListener('keyup',e=>{ if(e.key==='Alt') document.body.classList.remove('altnav'); });
window.addEventListener('blur',()=>document.body.classList.remove('altnav'));
