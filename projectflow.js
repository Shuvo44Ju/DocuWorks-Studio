/* ProjectFlow — browser-local Excel to project planner */
'use strict';
(function(){
const $=id=>document.getElementById(id);
const STORE='docuworks-projectflow-v1';
const fields=[
 {key:'name',label:'Task / equipment name',aliases:['task','task name','task title','activity','activity name','activity title','name of activity','equipment','equipment name','equipment details','equipment description','item','item name','item description','item details','description','description of activity','work description','work item','work item details','scope','scope of work','deliverable','particulars','particulars of work','project activity','task / activity','activity / task','activity description','work package activity','name of work','job description','supply description'],required:true},
 {key:'id',label:'Unique task ID',aliases:['task id','task number','task no','task no.','activity id','activity number','activity no','activity no.','id','serial','serial number','sl','sl no','sl no.','item no','item number','item code','activity code','task code','wbs id','wbs code','sequence','sequence no']},
 {key:'reference',label:'PR / PO / CS reference',aliases:['pr no','pr number','po no','po number','cer no','cer number','cs no','cs number','requisition no','purchase requisition','purchase requisition no','purchase order no','purchase order number','pr reference','po reference','reference number','ref no','reference','contract no','contract number','work order no']},
 {key:'project',label:'Project / package / department',aliases:['project','project name','project title','package','package name','project package','work package','category','discipline','department','division','lot','lot name','group','project component','workstream']},
 {key:'owner',label:'Responsible person / team',aliases:['responsible','responsible person','person responsible','responsible officer','responsible department','owner','assigned to','assigned person','assignee','in charge','person in charge','focal person','focal','project manager','supervisor','team lead','pic','implementing agency','executing agency','section in charge']},
 {key:'supplier',label:'Supplier / contractor',aliases:['supplier','supplier name','vendor','vendor name','contractor','contractor name','manufacturer','manufacturer name','company','firm','bidder','service provider','consultant']},
 {key:'start',label:'Planned start date',aliases:['start','start date','planned start','planned start date','schedule start','scheduled start','scheduled start date','commencement','commencement date','date of commencement','starting date','mobilization date','mobilisation date','work start date','target start date','baseline start date planned']},
 {key:'finish',label:'Planned finish / delivery date',aliases:['finish','finish date','end date','due date','planned finish','planned finish date','planned end date','schedule finish','scheduled finish','scheduled finish date','expected date','expected delivery','expected delivery date','delivery date','target date','target completion','target completion date','completion date','completion deadline','deadline','required date','handover date','contractual completion date']},
 {key:'duration',label:'Duration (days)',aliases:['duration','duration days','duration in days','calendar days','working days','business days','period','period required','time required','time duration','lead time','implementation period','execution period','contract period','duration (days)','total duration','no of days','number of days']},
 {key:'progress',label:'Progress (%)',aliases:['progress','progress %','% progress','% complete','percent complete','percentage complete','completion percent','completion percentage','completion rate','physical progress','physical progress %','work progress','project progress','actual progress','percentage progress']},
 {key:'status',label:'Current status',aliases:['status','current status','progress status','stage','current stage','work status','procurement status','implementation status','execution status','activity status','task status','delivery status']},
 {key:'predecessor',label:'Predecessor / dependency',aliases:['predecessor','predecessors','predecessor id','predecessor task','predecessor activity','dependency','dependencies','depends on','dependent on','linked task','previous activity','previous task','preceding activity','dependency id','linked to','relation']},
 {key:'priority',label:'Priority',aliases:['priority','importance','criticality','risk level']},
 {key:'baselineStart',label:'Baseline start',aliases:['baseline start','baseline start date','original start','original start date','planned start baseline','approved start date','initial planned start']},
 {key:'baselineFinish',label:'Baseline finish',aliases:['baseline finish','baseline finish date','original finish','original completion','original completion date','baseline end','approved finish date','initial planned finish']},
 {key:'actualStart',label:'Actual start',aliases:['actual start','actual start date','started on','actual commencement','actual commencement date','actual starting date']},
 {key:'actualFinish',label:'Actual finish',aliases:['actual finish','actual finish date','actual end date','actual completion','actual completion date','completed on','actual delivery date']},
 {key:'notes',label:'Remarks / current update',aliases:['remarks','remark','comments','comment','notes','latest update','current update','observation','issue','issues','constraint','constraints','action required','follow up','follow up action','details','description details','progress update']},
 {key:'milestone',label:'Milestone',aliases:['milestone','key milestone','is milestone','milestone flag','milestone yes no']}
];
let tasks=[],projectName='Untitled project',sourceFile='',pending=null,view='overview',zoom='week',toastTimer=null,lastWarnings=[],selectedIds=new Set(),criticalIds=new Set(),dateRange=null,dependencyMap=new Map(),dependencyDiagnostics={unknown:0,cycles:0,count:0};
const today=()=>{const d=new Date();d.setHours(0,0,0,0);return d};
const iso=d=>{if(!d)return '';const x=new Date(d);return x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0')};
const fromISO=s=>s?new Date(s+'T00:00:00'):null;
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s==null?'':s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9%]+/g,' ').trim().replace(/\s+/g,' ');
const uid=()=>('t'+Date.now().toString(36)+Math.random().toString(36).slice(2,7));
function toast(msg){const el=$('toast');el.textContent=msg;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3100)}
function save(){try{localStorage.setItem(STORE,JSON.stringify({tasks:tasks,projectName:projectName,sourceFile:sourceFile,updated:Date.now()}))}catch(e){toast('Browser storage is full. Export a backup workbook.')}}
function loadSaved(){try{const x=JSON.parse(localStorage.getItem(STORE)||'null');if(x&&Array.isArray(x.tasks)){tasks=x.tasks;projectName=x.projectName||'Untitled project';sourceFile=x.sourceFile||''}}catch(e){}}
function isoFromParts(y,m,d){
 const x=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
 if(x.getUTCFullYear()!==Number(y)||x.getUTCMonth()!==Number(m)-1||x.getUTCDate()!==Number(d))return '';
 return String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
}
function parseDate(v,order,date1904){
 if(v===null||v===undefined||v==='')return '';
 if(v instanceof Date&&!isNaN(v))return isoFromParts(v.getUTCFullYear(),v.getUTCMonth()+1,v.getUTCDate());
 if(typeof v==='number'&&isFinite(v)&&v>=1&&v<=2958465){
  const base=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,30);
  const d=new Date(base+Math.floor(v)*86400000);
  return isoFromParts(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());
 }
 const s=String(v).replace(/^\uFEFF/,'').trim();if(!s)return '';
 let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/);
 if(m)return isoFromParts(Number(m[1]),Number(m[2]),Number(m[3]));
 m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\D|$)/);
 if(m){
  let a=Number(m[1]),b=Number(m[2]),y=Number(m[3]);if(y<100)y+=y<50?2000:1900;
  let day,month;
  if(a>12){day=a;month=b}else if(b>12){month=a;day=b}else if(String(order||'DMY').toUpperCase()==='MDY'){month=a;day=b}else{day=a;month=b}
  return isoFromParts(y,month,day);
 }
 const months={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
 m=s.match(/^(\d{1,2})[\s,./-]+([a-z]{3,})[\s,./-]+(\d{2,4})/i);
 if(m&&months[m[2].toLowerCase()]){let y=Number(m[3]);if(y<100)y+=y<50?2000:1900;return isoFromParts(y,months[m[2].toLowerCase()],Number(m[1]))}
 m=s.match(/^([a-z]{3,})[\s,./-]+(\d{1,2})[\s,./-]+(\d{2,4})/i);
 if(m&&months[m[1].toLowerCase()]){let y=Number(m[3]);if(y<100)y+=y<50?2000:1900;return isoFromParts(y,months[m[1].toLowerCase()],Number(m[2]))}
 const parsed=new Date(s);if(!isNaN(parsed))return isoFromParts(parsed.getFullYear(),parsed.getMonth()+1,parsed.getDate());
 return '';
}
function dayNumber(value){
 const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
 return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):NaN;
}
function dayToISO(n){
 const d=new Date(Number(n)*86400000);return isoFromParts(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());
}
function daySpan(a,b){return dayNumber(b)-dayNumber(a)}
function shiftDurationDate(date,days,workdays,reverse){
 if(!date||!days||days<=0)return date||'';
 const d=fromISO(date),dir=reverse?-1:1;let left=Math.max(0,Math.ceil(days)-1),guard=0;
 while(left>0&&guard++<20000){d.setDate(d.getDate()+dir);if(!workdays||(d.getDay()!==0&&d.getDay()!==6))left--}
 return iso(d);
}
function parseDuration(value,header){
 const raw=String(value==null?'':value).trim();if(!raw)return {days:null,workdays:/working|business/i.test(String(header||'')),text:'',invalid:false};
 const h=String(header||'');const workdays=/working|business/i.test(h+' '+raw);
 const range=raw.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)/i);
 if(range)return {days:null,workdays:workdays,text:raw,invalid:true};
 const n=numberValue(raw);if(n===null)return {days:null,workdays:workdays,text:raw,invalid:true};
 const u=norm(raw+' '+h);
 let factor=1;
 if(/\b(week|weeks|wk|wks)\b/.test(u))factor=7;
 else if(/\b(month|months|mo)\b/.test(u))factor=30;
 else if(/\b(year|years|yr)\b/.test(u))factor=365;
 else if(/\b(hour|hours|hr|hrs)\b/.test(u))return {days:null,workdays:workdays,text:raw,invalid:true};
 return {days:Math.max(0,n*factor),workdays:workdays,text:raw,invalid:false};
}
function numberValue(v){if(v===null||v===undefined||v==='')return null;if(typeof v==='number')return v;const s=String(v).replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);return s?Number(s[0]):null}
function normalizeStatus(raw,progress){
 const s=norm(raw);
 if(/awaiting|waiting|pending|not received|not submitted|not issued|not released|not yet/.test(s))return 'Needs review';
 if(/complete|completed|done|closed|delivered|received|installed|commissioned|finished|released/.test(s))return 'Completed';
 if(/hold|suspend|blocked|pending approval/.test(s))return 'On hold';
 if(/cancel|dropped|terminated/.test(s))return 'Cancelled';
 if(/review|clarif|awaiting|waiting|pending|not received|not submitted/.test(s))return 'Needs review';
 if(/progress|ongoing|working|started|under process|processing|procurement|manufactur|shipment|transit|installation|testing|evaluation|issued|ordered/.test(s))return 'In progress';
 if(/not started|not yet|not initiate|new|planned|to be started/.test(s))return 'Not started';
 if(progress===100)return 'Completed';if(progress!==null&&progress>0)return 'In progress';return 'Not started';
}
function normalizeProgress(v,status){
 let n=numberValue(v);if(n!==null){if(n>0&&n<=1&&String(v).includes('%')===false)n*=100;return Math.max(0,Math.min(100,n))}
 if(status==='Completed')return 100;if(status==='Not started'||status==='Cancelled')return 0;return null;
}
function fieldScore(field,header){
 const n=norm(header);if(!n)return 0;let score=0;
 for(const alias of field.aliases){
  const q=norm(alias);if(!q)continue;
  if(n===q)score=Math.max(score,145+(field.key==='name'?12:0));
  else if(n.includes(q))score=Math.max(score,76+Math.min(12,q.length/3));
  else if(q.includes(n)&&n.length>=5)score=Math.max(score,48+Math.min(8,n.length/4));
  else{
   const a=q.split(' ').filter(Boolean),b=new Set(n.split(' ')),hits=a.filter(w=>b.has(w)).length;
   if(a.length>=2&&hits===a.length)score=Math.max(score,66);
   else if(a.length>=2&&hits>=2)score=Math.max(score,35+hits*5);
  }
 }
 if((field.key==='start'||field.key==='finish')&&/baseline|actual|original|revised|forecast/.test(n))score-=105;
 if(field.key==='baselineStart'||field.key==='baselineFinish'){if(!/baseline|original|approved|initial/.test(n))score-=80}
 if(field.key==='actualStart'||field.key==='actualFinish'){if(!/actual/.test(n))score-=85}
 if(field.key==='owner'&&/project|package|lot/.test(n))score-=50;
 if(field.key==='project'&&/responsible|assigned|officer|person|owner/.test(n))score-=55;
 if(field.key==='name'&&/remarks|comments|update|status/.test(n))score-=65;
 if(field.key==='notes'&&/^(task|activity|equipment|item)\b/.test(n))score-=55;
 return score;
}
function autoMap(headers){
 const candidates=[];
 fields.forEach((f,fi)=>headers.forEach((h,ci)=>{const score=fieldScore(f,h);if(score>=55)candidates.push({key:f.key,fi:fi,ci:ci,score:score})}));
 candidates.sort((a,b)=>b.score-a.score||a.fi-b.fi||a.ci-b.ci);
 const out={},used=new Set();
 candidates.forEach(c=>{if(out[c.key]===undefined&&!used.has(c.ci)){out[c.key]=String(c.ci);used.add(c.ci)}});
 return out;
}
function buildHeaderLabels(matrix,index){
 const current=(matrix[index]||[]).map(v=>String(v==null?'':v).trim());
 const parent=(index>0?(matrix[index-1]||[]):[]).map(v=>String(v==null?'':v).trim());
 const merges=(pending&&pending.merges)||[];
 merges.forEach(m=>{
  if(m.s&&m.e&&m.s.r===index-1&&m.e.r===index-1&&m.e.c>m.s.c){
   const value=parent[m.s.c]||'';
   for(let c=m.s.c;c<=m.e.c;c++)parent[c]=value;
  }
 });
 const parentCount=parent.filter(Boolean).length;
 const grouped=parentCount>=2&&current.some((v,i)=>v&&parent[i]&&norm(v)!==norm(parent[i]));
 const len=Math.max(current.length,parent.length);
 return Array.from({length:len},(_,i)=>{
  const child=current[i]||'',top=grouped?parent[i]||'':'';
  const value=(top&&child)?top+' — '+child:(child||top);
  return value||'Column '+(i+1);
 });
}
function detectHeader(matrix){
 let best=0,bestScore=-Infinity;
 for(let i=0;i<Math.min(matrix.length,60);i++){
  const headers=buildHeaderLabels(matrix,i),mapping=autoMap(headers),mapped=Object.keys(mapping).length;
  const nameCol=mapping.name===undefined?-1:Number(mapping.name);
  const nameSamples=nameCol<0?0:matrix.slice(i+1,i+9).filter(r=>r&&String(r[nameCol]??'').trim()).length;
  const nonEmpty=(matrix[i]||[]).filter(v=>String(v??'').trim()).length;
  const dateFields=['start','finish','baselineStart','baselineFinish','actualStart','actualFinish'].filter(k=>mapping[k]!==undefined).length;
  const score=(nameCol>=0?22:0)+mapped*3.2+dateFields*2.5+Math.min(nameSamples,6)*1.4+nonEmpty*.12;
  if(score>bestScore){bestScore=score;best=i}
 }
 return best;
}
function parseCSV(text){
 const clean=String(text||'').replace(/^\uFEFF/,'');
 const first=clean.split(/\r?\n/).find(x=>x.trim())||'';
 const delimiters=[',',';','\t'];let delimiter=',',best=-1;
 delimiters.forEach(d=>{let count=0,quoted=false;for(let i=0;i<first.length;i++){if(first[i]==='"'){if(quoted&&first[i+1]==='"'){i++}else quoted=!quoted}else if(!quoted&&first[i]===d)count++}if(count>best){best=count;delimiter=d}});
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<clean.length;i++){
  const c=clean[i];
  if(quoted){if(c==='"'&&clean[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c}
  else if(c==='"')quoted=true;
  else if(c===delimiter){row.push(cell);cell=''}
  else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}
  else cell+=c;
 }
 if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row)}
 return rows;
}
function fileToWorkbook(file){
 return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=e=>{try{let wb;if(/\.csv$/i.test(file.name)){wb={SheetNames:['CSV'],Sheets:{CSV:{__rows:parseCSV(e.target.result)}}}}else{if(!window.XLSX)throw new Error('The Excel reader did not load. Check your internet connection and refresh this page.');wb=XLSX.read(e.target.result,{type:'array',cellDates:true})}resolve(wb)}catch(err){reject(err)}};reader.onerror=()=>reject(new Error('Could not read this workbook.'));if(/\.csv$/i.test(file.name))reader.readAsText(file);else reader.readAsArrayBuffer(file)})
}
function sheetMatrix(wb,name){
 const sh=wb.Sheets[name];if(sh.__rows)return sh.__rows;
 if(!window.XLSX)throw new Error('Excel reader unavailable.');
 return XLSX.utils.sheet_to_json(sh,{header:1,defval:'',raw:true,blankrows:true});
}
function openImport(file,mode){
 fileToWorkbook(file).then(wb=>{
  const names=wb.SheetNames||['CSV'];if(!names.length)throw new Error('No worksheets found.');
  const date1904=!!(wb.Workbook&&wb.Workbook.WBProps&&wb.Workbook.WBProps.date1904);
  pending={file:file,wb:wb,sheets:names,mode:mode||'replace',matrix:[],headers:[],headerIndex:0,mapping:{},merges:[],date1904:date1904};
  $('sheetSelect').innerHTML=names.map(n=>'<option value="'+esc(n)+'">'+esc(n)+'</option>').join('');
  loadPendingSheet();
  $('importFileDescription').textContent=file.name+' · Review the detected fields and date format before importing.';
  $('mergeRadioWrap').style.display=tasks.length?'flex':'none';
  $('mergeHint').textContent=tasks.length?'Replace the current project or merge changes into existing tasks.':'This will create a new project from the selected worksheet.';
  document.querySelector('input[name="importMode"][value="'+(mode||'replace')+'"]').checked=true;
  $('importOverlay').hidden=false;
 }).catch(e=>toast(e.message||'Could not open workbook.'));
}
function loadPendingSheet(){
 if(!pending)return;
 const name=$('sheetSelect').value||pending.sheets[0],sheet=pending.wb.Sheets[name];
 pending.merges=(sheet&&sheet['!merges'])||[];
 pending.matrix=sheetMatrix(pending.wb,name);
 const idx=detectHeader(pending.matrix);pending.headerIndex=idx;
 const count=Math.min(60,pending.matrix.length);
 const options=pending.matrix.slice(0,count).map((r,i)=>'<option value="'+i+'" '+(i===idx?'selected':'')+'>Row '+(i+1)+': '+esc((r||[]).slice(0,5).filter(Boolean).join(' · ').slice(0,90)||'(blank)')+'</option>').join('');
 $('headerRowSelect').innerHTML=options;applyHeader();
}
function applyHeader(){
 if(!pending)return;
 pending.headerIndex=Number($('headerRowSelect').value||0);
 pending.headers=buildHeaderLabels(pending.matrix,pending.headerIndex);
 pending.mapping=autoMap(pending.headers);renderMapping();renderImportPreview();
 const count=Math.max(0,pending.matrix.length-pending.headerIndex-1);
 $('importRowCount').textContent=count+' source rows below header';
}
function renderMapping(){
 $('mappingRows').innerHTML=fields.map(f=>{
  const options='<option value="">— Not mapped —</option>'+pending.headers.map((h,i)=>'<option value="'+i+'" '+(pending.mapping[f.key]===String(i)?'selected':'')+'>'+esc(h)+' · Col '+(i+1)+'</option>').join('');
  return '<div class="pf-map-row"><label>'+esc(f.label)+(f.required?' <em>*</em>':'')+'</label><select data-map="'+f.key+'">'+options+'</select></div>';
 }).join('');
 $('mappingRows').querySelectorAll('select').forEach(sel=>sel.addEventListener('change',()=>{
  const key=sel.dataset.map,value=sel.value;
  if(value){
   const conflict=Object.keys(pending.mapping).find(k=>k!==key&&pending.mapping[k]===value);
   if(conflict){pending.mapping[conflict]='';toast('That column was already assigned to '+(fields.find(f=>f.key===conflict)?.label||conflict)+'. The duplicate mapping was cleared.')}
  }
  pending.mapping[key]=value;renderMapping();renderImportPreview();
 }));
}
function mappedCell(rowIndex,colIndex){
 const row=pending.matrix[rowIndex]||[];let value=row[colIndex];
 if(value!==''&&value!==null&&value!==undefined)return value;
 for(const m of pending.merges||[]){
  if(m.s&&m.e&&m.s.r<rowIndex&&m.e.r>=rowIndex&&m.s.c<=colIndex&&m.e.c>=colIndex){
   const anchor=(pending.matrix[m.s.r]||[])[m.s.c];if(anchor!==''&&anchor!==null&&anchor!==undefined)return anchor;
  }
 }
 return value;
}
function renderImportPreview(){
 if(!pending)return;
 const ix=pending.mapping,chosen=fields.filter(f=>ix[f.key]!==undefined&&ix[f.key]!=='');
 const result=readMappedRows(),previewRows=result.list.length?result.list.slice(0,5).map(t=>t.sourceRow-1):pending.matrix.slice(pending.headerIndex+1).map((r,i)=>pending.headerIndex+1+i).filter(i=>(pending.matrix[i]||[]).some(v=>v!==''&&v!==null&&v!==undefined)).slice(0,5);
 const shown=chosen.slice(0,10);
 $('importPreview').innerHTML='<thead><tr>'+shown.map(f=>'<th>'+esc(f.label)+'</th>').join('')+'</tr></thead><tbody>'+previewRows.map(ri=>'<tr>'+shown.map(f=>'<td>'+esc(mappedCell(ri,Number(ix[f.key]))??'')+'</td>').join('')+'</tr>').join('')+'</tbody>';
 $('importRowCount').textContent=result.list.length+' task rows detected · '+result.stats.rowsScanned+' source rows scanned';
 const mapped=Object.keys(ix).filter(k=>ix[k]!==''&&ix[k]!==undefined).length;
 const lines=[''+mapped+' of '+fields.length+' project fields mapped automatically',result.stats.missingDates+' task(s) without complete planned dates'];
 if(result.stats.invalidDates)lines.push(result.stats.invalidDates+' date value(s) could not be interpreted');
 if(result.stats.reversedDates)lines.push(result.stats.reversedDates+' row(s) have finish dates before start dates');
 if(result.stats.invalidDurations)lines.push(result.stats.invalidDurations+' duration value(s) need review');
 if(!ix.name)lines.unshift('Task name column is not mapped — select it before importing');
 if(result.warnings.length)lines.push(result.warnings[0]);
 $('importQuality').innerHTML='<strong>'+(ix.name?'Import check':'Mapping required')+'</strong><span>'+lines.map(esc).join(' · ')+'</span>';
 $('importQuality').classList.toggle('warning',!ix.name||result.stats.invalidDates>0||result.stats.reversedDates>0);
}
function readMappedRows(){
 const ix=pending.mapping,rows=pending.matrix.slice(pending.headerIndex+1),list=[],warnings=[];
 const col=k=>ix[k]===undefined||ix[k]===''?null:Number(ix[k]);
 const get=(rowIndex,k)=>{const c=col(k);return c===null?'':mappedCell(rowIndex,c)??''};
 const dateOrder=$('dateOrder')?.value||'DMY',date1904=!!pending.date1904;
 const stats={rowsScanned:0,skippedRows:0,missingDates:0,invalidDates:0,reversedDates:0,invalidDurations:0,ambiguousDates:0,duplicates:0};
 const idSeen=new Set(),nameSeen=new Set();
 rows.forEach((r,offset)=>{
  const rowIndex=pending.headerIndex+1+offset;
  if(!r||!r.some(v=>v!==''&&v!==null&&v!==undefined))return;
  stats.rowsScanned++;
  const name=String(get(rowIndex,'name')).trim();
  if(!name){stats.skippedRows++;return}
  if(/^(grand\s+)?(sub\s*)?total(?:\s+items?)?$|^project\s+summary$|^overall\s+progress$/i.test(name)){stats.skippedRows++;return}
  const progressRaw=get(rowIndex,'progress'),rawStatus=get(rowIndex,'status');
  const progress=normalizeProgress(progressRaw,normalizeStatus(rawStatus,null));
  const status=normalizeStatus(rawStatus,progress);
  const rawStart=get(rowIndex,'start'),rawFinish=get(rowIndex,'finish');
  let start=parseDate(rawStart,dateOrder,date1904),finish=parseDate(rawFinish,dateOrder,date1904);
  const durationHeader=col('duration')===null?'':pending.headers[col('duration')];
  const durationMeta=parseDuration(get(rowIndex,'duration'),durationHeader);
  let duration=durationMeta.days;
  if(durationMeta.invalid)stats.invalidDurations++;
  if(rawStart!==''&&!start)stats.invalidDates++;
  if(rawFinish!==''&&!finish)stats.invalidDates++;
  if(start&&finish&&daySpan(start,finish)<0){stats.reversedDates++;start='';finish=''}
  if(start&&!finish&&duration!==null&&duration>0)finish=shiftDurationDate(start,duration,durationMeta.workdays,false);
  if(finish&&!start&&duration!==null&&duration>0)start=shiftDurationDate(finish,duration,durationMeta.workdays,true);
  if(duration===null&&start&&finish)duration=daySpan(start,finish)+1;
  if(!start||!finish)stats.missingDates++;
  const actualStart=parseDate(get(rowIndex,'actualStart'),dateOrder,date1904);
  const actualFinish=parseDate(get(rowIndex,'actualFinish'),dateOrder,date1904);
  const baselineStart=parseDate(get(rowIndex,'baselineStart'),dateOrder,date1904);
  const baselineFinish=parseDate(get(rowIndex,'baselineFinish'),dateOrder,date1904);
  const id=String(get(rowIndex,'id')).trim();
  const duplicateKey=id?'id:'+norm(id):'name:'+norm(name)+'|'+norm(get(rowIndex,'project'));
  if(idSeen.has(duplicateKey)||nameSeen.has('name:'+norm(name)+'|'+norm(get(rowIndex,'project'))))stats.duplicates++;
  idSeen.add(duplicateKey);nameSeen.add('name:'+norm(name)+'|'+norm(get(rowIndex,'project')));
  const milestoneRaw=String(get(rowIndex,'milestone')).trim();
  const sourceRow=rowIndex+1;
  list.push({
   id:uid(),externalId:id,reference:String(get(rowIndex,'reference')).trim(),name:name,
   project:String(get(rowIndex,'project')).trim(),owner:String(get(rowIndex,'owner')).trim(),supplier:String(get(rowIndex,'supplier')).trim(),
   start:start,finish:finish,duration:duration,sourceDurationText:durationMeta.text,progress:progress,status:status,
   predecessor:String(get(rowIndex,'predecessor')).trim(),priority:String(get(rowIndex,'priority')||'Normal').trim(),
   baselineStart:baselineStart,baselineFinish:baselineFinish,actualStart:actualStart,actualFinish:actualFinish,
   notes:String(get(rowIndex,'notes')).trim(),milestone:/^(yes|y|true|milestone|1|x|✓)$/i.test(milestoneRaw),
   sourceRow:sourceRow,importRaw:{start:String(rawStart??''),finish:String(rawFinish??''),duration:String(get(rowIndex,'duration')??'')}
  });
 });
 if(col('name')===null)warnings.push('No task / activity name column is mapped.');
 if(!list.length)warnings.push('No usable task rows were found. Check the header row and task-name mapping.');
 if(stats.missingDates)warnings.push(stats.missingDates+' task(s) have incomplete planned dates. Missing dates are not invented.');
 if(stats.invalidDates)warnings.push(stats.invalidDates+' date value(s) could not be interpreted; review the source cells and date format.');
 if(stats.reversedDates)warnings.push(stats.reversedDates+' task(s) have finish dates earlier than start dates. Their planned dates were cleared.');
 if(stats.invalidDurations)warnings.push(stats.invalidDurations+' duration value(s) contain ranges or unsupported units; they were not converted into guessed dates.');
 if(stats.duplicates)warnings.push(stats.duplicates+' possible duplicate task rows were found; all were retained for review.');
 stats.missingDates=list.filter(t=>!t.start||!t.finish).length;
 return {list:list,warnings:warnings,stats:stats};
}
function taskKey(t){return (t.externalId?'id:'+norm(t.externalId):'name:'+norm(t.name)+'|'+norm(t.project))}
function mergeTasks(incoming){
 const old=new Map();const addKeys=t=>{if(t.externalId)old.set('id:'+norm(t.externalId),t);old.set('name:'+norm(t.name)+'|'+norm(t.project),t)};
 tasks.forEach(addKeys);let added=0,updated=0;
 incoming.forEach(n=>{const key='name:'+norm(n.name)+'|'+norm(n.project),o=(n.externalId?old.get('id:'+norm(n.externalId)):null)||old.get(key);if(!o){tasks.push(n);addKeys(n);added++;return}
 const preserve=['id'];Object.keys(n).forEach(k=>{if(!preserve.includes(k)&&n[k]!==''&&n[k]!==null&&n[k]!==undefined)o[k]=n[k]});addKeys(o);updated++});
 return {added:added,updated:updated};
}
function commitImport(){
 const result=readMappedRows();if(!result.list.length){toast(result.warnings[0]||'No tasks found.');return}
 const mode=document.querySelector('input[name="importMode"]:checked')?.value||'replace';
 let msg='';if(mode==='merge'&&tasks.length){const r=mergeTasks(result.list);msg=r.added+' new, '+r.updated+' updated'}else{tasks=result.list;msg=tasks.length+' tasks imported'}
 sourceFile=pending.file.name;const base=sourceFile.replace(/\.[^.]+$/,'');if(!projectName||projectName==='Untitled project')projectName=base;
 lastWarnings=result.warnings;$('projectName').value=projectName;$('sourceFilePill').textContent=sourceFile;
 $('importOverlay').hidden=true;pending=null;save();showWorkspace();renderAll();toast(msg+' · Project ready');
}
function showWorkspace(){$('emptyState').hidden=true;$('projectWorkspace').hidden=false}
function statusClass(s){return norm(s).replace(/\s+/g,'-')}
function statusCounts(){const c={'Not started':0,'In progress':0,'On hold':0,'Completed':0,'Cancelled':0,'Needs review':0};tasks.forEach(t=>c[t.status]=(c[t.status]||0)+1);return c}
function durationDays(t){if(t.duration!==null&&t.duration!==undefined&&t.duration!=='')return Math.max(0,Number(t.duration));if(t.start&&t.finish)return Math.max(1,Math.round((fromISO(t.finish)-fromISO(t.start))/86400000)+1);return null}
function varianceDays(t){const base=t.baselineFinish,actual=t.actualFinish||t.finish;if(!base||!actual)return null;return Math.round((fromISO(actual)-fromISO(base))/86400000)}
function isOverdue(t){return !!(t.finish&&fromISO(t.finish)<today()&&t.status!=='Completed'&&t.status!=='Cancelled')}
function computeCritical(){
 const byKey=new Map(),refCounts=new Map();tasks.forEach(t=>{byKey.set(norm(t.name),t);if(t.externalId)byKey.set(norm(t.externalId),t);byKey.set(norm(t.id),t);if(t.reference)refCounts.set(norm(t.reference),(refCounts.get(norm(t.reference))||0)+1)});tasks.forEach(t=>{if(t.reference&&refCounts.get(norm(t.reference))===1)byKey.set(norm(t.reference),t)});
 const predMap=new Map();tasks.forEach(t=>{const refs=String(t.predecessor||'').split(/[;,|]+/).map(norm).filter(Boolean);predMap.set(t.id,refs.map(r=>byKey.get(r)).filter(Boolean).map(p=>p.id).filter(id=>id!==t.id))});
 const dependencyCount=[...predMap.values()].reduce((n,a)=>n+a.length,0);if(!dependencyCount){criticalIds=new Set();return {path:[],score:0,cycles:0,dependencies:0}}
 const memo=new Map(),vis=new Set(),cycle=new Set();
 function longest(id){if(memo.has(id))return memo.get(id);if(vis.has(id)){cycle.add(id);return {score:(durationDays(tasks.find(t=>t.id===id))||0),path:[id]}}vis.add(id);const preds=predMap.get(id)||[];let best={score:0,path:[]};preds.forEach(pid=>{const p=longest(pid);if(p.score>best.score)best=p});vis.delete(id);const result={score:best.score+(durationDays(tasks.find(t=>t.id===id))||0),path:best.path.concat(id)};memo.set(id,result);return result}
 let best={score:0,path:[]};tasks.forEach(t=>{const x=longest(t.id);if(x.score>best.score)best=x});criticalIds=new Set(best.path);
 return {path:best.path,score:best.score,cycles:cycle.size,dependencies:dependencyCount,unknownDurations:best.path.filter(id=>durationDays(tasks.find(t=>t.id===id))===null).length};
}
function getStats(){
 const c=statusCounts(),valid=tasks.filter(t=>t.progress!==null&&t.progress!==undefined),weight=valid.reduce((s,t)=>s+(durationDays(t)||1),0),done=valid.reduce((s,t)=>s+(durationDays(t)||1)*t.progress,0);const progress=weight?Math.round(done/weight):null;const overdue=tasks.filter(isOverdue).length;const missing=tasks.filter(t=>!t.start||!t.finish).length;const owners=new Set(tasks.map(t=>t.owner).filter(Boolean)).size;const dated=tasks.filter(t=>t.start&&t.finish);const next=dated.filter(t=>fromISO(t.finish)>=today()&&t.status!=='Completed'&&t.status!=='Cancelled').sort((a,b)=>a.start.localeCompare(b.start));return {c:c,progress:progress,overdue:overdue,missing:missing,owners:owners,dated:dated,next:next,critical:tasks.filter(t=>criticalIds.has(t.id)).length,completed:c.Completed};
}
function kpi(label,value,sub,icon,cls){return '<div class="pf-kpi '+(cls||'')+'"><div class="pf-kpi-top"><span>'+label+'</span><span class="pf-kpi-icon">'+icon+'</span></div><strong>'+value+'</strong><small>'+sub+'</small></div>'}
function renderOverview(){
 computeCritical();const s=getStats();$('kpiGrid').innerHTML=kpi('Total activities',tasks.length,'Imported and added tasks','▤','')+kpi('Overall progress',s.progress===null?'—':s.progress+'%',s.progress===null?'Progress not provided in source':'Duration-weighted completion','◔','green')+kpi('Completed',s.completed,'Activities marked complete','✓','green')+kpi('Overdue',s.overdue,'Past finish date and not complete','!','red')+kpi('Critical activities',s.critical,'Calculated from dependency chain','⌁','purple');
 $('overallProgress').textContent=s.progress===null?'—':s.progress+'%';$('progressDonut').style.background='conic-gradient(#16866a '+(s.progress||0)+'%,#eaf0f5 0)';
 const legend=[['Completed',s.c.Completed,'#16866a'],['In progress',s.c['In progress'],'#4d79d6'],['Not started',s.c['Not started'],'#aab6c6'],['On hold / review',s.c['On hold']+s.c['Needs review'],'#e8ad43']];
 $('progressLegend').innerHTML=legend.map(x=>'<div class="pf-legend-row"><span><i class="pf-legend-dot" style="background:'+x[2]+'"></i>'+x[0]+'</span><b>'+x[1]+'</b></div>').join('');
 $('healthList').innerHTML='<div class="pf-health-row"><span>Overdue activities</span><b class="'+(s.overdue?'red':'green')+'">'+s.overdue+'</b></div><div class="pf-health-row"><span>Missing planned dates</span><b>' +s.missing+'</b></div><div class="pf-health-row"><span>Activities with dates</span><b>'+s.dated.length+' / '+tasks.length+'</b></div><div class="pf-health-row"><span>Responsible people</span><b>'+s.owners+'</b></div><div class="pf-health-row"><span>Dependency links</span><b>'+computeCritical().dependencies+'</b></div>';
 $('upcomingList').innerHTML=s.next.slice(0,5).map(t=>'<div class="pf-compact-row"><span class="pf-compact-name">'+esc(t.name)+'</span><span class="pf-compact-meta">'+esc(t.owner||'Unassigned')+'</span><span class="pf-compact-meta">'+esc(t.finish)+'</span></div>').join('')||'<div class="pf-table-empty">No upcoming dated activities found.</div>';
 const statuses=[['Completed',s.c.Completed,'#16866a'],['In progress',s.c['In progress'],'#4d79d6'],['Not started',s.c['Not started'],'#aab6c6'],['On hold',s.c['On hold'],'#e8ad43'],['Needs review',s.c['Needs review'],'#9272d4'],['Cancelled',s.c.Cancelled,'#bdc5d0']];
 $('statusChart').innerHTML=statuses.map(x=>'<div class="pf-status-line"><span>'+x[0]+'</span><div class="pf-status-track"><div class="pf-status-fill" style="width:'+(tasks.length?x[1]/tasks.length*100:0)+'%;background:'+x[2]+'"></div></div><b>'+x[1]+'</b></div>').join('');
 const owners=ownerStats().slice(0,5);$('ownerSummary').innerHTML=owners.map(o=>'<div class="pf-owner-row"><span class="pf-avatar">'+esc(initials(o.name))+'</span><div><b>'+esc(o.name)+'</b><small>'+o.total+' tasks · '+o.overdue+' overdue</small></div><strong>'+o.total+'</strong></div>').join('')||'<div class="pf-table-empty">Responsible people are not mapped yet.</div>';
 renderMiniGantt();$('importNotes').hidden=!lastWarnings.length;$('importNotes').innerHTML=lastWarnings.map(x=>'• '+esc(x)).join('<br>');
}
function ownerStats(){const map=new Map();tasks.forEach(t=>{const n=t.owner||'Unassigned';if(!map.has(n))map.set(n,{name:n,total:0,overdue:0,complete:0,progress:0,progressCount:0,tasks:[]});const o=map.get(n);o.total++;o.overdue+=isOverdue(t)?1:0;o.complete+=t.status==='Completed'?1:0;if(t.progress!==null){o.progress+=t.progress;o.progressCount++}o.tasks.push(t)});return [...map.values()].sort((a,b)=>b.overdue-a.overdue||b.total-a.total)}
function initials(s){return String(s||'?').split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase()}
function renderMiniGantt(){const a=tasks.filter(t=>t.start&&t.finish).slice(0,6);if(!a.length){$('overviewGantt').innerHTML='<div class="pf-table-empty">Add or import planned start and finish dates to see your schedule here.</div>';return}const min=Math.min(...a.map(t=>fromISO(t.start).getTime())),max=Math.max(...a.map(t=>fromISO(t.finish).getTime())),span=Math.max(1,max-min+86400000);$('overviewGantt').innerHTML=a.map(t=>{const left=(fromISO(t.start).getTime()-min)/span*100,w=Math.max(2,(fromISO(t.finish).getTime()-fromISO(t.start).getTime()+86400000)/span*100);return '<div class="pf-mini-gantt-row"><span class="pf-mini-gantt-label">'+esc(t.name)+'</span><div class="pf-mini-gantt-track"><i class="pf-mini-gantt-bar" style="left:'+left+'%;width:'+w+'%"></i></div></div>'}).join('')}
function setView(next){view=next;document.querySelectorAll('.pf-nav[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===next));['overview','gantt','tasks','resources','critical','report'].forEach(v=>{$(v+'View').hidden=(v!==next)});const meta={overview:['PROJECT CONTROL CENTER','Project overview','A live view of your schedule, delivery and execution status.'],gantt:['SCHEDULE MANAGEMENT','Gantt chart','Plan, compare and monitor activity dates across the project timeline.'],tasks:['ACTIVITY REGISTER','Task list','Edit execution details, progress, dates and dependencies.'],resources:['RESOURCE MANAGEMENT','Resources','Review responsibility, workload and overdue activities.'],critical:['SCHEDULE ANALYSIS','Critical path','Identify the dependency chain that controls the project finish.'],report:['MANAGEMENT REPORT','Project status report','A management-ready summary of the current project position.']}[next];$('viewEyebrow').textContent=meta[0];$('viewTitle').textContent=meta[1];$('viewSubtitle').textContent=meta[2];if(next==='overview')renderOverview();if(next==='gantt')renderGantt();if(next==='tasks')renderTasks();if(next==='resources')renderResources();if(next==='critical')renderCritical();if(next==='report')renderReport();window.scrollTo({top:0,behavior:'smooth'})}
function renderAll(){showWorkspace();$('projectName').value=projectName;setView(view)}
function filteredTasks(filter,query){return tasks.filter(t=>{if(filter==='overdue'&&!isOverdue(t))return false;if(filter==='critical'&&!criticalIds.has(t.id))return false;if(filter==='nodates'&&(t.start&&t.finish))return false;if(query&&!norm([t.name,t.owner,t.supplier,t.externalId,t.reference,t.project,t.notes].join(' ')).includes(norm(query)))return false;return true})}
function dateRangeFor(list){const values=[];list.forEach(t=>[t.start,t.finish,t.baselineStart,t.baselineFinish].filter(Boolean).forEach(d=>values.push(fromISO(d).getTime())));if(!values.length)return null;let lo=Math.min(...values),hi=Math.max(...values);const now=today().getTime();if(now<lo)lo=now;if(now>hi)hi=now;list.forEach(t=>{if(t.baselineStart)lo=Math.min(lo,fromISO(t.baselineStart).getTime());if(t.baselineFinish)hi=Math.max(hi,fromISO(t.baselineFinish).getTime())});const pad=zoom==='month'?35:zoom==='week'?10:3;lo-=pad*86400000;hi+=pad*86400000;return {start:new Date(lo),end:new Date(hi),days:Math.ceil((hi-lo)/86400000)+1}}
function renderGantt(){
 computeCritical();const list=filteredTasks($('ganttFilter').value,$('ganttSearch').value);$('ganttTaskCount').textContent=list.length;const range=dateRangeFor(list);const labels=$('ganttLabels'),track=$('ganttTrack');labels.innerHTML='';track.innerHTML='';
 if(!range){$('ganttScroll').style.minHeight='120px';track.style.width='100%';track.innerHTML='<div class="pf-gantt-head"></div><div class="pf-gantt-empty">No planned dates found. Edit a task and add start / finish dates to build the Gantt chart.</div>';list.forEach(t=>labels.insertAdjacentHTML('beforeend','<div class="pf-gantt-label-row" data-edit="'+t.id+'"><span class="pf-gantt-name">'+esc(t.name)+'</span><small>—</small></div>'));return}
 const width=zoom==='day'?29:zoom==='week'?13:4.2;const total=Math.max(range.days*width,700);track.style.width=total+'px';const head=document.createElement('div');head.className='pf-gantt-head';head.style.width=total+'px';
 let cur=new Date(range.start.getFullYear(),range.start.getMonth(),1);while(cur<=range.end){const start=Math.max(0,(new Date(cur.getFullYear(),cur.getMonth(),1)-range.start)/86400000),next=new Date(cur.getFullYear(),cur.getMonth()+1,1),end=Math.min(range.days,(next-range.start)/86400000);const el=document.createElement('div');el.className='pf-gantt-month';el.style.left=start*width+'px';el.style.width=Math.max(1,(end-start)*width)+'px';el.textContent=cur.toLocaleDateString(undefined,{month:'short',year:'numeric'});head.appendChild(el);cur=next}
 const step=zoom==='day'?1:zoom==='week'?7:30;for(let d=0;d<range.days;d+=step){const el=document.createElement('div');el.className='pf-gantt-day';el.style.left=d*width+'px';el.style.width=Math.min(step,range.days-d)*width+'px';const dt=new Date(range.start.getTime()+d*86400000);el.textContent=zoom==='day'?dt.getDate():zoom==='week'?'W'+Math.ceil((dt.getDate()+new Date(dt.getFullYear(),dt.getMonth(),1).getDay())/7):dt.getDate()===1?dt.toLocaleDateString(undefined,{month:'short'}):'';head.appendChild(el)}
 track.appendChild(head);list.forEach(t=>{labels.insertAdjacentHTML('beforeend','<div class="pf-gantt-label-row" data-edit="'+t.id+'"><span class="pf-gantt-name" title="'+esc(t.name)+'">'+esc(t.name)+'</span><small>'+esc(t.owner||'—')+'</small></div>');const row=document.createElement('div');row.className='pf-gantt-row';row.style.width=total+'px';row.style.backgroundSize=(step*width)+'px 100%';if(t.baselineStart&&t.baselineFinish){const b=document.createElement('div');b.className='pf-gantt-baseline';b.style.left=((fromISO(t.baselineStart)-range.start)/86400000*width)+'px';b.style.width=(Math.max(1,(fromISO(t.baselineFinish)-fromISO(t.baselineStart))/86400000+1)*width)+'px';b.title='Baseline: '+t.baselineStart+' to '+t.baselineFinish;row.appendChild(b)}if(t.start&&t.finish){const start=(fromISO(t.start)-range.start)/86400000;const dur=Math.max(1,(fromISO(t.finish)-fromISO(t.start))/86400000+1);const bar=document.createElement('div');bar.className='pf-gantt-bar'+(criticalIds.has(t.id)?' critical':'')+(isOverdue(t)?' overdue':'')+(t.milestone?' milestone':'');bar.style.left=(start*width)+'px';bar.style.width=(dur*width)+'px';bar.title=t.name+' · '+t.start+' to '+t.finish+' · '+(t.progress===null?'Progress not set':t.progress+'%');if(!t.milestone){if(t.progress!==null){const p=document.createElement('div');p.className='pf-gantt-progress';p.style.width=t.progress+'%';bar.appendChild(p)}if(dur*width>95){const label=document.createElement('span');label.className='pf-bar-label';label.textContent=t.name;bar.appendChild(label)}}if(!t.milestone){const handle=document.createElement('span');handle.className='pf-gantt-resize-handle';handle.title='Drag to change duration';bar.appendChild(handle)}
 let drag=null,suppressClick=false;
 bar.addEventListener('pointerdown',e=>{if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();e.stopPropagation();drag={pointerId:e.pointerId,x:e.clientX,start:t.start,finish:t.finish,duration:dur,resize:!t.milestone&&(e.target.classList.contains('pf-gantt-resize-handle')||e.offsetX>=bar.clientWidth-9),moved:false};try{bar.setPointerCapture(e.pointerId)}catch(err){}});
 bar.addEventListener('pointermove',e=>{if(!drag||e.pointerId!==drag.pointerId)return;const dx=e.clientX-drag.x;if(Math.abs(dx)>3)drag.moved=true;if(drag.moved){if(drag.resize)bar.style.width=Math.max(width,drag.duration*width+dx)+'px';else bar.style.transform='translateX('+dx+'px)'}});
 bar.addEventListener('pointerup',e=>{if(!drag||e.pointerId!==drag.pointerId)return;const d=drag;drag=null;if(!d.moved)return;const shift=Math.round((e.clientX-d.x)/width);if(shift===0){bar.style.transform='';bar.style.width=(dur*width)+'px';suppressClick=true;return}const a=fromISO(d.start),b=fromISO(d.finish);if(d.resize){const days=Math.max(1,d.duration+shift);b.setTime(a.getTime()+(days-1)*86400000);t.finish=iso(b);t.duration=days}else{a.setDate(a.getDate()+shift);b.setDate(b.getDate()+shift);t.start=iso(a);t.finish=iso(b)}suppressClick=true;save();renderAll();toast(d.resize?'Task duration updated':'Task dates moved')});
 bar.addEventListener('pointercancel',()=>{drag=null;bar.style.transform='';bar.style.width=(dur*width)+'px'});
 bar.addEventListener('click',e=>{if(suppressClick){suppressClick=false;e.preventDefault();e.stopPropagation();return}editTask(t.id)});row.appendChild(bar)}else{const no=document.createElement('span');no.className='pf-gantt-empty';no.textContent='Dates not set';row.appendChild(no)}track.appendChild(row)});
 const todayX=(today()-range.start)/86400000*width;if(todayX>=0&&todayX<=total){const line=document.createElement('div');line.className='pf-today-line';line.style.left=todayX+'px';track.appendChild(line)}
 $('ganttScroll').style.minHeight=(65+list.length*47)+'px';dateRange=range;
}
function renderTasks(){
 computeCritical();const query=$('taskSearch').value,filter=$('taskStatusFilter').value;const list=tasks.filter(t=>(filter==='all'||t.status===filter)&&(!query||norm([t.name,t.owner,t.supplier,t.externalId,t.reference,t.project,t.notes].join(' ')).includes(norm(query))));$('taskCountLabel').textContent=list.length+' of '+tasks.length+' tasks';$('taskTableEmpty').hidden=list.length!==0;$('taskTableBody').innerHTML=list.map(t=>'<tr data-edit="'+t.id+'"><td><input type="checkbox" class="task-check" data-check="'+t.id+'" '+(selectedIds.has(t.id)?'checked':'')+'></td><td><div class="pf-task-title">'+esc(t.name)+'</div><div class="pf-task-sub">'+esc([t.externalId,t.reference,t.project].filter(Boolean).join(' · '))+(criticalIds.has(t.id)?' · <span class="pf-critical-tag">CRITICAL</span>':'')+'</div></td><td>'+esc(t.owner||'—')+'</td><td>'+esc(t.start||'—')+'</td><td>'+esc(t.finish||'—')+'</td><td>'+(varianceDays(t)===null?'—':(varianceDays(t)>0?'+':'')+varianceDays(t)+' d')+'</td><td>'+ ((t.duration??durationDays(t))||'—')+'</td><td><div class="pf-inline-progress"><i><b style="width:'+(t.progress||0)+'%"></b></i>'+(t.progress===null?'—':t.progress+'%')+'</div></td><td><span class="pf-status-pill '+statusClass(t.status)+'">'+esc(t.status)+'</span></td><td>'+(isOverdue(t)?'<span class="pf-critical-tag">OVERDUE</span>':'›')+'</td></tr>').join('');
 $('taskTableBody').querySelectorAll('tr[data-edit]').forEach(tr=>tr.addEventListener('click',e=>{if(e.target.closest('input'))return;editTask(tr.dataset.edit)}));$('taskTableBody').querySelectorAll('[data-check]').forEach(ch=>ch.addEventListener('change',()=>{if(ch.checked)selectedIds.add(ch.dataset.check);else selectedIds.delete(ch.dataset.check);$('deleteSelectedBtn').disabled=!selectedIds.size}));$('deleteSelectedBtn').disabled=!selectedIds.size;$('dataWarnings').textContent=tasks.filter(t=>!t.start||!t.finish).length+' tasks missing one or more planned dates';
}
function renderResources(){
 const os=ownerStats();const selected=$('resourceFilter').value;const filt=os.filter(o=>selected==='all'||o.name===selected);$('resourceFilter').innerHTML='<option value="all">All resources</option>'+os.map(o=>'<option value="'+esc(o.name)+'">'+esc(o.name)+'</option>').join('');$('resourceFilter').value=selected;
 $('resourceGrid').innerHTML=filt.map(o=>{const p=o.progressCount?Math.round(o.progress/o.progressCount):null;return '<article class="pf-resource-card"><div class="pf-resource-top"><span class="pf-avatar">'+esc(initials(o.name))+'</span><div><b>'+esc(o.name)+'</b><small>'+o.total+' assigned activities</small></div></div><div class="pf-resource-metrics"><div><strong>'+o.total+'</strong><span>Total tasks</span></div><div><strong>'+o.complete+'</strong><span>Completed</span></div><div><strong class="'+(o.overdue?'':'')+'">'+o.overdue+'</strong><span>Overdue</span></div></div><div class="pf-resource-bar"><i style="width:'+(p||0)+'%"></i></div><div class="pf-resource-tasks">'+esc(o.tasks.slice(0,5).map(t=>t.name).join(' · '))+(o.tasks.length>5?' · +'+(o.tasks.length-5)+' more':'')+'</div></article>'}).join('')||'<div class="pf-table-empty">No responsible persons were identified.</div>';
}
function renderCritical(){
 const r=computeCritical(),list=tasks.filter(t=>criticalIds.has(t.id));$('criticalCount').textContent=list.length+' critical activities';$('criticalMessage').classList.toggle('has-data',r.dependencies>0);$('criticalMessage').textContent=r.dependencies?'Longest linked activity chain: '+r.score+' known day(s), '+r.dependencies+' dependency link(s). '+(r.unknownDurations?r.unknownDurations+' critical task(s) have no entered duration; the day total is incomplete. ':'')+'Critical path is calculated from resolved predecessor links.':'No dependency chain has been detected yet. Add predecessor links to tasks to calculate the critical path.'+(r.cycles?' A circular dependency was detected. Review links.':'');
 $('criticalTableBody').innerHTML=list.map(t=>'<tr data-edit="'+t.id+'"><td><b>'+esc(t.name)+'</b></td><td>'+esc(t.predecessor||'—')+'</td><td>'+durationDays(t)+' d</td><td>'+esc(t.finish||'—')+'</td><td>'+esc(t.owner||'—')+'</td><td><span class="pf-status-pill '+statusClass(t.status)+'">'+esc(t.status)+'</span></td></tr>').join('')||'<tr><td colspan="6">No critical tasks to display.</td></tr>';document.querySelectorAll('#criticalTableBody tr[data-edit]').forEach(tr=>tr.addEventListener('click',()=>editTask(tr.dataset.edit)));
}
function renderReport(){
 computeCritical();const s=getStats(),over=tasks.filter(isOverdue),missing=tasks.filter(t=>!t.start||!t.finish),crit=tasks.filter(t=>criticalIds.has(t.id));$('reportContent').innerHTML='<div class="pf-report-summary"><div class="pf-report-box"><strong>'+tasks.length+'</strong><small>Total activities</small></div><div class="pf-report-box"><strong>'+(s.progress===null?'—':s.progress+'%')+'</strong><small>Overall progress</small></div><div class="pf-report-box"><strong>'+over.length+'</strong><small>Overdue activities</small></div><div class="pf-report-box"><strong>'+s.completed+'</strong><small>Completed activities</small></div></div><section class="pf-report-section"><h3>Executive summary</h3><p>The project currently contains '+tasks.length+' recorded activities. '+s.completed+' are completed, '+s.c['In progress']+' are in progress, '+s.c['Not started']+' have not started, and '+over.length+' are overdue based on the planned finish date. '+(s.progress===null?'The source workbook does not provide usable progress values for a weighted overall progress calculation.':'Duration-weighted overall progress is '+s.progress+'%.')+'</p><p>'+missing.length+' activities are missing planned dates. '+crit.length+' activities are on the calculated critical chain. '+s.owners+' responsible person(s) are identified.</p></section><section class="pf-report-section"><h3>Overdue activities</h3>'+reportTable(over)+'</section><section class="pf-report-section"><h3>Critical activities</h3>'+reportTable(crit)+'</section><section class="pf-report-section"><h3>Data quality observations</h3><ul><li>'+missing.length+' activities require planned start and finish dates.</li><li>'+tasks.filter(t=>!t.owner).length+' activities do not have a responsible person assigned.</li><li>'+tasks.filter(t=>!t.predecessor).length+' activities do not have a dependency link entered.</li><li>Baseline variance is available only for activities that include baseline dates.</li></ul></section>';
}
function reportTable(list){if(!list.length)return '<p>None identified.</p>';return '<table class="pf-report-table"><thead><tr><th>Activity</th><th>Owner</th><th>Finish</th><th>Progress</th><th>Status</th></tr></thead><tbody>'+list.slice(0,40).map(t=>'<tr><td>'+esc(t.name)+'</td><td>'+esc(t.owner||'—')+'</td><td>'+esc(t.finish||'—')+'</td><td>'+(t.progress===null?'—':t.progress+'%')+'</td><td>'+esc(t.status)+'</td></tr>').join('')+'</tbody></table>'}
function openTaskForm(t){
 $('taskOverlay').hidden=false;$('taskModalTitle').textContent=t?'Edit activity':'Add activity';$('editTaskId').value=t?t.id:'';$('editName').value=t?.name||'';$('editReference').value=t?.reference||'';$('editOwner').value=t?.owner||'';$('editSupplier').value=t?.supplier||'';$('editStart').value=t?.start||'';$('editFinish').value=t?.finish||'';$('editDuration').value=t?.duration??'';$('editProgress').value=t?.progress??'';$('editStatus').value=t?.status||'Not started';$('editPriority').value=t?.priority||'Normal';$('editPredecessor').value=t?.predecessor||'';$('editMilestone').value=t?.milestone?'yes':'no';$('editBaselineStart').value=t?.baselineStart||'';$('editBaselineFinish').value=t?.baselineFinish||'';$('editActualStart').value=t?.actualStart||'';$('editActualFinish').value=t?.actualFinish||'';$('editNotes').value=t?.notes||'';$('deleteTaskBtn').style.display=t?'inline-flex':'none';
 $('ownerOptions').innerHTML=[...new Set(tasks.map(x=>x.owner).filter(Boolean))].map(x=>'<option value="'+esc(x)+'"></option>').join('');
}
function editTask(id){openTaskForm(tasks.find(t=>t.id===id))}
function closeTask(){$('taskOverlay').hidden=true}
function saveTask(e){
 e.preventDefault();const id=$('editTaskId').value;const start=$('editStart').value,finish=$('editFinish').value;let duration=numberValue($('editDuration').value);if(duration===null&&start&&finish)duration=Math.max(1,Math.round((fromISO(finish)-fromISO(start))/86400000)+1);let progress=$('editProgress').value===''?null:Number($('editProgress').value);const status=normalizeStatus($('editStatus').value,progress);if(status==='Completed'&&progress===null)progress=100;
 const item={name:$('editName').value.trim(),reference:$('editReference').value.trim(),owner:$('editOwner').value.trim(),supplier:$('editSupplier').value.trim(),start:start,finish:finish,duration:duration,progress:progress,status:status,priority:$('editPriority').value,predecessor:$('editPredecessor').value.trim(),milestone:$('editMilestone').value==='yes',baselineStart:$('editBaselineStart').value,baselineFinish:$('editBaselineFinish').value,actualStart:$('editActualStart').value,actualFinish:$('editActualFinish').value,notes:$('editNotes').value.trim()};
 if(!item.name){toast('Enter a task or equipment name.');return}if(start&&finish&&fromISO(finish)<fromISO(start)){toast('Finish date cannot be before start date.');return}
 if(id){const old=tasks.find(t=>t.id===id);if(old)Object.assign(old,item)}else tasks.push(Object.assign({id:uid(),externalId:'',project:'',sourceRow:null},item));
 $('taskOverlay').hidden=true;save();computeCritical();renderAll();toast(id?'Task updated':'Task added');
}
function deleteTask(id){tasks=tasks.filter(t=>t.id!==id);selectedIds.delete(id);save();closeTask();computeCritical();renderAll();toast('Task deleted')}
function deleteSelected(){if(!selectedIds.size)return;const count=selectedIds.size;tasks=tasks.filter(t=>!selectedIds.has(t.id));selectedIds.clear();save();renderAll();toast(count+' task(s) deleted')}
function xmlEscape(s){return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function mspDate(s){return s?s+'T08:00:00':''}
function exportXML(){
 if(!tasks.length){toast('Import or add tasks before exporting.');return}
 const idByKey=new Map(),refCounts=new Map();tasks.forEach((t,i)=>{idByKey.set(norm(t.name),i+1);if(t.externalId)idByKey.set(norm(t.externalId),i+1);if(t.reference)refCounts.set(norm(t.reference),(refCounts.get(norm(t.reference))||0)+1)});tasks.forEach((t,i)=>{if(t.reference&&refCounts.get(norm(t.reference))===1)idByKey.set(norm(t.reference),i+1)});
 const lines=['<?xml version="1.0" encoding="UTF-8"?>','<Project xmlns="http://schemas.microsoft.com/project">','<SaveVersion>14</SaveVersion>','<Name>'+xmlEscape(projectName)+'</Name>','<Title>'+xmlEscape(projectName)+'</Title>','<ScheduleFromStart>1</ScheduleFromStart>','<DefaultStartTime>08:00:00</DefaultStartTime>','<DefaultFinishTime>17:00:00</DefaultFinishTime>','<MinutesPerDay>480</MinutesPerDay>','<MinutesPerWeek>2400</MinutesPerWeek>','<DaysPerMonth>20</DaysPerMonth>','<Tasks>'];
 tasks.forEach((t,i)=>{let dur=(t.duration!==null&&t.duration!==undefined&&t.duration!==''?Number(t.duration):(t.start&&t.finish?durationDays(t):0));const durIso='PT'+Math.max(0,dur*8)+'H0M0S';const percent=t.progress===null?0:t.progress;lines.push('<Task><UID>'+(i+1)+'</UID><ID>'+(i+1)+'</ID><Name>'+xmlEscape(t.name)+'</Name><Type>1</Type><IsNull>0</IsNull><CreateDate>'+mspDate(iso(today()))+'</CreateDate><WBS>'+(i+1)+'</WBS><OutlineNumber>'+(i+1)+'</OutlineNumber>'+(t.start?'<Start>'+mspDate(t.start)+'</Start>':'')+(t.finish?'<Finish>'+mspDate(t.finish)+'</Finish>':'')+(t.baselineStart?'<BaselineStart>'+mspDate(t.baselineStart)+'</BaselineStart>':'')+(t.baselineFinish?'<BaselineFinish>'+mspDate(t.baselineFinish)+'</BaselineFinish>':'')+(t.actualStart?'<ActualStart>'+mspDate(t.actualStart)+'</ActualStart>':'')+(t.actualFinish?'<ActualFinish>'+mspDate(t.actualFinish)+'</ActualFinish>':'')+'<Duration>'+durIso+'</Duration><DurationFormat>7</DurationFormat><Work>PT'+Math.max(0,dur*8)+'H0M0S</Work><PercentComplete>'+percent+'</PercentComplete><Milestone>'+(t.milestone?'1':'0')+'</Milestone><Notes>'+xmlEscape((t.owner?'Responsible: '+t.owner+'\n':'')+(t.reference?'Reference: '+t.reference+'\n':'')+(t.supplier?'Supplier: '+t.supplier+'\n':'')+(t.status?'Status: '+t.status+'\n':'')+(t.notes||''))+'</Notes>');
 const refs=String(t.predecessor||'').split(/[;,|]+/).map(norm).filter(Boolean);refs.forEach(ref=>{const pred=idByKey.get(ref);if(pred&&pred!==i+1)lines.push('<PredecessorLink><PredecessorUID>'+pred+'</PredecessorUID><Type>1</Type><CrossProject>0</CrossProject><LinkLag>0</LinkLag><LagFormat>7</LagFormat></PredecessorLink>')});lines.push('</Task>')});
 lines.push('</Tasks></Project>');download(new Blob([lines.join('')],{type:'application/xml;charset=utf-8'}),safeName(projectName)+'-ProjectFlow.xml');toast('Microsoft Project XML exported');
}
function safeName(s){return String(s||'Project').replace(/[^a-z0-9-_]+/gi,'_').replace(/^_+|_+$/g,'')||'Project'}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200)}
function exportCSV(){const cols=['Task ID','PR / PO / CS Reference','Task / Equipment','Project','Responsible','Supplier','Start','Finish','Duration (days)','Progress (%)','Status','Predecessor','Priority','Baseline Start','Baseline Finish','Actual Start','Actual Finish','Milestone','Remarks'];const rows=tasks.map(t=>[t.externalId||t.id,t.reference,t.name,t.project,t.owner,t.supplier,t.start,t.finish,t.duration,t.progress,t.status,t.predecessor,t.priority,t.baselineStart,t.baselineFinish,t.actualStart,t.actualFinish,t.milestone?'Yes':'No',t.notes]);const csv=[cols,...rows].map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');download(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),safeName(projectName)+'-Tasks.csv')}
function exportXLSX(){
 if(!window.XLSX){toast('Excel export library is unavailable.');return}const rows=tasks.map((t,i)=>({'Task ID':t.externalId||i+1,'PR / PO / CS Reference':t.reference,'Task / Equipment':t.name,'Project':t.project,'Responsible':t.owner,'Supplier':t.supplier,'Start':t.start,'Finish':t.finish,'Duration (days)':t.duration,'Progress (%)':t.progress,'Status':t.status,'Predecessor':t.predecessor,'Priority':t.priority,'Baseline Start':t.baselineStart,'Baseline Finish':t.baselineFinish,'Actual Start':t.actualStart,'Actual Finish':t.actualFinish,'Milestone':t.milestone?'Yes':'No','Remarks':t.notes}));const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Tasks');const stats=[{'Metric':'Project','Value':projectName},{'Metric':'Total tasks','Value':tasks.length},{'Metric':'Completed','Value':statusCounts().Completed},{'Metric':'Overdue','Value':tasks.filter(isOverdue).length},{'Metric':'Overall progress','Value':getStats().progress}];XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(stats),'Summary');XLSX.writeFile(wb,safeName(projectName)+'-ProjectFlow.xlsx');toast('Project workbook exported')}
function exportAction(kind){$('exportMenu').classList.remove('open');if(kind==='xml')exportXML();if(kind==='csv')exportCSV();if(kind==='xlsx')exportXLSX();if(kind==='print'){setView('report');setTimeout(()=>window.print(),150)}if(kind==='print-gantt'){setView('gantt');setTimeout(()=>window.print(),150)}}
function sampleProject(){
 projectName='Laboratory Equipment Upgrade';sourceFile='Sample project data';const base=new Date(today());base.setDate(base.getDate()-24);const date=n=>{const d=new Date(base);d.setDate(d.getDate()+n);return iso(d)};tasks=[
 {id:uid(),externalId:'PR-01',name:'Finalize technical specification',project:'Procurement',owner:'Engineering',supplier:'',start:date(-14),finish:date(-7),duration:8,progress:100,status:'Completed',predecessor:'',priority:'High',baselineStart:date(-14),baselineFinish:date(-7),actualStart:date(-14),actualFinish:date(-8),milestone:false,notes:'Technical scope approved.'},
 {id:uid(),externalId:'PR-02',name:'Complete purchase requisition',project:'Procurement',owner:'Procurement',supplier:'',start:date(-6),finish:date(1),duration:8,progress:70,status:'In progress',predecessor:'PR-01',priority:'High',baselineStart:date(-6),baselineFinish:date(1),actualStart:date(-5),actualFinish:'',milestone:false,notes:'Budget confirmation in progress.'},
 {id:uid(),externalId:'PO-01',name:'Issue purchase order',project:'Procurement',owner:'Procurement',supplier:'ABC Scientific',start:date(2),finish:date(5),duration:4,progress:0,status:'Not started',predecessor:'PR-02',priority:'High',baselineStart:date(2),baselineFinish:date(5),actualStart:'',actualFinish:'',milestone:true,notes:'Pending requisition completion.'},
 {id:uid(),externalId:'DL-01',name:'Manufacturing and delivery',project:'Delivery',owner:'Supplier',supplier:'ABC Scientific',start:date(6),finish:date(36),duration:31,progress:0,status:'Not started',predecessor:'PO-01',priority:'Critical',baselineStart:date(6),baselineFinish:date(36),actualStart:'',actualFinish:'',milestone:false,notes:'Lead time as per supplier offer.'},
 {id:uid(),externalId:'IN-01',name:'Installation and commissioning',project:'Installation',owner:'Engineering',supplier:'ABC Scientific',start:date(37),finish:date(43),duration:7,progress:0,status:'Not started',predecessor:'DL-01',priority:'Normal',baselineStart:date(37),baselineFinish:date(43),actualStart:'',actualFinish:'',milestone:false,notes:''},
 {id:uid(),externalId:'QA-01',name:'Performance testing and handover',project:'Commissioning',owner:'Quality Assurance',supplier:'',start:date(44),finish:date(49),duration:6,progress:0,status:'Not started',predecessor:'IN-01',priority:'High',baselineStart:date(44),baselineFinish:date(49),actualStart:'',actualFinish:'',milestone:true,notes:''}
 ];lastWarnings=['Sample records are illustrative. Import your real workbook to replace this sample schedule.'];$('sourceFilePill').textContent=sourceFile;$('projectName').value=projectName;save();renderAll();toast('Sample project loaded. Explore the Gantt and task editor.')}
function wire(){
 $('importBtn').onclick=()=>{$('fileInput').dataset.mode='replace';$('fileInput').click()};$('updateBtn').onclick=()=>{$('fileInput').dataset.mode='merge';$('fileInput').click()};$('emptyImportBtn').onclick=()=>$('importBtn').click();$('fileInput').onchange=e=>{const f=e.target.files[0];if(f)openImport(f,e.target.dataset.mode||'replace');e.target.value=''};
 $('sheetSelect').onchange=loadPendingSheet;$('headerRowSelect').onchange=applyHeader;$('closeImport').onclick=$('cancelImport').onclick=()=>$('importOverlay').hidden=true;$('confirmImport').onclick=commitImport;
 document.querySelectorAll('.pf-nav[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view));document.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>setView(b.dataset.go));$('newTaskSide').onclick=$('addTaskBtn').onclick=()=>openTaskForm(null);$('sampleBtn').onclick=sampleProject;
 $('exportMenuBtn').onclick=()=>$('exportMenu').classList.toggle('open');document.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportAction(b.dataset.export));document.addEventListener('click',e=>{if(!e.target.closest('.pf-export-wrap'))$('exportMenu').classList.remove('open')});
 $('projectName').onchange=()=>{projectName=$('projectName').value.trim()||'Untitled project';$('projectName').value=projectName;save()};
 $('closeTask').onclick=$('cancelTask').onclick=closeTask;$('taskForm').onsubmit=saveTask;$('deleteTaskBtn').onclick=()=>{const id=$('editTaskId').value;if(id&&confirm('Delete this task from the project?'))deleteTask(id)};
 $('taskSearch').oninput=renderTasks;$('taskStatusFilter').onchange=renderTasks;$('deleteSelectedBtn').onclick=deleteSelected;$('selectAllTasks').onchange=e=>{document.querySelectorAll('[data-check]').forEach(c=>{c.checked=e.target.checked;if(e.target.checked)selectedIds.add(c.dataset.check);else selectedIds.delete(c.dataset.check)});$('deleteSelectedBtn').disabled=!selectedIds.size};
 $('ganttSearch').oninput=renderGantt;$('ganttFilter').onchange=renderGantt;$('zoomSelect').onchange=e=>{zoom=e.target.value;renderGantt()};$('todayBtn').onclick=()=>{const r=dateRange;if(r){const x=(today()-r.start)/86400000*(zoom==='day'?29:zoom==='week'?13:4.2);$('ganttScroll').scrollLeft=Math.max(0,x-180)}};
 $('resourceFilter').onchange=renderResources;$('reportBtn').onclick=()=>setView('report');$('printReportBtn').onclick=()=>window.print();$('taskTableBody').addEventListener('click',e=>{const row=e.target.closest('tr[data-edit]');if(row&&!e.target.closest('input'))editTask(row.dataset.edit)});
 $('taskOverlay').addEventListener('click',e=>{if(e.target===$('taskOverlay'))closeTask()});$('importOverlay').addEventListener('click',e=>{if(e.target===$('importOverlay'))$('importOverlay').hidden=true});
}
loadSaved();wire();if(tasks.length){$('sourceFilePill').textContent=sourceFile||'Saved project';$('projectName').value=projectName;showWorkspace();computeCritical();renderAll()}
})();