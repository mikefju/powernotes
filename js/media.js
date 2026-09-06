'use strict';
/* ---------- images: shown under the row that links them, stored in Attachments ---------- */
const IMG_EXT=/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i, mediaUrls=new Map(), parentPromises=new Map();
/* the images a line links to: ![alt](path) and Obsidian's ![[file.png|width]] */
function imageRefs(body){
  const out=[], re=/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|!\[\[([^\]\n|]+?)(?:\|(\d+)[^\]]*)?\]\]/g; let m;
  while((m=re.exec(body))){
    if(m[2]!=null){ if(IMG_EXT.test(m[2].split(/[?#]/)[0])) out.push({src:m[2],alt:m[1]}); }
    else { const t=m[3].trim(); if(IMG_EXT.test(t)) out.push({src:t,alt:t.split('/').pop(),w:m[4]?+m[4]:0}); }
  }
  return out;
}
function normPath(p){ const out=[]; for(const s of p.split('/')){ if(s==='..') out.pop(); else if(s&&s!=='.') out.push(s); } return out.join('/'); }
function decodeLink(link){ try{ return decodeURIComponent(link); }catch(e){ return link; } }
/* the file a link points at: next to the note, then from the top of the folder, then by name anywhere in it */
function resolveMedia(link,d){
  const rel=decodeLink(link).replace(/^\.\//,''), cands=[];
  if(d&&d.wsPath) cands.push(normPath(parentOf(d.wsPath)+rel)); cands.push(normPath(rel));
  for(const c of cands) if(vx.media.has(c)) return c;
  const base=rel.split('/').pop().toLowerCase(); for(const p of vx.media.keys()) if(p.split('/').pop().toLowerCase()===base) return p;
  return null;
}
async function mediaUrl(link,d){
  if(/^(https?:|data:|blob:)/i.test(link)) return link;
  let h=null, key=null; const p=resolveMedia(link,d);
  if(p){ key='v:'+p; h=vx.media.get(p); }
  else if(d&&d.handle&&!d.wsPath){   /* a note from elsewhere: the link counts from its own folder */
    if(!parentPromises.has(d.id)) parentPromises.set(d.id,findParent(d.handle).catch(()=>null));
    const parent=await parentPromises.get(d.id); if(!parent) return null; key='x:'+d.id+':'+link;
    try{ let dir=parent; const segs=normPath(decodeLink(link)).split('/'); for(const s of segs.slice(0,-1)) dir=await dir.getDirectoryHandle(s); h=await dir.getFileHandle(segs[segs.length-1]); }catch(e){ return null; }
  }
  if(!h) return null;
  if(mediaUrls.has(key)) return mediaUrls.get(key);
  try{ const u=URL.createObjectURL(await h.getFile()); mediaUrls.set(key,u); return u; }catch(e){ return null; }
}
function dropMediaUrls(){ for(const u of mediaUrls.values()) URL.revokeObjectURL(u); mediaUrls.clear(); parentPromises.clear(); }
const pad2=n=>String(n).padStart(2,'0');
function stampName(){ const t=new Date(); return t.getFullYear()+pad2(t.getMonth()+1)+pad2(t.getDate())+pad2(t.getHours())+pad2(t.getMinutes())+pad2(t.getSeconds()); }
/* writes an image into Attachments (at the top of the open folder, or next to a file from elsewhere) and returns the markdown that links it */
async function storeAttachment(d,file){
  let base=null;
  if(ws.dir&&vx.perm&&(d.wsPath||!d.handle)) base=ws.dir;
  else if(d.handle){ base=await findParent(d.handle); if(!base){ alert('PowerNotes cannot reach the folder that holds "'+d.name+'", so the image has nowhere to go. Open that folder with File › Open folder… first.'); return null; } }
  else { alert('Open a folder first (File › Open folder…) and images will be stored in its Attachments folder.'); return null; }
  try{
    const dir=await base.getDirectoryHandle('Attachments',{create:true});
    const ext=/\.\w+$/.test(file.name||'')?file.name.slice(file.name.lastIndexOf('.')):'.'+((file.type.split('/')[1]||'png').replace('jpeg','jpg').replace(/\+.*$/,''));
    const want=(file.name&&!/^image\.\w+$/i.test(file.name))?file.name:'Pasted image '+stampName()+ext;
    const name=await freeName(dir,want), h=await dir.getFileHandle(name,{create:true}), w=await h.createWritable(); await w.write(file); await w.close();
    if(base===ws.dir) vx.media.set('Attachments/'+name,h);
    return '!['+name.replace(/\.\w+$/,'')+'](Attachments/'+encodeURI(name).replace(/[()]/g,c=>c==='('?'%28':'%29')+')';
  }catch(e){ console.error(e); alert('Could not save the image: '+e.message); return null; }
}
const BAD_NAME=/[\\/:*?"<>|]/;
