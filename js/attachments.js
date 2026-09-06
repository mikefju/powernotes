'use strict';
/* ---------- unused attachments ----------
   The folder's attachments are its images anywhere and every file in a folder called Attachments. One is unused
   when no note (open tabs by their live text, the rest by the index) links to it by path or by name. The dialog
   lists them with a box each; ticked ones are moved into the .trash folder, where Explorer can still find them. */
const attDlg=$('attDlg'), attList=$('attList'), attMsg=$('attMsg'), attGo=$('attGo'), attAll=$('attAll');
let attItems=[];
/* every attachment path a note refers to, resolved the way pictures are: next to the note, from the top, then by name */
function usedAttachments(){
  const used=new Set(), byBase=new Map();
  for(const p of vx.media.keys()){ const b=p.split('/').pop().toLowerCase(); if(!byBase.has(b)) byBase.set(b,[]); byBase.get(b).push(p); }
  const mark=(refs,notePath)=>{ for(const rel0 of refs){
    const rel=rel0.replace(/^\.\//,''), cands=[normPath(rel)]; if(notePath) cands.unshift(normPath(parentOf(notePath)+rel));
    let hit=false; for(const c of cands) if(vx.media.has(c)){ used.add(c); hit=true; break; }
    if(!hit) for(const p of byBase.get(rel.split('/').pop().toLowerCase())||[]) used.add(p);
  } };
  for(const d of allDocs()) mark(linkRefs(d.lines.map(l=>l.text).join('\n')),d.wsPath||null);
  for(const e of vx.notes.values()) if(!openDocAt(e.path)) mark(e.refs||[],e.path);
  return used;
}
/* index entries from an older cache know nothing about links to files; those notes are read once more */
async function ensureRefs(){
  const todo=[...vx.notes.values()].filter(e=>!e.refs&&e.handle);
  for(const e of todo){ try{ const f=await e.handle.getFile(); Object.assign(e,indexText(await f.text(),e.name),{mtime:f.lastModified,size:f.size}); }catch(x){ e.refs=[]; } }
  if(todo.length) scheduleCache();
}
async function openAttachments(){
  if(!ws.dir||!vx.perm||!vx.root){ alert('Open a folder first (File › Open folder…).'); return; }
  hideMenu(); attItems=[]; attList.replaceChildren(); attGo.disabled=true; attMsg.textContent='Reading the folder…'; attDlg.showModal();
  await ensureRefs();
  const used=usedAttachments(), unused=[...vx.media.keys()].filter(p=>!used.has(p)&&!p.startsWith('.trash/')).sort();
  attItems=[];
  for(const p of unused){ let size=0; try{ size=(await vx.media.get(p).getFile()).size; }catch(x){} attItems.push({path:p,size,on:true}); }
  renderAttachments();
}
const fmtSize=n=>n<1024?n+' B':n<1048576?(n/1024).toFixed(0)+' KB':(n/1048576).toFixed(1)+' MB';
function renderAttachments(){
  const total=vx.media.size, sel=attItems.filter(x=>x.on), bytes=sel.reduce((n,x)=>n+x.size,0);
  attMsg.textContent=attItems.length?attItems.length+' of '+total+' attachment'+(total===1?'':'s')+' '+(attItems.length===1?'is':'are')+' not linked from any note.':'Every one of the '+total+' attachment'+(total===1?'':'s')+' is linked from a note.';
  attList.replaceChildren(...attItems.map((x,k)=>{
    const li=el('li'), cb=el('input'); cb.type='checkbox'; cb.checked=x.on; cb.dataset.k=k; cb.setAttribute('aria-label',x.path);
    const n=el('span','n'); const b=el('b'); b.textContent=x.path.split('/').pop(); n.append(b); const dir=parentOf(x.path); if(dir) n.append(' · '+dir.slice(0,-1));
    const s=el('span','k'); s.textContent=fmtSize(x.size); li.append(cb,n,s); return li;
  }));
  attGo.disabled=!sel.length; attGo.textContent=sel.length?'Move '+sel.length+' to .trash ('+fmtSize(bytes)+')':'Move to .trash';
  attAll.hidden=!attItems.length; attAll.textContent=sel.length===attItems.length?'Select none':'Select all';
}
attList.addEventListener('change',e=>{ if(e.target.type==='checkbox'){ attItems[+e.target.dataset.k].on=e.target.checked; renderAttachments(); } });
attAll.addEventListener('click',()=>{ const all=attItems.every(x=>x.on); for(const x of attItems) x.on=!all; renderAttachments(); });
attGo.addEventListener('click',async()=>{
  const sel=attItems.filter(x=>x.on); if(!sel.length) return; attGo.disabled=true; let n=0;
  vx.busy++;
  try{
    const trash=await ws.dir.getDirectoryHandle('.trash',{create:true});
    for(const x of sel){
      try{ const from=await handleAt(parentOf(x.path)), h=vx.media.get(x.path), name=await freeName(trash,h.name); await relocateFile(h,from,trash,name); vx.media.delete(x.path); n++; }
      catch(e){ console.warn('attachment',x.path,e); }
    }
  }catch(e){ alert('Could not move the files: '+e.message); }
  vx.busy--;
  attItems=attItems.filter(x=>!x.on||vx.media.has(x.path)); renderAttachments();
  attMsg.textContent=n+' file'+(n===1?'':'s')+' moved to .trash. '+attMsg.textContent;
  for(const p of panes) p.refreshMedia(); requestScan(true,null,0);
});
