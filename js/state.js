'use strict';
const $=id=>document.getElementById(id);
const findBar=$('find'), findInput=$('findInput'), findCount=$('findCount'), replWrap=$('repl'), replInput=$('replInput'), findCaseBtn=$('findCase'), replToggle=$('replToggle');
const helpDlg=$('help'), settingsDlg=$('settings'), accessDlg=$('access'), menubar=$('menubar'), appEl=document.querySelector('.app');
const filterBar=$('filterBar'), fStatus=$('fStatus'), fDue=$('fDue'), fPri=$('fPri'), fTags=$('fTags'), fCount=$('fCount'), fParents=$('fParents'), fChildren=$('fChildren'), fDim=$('fDim');
const headerEl=$('header'), palEl=$('pal'), palInput=$('palInput'), palList=$('palList'), panesEl=$('panes'), tabSlot=$('tabSlot'), paneTpl=$('paneTpl'), fileInput=$('file'), outlineEl=$('outline'), wsDlg=$('wsDlg');
const KEY='mdnotes.v2', OLDKEY='mdnotes.draft';
const APP_VERSION='1.2.0'; $('ver').textContent='v'+APP_VERSION;
const CHEV='<svg viewBox="0 0 10 10" fill="currentColor" aria-hidden="true"><path d="M3 1l5 4-5 4z"/></svg>';
const WELCOME=`# Welcome
Each line is a row. Hover a row and click the box beside it to check it off.

## Getting started
- [ ] Open a markdown file, or just start typing
- [x] Click the arrow beside a heading or list to collapse it
- [ ] Press Ctrl+S to save @today

## How it works
1. Start a line with \`#\` for a heading, \`-\` for a bullet, \`1.\` for a numbered list, or \`[]\` for a checkbox
2. Tab and Shift+Tab indent lines and nest lists
   - Nested lists collapse too
3. Ctrl+Space checks or unchecks the current line, Alt+Up/Down moves it
4. **Bold**, *italic* and \`code\` stay formatted while you type; put the caret on a word to edit its markers
5. Link to another tab with [[Ideas]] and it appears under **Linked from** on that tab
6. Add #tags anywhere, and mark priority with ! or !! anywhere on a line
7. The **View** menu has an outline, an agenda of dated items across tabs, a filter for open items, due dates, priority and tags, and settings. **Help** lists every shortcut, and Ctrl+Shift+P finds any command by name
`;
const PLAIN=(()=>{try{const d=document.createElement('div');d.contentEditable='plaintext-only';return d.contentEditable==='plaintext-only';}catch(e){return false;}})();
const HL=('highlights' in CSS)&&typeof Highlight==='function';
const PIN='<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M9.5 1.5l5 5-1.4 1.4-.9-.3-2.6 2.6.4 3.1-1.3 1.3-3-3-3.6 3.6-1-1 3.6-3.6-3-3 1.3-1.3 3.1.4 2.6-2.6-.3-.9z"/></svg>';

/* ---------- shared state ---------- */
const FILTER_DEFAULTS={status:'all',due:'any',pri:'any',tags:[],parents:true,children:true,dim:false};
const settings={zoom:1,hideDone:false,indentHeadings:true,side:{open:true,view:'files',w:240,tagSort:'count'},theme:'system',font:'system',spell:true,lang:'',sync:true,autosave:true,fsort:'az',frontMatter:'fold',daily:{folder:'Daily',format:'YYYY-MM-DD',template:''},templates:{folder:'Templates'},filter:Object.assign({on:false},FILTER_DEFAULTS)};
let draftTimer=0;
/* tabs closed in this session, newest last, so Reopen closed tab can bring them back */
const closedTabs=[];
function rememberClosed(d){
  if(isBlank(d)) return;
  closedTabs.push({name:d.name,handle:d.handle,wsPath:d.wsPath,text:d.handle?null:serializeLines(d.lines),ctime:d.ctime});
  if(closedTabs.length>20) closedTabs.shift();
}
async function reopenClosed(){
  const t=closedTabs.pop(); if(!t) return;
  const e=t.wsPath&&vx.notes.get(t.wsPath);
  if(e&&e.handle){ await openNote(e,'tab'); return; }
  if(t.handle){ try{ const f=await t.handle.getFile(); await A().openInto(await f.text(),t.name,t.handle,{mtime:f.lastModified}); return; }catch(x){} }
  if(t.text!=null){ A().newTab(t.name,t.text); A().D().ctime=t.ctime||Date.now(); renderTabsAll(); }
  else reopenClosed();
}
const uid=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36);
function newDoc(name,text){ return {id:uid(), name:name||'Untitled.md', lines:fromTextRaw(text||''), handle:null, dirty:false, undo:[], redo:[], sel:null, scroll:0, indentUnit:2, ctime:null, mtime:undefined, pinned:false, back:[], fwd:[]}; }
function todayStr(d=new Date()){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function shiftDate(n){ const d=new Date(); d.setDate(d.getDate()+n); return todayStr(d); }
