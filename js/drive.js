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

// ---------- lists: read straight from the database copy on Drive ----------
let CAT=null;
// The key comes from the sync password and the salt of the Drive copy; asked once, then kept on the phone.
async function driveKey(tok,silent){
  const salt=await Direct.salt(tok);let key=await kvGet('key');
  if(key&&key.salt===salt)return key;if(silent)return null;
  const pass=prompt('اكتب كلمة تشفير المزامنة (نفس اللي بالبرنامج عالكمبيوتر):');if(!pass)return null;
  toast('بجهّز المفتاح… لحظة');return {salt,raw:await deriveRaw(pass,salt)}}
// silent: the automatic run — no Google page, no password prompt, no messages unless something arrived.
async function refreshCatalog(silent=false){
  if(!navigator.onLine)return silent?null:toast('بدك إنترنت لتحديث القوائم',true);
  if(silent&&!(await kvGet('key')))return;
  const tok=silent?await validToken():await token('refresh');if(!tok)return;
  try{
    const key=await driveKey(tok,silent);if(!key)return;
    let data;try{data=await Direct.lists(tok,key,CAT)}catch(err){if(err.badKey)await kvDel('key');throw err}
    const changed=!CAT||JSON.stringify({...CAT,generated_at:0})!==JSON.stringify({...data,generated_at:0});
    await kvSet('key',key);await kvSet('catalog',data);CAT=data;await pruneShopping();renderHome();if(!silent||changed)toast('تم تحديث القوائم ✓');
  }catch(e){if(e.reauth){if(!silent)signIn('refresh');else renderHome()}else if(!silent)toast(e.message,true)}
}

// ---------- saving: entries go straight into the database copy on Drive ----------
let uploading=false;
async function upload(silent=false){
  if(uploading)return;
  const pending=(await allEntries()).filter(e=>!e.uploaded_at&&!e.rejected);
  if(!pending.length)return silent?null:toast('ما في شي جديد للرفع');
  if(!navigator.onLine)return silent?null:toast('بدك إنترنت للرفع',true);
  const key=await kvGet('key');if(!key)return silent?null:toast('اضغط "تحديث القوائم" أول عشان تدخل كلمة التشفير',true);
  const tok=silent?await validToken():await token('upload');if(!tok)return renderHome();
  uploading=true;const btn=$('#uploadBtn');btn.disabled=true;btn.textContent=`⬆️ بحفظ ${pending.length}…`;
  try{
    const res=await Direct.run(tok,pending,key),now=new Date().toISOString();let done=0;
    for(const e of pending)if(res.applied.includes(e.id)){e.uploaded_at=now;e.direct='applied';e.photo_count=(e.photos||[]).length;e.photos=[];await putEntry(e);done++}
    if(res.catalog){CAT=res.catalog;await kvSet('catalog',CAT)}
    // A refusal (closed month, paid above actual, changed meanwhile) stays on the phone with the reason.
    for(const e of pending)if(res.failed[e.id]){e.rejected=res.failed[e.id];await putEntry(e)}
    const failed=Object.keys(res.failed).length;
    if(done||failed)toast((done?`انحفظ بالبرنامج ✓ (${done})`:'')+(failed?`${done?' · ':''}${failed} ما انضافوا، شوف السبب تحت`:''),!done);
  }catch(err){if(err.reauth&&!silent)signIn('upload');else if(!silent||!err.reauth)toast(err.message,true)}
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

