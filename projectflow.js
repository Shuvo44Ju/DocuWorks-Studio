'use strict';
(function(){
const $=id=>document.getElementById(id);
let workbook=null,sourceFile='',sourceName='',sourceMatrix=[],sourceMerges=[],headerRow=0,headers=[],mapping={},tasks=[],dateRange=null,toastTimer=null,xlsxPromise=null,excelJsPromise=null,chartScale='week';

const columns=[
 {key:'task',id:'taskColumn',label:'Task / activity',aliases:['task','task name','task title','activity','activity name','activity title','task description','activity description','equipment','equipment name','equipment description','item','item name','item description','description of activity','work description','work item','deliverable','particulars','scope of work','name of work','job description','task / activity','activity / task','project activity','name','description'],required:true},
 {key:'start',id:'startColumn',label:'Start date',aliases:['start','start date','planned start','planned start date','schedule start','scheduled start','commencement','commencement date','date of commencement','starting date','target start date','work start date','from date'],required:true},
 {key:'finish',id:'finishColumn',label:'Finish date',aliases:['finish','finish date','end date','end date planned','planned finish','planned finish date','planned end date','schedule finish','scheduled finish','due date','delivery date','expected delivery date','expected completion date','completion date','target date','target completion date','deadline','to date'],required:true},
 {key:'duration',id:'durationColumn',label:'Duration',aliases:['duration','duration days','duration in days','calendar days','working days','business days','period','time required','lead time','implementation period','execution period','duration (days)','no of days']},
 {key:'progress',id:'progressColumn',label:'Progress',aliases:['progress','progress %','% progress','% complete','percent complete','percentage complete','physical progress','completion percentage','actual progress']}
];

function toast(message){
 const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),3400);
}
function norm(value){return String(value==null?'':value).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9%]+/g,' ').trim().replace(/\s+/g,' ')}
function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function isoParts(y,m,d){
 const date=new Date(Date.UTC(Number(y),Number(m)-1,Number(d)));
 if(date.getUTCFullYear()!==Number(y)||date.getUTCMonth()!==Number(m)-1||date.getUTCDate()!==Number(d))return '';
 return String(y).padStart(4,'0')+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
}
function isoToDay(value){
 const m=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
 return m?Math.floor(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))/86400000):NaN;
}
function dayToISO(day){
 const d=new Date(Number(day)*86400000);
 return isoParts(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());
}
function fromISO(value){return Number.isFinite(isoToDay(value))?new Date(isoToDay(value)*86400000):null}
function addDuration(date,days,workingDays){
 if(!date||!days||days<1)return '';
 let day=isoToDay(date),remaining=Math.ceil(days)-1,guard=0;
 while(remaining>0&&guard++<10000){
  day++;
  const weekday=new Date(day*86400000).getUTCDay();
  if(!workingDays||(weekday!==0&&weekday!==6))remaining--;
 }
 return dayToISO(day);
}
function parseDate(value,order,date1904){
 if(value===null||value===undefined||value==='')return '';
 if(value instanceof Date&&!isNaN(value))return isoParts(value.getFullYear(),value.getMonth()+1,value.getDate());
 if(typeof value==='number'&&isFinite(value)&&value>=(date1904?0:1)&&value<=2958465){
  const serial=Math.floor(value);if(!date1904&&serial===60)return '';
  const base=date1904?Date.UTC(1904,0,1):Date.UTC(1899,11,serial<60?31:30);
  const d=new Date(base+serial*86400000);return isoParts(d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate());
 }
 const text=String(value).trim();if(!text)return '';
 let m=text.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/);
 if(m)return isoParts(m[1],m[2],m[3]);
 m=text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\D|$)/);
 if(m){
  let a=Number(m[1]),b=Number(m[2]),y=Number(m[3]);if(y<100)y+=y<50?2000:1900;
  let month,day;
  if(a>12){day=a;month=b}else if(b>12){month=a;day=b}else if(order==='MDY'){month=a;day=b}else{day=a;month=b}
  return isoParts(y,month,day);
 }
 const months={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
 m=text.match(/^(\d{1,2})[\s,./-]+([a-z]{3,})[\s,./-]+(\d{2,4})/i);
 if(m&&months[m[2].toLowerCase()]){let y=Number(m[3]);if(y<100)y+=y<50?2000:1900;return isoParts(y,months[m[2].toLowerCase()],m[1])}
 m=text.match(/^([a-z]{3,})[\s,./-]+(\d{1,2})[\s,./-]+(\d{2,4})/i);
 if(m&&months[m[1].toLowerCase()]){let y=Number(m[3]);if(y<100)y+=y<50?2000:1900;return isoParts(y,months[m[1].toLowerCase()],m[2])}
 return '';
}
function numberValue(value){
 if(value===null||value===undefined||value==='')return null;
 if(typeof value==='number')return isFinite(value)?value:null;
 const match=String(value).replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
 return match?Number(match[0]):null;
}
function parseDuration(value,header){
 const text=String(value==null?'':value).trim();if(!text)return {days:null,working:false};
 const head=norm(header+' '+text),range=text.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)/i);
 if(range)return {days:null,working:/working|business/.test(head)};
 const n=numberValue(text);if(n===null)return {days:null,working:/working|business/.test(head)};
 if(/\b(month|months|year|years|hour|hours|hr|hrs)\b/.test(head))return {days:null,working:/working|business/.test(head)};
 let multiplier=/\b(week|weeks|wk|wks)\b/.test(head)?7:1;
 return {days:Math.max(0,n*multiplier),working:/working|business/.test(head)};
}
function scoreField(field,header){
 const h=norm(header);if(!h)return 0;
 let score=0;
 field.aliases.forEach(alias=>{
  const a=norm(alias);
  if(h===a)score=Math.max(score,140);
  else if(h.includes(a))score=Math.max(score,85);
  else if(a.includes(h)&&h.length>=5)score=Math.max(score,45);
 });
 if((field.key==='start'||field.key==='finish')&&/actual|baseline|original|revised/.test(h))score-=100;
 if(field.key==='finish'&&/start|commencement/.test(h))score-=100;
 if(field.key==='start'&&/finish|end|delivery|completion|deadline/.test(h))score-=100;
 if(field.key==='task'&&/remarks|comment|status|progress/.test(h))score-=70;
 return score;
}
function autoMap(headerList){
 const candidates=[];
 columns.forEach(field=>headerList.forEach((header,index)=>{const score=scoreField(field,header);if(score>=55)candidates.push({key:field.key,index:index,score:score})}));
 candidates.sort((a,b)=>b.score-a.score);
 const output={},used=new Set();
 candidates.forEach(item=>{if(output[item.key]===undefined&&!used.has(item.index)){output[item.key]=String(item.index);used.add(item.index)}});
 return output;
}
function buildHeaders(matrix,index,merges){
 const child=(matrix[index]||[]).map(v=>String(v==null?'':v).trim());
 const parent=(index>0?(matrix[index-1]||[]).map(v=>String(v==null?'':v).trim()):[]);
 (merges||[]).forEach(m=>{
  if(m.s&&m.e&&m.s.r===index-1&&m.e.r===index-1){
   const val=parent[m.s.c]||'';for(let c=m.s.c;c<=m.e.c;c++)parent[c]=val;
  }
 });
 const parentCount=parent.filter(Boolean).length;
 const grouped=parentCount>=2&&child.some((v,i)=>v&&parent[i]&&norm(v)!==norm(parent[i]));
 const len=Math.max(child.length,parent.length);
 return Array.from({length:len},(_,i)=>{
  const top=grouped?parent[i]||'':'',bottom=child[i]||'';
  return top&&bottom?top+' — '+bottom:(bottom||top||('Column '+(i+1)));
 });
}
function detectHeader(matrix,merges){
 let best=0,bestScore=-Infinity,bestMap={};
 for(let i=0;i<Math.min(matrix.length,60);i++){
  const h=buildHeaders(matrix,i,merges),m=autoMap(h);
  const mapped=Object.keys(m).length,task=m.task===undefined?-1:Number(m.task);
  const sample=task<0?0:matrix.slice(i+1,i+9).filter(row=>String((row||[])[task]??'').trim()).length;
  const dateCount=['start','finish'].filter(k=>m[k]!==undefined).length;
  const populated=(matrix[i]||[]).filter(v=>String(v??'').trim()).length;
  const score=(task>=0?20:0)+dateCount*8+mapped*2+Math.min(6,sample)*1.5+populated*.1;
  if(score>bestScore){bestScore=score;best=i;bestMap=m}
 }
 return {index:best,mapping:bestMap};
}
function parseCSV(text){
 const source=String(text||'').replace(/^\uFEFF/,'');
 const sample=source.split(/\r?\n/).filter(x=>x.trim()).slice(0,12);
 let delimiter=',',best=-1;
 [',',';','\t'].forEach(d=>{
  const counts=sample.map(line=>{let n=0,q=false;for(let i=0;i<line.length;i++){if(line[i]==='"'){if(q&&line[i+1]==='"')i++;else q=!q}else if(!q&&line[i]===d)n++}return n});
  const freq={};counts.filter(x=>x>0).forEach(x=>freq[x]=(freq[x]||0)+1);
  const score=counts.reduce((a,b)=>a+b,0)+Math.max(0,...Object.values(freq))*3+Math.max(0,...counts)*2;
  if(score>best){best=score;delimiter=d}
 });
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(quoted){if(c==='"'&&source[i+1]==='"'){cell+='"';i++}else if(c==='"')quoted=false;else cell+=c}
  else if(c==='"')quoted=true;
  else if(c===delimiter){row.push(cell);cell=''}
  else if(c==='\n'){row.push(cell.replace(/\r$/,''));rows.push(row);row=[];cell=''}
  else cell+=c;
 }
 if(cell.length||row.length){row.push(cell.replace(/\r$/,''));rows.push(row)}
 return rows;
}
function loadScript(urls,globalName,promiseName){
 if(window[globalName])return Promise.resolve(window[globalName]);
 if(promiseName==='xlsx'&&xlsxPromise)return xlsxPromise;
 if(promiseName==='exceljs'&&excelJsPromise)return excelJsPromise;
 const promise=new Promise((resolve,reject)=>{
  let i=0;
  function next(){
   if(window[globalName]){resolve(window[globalName]);return}
   if(i>=urls.length){reject(new Error('Could not load the Excel library. Check your internet connection and retry.'));return}
   const script=document.createElement('script');script.src=urls[i++];script.async=true;
   script.onload=()=>window[globalName]?resolve(window[globalName]):next();
   script.onerror=next;document.head.appendChild(script);
  }
  next();
 });
 if(promiseName==='xlsx')xlsxPromise=promise.catch(e=>{xlsxPromise=null;throw e});
 else excelJsPromise=promise.catch(e=>{excelJsPromise=null;throw e});
 return promise;
}
function loadXLSX(){return loadScript(['https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js','https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js','https://unpkg.com/xlsx@0.18.5/dist/xlsx.full.min.js'],'XLSX','xlsx')}
function loadExcelJS(){return loadScript(['https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js','https://unpkg.com/exceljs@4.4.0/dist/exceljs.min.js'],'ExcelJS','exceljs')}
function sheetRows(wb,name){
 const sheet=wb.Sheets[name];
 if(sheet.__rows)return sheet.__rows;
 return XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true,blankrows:true});
}
async function readWorkbook(file){
 if(/\.csv$/i.test(file.name)){
  const text=await file.text();
  return {SheetNames:['CSV'],Sheets:{CSV:{__rows:parseCSV(text)}},Workbook:{WBProps:{date1904:false}}};
 }
 await loadXLSX();
 const buffer=await file.arrayBuffer();
 return XLSX.read(buffer,{type:'array',cellDates:false,cellNF:true,raw:true});
}
function showSheet(name){
 const sheet=workbook.Sheets[name];
 sourceMerges=sheet['!merges']||[];
 sourceMatrix=sheetRows(workbook,name);
 const detected=detectHeader(sourceMatrix,sourceMerges);
 headerRow=detected.index;
 $('headerSelect').innerHTML=sourceMatrix.slice(0,Math.min(60,sourceMatrix.length)).map((row,index)=>'<option value="'+index+'" '+(index===headerRow?'selected':'')+'>Row '+(index+1)+': '+esc((row||[]).slice(0,5).filter(Boolean).join(' · ').slice(0,85)||'(blank)')+'</option>').join('');
 updateHeader();
}
function fillColumnSelect(id,key){
 const current=mapping[key]===undefined?'':String(mapping[key]);
 const el=$(id);
 el.innerHTML='<option value="">— Not mapped —</option>'+headers.map((name,index)=>'<option value="'+index+'" '+(current===String(index)?'selected':'')+'>'+esc(name)+' · Col '+(index+1)+'</option>').join('');
}
function renderMapping(){
 columns.forEach(field=>fillColumnSelect(field.id,field.key));
}
function updateHeader(){
 headerRow=Number($('headerSelect').value||0);
 headers=buildHeaders(sourceMatrix,headerRow,sourceMerges);
 mapping=autoMap(headers);
 renderMapping();
 updatePreview();
}
function getCell(rowIndex,columnIndex,key){
 if(columnIndex===undefined||columnIndex===null||columnIndex==='')return '';
 const row=sourceMatrix[rowIndex]||[];
 const value=row[Number(columnIndex)];
 if(value!==''&&value!==null&&value!==undefined)return value;
 if(!['task'].includes(key)){
  for(const merge of sourceMerges){
   if(merge.s&&merge.e&&merge.s.c===Number(columnIndex)&&merge.e.c===Number(columnIndex)&&merge.s.r>headerRow&&merge.s.r<rowIndex&&merge.e.r>=rowIndex){
    const anchor=(sourceMatrix[merge.s.r]||[])[merge.s.c];
    if(anchor!==''&&anchor!==null&&anchor!==undefined)return anchor;
   }
  }
 }
 return '';
}
function readTasks(){
 const date1904=!!(workbook.Workbook&&workbook.Workbook.WBProps&&[true,1,'1'].includes(workbook.Workbook.WBProps.date1904));
 const order=$('dateOrder').value||'DMY';
 const fieldColumn=key=>mapping[key]===undefined||mapping[key]===''?null:Number(mapping[key]);
 const list=[],warnings={invalidDates:0,missingDates:0,invalidDurations:0,skipped:0};
 const rowCount=sourceMatrix.length;
 for(let rowIndex=headerRow+1;rowIndex<rowCount;rowIndex++){
  const row=sourceMatrix[rowIndex]||[];
  if(!row.some(v=>v!==''&&v!==null&&v!==undefined))continue;
  const read=key=>{const col=fieldColumn(key);return col===null?'':getCell(rowIndex,col,key)};
  const name=String(read('task')).trim();
  if(!name||/^(grand\s+)?total$|^overall summary$/i.test(name)){warnings.skipped++;continue}
  const rawStart=read('start'),rawFinish=read('finish');
  let start=parseDate(rawStart,order,date1904),finish=parseDate(rawFinish,order,date1904);
  const durationHeader=fieldColumn('duration')===null?'':headers[fieldColumn('duration')];
  const durationInfo=parseDuration(read('duration'),durationHeader);
  let duration=durationInfo.days;
  if(durationInfo.days===null&&read('duration')!=='')warnings.invalidDurations++;
  if(rawStart!==''&&!start)warnings.invalidDates++;
  if(rawFinish!==''&&!finish)warnings.invalidDates++;
  if(start&&finish&&isoToDay(finish)<isoToDay(start)){start='';finish='';warnings.invalidDates++}
  if(start&&!finish&&duration!==null&&duration>0)finish=addDuration(start,duration,durationInfo.working);
  if(finish&&!start&&duration!==null&&duration>0){
   let day=isoToDay(finish),remaining=Math.max(1,Math.ceil(duration))-1,guard=0;
   while(remaining>0&&guard++<10000){day--;const weekday=new Date(day*86400000).getUTCDay();if(!durationInfo.working||(weekday!==0&&weekday!==6))remaining--}
   start=dayToISO(day);
  }
  if(duration===null&&start&&finish)duration=isoToDay(finish)-isoToDay(start)+1;
  if(!start||!finish)warnings.missingDates++;
  const rawProgress=read('progress'),n=numberValue(rawProgress);
  let progress=n;
  if(progress!==null&&progress>0&&progress<=1&&!String(rawProgress).includes('%'))progress*=100;
  if(progress!==null)progress=Math.max(0,Math.min(100,progress));
  list.push({name:name,start:start,finish:finish,duration:duration,progress:progress,sourceRow:rowIndex+1});
 }
 return {list:list,warnings:warnings};
}
function updatePreview(){
 const taskCol=mapping.task,startCol=mapping.start,finishCol=mapping.finish;
 const result=readTasks();
 const data=result.list.slice(0,5);
 const selected=columns.filter(field=>mapping[field.key]!==undefined&&mapping[field.key]!=='');
 $('previewTable').innerHTML='<thead><tr>'+selected.map(f=>'<th>'+esc(f.label)+'</th>').join('')+'</tr></thead><tbody>'+data.map(task=>'<tr>'+selected.map(f=>{
  const value=f.key==='task'?task.name:f.key==='start'?task.start:f.key==='finish'?task.finish:f.key==='duration'?task.duration:f.key==='progress'?task.progress:'';
  return '<td>'+esc(value===null||value===undefined?'':value)+'</td>';
 }).join('')+'</tr>').join('')+'</tbody>';
 $('rowCount').textContent=result.list.length+' tasks detected';
 const notes=[];
 if(!taskCol)notes.push('Choose the task-name column.');
 if(!startCol)notes.push('Choose the start-date column.');
 if(!finishCol&&!mapping.duration)notes.push('Choose a finish-date or duration column.');
 if(result.warnings.missingDates)notes.push(result.warnings.missingDates+' task(s) do not have a complete date range.');
 if(result.warnings.invalidDates)notes.push(result.warnings.invalidDates+' date value(s) could not be read.');
 if(result.warnings.invalidDurations)notes.push(result.warnings.invalidDurations+' duration value(s) could not be converted.');
 if(!notes.length)notes.push('The detected task names and dates look ready.');
 $('qualityLine').textContent=notes.join(' ');
 $('qualityLine').classList.toggle('warning',taskCol===undefined||startCol===undefined||(finishCol===undefined&&mapping.duration===undefined)||result.warnings.invalidDates>0);
 $('buildButton').disabled=!taskCol||!startCol||(!finishCol&&!mapping.duration)||result.list.length===0;
}
function loadFile(file){
 if(!file)return;
 if(!/\.(xlsx|xls|csv)$/i.test(file.name)){toast('Please choose an .xlsx, .xls or .csv file.');return}
 $('dropTitle').textContent='Reading your workbook…';$('dropSubtitle').textContent=file.name;
 readWorkbook(file).then(wb=>{
  workbook=wb;sourceFile=file.name;sourceName=file.name.replace(/\.[^.]+$/,'');
  const sheetNames=wb.SheetNames||[];
  if(!sheetNames.length)throw new Error('No worksheet found in this file.');
  $('sheetSelect').innerHTML=sheetNames.map(name=>'<option value="'+esc(name)+'">'+esc(name)+'</option>').join('');
  $('fileInfo').textContent=sourceFile+' · Choose the worksheet and check the detected columns.';
  $('importSettings').hidden=false;
  showSheet(sheetNames[0]);
  $('dropTitle').textContent=sourceFile;$('dropSubtitle').textContent='Workbook loaded. You can choose another file at any time.';
  $('chartPanel').hidden=true;
  $('importPanel').scrollIntoView({behavior:'smooth',block:'start'});
 }).catch(error=>{
  $('dropTitle').textContent='Choose your Excel file';$('dropSubtitle').textContent='Drag and drop here, or click to browse · .xlsx, .xls, .csv';
  toast(error.message||'Unable to read this workbook.');
 });
}
function buildChart(){
 const result=readTasks();tasks=result.list;
 if(!tasks.length){toast('No task rows were detected. Check the task-name column.');return}
 tasks.sort((a,b)=>{
  if(a.start&&b.start)return isoToDay(a.start)-isoToDay(b.start)||a.sourceRow-b.sourceRow;
  if(a.start)return -1;if(b.start)return 1;return a.sourceRow-b.sourceRow;
 });
 $('chartTitle').textContent=sourceName||'Gantt chart';
 $('chartSubtitle').textContent=sourceFile+' · '+$('sheetSelect').value+' · '+tasks.length+' activities';
 $('chartSummary').textContent=tasks.length+' activities · '+tasks.filter(t=>t.start&&t.finish).length+' scheduled';
 const missing=tasks.filter(t=>!t.start||!t.finish).length;
 $('missingDates').textContent=missing?missing+' activities have incomplete dates':'All activities have dates';
 $('chartPanel').hidden=false;$('chartPanel').scrollIntoView({behavior:'smooth',block:'start'});
 chartScale=$('scaleSelect').value||'week';renderChart();
 if(missing)toast('Gantt chart built. '+missing+' task(s) need a complete start and finish date.');
 else toast('Gantt chart built successfully.');
}
function getRange(){
 const dates=[];tasks.forEach(t=>{if(t.start&&t.finish&&isoToDay(t.finish)>=isoToDay(t.start)){dates.push(isoToDay(t.start),isoToDay(t.finish))}});
 if(!dates.length)return null;
 const min=Math.min(...dates)-2,max=Math.max(...dates)+2;
 return {start:min,end:max,days:max-min+1};
}
function renderChart(){
 const labels=$('taskLabels'),timeline=$('timeline'),range=getRange();
 labels.innerHTML='';timeline.innerHTML='';
 const count=tasks.length,head=document.createElement('div');head.className='timeline-head';
 if(!range){
  timeline.style.width='700px';timeline.style.height=(64+count*46)+'px';timeline.appendChild(head);
  tasks.forEach(t=>{
   const label=document.createElement('div');label.className='task-label';label.innerHTML='<strong>'+esc(t.name)+'</strong><small>No complete dates</small>';labels.appendChild(label);
   const row=document.createElement('div');row.className='gantt-row';row.style.width='700px';const no=document.createElement('span');no.className='no-date';no.textContent='Dates not available';row.appendChild(no);timeline.appendChild(row);
  });
  return;
 }
 const px=chartScale==='day'?28:chartScale==='week'?14:5;
 const total=Math.max(700,range.days*px);timeline.style.width=total+'px';timeline.style.height=(64+count*46)+'px';
 let month=new Date(range.start*86400000);month=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth(),1));
 while(month.getTime()/86400000<=range.end){
  const monthDay=Math.floor(month.getTime()/86400000),next=new Date(Date.UTC(month.getUTCFullYear(),month.getUTCMonth()+1,1)),nextDay=Math.floor(next.getTime()/86400000);
  const item=document.createElement('div');item.className='month-label';item.style.left=(monthDay-range.start)*px+'px';item.style.width=(Math.min(range.end+1,nextDay)-monthDay)*px+'px';item.textContent=month.toLocaleDateString(undefined,{month:'short',year:'numeric'});head.appendChild(item);month=next;
 }
 const step=chartScale==='day'?1:chartScale==='week'?7:30;
 for(let day=0;day<range.days;day+=step){
  const d=range.start+day,date=new Date(d*86400000),item=document.createElement('div');item.className='time-tick';item.style.left=(day*px)+'px';item.style.width=Math.min(step,range.days-day)*px+'px';
  item.textContent=chartScale==='day'?String(date.getUTCDate()):chartScale==='week'?'W'+Math.ceil((date.getUTCDate()+new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),1)).getUTCDay())/7):date.getUTCDate()===1?date.toLocaleDateString(undefined,{month:'short'}):'';
  head.appendChild(item);
 }
 timeline.appendChild(head);
 tasks.forEach(task=>{
  const label=document.createElement('div');label.className='task-label';
  label.innerHTML='<strong title="'+esc(task.name)+'">'+esc(task.name)+'</strong><small>'+esc((task.start||'—')+'  →  '+(task.finish||'—')+(task.duration!==null?' · '+task.duration+' days':''))+'</small>';labels.appendChild(label);
  const row=document.createElement('div');row.className='gantt-row';row.style.width=total+'px';row.style.backgroundSize=(step*px)+'px 100%';
  if(task.start&&task.finish&&isoToDay(task.finish)>=isoToDay(task.start)){
   const left=(isoToDay(task.start)-range.start)*px,width=(isoToDay(task.finish)-isoToDay(task.start)+1)*px;
   const bar=document.createElement('div');bar.className='gantt-bar';bar.style.left=left+'px';bar.style.width=Math.max(4,width)+'px';
   bar.title=task.name+' · '+task.start+' to '+task.finish+(task.progress===null?'':' · '+task.progress+'% complete');
   if(task.progress!==null){const progress=document.createElement('div');progress.className='gantt-progress';progress.style.width=task.progress+'%';bar.appendChild(progress)}
   if(width>100){const name=document.createElement('span');name.textContent=task.name;bar.appendChild(name)}
   row.appendChild(bar);
  }else{const no=document.createElement('span');no.className='no-date';no.textContent='No complete schedule';row.appendChild(no)}
  timeline.appendChild(row);
 });
 dateRange=range;
}
function addExcelRowsFromSource(ws){
 if(!sourceMatrix.length)return;
 sourceMatrix.forEach((row,index)=>ws.addRow((row||[]).map(v=>v==null?'':v)));
 ws.getRow(Math.min(headerRow+1,ws.rowCount)).font={bold:true,color:{argb:'FF2B4566'}};
 ws.views=[{state:'frozen',ySplit:headerRow+1,showGridLines:false}];
}
function buildExportTasksRows(){
 return [
  ['Task / Activity','Start date','Finish date','Duration (days)','Progress (%)','Source row'],
  ...tasks.map(t=>[t.name,t.start||'',t.finish||'',t.duration===null?'':t.duration,t.progress===null?'':t.progress,t.sourceRow])
 ];
}
async function exportExcel(){
 if(!tasks.length){toast('Build a Gantt chart first.');return}
 $('exportButton').disabled=true;$('exportButton').textContent='Preparing Excel…';
 try{
  const ExcelJS=await loadExcelJS();
  const wb=new ExcelJS.Workbook();wb.creator='DocuWorks Studio';wb.subject='Excel Gantt chart';wb.created=new Date();
  const ws=wb.addWorksheet('Gantt Chart');
  const range=getRange();
  const startDay=range?range.start:null,endDay=range?range.end:null,dayCount=range?range.days:0;
  const lastColumn=6+dayCount;
  ws.mergeCells(1,1,1,Math.max(6,lastColumn));
  ws.getCell(1,1).value='PROJECT GANTT CHART';
  ws.getCell(1,1).font={name:'Aptos Display',size:16,bold:true,color:{argb:'FFFFFFFF'}};
  ws.getCell(1,1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF24456D'}};
  ws.getRow(1).height=29;
  ws.mergeCells(2,1,2,Math.max(6,lastColumn));
  ws.getCell(2,1).value='Source: '+sourceFile+'  |  Worksheet: '+$('sheetSelect').value+'  |  Generated: '+new Date().toLocaleString();
  ws.getCell(2,1).font={italic:true,size:9,color:{argb:'FF667891'}};
  const fixedHeaders=['No.','Task / Activity','Start date','Finish date','Duration (days)','Progress (%)'];
  const headerRowValues=fixedHeaders.slice();
  if(range){for(let day=startDay;day<=endDay;day++)headerRowValues.push(new Date(day*86400000))}
  const header=ws.addRow(headerRowValues);header.height=34;
  header.eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'},size:9};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF385D8A'}};cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};cell.border={bottom:{style:'thin',color:{argb:'FFCFD8E5'}}}});
  if(range){for(let c=7;c<=lastColumn;c++)ws.getCell(3,c).numFmt='dd-mmm'}
  tasks.forEach((task,index)=>{
   const rowValues=[index+1,task.name,task.start?new Date(isoToDay(task.start)*86400000):'',task.finish?new Date(isoToDay(task.finish)*86400000):'',task.duration===null?'':task.duration,task.progress===null?'':task.progress];
   if(range){for(let day=startDay;day<=endDay;day++)rowValues.push('')}
   const row=ws.addRow(rowValues);row.height=21;
   row.getCell(1).alignment={horizontal:'center',vertical:'middle'};
   row.getCell(2).alignment={vertical:'middle'};
   [3,4].forEach(col=>{row.getCell(col).numFmt='dd-mmm-yyyy';row.getCell(col).alignment={horizontal:'center',vertical:'middle'}});
   row.getCell(5).alignment={horizontal:'center',vertical:'middle'};
   row.getCell(6).alignment={horizontal:'center',vertical:'middle'};
   row.eachCell({includeEmpty:true},cell=>{cell.border={bottom:{style:'hair',color:{argb:'FFE7ECF2'}}}});
   if(range&&task.start&&task.finish){
    const first=Math.max(startDay,isoToDay(task.start)),last=Math.min(endDay,isoToDay(task.finish));
    if(last>=first){
     const span=last-first+1,done=task.progress===null?0:Math.round(span*task.progress/100);
     for(let day=first;day<=last;day++){
      const cell=row.getCell(7+day-startDay);
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:day-first<done?'FF2CA27E':'FF6687D6'}};
      cell.alignment={horizontal:'center',vertical:'middle'};
     }
    }
   }
  });
  ws.columns[0].width=6;ws.columns[1].width=34;ws.columns[2].width=14;ws.columns[3].width=14;ws.columns[4].width=15;ws.columns[5].width=13;
  if(range){for(let c=7;c<=lastColumn;c++)ws.getColumn(c).width=4.2}
  ws.views=[{state:'frozen',xSplit:6,ySplit:3,topLeftCell:'G4',showGridLines:false}];
  ws.autoFilter={from:{row:3,column:1},to:{row:3+tasks.length,column:6}};
  const data=wb.addWorksheet('Task Data');
  data.addRows(buildExportTasksRows());
  data.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  data.getRow(1).eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF385D8A'}};cell.alignment={vertical:'middle'}});
  data.columns=[{width:38},{width:15},{width:15},{width:16},{width:14},{width:13}];
  data.views=[{state:'frozen',ySplit:1,showGridLines:false}];
  const original=wb.addWorksheet('Original Data');addExcelRowsFromSource(original);
  const buffer=await wb.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),safeFileName(sourceName||'Project')+'_Gantt.xlsx');
  toast('Excel Gantt workbook exported.');
 }catch(error){
  try{
   if(!window.XLSX)await loadXLSX();
   const range=getRange(),rows=[['PROJECT GANTT CHART'],['Source: '+sourceFile+' | Worksheet: '+$('sheetSelect').value],['No.','Task / Activity','Start date','Finish date','Duration (days)','Progress (%)']];
   if(range){for(let d=range.start;d<=range.end;d++)rows[2].push(dayToISO(d))}
   tasks.forEach((t,i)=>{
    const row=[i+1,t.name,t.start,t.finish,t.duration===null?'':t.duration,t.progress===null?'':t.progress];
    if(range){for(let d=range.start;d<=range.end;d++)row.push(t.start&&t.finish&&d>=isoToDay(t.start)&&d<=isoToDay(t.finish)?'■':'')}
    rows.push(row);
   });
   const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(rows);
   sheet['!cols']=[{wch:6},{wch:36},{wch:14},{wch:14},{wch:16},{wch:13}];
   XLSX.utils.book_append_sheet(book,sheet,'Gantt Chart');
   XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(buildExportTasksRows()),'Task Data');
   XLSX.writeFile(book,safeFileName(sourceName||'Project')+'_Gantt.xlsx');
   toast('Excel Gantt exported. Use ExcelJS-enabled export for coloured timeline bars.');
  }catch(fallbackError){toast(fallbackError.message||error.message||'Excel export failed.')}
 }finally{$('exportButton').disabled=false;$('exportButton').textContent='↓ Export Excel'}
}
function safeFileName(name){return String(name||'Project').replace(/[\\/:*?"<>|]+/g,'_').trim()||'Project'}
function downloadBlob(blob,name){
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function chooseAnother(){ $('fileInput').click() }
function wire(){
 $('fileInput').addEventListener('change',e=>{const file=e.target.files&&e.target.files[0];if(file)loadFile(file);e.target.value=''});
 $('dropzone').addEventListener('dragover',e=>{e.preventDefault();$('dropzone').classList.add('dragover')});
 $('dropzone').addEventListener('dragleave',()=>$('dropzone').classList.remove('dragover'));
 $('dropzone').addEventListener('drop',e=>{e.preventDefault();$('dropzone').classList.remove('dragover');const file=e.dataTransfer.files&&e.dataTransfer.files[0];if(file)loadFile(file)});
 $('sheetSelect').addEventListener('change',()=>showSheet($('sheetSelect').value));
 $('headerSelect').addEventListener('change',updateHeader);
 columns.forEach(field=>$(field.id).addEventListener('change',()=>{
  mapping[field.key]=$(field.id).value;
  const used=new Set();
  columns.forEach(f=>{if(mapping[f.key]!==undefined&&mapping[f.key]!=='' ){if(used.has(mapping[f.key]))mapping[f.key]='';else used.add(mapping[f.key])}});
  renderMapping();updatePreview();
 }));
 $('dateOrder').addEventListener('change',updatePreview);
 $('buildButton').addEventListener('click',buildChart);
 $('scaleSelect').addEventListener('change',()=>{chartScale=$('scaleSelect').value;renderChart()});
 $('changeFileButton').addEventListener('click',chooseAnother);
 $('exportButton').addEventListener('click',exportExcel);
}
wire();
})();