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
   row:r+1,name,group:false,groupPath:groups.join(' / '),vendor:inheritedVendor,start:start===null?null:iso(start),
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
  const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';s.onload=()=>resolve(window.XLSX);s.onerror=()=>reject(new Error('Excel reader could not be loaded.'));document.head.appendChild(s);
 });
}
async function readFile(file){
 const XLSX=await loadLibrary();
 if(/\.csv$/i.test(file.name))return XLSX.read(await file.text(),{type:'string',cellDates:false,raw:true});
 return XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false,raw:true});
}
function rowsOf(wb,name){
 const s=wb.Sheets[name];
 if(s.__rows)return s.__rows;
 return window.XLSX.utils.sheet_to_json(s,{header:1,defval:'',raw:true,blankrows:true});
}
function state(t){
 if(t.group)return t.start?'Summary':'';
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
  rows=rows.filter(t=>!t.group||childRows.some(x=>String(x.groupPath||'').split(' / ').includes(t.name)));
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
  const activities=data.tasks.filter(t=>!t.group);
  const dated=data.tasks.filter(t=>t.start&&t.end);
  if(!dated.length)throw new Error('No scheduled dates are available to export.');
  const min=Math.min(...dated.map(t=>isoDay(t.start)));
  const max=Math.max(...dated.map(t=>isoDay(t.end)));
  const firstWeek=min-(new Date(min*DAY).getUTCDay()+6)%7;
  const weeks=[];
  for(let d=firstWeek;d<=max;d+=7)weeks.push(d);
  const lastCol=5+weeks.length;
  const colName=n=>{let x='';for(n++;n;n=Math.floor((n-1)/26))x=String.fromCharCode(65+(n-1)%26)+x;return x};
  const gantt=[];
  gantt[0]=['PROJECT GANTT'];
  gantt[1]=['Project schedule | '+(data.title||sourceFile.name)+' | Source worksheet: '+(data.sheet||'')];
  gantt[3]=['TOTAL ACTIVITIES',activities.length,'COMPLETED',activities.filter(t=>t.done).length,'IN PROGRESS',activities.filter(t=>t.active).length,'OVERDUE',activities.filter(t=>!t.done&&t.end&&isoDay(t.end)<dayUTC(new Date().getFullYear(),new Date().getMonth()+1,new Date().getDate())).length];
  gantt[5]=['TASK / WORK PACKAGE','VENDOR / RESPONSIBLE','START DATE','FINISH DATE','DURATION (DAYS)','STATUS'];
  weeks.forEach((d,i)=>gantt[5].push(iso(d)));
  data.tasks.forEach(t=>{
   const row=[t.name,t.vendor||'',t.start||'',t.end||'',t.duration??'',t.group?(t.start?'Summary':'Group'):state(t)];
   weeks.forEach(d=>{
    const taskStart=t.start?isoDay(t.start):null,taskEnd=t.end?isoDay(t.end):null;
    row.push(taskStart!==null&&taskEnd!==null&&d<=taskEnd&&d+6>=taskStart?' ': '');
   });
   gantt.push(row);
  });
  const ws=XLSX.utils.aoa_to_sheet(gantt);
  const navy='17365D',blue='4472C4',lightBlue='D9EAF7',pale='F3F6FA',grey='E7EBF0',white='FFFFFF',dark='243447',line='D6DEE8';
  const style=(fill,fontColor,bold,align,wrap)=>({fill:{patternType:'solid',fgColor:{rgb:fill}},font:{name:'Arial',sz:10,bold:!!bold,color:{rgb:fontColor}},alignment:{vertical:'center',horizontal:align||'left',wrapText:!!wrap},border:{bottom:{style:'thin',color:{rgb:line}}}});
  const put=(r,c,v,st,type,fmt)=>{const a=XLSX.utils.encode_cell({r,c});ws[a]={t:type||'s',v,s:st};if(fmt)ws[a].z=fmt;};
  const last=lastCol;
  for(let c=0;c<=last;c++){
   put(0,c,c===0?'PROJECT GANTT':'',style(navy,white,true,'left'));
   put(1,c,c===0?gantt[1][0]:'',style('EAF0F7',dark,false,'left'));
  }
  ws['!merges']=[{s:{r:0,c:0},e:{r:0,c:last}},{s:{r:1,c:0},e:{r:1,c:last}}];
  const kpis=[['TOTAL ACTIVITIES',activities.length],['COMPLETED',activities.filter(t=>t.done).length],['IN PROGRESS',activities.filter(t=>state(t)==='In progress').length],['OVERDUE',activities.filter(t=>state(t)==='Overdue').length]];
  kpis.forEach((k,i)=>{const c=i*2;put(3,c,k[0],style(blue,white,true,'center'));put(3,c+1,k[1],style('F2F6FC',dark,true,'center'));});
  for(let c=0;c<6;c++)put(5,c,gantt[5][c],style(navy,white,true,'center',true));
  weeks.forEach((d,i)=>{
   const c=6+i,month=new Date(d*DAY).toLocaleDateString('en-GB',{month:'long',year:'numeric',timeZone:'UTC'});
   put(5,c,month,style(navy,white,true,'center'));
   put(6,c,d+25569,style('DCE6F1',dark,true,'center'), 'n','dd-mmm');
  });
  for(let c=0;c<6;c++)put(6,c,['TASK / WORK PACKAGE','VENDOR / RESPONSIBLE','START DATE','FINISH DATE','DURATION (DAYS)','STATUS'][c],style('DCE6F1',dark,true,'center',true));
  const merges=ws['!merges'];
  let monthStart=0,monthKey='';
  weeks.forEach((d,i)=>{
   const key=new Date(d*DAY).toLocaleDateString('en-CA',{month:'numeric',year:'numeric',timeZone:'UTC'});
   if(!monthKey){monthKey=key;monthStart=i;}
   if(key!==monthKey||i===weeks.length-1){
    const end=key!==monthKey?i-1:i;
    if(end>monthStart)merges.push({s:{r:5,c:6+monthStart},e:{r:5,c:6+end}});
    monthStart=i;monthKey=key;
   }
  });
  const today=dayUTC(new Date().getFullYear(),new Date().getMonth()+1,new Date().getDate());
  data.tasks.forEach((t,i)=>{
   const r=7+i,group=!!t.group,st=group?style('E8EDF3',navy,true):style(i%2?'FFFFFF':pale,dark,false);
   const vals=[t.name,t.vendor||'',t.start||'',t.end||'',t.duration??'',group?(t.start?'Summary':'Group'):state(t)];
   vals.forEach((v,c)=>{
    const dateCol=c===2||c===3;
    const serial=dateCol&&v?isoDay(v)+25569:null;
    put(r,c,dateCol&&v?serial:v,st,dateCol&&v?'n':undefined,dateCol&&v?'dd-mmm-yyyy':undefined);
   });
   weeks.forEach((d,j)=>{
    const c=6+j,taskStart=t.start?isoDay(t.start):null,taskEnd=t.end?isoDay(t.end):null;
    let fill=group?'D9E2F3':(state(t)==='Done'?'70AD47':state(t)==='Overdue'?'C00000':state(t)==='In progress'?'4472C4':'A5B9D5');
    const active=taskStart!==null&&taskEnd!==null&&d<=taskEnd&&d+6>=taskStart;
    const stl=active?style(fill,white,true,'center'):style(i%2?'FFFFFF':pale,dark,false,'center');
    put(r,c,active?'':'',stl);
   });
  });
  const monthCols=weeks.length;
  ws['!cols']=[{wch:42},{wch:25},{wch:15},{wch:15},{wch:16},{wch:16},...Array(monthCols).fill({wch:11})];
  ws['!rows']=[{hpt:30},{hpt:22},{hpt:8},{hpt:24},{hpt:8},{hpt:26},{hpt:22},...data.tasks.map(t=>({hpt:t.group?23:21}))];
  ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:6,c:0},e:{r:6+data.tasks.length,c:5}})};
  ws['!freeze']={xSplit:6,ySplit:7};
  ws['!margins']={left:0.25,right:0.25,top:0.5,bottom:0.5,header:0.2,footer:0.2};
  ws['!pageSetup']={orientation:'landscape',paperSize:9,fitToWidth:1,fitToHeight:0,scale:75};
  ws['!printOptions']={horizontalCentered:false,verticalCentered:false};
  const register=[['PROJECT ACTIVITY REGISTER'],['Project: '+(data.title||sourceFile.name)+' | Source worksheet: '+(data.sheet||'')],['No.','Work package / activity','Vendor / responsible','Start date','Finish date','Duration (days)','Status','Date basis','Source row']];
  activities.forEach((t,i)=>register.push([i+1,t.name,t.vendor||'',t.start||'',t.end||'',t.duration??'',state(t),t.basis==='calculated'?'Calculated from finish + duration':(t.basis||'Source'),t.sourceRow||'']));
  const reg=XLSX.utils.aoa_to_sheet(register);
  const rr=XLSX.utils.decode_range(reg['!ref']);
  for(let c=0;c<=rr.e.c;c++){
   const cell=reg[XLSX.utils.encode_cell({r:0,c})];if(cell)cell.s=style(navy,white,true);
   const head=reg[XLSX.utils.encode_cell({r:2,c})];if(head)head.s=style(blue,white,true,'center',true);
  }
  reg['!merges']=[{s:{r:0,c:0},e:{r:0,c:8}},{s:{r:1,c:0},e:{r:1,c:8}}];
  for(let r=1;r<=rr.e.r;r++)for(let c=0;c<=rr.e.c;c++){
   const cell=reg[XLSX.utils.encode_cell({r,c})];if(!cell)continue;
   if(r===0||r===2)continue;
   cell.s=style(r%2?'F3F6FA':'FFFFFF',dark,r===1,c===0?'center':'left',c===1||c===2);
   if((c===3||c===4)&&r>=3&&cell.v){cell.t='n';cell.v=isoDay(cell.v)+25569;cell.z='dd-mmm-yyyy';}
   if(c===6&&r>=3){const v=cell.v;const colors={Done:'70AD47','In progress':'4472C4',Overdue:'C00000',Planned:'A5B9D5'};cell.s=style(colors[v]||'E8EDF3',colors[v]?'FFFFFF':dark,true,'center');}
  }
  reg['!cols']=[{wch:8},{wch:48},{wch:28},{wch:16},{wch:16},{wch:17},{wch:17},{wch:34},{wch:12}];
  reg['!rows']=[{hpt:30},{hpt:22},{hpt:28},...activities.map(()=>({hpt:22}))];
  reg['!autofilter']={ref:'A3:I'+(3+activities.length)};
  reg['!freeze']={xSplit:2,ySplit:3};
  reg['!margins']={left:0.25,right:0.25,top:0.5,bottom:0.5,header:0.2,footer:0.2};
  reg['!pageSetup']={orientation:'landscape',paperSize:9,fitToWidth:1,fitToHeight:0};
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'Gantt Chart');
  XLSX.utils.book_append_sheet(wb,reg,'Activity Register');
  XLSX.writeFile(wb,(sourceFile.name.replace(/\.[^.]+$/,'')||'Project')+'_Professional_Gantt.xlsx',{bookType:'xlsx',cellStyles:true});
  $('info').textContent='Professional Gantt workbook exported successfully.';
 }catch(e){$('info').textContent='Export failed: '+e.message}
 finally{btn.disabled=false;btn.textContent='↓ Export Excel'}
}

function standaloneHTML(){
 const payload=JSON.stringify(data).replace(/</g,'\\u003c');
 const css=String.raw`:root{--bg:#fff;--fg:#1f2933;--mut:#6b7785;--line:#e3e7ec;--grp:#f1f3f6;--sum:#1f3864;--done:#70ad47;--prog:#2e75b6;--over:#c00000;--plan:#8ea9db;--today:#ffb300;box-sizing:border-box;padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.4 Arial,Helvetica,sans-serif}header{padding:14px 16px 6px}h1{font-size:18px;margin:0 0 8px}.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.chip{padding:3px 10px;border-radius:12px;color:#fff;font-size:12px}input,select{background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:5px 8px;font:inherit}#wrap{margin:10px 16px;height:calc(100vh - 150px);min-height:320px;overflow:auto;border:1px solid var(--line);border-radius:8px;position:relative}.row{display:flex;height:24px;border-bottom:1px solid var(--line)}.row.g{background:var(--grp);font-weight:bold}.lab{position:sticky;left:0;z-index:3;flex:none;width:300px;padding:3px 8px;background:var(--bg);border-right:1px solid var(--line);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.row.g .lab{background:var(--grp)}.lab small{color:var(--mut);font-weight:normal;margin-left:6px}.trk{position:relative;flex:none}.hd{position:sticky;top:0;z-index:5;height:28px;background:var(--bg)}.hd .lab{z-index:6;top:0}.m{position:absolute;top:0;height:100%;border-left:1px solid var(--line);padding:6px 4px;color:var(--mut);font-size:11px}.b{position:absolute;top:5px;height:14px;border-radius:3px;min-width:7px}.b.milestone{width:10px!important;height:10px;top:7px;border-radius:2px;transform:rotate(45deg)}.today{position:absolute;top:0;bottom:0;width:2px;background:var(--today);z-index:2}@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#161b22;--fg:#e6edf3;--mut:#8b949e;--line:#2d333b;--grp:#1f262e;--sum:#7aa2f7}}:root[data-theme=dark]{--bg:#161b22;--fg:#e6edf3;--mut:#8b949e;--line:#2d333b;--grp:#1f262e;--sum:#7aa2f7}`;
 const runtime=String.raw`
const data=__PAYLOAD__,COL={Summary:'var(--sum)',Done:'var(--done)','In progress':'var(--prog)',Overdue:'var(--over)',Planned:'var(--plan)'},D=s=>s?Date.parse(s+'T00:00:00Z')/864e5:null,now=new Date(),TODAY=Date.UTC(now.getFullYear(),now.getMonth(),now.getDate())/864e5,wrap=document.getElementById('wrap');
const fmt=d=>new Date(d*864e5).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit',timeZone:'UTC'});
function state(t){if(t.group)return t.start?'Summary':'';if(t.done)return'Done';if(!t.end)return'No date';if(D(t.end)<TODAY)return'Overdue';return(t.active||(D(t.start)<=TODAY&&D(t.end)>=TODAY))?'In progress':'Planned'}
function draw(){const q=document.getElementById('q').value.toLowerCase(),f=document.getElementById('f').value,ppd=+document.getElementById('z').value,all=data.tasks,dated=all.filter(t=>t.start&&t.end);if(!dated.length){wrap.textContent='No usable schedule dates';return}const min=Math.min(...dated.map(t=>D(t.start)))-7,max=Math.max(...dated.map(t=>D(t.end)))+14,W=(max-min)*ppd;all.forEach(t=>t.s=state(t));const n=s=>all.filter(t=>!t.group&&t.s===s).length;document.getElementById('k').innerHTML=['Done','In progress','Overdue','Planned'].map(s=>'<span class="chip" style="background:'+COL[s]+'">'+s+' '+n(s)+'</span>').join(' ');let rows=all.filter(t=>(!q||t.name.toLowerCase().includes(q)||String(t.vendor||'').toLowerCase().includes(q))&&(!f||t.group||t.s===f));if(f||q){const children=rows.filter(t=>!t.group);rows=rows.filter(t=>!t.group||children.some(x=>String(x.groupPath||'').split(' / ').includes(t.name)))}let h='<div class="row hd"><div class="lab">Task</div><div class="trk" style="width:'+W+'px">';const m0=new Date(min*864e5);for(let d=new Date(Date.UTC(m0.getUTCFullYear(),m0.getUTCMonth(),1));d/864e5<max;d=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1))){const x=(d/864e5-min)*ppd;h+='<div class="m" style="left:'+x+'px">'+d.toLocaleDateString('en-GB',{month:'short',year:'2-digit',timeZone:'UTC'})+'</div>'}h+='</div></div>';for(const t of rows){const s=t.s,sd=t.start?D(t.start):null,ed=t.end?D(t.end):null,dt=sd!==null?fmt(sd)+' - '+fmt(ed):'no date',tip=(t.name+'\\n'+dt+'\\nState: '+s).replace(/&/g,'&amp;').replace(/"/g,'&quot;');const color=COL[s]||COL.Planned;h+='<div class="row'+(t.group?' g':'')+'"><div class="lab" title="'+tip+'" style="padding-left:'+(t.group?8:22)+'px">'+String(t.name).replace(/&/g,'&amp;').replace(/</g,'&lt;')+(t.vendor?'<small>'+String(t.vendor).replace(/</g,'&lt;')+'</small>':'')+'</div><div class="trk" style="width:'+W+'px">'+(sd!==null?'<div class="b '+(t.milestone?'milestone':'')+'" title="'+tip+'" style="left:'+((sd-min)*ppd)+'px;width:'+Math.max((ed-sd)*ppd,7)+'px;background:'+color+'"></div>':'')+'</div></div>'}wrap.innerHTML=h;if(TODAY>=min&&TODAY<=max)wrap.querySelectorAll('.trk').forEach((e,i)=>{if(i)e.insertAdjacentHTML('beforeend','<div class="today" style="left:'+((TODAY-min)*ppd)+'px"></div>')});document.getElementById('t').textContent=data.title||'Project Gantt'}
['q','f','z'].forEach(id=>document.getElementById(id).addEventListener('input',draw));draw();`.replace('__PAYLOAD__',payload);
 return '<!DOCTYPE html>\\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Project Gantt</title><style>'+css+'</style></head><body><header><h1 id="t">Project Gantt</h1><div class="bar"><span id="k"></span><input id="q" placeholder="Search task"><select id="f"><option value="">All states</option><option>Done</option><option>In progress</option><option>Overdue</option><option>Planned</option><option>No date</option></select><label>Zoom <input id="z" type="range" min="1" max="8" step="0.5" value="3"></label></div></header><div id="wrap"></div><script>'+runtime+'<\\/script></body></html>';
}
function exportHTML(){
 if(!data)return;
 const blob=new Blob([standaloneHTML()],{type:'text/html;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=(sourceFile?.name||'Project').replace(/\\.[^.]+$/,'')+'_Gantt.html';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}

function wire(){
 $('fileInput').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(f)importFile(f)});
 $('dropzone').addEventListener('dragover',e=>{e.preventDefault();$('dropzone').classList.add('drag')});
 $('dropzone').addEventListener('dragleave',()=>$('dropzone').classList.remove('drag'));
 $('dropzone').addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('drag');const f=e.dataTransfer.files&&e.dataTransfer.files[0];if(f)importFile(f)});
 ['q','f','z'].forEach(id=>$(id).addEventListener('input',draw));
 $('export').addEventListener('click',exportExcel);
 $('exportHtml').addEventListener('click',exportHTML);
}
wire();
})();