(()=>{
"use strict";
const $=id=>document.getElementById(id),jobs=[],queue=$("queue"),form=$("downloadForm");
let activeTransfers=0,filterStatus="All",speedHistory=Array(48).fill(0),peakSpeed=0,sessionBytes=0;
function maxActive(){return Math.max(1,Math.min(4,Number($("maxActive")?.value)||2))}
function pumpQueue(){for(const j of jobs){if(activeTransfers>=maxActive())break;if(j.status==="Queued")start(j)}}
function pace(bytes,started,signal,connections=1){const limit=Number($("bandwidthLimit")?.value)||0;if(!limit)return Promise.resolve();const target=bytes/(limit*1048576/Math.max(1,connections))*1000,wait=target-(Date.now()-started);return wait>0?sleep(wait,signal):Promise.resolve()}
function extension(name){const m=(name||"").match(/\.([a-z0-9]{1,8})(?:$|[?#])/i);return m?m[1].toUpperCase():"FILE"}
function duration(j){const end=j.completedAt||Date.now(),start=j.startedAt||j.created||end;const sec=Math.max(0,Math.floor((end-start)/1000));return sec>=3600?Math.floor(sec/3600)+"h "+Math.floor(sec%3600/60)+"m":sec>=60?Math.floor(sec/60)+"m "+sec%60+"s":sec+"s"}
function category(j){if(j.status==="Completed")return"Completed";if(j.status==="Error")return"Failed";if(j.status==="Queued")return"Queued";if(j.status==="Paused"||j.status==="Cancelled")return"Paused";if(j.status==="Downloading")return"Active";return"All"}
function drawDashboard(){
 const active=jobs.filter(j=>j.status==="Downloading"),speed=active.reduce((n,j)=>n+(j.speed||0),0);
 $("metricSpeed").textContent=fmt(speed)+"/s";$("metricData").textContent=fmt(sessionBytes);$("metricActive").textContent=String(active.length);$("metricCompleted").textContent=String(jobs.filter(j=>j.status==="Completed").length);
 peakSpeed=Math.max(peakSpeed,speed);$("speedPeak").textContent="Peak "+fmt(peakSpeed)+"/s";
 speedHistory.push(speed);if(speedHistory.length>48)speedHistory.shift();
 const c=$("speedChart"),ctx=c?.getContext("2d");if(!ctx)return;
 const w=Math.max(280,c.clientWidth||600),h=112,dpr=window.devicePixelRatio||1;c.width=w*dpr;c.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);ctx.strokeStyle="#e8edf5";ctx.lineWidth=1;
 for(let y=20;y<h;y+=28){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
 const max=Math.max(1,...speedHistory);ctx.beginPath();speedHistory.forEach((v,i)=>{const x=i/(speedHistory.length-1)*w,y=h-8-(v/max)*(h-20);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.lineWidth=2.5;ctx.strokeStyle="#2458d3";ctx.stroke();ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fillStyle="rgba(36,88,211,.10)";ctx.fill();
}
const PROXY="https://docuworks-studio.shuvokh97.workers.dev/api/download";
const DB_NAME="docuworks-downloads",DB_VERSION=1;
let dbPromise;
function openDB(){
 if(!("indexedDB" in window))return Promise.reject(new Error("Persistent storage is unavailable in this browser."));
 if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{
  const req=indexedDB.open(DB_NAME,DB_VERSION);
  req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains("jobs"))db.createObjectStore("jobs",{keyPath:"id"});if(!db.objectStoreNames.contains("parts")){const st=db.createObjectStore("parts",{keyPath:"key"});st.createIndex("jobId","jobId",{unique:false})}};
  req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
 });
 return dbPromise;
}
async function dbWrite(store,value){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).put(value);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)})}
async function dbReadAll(store){const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(store).objectStore(store).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error)})}
async function dbDelete(store,key){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(store,"readwrite");tx.objectStore(store).delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function dbDeleteParts(id){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction("parts","readwrite"),idx=tx.objectStore("parts").index("jobId"),req=idx.openCursor(IDBKeyRange.only(id));req.onsuccess=()=>{const c=req.result;if(c){c.delete();c.continue()}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
function snapshot(j){return {id:j.id,url:j.url,name:j.name,status:j.status,loaded:j.loaded,total:j.total,error:j.error||"",blob:j.blob||null,chunkSize:j.chunkSize||0,count:j.count||0,created:j.created||Date.now(),startedAt:j.startedAt||0,completedAt:j.completedAt||0}}
async function persist(j){try{await dbWrite("jobs",snapshot(j))}catch(e){j.storageWarning="Browser storage is full or unavailable; this download may not survive a refresh."}}
async function restoreJobs(){
 try{
  const [saved,parts]=await Promise.all([dbReadAll("jobs"),dbReadAll("parts")]);
  for(const x of saved.sort((a,b)=>(b.created||0)-(a.created||0))){
   if(jobs.some(j=>j.id===x.id))continue;
   const j={...x,parts:{},controller:null,pauseRequested:false,cancelRequested:false,speed:0};
   if(j.status==="Downloading")j.status="Paused";
   if(j.status==="Completed"&&!j.blob)j.status="Error",j.error="The saved file is no longer available in browser storage.";
   for(const p of parts)if(p.jobId===j.id)j.parts[p.index]=p.data;
   updateLoaded(j);jobs.push(j);
  }
  render();
 }catch(e){console.warn("Download restore unavailable",e)}
}

const proxy=url=>PROXY+"?url="+encodeURIComponent(url);
const sleep=(ms,signal)=>new Promise((resolve,reject)=>{
 if(signal?.aborted)return reject(new DOMException("Stopped","AbortError"));
 const timer=setTimeout(resolve,ms);
 signal?.addEventListener("abort",()=>{clearTimeout(timer);reject(new DOMException("Stopped","AbortError"))},{once:true});
});
const fmt=n=>{if(!Number.isFinite(n)||n<0)return "—";const units=["B","KB","MB","GB","TB"];let i=0;while(n>=1024&&i<units.length-1){n/=1024;i++}return n.toFixed(i?2:0)+" "+units[i]};
const safeName=s=>{try{return decodeURIComponent(s).split(/[\\/]/).pop().replace(/[<>:"|?*\x00-\x1f]/g,"_").slice(0,180)||"download"}catch{return "download"}};
function fileName(res,url){
 const cd=res.headers.get("content-disposition")||"";
 let m=cd.match(/filename\*=UTF-8''([^;]+)/i)||cd.match(/filename="?([^";]+)"?/i);
 if(m)return safeName(m[1]);
 const path=new URL(url).pathname.split("/").filter(Boolean).pop();
 return safeName(path||"download");
}
function retryDelay(res,attempt){
 const h=res?.headers?.get("retry-after");
 if(h){const n=Number(h);if(Number.isFinite(n))return Math.min(30000,Math.max(500,n*1000));const d=Date.parse(h);if(Number.isFinite(d))return Math.min(30000,Math.max(500,d-Date.now()))}
 return Math.min(15000,700*2**attempt)+Math.random()*350;
}
async function request(url,options={},label="Download"){
 let last;
 for(let attempt=0;attempt<6;attempt++){
  if(options.signal?.aborted)throw new DOMException("Stopped","AbortError");
  try{
   const res=await fetch(url,options);
   if(![429,500,502,503,504].includes(res.status))return res;
   last=new Error("HTTP "+res.status);
   try{await res.body?.cancel()}catch{}
   if(attempt<5)await sleep(retryDelay(res,attempt),options.signal);
  }catch(e){
   if(options.signal?.aborted||e?.name==="AbortError")throw e;
   last=e;
   if(attempt<5)await sleep(Math.min(12000,600*2**attempt)+Math.random()*300,options.signal);
  }
 }
 throw new Error(last?.message?.startsWith("HTTP 429")?"The source is rate-limiting requests (HTTP 429). Wait and retry.":label+" failed after 6 attempts: "+(last?.message||"network error"));
}
function rejectHtml(res){
 const type=(res.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
 if(type==="text/html"||type==="application/xhtml+xml")throw new Error("This link returned a webpage, not a file. Copy the direct download link instead of the page URL.");
}
async function verifyBlob(blob){
 const type=(blob.type||"").split(";")[0].trim().toLowerCase();
 if(type==="text/html"||type==="application/xhtml+xml")throw new Error("The server returned a webpage (HTML), not a file. Use a direct download link.");
 const head=(await blob.slice(0,1024).text()).replace(/^\uFEFF/,"").trimStart();
 if(/^<!doctype\s+html|^<html[\s>]|^<head[\s>]|^<body[\s>]/i.test(head))throw new Error("The server returned a webpage (HTML), not a file. Use a direct download link.");
}
function updateLoaded(j){j.loaded=Object.values(j.parts||{}).reduce((sum,p)=>sum+p.byteLength,0)}
function render(){
 queue.innerHTML="";
 if(!jobs.length){queue.innerHTML='<div class="empty">Your download queue is empty.</div>';drawDashboard();return}
 const term=($("jobSearch")?.value||"").toLowerCase();
 const visible=jobs.filter(j=>(filterStatus==="All"||category(j)===filterStatus)&&(!term||((j.name||"")+" "+j.url).toLowerCase().includes(term)));
 if(!visible.length){queue.innerHTML='<div class="empty">No downloads match this view.</div>';drawDashboard();return}
 for(const j of visible){
  const el=document.createElement("article");el.className="job";
  el.innerHTML='<div class="jobtop"><div class="fileicon"></div><div class="jobmain"><div class="filename"></div><div class="meta"></div></div><div class="actions"></div></div><div class="bar"><div class="fill"></div></div><div class="jobstats"><span class="left"></span><span class="right"></span></div>';
  el.querySelector(".fileicon").textContent=extension(j.name||j.url);
  el.querySelector(".filename").textContent=j.name||j.url;
  el.querySelector(".meta").textContent=j.status+" · "+(j.total?fmt(j.total):"size unknown")+(j.name?" · "+extension(j.name):"")+(j.startedAt?" · "+duration(j):"");
  el.querySelector(".fill").style.width=(j.total?Math.min(100,j.loaded/j.total*100):0)+"%";
  el.querySelector(".left").textContent=j.total?fmt(j.loaded)+" / "+fmt(j.total):fmt(j.loaded)+" downloaded";
  el.querySelector(".right").textContent=j.status==="Downloading"?fmt(j.speed)+"/s · ETA "+(j.speed>0&&j.total?Math.ceil((j.total-j.loaded)/j.speed)+"s":"calculating"):(j.error||j.status);
  const actions=el.querySelector(".actions");
  const button=(label,fn,cls="")=>{const b=document.createElement("button");b.className="small "+cls;b.textContent=label;b.addEventListener("click",fn);actions.append(b)};
  if(j.status==="Downloading")button("Pause",()=>pause(j));
  if(j.status==="Paused")button("Resume",()=>start(j));
  if(j.status==="Queued")button("Start",()=>start(j),"primary");
  if(j.status==="Error")button("Retry",()=>{j.error="";j.status="Queued";start(j)},"primary");
  if(j.status==="Completed")button("Save again",()=>save(j));
  if(!["Completed","Cancelled"].includes(j.status))button("Cancel",()=>cancel(j),"danger");
  if(["Completed","Cancelled","Error"].includes(j.status))button("Remove",()=>{jobs.splice(jobs.indexOf(j),1);render();dbDelete("jobs",j.id).catch(()=>{});dbDeleteParts(j.id).catch(()=>{})});
  queue.append(el);
 }
 drawDashboard();
}
function save(j){
 if(!j.blob)return;
 const a=document.createElement("a"),u=URL.createObjectURL(j.blob);
 a.href=u;a.download=j.name||"download";document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(u),60000);
}
function pause(j){j.pauseRequested=true;j.controller?.abort();j.status="Paused";render();persist(j)}
function cancel(j){j.cancelRequested=true;j.controller?.abort();j.status="Cancelled";j.speed=0;render();persist(j);dbDeleteParts(j.id).catch(()=>{})}
function add(raw){
 const u=new URL(raw),host=u.hostname.toLowerCase();
 const youtube=host==="youtube.com"||host.endsWith(".youtube.com")||host==="youtu.be"||host.endsWith(".youtu.be");
 const j={id:crypto.randomUUID?.()||String(Date.now()+Math.random()),url:u.href,name:youtube?"Video page (not a direct file)":"",status:youtube?"Error":"Queued",loaded:0,total:0,speed:0,blob:null,parts:{},controller:null,error:youtube?"This is a YouTube webpage, not a direct media-file URL. This downloader accepts direct file links; use the platform's official download option where available.":"",pauseRequested:false,cancelRequested:false};
 j.created=Date.now();jobs.unshift(j);render();persist(j);if(!youtube&&$("autoStart").checked)start(j);
}
function start(j){
 if(j.status==="Downloading"||j.status==="Completed")return;
 if(activeTransfers>=maxActive()){j.status="Queued";render();persist(j);return}
 activeTransfers++;runJob(j).finally(()=>{activeTransfers=Math.max(0,activeTransfers-1);pumpQueue();render()});
}
async function runJob(j){
 for(let attempt=0;attempt<3;attempt++){
  await runAttempt(j);
  if(j.status!=="Error"||!$("autoRetry")?.checked||!/(429|5\\d\\d|network|fetch|temporarily|timeout|failed after 6 attempts)/i.test(j.error||"")||attempt===2)break;
  j.status="Queued";j.error="Temporary connection problem. Retrying ("+(attempt+1)+"/2)…";await persist(j);render();
  await sleep(1500*(attempt+1));
  if(j.cancelRequested){j.status="Cancelled";await persist(j);break}
 }
 if(j.status==="Completed")notify("Download complete",j.name||"Your file is ready.");
 else if(j.status==="Error")notify("Download failed",j.name||j.error||"A download could not be completed.");
}
function notify(title,body){
 if(!$("notifyDone")?.checked||!("Notification" in window)||Notification.permission!=="granted")return;
 try{new Notification(title,{body,tag:"dws-download-"+title})}catch(e){}
}
async function runAttempt(j){
 j.pauseRequested=false;j.cancelRequested=false;j.error="";j.status="Downloading";j.startedAt=j.startedAt||Date.now();j.controller=new AbortController();
 const signal=j.controller.signal;
 try{
  const probe=await request(proxy(j.url),{headers:{Range:"bytes=0-0"},signal},"File check");
  if(!probe.ok){let detail=await probe.clone().text().catch(()=>"");try{detail=JSON.parse(detail).error||detail}catch{}throw new Error(detail||("Source returned HTTP "+probe.status+"."))}
  rejectHtml(probe);
  const range=probe.headers.get("content-range")||"";
  const match=range.match(/^bytes\s+\d+-\d+\/(\d+)$/i);
  const total=match?Number(match[1]):Number(probe.headers.get("content-length"))||0;
  const supportsRanges=probe.status===206&&!!match&&total>0;
  j.total=total;j.name=fileName(probe,j.url);
  if(supportsRanges){
   const connections=Math.max(1,Math.min(8,Number($("connections").value)||4));
   const chunkSize=j.chunkSize||Math.max(4*1024*1024,Math.ceil(total/(connections*3)));
   const count=j.count||Math.ceil(total/chunkSize);j.chunkSize=chunkSize;j.count=count;await persist(j);
   const pending=Array.from({length:count},(_,i)=>i).filter(i=>!j.parts[i]);
   let cursor=0;
   const worker=async()=>{
    while(cursor<pending.length&&!signal.aborted){
     const index=pending[cursor++],from=index*chunkSize,to=Math.min(total-1,from+chunkSize-1),started=Date.now();
     let last;
     for(let attempt=0;attempt<3&&!signal.aborted;attempt++){
      try{
       const r=await request(proxy(j.url),{headers:{Range:"bytes="+from+"-"+to},signal},"File segment");
       if(r.status!==206)throw new Error("The server stopped supporting range downloads (HTTP "+r.status+").");
       const bytes=await r.arrayBuffer();
       await pace(bytes.byteLength,started,signal,connections);
       if(bytes.byteLength!==to-from+1)throw new Error("The server returned an incomplete file segment.");
       j.parts[index]=bytes;await dbWrite("parts",{key:j.id+":"+index,jobId:j.id,index,data:bytes});updateLoaded(j);render();last=null;break;
      }catch(e){last=e;if(signal.aborted)break;if(attempt<2)await sleep(500*(attempt+1),signal)}
     }
     if(last&&!signal.aborted)throw last;
    }
   };
   await Promise.all(Array.from({length:Math.min(connections,pending.length)},worker));
   if(signal.aborted)throw new DOMException("Stopped","AbortError");
   const chunks=Array.from({length:count},(_,i)=>j.parts[i]);
   if(chunks.some(x=>!x))throw new Error("Some file segments are missing. Resume or retry the download.");
   j.blob=new Blob(chunks,{type:probe.headers.get("content-type")||"application/octet-stream"});
  }else{
   // Non-range servers are downloaded as one stream; resuming requires restarting that stream.
   const response=probe.status===200?probe:await request(proxy(j.url),{signal},"File download");
   if(!response.ok)throw new Error("Download request failed (HTTP "+response.status+").");
   j.name=fileName(response,j.url);
   const reader=response.body?.getReader();
   if(!reader)j.blob=await response.blob();
   else{
    const chunks=[];j.loaded=0;let first=true;
    while(true){
     const {done,value}=await reader.read();if(done)break;
     if(first){first=false;const sample=new TextDecoder().decode(value.slice(0,1024)).replace(/^\uFEFF/,"").trimStart();if(/^<!doctype\s+html|^<html[\s>]|^<head[\s>]|^<body[\s>]/i.test(sample))throw new Error("The server returned a webpage (HTML), not a file. Use a direct download link.");}
     chunks.push(value);j.loaded+=value.byteLength;sessionBytes+=value.byteLength;await pace(value.byteLength,Date.now(),signal,activeTransfers);render();
    }
    j.blob=new Blob(chunks,{type:response.headers.get("content-type")||"application/octet-stream"});
   }
   j.total=j.blob.size;
  }
  await verifyBlob(j.blob);
  j.loaded=j.blob.size;j.status="Completed";j.completedAt=Date.now();j.speed=0;await dbDeleteParts(j.id).catch(()=>{});await persist(j);save(j);
 }catch(e){
  if(j.cancelRequested)j.status="Cancelled";
  else if(j.pauseRequested||signal.aborted)j.status="Paused";
  else{j.status="Error";j.error=e.message||"Download failed. The source may require sign-in or block automated downloads."}await persist(j);
 }finally{j.controller=null;render()}
}
form.addEventListener("submit",e=>{
 e.preventDefault();const field=$("downloadUrl"),raw=field.value.trim();
 try{const u=new URL(raw);if(!["http:","https:"].includes(u.protocol))throw new Error();add(u.href);field.value=""}
 catch{field.setCustomValidity("Enter a valid HTTP or HTTPS direct file URL.");field.reportValidity();field.setCustomValidity("")}
});
$("clearDone").addEventListener("click",()=>{for(let i=jobs.length-1;i>=0;i--)if(["Completed","Cancelled"].includes(jobs[i].status)){const j=jobs[i];jobs.splice(i,1);dbDelete("jobs",j.id).catch(()=>{});dbDeleteParts(j.id).catch(()=>{})}render()});
let lastTime=performance.now();
setInterval(()=>{
 const now=performance.now(),dt=(now-lastTime)/1000;lastTime=now;
 for(const j of jobs){if(j.status==="Downloading"){const previous=j._previousLoaded??j.loaded;j.speed=dt>0?Math.max(0,(j.loaded-previous)/dt):0;j._previousLoaded=j.loaded}}
 render();
},1000);
$("statusTabs").addEventListener("click",e=>{const b=e.target.closest("[data-filter]");if(!b)return;filterStatus=b.dataset.filter;document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===b));render()});
$("jobSearch").addEventListener("input",render);
["connections","maxActive","bandwidthLimit","autoStart","autoRetry","notifyDone"].forEach(id=>{const el=$(id),key="dws-setting-"+id;if(!el)return;const saved=localStorage.getItem(key);if(saved!==null){if(el.type==="checkbox")el.checked=saved==="true";else el.value=saved}el.addEventListener("change",()=>{localStorage.setItem(key,el.type==="checkbox"?String(el.checked):el.value);if(id==="notifyDone"&&el.checked&&"Notification" in window&&Notification.permission==="default")Notification.requestPermission();pumpQueue()})});
render();restoreJobs().then(()=>{render();pumpQueue()});window.addEventListener("resize",drawDashboard);
})();