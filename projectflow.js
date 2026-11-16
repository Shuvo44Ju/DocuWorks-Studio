'use strict';
(function(){
const $=id=>document.getElementById(id);
const COL={Summary:'var(--sum)',Done:'var(--done)','In progress':'var(--prog)',Overdue:'var(--over)',Planned:'var(--plan)'};
const DAY=86400000;
let data=null,sourceFile=null,workbook=null,toastTimer=null;

function dayUTC(y,m,d){return Math.floor(Date.UTC(y,m-1,d)/DAY)}
function isoDay(s){
 const m=String(s||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
 return m?dayUTC(+m[1],+m[2],+m[3]):NaN;
}
function iso(day){const d=new Date(day*DAY);return d.toISOString().slice(0,10)}
function fmt(day){return new Date(day*DAY).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit',timeZone:'UTC'})}
function esc(v){return String(v??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function norm(v){return String(v??'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ')}
function number(v){
 if(typeof v==='number'&&Number.isFinite(v))return v;
 const m=String(v??'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
 return m?Number(m[0]):null;
}
function parseDate(v){
 if(v===null||v===undefined||v==='')return null;
 if(v instanceof Date&&!isNaN(v))return dayUTC(v.getFullYear(),v.getMonth()+1,v.getDate());
 if(typeof v==='number'&&Number.isFinite(v)&&v>0&&v<3000000){
  const serial=Math.floor(v);
  if(serial===60)return null;
  const d=new Date(Date.UTC(1899,11,30)+serial*DAY);
  return dayUTC(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());
 }
 let s=String(v).trim().replace(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?[,\s]+/i,'');
 if(!s)return null;
 let m=s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
 if(m)return dayUTC(+m[1],+m[2],+m[3]);
 m=s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
 if(m){
  let a=+m[1],b=+m[2],y=+m[3];if(y<100)y+=y<50?2000:1900;
  const day=a>12?a:b,mon=a>12?b:a;
  return dayUTC(y,mon,day);
 }
 m=s.match(/^(\d{1,2})[\s,./-]+([A-Za-z]{3,})[\s,./-]+(\d{2,4})/);
 if(m){
  const months={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
  let y=+m[3];if(y<100)y+=y<50?2000:1900;const mon=months[m[2].toLowerCase()];return mon?dayUTC(y,mon,+m[1]):null;
 }
 return null;
}
function duration(v){
 const s=String(v??'').trim();if(!s)return null;
 const n=number(s);if(n===null)return null;
 if(/\b(month|months|year|years|hour|hours|hr|hrs)\b/i.test(s))return null;
 const weeks=/\b(week|weeks|wk|wks)\b/i.test(s);
 return Math.max(0,n*(weeks?7:1));
}
function detectColumns(headers){
 const aliases={
  task:['tasks','task','task name','activity','activity name','description','equipment','equipment name','item','work description'],
  vendor:['vendor','supplier','contractor'],
  duration:['duration','duration days','days','period','lead time'],
  start:['start','start date','planned start','commencement'],
  finish:['deadline','finish','finish date','end date','due date','delivery date','completion date'],
  status:['status','state','progress status'],
  remaining:['remaining days','days remaining']
 };
 const out={};
 Object.entries(aliases).forEach(([key,list])=>{
  let best=-1,bscore=0;
  headers.forEach((h,i)=>{
   const x=norm(h);
   list.forEach(a=>{const y=norm(a);let s=x===y?100:x.includes(y)?75:y.includes(x)&&x.length>3?45:0;if(s>bscore){bscore=s;best=i}});
  });
  if(best>=0)out[key]=best;
 });
 return out;
}
function headerRow(rows){
 let best={row:0,score:-1,headers:[]};
 for(let r=0;r<Math.min(rows.length,60);r++){
  const h=(rows[r]||[]).map(v=>String(v??'').trim());
  const map=detectColumns(h),score=(map.task!==undefined?50:0)+(map.finish!==undefined?25:0)+(map.start!==undefined?15:0)+(map.duration!==undefined?8:0)+h.filter(Boolean).length*.1;
  if(score>best.score)best={row:r,score,headers:h};
 }
 return best;
}
function inferTitle(rows,name){
 for(let r=0;r<Math.min(5,rows.length);r++){
  const vals=(rows[r]||[]).map(v=>String(v??'').trim()).filter(Boolean);
  if(vals.length===1&&vals[0].length>4)return vals[0];
 }
 return String(name||'Project Gantt').replace(/\.[^.]+$/,'');
}
function parseSheet(rows,sheetName,fileName){
 const hd=headerRow(rows),headers=hd.headers,map=detectColumns(headers);
 // Strong fallback for the Dhamrai-style layout: B=Task, C=Vendor, D=Duration, E=Start, F=Deadline, G=Remaining Days, H=Status.
 if(map.task===undefined&&headers.length>=2)map.task=1;
 if(map.vendor===undefined&&headers.length>=3)map.vendor=2;
 if(map.duration===undefined&&headers.length>=4)map.duration=3;
 if(map.start===undefined&&headers.length>=5)map.start=4;
 if(map.finish===undefined&&headers.length>=6)map.finish=5;
 if(map.remaining===undefined&&headers.length>=7)map.remaining=6;
 if(map.status===undefined&&headers.length>=8)map.status=7;
 const tasks=[],stack=[];
 const warnings={missing:0,derived:0,milestones:0,skipped:0,groups:0};
 let lastEnd=null;
 for(let r=hd.row+1;r<rows.length;r++){
  const row=rows[r]||[];
  if(!row.some(v=>v!==''&&v!==null&&v!==undefined))continue;
  const rawName=String(row[map.task]??''),name=rawName.trim();
  if(!name||/^(grand\s+)?total$|^overall summary$/i.test(name)){warnings.skipped++;continue}
  const indent=(rawName.match(/^\s*/)||[''])[0].length;
  const vendor=String(row[map.vendor]??'').trim();
  const start0=parseDate(row[map.start]),finish0=parseDate(row[map.finish]),dur0=duration(row[map.duration]);
  const statusRaw=String(row[map.status]??'').trim();
  let status=statusRaw;
  if(!status&&map.remaining!==undefined){
   const rem=row[map.remaining];
   if(typeof rem==='string'&&rem.trim()&&number(rem)===null&&!parseDate(rem))status=rem.trim();
  }
  const hasSchedule=!!(start0!==null||finish0!==null||dur0!==null);
  const isGroup=!!vendor&&!hasSchedule&&!status;
  if(isGroup){
   while(stack.length&&stack[stack.length-1].indent>=indent)stack.pop();
   const groupTask={row:r+1,name,group:true,groupPath:stack.map(g=>g.name).join(' / '),vendor,start:null,end:null,duration:null,done:false,active:false,status:'',basis:'group',milestone:false};
   const groupIndex=tasks.push(groupTask)-1;
   stack.push({indent,name,vendor,index:groupIndex});
   warnings.groups++;
   continue;
  }
  if(!hasSchedule&&!status&&!vendor&&indent===0){
   warnings.skipped++;stack.length=0;continue;
  }
  while(stack.length&&stack[stack.length-1].indent>=indent)stack.pop();
  let start=start0,finish=finish0,dur=dur0,basis='source',milestone=false;
  if(start!==null&&finish!==null&&finish<start){start=null;finish=null}
  if(start!==null&&finish===null&&dur!==null&&dur>0){finish=start+Math.ceil(dur)-1}
  if(finish!==null&&start===null&&dur!==null&&dur>0){start=finish-Math.ceil(dur)+1;basis='calculated'}
  if(finish!==null&&start===null&&dur===null){start=finish;dur=1;milestone=true;basis='milestone';warnings.milestones++}
  if(start!==null&&finish===null&&dur===null){finish=start;dur=1;milestone=true;basis='milestone';warnings.milestones++}
  if(dur===null&&start!==null&&finish!==null)dur=finish-start+1;
  if(start===null||finish===null)warnings.missing++;
  if(basis==='calculated')warnings.derived++;
  if(finish!==null)lastEnd=finish;
  const groups=stack.map(g=>g.name);
  const inheritedVendor=stack.length?stack[stack.length-1].vendor:vendor;
  const childTask={
   row:r+1,name,group:groups.join(' / '),vendor:inheritedVendor,start:start===null?null:iso(start),
   end:finish===null?null:iso(finish),duration:dur,done:/^(done|complete|completed|finished|closed)$/i.test(status),
   active:/progress|ongoing|active|working|in progress/i.test(status),status,basis,
   milestone,sourceRow:r+1
  };
  tasks.push(childTask);
  if(start!==null&&finish!==null){
   stack.forEach(g=>{
    const gt=tasks[g.index];
    if(!gt.start||isoDay(gt.start)>start)gt.start=iso(start);
    if(!gt.end||isoDay(gt.end)<finish)gt.end=iso(finish);
   });
  }
 }
 return {title:inferTitle(rows,fileName),sheet:sheetName,tasks,warnings};
}
async function loadLibrary(){
 if(window.XLSX)return window.XLSX;
 return new Promise((resolve,reject)=>{
  const s=document.createElement('script');s.src='https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';s.onload=()=>resolve(window.XLSX);s.onerror=()=>reject(new Error('Excel reader could not be loaded.'));document.head.appendChild(s);
 });
}
async function readFile(file){
 const XLSX=await loadLibrary();
 if(/\.csv$/i.test(file.name)){
  const text=await file.text();const rows=text.split(/\r?\n/).map(line=>line.split(','));
  return {SheetNames:['CSV'],Sheets:{CSV:{__rows:rows}},Workbook:{WBProps:{date1904:false}}};
 }
 const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false,raw:true});
 return wb;
}
function rowsOf(wb,name){
 const s=wb.Sheets[name];
 if(s.__rows)return s.__rows;
 return window.XLSX.utils.sheet_to_json(s,{header:1,defval:'',raw:true,blankrows:true});
}
function state(t){
 if(t.done)return'Done';
 const today=dayUTC(new Date().getFullYear(),new Date().getMonth()+1,new Date().getDate());
 if(!t.end)return'No date';
 const end=isoDay(t.end),start=isoDay(t.start);
 if(end<today)return'Overdue';
 if(t.active||(start<=today&&end>=today))return'In progress';
 return'Planned';
}
function draw(){
 if(!data)return;
 const q=$('q').value.toLowerCase().trim(),filter=$('f').value,ppd=+$('z').value;
 data.tasks.forEach(t=>t.s=state(t));
 const all=data.tasks,dated=all.filter(t=>t.start&&t.end);
 if(!dated.length){$('wrap').innerHTML='<div class="empty">No usable schedule dates were found in the workbook.</div>';return}
 let min=Math.min(...dated.map(t=>isoDay(t.start)))-7,max=Math.max(...dated.map(t=>isoDay(t.end)))+14;
 const W=Math.max(700,(max-min)*ppd);
 const count=s=>all.filter(t=>!t.group&&t.s===s).length;
 $('k').innerHTML=['Done','In progress','Overdue','Planned'].map(s=>'<span class="chip" style="background:'+COL[s]+'">'+s+' '+count(s)+'</span>').join(' ');
 let rows=all.filter(t=>(!q||t.name.toLowerCase().includes(q)||t.vendor.toLowerCase().includes(q))&&(!filter||t.group||t.s===filter));
 if(q||filter){
  const childRows=rows.filter(t=>!t.group);
  rows=rows.filter(t=>!t.group||childRows.some(x=>String(x.group||'').split(' / ').includes(t.name)));
 }
 let html='<div class="row hd"><div class="lab">Task</div><div class="trk" style="width:'+W+'px">';
 const first=new Date(min*DAY);let d=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth(),1));
 while(d.getTime()/DAY<max){
  const day=d.getTime()/DAY,x=(day-min)*ppd;
  html+='<div class="m" style="left:'+x+'px">'+d.toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'})+'</div>';
  d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1));
 }
 html+='</div></div>';
 for(const t of rows){
  const s=t.s,sd=t.start?isoDay(t.start):null,ed=t.end?isoDay(t.end):null;
  const dt=sd!==null&&ed!==null?fmt(sd)+' - '+fmt(ed):'no date';
  const tip=esc(t.name+'\n'+dt+'\nState: '+s+(t.basis==='calculated'?'\nStart calculated from finish + duration':''));
  const bar=sd!==null&&ed!==null?'<div class="b '+(t.milestone?'milestone':'')+'" title="'+tip+'" style="left:'+((sd-min)*ppd)+'px;width:'+Math.max((ed-sd)*ppd,7)+'px;background:'+COL[s]+'"></div>':'';
  html+='<div class="row'+(t.group?' g':'')+'"><div class="lab" title="'+tip+'" style="padding-left:'+(t.group?8:22)+'px">'+esc(t.name)+(t.vendor?'<small>'+esc(t.vendor)+'</small>':'')+'</div><div class="trk" style="width:'+W+'px">'+bar+'</div></div>';
 }
 $('wrap').innerHTML=html;
 const today=dayUTC(new Date().getFullYear(),new Date().getMonth()+1,new Date().getDate());
 if(today>=min&&today<=max)$('wrap').querySelectorAll('.trk').forEach((e,i)=>{if(i)e.insertAdjacentHTML('beforeend','<div class="today" style="left:'+((today-min)*ppd)+'px"></div>')});
 $('t').textContent=data.title||'Project Gantt';
 $('info').textContent=(data.sheet?'Sheet: '+data.sheet+' · ':'')+all.filter(t=>!t.group).length+' activities · '+(data.warnings.derived||0)+' calculated starts · '+(data.warnings.milestones||0)+' deadline milestones';
}
async function importFile(file){
 try{
  $('info').textContent='Reading '+file.name+'…';
  workbook=await readFile(file);sourceFile=file;
  const names=workbook.SheetNames||[];
  if(!names.length)throw new Error('No worksheet found.');
  // Prefer the first sheet containing a task-like header and a finish/deadline header.
  let chosen=names[0];
  for(const name of names){const rows=rowsOf(workbook,name);const h=headerRow(rows).headers.map(norm);if(h.some(x=>x==='tasks'||x==='task'||x==='activity')&&h.some(x=>x==='deadline'||x==='finish'||x==='finish date')){chosen=name;break}}
  data=parseSheet(rowsOf(workbook,chosen),chosen,file.name);
  $('upload').style.display='none';draw();
 }catch(e){$('info').textContent='Could not read the workbook: '+e.message}
}
async function exportExcel(){
 if(!data||!sourceFile)return;
 const btn=$('export');btn.disabled=true;btn.textContent='Preparing…';
 try{
  const XLSX=await loadLibrary();
  const rows=[['PROJECT GANTT CHART'],['Source: '+sourceFile.name+' | Worksheet: '+data.sheet],['Group','Task','Vendor','Start','Finish','Duration (days)','Status','Start date basis','Source row']];
  data.tasks.forEach(t=>rows.push([t.group,t.name,t.vendor,t.start||'',t.end||'',t.duration??'',t.status,t.basis==='calculated'?'Calculated from finish + duration':t.basis,t.sourceRow]));
  const range=data.tasks.filter(t=>t.start&&t.end);
  if(range.length){
   const min=Math.min(...range.map(t=>isoDay(t.start))),max=Math.max(...range.map(t=>isoDay(t.end)));
   rows[2].push(...Array.from({length:max-min+1},(_,i)=>iso(min+i)));
   data.tasks.forEach((t,i)=>{
    const row=rows[i+3];
    row.push(...Array.from({length:max-min+1},(_,j)=>t.start&&t.end&&j+min>=isoDay(t.start)&&j+min<=isoDay(t.end)?'■':''));
   });
  }
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'Gantt Chart');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(data.tasks.map(t=>[t.name,t.vendor,t.start,t.end,t.duration,t.status,t.sourceRow])), 'Task Data');
  XLSX.writeFile(wb,(sourceFile.name.replace(/\.[^.]+$/,'')||'Project')+'_Gantt.xlsx');
  $('info').textContent='Gantt Excel exported successfully.';
 }catch(e){$('info').textContent='Export failed: '+e.message}
 finally{btn.disabled=false;btn.textContent='↓ Export Excel'}
}
function wire(){
 $('fileInput').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)importFile(f)});
 $('dropzone').addEventListener('dragover',e=>{e.preventDefault();$('dropzone').classList.add('drag')});
 $('dropzone').addEventListener('dragleave',()=>$('dropzone').classList.remove('drag'));
 $('dropzone').addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('drag');const f=e.dataTransfer.files&&e.dataTransfer.files[0];if(f)importFile(f)});
 ['q','f','z'].forEach(id=>$(id).addEventListener('input',draw));
 $('export').addEventListener('click',exportExcel);
}
wire();
})();