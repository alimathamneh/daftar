// Phone notebook: the app shell is cached so it opens without internet. Google traffic is never cached.
const CACHE='home-phone-v6';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon-180.png','./icon-192.png','./icon-512.png',
  './fonts/ibm-plex-sans-arabic-arabic-400-normal.woff2','./fonts/ibm-plex-sans-arabic-arabic-600-normal.woff2',
  './fonts/ibm-plex-sans-arabic-latin-400-normal.woff2','./fonts/ibm-plex-sans-arabic-latin-600-normal.woff2'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  // Network first so an update shows up when online; the cache keeps it working offline.
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r})
    .catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('./index.html'))));
});
