// Google sign-in, Drive folders, the lists from the computer, and uploading entries.
'use strict';
// ---------- Google: sign in by redirect (works in Safari; the token lasts about an hour) ----------
// Shopping-only mode (someone else's phone) needs to see the folder shared with them, so it asks for Drive access;
// the full notebook keeps the narrower "files this app made" access.
let MODE='full',MYNAME='';
const SCOPE_FULL='https://www.googleapis.com/auth/drive.file',SCOPE_SHOP='https://www.googleapis.com/auth/drive';
// Always the folder address (".../" not ".../index.html"), so it matches the one redirect URI saved in Google Cloud.
const appUrl=()=>location.origin+location.pathname.replace(/index\.html$/,'');
async function signIn(next){const cid=await kvGet('client_id');if(!cid){openSettings();return toast('حط رقم Google Client ID بالإعدادات أول',true)}
  const state=crypto.getRandomValues(new Uint32Array(2)).join('-');await kvSet('oauth',{state,next});
  location.href='https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:cid,redirect_uri:appUrl(),response_type:'token',scope:MODE==='shop'?SCOPE_SHOP:SCOPE_FULL,include_granted_scopes:'true',state})}
async function takeRedirect(){if(!location.hash.includes('access_token')&&!location.hash.includes('error='))return null;
  const h=new URLSearchParams(location.hash.slice(1));history.replaceState(null,'',appUrl());const saved=await kvGet('oauth');await kvDel('oauth');
  if(h.get('error'))return toast('ما تم الربط مع Google: '+h.get('error'),true),null;
  if(!saved||saved.state!==h.get('state'))return toast('رد Google غير متوقع، جرّب مرة ثانية',true),null;
  await kvSet('token',{value:h.get('access_token'),exp:Date.now()+(Number(h.get('expires_in')||3000)-120)*1000});return saved.next||null}
async function validToken(){const t=await kvGet('token');return t&&t.exp>Date.now()?t.value:null}
async function token(next){const t=await kvGet('token');if(t&&t.exp>Date.now())return t.value;await signIn(next);return null}
async function gapi(tok,url,opt={}){const r=await fetch(url,{...opt,headers:{Authorization:'Bearer '+tok,...(opt.headers||{})}});
  if(r.status===401){await kvDel('token');throw Object.assign(new Error('انتهت جلسة Google'),{reauth:true})}
  if(!r.ok)throw new Error('Drive: '+r.status+' '+(await r.text()).slice(0,160));return r}
const q=s=>s.replace(/\\/g,'\\\\').replace(/'/g,"\\'");
async function findFolder(tok,name,parent){const query=`name = '${q(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`+(parent?` and '${parent}' in parents`:'');
  const r=await gapi(tok,'https://www.googleapis.com/drive/v3/files?'+new URLSearchParams({q:query,fields:'files(id,name)',pageSize:'10'}));return (await r.json()).files?.[0]?.id||null}
async function inboxFolder(tok){const root=await findFolder(tok,'Home Monthly System');const inbox=root&&await findFolder(tok,'Phone Inbox',root);
  if(!inbox)throw new Error('ما لقيت مجلد الآيفون على Drive. من البرنامج عالكمبيوتر افتح "من الآيفون" واضغط "تحديث" مرة أول.');return inbox}

// ---------- lists from the computer (encrypted catalog) ----------
let CAT=null;
// silent: the automatic run — no Google page, no password prompt, no messages unless something arrived.
async function refreshCatalog(silent=false){
  if(!navigator.onLine)return silent?null:toast('بدك إنترنت لتحديث القوائم',true);
  if(silent&&!(await kvGet('key')))return;
  const tok=silent?await validToken():await token('refresh');if(!tok)return;
  try{
    const inbox=await inboxFolder(tok);
    const r=await gapi(tok,'https://www.googleapis.com/drive/v3/files?'+new URLSearchParams({q:`name = 'catalog-for-phone.json' and '${inbox}' in parents and trashed = false`,fields:'files(id,modifiedTime)',orderBy:'modifiedTime desc',pageSize:'1'}));
    const f=(await r.json()).files?.[0];if(!f)throw new Error('لسا ما في قوائم. اضغط "تحديث" من البرنامج عالكمبيوتر.');
    const wrap=await (await gapi(tok,`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`)).json();
    let key=await kvGet('key');
    if(silent&&(!key||key.salt!==wrap.salt))return;
    if(!key||key.salt!==wrap.salt){const pass=prompt('اكتب كلمة تشفير المزامنة (نفس اللي بالبرنامج عالكمبيوتر):');if(!pass)return;
      toast('بجهّز المفتاح… لحظة');key={salt:wrap.salt,raw:await deriveRaw(pass,wrap.salt)}}
    let data;try{data=JSON.parse(new TextDecoder().decode(await decryptBytes(key.raw,b64d(wrap.payload))))}
    catch{await kvDel('key');throw new Error('كلمة التشفير غلط، جرّب مرة ثانية')}
    // Computer off: its catalog predates the phone's direct edits, so read the Drive copy instead.
    try{const fresh=await Direct.lists(tok,key,data);if(fresh)data=fresh}catch(err){if(err.reauth)throw err;console.warn('lists',err)}
    // Never go back to an older list than the one already on the phone.
    if(CAT&&Date.parse(CAT.generated_at)>Date.parse(data.generated_at))data=CAT;
    const changed=!CAT||CAT.generated_at!==data.generated_at;
    await kvSet('key',key);await kvSet('catalog',data);CAT=data;await pruneShopping();await dropDeleted();renderHome();if(!silent||changed)toast('تم تحديث القوائم ✓');
  }catch(e){if(e.reauth){if(!silent)signIn('refresh');else renderHome()}else if(!silent)toast(e.message,true)}
}

// ---------- upload: one encrypted file per entry; the computer decides what to add ----------
const blobB64=b=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=()=>rej(r.error);r.readAsDataURL(b)});
let uploading=false;
async function upload(silent=false){
  if(uploading)return;
  const pending=(await allEntries()).filter(e=>!e.uploaded_at&&!e.rejected);
  if(!pending.length)return silent?null:toast('ما في شي جديد للرفع');
  if(!navigator.onLine)return silent?null:toast('بدك إنترنت للرفع',true);
  const key=await kvGet('key');if(!key)return silent?null:toast('اضغط "تحديث القوائم" أول عشان تدخل كلمة التشفير',true);
  const tok=silent?await validToken():await token('upload');if(!tok)return renderHome();
  uploading=true;const btn=$('#uploadBtn');btn.disabled=true;let done=0,direct=0,list=pending;
  try{
    // Computer off: change the Drive copy of the database directly. Anything it refuses goes the usual way.
    try{const res=await Direct.run(tok,pending,key);
      if(res){const now=new Date().toISOString();
        for(const e of pending)if(res.applied.includes(e.id)){e.uploaded_at=now;e.direct='applied';e.photo_count=(e.photos||[]).length;e.photos=[];await putEntry(e);direct++}
        if(res.catalog){CAT=res.catalog;await kvSet('catalog',CAT)}
        // A refusal here (closed month, paid above actual, changed meanwhile) would be refused on the computer too:
        // it stays on the phone with the reason instead of waiting there for nothing.
        for(const e of pending)if(res.failed[e.id]){e.rejected=res.failed[e.id];await putEntry(e)}
        list=pending.filter(e=>!res.applied.includes(e.id)&&!res.failed[e.id]);
        if(direct)toast(`انحفظ بالبرنامج مباشرة ✓ (${direct})`+(list.length?` · ${list.length} رح يستنوا الكمبيوتر`:''));
        for(const [id,why] of Object.entries(res.failed))console.warn('direct',id,why)}
    }catch(err){if(err.reauth)throw err;toast('ما قدرت أعدّل مباشرة ('+err.message+')، رح يوصل عن طريق الكمبيوتر',true)}
    const inbox=list.length?await inboxFolder(tok):null;
    for(const e of list){
      btn.textContent=`⬆️ برفع ${done+1} من ${list.length}…`;
      const photos=[];for(const p of e.photos||[])photos.push({name:p.name,type:p.blob.type||'image/jpeg',data:await blobB64(p.blob)});
      const body={id:e.id,type:e.type,created_at:e.created_at,period_id:e.period_id,period_label:e.period_label,device:'iPhone',data:e.type==='shopping'?{ops:Object.values(e.data.ops||{})}:e.data,photos};
      const payload=b64e(await encryptBytes(key.raw,new TextEncoder().encode(JSON.stringify(body))));
      const meta={name:`phone-${e.id}.json`,parents:[inbox],mimeType:'application/json'};
      const boundary='hm'+Math.random().toString(36).slice(2);
      const multipart=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,
        JSON.stringify({format:'home-monthly-phone-entry',id:e.id,payload}),`\r\n--${boundary}--`]);
      await gapi(tok,'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body:multipart});
      // Keep a light copy for the list; the photos are on Drive now.
      e.uploaded_at=new Date().toISOString();e.photo_count=(e.photos||[]).length;e.photos=[];await putEntry(e);done++;
    }
    if(done)toast(`تم رفع ${done} ✓ الكمبيوتر بيضيفهم أول ما يشتغل`);
  }catch(err){if(err.reauth&&silent){if(done)toast(`تم رفع ${done} ✓`)}else{toast((done?`انرفع ${done}. `:'')+err.message,true);if(err.reauth)signIn('upload')}}
  finally{uploading=false;btn.disabled=false;renderHome()}
}
// Right after saving something: upload now; if the Google sign-in has run out, sign in again straight away
// (the person just tapped Save, so going to Google is expected), and the upload continues on return.
async function syncNow(){if(!navigator.onLine)return toast('انحفظ عالآيفون، وبيترفع لحاله أول ما يرجع النت');
  if(await validToken())return autoSync(true);if(!(await kvGet('key')))return autoSync(true);await signIn('upload')}
// Automatic: upload, then fresh lists — when the app opens, when the internet comes back, and right after saving.
let lastAuto=0;
async function autoSync(force=false){
  if(!navigator.onLine||(!force&&Date.now()-lastAuto<20000))return;lastAuto=Date.now();
  if(MODE==='shop')return withBusy(null,()=>sharedSync());
  await withBusy(null,async()=>{await upload(true);await refreshCatalog(true)});
}

