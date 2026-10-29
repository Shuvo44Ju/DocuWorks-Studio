/* PaperScan: all image processing and persistence stays in this browser. */
'use strict';
const $=id=>document.getElementById(id);
const state={stream:null,facing:'environment',pages:[],selected:0,docId:null,docName:'Untitled scan',source:null,sourceURL:null,quad:[],drag:-1,opencv:true,magic:true,intensity:65,db:null,modalAction:null};
const screens=['homeScreen','cameraScreen','cropScreen','editorScreen','documentsScreen'];
const DB_NAME='paperscan-db',DB_VERSION=1;
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('show'),2800)}
function showScreen(id){screens.forEach(s=>$(s).classList.toggle('active',s===id));document.querySelectorAll('.navitem').forEach(b=>b.classList.toggle('selected',b.dataset.nav===id));window.scrollTo({top:0,behavior:'smooth'});if(id==='documentsScreen')renderDocuments();if(id==='homeScreen')renderRecent()}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('documents')){const store=db.createObjectStore('documents',{keyPath:'id'});store.createIndex('updated','updated')}};req.onsuccess=()=>{state.db=req.result;resolve(req.result)};req.onerror=()=>reject(req.error)})}
function dbAll(){return new Promise((res,rej)=>{const r=state.db.transaction('documents').objectStore('documents').getAll();r.onsuccess=()=>res(r.result.sort((a,b)=>b.updated-a.updated));r.onerror=()=>rej(r.error)})}
function dbPut(doc){return new Promise((res,rej)=>{const r=state.db.transaction('documents','readwrite').objectStore('documents').put(doc);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function dbDelete(id){return new Promise((res,rej)=>{const r=state.db.transaction('documents','readwrite').objectStore('documents').delete(id);r.onsuccess=()=>res();r.onerror=()=>rej(r.error)})}
function uid(){return 'd'+Date.now().toString(36)+Math.random().toString(36).slice(2,8)}
function imageFromBlob(blob){return new Promise((resolve,reject)=>{const url=URL.createObjectURL(blob),img=new Image();img.onload=()=>{URL.revokeObjectURL(url);resolve(img)};img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read this image.'))};img.src=url})}
function canvasBlob(canvas,type='image/jpeg',quality=.94){return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Could not create image output.')),type,quality))}
function canvasFromImage(img,max=2400){const scale=Math.min(1,max/Math.max(img.naturalWidth||img.width,img.naturalHeight||img.height));const c=document.createElement('canvas');c.width=Math.max(1,Math.round((img.naturalWidth||img.width)*scale));c.height=Math.max(1,Math.round((img.naturalHeight||img.height)*scale));c.getContext('2d',{willReadFrequently:true}).drawImage(img,0,0,c.width,c.height);return c}
async function startCamera(){stopCamera();showScreen('cameraScreen');$('cameraMessage').textContent='Requesting camera permission…';try{if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera access requires HTTPS and a supported browser. Open this site on GitHub Pages.');state.stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:state.facing},width:{ideal:2560},height:{ideal:1440}},audio:false});$('video').srcObject=state.stream;$('video').style.display='block';$('cameraPlaceholder').style.display='none';$('cameraMessage').textContent='Keep the page inside the camera view, then capture.';await $('video').play()}catch(e){$('video').style.display='none';$('cameraPlaceholder').style.display='block';$('cameraMessage').textContent=e.name==='NotAllowedError'?'Camera permission was denied. Allow camera access in your browser settings, or import a photo instead.':(e.message||'Camera unavailable. You can import a photo instead.');toast('Camera unavailable — try importing a photo.')}}function stopCamera(){if(state.stream){state.stream.getTracks().forEach(t=>t.stop());state.stream=null}if($('video'))$('video').srcObject=null}
async function capture(){const v=$('video');if(!state.stream||!v.videoWidth){toast('Camera is not ready yet.');return}const c=document.createElement('canvas');c.width=v.videoWidth;c.height=v.videoHeight;c.getContext('2d').drawImage(v,0,0);await beginCrop(await canvasBlob(c,'image/jpeg',.98),'Camera scan')}
async function importFiles(files){const arr=Array.from(files||[]).filter(f=>f.type.startsWith('image/'));if(!arr.length)return;stopCamera();state.importQueue=arr.slice(1);$('fileInput').value='';try{await beginCrop(arr[0],arr[0].name.replace(/\.[^.]+$/,''))}catch(e){toast(e.message)}}
async function nextQueuedImport(){if(state.importQueue&&state.importQueue.length){const f=state.importQueue.shift();try{await beginCrop(f,f.name.replace(/\.[^.]+$/,''));toast('Crop page '+(state.pages.length+1)+' of your imported images.')}catch(e){toast(e.message)}}}
async function beginCrop(blob,name,queue=false){state.source=blob;state.sourceName=name;state.sourceURL&&URL.revokeObjectURL(state.sourceURL);state.sourceURL=URL.createObjectURL(blob);const img=await imageFromBlob(blob);state.sourceImage=img;state.cropPreview=canvasFromImage(img,1500);$('cropImage').src=state.cropPreview.toDataURL('image/jpeg',.9);showScreen('cropScreen');await new Promise(r=>requestAnimationFrame(r));initQuad();if(queue)state.pendingImports=(state.pendingImports||[]).concat([])}
function cropGeometry(){const img=$('cropImage'),box=$('cropStage'),nw=state.cropPreview.width,nh=state.cropPreview.height,scale=Math.min(box.clientWidth/nw,box.clientHeight/nh),w=nw*scale,h=nh*scale;return{x:(box.clientWidth-w)/2,y:(box.clientHeight-h)/2,w,h,scale}}
function initQuad(){const g=cropGeometry(),m=Math.min(18,g.w*.045,g.h*.045);state.quad=[{x:g.x+m,y:g.y+m},{x:g.x+g.w-m,y:g.y+m},{x:g.x+g.w-m,y:g.y+g.h-m},{x:g.x+m,y:g.y+g.h-m}];drawQuad()}
function drawQuad(){const c=$('cropCanvas'),box=$('cropStage'),dpr=window.devicePixelRatio||1;c.width=Math.round(box.clientWidth*dpr);c.height=Math.round(box.clientHeight*dpr);const ctx=c.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,box.clientWidth,box.clientHeight);if(state.quad.length!==4)return;ctx.fillStyle='rgba(4,10,7,.42)';ctx.beginPath();ctx.rect(0,0,box.clientWidth,box.clientHeight);ctx.moveTo(state.quad[0].x,state.quad[0].y);for(let i=1;i<4;i++)ctx.lineTo(state.quad[i].x,state.quad[i].y);ctx.closePath();ctx.fill('evenodd');ctx.beginPath();ctx.moveTo(state.quad[0].x,state.quad[0].y);for(let i=1;i<4;i++)ctx.lineTo(state.quad[i].x,state.quad[i].y);ctx.closePath();ctx.strokeStyle='#61e2ae';ctx.lineWidth=2.5;ctx.stroke();state.quad.forEach(p=>{ctx.beginPath();ctx.arc(p.x,p.y,13,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=4;ctx.strokeStyle='#159b6c';ctx.stroke()})}
function pointerPos(e){const r=$('cropCanvas').getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
function nearestHandle(p){let best=-1,dist=1e9;state.quad.forEach((q,i)=>{const d=Math.hypot(q.x-p.x,q.y-p.y);if(d<dist){dist=d;best=i}});return dist<64?best:-1}
function moveCorner(p){const g=cropGeometry(),pad=2;p.x=Math.max(g.x+pad,Math.min(g.x+g.w-pad,p.x));p.y=Math.max(g.y+pad,Math.min(g.y+g.h-pad,p.y));state.quad[state.drag]=p;drawQuad()}
$('cropCanvas').addEventListener('pointerdown',e=>{const p=pointerPos(e);state.drag=nearestHandle(p);if(state.drag>=0){e.preventDefault();$('cropCanvas').setPointerCapture(e.pointerId);moveCorner(p)}});
$('cropCanvas').addEventListener('pointermove',e=>{if(state.drag>=0){e.preventDefault();moveCorner(pointerPos(e))}});function endDrag(){state.drag=-1}$('cropCanvas').addEventListener('pointerup',endDrag);$('cropCanvas').addEventListener('pointercancel',endDrag);
window.addEventListener('resize',()=>{if($('cropScreen').classList.contains('active')){const old=state.quad.map(p=>p);initQuad();if(old.length===4)drawQuad()}});
function sortCorners(q){const sums=q.map(p=>p.x+p.y),diff=q.map(p=>p.y-p.x);return[q[sums.indexOf(Math.min(...sums))],q[diff.indexOf(Math.min(...diff))],q[sums.indexOf(Math.max(...sums))],q[diff.indexOf(Math.max(...diff))]]}
function perspectiveWarp(src,quad){
 const g=cropGeometry();
 const corners=sortCorners(quad).map(p=>({x:Math.max(0,Math.min(src.width,((p.x-g.x)/g.scale)*(src.width/state.cropPreview.width))),y:Math.max(0,Math.min(src.height,((p.y-g.y)/g.scale)*(src.height/state.cropPreview.height)))}));
 const [tl,tr,br,bl]=corners;
 const w=Math.min(2600,Math.round(Math.max(Math.hypot(br.x-bl.x,br.y-bl.y),Math.hypot(tr.x-tl.x,tr.y-tl.y))));
 const h=Math.min(3400,Math.round(Math.max(Math.hypot(tr.x-br.x,tr.y-br.y),Math.hypot(tl.x-bl.x,tl.y-bl.y))));
 if(w<20||h<20)throw new Error('The selected area is too small. Move the corners farther apart.');
 // Solve a projective transform from output coordinates to the four source corners.
 const dst=[[0,0],[w-1,0],[w-1,h-1],[0,h-1]],srcPts=[tl,tr,br,bl],A=[];
 for(let i=0;i<4;i++){const u=dst[i][0],v=dst[i][1],x=srcPts[i].x,y=srcPts[i].y;A.push([u,v,1,0,0,0,-x*u,-x*v,x]);A.push([0,0,0,u,v,1,-y*u,-y*v,y])}
 for(let col=0;col<8;col++){let pivot=col;for(let row=col+1;row<8;row++)if(Math.abs(A[row][col])>Math.abs(A[pivot][col]))pivot=row;[A[col],A[pivot]]=[A[pivot],A[col]];const div=A[col][col];if(Math.abs(div)<1e-10)throw new Error('Could not correct these corners. Adjust the page edges and try again.');for(let j=col;j<9;j++)A[col][j]/=div;for(let row=0;row<8;row++){if(row===col)continue;const f=A[row][col];for(let j=col;j<9;j++)A[row][j]-=f*A[col][j]}}
 const m=A.map(row=>row[8]),input=document.createElement('canvas');input.width=src.width;input.height=src.height;const ictx=input.getContext('2d',{willReadFrequently:true});ictx.drawImage(src,0,0);const pixels=ictx.getImageData(0,0,src.width,src.height),out=document.createElement('canvas');out.width=w;out.height=h;const octx=out.getContext('2d',{willReadFrequently:true}),result=octx.createImageData(w,h),d=pixels.data,o=result.data;
 for(let y=0;y<h;y++){for(let x=0;x<w;x++){const z=m[6]*x+m[7]*y+1,fx=Math.max(0,Math.min(src.width-1,(m[0]*x+m[1]*y+m[2])/z)),fy=Math.max(0,Math.min(src.height-1,(m[3]*x+m[4]*y+m[5])/z)),x0=Math.floor(fx),y0=Math.floor(fy),x1=Math.min(src.width-1,x0+1),y1=Math.min(src.height-1,y0+1),dx=fx-x0,dy=fy-y0,i00=(y0*src.width+x0)*4,i10=(y0*src.width+x1)*4,i01=(y1*src.width+x0)*4,i11=(y1*src.width+x1)*4,di=(y*w+x)*4;for(let k=0;k<3;k++){const top=d[i00+k]*(1-dx)+d[i10+k]*dx,bottom=d[i01+k]*(1-dx)+d[i11+k]*dx;o[di+k]=Math.round(top*(1-dy)+bottom*dy)}o[di+3]=255}}
 octx.putImageData(result,0,0);return out;
}
function magicCanvas(source,intensity=100){
 // OpenCV pipeline: background estimation -> shadow flattening -> levels -> gamma/saturation -> sharpening.
 // renderPage() already supplies a downscaled canvas for the live preview; exports call this on their export canvas.
 const amount=Math.max(0,Math.min(1,Number(intensity)/100));
 const output=document.createElement('canvas');output.width=source.width;output.height=source.height;
 const ctx=output.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0);
 if(amount<=0)return output;
 const cvx=window.cv;
 if(!cvx||!cvx.Mat||!cvx.imread||!cvx.imshow){
   // Safe fallback if OpenCV.js is unavailable; keep the app usable rather than returning a blank page.
   const image=ctx.getImageData(0,0,output.width,output.height),d=image.data;
   const w=output.width,h=output.height;
   const bg=document.createElement('canvas');bg.width=Math.max(1,Math.round(w/4));bg.height=Math.max(1,Math.round(h/4));
   const bx=bg.getContext('2d',{willReadFrequently:true});bx.drawImage(source,0,0,bg.width,bg.height);
   const blur=document.createElement('canvas');blur.width=w;blur.height=h;const bl=blur.getContext('2d',{willReadFrequently:true});
   bl.filter='blur(12px)';bl.drawImage(bg,0,0,w,h);bl.filter='none';
   const b=bl.getImageData(0,0,w,h).data;
   for(let i=0;i<d.length;i+=4){
     for(let k=0;k<3;k++){
       const ratio=Math.min(2.4,d[i+k]/Math.max(35,b[i+k]))*255;
       let v=Math.max(0,Math.min(255,(ratio-90)*255/125));
       v=255*Math.pow(v/255,0.9);
       d[i+k]=Math.round(d[i+k]*(1-amount)+v*amount);
     }
   }
   ctx.putImageData(image,0,0);return output;
 }
 const mats=[];
 const keep=m=>{mats.push(m);return m};
 try{
   const src=keep(cvx.imread(source)); // CV_8UC4 (RGBA)
   const channels=keep(new cvx.MatVector());cvx.split(src,channels);
   const correctedChannels=keep(new cvx.MatVector());
   const kernel=keep(cvx.getStructuringElement(cvx.MORPH_RECT,new cvx.Size(15,15)));
   const originalChannels=[];
   for(let ch=0;ch<4;ch++){
     const channel=keep(channels.get(ch));
     if(ch===3){correctedChannels.push_back(channel);continue}
     originalChannels.push(channel);
     const small=keep(new cvx.Mat()),dilated=keep(new cvx.Mat()),median=keep(new cvx.Mat()),background=keep(new cvx.Mat());
     cvx.resize(channel,small,new cvx.Size(Math.max(1,Math.round(src.cols/4)),Math.max(1,Math.round(src.rows/4))),0,0,cvx.INTER_AREA);
     cvx.dilate(small,dilated,kernel,new cvx.Point(-1,-1),1,cvx.BORDER_REPLICATE,new cvx.Scalar());
     cvx.medianBlur(dilated,median,21);
     cvx.resize(median,background,new cvx.Size(src.cols,src.rows),0,0,cvx.INTER_CUBIC);
     const flat=keep(new cvx.Mat());
     cvx.divide(channel,background,flat,255);
     // Required levels stretch: black=90, white=215.
     const fd=flat.data;
     for(let i=0;i<fd.length;i++)fd[i]=Math.max(0,Math.min(255,Math.round((fd[i]-90)*255/125)));
     // Gamma 0.9.
     for(let i=0;i<fd.length;i++)fd[i]=Math.max(0,Math.min(255,Math.round(255*Math.pow(fd[i]/255,1/0.9))));
     correctedChannels.push_back(flat);
   }
   const leveled=keep(new cvx.Mat());cvx.merge(correctedChannels,leveled);
   // Boost saturation in HSV while retaining the corrected luminance and colored marks.
   const rgb=keep(new cvx.Mat()),hsv=keep(new cvx.Mat());
   cvx.cvtColor(leveled,rgb,cvx.COLOR_RGBA2RGB);
   cvx.cvtColor(rgb,hsv,cvx.COLOR_RGB2HSV);
   const hsvChannels=keep(new cvx.MatVector());cvx.split(hsv,hsvChannels);
   const sat=keep(hsvChannels.get(1));
   for(let i=0;i<sat.data.length;i++)sat.data[i]=Math.min(255,Math.round(sat.data[i]*1.25));
   cvx.merge(hsvChannels,hsv);
   const vividRGB=keep(new cvx.Mat());cvx.cvtColor(hsv,vividRGB,cvx.COLOR_HSV2RGB);
   const vividRGBA=keep(new cvx.Mat());cvx.cvtColor(vividRGB,vividRGBA,cvx.COLOR_RGB2RGBA);
   // Light unsharp mask: sigma=1.0, amount=0.6.
   const soft=keep(new cvx.Mat()),sharp=keep(new cvx.Mat());
   cvx.GaussianBlur(vividRGBA,soft,new cvx.Size(0,0),1.0,1.0,cvx.BORDER_DEFAULT);
   cvx.addWeighted(vividRGBA,1.6,soft,-0.6,0,sharp);
   // Blend original and processed; at 100% the processed result is used without original-photo bleed-through.
   const blended=keep(new cvx.Mat());
   cvx.addWeighted(src,1-amount,sharp,amount,0,blended);
   cvx.imshow(output,blended);
   return output;
 }catch(err){
   console.error('Magic Color OpenCV processing failed:',err);
   throw err;
 }finally{
   for(let i=mats.length-1;i>=0;i--){try{mats[i].delete()}catch(_){}}
 }
}
function renderPage(page){if(!page)return;$('pagePreview').style.display='block';$('noPage').style.display='none';$('editorBusy').classList.add('show');const img=new Image();img.onload=()=>{try{let c=canvasFromImage(img,2400);if(state.magic)c=magicCanvas(c,state.intensity);$('pagePreview').src=c.toDataURL('image/jpeg',.92)}catch(e){$('pagePreview').src=page.dataURL}finally{$('editorBusy').classList.remove('show')}};img.onerror=()=>{$('editorBusy').classList.remove('show');$('pagePreview').src=page.dataURL};img.src=page.dataURL;$('magicToggle').setAttribute('aria-pressed',String(state.magic));$('intensity').value=state.intensity;$('intensityValue').value=state.intensity+'%'}
async function acceptCrop(){try{const c=perspectiveWarp(state.sourceImage,state.quad);const blob=await canvasBlob(c,'image/jpeg',.97);const dataURL=await blobToDataURL(blob);const page={id:uid(),name:state.sourceName||'Scanned page',blob,dataURL,rotation:0};if(!state.pages.length){state.pages.push(page);state.selected=0;state.docId=uid();state.docName='Untitled scan'}else{state.pages.push(page);state.selected=state.pages.length-1}URL.revokeObjectURL(state.sourceURL);state.sourceURL=null;if(state.importQueue&&state.importQueue.length){await nextQueuedImport();return}showEditor();toast('Perspective corrected. Scan ready.')}catch(e){toast(e.message||'Could not correct this page.')} }
function blobToDataURL(blob){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(blob)})}
function showEditor(){stopCamera();showScreen('editorScreen');$('editorTitle').textContent=state.docName;renderPage(state.pages[state.selected]);renderPagesStrip();$('pageCount').textContent=state.pages.length+' page'+(state.pages.length===1?'':'s')}
function renderPagesStrip(){const el=$('pagesStrip');el.innerHTML='';state.pages.forEach((p,i)=>{const b=document.createElement('button');b.className='page-thumb'+(i===state.selected?' active':'');b.draggable=true;b.dataset.index=i;const im=document.createElement('img');im.src=p.dataURL;im.alt='Page '+(i+1);const del=document.createElement('button');del.className='deletepage';del.textContent='×';del.title='Delete page';del.onclick=e=>{e.stopPropagation();if(!confirm('Delete page '+(i+1)+'?'))return;state.pages.splice(i,1);state.selected=Math.max(0,Math.min(state.selected,state.pages.length-1));showEditor()};const label=document.createElement('small');label.textContent='Page '+(i+1);b.append(im,label,del);b.onclick=()=>{state.selected=i;renderPage(state.pages[i]);renderPagesStrip()};b.ondragstart=e=>e.dataTransfer.setData('text/plain',String(i));b.ondragover=e=>e.preventDefault();b.ondrop=e=>{e.preventDefault();const from=Number(e.dataTransfer.getData('text/plain')),to=i;if(from===to||!Number.isInteger(from))return;const [p]=state.pages.splice(from,1);state.pages.splice(to,0,p);state.selected=to;renderPagesStrip();renderPage(p)};el.append(b)});$('pageCount').textContent=state.pages.length+' page'+(state.pages.length===1?'':'s');if(!state.pages.length){$('pagePreview').style.display='none';$('noPage').style.display='block'}}
function rotatedCanvas(page){return imageFromBlob(page.blob).then(img=>{const r=((page.rotation||0)%360+360)%360,c=document.createElement('canvas'),sw=img.naturalWidth,sh=img.naturalHeight;c.width=r%180?sh:sw;c.height=r%180?sw:sh;const x=c.getContext('2d');x.translate(c.width/2,c.height/2);x.rotate(r*Math.PI/180);x.drawImage(img,-sw/2,-sh/2);return c})}
async function rotateSelected(deg){const p=state.pages[state.selected];if(!p)return;try{const c=await rotatedCanvas(p);const out=document.createElement('canvas');out.width=c.height;out.height=c.width;const x=out.getContext('2d');x.translate(out.width/2,out.height/2);x.rotate(deg*Math.PI/180);x.drawImage(c,-c.width/2,-c.height/2);p.blob=await canvasBlob(out,'image/jpeg',.97);p.dataURL=await blobToDataURL(p.blob);p.rotation=0;renderPage(p);renderPagesStrip()}catch(e){toast('Could not rotate this page.')}}
async function exportCanvas(page,type){const img=await imageFromBlob(page.blob);let c=canvasFromImage(img,3000);if(state.magic)c=magicCanvas(c,state.intensity);return c}
async function exportSingle(type){const p=state.pages[state.selected];if(!p)return toast('Add a page first.');try{const c=await exportCanvas(p,type);const blob=await canvasBlob(c,type==='image/png'?'image/png':'image/jpeg',.95);download(blob,(p.name||'scan')+(type==='image/png'?'.png':'.jpg'))}catch(e){toast('Export failed: '+e.message)}}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500)}
async function exportPDF(){if(!state.pages.length)return toast('Add a page first.');if(!window.jspdf?.jsPDF)return toast('PDF library is still loading. Check your internet and retry.');try{toast('Preparing PDF…');const {jsPDF}=window.jspdf,pdf=new jsPDF({orientation:'p',unit:'mm',format:'a4'}),mw=210,mh=297,margin=10;for(let i=0;i<state.pages.length;i++){if(i)pdf.addPage();const c=await exportCanvas(state.pages[i],'image/jpeg'),url=c.toDataURL('image/jpeg',.94),ratio=Math.min((mw-margin*2)/c.width,(mh-margin*2)/c.height),w=c.width*ratio,h=c.height*ratio;pdf.addImage(url,'JPEG',(mw-w)/2,(mh-h)/2,w,h,undefined,'FAST')}pdf.save((state.docName||'PaperScan').replace(/[\\/:*?"<>|]+/g,'_')+'.pdf')}catch(e){toast('PDF export failed: '+e.message)}}
async function saveDocument(){if(!state.pages.length)return toast('Add a page before saving.');try{await dbPut({id:state.docId||uid(),name:state.docName||'Untitled scan',updated:Date.now(),pages:state.pages.map(p=>({id:p.id,name:p.name,blob:p.blob,dataURL:p.dataURL,rotation:p.rotation||0}))});toast('Saved on this device.');renderRecent()}catch(e){toast('Could not save. Browser storage may be full.')} }
function openDoc(doc){state.docId=doc.id;state.docName=doc.name;state.pages=doc.pages||[];state.selected=0;showEditor()}
async function renderDocuments(){const el=$('documentsList');try{const docs=await dbAll();el.innerHTML='';if(!docs.length){el.innerHTML='<div class="empty">No saved documents yet. Scan a page and tap “Save to My Documents”.</div>';return}docs.forEach(doc=>el.append(makeDocRow(doc)))}catch(e){el.innerHTML='<div class="empty">Could not load local documents.</div>'}}
async function renderRecent(){const el=$('recentDocs');if(!state.db)return;try{const docs=(await dbAll()).slice(0,3);el.innerHTML='';if(!docs.length){el.innerHTML='<div class="empty">Your saved documents will appear here.</div>';return}docs.forEach(d=>el.append(makeDocRow(d)))}catch(e){}}
function makeDocRow(doc){const row=document.createElement('div');row.className='docrow';const im=document.createElement('img');im.className='docthumb';im.alt='Document preview';im.src=doc.pages?.[0]?.dataURL||'';const info=document.createElement('div');info.className='docinfo';const title=document.createElement('strong');title.textContent=doc.name;const sub=document.createElement('small');sub.textContent=(doc.pages?.length||0)+' pages · '+new Date(doc.updated).toLocaleDateString();info.append(title,sub);const actions=document.createElement('div');actions.className='docactions';const open=document.createElement('button');open.textContent='Open';open.onclick=()=>openDoc(doc);const rename=document.createElement('button');rename.textContent='✎';rename.title='Rename';rename.onclick=()=>askText('Rename document',doc.name,async value=>{if(!value.trim())return;doc.name=value.trim();doc.updated=Date.now();await dbPut(doc);renderDocuments();renderRecent()});const del=document.createElement('button');del.textContent='×';del.title='Delete';del.onclick=async()=>{if(confirm('Permanently delete “'+doc.name+'” from this browser?')){await dbDelete(doc.id);renderDocuments();renderRecent();toast('Document deleted.')}};actions.append(open,rename,del);row.append(im,info,actions);return row}
function askText(title,value,action){$('modalTitle').textContent=title;$('modalInput').value=value;$('modal').hidden=false;state.modalAction=action;$('modalInput').focus()}
$('modalCancel').onclick=()=>{$('modal').hidden=true;state.modalAction=null};$('modalOk').onclick=async()=>{const action=state.modalAction;$('modal').hidden=true;state.modalAction=null;if(action)await action($('modalInput').value)};
if($('cameraStart')) $('cameraStart').onclick=startCamera;$('navScan').onclick=startCamera;$('captureBtn').onclick=capture;$('switchCamera').onclick=async()=>{state.facing=state.facing==='environment'?'user':'environment';await startCamera()};$('uploadBtn').onclick=()=>$('fileInput').click();if($('cameraUpload'))$('cameraUpload').onclick=()=>$('fileInput').click();$('fileInput').onchange=e=>importFiles(e.target.files);
const importDrop=$('importDrop');if(importDrop){importDrop.onclick=e=>{if(e.target.closest('button'))return;$('fileInput').click()};importDrop.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();$('fileInput').click()}};['dragenter','dragover'].forEach(type=>importDrop.addEventListener(type,e=>{e.preventDefault();e.stopPropagation();importDrop.classList.add('dragover')}));['dragleave','drop'].forEach(type=>importDrop.addEventListener(type,e=>{e.preventDefault();e.stopPropagation();importDrop.classList.remove('dragover')}));importDrop.addEventListener('drop',e=>{const files=[...(e.dataTransfer?.files||[])].filter(f=>f.type.startsWith('image/'));if(files.length)importFiles(files);else toast('Drop image files such as JPG or PNG.')})}
$('cropCancel').onclick=()=>{URL.revokeObjectURL(state.sourceURL||'');state.sourceURL=null;showScreen('homeScreen')};$('cropDone').onclick=acceptCrop;$('addPageBtn').onclick=()=>$('fileInput').click();$('retakeBtn').onclick=()=>{const p=state.pages[state.selected];if(p)beginCrop(p.blob,p.name)};
$('magicToggle').onclick=()=>{state.magic=!state.magic;$('magicToggle').setAttribute('aria-pressed',String(state.magic));renderPage(state.pages[state.selected])};$('intensity').oninput=e=>{state.intensity=Number(e.target.value);$('intensityValue').value=state.intensity+'%';renderPage(state.pages[state.selected])};$('rotateLeft').onclick=()=>rotateSelected(-90);$('rotateRight').onclick=()=>rotateSelected(90);$('pdfBtn').onclick=exportPDF;$('jpgBtn').onclick=()=>exportSingle('image/jpeg');$('pngBtn').onclick=()=>exportSingle('image/png');$('saveDocBtn').onclick=saveDocument;$('renameDocBtn').onclick=()=>askText('Rename document',state.docName,async v=>{if(!v.trim())return;state.docName=v.trim();$('editorTitle').textContent=state.docName;await saveDocument()});if($('docsBtn'))$('docsBtn').onclick=()=>showScreen('documentsScreen');if($('allDocsBtn'))$('allDocsBtn').onclick=()=>showScreen('documentsScreen');document.querySelectorAll('[data-home]').forEach(b=>b.onclick=()=>{stopCamera();showScreen('homeScreen')});document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>b.dataset.nav==='cameraScreen'?startCamera():showScreen(b.dataset.nav));
$('themeBtn').onclick=()=>{document.body.classList.toggle('dark');const dark=document.body.classList.contains('dark');$('themeBtn').textContent=dark?'☀':'☾';localStorage.setItem('paperscan-theme',dark?'dark':'light')};
function waitForCV(){state.opencv=true;const loader=$('libraryLoader');if(loader){loader.classList.add('hidden');setTimeout(()=>loader.remove(),350)}}
document.addEventListener('DOMContentLoaded',async()=>{try{if(localStorage.getItem('paperscan-theme')==='dark'){document.body.classList.add('dark');$('themeBtn').textContent='☀'}await openDB()}catch(e){toast('Local storage is unavailable. Saved documents may not persist.')}waitForCV();if('serviceWorker'in navigator){navigator.serviceWorker.register('./service-worker.js').catch(()=>{})}});
window.addEventListener('beforeunload',stopCamera);