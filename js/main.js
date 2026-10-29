// Settings, the home screen, theme, and app start-up. Loaded last.
'use strict';
// ---------- settings ----------
async function openSettings(){
  const cid=await kvGet('client_id')||'',key=await kvGet('key');
  openSheet(`${head('الإعدادات')}<div class="card"><h2>الربط مع Google</h2>
   <div class="field"><label>Google Client ID (نوع Web)</label><input id="sCid" dir="ltr" value="${esc(cid)}" placeholder="....apps.googleusercontent.com"></div>
   <p class="hint">رابط هالصفحة اللي لازم تحطه بـ Google: <code>${esc(appUrl())}</code></p>
   <button class="btn" id="sSave">احفظ</button></div>
   <div class="card"><h2>مين بيستعمل هالموبايل؟</h2>
    <div class="seg"><button type="button" data-mode="full" class="${MODE==='full'?'on':''}">أنا (كل الدفتر)</button><button type="button" data-mode="shop" class="${MODE==='shop'?'on':''}">شخص ثاني (الأغراض بس)</button></div>
    <div class="field"><label>الاسم اللي بيبيّن جنب الأغراض</label><input id="sMyName" value="${esc(MYNAME)}" placeholder="مثلاً سارة"></div>
    <p class="hint">"الأغراض بس": بيفتح على قائمة الأغراض، بحساب Google تبع الشخص نفسه، وما بيشوف أي مصاريف أو مبالغ. لازم صاحب البرنامج يشارك معه القائمة أول.</p></div>
   <div class="card"><h2>المظهر</h2><div class="seg">${[['auto','تلقائي'],['light','فاتح'],['dark','غامق']].map(([k,l])=>`<button type="button" data-th="${k}" class="${(localStorage.getItem('hm-theme')||'auto')===k?'on':''}">${l}</button>`).join('')}</div></div>
   <div class="card"><h2>التشفير</h2><p class="hint">${key?'كلمة التشفير محفوظة على هالآيفون.':'لسا ما دخلت كلمة التشفير. بتنطلب أول مرة بتحدّث القوائم.'}</p>
   <button class="btn white" id="sForget">انسَ كلمة التشفير</button></div>
   <div class="card"><h2>تنظيف</h2><p class="hint">بيمسح التسجيلات اللي انرفعت من القائمة. اللي لسا ما انرفع ما بينمسح.</p><button class="btn danger" id="sClean">امسح المرفوع</button></div>`);
  $('#closeSheet').onclick=closeSheet;
  $('#sSave').onclick=async()=>{const v=val('sCid');if(v&&!v.endsWith('.apps.googleusercontent.com'))return toast('الرقم لازم يخلص بـ .apps.googleusercontent.com',true);await kvSet('client_id',v);await kvDel('token');toast('انحفظ ✓')};
  $('#sMyName').onchange=async()=>{MYNAME=val('sMyName');await kvSet('myName',MYNAME)};
  sheet.querySelectorAll('[data-mode]').forEach(b=>b.onclick=async()=>{if(b.dataset.mode===MODE)return;
    MYNAME=val('sMyName');await kvSet('myName',MYNAME);MODE=b.dataset.mode;await kvSet('mode',MODE);
    // Switching changes the Google access asked for, so the old sign-in is dropped.
    await kvDel('token');toast(MODE==='shop'?'صار الموبايل للأغراض بس':'رجع الدفتر كامل');
    if(MODE==='shop'){SHOPDATA=await kvGet('shopData');SHOPOPS=await kvGet('shopOps')||[];shoppingScreen()}else closeSheet()});
  sheet.querySelectorAll('[data-th]').forEach(b=>b.onclick=()=>{try{localStorage.setItem('hm-theme',b.dataset.th)}catch{}applyTheme();sheet.querySelectorAll('[data-th]').forEach(x=>x.classList.toggle('on',x===b))});
  $('#sForget').onclick=async()=>{await kvDel('key');toast('انمسحت كلمة التشفير من الآيفون');openSettings()};
  $('#sClean').onclick=async()=>{const up=(await allEntries()).filter(e=>e.uploaded_at);for(const e of up)await delEntry(e.id);toast(`انمسح ${up.length}`)};
}

// ---------- home ----------
// Saved into the program, refused (with the reason), or still only on the phone.
function phoneState(e){if(e.rejected)return '<span class="st no">ما انضاف</span>';if(!e.uploaded_at)return '<span class="st wait">بالآيفون</span>';return '<span class="st done">انضاف ✓</span>'}
async function renderHome(){
  const every=(await allEntries()).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const pending=every.filter(e=>!e.uploaded_at),list=every.filter(e=>e.type!=='shopping');
  {const g=(await gasState())[0];$('#gasInfo').textContent=g?gasLine(g):'متى بدّلت الجرة'}
  if(CAT){const v=await shopView(),left=v.items.filter(x=>!x.in_cart).length;$('#shopInfo').textContent=left?`${left} أغراض بالقائمة`:'قائمة التسوّق'}
  $('#pendingInfo').textContent=pending.length?`${pending.length} بانتظار الرفع`:'';
  $('#uploadBtn').textContent=pending.length?`⬆️ ارفع على Drive (${pending.length})`:'⬆️ ارفع على Drive';
  // Reminder when entries wait: a sign-in button if Google needs it, otherwise after two days.
  const oldest=pending.reduce((m,e)=>Math.min(m,Date.parse(e.created_at)),Date.now()),tok=await validToken(),hasKey=!!(await kvGet('key'));
  const needLogin=pending.length&&navigator.onLine&&hasKey&&!tok,stale=pending.length&&Date.now()-oldest>2*864e5;
  $('#syncBar').classList.toggle('hidden',!(needLogin||stale));
  $('#syncText').textContent=`عندك ${pending.length} ${pending.length===1?'تسجيل':'تسجيلات'} ما انرفعت`+(stale?' من أكثر من يومين':'');
  $('#syncBtn').textContent=needLogin?'سجّل دخول للرفع':'ارفع هلأ';
  $('#catInfo').textContent=CAT?`القوائم من ${dmy(CAT.generated_at)}`:'لسا ما في قوائم — حدّثها من Drive';
  const acs=[CAT?.breaker,CAT?.samsung].filter(Boolean);
  if($('#openAC')){$('#openAC').classList.toggle('hidden',!acs.length);if(acs.length)$('#acInfo').textContent=`اليوم ${num(acs.reduce((t,a)=>t+(a.today_kwh||0),0),2)} kWh`}
  const en=CAT?.energy;
  if($('#openEnergy')){$('#openEnergy').classList.toggle('hidden',!en?.devices?.length);if(en?.devices?.length)$('#energyInfo').textContent=`هالشهر ${num(en.month_kwh,1)} kWh`}
  const title=e=>{const d=e.data||{};if(e.type==='edit'||e.type==='delete')return `${TYPES[e.type].name}: ${d.label||''}`;if(e.type==='expense')return `${d.mode==='pay'?'دفعة: ':''}${d.name||'مصروف'}`;if(e.type==='payment')return d.obligation_name||'دفعة قسط';return TYPES[e.type].name};
  const sub=e=>{const d=e.data||{};if(e.rejected)return `<span style="color:var(--red)">${esc(e.rejected)}</span>`;if(e.type==='gas')return esc(`${d.cylinder} · ${dmy(d.swapped_on)}`);if(e.type==='edit')return esc(Object.keys(d.changes||{}).length+' حقول تغيّرت');if(e.type==='delete')return esc(KIND_AR[d.kind]||'');const amt=d.amount?money(d.amount):e.type==='electricity'?`رئيسي ${d.main_current??'—'}`:`روف ${d.roof_current??'—'}`;
    const ph=(e.photos?.length||e.photo_count)?` · 📷 ${e.photos?.length||e.photo_count}`:'';return `<span class="num">${esc(amt)}</span>${e.period_label?' · '+esc(e.period_label):''}${ph}`};
  $('#list').innerHTML=list.length?list.slice(0,40).map(e=>`<div class="it"><span class="ai ${TYPES[e.type].cls}" style="background:${{expense:'#f1edff',electricity:'#fff3df',water:'#e6f2ff',payment:'#e6f6ef'}[e.type]||'#eef0ff'}">${TYPES[e.type].icon}</span>
    <div class="grow"><b>${esc(title(e))}</b><small>${sub(e)}</small></div>${phoneState(e)}<button class="del" data-del="${e.id}" aria-label="حذف">🗑</button></div>`).join('')
    :'<div class="empty">لسا ما سجّلت شي.</div>';
  $('#list').querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{const e=list.find(x=>x.id===b.dataset.del);
    if(confirm(e?.uploaded_at?'بينشال من هالقائمة بس، وبيضل بالبرنامج. لتحذفه من البرنامج افتحه من "عرض بياناتي" أو "القراءات".':'تحذف هالتسجيل؟ لسا ما انحفظ، فرح يضيع.')){await delEntry(b.dataset.del);renderHome()}});
}
function applyTheme(){let t='auto';try{t=localStorage.getItem('hm-theme')||'auto'}catch{}
  const dark=t==='dark'||(t==='auto'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=dark?'dark':'light';
  document.querySelector('meta[name=theme-color]').setAttribute('content',dark?'#0f1220':'#5b5cf0')}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change',applyTheme);applyTheme();
// A spinner on the button that started the work; the status chip also shows that Drive is being used.
let working=0;
async function withBusy(btn,fn,label){
  const old=btn?.innerHTML;if(btn){btn.classList.add('busy');if(label)btn.textContent=label}
  working++;net();
  try{return await fn()}finally{working--;net();if(btn&&btn.isConnected){btn.classList.remove('busy');if(label)btn.innerHTML=old}}
}
function net(){const on=navigator.onLine;document.querySelectorAll('[data-net]').forEach(c=>{c.textContent=working?'عم يتزامن':on?'متصل':'بدون نت';c.classList.toggle('off',!on&&!working);c.classList.toggle('busy',!!working)})}
addEventListener('online',net);addEventListener('offline',net);

document.querySelectorAll('[data-form]').forEach(b=>b.onclick=()=>{if(!CAT)toast('ما في قوائم لسا. حدّثها من Drive لما يصير عندك نت.',true);
  ({expense:expenseForm,electricity:()=>readingForm('electricity'),water:()=>readingForm('water'),payment:paymentForm})[b.dataset.form]()});
$('#openView').onclick=viewScreen;
// Guarded: right after an update the phone can briefly have the new code with the old page.
$('#openMeters')&&($('#openMeters').onclick=()=>metersScreen());$('#openDebts')&&($('#openDebts').onclick=debtsScreen);$('#openAC')&&($('#openAC').onclick=acScreen);$('#openEnergy')&&($('#openEnergy').onclick=()=>energyScreen());$('#openShop').onclick=shoppingScreen;$('#openGas').onclick=gasScreen;$('#uploadBtn').onclick=e=>withBusy(e.currentTarget,()=>upload());$('#syncBtn').onclick=e=>withBusy(e.currentTarget,()=>upload());
addEventListener('online',()=>autoSync(true));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')autoSync()});$('#refreshBtn').onclick=e=>withBusy(e.currentTarget,()=>refreshCatalog(),'بحدّث القوائم…');$('#openSettings').onclick=openSettings;

(async()=>{
  net();CAT=await kvGet('catalog')||null;
  // A link ending in ?shop=1 sets the phone up for shopping only.
  const qs=new URLSearchParams(location.search);
  if(qs.get('cid')?.endsWith('.apps.googleusercontent.com')&&!(await kvGet('client_id')))await kvSet('client_id',qs.get('cid'));
  if(qs.get('shop')==='1'&&!(await kvGet('mode')))await kvSet('mode','shop');
  if(qs.has('shop')||qs.has('cid'))history.replaceState(null,'',appUrl());
  MODE=await kvGet('mode')||'full';MYNAME=await kvGet('myName')||'';
  if(MODE==='shop'){SHOPDATA=await kvGet('shopData');SHOPOPS=await kvGet('shopOps')||[];await shoppingScreen()}else await renderHome();
  const next=await takeRedirect();if(next==='upload')await upload();else if(next==='refresh')await refreshCatalog();else if(next==='shopsync')await withBusy(null,()=>sharedSync(true));
  autoSync(true);
  if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
