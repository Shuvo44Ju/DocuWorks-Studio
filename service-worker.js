const CACHE_NAME='ink-saver-paperscan-v7';
const CORE=['./','./index.html','./scan.html','./style.css','./app.js','./manifest.json','./icon.svg'];
self.addEventListener('install',event=>{event.waitUntil((async()=>{const cache=await caches.open(CACHE_NAME);try{await cache.addAll(CORE)}catch(e){}await self.skipWaiting()})())});
self.addEventListener('activate',event=>{event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('ink-saver-paperscan-')&&k!==CACHE_NAME).map(k=>caches.delete(k)));await self.clients.claim()})())});
self.addEventListener('fetch',event=>{
 const req=event.request;if(req.method!=='GET')return;
 const url=new URL(req.url);
 if(url.origin!==self.location.origin)return;
 // Network-first for site files so GitHub Pages updates appear instead of stale cached HTML/JS/CSS.
 event.respondWith((async()=>{
   try{
     const fresh=await fetch(req,{cache:'no-store'});
     if(fresh&&fresh.ok){const cache=await caches.open(CACHE_NAME);cache.put(req,fresh.clone())}
     return fresh;
   }catch(e){
     const cached=await caches.match(req);
     if(cached)return cached;
     if(req.mode==='navigate')return caches.match('./index.html');
     throw e;
   }
 })());
});