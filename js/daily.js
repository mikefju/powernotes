'use strict';
/* ---------- daily notes and templates ----------
   A daily note is a file named after the day (settings say the folder and the date format) inside the open
   folder; opening today's note creates it when it does not exist yet, from a template if one is named.
   Templates are notes in a folder of their own; inserting one drops its text at the caret with {{date}},
   {{time}} and {{title}} filled in. */
const DATE_TOKENS=/YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|hh|mm|ss|A/g;
const MONTHS_FULL=['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_LONG=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
function fmtDate(d,fmt){
  return fmt.replace(DATE_TOKENS,t=>{ switch(t){
    case 'YYYY': return d.getFullYear(); case 'YY': return String(d.getFullYear()).slice(-2);
    case 'MMMM': return MONTHS_FULL[d.getMonth()]; case 'MMM': return MONTHS_FULL[d.getMonth()].slice(0,3); case 'MM': return pad2(d.getMonth()+1); case 'M': return d.getMonth()+1;
    case 'DD': return pad2(d.getDate()); case 'D': return d.getDate(); case 'dddd': return DAYS_LONG[d.getDay()]; case 'ddd': return DAYS_LONG[d.getDay()].slice(0,3);
    case 'HH': return pad2(d.getHours()); case 'hh': return pad2(d.getHours()%12||12); case 'mm': return pad2(d.getMinutes()); case 'ss': return pad2(d.getSeconds()); case 'A': return d.getHours()<12?'AM':'PM';
  } return t; });
}
/* {{date}}, {{date:MMM D}}, {{time}}, {{time:HH:mm}} and {{title}} */
function fillTemplate(text,title,d){
  return text.replace(/\{\{\s*(date|time|title)(?::([^}]+))?\s*\}\}/gi,(m,k,f)=>{ k=k.toLowerCase(); if(k==='title') return title; return fmtDate(d,f?f.trim():(k==='date'?'YYYY-MM-DD':'HH:mm')); });
}
const cleanFolder=s=>(s||'').trim().replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
/* the folder at path inside the open folder, created along with its parents and put in the tree */
async function ensureDir(path){
  let dir=ws.dir, node=vx.root;
  for(const seg of cleanFolder(path).split('/').filter(Boolean)){
    dir=await dir.getDirectoryHandle(seg,{create:true}); const p=node.path+seg+'/'; let nd=vx.dirs.get(p);
    if(!nd){ nd={path:p,name:seg,handle:dir,dirs:[],files:[]}; node.dirs.push(nd); node.dirs.sort(byName); vx.dirs.set(p,nd); vx.sig=''; }
    node=nd;
  }
  return node;
}
/* the notes in the templates folder, by name */
function templateNotes(){
  const folder=cleanFolder(settings.templates.folder); if(!folder||!vx.root) return [];
  const pre=folder+'/'; return [...vx.notes.values()].filter(e=>e.path.startsWith(pre)).sort(byName);
}
async function templateText(name){
  const k=baseOf(name).toLowerCase(), e=templateNotes().find(e=>baseOf(e.name).toLowerCase()===k); if(!e||!e.handle) return null;
  try{ return await (await e.handle.getFile()).text(); }catch(x){ return null; }
}
async function insertTemplate(e){
  const P=A(); if(!P||P.sourceOn()||P.agendaOn()) return;
  let text=null; try{ text=await (await e.handle.getFile()).text(); }catch(x){ alert('Could not read '+e.name+'.'); return; }
  text=fillTemplate(text.replace(/\r\n?/g,'\n').replace(/\n$/,''),labelOf(P.D().name),new Date());
  P.insertText(text);
}
function templateMenu(){
  if(!ws.dir||!vx.perm) return [{l:'Open a folder to use templates',dis:true}];
  const list=templateNotes(), folder=cleanFolder(settings.templates.folder)||'Templates';
  if(!list.length) return [{l:'No notes in '+folder+' yet',dis:true},{l:'New template in '+folder+'…',f:()=>newTemplate()}];
  return [...list.map(e=>({l:labelOf(e.name),f:()=>insertTemplate(e)})),'-',{l:'New template…',f:()=>newTemplate()}];
}
async function newTemplate(){
  if(!ws.dir||!vx.perm||!vx.root) return;
  try{ const node=await ensureDir(settings.templates.folder||'Templates'); renderTree(); await newNoteIn(node); }
  catch(e){ console.error(e); alert('Could not create the templates folder: '+e.message); }
}
/* today's note (or the one offset days away): opened, or created first */
async function openDaily(offset){
  if(!ws.dir||!vx.perm||!vx.root){ alert('Open a folder first (File › Open folder…). Daily notes are files in it.'); return; }
  const d=new Date(); d.setDate(d.getDate()+(offset||0));
  const folder=cleanFolder(settings.daily.folder), fmt=settings.daily.format||'YYYY-MM-DD';
  const base=fmtDate(d,fmt).replace(/[\\:*?"<>|]/g,'-'), name=base.split('/').pop()+'.md', sub=base.includes('/')?base.slice(0,base.lastIndexOf('/')):'';
  const dirPath=[folder,sub].filter(Boolean).join('/'), path=(dirPath?dirPath+'/':'')+name;
  let e=vx.notes.get(path);
  if(!e){
    try{
      const node=await ensureDir(dirPath);
      const tpl=settings.daily.template?await templateText(settings.daily.template):null;
      const text=tpl!=null?fillTemplate(tpl.replace(/\r\n?/g,'\n'),labelOf(name),d):'# '+labelOf(name)+'\n';
      const h=await node.handle.getFileHandle(name,{create:true}), w=await h.createWritable(); await w.write(text); await w.close();
      e=addNote(node,h,name,await h.getFile(),text,Date.now()); requestScan(false,null,0);
    }catch(x){ console.error(x); alert('Could not create the daily note: '+x.message); return; }
  }
  const doc=await openNote(e); if(!doc) return;
  const p=paneOf(doc); if(p&&p.D()===doc) p.revealRow(doc.lines.length-1);
}
