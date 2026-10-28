// Small helpers, IndexedDB storage and the AES-GCM encryption shared with the computer.
'use strict';
// ---------- small helpers ----------
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const money=v=>`${Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:3})} JOD`;
const dmy=s=>{const p=String(s||'').slice(0,10).split('-');return p.length===3?`${p[2]}/${p[1]}/${p[0]}`:'—'};
function toast(msg,err=false){const t=$('#toast');t.textContent=msg;t.className='toast show'+(err?' err':'');clearTimeout(toast.t);toast.t=setTimeout(()=>t.className='toast',3200)}
const TYPES={expense:{icon:'🧾',name:'مصروف',cls:'a-exp'},electricity:{icon:'⚡',name:'قراءة كهرباء',cls:'a-el'},water:{icon:'💧',name:'قراءة مياه',cls:'a-wa'},payment:{icon:'💳',name:'دفعة قسط',cls:'a-pay'},edit:{icon:'✏️',name:'تعديل',cls:'a-view'},gas:{icon:'🔥',name:'تبديل جرة',cls:'a-gas'},delete:{icon:'🗑',name:'حذف',cls:'a-view'}};

// ---------- IndexedDB: entries (with photo blobs) and settings ----------
const dbp=new Promise((res,rej)=>{const r=indexedDB.open('home-monthly-phone',1);
  r.onupgradeneeded=()=>{r.result.createObjectStore('entries',{keyPath:'id'});r.result.createObjectStore('kv')};
  r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
async function tx(store,mode,fn){const db=await dbp;return new Promise((res,rej)=>{const t=db.transaction(store,mode);const s=t.objectStore(store);const out=fn(s);t.oncomplete=()=>res(out&&'result' in out?out.result:out);t.onerror=()=>rej(t.error)})}
const kvGet=k=>tx('kv','readonly',s=>s.get(k));
const kvSet=(k,v)=>tx('kv','readwrite',s=>s.put(v,k));
const kvDel=k=>tx('kv','readwrite',s=>s.delete(k));
const allEntries=()=>tx('entries','readonly',s=>s.getAll());
const putEntry=e=>tx('entries','readwrite',s=>s.put(e));
const delEntry=id=>tx('entries','readwrite',s=>s.delete(id));
// Ask Safari to keep this app's data even when the phone is short on space.
navigator.storage?.persist?.().catch(()=>{});

// ---------- encryption: the same format as the computer (PBKDF2-SHA256 600k + AES-GCM) ----------
const HEADER=new TextEncoder().encode('HOME_MONTHLY_AESGCM_V1:');
const b64e=bytes=>{let s='';const b=new Uint8Array(bytes);for(let i=0;i<b.length;i+=0x8000)s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));return btoa(s)};
const b64d=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
async function deriveRaw(pass,saltB64){const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(pass),'PBKDF2',false,['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:b64d(saltB64),iterations:600000},base,256))}
const aesKey=raw=>crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
async function encryptBytes(raw,data){const iv=crypto.getRandomValues(new Uint8Array(12));
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:HEADER},await aesKey(raw),data));
  const out=new Uint8Array(HEADER.length+12+ct.length);out.set(HEADER);out.set(iv,HEADER.length);out.set(ct,HEADER.length+12);return out}
async function decryptBytes(raw,data){const h=HEADER.length;if(new TextDecoder().decode(data.slice(0,h))!=='HOME_MONTHLY_AESGCM_V1:')throw new Error('format');
  return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:data.slice(h,h+12),additionalData:HEADER},await aesKey(raw),data.slice(h+12)))}

