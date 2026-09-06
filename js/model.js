'use strict';
/* ---------- line model ---------- */
const RE_H=/^(#{1,6})\s(.*)$/;
const RE_Q=/^(\s*)>\s?(.*)$/;
const RE_LI=/^(\s*)([-*+]|\d+[.)])(?:\s+\[([ xX])\](?:\s(.*))?|\s(.*))$/;
const RE_FENCE=/^\s*(```|~~~)/;
const RE_DUE=/@(\d{4}-\d{2}-\d{2})(?![\w-])/;
const RE_TAG=/(?<![\w&#\/])#([A-Za-z_][\w\-\/]*)/g;
/* a priority marker is a standalone !, !! or !!! */
const RE_PRI=/(?<!\S)(!{1,3})(?!\S)/;
function priOf(body){ const m=RE_PRI.exec(body); return m?m[1].length:0; }

const parse=t=>parseLine(t,2);
function parseLine(text,indentUnit){
  let m;
  if((m=RE_H.exec(text))) return {type:'h',level:m[1].length,indent:0,checked:null,body:m[2]||''};
  if((m=RE_Q.exec(text))){ const sp=m[1].replace(/\t/g,'    ').length; return {type:'q',level:0,indent:Math.round(sp/indentUnit),checked:null,body:m[2]}; }
  if((m=RE_LI.exec(text))){
    const spaces=m[1].replace(/\t/g,'    ').length, ol=/\d/.test(m[2]);
    return {type:ol?'ol':'ul',level:0,indent:Math.round(spaces/indentUnit),num:ol?parseInt(m[2],10):0,checked:m[3]==null?null:/x/i.test(m[3]),body:m[4]!=null?m[4]:(m[5]||'')};
  }
  const sp=/^\s*/.exec(text)[0].replace(/\t/g,'    ').length;
  return {type:'p',level:0,indent:Math.round(sp/indentUnit),checked:null,body:text.trimStart()};
}
const build=p=>buildLine(p,2);
function buildLine(p,indentUnit){
  if(p.raw) return p.body;
  if(p.type==='h') return '#'.repeat(p.level)+' '+p.body;
  let s=' '.repeat(Math.max(0,p.indent)*indentUnit);
  if(p.type==='q') return s+'> '+p.body;
  if(p.type==='ul') s+='- '; else if(p.type==='ol') s+=(p.num||1)+'. ';
  if((p.type==='ul'||p.type==='ol')&&p.checked!=null) s+=p.checked?'[x] ':'[ ] ';
  return s+p.body;
}
const isList=p=>p.type==='ul'||p.type==='ol';
function detectIndent(arr){
  let min=Infinity;
  for(const l of arr){ const m=/^( +)([-*+]|\d+[.)])\s/.exec(l.text); if(m) min=Math.min(min,m[1].length); }
  return (min>=2&&min<=4)?min:2;
}
const NO_TAGS=new Set();
function tagsOf(body){ const s=new Set(); RE_TAG.lastIndex=0; let m; while((m=RE_TAG.exec(body))) s.add(m[1].toLowerCase()); return s; }
function filterActive(){ const f=settings.filter; return f.on&&(f.status!=='all'||f.due!=='any'||f.pri!=='any'||f.tags.length>0); }
function rowMatches(p,inherited,today,week){
  const f=settings.filter;
  if(f.status==='open'&&p.checked!==false) return false;
  if(f.status==='done'&&p.checked!==true) return false;
  if(f.pri!=='any'&&(p.raw?0:priOf(p.body))<+f.pri) return false;
  if(f.due!=='any'){
    const d=p.raw?null:dueOf(p.body);
    if(f.due==='has'&&!d) return false;
    if(f.due==='none'&&d) return false;
    if(f.due==='due'&&!(d&&d<=today)) return false;
    if(f.due==='overdue'&&!(d&&d<today)) return false;
    if(f.due==='today'&&d!==today) return false;
    if(f.due==='week'&&!(d&&d<=week)) return false;
  }
  if(f.tags.length){ const own=p.raw?NO_TAGS:tagsOf(p.body); for(const t of f.tags) if(!own.has(t)&&!inherited.has(t)) return false; }
  return true;
}
function dueOf(body){ const m=RE_DUE.exec(body); return m?m[1]:null; }
function fromTextRaw(text){
  let arr=text.replace(/\r\n?/g,'\n').split('\n');
  if(arr.length>1&&arr[arr.length-1]==='') arr.pop();
  if(!arr.length) arr=[''];
  return arr.map(t=>({text:t,collapsed:false}));
}
const serializeLines=arr=>arr.map(l=>l.text).join('\n')+'\n';
/* ---------- inline markdown ---------- */
function esc(s){ return s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function dueClass(d){ const t=todayStr(); return d<t?'over':(d===t?'today':''); }
const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'], DAYS=['sun','mon','tue','wed','thu','fri','sat'];
function dueLabel(iso){
  const [y,mo,d]=iso.split('-').map(Number), now=new Date();
  if(iso===todayStr(now)) return '@Today';
  const tm=new Date(now); tm.setDate(tm.getDate()+1); if(iso===todayStr(tm)) return '@Tomorrow';
  const dt=new Date(y,mo-1,d); let s='@'+['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()]+' '+mo+'/'+d;
  if(y!==now.getFullYear()){ const six=new Date(now); six.setMonth(six.getMonth()+6); if(dt>=six) s+='/'+y; }
  return s;
}
function parseDateToken(tok){
  const t=tok.trim().toLowerCase().replace(/,/g,' ').replace(/\s+/g,' ').replace(/\.$/,''), now=new Date(), Y=now.getFullYear();
  const mk=(y,m,d)=>{ if(y<100) y+=2000; if(m<1||m>12||d<1||d>31) return null; const dt=new Date(y,m-1,d); return (dt.getMonth()===m-1&&dt.getDate()===d)?todayStr(dt):null; };
  const shift=n=>{ const d=new Date(now); d.setDate(d.getDate()+n); return todayStr(d); };
  if(t==='today') return shift(0); if(t==='tomorrow') return shift(1); if(t==='yesterday') return shift(-1);
  let m;
  if((m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) return mk(+m[1],+m[2],+m[3]);
  if((m=/^(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?$/.exec(t))) return mk(m[3]?+m[3]:Y,+m[1],+m[2]);
  const mon=w=>{ const k=MONTHS.findIndex(x=>w.startsWith(x)); return k>=0&&w.length<=9?k+1:0; };
  if((m=/^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?(?: (\d{2,4}))?$/.exec(t))&&mon(m[1])) return mk(m[3]?+m[3]:Y,mon(m[1]),+m[2]);
  if((m=/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]{3,9})\.?(?: (\d{2,4}))?$/.exec(t))&&mon(m[2])) return mk(m[3]?+m[3]:Y,mon(m[2]),+m[1]);
  if((m=/^(next )?([a-z]{3,9})$/.exec(t))){ const di=DAYS.findIndex(x=>m[2].startsWith(x)); if(di>=0){ let delta=(di-now.getDay()+7)%7; if(m[1]&&delta===0) delta=7; return shift(delta); } }
  return null;
}
function expandDateBefore(nb,caret,needSpace){
  let pre=nb.slice(0,caret); if(needSpace){ if(!pre.endsWith(' ')) return null; pre=pre.slice(0,-1); }
  const words=pre.split(' '); if(words.length&&/,$/.test(words[words.length-1])) return null;
  for(let n=1;n<=3&&n<=words.length;n++){
    const cand=words.slice(words.length-n).join(' '); if(cand[0]!=='@'||cand.length<2) continue;
    if(cand.indexOf('@',1)>=0) continue;
    const iso=parseDateToken(cand.slice(1)); if(!iso) continue;
    const start=pre.length-cand.length, rep='@'+iso+(needSpace?' ':'');
    if(cand==='@'+iso) return null;
    return {nb:nb.slice(0,start)+rep+nb.slice(caret),caret:start+rep.length};
  }
  return null;
}
function inline(raw){
  let html='', map=[];
  const text=(s,base)=>{ for(let k=0;k<s.length;k++) map.push(base+k); html+=esc(s); };
  function walk(s,base){
    const re=/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*(?=\S)([\s\S]*?\S)\*\*|__(?=\S)([\s\S]*?\S)__|(?<![\w*])\*(?=\S)([^*]*?\S)\*(?![\w*])|(?<![\w_])_(?=\S)([^_]*?\S)_(?![\w_])|~~(?=\S)([\s\S]*?\S)~~|\[\[([^\]\n]+?)\]\]|!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|@(\d{4}-\d{2}-\d{2})(?![\w-])|(?<![\w&#\/])#([A-Za-z_][\w\-\/]*)|(?<!\S)(!{1,3})(?!\S)|https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|!\[\[([^\]\n]+?)\]\]/g;
    let last=0,m;
    while((m=re.exec(s))){
      text(s.slice(last,m.index),base+last);
      const start=base+m.index, end=start+m[0].length;
      last=m.index+m[0].length;
      /* code, links, chips and tags are not prose, so the spellchecker leaves them alone */
      if(m[1]!=null){ html+='<code spellcheck="false">'; text(m[2],start+m[1].length); html+='</code>'; }
      else if(m[3]!=null||m[4]!=null){ html+='<strong>'; walk(m[3]!=null?m[3]:m[4],start+2); html+='</strong>'; }
      else if(m[5]!=null||m[6]!=null){ html+='<em>'; walk(m[5]!=null?m[5]:m[6],start+1); html+='</em>'; }
      else if(m[7]!=null){ html+='<del>'; walk(m[7],start+2); html+='</del>'; }
      else if(m[8]!=null){ html+='<a class="wiki" spellcheck="false" data-wiki="'+esc(m[8].trim())+'" title="Ctrl+click to open · hover for a preview">'; text(m[8],start+2); html+='</a>'; }
      else if(m[9]!=null){ const img=m[0][0]==='!', off=start+(img?2:1); html+='<a href="'+esc(m[10])+'"'+(img?' class="img" spellcheck="false"':'')+' title="Ctrl+click to open">'; walk(m[9],off); html+='</a>'; }
      else if(m[11]!=null){ const lab=dueLabel(m[11]); html+='<span class="due '+dueClass(m[11])+'" spellcheck="false" data-iso="'+m[11]+'" title="'+m[11]+' · click to change">'; for(let k=0;k<lab.length;k++) map.push(start); html+=esc(lab)+'</span>'; }
      else if(m[12]!=null){ html+='<span class="tag" spellcheck="false" title="Ctrl+click to filter">'; text(m[0],start); html+='</span>'; }
      else if(m[13]!=null){ html+='<span class="pri p'+m[13].length+'" spellcheck="false" title="Priority '+m[13].length+' of 3">'; text(m[0],start); html+='</span>'; }
      else if(m[14]!=null){ html+='<a class="img" spellcheck="false" data-embed="'+esc(m[14].trim())+'" title="Ctrl+click to open">'; text(m[14],start+3); html+='</a>'; }
      else { html+='<a href="'+esc(m[0])+'" spellcheck="false" title="Ctrl+click to open">'; text(m[0],start); html+='</a>'; }
    }
    text(s.slice(last),base+last);
  }
  walk(raw,0); map.push(raw.length);
  return {html,map,cls:''};
}
function idMap(n){ const a=new Array(n+1); for(let k=0;k<=n;k++) a[k]=k; return a; }
const el=(tag,cls)=>{ const e=document.createElement(tag); if(cls) e.className=cls; return e; };
function plainText(body){ return body.replace(/\[\[|\]\]|[*_~`]+/g,'').replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').trim(); }
/* a created date from YAML front matter (created:, date created:, created_at: or date:), as a time in ms, or null */
function fmCreated(text){
  if(!/^---\r?\n/.test(text)) return null;
  const end=text.indexOf('\n---',4); if(end<0) return null;
  const m=/^(?:created|date created|created_at|date)\s*:\s*["']?([^"'\n]+?)["']?\s*$/im.exec(text.slice(4,end)); if(!m) return null;
  const t=Date.parse(m[1].trim().replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/,'$1T$2')); return isNaN(t)?null:t;
}
const fmtDT=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'});
/* a file that is open but not inside the open folder */
const isExternal=d=>!!(ws.dir&&d.handle&&d.wsPath===null);
