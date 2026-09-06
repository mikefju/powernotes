'use strict';
/* ---------- IndexedDB: file handles, recent files and workspaces ---------- */
const idb={
  dbp:null,
  open(){ if(this.dbp) return this.dbp; this.dbp=new Promise((res,rej)=>{ if(!window.indexedDB) return rej(new Error('no idb')); const r=indexedDB.open('mdnotes',3); r.onupgradeneeded=()=>{ const d=r.result; for(const n of ['handles','recent','workspaces','index']) if(!d.objectStoreNames.contains(n)) d.createObjectStore(n); }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); return this.dbp; },
  async op(store,mode,fn){ try{ const db=await this.open(); return await new Promise((res,rej)=>{ const tx=db.transaction(store,mode); const rq=fn(tx.objectStore(store)); rq.onsuccess=()=>res(rq.result); rq.onerror=()=>rej(rq.error); }); }catch(e){ return undefined; } },
  get(s,k){ return this.op(s,'readonly',o=>o.get(k)); }, set(s,k,v){ return this.op(s,'readwrite',o=>o.put(v,k)); }, del(s,k){ return this.op(s,'readwrite',o=>o.delete(k)); },
  all(s){ return this.op(s,'readonly',o=>o.getAll()); }, keys(s){ return this.op(s,'readonly',o=>o.getAllKeys()); }
};
let recent=[];
async function loadRecent(){ const v=await idb.all('recent'); const k=await idb.keys('recent'); recent=(v||[]).map((r,i)=>Object.assign({key:k[i]},r)).filter(r=>r.handle).sort((a,b)=>b.t-a.t); }
async function addRecent(handle,name){
  await loadRecent();
  for(const r of recent){ if(await handle.isSameEntry(r.handle).catch(()=>false)){ await idb.set('recent',r.key,{name,handle,t:Date.now()}); await loadRecent(); return; } }
  await idb.set('recent',uid(),{name,handle,t:Date.now()});
  await loadRecent();
  for(const r of recent.slice(10)) await idb.del('recent',r.key);
  recent=recent.slice(0,10);
}
async function ensurePerm(h,mode){ try{ if((await h.queryPermission({mode}))==='granted') return true; return (await h.requestPermission({mode}))==='granted'; }catch(e){ return false; } }
async function openRecent(r){
  if(!(await ensurePerm(r.handle,'read'))) return;
  try{ const f=await r.handle.getFile(); A().openInto(await f.text(),f.name,r.handle,{mtime:f.lastModified}); }
  catch(e){ alert('Could not open '+r.name+'. It may have been moved or deleted.'); idb.del('recent',r.key); loadRecent(); }
}
