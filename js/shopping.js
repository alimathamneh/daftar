// The shopping list (shared with the computer) and the gas cylinders.
'use strict';
// ---------- shopping list (shared with the computer; last change wins, item by item) ----------
const shopEntries=async()=>(await allEntries()).filter(e=>e.type==='shopping');
// Shared mode: the list file the computer publishes, the changes file both phones write to, and our unsent changes.
let SHOPDATA=null,SHOPOPS=[];
async function sharedSync(interactive=false){
  if(!navigator.onLine)return;const tok=interactive?await token('shopsync'):await validToken();if(!tok)return renderShopHome();
  const ff=async(name,folder)=>{const r=await gapi(tok,'https://www.googleapis.com/drive/v3/files?'+new URLSearchParams({q:`name = '${name}' and '${folder}' in parents and trashed = false`,fields:'files(id)',pageSize:'1'}));return (await r.json()).files?.[0]?.id};
  try{
    const folder=await findFolder(tok,'Home Monthly Shopping');if(!folder)throw new Error('ما لقيت مجلد الأغراض. لازم يشاركه معك صاحب البرنامج.');
    const listId=await ff('shopping-list.json',folder),inId=await ff('shopping-changes.json',folder);if(!inId)throw new Error('لسا الكمبيوتر ما جهّز القائمة. جرّب بعد دقيقتين.');
    let inbox={ops:[]};try{inbox=await (await gapi(tok,`https://www.googleapis.com/drive/v3/files/${inId}?alt=media`)).json()}catch{}
    const out=await kvGet('shopOut')||[];
    if(out.length){const seen=new Set(inbox.ops.map(o=>o.id+o.updated_at));inbox.ops=[...inbox.ops,...out.filter(o=>!seen.has(o.id+o.updated_at))].slice(-300);
      await gapi(tok,`https://www.googleapis.com/upload/drive/v3/files/${inId}?uploadType=media`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(inbox)});
      await kvSet('shopOut',[])}
    SHOPOPS=inbox.ops;await kvSet('shopOps',SHOPOPS);
    if(listId){SHOPDATA=await (await gapi(tok,`https://www.googleapis.com/drive/v3/files/${listId}?alt=media`)).json();await kvSet('shopData',SHOPDATA)}
  }catch(e){if(e.reauth){if(interactive)signIn('shopsync')}else if(interactive)toast(e.message,true)}
  renderShopHome();
}
async function shopView(){
  const map=new Map(),shared=MODE==='shop',base=shared?SHOPDATA:CAT?.shopping;
  for(const x of [...(base?.items||[]),...(base?.staples||[])])map.set(x.id,{...x});
  const ops=[];if(shared)ops.push(...SHOPOPS,...(await kvGet('shopOut')||[]));else for(const e of await shopEntries())ops.push(...Object.values(e.data.ops||{}));
  ops.sort((a,b)=>a.updated_at.localeCompare(b.updated_at));
  for(const op of ops){const cur=map.get(op.id);if(!cur||op.updated_at>=(cur.updated_at||'')){if(op.deleted)map.delete(op.id);else map.set(op.id,{...cur,...op})}}
  const all=[...map.values()];return {items:all.filter(x=>!x.staple).sort((a,b)=>(a.in_cart-b.in_cart)||b.updated_at.localeCompare(a.updated_at)),staples:all.filter(x=>x.staple)};
}
async function shopChange(list){
  if(MODE==='shop'){const out=await kvGet('shopOut')||[],now=new Date().toISOString();
    for(const op of list)out.push({...op,by:op.by||MYNAME,updated_at:now});await kvSet('shopOut',out);await shoppingScreen();withBusy(null,()=>sharedSync());return}
  // All changes waiting to go up live in one entry; an item changed twice keeps only its latest state.
  let e=(await shopEntries()).find(x=>!x.uploaded_at);
  if(!e)e={id:crypto.randomUUID(),type:'shopping',created_at:new Date().toISOString(),period_id:null,period_label:'',data:{ops:{}},photos:[]};
  for(const op of list)e.data.ops[op.id]={...op,updated_at:new Date().toISOString()};
  await putEntry(e);await shoppingScreen();autoSync(true);
}
// Uploaded changes stay on screen until the computer's list shows them (or for a day at most).
async function pruneShopping(){if(!CAT?.shopping)return;
  const have=new Map([...CAT.shopping.items,...CAT.shopping.staples].map(x=>[x.id,x]));
  for(const e of await shopEntries()){if(!e.uploaded_at)continue;
    const seen=Object.values(e.data.ops||{}).every(op=>{const x=have.get(op.id);return op.deleted?!x:x&&x.updated_at>=op.updated_at});
    if(seen||Date.now()-Date.parse(e.uploaded_at)>864e5)await delEntry(e.id)}}
async function shoppingScreen(){
  const shared=MODE==='shop',v=await shopView(),left=v.items.filter(x=>!x.in_cart).length,names=(shared?SHOPDATA:CAT?.shopping)?.names||[],uid=()=>crypto.randomUUID().replace(/-/g,'');
  const isStaple=n=>v.staples.some(s=>s.name===n),waiting=shared?(await kvGet('shopOut')||[]).length:0;
  openSheet(`${shared?`<div class="top"><div><h1>الأغراض</h1><small>${MYNAME?esc(MYNAME)+' · ':''}${waiting?`${waiting} تغيير لسا ما انرفع`:'متزامنة'}</small></div>
     <div style="display:flex;gap:8px;align-items:center"><span class="chip" id="net" data-net>متصل</span><button class="icon-btn" id="shopSync" aria-label="تحديث">🔄</button><button class="icon-btn" id="shopSettings" aria-label="الإعدادات">⚙️</button></div></div>`:head('الأغراض')}
   <form class="shop-add" id="shopForm"><input class="n" id="sName" list="sNames" placeholder="أضف غرض" autocomplete="off"><datalist id="sNames">${names.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>
    <input class="q" id="sQty" placeholder="الكمية"><button class="btn">أضف</button></form>
   <div class="card"><div class="row" style="align-items:center;margin-bottom:4px"><b>${v.items.length?`باقي ${left} من ${v.items.length}`:'القائمة فاضية'}</b>
     ${v.staples.length?'<button class="btn white" id="sStaples" style="width:auto;min-height:38px;font-size:13.5px">⭐ أضف الدايمين</button>':''}</div>
    ${v.items.map(x=>`<div class="shop-row ${x.in_cart?'done':''}"><label><input type="checkbox" data-c="${x.id}" ${x.in_cart?'checked':''}><span>${esc(x.name)}</span>${x.qty?`<small>${esc(x.qty)}</small>`:''}${x.added_by||x.by?`<small style="color:var(--brand)">— ${esc(x.added_by||x.by)}</small>`:''}</label>
      <button class="star ${isStaple(x.name)?'on':''}" data-s="${x.id}" aria-label="دايم">★</button><button data-d="${x.id}" aria-label="حذف">✕</button></div>`).join('')}</div>
   ${v.items.some(x=>x.in_cart)?'<button class="btn" id="sDone">✓ خلصت التسوّق</button>':''}
   <p class="hint" style="text-align:center">★ = بنشتريه كل مرة. ${shared?'التغييرات بتوصل للبيت خلال دقيقتين.':'القائمة نفسها بالبرنامج عالكمبيوتر.'}</p>`);
  if(shared){net();$('#shopSync').onclick=e=>withBusy(e.currentTarget,()=>sharedSync(true));$('#shopSettings').onclick=openSettings}
  else $('#closeSheet').onclick=closeSheet;
  $('#shopForm').onsubmit=e=>{e.preventDefault();const name=val('sName');if(!name)return;if(v.items.some(x=>x.name===name&&!x.in_cart))return toast('موجود بالقائمة');
    shopChange([{id:uid(),name,qty:val('sQty'),in_cart:0,staple:0,deleted:0}])};
  const find=id=>v.items.find(x=>x.id===id);
  sheet.querySelectorAll('[data-c]').forEach(b=>b.onchange=()=>shopChange([{...find(b.dataset.c),in_cart:b.checked?1:0,deleted:0}]));
  sheet.querySelectorAll('[data-d]').forEach(b=>b.onclick=()=>shopChange([{...find(b.dataset.d),deleted:1}]));
  sheet.querySelectorAll('[data-s]').forEach(b=>b.onclick=()=>{const x=find(b.dataset.s),s=v.staples.find(i=>i.name===x.name);
    shopChange([s?{...s,deleted:1}:{id:uid(),name:x.name,qty:x.qty||'',in_cart:0,staple:1,deleted:0}])});
  $('#sStaples')&&($('#sStaples').onclick=()=>{const have=new Set(v.items.filter(x=>!x.in_cart).map(x=>x.name));
    const add=v.staples.filter(s=>!have.has(s.name)).map(s=>({id:uid(),name:s.name,qty:s.qty||'',in_cart:0,staple:0,deleted:0}));
    add.length?shopChange(add):toast('كل الدايمين موجودين')});
  $('#sDone')&&($('#sDone').onclick=async()=>{await shopChange(v.items.filter(x=>x.in_cart).map(x=>({...x,deleted:1})));
    if(!shared&&confirm('بدك تسجّل اللي دفعته كمصروف؟')){expenseForm();setTimeout(()=>{$('#fName').value='سوبرماركت';$('#fName').dispatchEvent(new Event('change'));$('#fAmount').focus()},50)}});
}

// ---------- gas cylinders: the computer's numbers, updated at once with swaps not uploaded yet ----------
async function gasState(){
  const base=CAT?.gas?.cylinders||[{cylinder:'المطبخ',last:null,avg:null,swaps:0}],day=s=>new Date(s+'T00:00:00');
  const mine=(await allEntries()).filter(e=>e.type==='gas'&&CAT?.inbox?.[e.id]!=='applied').map(e=>e.data);
  const list=base.map(x=>({...x}));
  for(const s of mine){let x=list.find(c=>c.cylinder===s.cylinder);if(!x){x={cylinder:s.cylinder,last:null,avg:null,swaps:0};list.push(x)}
    if(!x.last||s.swapped_on>x.last)x.last=s.swapped_on}
  for(const x of list){x.since=x.last?Math.round((Date.now()-day(x.last))/864e5):null;x.left=x.avg==null||x.since==null?null:Math.round(x.avg-x.since)}
  return list;
}
const gasLine=x=>!x.last?'لسا ما سجّلت تبديل':`${x.since} يوم من التبديل`+(x.left==null?'':x.left<=0?' · غالباً خلصت':` · باقي ~${x.left} يوم`);
async function gasScreen(){
  const list=await gasState();
  openSheet(`${head('الغاز')}<div class="card">${list.map(x=>`<div class="line"><span class="grow"><span>🔥 ${esc(x.cylinder)}</span><small>${esc(gasLine(x))}${x.avg?` · بتطوّل ${x.avg} يوم`:''}</small></span>${x.left!=null&&x.left<=3?'<span class="st wait">قرّبت</span>':''}</div>`).join('')}
    ${CAT?.gas?.spent_this_year?`<p class="hint">صرفت عالغاز هالسنة ${money(CAT.gas.spent_this_year)}</p>`:''}</div>
   <div class="card"><h2>بدّلت الجرة</h2>
    <div class="row"><div class="field"><label>الجرة</label><input id="gName" list="gNames" value="${esc(list[0]?.cylinder||'المطبخ')}"><datalist id="gNames">${list.map(x=>`<option value="${esc(x.cylinder)}">`).join('')}</datalist></div>
    <div class="field"><label>التاريخ</label><input id="gDate" type="date" value="${today()}"></div></div>
    <div class="field"><label>السعر (اختياري)</label><input id="gPrice" type="number" inputmode="decimal" step="0.001"></div>
    <p class="hint">إذا كتبت السعر، بينسجّل كمصروف "غاز" وبيستنى موافقتك عالكمبيوتر.</p>
    <button class="btn" id="gSave">🔥 سجّل التبديل</button></div>`);
  $('#closeSheet').onclick=closeSheet;
  $('#gSave').onclick=async()=>{const cyl=val('gName')||'المطبخ',day=val('gDate'),price=numv('gPrice');if(!day)return toast('اختار التاريخ',true);
    const mk=(type,data,pid)=>({id:crypto.randomUUID(),type,created_at:new Date().toISOString(),period_id:pid?Number(pid):null,period_label:pid?periodLabel(pid):'',data,photos:[]});
    await putEntry(mk('gas',{id:crypto.randomUUID().replace(/-/g,''),cylinder:cyl,swapped_on:day,price,by:MYNAME}));
    const pid=openPeriods()[0]?.id;
    if(price>0&&pid)await putEntry(mk('expense',{mode:'new',name:'غاز',category:'الاحتياجات',section:'apartment',amount:price,paid:true,date:day,notes:`جرة ${cyl}`},pid));
    toast('انسجّل التبديل ✓');gasScreen();syncNow()};
}

// In shopping-only mode the shopping list is the whole app.
async function renderShopHome(){if(MODE==='shop')return shoppingScreen();return renderHome()}

