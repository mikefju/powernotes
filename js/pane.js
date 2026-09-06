'use strict';
function makePane(paneId){
const P={id:paneId,size:0};
const root=paneTpl.content.firstElementChild.cloneNode(true), q=s=>root.querySelector(s);
const editor=q('.editor'), main=q('.main'), src=q('.src'), backEl=q('.backlinks'), acEl=q('.ac'), docTitle=q('.doctitle'), docMeta=q('.docmeta');
const datePop=q('.datePop'), dpInput=q('.dpInput'), crumbEl=q('.crumb'), pvEl=q('.preview'), agendaEl=q('.agenda'), tabBar=q('.tabbar');
const tabsEl=el('div','tabs'); tabsEl.setAttribute('role','tablist');
const ctl=new AbortController(), sig={signal:ctl.signal}, sigP={signal:ctl.signal,passive:true};
panesEl.append(root);
editor.contentEditable=PLAIN?'plaintext-only':'true';
let docs=[], cur=0, lines=[], fenced=[], hiddenArr=[], dimArr=[], indentUnit=2;
let undo=[], redo=[];
let filterStats={match:0,total:0};
let typing=false, typingTimer=0, srcTimer=0, mouseDown=false, composing=false, lastSel=null, sourceOn=false;
const htmlCache=new Map();
const find={open:false, query:'', cs:false, matches:[], idx:-1};

const parse=t=>parseLine(t,indentUnit), build=p=>buildLine(p,indentUnit);
function D(){ return docs[cur]; }
function setLines(arr){ lines=arr; D().lines=arr; }
function parseAt(i){
  if(fenced[i]) return {type:'p',level:0,indent:0,checked:null,body:lines[i].text,raw:true};
  return parse(lines[i].text);
}
function computeFences(){
  fenced=new Array(lines.length).fill(false); let inF=false;
  for(let i=0;i<lines.length;i++){ const f=RE_FENCE.test(lines[i].text); fenced[i]=inF||f; if(f) inF=!inF; }
}
function allTags(){
  const m=new Map();
  lines.forEach((l,i)=>{ if(fenced[i]) return; RE_TAG.lastIndex=0; let x; const body=parse(l.text).body; while((x=RE_TAG.exec(body))){ const k=x[1].toLowerCase(), e=m.get(k); if(e) e.n++; else m.set(k,{k,label:x[1],n:1}); } });
  return [...m.values()].sort((a,b)=>b.n-a.n||a.k.localeCompare(b.k));
}
function renumber(){
  computeFences();
  let counters={};
  for(let i=0;i<lines.length;i++){
    const p=parseAt(i);
    if(p.type==='h'||((p.type==='p'||p.type==='q')&&p.body!==''&&p.indent===0)){counters={};continue;}
    if(!isList(p)) continue;
    for(const k of Object.keys(counters)) if(+k>p.indent) delete counters[k];
    if(p.type==='ol'){ const n=(counters[p.indent]||0)+1; counters[p.indent]=n; if(p.num!==n){p.num=n;lines[i].text=build(p);} }
    else delete counters[p.indent];
  }
}
function sectionEnd(i){
  const p=parseAt(i);
  if(p.type==='h'){ let j=i+1; while(j<lines.length){ const q=parseAt(j); if(q.type==='h'&&q.level<=p.level) break; j++; } return j; }
  if(isList(p)){
    let j=i+1,last=i;
    while(j<lines.length){ const q=parseAt(j); if(q.type==='p'&&q.body===''&&!q.raw){ j++; continue; } if(q.type==='h'||q.raw||q.indent<=p.indent) break; last=j; j++; }
    return last+1;
  }
  return i+1;
}
function collapsible(i){ const p=parseAt(i); return p.type==='h'||(isList(p)&&sectionEnd(i)>i+1); }
function taskStats(i){ let total=0, done=0; for(let j=i+1,e=sectionEnd(i);j<e;j++){ const q=parseAt(j); if(q.checked!=null){ total++; if(q.checked) done++; } } return {total,done}; }
/* a row's span is itself plus, when it is collapsed, everything folded under it */
function spanEnd(i){ return lines[i].collapsed&&collapsible(i)?Math.max(i+1,sectionEnd(i)):i+1; }
function computeHidden(){
  const n=lines.length, hidden=new Array(n).fill(false);
  for(let i=0;i<n;i++){
    const p=parseAt(i);
    const fold=lines[i].collapsed&&collapsible(i), done=settings.hideDone&&p.checked===true;
    if(fold||done){ const e=sectionEnd(i); for(let j=done?i:i+1;j<e;j++) hidden[j]=true; }
  }
  dimArr=new Array(n).fill(false); filterStats={match:0,total:n};
  if(filterActive()){
    const f=settings.filter, keep=new Array(n).fill(false), today=todayStr(), week=shiftDate(7), stack=[];
    for(let i=0;i<n;i++){
      while(stack.length&&stack[stack.length-1].end<=i) stack.pop();
      const inh=stack.length?stack[stack.length-1].tags:NO_TAGS, p=parseAt(i);
      if(rowMatches(p,inh,today,week)){ keep[i]=true; filterStats.match++; if(f.parents) for(const s of stack) keep[s.j]=true; if(f.children&&collapsible(i)) for(let j=i+1,e=sectionEnd(i);j<e;j++) keep[j]=true; }
      if(collapsible(i)){ const own=p.raw?NO_TAGS:tagsOf(p.body); const tags=own.size?new Set([...inh,...own]):inh; stack.push({j:i,end:sectionEnd(i),tags}); }
    }
    for(let i=0;i<n;i++) if(!keep[i]){ if(f.dim) dimArr[i]=true; else hidden[i]=true; }
  }
  return hidden;
}
function fromText(text,keepCollapsed){
  const prev=new Set(); if(keepCollapsed) for(const l of lines) if(l.collapsed) prev.add(l.text);
  const arr=fromTextRaw(text); for(const l of arr) l.collapsed=prev.has(l.text); return arr;
}
function serialize(){ return serializeLines(lines); }
function rowRender(i){
  const p=parseAt(i);
  if(p.raw) return {html:esc(p.body),map:idMap(p.body.length)};
  return inline(p.body);
}
function mapOf(i){ return rowRender(i).map; }
function renderRow(i){
  const c=contentOf(i); if(!c) return;
  const r=rowRender(i);
  if(htmlCache.get(i)===r.html) return;
  c.innerHTML=r.html; htmlCache.set(i,r.html);
  const row=c.closest('.row'), p=parseAt(i), m=row&&row.querySelector('.media');
  if(row){ if(!p.raw&&p.body.includes('![')) addMedia(row,p.body); else if(m) m.remove(); }
}
let foldState={any:false,anyExpanded:false}, anyChecked=false;
function render(){
  renumber();
  hiddenArr=computeHidden();
  const frag=document.createDocumentFragment();
  foldState={any:false,anyExpanded:false}; anyChecked=false;
  htmlCache.clear();
  const stack=[];
  lines.forEach((l,i)=>{
    const p=parseAt(i);
    let hd=0;
    if(p.type==='h'){ while(stack.length&&stack[stack.length-1]>=p.level) stack.pop(); hd=stack.length; stack.push(p.level); }
    else hd=stack.length;
    const row=el('div','row'); row.dataset.i=i;
    if(hiddenArr[i]) row.classList.add('hidden');
    if(dimArr[i]) row.classList.add('dim');
    if(settings.indentHeadings&&hd) row.style.setProperty('--hd',hd);
    if(p.raw){ row.classList.add('code'); if(RE_FENCE.test(l.text)) row.classList.add('fence'); }
    if(p.type==='q') row.classList.add('q');
    const g=el('div','gutter'), c=el('div','content');
    g.contentEditable='false';
    const h=el('span','handle'); h.textContent='⠿'; h.draggable=true; h.title='Drag to move'; g.append(h);
    const meta=[];
    if(collapsible(i)){
      foldState.any=true; if(l.collapsed) row.classList.add('collapsed'); else foldState.anyExpanded=true;
      const b=el('button','chev'); b.type='button'; b.tabIndex=-1; b.setAttribute('aria-label',l.collapsed?'Expand':'Collapse'); b.innerHTML=CHEV; g.append(b);
      if(l.collapsed){ let k=0; for(let j=i+1,e=sectionEnd(i);j<e;j++) if(lines[j].text.trim()) k++; meta.push(k===1?'1 line':k+' lines'); }
    }
    if(p.type==='h'){ row.classList.add('h'+p.level); const t=taskStats(i); if(t.total) meta.push(Math.round(100*t.done/t.total)+'%'); }
    else {
      row.style.setProperty('--lvl',p.indent);
      if(!p.raw){
        const cb=el('input'); cb.type='checkbox'; cb.tabIndex=-1; cb.checked=!!p.checked; cb.setAttribute('aria-label','Done'); cb.title=p.checked==null?'Add a checkbox':'Done · Alt+click removes the checkbox';
        if(p.checked!=null) row.classList.add('task'); if(p.checked){ row.classList.add('checked'); anyChecked=true; }
        g.append(cb);
      }
      if(p.type==='ul'&&p.checked==null) row.dataset.m='•'; else if(p.type==='ol') row.dataset.m=p.num+'.';
    }
    const r=rowRender(i); c.innerHTML=r.html; htmlCache.set(i,r.html);
    if(meta.length) c.dataset.meta='('+meta.join(' · ')+')';
    if(!p.raw&&p.body.includes('![')) addMedia(row,p.body);
    if(lines.length===1&&l.text==='') c.dataset.placeholder='Start typing. Begin a line with # for a heading, - for a list, 1. for numbers, [] for a checkbox.';
    row.append(g,c); frag.append(row);
  });
  editor.replaceChildren(frag);
  renderOutline(); renderBacklinks(); renderFilterBar(); renderMeta(); updateHighlights(); scheduleCrumb(); scheduleTags();
}
/* the pictures a row links to, shown under its text; each is loaded from the folder once and kept as a blob URL */
function addMedia(row,body){
  const refs=imageRefs(body); if(!refs.length) return;
  let box=row.querySelector('.media'); if(box) box.remove();
  box=el('div','media'); box.contentEditable='false';
  for(const r of refs){
    const img=el('img'); img.alt=r.alt||''; img.title=r.src; if(r.w) img.style.width=r.w+'px'; img.draggable=false;
    mediaUrl(r.src,D()).then(u=>{ if(u) img.src=u; else { const m=el('span','missing'); m.textContent='Image not found: '+r.src; img.replaceWith(m); } });
    box.append(img);
  }
  row.append(box);
}
/* expands whatever hides row i, then puts the caret on it and scrolls it to the top */
function revealRow(i,off){
  if(!lines[i]) return;
  for(let j=i-1;j>=0;j--) if(lines[j].collapsed&&collapsible(j)&&sectionEnd(j)>i) lines[j].collapsed=false;
  if(sourceOn) setSource(false); if(agendaOn) setAgenda(false);
  render(); setSel({i,off:off==null?parseAt(i).body.length:off});
  const r=editor.children[i]; if(r) r.scrollIntoView({block:'start'});
}
/* a search hit: the row shown, with the match selected */
function revealRange(i,s,e){ if(!lines[i]) return; revealRow(i,s); setSel({i,off:s},{i,off:e}); const r=editor.children[i]; if(r) r.scrollIntoView({block:'center'}); }
/* ---------- outline and backlinks ---------- */
function renderOutline(){
  if(P!==activePane||!sideShowing('outline')) return;
  const frag=document.createDocumentFragment(); const h=el('div','oh'); h.textContent=labelOf(D().name); frag.append(h);
  let any=false;
  if(!sourceOn&&!agendaOn) lines.forEach((l,i)=>{ const p=parseAt(i); if(p.type!=='h') return; any=true; const a=el('a','oi'); a.dataset.i=i; a.style.setProperty('--d',p.level-1); a.textContent=p.body||'(untitled)'; a.title=p.body; frag.append(a); });
  if(!any){ const e=el('div','oe'); e.textContent=sourceOn||agendaOn?'Not in this view':'No headings yet'; frag.append(e); }
  outlineEl.replaceChildren(frag); markOutline();
}
function markOutline(){
  if(P!==activePane||!sideShowing('outline')||!lastSel) return;
  let cur=-1; for(let i=lastSel.f.i;i>=0;i--) if(parseAt(i).type==='h'){ cur=i; break; }
  outlineEl.querySelectorAll('.oi').forEach(a=>a.classList.toggle('cur',+a.dataset.i===cur));
}
/* notes linking here: open tabs by their live text, the rest of the folder by the index */
function renderBacklinks(){
  const me=baseOf(D().name).toLowerCase(), from=[];
  for(const d of allDocs()){ if(d===D()) continue; const re=/\[\[([^\]\n]+?)\]\]/g; for(const l of d.lines){ let m, hit=false; while((m=re.exec(l.text))) if(baseOf(m[1].trim()).toLowerCase()===me){ hit=true; break; } if(hit){ from.push({d,name:d.name}); break; } } }
  for(const e of vx.notes.values()) if(!openDocAt(e.path)&&e.links.includes(me)) from.push({p:e.path,name:e.name});
  backEl.hidden=!from.length||sourceOn||agendaOn; if(backEl.hidden) return;
  backEl.replaceChildren(); backEl.append('Linked from: ');
  from.forEach(x=>{ const a=el('a'); a.textContent=baseOf(x.name); if(x.d) a._d=x.d; else { a.dataset.p=x.p; a.title=x.p; } backEl.append(a); });
}
backEl.addEventListener('click',e=>{ const a=e.target.closest('a'); if(!a) return; if(a._d) focusDoc(a._d); else { const n=vx.notes.get(a.dataset.p); if(n) openNote(n); } });

/* ---------- selection ---------- */
function contentOf(i){ const r=editor.children[i]; return r?r.querySelector('.content'):null; }
function rowOf(node){ const e=node.nodeType===3?node.parentElement:node; return e&&e.closest?e.closest('.row'):null; }
function mkSel(a,f){ const fwd=a.i<f.i||(a.i===f.i&&a.off<=f.off); return {a,f,start:fwd?a:f,end:fwd?f:a,collapsed:a.i===f.i&&a.off===f.off}; }
function renderedOffset(map,raw){ let lo=0,hi=map.length-1; while(lo<hi){ const mid=(lo+hi)>>1; if(map[mid]>=raw) hi=mid; else lo=mid+1; } return lo; }
function textPoint(c,k){ const w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT); let n,acc=0; while((n=w.nextNode())){ if(acc+n.length>=k) return {node:n,off:k-acc}; acc+=n.length; } return {node:c,off:c.childNodes.length}; }
function posFromDom(node,off){
  if(!node) return null;
  if(node===editor){ const rows=editor.children; if(!rows.length||!lines.length) return {i:0,off:0}; if(off>=rows.length){ const i=lines.length-1; return {i,off:parseAt(i).body.length}; } return {i:+rows[off].dataset.i,off:0}; }
  const row=rowOf(node); if(!row) return null; const i=+row.dataset.i; const p=parseAt(i);
  const c=row.querySelector('.content'); const e=node.nodeType===3?node.parentElement:node;
  if(node!==c&&!c.contains(node)){ const atEnd=node===row?off>Array.prototype.indexOf.call(row.children,c):!!(c.compareDocumentPosition(e)&Node.DOCUMENT_POSITION_FOLLOWING); return {i,off:atEnd?p.body.length:0}; }
  const r=document.createRange(); r.setStart(c,0); try{ r.setEnd(node,off); }catch(_){ return {i,off:0}; }
  const k=r.toString().length, map=mapOf(i);
  let raw=map[Math.min(k,map.length-1)];
  const par=node.nodeType===3?node.parentElement:null;
  if(par&&off===node.length&&!par.classList.contains('due')&&k>0&&k<map.length-1&&map[k]>map[k-1]+1) raw=map[k-1]+1;
  return {i,off:raw};
}
function getSel(){
  const s=getSelection(); if(!s.rangeCount||!editor.contains(s.anchorNode)||!editor.contains(s.focusNode)) return null;
  const a=posFromDom(s.anchorNode,s.anchorOffset), f=posFromDom(s.focusNode,s.focusOffset); if(!a||!f) return null;
  return mkSel(a,f);
}
function clampPos(p){ const i=Math.max(0,Math.min(p.i,lines.length-1)); return {i,off:Math.max(0,Math.min(p.off,parseAt(i).body.length))}; }
function visibleNear(i){ if(!hiddenArr[i]) return i; for(let j=i-1;j>=0;j--) if(!hiddenArr[j]) return j; for(let j=i+1;j<lines.length;j++) if(!hiddenArr[j]) return j; return i; }
function fixHidden(p){ if(!hiddenArr[p.i]) return p; const j=visibleNear(p.i); return {i:j,off:j<p.i?parseAt(j).body.length:0}; }
function domPoint(i,off){ const c=contentOf(i); if(!c) return null; return textPoint(c,renderedOffset(mapOf(i),off)); }
function setSel(a,f,focus=true){
  if(!lines.length) return; f=f||a; a=fixHidden(clampPos(a)); f=fixHidden(clampPos(f));
  const s=mkSel(a,f);
  const A=domPoint(a.i,a.off), F=domPoint(f.i,f.off); if(!A||!F) return;
  if(focus&&document.activeElement!==editor) editor.focus({preventScroll:true});
  getSelection().setBaseAndExtent(A.node,A.off,F.node,F.off);
  lastSel=s;
  const row=editor.children[f.i]; if(row) row.scrollIntoView({block:'nearest'});
  if(find.open) updateHighlights(); markOutline();
}
function inContent(n){ if(!n) return false; const e=n.nodeType===3?n.parentElement:n; return !!(e&&e.closest&&e.closest('.content')); }
/* after keyboard navigation the caret row must clear the sticky header; on the first row the page scrolls right to the top */
let navPending=false;
function revealCaret(){
  const s=lastSel; if(!s||editor.hidden) return; const row=editor.children[s.f.i]; if(!row) return;
  if(s.f.i===nextVisible(-1)){ if(main.scrollTop>0) main.scrollTo({top:0}); return; }
  const mr=main.getBoundingClientRect(), top=mr.top+(crumbEl.hidden?0:crumbEl.offsetHeight)+8, r=row.getBoundingClientRect();
  if(r.top<top) main.scrollBy(0,r.top-top-8); else if(r.bottom>mr.bottom-8) main.scrollBy(0,r.bottom-mr.bottom+16);
}
function syncSel(){
  if(composing) return; const s=getSel(); if(!s) return; lastSel=s; markOutline();
  if(navPending){ navPending=false; revealCaret(); }
  /* a caret that landed between rows (gutter, marker, row edge) is snapped back into the nearest content cell */
  if(!mouseDown&&s.collapsed&&document.activeElement===editor&&!inContent(getSelection().focusNode)) setSel(s.f);
}
document.addEventListener('selectionchange',syncSel,sig);
document.addEventListener('mousedown',e=>{ if(e.button===0) mouseDown=true; },sig);
document.addEventListener('mouseup',()=>{ mouseDown=false; setTimeout(syncSel,0); },sig);
window.addEventListener('blur',()=>{ mouseDown=false; },sig);
/* ---------- dirty state and history ---------- */
function markDirty(){ const d=D(); if(!d.dirty){ d.dirty=true; renderTabsAll(); } scheduleDraft(); scheduleAutosave(); mirror(); }
function setClean(){ D().dirty=false; renderTabsAll(); scheduleDraft(); }
/* the same note open in another pane follows this one */
function mirror(){ for(const p of panes) if(p!==P&&p.D()===D()) p.refresh(); }
function commit(){ render(); markDirty(); }
function snapshot(){ return {lines:lines.map(l=>({text:l.text,collapsed:l.collapsed})),sel:lastSel}; }
function pushHistory(){ undo.push(snapshot()); if(undo.length>300) undo.shift(); redo.length=0; typing=false; clearTimeout(typingTimer); }
function beginTyping(){ if(!typing){ pushHistory(); typing=true; } clearTimeout(typingTimer); typingTimer=setTimeout(()=>{typing=false;},700); }
function restore(s){ setLines(s.lines.map(l=>({text:l.text,collapsed:l.collapsed}))); commit(); if(s.sel) setSel(s.sel.a,s.sel.f); }
function doUndo(){ if(!undo.length) return; redo.push(snapshot()); restore(undo.pop()); typing=false; }
function doRedo(){ if(!redo.length) return; undo.push(snapshot()); restore(redo.pop()); typing=false; }
/* ---------- editing operations ---------- */
function deleteRange(st,en){
  if(st.i===en.i){ const p=parseAt(st.i); p.body=p.body.slice(0,st.off)+p.body.slice(en.off); lines[st.i].text=build(p); return st; }
  const ps=parseAt(st.i), pe=parseAt(en.i); let p;
  if(st.off===0){ const rest=pe.body.slice(en.off); p=(pe.raw||rest==='')?{type:'p',indent:0,level:0,checked:null,body:rest}:Object.assign(pe,{body:rest}); }
  else { p=ps; p.body=ps.body.slice(0,st.off)+pe.body.slice(en.off); }
  lines[st.i].text=build(p); lines[st.i].collapsed=false; lines.splice(st.i+1,en.i-st.i); return st;
}
function convertPrefix(p,nb){
  if(p.raw) return 0; let m=null;
  if(p.type==='p'&&(m=/^(#{1,6}) /.exec(nb))){ p.type='h'; p.level=m[1].length; p.indent=0; }
  else if(p.type==='p'&&(m=/^> /.exec(nb))){ p.type='q'; }
  else if(p.type==='p'&&(m=/^[-*+] /.exec(nb))){ p.type='ul'; }
  else if(p.type==='p'&&(m=/^(\d+)[.)] /.exec(nb))){ p.type='ol'; p.num=+m[1]; }
  else if(p.type!=='h'&&p.type!=='q'&&p.checked==null&&(m=/^\[( |x)?\] /i.exec(nb))){ if(p.type==='p') p.type='ul'; p.checked=/x/i.test(m[1]||''); }
  return m?m[0].length:0;
}
function doInsert(rng,text){
  if(!text){ if(!rng.collapsed){ pushHistory(); const st=deleteRange(rng.start,rng.end); commit(); setSel(st); } return; }
  const multi=text.includes('\n');
  if(multi||!rng.collapsed) pushHistory(); else beginTyping();
  let st=rng.start; if(!rng.collapsed) st=deleteRange(rng.start,rng.end);
  const p=parseAt(st.i);
  if(!multi){
    let nb=p.body.slice(0,st.off)+text+p.body.slice(st.off), caret=st.off+text.length;
    const ex=/\s$/.test(text)?expandDateBefore(nb,caret,true):null; if(ex){ nb=ex.nb; caret=ex.caret; }
    const cut=convertPrefix(p,nb);
    if(cut){ p.body=nb.slice(cut); lines[st.i].text=build(p); typing=false; commit(); setSel({i:st.i,off:Math.max(0,caret-cut)}); return; }
    p.body=nb; lines[st.i].text=build(p);
    if(rng.collapsed&&!ex){ renderRow(st.i); markDirty(); } else commit();
    setSel({i:st.i,off:caret}); return;
  }
  const parts=text.split('\n'); const tail=p.body.slice(st.off); p.body=p.body.slice(0,st.off)+parts[0]; lines[st.i].text=build(p);
  const add=parts.slice(1).map(t=>({text:t,collapsed:false})); add[add.length-1].text+=tail; lines.splice(st.i+1,0,...add);
  commit(); setSel({i:st.i+add.length,off:parts[parts.length-1].length});
}
function doEnter(s){
  pushHistory(); let st=s.start; if(!s.collapsed) st=deleteRange(s.start,s.end);
  const i=st.i, p=parseAt(i); let body=p.body;
  if(!p.raw){ const ex=expandDateBefore(body,st.off,false); if(ex){ body=ex.nb; st={i,off:ex.caret}; } }
  if(p.type!=='p'&&p.type!=='h'&&!p.raw&&body===''){ if(p.indent>0) p.indent--; else { p.type='p'; p.checked=null; } lines[i].text=build(p); commit(); setSel({i,off:0}); return; }
  const atEnd=st.off>=body.length, atStart=st.off===0&&body.length>0, folded=lines[i].collapsed&&collapsible(i), secEnd=sectionEnd(i);
  const np=Object.assign({},p,{body:body.slice(st.off)});
  p.body=body.slice(0,st.off); lines[i].text=build(p);
  /* Enter at the very start pushes the whole line down, heading level and check state included, and leaves an empty line of the same kind above it */
  if(np.type==='h'&&!atStart){ np.type='p'; np.level=0; }
  if(np.checked!=null&&!atStart) np.checked=false;
  if(np.type==='ol') np.num=(p.num||0)+1;
  if(np.raw){ delete np.raw; np.type='p'; np.indent=0; }
  let at=i+1;
  if(folded&&atEnd) at=secEnd; else lines[i].collapsed=false;
  lines.splice(at,0,{text:build(np),collapsed:atStart&&folded});
  commit(); setSel({i:at,off:0});
}
function prevVisible(i){ for(let j=i-1;j>=0;j--) if(!hiddenArr[j]) return j; return -1; }
function nextVisible(i){ for(let j=i+1;j<lines.length;j++) if(!hiddenArr[j]) return j; return -1; }
function doBackspaceAtStart(i){
  const p=parseAt(i);
  if(!p.raw){
    if(p.type==='h'){ pushHistory(); p.type='p'; p.level=0; lines[i].text=build(p); lines[i].collapsed=false; commit(); setSel({i,off:0}); return; }
    /* the checkbox comes off first, with its bullet; a numbered item keeps its number */
    if(isList(p)&&p.checked!=null){ pushHistory(); dropCheck(p); lines[i].text=build(p); commit(); setSel({i,off:0}); return; }
    if(p.type!=='p'){ pushHistory(); p.type='p'; p.checked=null; lines[i].text=build(p); commit(); setSel({i,off:0}); return; }
    if(p.indent>0){ pushHistory(); p.indent--; lines[i].text=build(p); commit(); setSel({i,off:0}); return; }
  }
  /* an empty line at the end of the file just goes away, and the caret lands at the end of the line above; a fold that hides that line opens */
  if(p.body===''&&i===lines.length-1&&i>0){
    pushHistory(); lines.splice(i,1); const k=i-1;
    for(let m=k-1;m>=0;m--) if(lines[m].collapsed&&collapsible(m)&&sectionEnd(m)>k) lines[m].collapsed=false;
    commit(); setSel({i:k,off:parseAt(k).body.length}); return;
  }
  const j=prevVisible(i); if(j<0) return;
  const pj=parseAt(j); pushHistory(); const off=pj.body.length; pj.body+=p.body; lines[j].text=build(pj); lines.splice(i,1); commit(); setSel({i:j,off});
}
function doDeleteAtEnd(i){
  const j=nextVisible(i); if(j!==i+1) return;
  const p=parseAt(i), pj=parseAt(j); pushHistory(); const off=p.body.length; p.body+=pj.body; lines[i].text=build(p); lines.splice(j,1); commit(); setSel({i,off});
}
function indentRows(s,d){
  const rows=[]; for(let i=s.start.i;i<=s.end.i;i++) rows.push(i);
  const changes=[];
  for(const i of rows){
    const p=parseAt(i); if(p.raw) continue;
    if(p.type==='h'){ const nl=p.level+d; if(nl<1||nl>6) continue; p.level=nl; changes.push([i,p]); continue; }
    const ni=p.indent+d; if(ni<0||ni>8) continue;
    if(d>0&&isList(p)&&!rows.includes(i-1)){
      let j=i-1; while(j>=0&&lines[j].text.trim()==='') j--;
      if(j<0) continue; const pp=parseAt(j); if(pp.type==='h'||pp.raw||ni>pp.indent+1) continue;
    }
    p.indent=ni; changes.push([i,p]);
  }
  if(!changes.length) return;
  pushHistory(); for(const [i,p] of changes) lines[i].text=build(p);
  commit(); setSel(s.a,s.f);
}
function toggleCheckRange(s){
  const first=parseAt(s.start.i); const val=first.checked==null?false:!first.checked; const ch=[];
  for(let i=s.start.i;i<=s.end.i;i++){ const p=parseAt(i); if(p.type==='h'||p.raw) continue; if(!isList(p)){ if(p.body===''&&s.start.i!==s.end.i) continue; p.type='ul'; } p.checked=val; ch.push([i,p]); }
  if(!ch.length) return; pushHistory(); for(const [i,p] of ch) lines[i].text=build(p); commit(); setSel(s.a,s.f);
}
/* a checkbox goes on a bullet, so taking it off a bullet leaves a plain line; a numbered item keeps its number */
function dropCheck(p){ p.checked=null; if(p.type==='ul') p.type='p'; }
function toggleCheck(i,val,refocus){
  const p=parseAt(i); if(p.type==='h'||p.raw) return; pushHistory();
  if(!isList(p)) p.type='ul'; p.checked=val==null?!p.checked:!!val; lines[i].text=build(p); commit();
  if(refocus&&lastSel) setSel(lastSel.a,lastSel.f);
}
/* adds a checkbox to the selected lines, or removes it when the first line already has one */
function toggleCheckbox(s){
  const remove=parseAt(s.start.i).checked!=null, ch=[];
  for(let i=s.start.i;i<=s.end.i;i++){
    const p=parseAt(i); if(p.type==='h'||p.raw) continue;
    if(remove){ if(p.checked==null) continue; dropCheck(p); }
    else { if(p.checked!=null||(p.body===''&&s.start.i!==s.end.i)) continue; if(!isList(p)) p.type='ul'; p.checked=false; }
    ch.push([i,p]);
  }
  if(!ch.length) return; pushHistory(); for(const [i,p] of ch) lines[i].text=build(p); commit(); setSel(s.a,s.f);
}
function removeCheckbox(i){ const p=parseAt(i); if(p.checked==null||p.raw) return; pushHistory(); dropCheck(p); lines[i].text=build(p); commit(); if(lastSel) setSel(lastSel.a,lastSel.f,document.activeElement===editor); }
/* word boundaries for Ctrl+Backspace and Ctrl+Delete: whitespace, then a run of word characters or a run of punctuation */
const isW=ch=>/[\p{L}\p{N}_]/u.test(ch);
function wordStart(b,k){ while(k>0&&/\s/.test(b[k-1])) k--; if(k>0&&isW(b[k-1])){ while(k>0&&isW(b[k-1])) k--; } else { while(k>0&&!/\s/.test(b[k-1])&&!isW(b[k-1])) k--; } return k; }
function wordEnd(b,k){ while(k<b.length&&/\s/.test(b[k])) k++; if(k<b.length&&isW(b[k])){ while(k<b.length&&isW(b[k])) k++; } else { while(k<b.length&&!/\s/.test(b[k])&&!isW(b[k])) k++; } return k; }
/* a range that touches a date chip grows to cover the whole chip, so chips always go in one piece */
function withChips(body,a,b){ const re=/@\d{4}-\d{2}-\d{2}(?![\w-])/g; let m; while((m=re.exec(body))){ const ms=m.index, me=ms+m[0].length; if(a<me&&b>ms){ a=Math.min(a,ms); b=Math.max(b,me); } } return [a,b]; }
function deleteIn(i,a,b){ if(a===b) return; [a,b]=withChips(parseAt(i).body,a,b); pushHistory(); deleteRange({i,off:a},{i,off:b}); commit(); setSel({i,off:a}); acCheck(); }
function deleteWord(s,dir,toEdge){
  if(!s.collapsed){ pushHistory(); const st=deleteRange(s.start,s.end); commit(); setSel(st); return; }
  const i=s.a.i, body=parseAt(i).body, off=s.a.off;
  if(dir<0){ if(off===0){ doBackspaceAtStart(i); return; } deleteIn(i,toEdge?0:wordStart(body,off),off); }
  else { if(off>=body.length){ doDeleteAtEnd(i); return; } deleteIn(i,off,toEdge?body.length:wordEnd(body,off)); }
}
/* an empty line of the same kind below (or above) the caret's line, without splitting it */
function insertLine(s,dir){
  const i=s.f.i, p=parseAt(i); pushHistory();
  const np={type:p.raw||p.type==='h'||p.type==='q'?'p':p.type,level:0,indent:p.raw?0:p.indent,checked:p.checked==null?null:false,num:(p.num||0)+1,body:''};
  let at=dir<0?i:spanEnd(i);
  lines.splice(at,0,{text:build(np),collapsed:false}); commit(); setSel({i:at,off:0});
}
function duplicateLines(s){
  const a=s.start.i, b=spanEnd(s.end.i); pushHistory();
  lines.splice(b,0,...lines.slice(a,b).map(l=>({text:l.text,collapsed:l.collapsed})));
  commit(); const d=b-a; setSel({i:s.a.i+d,off:s.a.off},{i:s.f.i+d,off:s.f.off});
}
function cyclePri(s,d){
  const i=s.f.i, p=parseAt(i); if(p.raw) return;
  const m=RE_PRI.exec(p.body), n=m?m[1].length:0, n2=Math.max(0,Math.min(3,n+d)); if(n===n2) return;
  pushHistory(); let body=p.body, caret=s.f.i===i?s.f.off:0;
  if(m){
    let a=m.index, b=a+m[0].length;
    if(!n2){ if(a>0&&body[a-1]===' ') a--; else if(body[b]===' ') b++; }
    body=body.slice(0,a)+'!'.repeat(n2)+body.slice(b);
    if(caret>a) caret=Math.max(a,caret+body.length-p.body.length);
  } else { const tr=body.replace(/\s+$/,''); body=tr+(tr?' ':'')+'!'.repeat(n2); }
  p.body=body; lines[i].text=build(p); commit(); setSel({i,off:Math.min(caret,body.length)});
}
function toggleHeading(s,level){
  const i=s.start.i, p=parseAt(i); if(p.raw) return; pushHistory();
  if(p.type==='h'&&(level==null||p.level===level)){ p.type='p'; p.level=0; }
  else if(p.type==='h') p.level=level;
  else { let lv=level||1; if(!level) for(let j=i-1;j>=0;j--){ const q=parseAt(j); if(q.type==='h'){ lv=q.level; break; } } p.type='h'; p.level=lv; p.indent=0; p.checked=null; }
  lines[i].text=build(p); lines[i].collapsed=false; commit();
  const L=p.body.length; setSel({i:s.a.i===i?i:s.a.i,off:Math.min(s.a.off,L)},{i:s.f.i===i?i:s.f.i,off:Math.min(s.f.off,L)});
}
function collapseCurrent(s){
  let j=foldTarget(s.f.i); if(j<0) return;
  if(lines[j].collapsed){ let k=-1; for(let t=j-1;t>=0;t--) if(collapsible(t)&&sectionEnd(t)>j){ k=t; break; } if(k<0) return; j=k; }
  lines[j].collapsed=true; render(); scheduleDraft(); mirror();
  /* the caret stays put on the heading; from inside the folded section it moves up to the same column */
  if(s.a.i===j&&s.f.i===j) setSel(s.a,s.f); else setSel({i:j,off:Math.min(s.f.off,parseAt(j).body.length)});
}
function expandCurrent(s){
  const j=s.f.i; if(!(collapsible(j)&&lines[j].collapsed)) return;
  lines[j].collapsed=false; render(); scheduleDraft(); mirror(); setSel(s.a,s.f);
}
function foldTarget(i){ if(collapsible(i)) return i; for(let j=i-1;j>=0;j--) if(collapsible(j)&&sectionEnd(j)>i) return j; return -1; }
function toggleFold(j){ lines[j].collapsed=!lines[j].collapsed; render(); scheduleDraft(); mirror(); }
function foldCurrent(s){ const j=foldTarget(s.f.i); if(j<0) return; toggleFold(j); if(hiddenArr[s.f.i]) setSel({i:j,off:Math.min(s.f.off,parseAt(j).body.length)}); else setSel(s.a,s.f); }
function foldAll(){ const collapse=foldState.anyExpanded; for(let i=0;i<lines.length;i++) if(collapsible(i)) lines[i].collapsed=collapse; render(); scheduleDraft(); mirror(); if(lastSel) setSel(lastSel.a,lastSel.f,document.activeElement===editor); }
function wrapSel(s,mark){
  const i=s.start.i, p=parseAt(i); if(p.raw) return;
  let a=s.start.off, b=(s.end.i===i)?s.end.off:p.body.length; const body=p.body, L=mark.length;
  if(b-a>L&&body.slice(b-L,b)===mark&&body.slice(a-L,a)===mark&&body.slice(a,a+L)!==mark) b-=L;
  if(b-a>L&&body.slice(a,a+L)===mark&&body.slice(b,b+L)===mark&&body.slice(b-L,b)!==mark) a+=L;
  const inner=body.slice(a,b);
  pushHistory(); let nb,sa,sb;
  if(inner.length>=2*L&&inner.startsWith(mark)&&inner.endsWith(mark)){ nb=body.slice(0,a)+inner.slice(L,inner.length-L)+body.slice(b); sa=a; sb=b-2*L; }
  else if(a>=L&&body.slice(a-L,a)===mark&&body.slice(b,b+L)===mark){ nb=body.slice(0,a-L)+inner+body.slice(b+L); sa=a-L; sb=b-L; }
  else { nb=body.slice(0,a)+mark+inner+mark+body.slice(b); sa=a+L; sb=b+L; }
  p.body=nb; lines[i].text=build(p); markDirty(); setSel({i,off:sa},{i,off:sb}); renderRow(i); setSel({i,off:sa},{i,off:sb});
}
function makeLink(s){
  const i=s.start.i, p=parseAt(i); if(p.raw) return;
  const a=s.start.off, b=(s.end.i===i)?s.end.off:p.body.length, t=p.body.slice(a,b);
  if(s.collapsed){
    const re=/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g; let m;
    while((m=re.exec(p.body))){ if(a>=m.index&&a<=m.index+m[0].length){
      const url=prompt('Link address (leave empty to remove the link)',m[2]); if(url===null) return;
      pushHistory(); const rep=url.trim()?'['+m[1]+']('+url.trim()+')':m[1];
      p.body=p.body.slice(0,m.index)+rep+p.body.slice(m.index+m[0].length); lines[i].text=build(p); markDirty(); renderRow(i); setSel({i,off:m.index+rep.length}); return; } }
  }
  pushHistory(); let ins,sa,sb;
  if(!t){ ins='[text](url)'; sa=a+1; sb=a+5; }
  else if(/^https?:\/\/\S+$/.test(t)){ ins='[text]('+t+')'; sa=a+1; sb=a+5; }
  else { ins='['+t+'](url)'; sa=a+t.length+3; sb=sa+3; }
  p.body=p.body.slice(0,a)+ins+p.body.slice(b); lines[i].text=build(p); markDirty(); renderRow(i); setSel({i,off:sa},{i,off:sb});
}
function cycleDue(s){
  const i=s.start.i, p=parseAt(i); if(p.raw) return;
  const t0=shiftDate(0), t1=shiftDate(1), t7=shiftDate(7), m=RE_DUE.exec(p.body);
  pushHistory(); let caret=s.f.i===i?s.f.off:p.body.length;
  if(m){ const next=m[1]===t0?t1:(m[1]===t1?t7:t0); p.body=p.body.slice(0,m.index)+'@'+next+p.body.slice(m.index+m[0].length); }
  else { const tr=p.body.replace(/\s+$/,''); p.body=tr+(tr?' ':'')+'@'+t0; caret=p.body.length; }
  lines[i].text=build(p); markDirty(); renderRow(i); setSel({i,off:Math.min(caret,p.body.length)});
}
function setDue(i,st,en,iso){
  const p=parseAt(i); let s=st, e=en, body=p.body;
  if(!iso){ if(s>0&&body[s-1]===' ') s--; else if(body[e]===' ') e++; }
  pushHistory(); p.body=body.slice(0,s)+(iso?'@'+iso:'')+body.slice(e); lines[i].text=build(p); commit();
  return {s,e:iso?s+iso.length+1:s};
}
function rangeText(st,en){
  if(st.i===en.i) return parseAt(st.i).body.slice(st.off,en.off);
  const out=[];
  for(let i=st.i;i<=en.i;i++){
    const p=parseAt(i), t=lines[i].text, pre=t.slice(0,t.length-p.body.length);
    if(i===st.i) out.push(st.off===0?t:p.body.slice(st.off));
    else if(i===en.i) out.push(pre+p.body.slice(0,en.off));
    else out.push(t);
  }
  return out.join('\n');
}
/* ---- moving blocks ---- */
function blockEnd(i){ return collapsible(i)?Math.max(i+1,sectionEnd(i)):i+1; }
/* where a block starting at b0 lands when it moves up: over the whole sibling block above it, not into it */
function upTarget(b0){
  if(b0===0) return -1;
  let k=b0-1;
  for(let j=b0-1;j>=0;j--){ if(!collapsible(j)) continue; const e=sectionEnd(j); if(e===b0) k=j; else if(e>b0) break; }
  return k;
}
function moveBlock(s,dir){
  const b0=s.start.i, b1=Math.max(blockEnd(s.end.i),s.end.i+1); let ins;
  if(dir<0){
    ins=upTarget(b0); if(ins<0) return;
  } else { if(b1>=lines.length) return; ins=blockEnd(b1)-(b1-b0); }
  pushHistory(); const block=lines.splice(b0,b1-b0); lines.splice(ins,0,...block);
  const d=ins-b0; commit(); setSel({i:s.a.i+d,off:s.a.off},{i:s.f.i+d,off:s.f.off});
}
/* ---- sorting a section ---- */
function sortSection(s,mode){
  const i=s.f.i, p=parseAt(i); let from, to;
  const stops=(q,d)=>q.raw||q.type==='h'||(q.body!==''&&q.indent<d)||(q.type==='p'&&q.body!==''&&q.indent<=d);
  if(isList(p)){
    from=i; while(from>0&&!stops(parseAt(from-1),p.indent)) from--;
    to=i+1; while(to<lines.length&&!stops(parseAt(to),p.indent)) to++;
  } else {
    let h=-1; for(let j=i;j>=0;j--) if(parseAt(j).type==='h'){ h=j; break; }
    from=h+1; to=h>=0?sectionEnd(h):lines.length;
  }
  const blank=j=>{ const q=parseAt(j); return q.type==='p'&&q.body===''&&!q.raw; };
  while(to>from&&blank(to-1)) to--;   /* trailing blank lines stay where they are */
  const blocks=[]; let j=from;
  while(j<to){
    if(blank(j)&&blocks.length){ blocks[blocks.length-1].e=j+1; j++; continue; }
    let e=collapsible(j)?Math.max(j+1,sectionEnd(j)):j+1; if(e>to) e=to;
    blocks.push({s:j,e,q:parseAt(j)}); j=e;
  }
  if(blocks.length<2) return;
  const key=b=>{ const q=b.q;
    if(mode==='date'){ const d=q.raw?null:dueOf(q.body); return {r:d?0:1,t:d||''}; }
    if(mode==='done') return {r:q.checked===false?0:(q.checked==null?1:2),t:''};
    if(mode==='pri') return {r:3-(q.raw?0:priOf(q.body)),t:''};
    return {r:0,t:plainText(q.body).toLowerCase()}; };
  const order=blocks.map((b,k)=>({b,k,key:key(b)})).sort((x,y)=>x.key.r-y.key.r||x.key.t.localeCompare(y.key.t,undefined,{numeric:mode==='alpha',sensitivity:'base'})||x.k-y.k);
  if(order.every((o,k)=>o.k===k)) return;
  pushHistory();
  const out=[]; let caret=null;
  for(const o of order){ if(i>=o.b.s&&i<o.b.e) caret=from+out.length+(i-o.b.s); out.push(...lines.slice(o.b.s,o.b.e)); }
  lines.splice(from,to-from,...out); commit();
  setSel({i:caret==null?i:caret,off:s.f.off});
}
/* Dragging offers exactly the places Alt+Up / Alt+Down can put the block and no others, so a row
   never lands between a parent and its own children unless it already belongs there. */
function dragGaps(src){
  const b0=src, b1=blockEnd(src), gaps=new Set();
  /* down: hop over one whole block at a time. The rows past the block keep their indices and their
     sections, so every landing place can be read straight off the note as it stands. */
  for(let g=b1;g<lines.length;){ const e=blockEnd(g); if(e<=g) break; gaps.add(e); g=e; }
  /* up: each hop changes what sits above the block, so walk it on a copy of the note */
  const keepLines=lines, keepFenced=fenced;
  try{
    lines=lines.slice(); computeFences();
    for(let at=b0;at>0;){
      const g=upTarget(at); if(g<0||g>=at) break;
      gaps.add(g);
      lines.splice(g,0,...lines.splice(at,b1-b0)); computeFences(); at=g;
    }
  } finally { lines=keepLines; fenced=keepFenced; }
  return gaps;
}
function moveBlockTo(srcRow,ins){
  const b0=srcRow, b1=blockEnd(srcRow);
  if(ins>=b0&&ins<=b1) return;
  pushHistory(); const block=lines.splice(b0,b1-b0); if(ins>b1) ins-=(b1-b0); lines.splice(ins,0,...block);
  commit(); setSel({i:ins,off:0});
}
/* ---------- editor events ---------- */
let refocus=false, dragSrc=-1, dropRow=null, dropIns=-1, dropOk=null;
editor.addEventListener('mousedown',e=>{
  acHide();
  const a=e.target.closest('a');
  if(a&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); if(a.dataset.wiki!=null) openWiki(a.dataset.wiki,e.altKey?'tab':undefined); else if(a.classList.contains('img')) mediaUrl(a.dataset.embed||a.getAttribute('href'),D()).then(u=>{ if(u) window.open(u,'_blank'); }); else window.open(a.href,'_blank','noopener'); return; }
  const tg=e.target.closest('.tag');
  if(tg&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); toggleFilterTag(tg.textContent.slice(1).toLowerCase()); return; }
  const chip=e.target.closest('.due');
  if(chip&&e.button===0&&!(e.ctrlKey||e.metaKey)){ e.preventDefault(); openDatePop(chip); return; }
  if(e.target.closest('.gutter')) refocus=document.activeElement===editor;
});
/* caret movement across row edges and over date chips, which the browser cannot do on its own */
function renderedFocus(c){ const s=getSelection(); if(!s.rangeCount) return null; const n=s.focusNode; if(!n||(n!==c&&!c.contains(n))) return null; const r=document.createRange(); r.setStart(c,0); try{ r.setEnd(n,s.focusOffset); }catch(_){ return null; } return r.toString().length; }
function chipJump(c,k,dir){
  for(const ch of c.querySelectorAll('.due')){ const r=document.createRange(); r.setStart(c,0); r.setEndBefore(ch); const rs=r.toString().length, re=rs+ch.textContent.length; if(dir>0&&k>=rs&&k<re) return re; if(dir<0&&k>rs&&k<=re) return rs; }
  return null;
}
function arrowLR(e,s,dir){
  const i=s.f.i, c=contentOf(i); if(!c) return false;
  const map=mapOf(i); let k=renderedFocus(c); if(k==null) k=renderedOffset(map,s.f.off);
  const len=c.textContent.length; let to=null;
  const cj=chipJump(c,k,dir);
  if(cj!=null) to={i,off:map[Math.min(cj,map.length-1)]};
  else if(dir>0&&k>=len){ const j=nextVisible(i); to=j<0?{i,off:parseAt(i).body.length}:{i:j,off:0}; }
  else if(dir<0&&k<=0){ const j=prevVisible(i); to=j<0?{i,off:0}:{i:j,off:parseAt(j).body.length}; }
  if(!to) return false;
  e.preventDefault(); if(e.shiftKey) setSel(s.a,to); else setSel(to); return true;
}
editor.addEventListener('click',e=>{
  const im=e.target.closest&&e.target.closest('.media img'); if(im&&im.src){ window.open(im.src,'_blank'); return; }
  if(e.target.type==='checkbox'&&e.altKey){ e.preventDefault(); removeCheckbox(+e.target.closest('.row').dataset.i); return; }
  const chev=e.target.closest('.chev'); if(!chev) return;
  const i=+chev.closest('.row').dataset.i, s=lastSel; toggleFold(i);
  if(refocus&&s){ const f=hiddenArr[s.f.i]?{i,off:Math.min(s.f.off,parseAt(i).body.length)}:s.f; setSel(hiddenArr[s.a.i]?f:s.a,f); }
});
editor.addEventListener('change',e=>{ if(e.target.type==='checkbox'){ toggleCheck(+e.target.closest('.row').dataset.i,e.target.checked,refocus); } });
/* right-click: the common line actions, on the row under the pointer; Shift keeps the browser's menu and its spelling suggestions */
editor.addEventListener('contextmenu',e=>{
  if(e.shiftKey||sourceOn) return; e.preventDefault();
  const row=e.target.closest('.row'), s=getSel();
  if(row){ const i=+row.dataset.i; if(!s||i<s.start.i||i>s.end.i) setSel({i,off:parseAt(i).body.length}); else lastSel=s; }
  let x=e.clientX, y=e.clientY;
  if(!x&&!y){ const r=getSelection().rangeCount?getSelection().getRangeAt(0).getBoundingClientRect():null; if(r&&r.height){ x=r.left; y=r.bottom+4; } }
  showContextMenu(x,y);
});

/* drag and drop of rows */
editor.addEventListener('dragstart',e=>{
  const h=e.target.closest&&e.target.closest('.handle'); if(!h){ if(e.target.closest&&e.target.closest('.content')) return; e.preventDefault(); return; }
  dragSrc=+h.closest('.row').dataset.i; dropOk=dragGaps(dragSrc); e.dataTransfer.setData('text/plain','⠿'); e.dataTransfer.effectAllowed='move'; h.closest('.row').classList.add('dragging');
});
function clearDrop(){ if(dropRow){ dropRow.classList.remove('drop-before','drop-after'); dropRow=null; } dropIns=-1; }
/* the gap under a row and the gap over the next visible one are one place, so both draw the same line and drop alike */
editor.addEventListener('dragover',e=>{
  if(dragSrc<0) return; e.preventDefault(); e.dataTransfer.dropEffect='move';
  const row=e.target.closest&&e.target.closest('.row'); clearDrop(); if(!row) return;
  const i=+row.dataset.i, r=row.getBoundingClientRect();
  let ins=i;
  if(e.clientY>r.top+r.height/2){ ins=lines.length; for(let j=i+1;j<lines.length;j++) if(!hiddenArr[j]){ ins=j; break; } }
  if(!dropOk||!dropOk.has(ins)){ e.dataTransfer.dropEffect='none'; return; }
  if(ins<lines.length){ dropRow=editor.children[ins]; dropRow.classList.add('drop-before'); }
  else { dropRow=row; dropRow.classList.add('drop-after'); }
  dropIns=ins;
});
editor.addEventListener('dragleave',e=>{ if(!editor.contains(e.relatedTarget)) clearDrop(); });
editor.addEventListener('drop',e=>{
  if(dragSrc<0) return; e.preventDefault();
  const ins=dropIns; clearDrop(); dropOk=null;
  const src=dragSrc; dragSrc=-1; editor.querySelectorAll('.dragging').forEach(x=>x.classList.remove('dragging'));
  if(ins>=0) moveBlockTo(src,ins);
});
editor.addEventListener('dragend',()=>{ dragSrc=-1; dropOk=null; clearDrop(); editor.querySelectorAll('.dragging').forEach(x=>x.classList.remove('dragging')); });

editor.addEventListener('beforeinput',e=>{
  const t=e.inputType;
  if(t==='insertCompositionText'||t==='deleteCompositionText') return;
  if(t==='historyUndo'){ e.preventDefault(); doUndo(); return; }
  if(t==='historyRedo'){ e.preventDefault(); doRedo(); return; }
  e.preventDefault();
  if(t==='insertFromDrop'||t==='deleteByDrag'||t==='insertFromPaste'||t==='insertFromYank') return;
  const s=getSel(); if(!s) return;
  let rng=s; const trs=e.getTargetRanges?e.getTargetRanges():[];
  if(trs.length){ const a=posFromDom(trs[0].startContainer,trs[0].startOffset), b=posFromDom(trs[0].endContainer,trs[0].endOffset); if(a&&b) rng=mkSel(a,b); }
  if(t==='insertParagraph'||t==='insertLineBreak'){ doEnter(s); return; }
  if(t==='insertText'||t==='insertReplacementText'){ const text=e.data!=null?e.data:(e.dataTransfer?e.dataTransfer.getData('text/plain'):''); doInsert(rng,text.replace(/\r\n?/g,'\n')); acCheck(); return; }
  if(t.startsWith('delete')){
    const back=t==='deleteContentBackward'||t==='deleteWordBackward'||t==='deleteSoftLineBackward'||t==='deleteHardLineBackward';
    if(s.collapsed){
      const len=parseAt(s.a.i).body.length;
      if(back&&s.a.off===0){ doBackspaceAtStart(s.a.i); acHide(); return; }
      if(!back&&s.a.off>=len){ doDeleteAtEnd(s.a.i); acHide(); return; }
      if(rng.collapsed) rng=back?mkSel({i:s.a.i,off:s.a.off-1},s.a):mkSel(s.a,{i:s.a.i,off:s.a.off+1});
      if(rng.start.i===rng.end.i){ const body=parseAt(s.a.i).body, re=/@\d{4}-\d{2}-\d{2}(?![\w-])/g; let m; while((m=re.exec(body))){ const ms=m.index, me=ms+m[0].length; if(rng.start.off<me&&rng.end.off>ms){ rng=mkSel({i:s.a.i,off:Math.min(ms,rng.start.off)},{i:s.a.i,off:Math.max(me,rng.end.off)}); break; } } }
    }
    if(rng.collapsed) return;
    pushHistory(); const st=deleteRange(rng.start,rng.end); commit(); setSel(st); acCheck(); return;
  }
  if(t==='formatBold'){ wrapSel(s,'**'); return; }
  if(t==='formatItalic'){ wrapSel(s,'*'); return; }
});
editor.addEventListener('keydown',e=>{
  const mod=e.ctrlKey||e.metaKey;
  if(ac.open){
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){ e.preventDefault(); ac.idx=(ac.idx+(e.key==='ArrowDown'?1:-1)+ac.items.length)%ac.items.length; acRender(); return; }
    if((e.key==='Enter'||e.key==='Tab')&&!mod){ e.preventDefault(); acAccept(); return; }
    if(e.key==='Escape'){ e.preventDefault(); acHide(); return; }
    if(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='Home'||e.key==='End') acHide();
  }
  if(e.key==='Escape'&&find.open){ e.preventDefault(); closeFind(); return; }
  if(e.key==='Escape'&&settings.filter.on){ e.preventDefault(); closeFilter(); return; }
  const s=getSel(); if(!s) return;
  if(!mod&&!e.altKey&&/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End)$/.test(e.key)){
    navPending=true; setTimeout(()=>{ navPending=false; },150);
    if(e.key==='ArrowUp'&&s.f.i===nextVisible(-1)) requestAnimationFrame(()=>{ if(main.scrollTop>0) main.scrollTo({top:0}); });
  }
  if(mod&&!e.altKey&&(e.key==='Home'||e.key==='End')){
    e.preventDefault(); const home=e.key==='Home', j=home?nextVisible(-1):prevVisible(lines.length); if(j<0) return;
    const to={i:j,off:home?0:parseAt(j).body.length}; setSel(e.shiftKey?s.a:to,to); if(home) main.scrollTo({top:0}); else revealCaret(); return;
  }
  if((e.key==='ArrowRight'||e.key==='ArrowLeft')&&!mod&&!e.altKey&&(s.collapsed||e.shiftKey)){ if(arrowLR(e,s,e.key==='ArrowRight'?1:-1)) return; }
  if(e.key==='Enter'&&!mod&&!e.altKey){ e.preventDefault(); doEnter(s); return; }
  if(e.key==='Enter'&&mod&&!e.altKey){ e.preventDefault(); acHide(); insertLine(s,e.shiftKey?-1:1); return; }
  if(e.key==='Tab'&&!mod){ e.preventDefault(); indentRows(s,e.shiftKey?-1:1); return; }
  if(e.key==='Backspace'&&!mod&&!e.altKey&&s.collapsed&&s.a.off===0){ e.preventDefault(); doBackspaceAtStart(s.a.i); return; }
  if(e.key==='Delete'&&!mod&&!e.altKey&&s.collapsed&&s.a.off>=parseAt(s.a.i).body.length){ e.preventDefault(); doDeleteAtEnd(s.a.i); return; }
  if((e.key==='Backspace'||e.key==='Delete')&&mod&&!e.altKey){ e.preventDefault(); acHide(); deleteWord(s,e.key==='Backspace'?-1:1,e.shiftKey); return; }
  if(mod&&e.shiftKey&&!e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){ e.preventDefault(); cyclePri(s,e.key==='ArrowUp'?1:-1); return; }
  if(mod&&e.shiftKey&&(e.code==='Space'||e.key===' ')){ e.preventDefault(); toggleCheckbox(s); return; }
  if(mod&&(e.code==='Space'||e.key===' ')){ e.preventDefault(); toggleCheckRange(s); return; }
  if(mod&&e.code==='Period'){ e.preventDefault(); if(e.shiftKey) foldAll(); else foldCurrent(s); return; }
  if(mod&&!e.altKey){
    const k=e.key.toLowerCase();
    if(!e.shiftKey&&k==='b'){ e.preventDefault(); wrapSel(s,'**'); return; }
    if(!e.shiftKey&&k==='i'){ e.preventDefault(); wrapSel(s,'*'); return; }
    if(!e.shiftKey&&k==='e'){ e.preventDefault(); wrapSel(s,'`'); return; }
    if(!e.shiftKey&&k==='k'){ e.preventDefault(); makeLink(s); return; }
    if(e.shiftKey&&k==='x'){ e.preventDefault(); wrapSel(s,'~~'); return; }
    if(e.shiftKey&&k==='d'){ e.preventDefault(); cycleDue(s); return; }
    if(e.shiftKey&&k==='h'){ e.preventDefault(); toggleHeading(s); return; }
    if(e.shiftKey&&/^Digit[1-6]$/.test(e.code)){ e.preventDefault(); toggleHeading(s,+e.code.slice(5)); return; }
  }
});
editor.addEventListener('copy',e=>{ const s=getSel(); if(!s||s.collapsed) return; e.preventDefault(); e.clipboardData.setData('text/plain',rangeText(s.start,s.end)); });
editor.addEventListener('cut',e=>{ const s=getSel(); if(!s||s.collapsed) return; e.preventDefault(); e.clipboardData.setData('text/plain',rangeText(s.start,s.end)); pushHistory(); const st=deleteRange(s.start,s.end); commit(); setSel(st); });
editor.addEventListener('paste',e=>{
  const s=getSel(); if(!s) return; e.preventDefault();
  const imgs=[...(e.clipboardData.files||[])].filter(f=>/^image\//.test(f.type));
  if(imgs.length){ insertImages(imgs,s); return; }
  const text=(e.clipboardData.getData('text/plain')||'').replace(/\r\n?/g,'\n'); if(text) doInsert(s,text);
});
editor.addEventListener('compositionstart',()=>{ composing=true; });
editor.addEventListener('compositionend',()=>{ composing=false; syncRowFromDom(); });
editor.addEventListener('input',e=>{ if(composing||(e.inputType&&e.inputType.startsWith('insertComposition'))) return; syncRowFromDom(); });
function syncRowFromDom(){
  const s=getSel(); if(!s) return; const i=s.f.i, c=contentOf(i); if(!c) return;
  const p=parseAt(i), r=rowRender(i), tmp=document.createElement('div'); tmp.innerHTML=r.html;
  const E=tmp.textContent, A=c.textContent.replace(/\n/g,' ').replace(/ /g,' ');
  if(E===A) return;
  let pre=0; while(pre<E.length&&pre<A.length&&E[pre]===A[pre]) pre++;
  let suf=0; while(suf<E.length-pre&&suf<A.length-pre&&E[E.length-1-suf]===A[A.length-1-suf]) suf++;
  const rs=r.map[Math.min(pre,r.map.length-1)], re=r.map[Math.min(E.length-suf,r.map.length-1)], insText=A.slice(pre,A.length-suf);
  beginTyping(); p.body=p.body.slice(0,rs)+insText+p.body.slice(re); lines[i].text=build(p); markDirty();
  htmlCache.delete(i); renderRow(i); setSel({i,off:rs+insText.length});
}
/* clicking beside a row, anywhere out to the pane's edge, puts the caret at the end of that row */
root.addEventListener('mousedown',e=>{
  if((e.target!==main&&e.target!==editor)||sourceOn||agendaOn||e.button!==0) return; e.preventDefault();
  let at=-1;
  for(const r of editor.children){ if(r.classList.contains('hidden')) continue; const b=r.getBoundingClientRect(); if(e.clientY>=b.top&&e.clientY<=b.bottom){ at=+r.dataset.i; break; } }
  if(at<0) for(let i=lines.length-1;i>=0;i--) if(!hiddenArr[i]){ at=i; break; }
  if(at>=0) setSel({i:at,off:parseAt(at).body.length});
});
/* ---------- find and replace ---------- */
function openFind(withReplace){
  find.open=true; findBar.hidden=false; findCaseBtn.setAttribute('aria-pressed',find.cs);
  if(withReplace){ replWrap.hidden=false; replToggle.hidden=true; }
  const s=lastSel; if(s&&!s.collapsed&&s.start.i===s.end.i) findInput.value=parseAt(s.start.i).body.slice(s.start.off,s.end.off);
  runFind(true);
  if(withReplace&&findInput.value) replInput.focus(); else { findInput.focus(); findInput.select(); }
}
function closeFind(quiet){
  find.open=false; findBar.hidden=true; clearHL(); if(quiet) return;
  const m=find.matches[find.idx];
  if(m) setSel({i:m.i,off:m.s},{i:m.i,off:m.e}); else if(lastSel) setSel(lastSel.a,lastSel.f); else editor.focus();
}
function clearHL(){ if(!HL) return; CSS.highlights.delete('find'); CSS.highlights.delete('find-cur'); }
function runFind(fromCaret){
  const q=findInput.value; find.query=q; find.matches=[];
  if(q){ const nd=find.cs?q:q.toLowerCase(); for(let i=0;i<lines.length;i++){ const b=parseAt(i).body, hay=find.cs?b:b.toLowerCase(); let k=0; while((k=hay.indexOf(nd,k))>=0){ find.matches.push({i,s:k,e:k+q.length}); k+=q.length; } } }
  if(!find.matches.length) find.idx=-1;
  else if(fromCaret){ const s=lastSel; let idx=0; if(s){ idx=find.matches.findIndex(m=>m.i>s.start.i||(m.i===s.start.i&&m.s>=s.start.off)); if(idx<0) idx=0; } find.idx=idx; }
  else find.idx=Math.min(Math.max(find.idx,0),find.matches.length-1);
  if(find.idx>=0) revealMatch(); updateCount(); updateHighlights();
}
function revealMatch(){
  const m=find.matches[find.idx]; let changed=false;
  for(let j=m.i-1;j>=0;j--) if(lines[j].collapsed&&collapsible(j)&&sectionEnd(j)>m.i){ lines[j].collapsed=false; changed=true; }
  if(changed) render();
  const row=editor.children[m.i]; if(row) row.scrollIntoView({block:'nearest'});
}
function updateCount(){ findCount.textContent=find.matches.length?(find.idx+1)+' of '+find.matches.length:(find.query?'No matches':''); }
function findStep(d){ if(!find.matches.length) return; find.idx=(find.idx+d+find.matches.length)%find.matches.length; revealMatch(); updateCount(); updateHighlights(); }
function matchRange(m){
  if(hiddenArr[m.i]) return null; const c=contentOf(m.i); if(!c) return null; const map=mapOf(m.i);
  const A=textPoint(c,renderedOffset(map,m.s)), B=textPoint(c,renderedOffset(map,m.e)), r=new Range();
  try{ r.setStart(A.node,A.off); r.setEnd(B.node,B.off); }catch(_){ return null; } return r;
}
function updateHighlights(){
  if(!HL||P!==activePane) return; if(!find.open||!find.matches.length){ clearHL(); return; }
  const all=new Highlight(), curH=new Highlight();
  find.matches.forEach((m,k)=>{ const r=matchRange(m); if(r) (k===find.idx?curH:all).add(r); });
  CSS.highlights.set('find',all); CSS.highlights.set('find-cur',curH);
}
function replaceOne(){
  const m=find.matches[find.idx]; if(!m) return; pushHistory();
  const p=parseAt(m.i), r=replInput.value; p.body=p.body.slice(0,m.s)+r+p.body.slice(m.e); lines[m.i].text=build(p);
  const pos={i:m.i,off:m.s+r.length}; lastSel=mkSel(pos,pos); commit(); runFind(true);
}
function replaceAll(){
  if(!find.matches.length) return; pushHistory(); const r=replInput.value;
  const rows=new Set(find.matches.map(m=>m.i));
  for(const i of rows){ const p=parseAt(i); const ms=find.matches.filter(m=>m.i===i).sort((x,y)=>y.s-x.s); for(const m of ms) p.body=p.body.slice(0,m.s)+r+p.body.slice(m.e); lines[i].text=build(p); }
  commit(); runFind(true);
}
function renderFilterBar(){
  if(P!==activePane) return; const f=settings.filter; filterBar.hidden=!f.on||sourceOn||agendaOn; if(filterBar.hidden) return;
  fStatus.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===f.status));
  fDue.value=f.due; fPri.value=f.pri; fParents.setAttribute('aria-pressed',f.parents); fChildren.setAttribute('aria-pressed',f.children); fDim.setAttribute('aria-pressed',f.dim);
  const tags=allTags(); for(const t of f.tags) if(!tags.some(x=>x.k===t)) tags.push({k:t,label:t,n:0});
  const frag=document.createDocumentFragment();
  if(!tags.length){ const e=el('span','none'); e.textContent='none yet'; frag.append(e); }
  for(const t of tags){ const b=el('button','btn'); b.type='button'; b.dataset.k=t.k; b.textContent='#'+t.label; b.setAttribute('aria-pressed',f.tags.includes(t.k)); b.title=t.n?t.n+(t.n===1?' row':' rows'):'Not in this note'; frag.append(b); }
  fTags.replaceChildren(frag);
  fCount.textContent=filterActive()?(filterStats.match?filterStats.match+' of '+filterStats.total:'No matches'):'';
}
/* ---------- date picker popover ---------- */
let dpCtx=null;
function openDatePop(chip){
  const row=chip.closest('.row'), i=+row.dataset.i, c=row.querySelector('.content');
  const r=document.createRange(); r.setStart(c,0); r.setEndBefore(chip); const st=mapOf(i)[r.toString().length];
  dpCtx={i,s:st,e:st+11}; dpInput.value=chip.dataset.iso||'';
  datePop.hidden=false;
  const b=chip.getBoundingClientRect(), w=datePop.offsetWidth;
  datePop.style.left=Math.max(8,Math.min(b.left,innerWidth-w-8))+'px'; datePop.style.top=(b.bottom+4)+'px';
  dpInput.focus();
}
function closeDatePop(restore){
  if(datePop.hidden) return; datePop.hidden=true; const c=dpCtx; dpCtx=null;
  if(restore&&c) setSel({i:c.i,off:c.e});
}
function applyDate(iso){ const c=dpCtx; if(!c) return; const r=setDue(c.i,c.s,c.e,iso); c.s=r.s; c.e=r.e; }
dpInput.addEventListener('change',()=>{ if(dpCtx&&dpInput.value) applyDate(dpInput.value); });
datePop.addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b) return;
  if(b.classList.contains('dpRemove')){ applyDate(null); closeDatePop(true); return; }
  applyDate(shiftDate(+b.dataset.d)); closeDatePop(true);
});
datePop.addEventListener('keydown',e=>{ if(e.key==='Escape'||e.key==='Enter'){ e.preventDefault(); e.stopPropagation(); closeDatePop(true); } });
document.addEventListener('mousedown',e=>{ if(!datePop.hidden&&!datePop.contains(e.target)) closeDatePop(false); },{capture:true,signal:ctl.signal});
window.addEventListener('resize',()=>{ closeDatePop(false); acHide(); },sig);
main.addEventListener('scroll',()=>{ closeDatePop(false); acHide(); },{passive:true});
/* ---------- autocomplete for #tags and [[notes]] ---------- */
const ac={open:false,items:[],idx:0,kind:'',start:0,end:0,i:0};
function acCheck(){
  const s=lastSel; if(!s||!s.collapsed||sourceOn){ acHide(); return; }
  const i=s.f.i, p=parseAt(i); if(p.raw){ acHide(); return; }
  const pre=p.body.slice(0,s.f.off), after=p.body.slice(s.f.off); let m, kind, items=[], end=s.f.off;
  if((m=/\[\[([^\]\n]*)$/.exec(pre))){
    kind='wiki'; const q=m[1].toLowerCase(); if(after.startsWith(']]')) end+=2;
    items=noteNames().filter(n=>n.toLowerCase().includes(q)&&n.toLowerCase()!==q).map(n=>({label:n,text:'[['+n+']]'}));
  } else if((m=/(?<!\S)@([A-Za-z0-9\/\-.]*)$/.exec(pre))){
    kind='date'; items=dateSuggestions(m[1]);
  } else if((m=/(?<![\w&#\/])#([A-Za-z_][\w\-\/]*)$/.exec(pre))){
    kind='tag'; const q=m[1].toLowerCase();
    items=collectTags().filter(t=>t.k.startsWith(q)&&t.k!==q).map(t=>({label:'#'+t.label,text:'#'+t.label+' ',n:t.n}));
  } else { acHide(); return; }
  items=items.slice(0,8); if(!items.length){ acHide(); return; }
  Object.assign(ac,{open:true,items,idx:0,kind,start:s.f.off-m[0].length,end,i}); acRender(); acPlace();
}
function acRender(){
  acEl.replaceChildren(...ac.items.map((it,k)=>{ const d=el('div','ai'+(k===ac.idx?' sel':'')); d.dataset.k=k; d.setAttribute('role','option'); const t=el('span','t'); t.textContent=it.label; d.append(t); if(it.n){ const n=el('span','n'); n.textContent=it.n; d.append(n); } return d; }));
  acEl.hidden=false;
}
function acPlace(){
  const sel=getSelection(); let r=sel.rangeCount?sel.getRangeAt(0).getBoundingClientRect():null;
  if(!r||!r.height){ const row=editor.children[ac.i]; if(!row) return; r=row.getBoundingClientRect(); }
  const left=Math.max(8,Math.min(r.left,innerWidth-acEl.offsetWidth-8));
  acEl.style.left=left+'px'; acEl.style.top=(r.bottom+4)+'px';
}
function acHide(){ if(!ac.open) return; ac.open=false; acEl.hidden=true; }
function acAccept(k){
  const it=ac.items[k==null?ac.idx:k]; const i=ac.i; acHide(); if(!it||!lines[i]) return;
  const p=parseAt(i); if(p.raw) return;
  pushHistory(); p.body=p.body.slice(0,ac.start)+it.text+p.body.slice(ac.end); lines[i].text=build(p);
  markDirty(); renderRow(i); setSel({i,off:ac.start+it.text.length});
}
acEl.addEventListener('mousedown',e=>e.preventDefault());
acEl.addEventListener('click',e=>{ const d=e.target.closest('.ai'); if(d) acAccept(+d.dataset.k); });
document.addEventListener('mousedown',e=>{ if(ac.open&&!acEl.contains(e.target)) acHide(); },{capture:true,signal:ctl.signal});

/* ---------- wiki links ---------- */
/* an open tab of that name (in any pane), else the note of that name anywhere in the folder, else a new note at the top of the folder; here in this tab unless asked for a new one */
async function openWiki(name,how){
  const t=wikiTargets(name); if(t.length){ focusDoc(t[0]); return; }
  const base=baseOf(name), n=base+'.md', text='# '+base+'\n', e=noteNamed(base);
  if(e){ openNote(e,how); return; }
  if(ws.dir&&vx.perm&&vx.root&&!BAD_NAME.test(n)){
    try{
      const h=await ws.dir.getFileHandle(n,{create:true}), w=await h.createWritable(); await w.write(text); await w.close();
      const f=await h.getFile(), now=Date.now(); addNote(vx.root,h,n,f,text,now);
      const meta={path:n,mtime:f.lastModified,ctime:now};
      if(how!=='tab'&&await canReplace()) replaceCur(text,n,h,meta); else { newTab(n,text,h); Object.assign(D(),{wsPath:n,mtime:f.lastModified,ctime:now}); }
      idb.set('handles',D().id,h); addRecent(h,n); filesMarkCur(true); return;
    }catch(x){ console.error(x); }
  }
  newTab(n,text);
}

/* ---------- hover preview of [[links]] ---------- */
let pvTimer=0, pvLink=null;
function showPreview(a){
  const name=a.dataset.wiki, base=baseOf(name), t=wikiTargets(name)[0], e=t?null:noteNamed(base); pvEl.replaceChildren();
  const title=el('div','pt'); title.textContent=t?baseOf(t.name):(e?baseOf(e.name):base); pvEl.append(title);
  let head=null, total=0;
  if(t){
    head=[];
    for(const l of t.lines){
      if(!l.text.trim()) continue; const p=parse(l.text);
      if(!total&&p.type==='h'&&plainText(p.body).toLowerCase()===title.textContent.toLowerCase()) continue;   /* the note's own title */
      total++; if(head.length<8) head.push({h:p.type==='h',ind:p.indent,li:isList(p),chk:p.checked,txt:plainText(p.body)});
    }
  } else if(e){ head=e.head; total=e.n; }
  if(!head){ const d=el('div','pvl'); d.textContent='Not open yet · Ctrl+click to create it'; pvEl.append(d); }
  else {
    for(const x of head){ const d=el('div','pvl'+(x.h?' h':'')); d.style.paddingLeft=(x.ind*.9)+'em'; d.textContent=(x.chk==null?(x.li?'• ':''):(x.chk?'☑ ':'☐ '))+x.txt; pvEl.append(d); }
    if(!total){ const d=el('div','pvl'); d.textContent='Empty note'; pvEl.append(d); }
    else if(total>head.length){ const d=el('div','pvl more'); d.textContent='… '+(total-head.length)+' more line'+(total-head.length===1?'':'s'); pvEl.append(d); }
  }
  pvEl.hidden=false;
  const r=a.getBoundingClientRect(), w=pvEl.offsetWidth, h=pvEl.offsetHeight, below=r.bottom+h+12<innerHeight;
  pvEl.style.left=Math.max(8,Math.min(r.left,innerWidth-w-8))+'px';
  pvEl.style.top=(below?r.bottom+6:r.top-h-6)+'px';
}
function hidePreview(){ clearTimeout(pvTimer); pvTimer=0; pvLink=null; pvEl.hidden=true; }
editor.addEventListener('mouseover',e=>{ const a=e.target.closest&&e.target.closest('a.wiki'); if(!a||a===pvLink) return; hidePreview(); pvLink=a; pvTimer=setTimeout(()=>{ if(pvLink===a) showPreview(a); },350); });
editor.addEventListener('mouseout',e=>{ const a=e.target.closest&&e.target.closest('a.wiki'); if(a&&a===pvLink) hidePreview(); });
editor.addEventListener('mousedown',hidePreview); editor.addEventListener('keydown',hidePreview);
main.addEventListener('scroll',hidePreview,{passive:true});
/* ---------- heading trail: the current section's headings, pinned under the header once they scroll away ---------- */
let crumbRaf=0;
function headingChain(i){ const out=[]; let lvl=7; for(let j=i;j>=0&&lvl>1;j--){ const p=parseAt(j); if(p.type==='h'&&p.level<lvl){ out.unshift(j); lvl=p.level; } } return out; }
function updateCrumb(){
  crumbRaf=0;
  if(sourceOn||agendaOn||editor.hidden||!lines.length){ crumbEl.hidden=true; return; }
  const mr=main.getBoundingClientRect(), top=mr.top, x=Math.min(mr.left+40,mr.right-1);
  let row=null; for(const dy of [2,14,30,60]){ const e=document.elementFromPoint(x,top+dy); row=e&&e.closest?e.closest('.row'):null; if(row) break; }
  const chain=row?headingChain(+row.dataset.i):[], h=chain[chain.length-1];
  if(h==null||hiddenArr[h]||editor.children[h].getBoundingClientRect().top>=top-1){ crumbEl.hidden=true; return; }
  crumbEl.replaceChildren();
  chain.forEach((j,k)=>{ if(k){ const s=el('span','sep'); s.textContent='›'; crumbEl.append(s); } const b=el(k===chain.length-1?'b':'span'); b.textContent=parseAt(j).body||'(untitled)'; crumbEl.append(b); });
  crumbEl.dataset.i=h; crumbEl.style.top=top+'px'; crumbEl.style.left=mr.left+'px'; crumbEl.style.width=mr.width+'px'; crumbEl.hidden=false;
}
function scheduleCrumb(){ if(!crumbRaf) crumbRaf=requestAnimationFrame(updateCrumb); }
main.addEventListener('scroll',scheduleCrumb,{passive:true}); window.addEventListener('resize',scheduleCrumb,sig);
const crumbRO=new ResizeObserver(scheduleCrumb); crumbRO.observe(main);
crumbEl.addEventListener('click',()=>{ const i=+crumbEl.dataset.i; if(lines[i]) revealRow(i); });

/* ---------- agenda: every open item with a date, from every tab, grouped by day ---------- */
let agendaOn=false;
function renderAgenda(){
  if(!agendaOn) return;
  const items=agendaItems(), today=todayStr(), frag=document.createDocumentFragment();
  const h=el('h2'); h.textContent='Agenda'; const sub=el('div','sub');
  const n=allDocs().length, where=vx.root?'the folder "'+ws.dir.name+'" and the open tabs':n+' tab'+(n===1?'':'s');
  sub.textContent=items.length?items.length+' open item'+(items.length===1?'':'s')+' with a date across '+where+'. Check one off here, or click it to go to it. Esc closes.':'No open items with a date in '+where+'. Add @today or @fri to a line and it shows up here.';
  frag.append(h,sub);
  let last=null;
  for(const it of items){
    if(it.iso!==last){ last=it.iso; const dh=el('div','day'+(it.iso<today?' over':it.iso===today?' today':'')); dh.textContent=agendaDay(it.iso,today); dh.title=it.iso; frag.append(dh); }
    const r=el('div','ag'); if(it.d) r._d=it.d; else r.dataset.p=it.p; r.dataset.j=it.j;
    const cb=el('input'); cb.type='checkbox'; cb.setAttribute('aria-label','Done');
    const t=el('div','txt'); t.innerHTML=inline(it.body).html; t.title='Go to this line';
    const src=el('span','src'); src.textContent=baseOf(it.name); src.title=it.p||it.name;
    r.append(cb,t,src); frag.append(r);
  }
  agendaEl.replaceChildren(frag);
}
function setAgenda(on){
  if(on===agendaOn) return;
  if(on&&sourceOn) setSource(false);
  agendaOn=on; closeDatePop(false); acHide(); hidePreview();
  if(on){ editor.hidden=true; docTitle.hidden=true; docMeta.hidden=true; renderAgenda(); agendaEl.hidden=false; renderOutline(); renderBacklinks(); renderFilterBar(); crumbEl.hidden=true; }
  else { agendaEl.hidden=true; editor.hidden=false; docTitle.hidden=false; docMeta.hidden=false; render(); if(lastSel) setSel(lastSel.a,lastSel.f); }
}
agendaEl.addEventListener('change',async e=>{
  if(e.target.type!=='checkbox') return; const r=e.target.closest('.ag'), j=+r.dataset.j;
  if(!r._d){ const n=vx.notes.get(r.dataset.p); if(n) await checkOffInFile(n,j); setTimeout(renderAgenda,200); return; }
  const d=r._d; if(!d.lines[j]) return;
  if(d===D()) toggleCheck(j,true,false);
  else { d.undo.push({lines:d.lines.map(x=>({text:x.text,collapsed:x.collapsed})),sel:d.sel}); const p=parseLine(d.lines[j].text,d.indentUnit); p.checked=true; d.lines[j].text=buildLine(p,d.indentUnit); touchDoc(d); }
  setTimeout(renderAgenda,200);
});
agendaEl.addEventListener('click',async e=>{
  const t=e.target.closest('.txt'); if(!t) return; const r=t.closest('.ag'), j=+r.dataset.j;
  if(!r._d){ const n=vx.notes.get(r.dataset.p); if(!n) return; setAgenda(false); if(await openNote(n)) A().revealRow(j); return; }
  setAgenda(false); focusDoc(r._d); A().revealRow(j);
});

/* ---------- tabs ---------- */
function cycleTab(d){ if(docs.length>1) switchTab((cur+d+docs.length)%docs.length); }
function moveTabTo(k,j){
  if(k===j||!docs[k]||j<0||j>=docs.length) return;
  const [x]=docs.splice(k,1); docs.splice(j,0,x);
  if(cur===k) cur=j; else { if(k<cur) cur--; if(j<=cur) cur++; }
  renderTabs(); scheduleDraft();
}
function moveTab(k,d){ moveTabTo(k,k+d); }
let tabDrop=null;
function clearTabDrop(){ if(tabDrop){ tabDrop.classList.remove('drop-l','drop-r'); tabDrop=null; } }
/* a tab can be dragged along its strip, or onto the strip of another pane */
tabsEl.addEventListener('dragstart',e=>{
  const t=e.target.closest&&e.target.closest('.tab'); if(!t){ e.preventDefault(); return; }
  tabDrag={P,k:+t.dataset.k}; e.dataTransfer.setData('text/plain',docs[tabDrag.k].name); e.dataTransfer.effectAllowed='move'; t.classList.add('dragging');
});
tabsEl.addEventListener('dragover',e=>{
  if(!tabDrag) return; e.preventDefault(); e.dataTransfer.dropEffect='move';
  const t=e.target.closest&&e.target.closest('.tab'); clearTabDrop(); if(!t) return;
  const r=t.getBoundingClientRect(); t.classList.add(e.clientX>r.left+r.width/2?'drop-r':'drop-l'); tabDrop=t;
});
tabsEl.addEventListener('dragleave',e=>{ if(!tabsEl.contains(e.relatedTarget)) clearTabDrop(); });
tabsEl.addEventListener('drop',e=>{
  if(!tabDrag) return; e.preventDefault();
  const t=e.target.closest&&e.target.closest('.tab'), right=tabDrop&&tabDrop.classList.contains('drop-r'); clearTabDrop();
  const {P:from,k:src}=tabDrag; tabDrag=null;
  if(from===P){ if(!t) return; let to=+t.dataset.k+(right?1:0); if(to>src) to--; moveTabTo(src,to); }
  else moveDocToPane(from.docs[src],from,P,t?+t.dataset.k+(right?1:0):docs.length);
});
tabsEl.addEventListener('dragend',()=>{ tabDrag=null; clearTabDrop(); renderTabs(); });
function renderTabs(){
  const frag=document.createDocumentFragment();
  docs.forEach((d,k)=>{
    const ext=isExternal(d);
    const t=el('div','tab'+(k===cur?' active':'')+(d.dirty?' dirty':'')+(d.pinned?' pinned':'')+(ext?' ext':'')); t.dataset.k=k; t.setAttribute('role','tab'); t.draggable=true;
    t.title=d.name+(ext?' · outside the folder '+ws.dir.name:'')+(d.pinned?' · pinned':'')+' · drag to reorder, right-click for more';
    const n=el('span','tname'); n.textContent=labelOf(d.name); const dot=el('span','tdot'); const pin=el('span','tpin'); pin.innerHTML=PIN; const x=el('span','tclose'); x.textContent='×'; x.title='Close (Alt+W)';
    t.append(n,dot,pin,x); frag.append(t);
  });
  const add=el('button','btn tadd'); add.type='button'; add.textContent='+'; add.title='New (Alt+N)'; frag.append(add);
  tabsEl.replaceChildren(frag);
  if(P===activePane) document.title=(D().dirty?'• ':'')+labelOf(D().name)+(ws.name?' · '+ws.name:'')+' · PowerNotes';
  if(!docTitle.querySelector('input.trename')) docTitle.textContent=D().name.replace(NOTE_EXT,'');
  renderMeta(); filesMarkCur();
}
/* the line under the title: where the file stands, when it was created and when it was last saved */
function renderMeta(){
  const d=D(); docMeta.replaceChildren(); if(!d) return;
  if(isExternal(d)){ const b=el('button','ext'); b.type='button'; b.textContent='Outside '+ws.dir.name; b.title='This file is not in the open folder, so it is saved with Ctrl+S rather than as you type. Click for options.'; docMeta.append(b); }
  const add=(lab,t)=>{ const s=el('span'); s.textContent=lab+' '+fmtDT.format(t); s.title=new Date(t).toString(); docMeta.append(s); };
  if(d.ctime) add('Created',d.ctime);
  if(d.handle&&d.mtime) add('Modified',d.mtime); else if(!d.handle&&d.ctime&&!isBlank(d)){ const s=el('span'); s.textContent='Not saved as a file yet'; docMeta.append(s); }
}
docMeta.addEventListener('click',e=>{
  const b=e.target.closest('.ext'); if(!b) return; const r=b.getBoundingClientRect();
  showContextMenu(r.left,r.bottom+4,[{h:'This file is outside '+ws.dir.name},{l:'Save a copy in '+ws.dir.name+' and switch to it',f:()=>copyIntoVault(D())},{l:'Save',sc:'Ctrl+S',f:()=>saveFile(false)},{l:'Save as…',sc:'Ctrl+Shift+S',f:()=>saveFile(true)}]);
});

docTitle.addEventListener('dblclick',()=>startRename(cur));
tabsEl.addEventListener('click',e=>{
  if(e.target.closest('.tadd')){ newTab(); return; }
  const t=e.target.closest('.tab'); if(!t) return; const k=+t.dataset.k;
  if(e.target.closest('.tclose')){ closeTab(k); return; }
  if(k!==cur) switchTab(k);
});
tabsEl.addEventListener('auxclick',e=>{ const t=e.target.closest('.tab'); if(t&&e.button===1){ e.preventDefault(); closeTab(+t.dataset.k); } });
tabsEl.addEventListener('dblclick',e=>{ const t=e.target.closest('.tab'); if(!t||e.target.closest('.tclose')) return; startRename(+t.dataset.k); });
tabsEl.addEventListener('contextmenu',e=>{ const t=e.target.closest('.tab'); if(!t) return; e.preventDefault(); setActive(P); showContextMenu(e.clientX,e.clientY,tabMenu(+t.dataset.k)); });
/* the name is edited in the title row, which shows it without its extension; the extension it had is kept */
function startRename(k){
  if(k!==cur) switchTab(k);
  if(agendaOn) setAgenda(false);
  const open=docTitle.querySelector('input.trename'); if(open){ open.focus(); open.select(); return; }
  const d=D(), m=NOTE_EXT.exec(d.name), ext=m?m[0]:'';
  const inp=el('input','trename'); inp.value=d.name.slice(0,d.name.length-ext.length);
  inp.spellcheck=false; inp.setAttribute('aria-label','File name');
  docTitle.replaceChildren(inp); inp.focus(); inp.select();
  let done=false;
  const finish=ok=>{ if(done) return; done=true; const v=inp.value.trim(); inp.remove(); renderTabs(); if(ok&&v&&v+ext!==d.name) renameDoc(d,v+ext); };
  inp.addEventListener('blur',()=>finish(true));
  inp.addEventListener('keydown',e=>{ e.stopPropagation(); if(e.key==='Enter'){ e.preventDefault(); finish(true); } else if(e.key==='Escape'){ e.preventDefault(); finish(false); } });
}
/* renames the tab and, when it is a file on disk, the file with it. The browser can rename in place only in some
   cases; otherwise the file is rewritten under the new name inside its folder and the old one removed, which needs
   a handle to that folder. The notes folder and folders chosen before are tried first; failing that the user is asked
   to point at the folder (the picker opens right at it). Every permission request that needs a click gets one. */
async function renameDoc(d,name){
  const old=d.name, h=d.handle;
  if(BAD_NAME.test(name)){ alert('A file name cannot contain any of  \\ / : * ? " < > |'); return; }
  if(h&&!NOTE_EXT.test(name)){ const m=NOTE_EXT.exec(old); name+=m?m[0]:'.md'; }
  if(name===old) return;
  const tabOnly=()=>{ d.name=name; d.handle=null; idb.del('handles',d.id); markDirty(); renderBacklinks(); renderTabs(); };
  if(!h){ tabOnly(); return; }
  /* a note in the open folder is renamed through the folder, and its tree row follows */
  if(d.wsPath&&vx.notes.has(d.wsPath)&&vx.perm){ await moveEntry(d.wsPath,parentOf(d.wsPath),name); return; }
  const r=await renameOnDisk(d,name);
  if(r==='tabonly') tabOnly();
}
function saveDocState(){ const d=D(); if(!d) return; d.sel=lastSel; d.scroll=main.scrollTop; d.undo=undo; d.redo=redo; d.indentUnit=indentUnit; }
function loadDocState(){ acHide(); const d=D(); lines=d.lines; undo=d.undo; redo=d.redo; indentUnit=d.indentUnit; lastSel=d.sel; render(); renderTabs(); main.scrollTop=d.scroll||0; if(find.open) runFind(false); filesMarkCur(true); }
function switchTab(k){ if(k===cur||!docs[k]) return; if(sourceOn) setSource(false); if(agendaOn) setAgenda(false); saveDocState(); cur=k; loadDocState(); if(lastSel) setSel(lastSel.a,lastSel.f); scheduleDraft(); }
/* a new tab; without a handle it becomes a file in the open folder (in node, a subfolder, when given), and resolves to that path */
function newTab(name,text,handle,node){ if(sourceOn) setSource(false); if(agendaOn) setAgenda(false); saveDocState(); const d=newDoc(name,text); d.handle=handle||null; d.ctime=Date.now(); d.indentUnit=detectIndent(d.lines); docs.push(d); cur=docs.length-1; loadDocState(); setSel({i:0,off:0}); scheduleDraft(); return handle?Promise.resolve(null):createInFolder(d,node); }
/* closing the last tab of a split pane closes the pane; a note that is also open in another pane just leaves this one */
function closeTab(k){
  const d=docs[k]; if(!d) return;
  const elsewhere=panes.some(p=>p!==P&&p.docs.includes(d));
  if(d.dirty&&!elsewhere&&!confirm('Close "'+d.name+'" and discard unsaved changes?')) return;
  if(sourceOn&&k===cur) setSource(false);
  if(agendaOn) setAgenda(false);
  if(k===cur) saveDocState();
  if(!elsewhere){ idb.del('handles',d.id); discardEmpty(d); }
  docs.splice(k,1); if(!docs.length){ if(panes.length>1){ closePane(P); return; } docs.push(newDoc()); }
  if(k<cur) cur--; else if(k===cur) cur=Math.min(k,docs.length-1);
  loadDocState(); if(lastSel) setSel(lastSel.a,lastSel.f); scheduleDraft();
}
function closeOthers(k){ const keep=docs[k]; for(const d of docs.slice()){ if(d===keep||d.pinned) continue; const i=docs.indexOf(d); if(i>=0) closeTab(i); } }
function closeRight(k){ const keep=docs[k]; for(const d of docs.slice(k+1)){ if(d.pinned) continue; const i=docs.indexOf(d); if(i>docs.indexOf(keep)) closeTab(i); } }
function togglePin(k){ docs[k].pinned=!docs[k].pinned; renderTabs(); scheduleDraft(); }
/* opens text as a tab (the current tab, when it is blank) and resolves to that tab; a file already open anywhere is brought to the front instead */
async function openInto(text,name,handle,meta){
  if(handle){ const f=await findOpen(handle); if(f){ focusDoc(f); return f; } }
  if(isBlank(D())){ const d=D(); d.lines=fromTextRaw(text); d.name=name; d.handle=handle||null; d.wsPath=undefined; d.mtime=undefined; d.undo=[]; d.redo=[]; d.sel=null; d.indentUnit=detectIndent(d.lines); loadDocState(); setSel({i:0,off:0}); scheduleDraft(); }
  else newTab(name,text,handle);
  const d=D(); d.ctime=(meta&&meta.ctime)||fmCreated(text)||null; if(meta&&meta.mtime!=null) d.mtime=meta.mtime; if(meta&&meta.path!==undefined) d.wsPath=meta.path;
  if(handle){ idb.set('handles',d.id,handle); addRecent(handle,name); await placeDoc(d); if(ws.dir&&vx.perm) requestScan(false,null,0); }
  renderTabs(); return d;
}
/* whether a click in the files pane may take over this tab: not a pinned one, and nothing unsaved that cannot be written first */
async function canReplace(){ const d=D(); if(d.pinned) return false; if(!d.dirty||isBlank(d)) return true; if(d.handle&&d.wsPath&&settings.autosave){ try{ await writeDoc(d); }catch(x){} return !d.dirty; } return false; }
/* shows another note in this tab; the one it replaces goes into the tab's history, reachable with Back */
function replaceCur(text,name,handle,meta){
  saveDocState(); const old=D(), d=newDoc(name,text); d.handle=handle||null; d.indentUnit=detectIndent(d.lines);
  d.mtime=meta&&meta.mtime; d.wsPath=meta?meta.path:undefined; d.ctime=(meta&&meta.ctime)||fmCreated(text)||null;
  d.back=(old.back||[]).concat(old).slice(-20); d.fwd=[]; old.back=[]; old.fwd=[];
  swapCur(d,old); if(handle){ idb.set('handles',d.id,handle); addRecent(handle,name); placeDoc(d); }
  return d;
}
function swapCur(d,old){
  if(sourceOn) setSource(false); if(agendaOn) setAgenda(false);
  docs[cur]=d; const elsewhere=panes.some(p=>p!==P&&p.docs.includes(old)); if(!elsewhere){ idb.del('handles',old.id); discardEmpty(old); }
  loadDocState(); if(d.sel) setSel(d.sel.a,d.sel.f); else setSel({i:0,off:0}); scheduleDraft();
}
/* a note coming back from history is re-read when its file changed meanwhile */
async function freshen(d){ if(!d.handle||d.dirty) return; try{ const f=await d.handle.getFile(); if(f.lastModified!==d.mtime){ d.lines=fromTextRaw(await f.text()); d.mtime=f.lastModified; d.sel=null; d.undo=[]; d.redo=[]; } }catch(e){} }
async function goBack(){ const d=D(), back=d.back||[]; if(!back.length) return; let prev=back.pop(); const dup=prev.handle&&await findOpen(prev.handle); if(dup&&dup!==prev){ if(focusDoc(dup)) return; prev=dup; } await freshen(prev); prev.fwd=[d].concat(d.fwd||[]); prev.back=back; d.back=[]; d.fwd=[]; saveDocState(); swapCur(prev,d); if(prev.handle) idb.set('handles',prev.id,prev.handle); }
async function goForward(){ const d=D(), fwd=d.fwd||[]; if(!fwd.length) return; let next=fwd.shift(); const dup=next.handle&&await findOpen(next.handle); if(dup&&dup!==next){ if(focusDoc(dup)) return; next=dup; } await freshen(next); next.back=(d.back||[]).concat(d); next.fwd=fwd; d.back=[]; d.fwd=[]; saveDocState(); swapCur(next,d); if(next.handle) idb.set('handles',next.id,next.handle); }

/* ---------- source view ---------- */
function setSource(on){
  if(!on) syncFromSource();
  if(on&&agendaOn) setAgenda(false);
  sourceOn=on;
  if(on){ closeDatePop(false); acHide(); hidePreview(); renumber(); src.value=serialize(); editor.hidden=true; src.hidden=false; renderOutline(); backEl.hidden=true; filterBar.hidden=true; crumbEl.hidden=true; src.focus(); }
  else { editor.hidden=false; src.hidden=true; render(); if(lastSel) setSel(lastSel.a,lastSel.f); }
}
function syncFromSource(){ if(!sourceOn) return; const t=src.value; if(t===serialize()) return; setLines(fromText(t,true)); indentUnit=detectIndent(lines); }
src.addEventListener('input',()=>{ markDirty(); clearTimeout(srcTimer); srcTimer=setTimeout(syncFromSource,250); });
src.addEventListener('keydown',e=>{ if(e.key==='Tab'){ e.preventDefault(); const s=src.selectionStart; src.setRangeText('  ',s,src.selectionEnd,'end'); src.dispatchEvent(new Event('input')); } });

/* ---------- commands shared by the menus, the palette and the right-click menu ---------- */
/* ---------- menus ---------- */
function withSel(fn){ const s=lastSel||mkSel({i:0,off:0},{i:0,off:0}); if(document.activeElement!==editor) setSel(s.a,s.f); fn(getSel()||s); }
function restoreSel(){ if(lastSel&&document.activeElement===editor) setSel(lastSel.a,lastSel.f); }
const cmd={
  check:()=>({l:'Check / uncheck',sc:'Ctrl+Space',f:()=>withSel(toggleCheckRange)}),
  checkbox:()=>({l:'Add / remove checkbox',sc:'Ctrl+Shift+Space',f:()=>withSel(toggleCheckbox)}),
  heading:()=>({l:'Toggle heading',sc:'Ctrl+Shift+H',f:()=>withSel(s=>toggleHeading(s))}),
  due:()=>({l:'Due today / tomorrow / next week',sc:'Ctrl+Shift+D',f:()=>withSel(cycleDue)}),
  priUp:()=>({l:'Raise priority (!, !!, !!!)',sc:'Ctrl+Shift+↑',f:()=>withSel(s=>cyclePri(s,1))}),
  priDown:()=>({l:'Lower priority',sc:'Ctrl+Shift+↓',f:()=>withSel(s=>cyclePri(s,-1))}),
  indent:()=>({l:'Indent',sc:'Tab',f:()=>withSel(s=>indentRows(s,1))}),
  outdent:()=>({l:'Outdent',sc:'Shift+Tab',f:()=>withSel(s=>indentRows(s,-1))}),
  up:()=>({l:'Move line up',sc:'Alt+↑',f:()=>withSel(s=>moveBlock(s,-1))}),
  down:()=>({l:'Move line down',sc:'Alt+↓',f:()=>withSel(s=>moveBlock(s,1))}),
  below:()=>({l:'New line below',sc:'Ctrl+Enter',f:()=>withSel(s=>insertLine(s,1))}),
  above:()=>({l:'New line above',sc:'Ctrl+Shift+Enter',f:()=>withSel(s=>insertLine(s,-1))}),
  dup:()=>({l:'Duplicate line',sc:'Ctrl+D',f:()=>withSel(duplicateLines)}),
  sort:()=>({l:'Sort section',sub:()=>[
    {l:'By date',f:()=>withSel(s=>sortSection(s,'date'))},
    {l:'By priority',f:()=>withSel(s=>sortSection(s,'pri'))},
    {l:'Open items first',f:()=>withSel(s=>sortSection(s,'done'))},
    {l:'A to Z',f:()=>withSel(s=>sortSection(s,'alpha'))}]}),
  format:()=>({l:'Format',sub:()=>[
    {l:'Bold',sc:'Ctrl+B',f:()=>withSel(s=>wrapSel(s,'**'))},
    {l:'Italic',sc:'Ctrl+I',f:()=>withSel(s=>wrapSel(s,'*'))},
    {l:'Code',sc:'Ctrl+E',f:()=>withSel(s=>wrapSel(s,'`'))},
    {l:'Strikethrough',sc:'Ctrl+Shift+X',f:()=>withSel(s=>wrapSel(s,'~~'))},
    {l:'Link',sc:'Ctrl+K',f:()=>withSel(makeLink)}]}),
  fold:()=>{ const i=lastSel?lastSel.f.i:0, j=lines[i]?foldTarget(i):-1; return {l:j>=0&&lines[j].collapsed?'Expand':'Collapse',sc:'Ctrl+.',f:()=>withSel(foldCurrent),dis:j<0}; }
};

/* ---------- save and export ---------- */
async function saveFile(as){
  if(sourceOn) syncFromSource(); else renumber();
  const text=serialize(), d=D();
  if(window.showSaveFilePicker){
    try{
      if(d.handle&&!as&&!(await ensurePerm(d.handle,'readwrite'))) as=true;
      if(!d.handle&&!as&&ws.dir){ const r=await saveToVault(d,text); if(r===null) return; if(r){ d.dirty=false; renderTabs(); scheduleDraft(); return; } }
      if(!d.handle||as){ d.handle=await showSaveFilePicker({suggestedName:d.name,types:TYPES}); d.name=d.handle.name; d.wsPath=undefined; idb.set('handles',d.id,d.handle); addRecent(d.handle,d.name); }
      await writeDoc(d); renderTabs(); scheduleDraft();
      if(ws.dir&&vx.perm) requestScan(false,null,0);
    }catch(e){ if(e.name!=='AbortError'){ console.error(e); alert('Could not save: '+e.message); } }
  } else {
    download(d.name,text,'text/markdown'); d.dirty=false; renderTabs(); scheduleDraft();
  }
}
/* ---------- export ---------- */
function docToHtml(){
  renumber();
  const out=[], stack=[]; let inCode=false;
  const closeLists=to=>{ while(stack.length&&stack[stack.length-1].indent>=to) out.push(stack.pop().type==='ol'?'</ol>':'</ul>'); };
  for(let i=0;i<lines.length;i++){
    const p=parseAt(i), t=lines[i].text;
    if(p.raw){ if(RE_FENCE.test(t)){ closeLists(0); if(!inCode){ out.push('<pre><code>'); inCode=true; } else { out.push('</code></pre>'); inCode=false; } } else out.push(esc(t)+'\n'); continue; }
    if(p.type==='h'){ closeLists(0); out.push('<h'+p.level+'>'+inline(p.body).html+'</h'+p.level+'>'); continue; }
    if(isList(p)){
      while(stack.length&&stack[stack.length-1].indent>p.indent) out.push(stack.pop().type==='ol'?'</ol>':'</ul>');
      if(!stack.length||stack[stack.length-1].indent<p.indent){ stack.push({type:p.type,indent:p.indent}); out.push(p.type==='ol'?'<ol>':'<ul>'); }
      else if(stack[stack.length-1].type!==p.type){ out.push(stack.pop().type==='ol'?'</ol>':'</ul>'); stack.push({type:p.type,indent:p.indent}); out.push(p.type==='ol'?'<ol>':'<ul>'); }
      const cb=p.checked==null?'':'<input type="checkbox" disabled'+(p.checked?' checked':'')+'> ';
      out.push('<li'+(p.checked?' class="done"':'')+'>'+cb+inline(p.body).html+'</li>'); continue;
    }
    if(p.type==='q'){ closeLists(0); out.push('<blockquote>'+inline(p.body).html+'</blockquote>'); continue; }
    if(p.body===''){ continue; }
    closeLists(0); out.push('<p>'+inline(p.body).html+'</p>');
  }
  closeLists(0); if(inCode) out.push('</code></pre>');
  const css='body{max-width:44rem;margin:2rem auto;padding:0 1rem;font:16px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#1f2328}h1,h2,h3{line-height:1.25}li.done{color:#6b7280}code{background:#eceef1;padding:.05em .3em;border-radius:4px;font-size:.92em}pre{background:#eceef1;padding:.8em 1em;border-radius:8px;overflow:auto}pre code{background:none;padding:0}blockquote{border-left:3px solid #e5e7eb;margin:0;padding-left:.8em;color:#6b7280}.due,.tag{font-size:.8em;padding:0 .45em;border-radius:1em;background:#eceef1;color:#6b7280}.due.over{color:#cf5a52}.due.today{color:#4b7cd6}.pri{font-size:.75em;font-weight:700;padding:0 .5em;border-radius:1em;color:#b98a2c;background:#f5efe0}.pri.p2{color:#cf5a52;background:#f9e7e5}.pri.p3{color:#fff;background:#cf5a52}a{color:#4b7cd6}a.wiki{text-decoration:none;border-bottom:1px dashed}';
  return '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>'+esc(D().name.replace(/\.md$/i,''))+'</title><style>'+css+'</style></head><body>\n'+out.join('\n')+'\n</body></html>\n';
}
function exportHtml(){ download(D().name.replace(/\.md$/i,'')+'.html',docToHtml(),'text/html'); }
/* adds files as tabs in one go (files already open anywhere are skipped, a blank tab gives way) and shows the first of them */
async function addDocs(items,quiet=true){
  if(sourceOn) setSource(false); if(agendaOn) setAgenda(false); saveDocState();
  let first=-1;
  for(const it of items){
    if(it.handle){ const f=await findOpen(it.handle); if(f){ const k=docs.indexOf(f); if(k>=0&&first<0) first=k; continue; } }
    const d=newDoc(it.name,it.text); d.handle=it.handle||null; d.indentUnit=detectIndent(d.lines); d.wsPath=it.path; d.mtime=it.mtime; d.ctime=it.ctime||fmCreated(it.text)||null; docs.push(d);
    if(it.handle){ idb.set('handles',d.id,it.handle); if(!quiet) addRecent(it.handle,it.name); }
    if(first<0) first=docs.length-1;
  }
  if(docs.length>1){ const k=docs.findIndex(isBlank); if(k>=0){ idb.del('handles',docs[k].id); docs.splice(k,1); if(first>k) first--; } }
  cur=Math.max(0,Math.min(first,docs.length-1)); loadDocState(); setSel({i:0,off:0}); scheduleDraft();
  for(const d of docs) placeDoc(d);
  if(ws.dir&&vx.perm) requestScan(false,null,0);
}

/* ---------- the pane seen from outside ---------- */
function tabMenu(k){
  const d=docs[k], at=panes.indexOf(P), right=panes[at+1], left=panes[at-1];
  return [
    {l:'Close',sc:'Alt+W',f:()=>closeTab(k)},
    {l:'Close others',f:()=>closeOthers(k),dis:docs.length<2},
    {l:'Close to the right',f:()=>closeRight(k),dis:k>=docs.length-1},
    '-',
    {l:d.pinned?'Unpin':'Pin',f:()=>togglePin(k)},
    {l:'Rename',f:()=>startRename(k)},
    ...(d.wsPath?[{l:'Reveal in files pane',f:()=>revealInTree(d.wsPath)}]:[]),
    '-',
    {l:'Open to the right',f:()=>splitPane(P,'row',d)},
    {l:'Open below',f:()=>splitPane(P,'col',d)},
    ...(right?[{l:'Move to the pane on the right',f:()=>moveDocToPane(d,P,right)}]:[]),
    ...(left?[{l:'Move to the pane on the left',f:()=>moveDocToPane(d,P,left)}]:[])];
}
/* takes a doc out of this pane (it may live on in another); an emptied split pane goes away */
function detach(d){
  const k=docs.indexOf(d); if(k<0) return;
  if(k===cur){ if(sourceOn) setSource(false); if(agendaOn) setAgenda(false); saveDocState(); }
  docs.splice(k,1); if(!docs.length){ if(panes.length>1){ closePane(P); return; } docs.push(newDoc()); }
  if(k<cur) cur--; else if(k===cur){ cur=Math.min(k,docs.length-1); loadDocState(); }
  renderTabs(); renderBacklinks(); scheduleDraft();
}
function attach(d,at,activate){
  if(docs.includes(d)){ if(activate!==false) switchTab(docs.indexOf(d)); return; }
  if(sourceOn) setSource(false); if(agendaOn) setAgenda(false); saveDocState();
  if(at==null||at>docs.length) at=docs.length; docs.splice(at,0,d);
  if(activate!==false){ cur=at; loadDocState(); if(lastSel) setSel(lastSel.a,lastSel.f); } else { if(at<=cur) cur++; renderTabs(); }
  scheduleDraft();
}
/* closes every tab that has nothing unsaved; tabs with changes stay, so nothing is lost */
function closeClean(){
  if(sourceOn) setSource(false); if(agendaOn) setAgenda(false); saveDocState();
  for(const d of docs) if(!d.dirty&&!panes.some(p=>p!==P&&p.docs.includes(d))){ idb.del('handles',d.id); discardEmpty(d); }
  docs=docs.filter(d=>d.dirty); if(!docs.length){ if(panes.length>1){ closePane(P); return; } docs.push(newDoc()); }
  cur=0; loadDocState();
}
/* redraws after the doc changed elsewhere (another pane, the agenda, a reload from disk) */
function refresh(){ if(sourceOn) src.value=serialize(); else { render(); if(lastSel) lastSel=mkSel(clampPos(lastSel.a),clampPos(lastSel.f)); } }
function reload(d,text){
  if(d===D()){ setLines(fromText(text,true)); indentUnit=detectIndent(lines); if(sourceOn) src.value=serialize(); else { render(); if(lastSel) lastSel=mkSel(clampPos(lastSel.a),clampPos(lastSel.f)); restoreSel(); } mirror(); }
  else { d.lines=fromTextRaw(text); d.indentUnit=detectIndent(d.lines); d.sel=null; }
}
function flush(d){ if(d===D()){ if(sourceOn) syncFromSource(); else renumber(); } }
function refocusSel(){ if(lastSel&&!sourceOn&&!agendaOn) setSel(lastSel.a,lastSel.f); }
function focusEditor(){ if(sourceOn){ src.focus(); return; } if(agendaOn) return; if(lastSel) setSel(lastSel.a,lastSel.f); else editor.focus(); }
function dismiss(){ acHide(); closeDatePop(false); hidePreview(); }
function applySpell(){ editor.spellcheck=!!settings.spell; src.spellcheck=!!settings.spell; if(settings.lang) editor.lang=settings.lang; else editor.removeAttribute('lang'); }
function headings(){ const out=[]; lines.forEach((l,i)=>{ const p=parseAt(i); if(p.type==='h') out.push({i,body:p.body}); }); return out; }
/* the row under a point in the pane, for dropping images onto a note */
function rowAt(y){ let at=-1; for(const r of editor.children){ if(r.classList.contains('hidden')) continue; const b=r.getBoundingClientRect(); if(y>=b.top&&y<=b.bottom){ at=+r.dataset.i; break; } } if(at<0) for(let i=lines.length-1;i>=0;i--) if(!hiddenArr[i]){ at=i; break; } return at; }
/* images from the clipboard or a drop: stored in Attachments and linked from the note, at the caret or under the row given */
async function insertImages(files,s,rowIdx){
  if(sourceOn||agendaOn) return; const d=D(), links=[];
  for(const f of files){ const link=await storeAttachment(d,f); if(link) links.push(link); }
  if(!links.length) return;
  if(rowIdx!=null&&rowIdx>=0&&!s){ const at=spanEnd(rowIdx); pushHistory(); lines.splice(at,0,...links.map(t=>({text:t,collapsed:false}))); commit(); setSel({i:at+links.length-1,off:parse(lines[at+links.length-1].text).body.length}); return; }
  const sel=s||lastSel||mkSel({i:0,off:0},{i:0,off:0}); const p=parseAt(sel.start.i), pre=p.body.slice(0,sel.start.off);
  doInsert(sel,(pre&&!/\s$/.test(pre)?' ':'')+links.join('\n'));
}
/* redraws the picture blocks only, leaving the text and the caret alone */
function refreshMedia(){ for(const row of editor.querySelectorAll('.row')){ if(!row.querySelector('.media')) continue; const p=parseAt(+row.dataset.i); if(p&&!p.raw) addMedia(row,p.body); } }
function destroy(){ if(find.open) closeFind(true); ctl.abort(); crumbRO.disconnect(); if(!acEl.hidden) acHide(); root.remove(); tabsEl.remove(); }
root.addEventListener('mousedown',()=>setActive(P),true);
root.addEventListener('focusin',()=>setActive(P));
tabsEl.addEventListener('mousedown',()=>setActive(P),true);
applySpell();
Object.defineProperties(P,{docs:{get:()=>docs,set:v=>{ docs=v; }},cur:{get:()=>cur,set:v=>{ cur=v; }}});
Object.assign(P,{root,tabsEl,tabBar,main,find,cmd,
  D:()=>D(),undoLen:()=>undo.length,redoLen:()=>redo.length,foldState:()=>foldState,agendaOn:()=>agendaOn,sourceOn:()=>sourceOn,composing:()=>composing,lastSel:()=>lastSel,headings,
  canBack:()=>!!(D()&&D().back&&D().back.length),canFwd:()=>!!(D()&&D().fwd&&D().fwd.length),
  init(arr,k){ docs=arr; cur=Math.max(0,Math.min(k||0,arr.length-1)); loadDocState(); },
  render,renderTabs,renderBacklinks,renderAgenda,renderOutline,renderFilterBar,renderMeta,refresh,refreshMedia,reload,flush,applySpell,scheduleCrumb,
  newTab,closeTab,switchTab,cycleTab,moveTab,moveTabTo,startRename,openInto,addDocs,replaceCur,canReplace,goBack,goForward,togglePin,
  saveFile,exportHtml,setSource,setAgenda,withSel,restoreSel,refocus:refocusSel,focusEditor,dismiss,
  doUndo,doRedo,openFind,closeFind,runFind,findStep,replaceOne,replaceAll,
  foldAll,collapseCurrent,expandCurrent,duplicateLines,moveBlock,revealRow,revealRange,insertImages,rowAt,
  detach,attach,closeClean,destroy});
return P;
}
