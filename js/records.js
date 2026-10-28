// View, edit and delete records; the roof statement; month reports; payments.
'use strict';
// ---------- view, edit and delete (saved straight into the database copy on Drive) ----------
const STATUS={Paid:['مدفوع','done'],Unpaid:['غير مدفوع','wait'],Partial:['جزئي','part'],'Not Due':['غير مستحق','no'],Calculated:['محسوب','part'],Draft:['مسودة','no'],Verified:['تم التحقق','done']};
const badge=s=>{const [t,c]=STATUS[s]||[s||'—','no'];return `<span class="st ${c}">${esc(t)}</span>`};
const SECTIONS_AR={auto:'تلقائي',apartment:'الشقة',car:'السيارة',roof:'الروف'};
const FORMS={
  expense:[['name','اسم المصروف','text'],['category','الفئة','text'],['section','القسم','section'],['budget','الميزانية','num'],['actual','الفعلي','num'],['paid_amount','المدفوع','num'],['status','الحالة','status'],['payment_date','تاريخ الدفع','date'],['notes','ملاحظات','text']],
  electricity:[['record_date','تاريخ القراءة','date'],['bill_date','تاريخ الفاتورة','date'],['main_current','العداد الرئيسي','num'],['roof_current','عداد الروف','num'],['car_current','عداد السيارة','num'],['invoice_amount','إجمالي الفاتورة','num'],['fees','الرسوم','num'],['notes','ملاحظات','text']],
  water:[['record_date','تاريخ القراءة','date'],['bill_date','تاريخ الفاتورة','date'],['total_consumption','استهلاك الفاتورة (م³)','num'],['roof_current','عداد الروف','num'],['invoice_amount','إجمالي الفاتورة','num'],['notes','ملاحظات','text']],
  payment:[['amount','المبلغ','num'],['paid_on','تاريخ الدفع','date'],['notes','ملاحظات','text']],
  period:[['salary','الدخل / الراتب','num'],['notes','ملاحظات الشهر','text']]};
const KIND_AR={expense:'مصروف',electricity:'قراءة كهرباء',water:'قراءة مياه',payment:'دفعة قسط',period:'الشهر'};
let VIEW={pid:null,filter:'all',cat:''};
async function pendingChanges(){const m={};for(const e of await allEntries())if(!e.uploaded_at&&(e.type==='edit'||e.type==='delete'))m[e.data.kind+':'+e.data.id]=e;return m}
const withChange=(rec,ch)=>ch&&ch.type==='edit'?{...rec,...ch.data.changes}:rec;
const tag=ch=>ch?(ch.type==='delete'?'<span class="st wait">بينحذف</span>':'<span class="st edit">بانتظار الحفظ</span>'):'';

async function viewScreen(){
  if(!CAT)return toast('حدّث القوائم من Drive أول',true);
  const ps=CAT.periods||[];if(!VIEW.pid||!ps.some(p=>String(p.id)===String(VIEW.pid)))VIEW.pid=ps[0]?.id;
  const pid=String(VIEW.pid),p=ps.find(x=>String(x.id)===pid),closed=p?.status==='closed',S=CAT.summary?.[pid]||{},ch=await pendingChanges();
  const catOf=e=>(e.category||'').trim()||'—',allEx=CAT.expenses?.[pid]||[];
  const cats={};for(const e of allEx){const k=catOf(e);cats[k]=(cats[k]||0)+Number(e.actual||0)}
  if(VIEW.cat&&!(VIEW.cat in cats))VIEW.cat='';
  const ex=allEx.filter(e=>(VIEW.filter==='all'||Number(e.actual)-Number(e.paid_amount||0)>0.0005)&&(!VIEW.cat||catOf(e)===VIEW.cat));
  const catBar=Object.keys(cats).length<2?'':`<div class="kpis" style="margin-bottom:10px">${[['',S.actual??allEx.reduce((t,e)=>t+Number(e.actual||0),0),'الكل'],...Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>[k,v,k])]
    .map(([k,v,l])=>`<button type="button" class="kpi" data-cat="${esc(k)}" style="text-align:start;${VIEW.cat===k?'border-color:var(--brand);box-shadow:0 0 0 3px rgba(91,92,240,.15)':''}"><small>${esc(l)}</small><b class="num">${money(v)}</b></button>`).join('')}</div>`;
  const rd=CAT.readings?.[pid]||{},pe=withChange(p,ch['period:'+pid]);
  const util=(kind,r)=>{if(!r)return '';const c=ch[kind+':'+r.id],x=withChange(r,c);
    return `<button class="line ${c?.type==='delete'?'gone':''}" data-edit="${kind}:${r.id}"><span class="grow"><span>${kind==='electricity'?'⚡ الكهرباء':'💧 المياه'} ${tag(c)}</span><small>البيت ${money(x.apartment_amount)} · الروف ${money(x.roof_amount)}${kind==='electricity'?` · السيارة ${money(x.car_amount)}`:''}</small></span>${badge(x.status)}</button>`};
  openSheet(`${head('بياناتي')}
   <div class="field"><select id="vMonth">${ps.map(x=>`<option value="${x.id}" ${String(x.id)===pid?'selected':''}>${monthLabel(x.period_date)}${x.status==='closed'?' 🔒':''}</option>`).join('')}</select></div>
   ${closed?'<p class="warn">هالشهر مسكّر، بتقدر تشوفه بس. لتعدّل عليه افتحه من البرنامج عالكمبيوتر.</p>':''}
   <div class="kpis">
    <button class="kpi wide line" style="border:1px solid #e8ebf2;padding:11px 12px" data-edit="period:${pid}"><span class="grow"><small>الدخل ${tag(ch['period:'+pid])}</small><b class="num">${money(pe?.salary)}</b></span><small>✏️</small></button>
    <div class="kpi"><small>المصروف</small><b class="num">${money(S.actual)}</b></div><div class="kpi"><small>المتبقي</small><b class="num">${money(S.remaining)}</b></div>
    <div class="kpi"><small>المدفوع</small><b class="num">${money(S.paid)}</b></div><div class="kpi"><small>غير المدفوع</small><b class="num">${money(S.unpaid)}</b></div></div>
   ${reportCard(CAT.reports?.[pid])}
   ${(rd.electricity?.[0]||rd.water?.[0])?`<div class="card"><div class="sub">الفواتير</div>${util('electricity',rd.electricity?.[0])}${util('water',rd.water?.[0])}
     <button class="btn soft" id="roofBtn" style="margin-top:10px">🧾 كشف الروف لهالشهر</button></div>`:''}
   ${catBar}
   <div class="card"><div class="seg"><button type="button" data-f="all" class="${VIEW.filter==='all'?'on':''}">كل المصاريف</button><button type="button" data-f="unpaid" class="${VIEW.filter==='unpaid'?'on':''}">غير المدفوع</button></div>
    ${ex.length?ex.map(e=>{const c=ch['expense:'+e.id],x=withChange(e,c);return `<button class="line ${c?.type==='delete'?'gone':''}" data-edit="expense:${e.id}"><span class="grow"><span>${esc(x.name)} ${tag(c)}</span><small>${esc(x.category||'')}</small></span><span style="text-align:left"><b class="num">${money(x.actual)}</b><br>${badge(x.status)}</span></button>`}).join(''):'<div class="empty">ما في مصاريف.</div>'}</div>
   <div class="card"><div class="sub">الأقساط والديون</div>${(CAT.obligations||[]).map(o=>`<button class="line" data-ob="${o.id}"><span class="grow"><span>${esc(o.name)}</span><small>${o.monthly_amount?`القسط ${money(o.monthly_amount)} · `:''}${(o.payments||[]).length} دفعات</small></span><b class="num">باقي ${money(o.remaining)}</b></button>`).join('')||'<div class="empty">ما في أقساط.</div>'}</div>
   <p class="hint" style="text-align:center">البيانات من آخر تحديث للقوائم: ${dmy(CAT.generated_at)}. التعديلات بتنحفظ بالبرنامج أول ما يصير في نت.</p>`);
  $('#closeSheet').onclick=closeSheet;
  $('#vMonth').onchange=()=>{VIEW.pid=$('#vMonth').value;viewScreen()};
  sheet.querySelectorAll('[data-f]').forEach(b=>b.onclick=()=>{VIEW.filter=b.dataset.f;viewScreen()});
  sheet.querySelectorAll('[data-cat]').forEach(b=>b.onclick=()=>{VIEW.cat=b.dataset.cat;viewScreen()});
  sheet.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>{if(closed)return toast('الشهر مسكّر',true);const [k,id]=b.dataset.edit.split(':');editRecord(k,id)});
  sheet.querySelectorAll('[data-ob]').forEach(b=>b.onclick=()=>paymentsScreen(b.dataset.ob));
  $('#roofBtn')&&($('#roofBtn').onclick=()=>roofScreen(pid));
}

// ---------- roof statement: only the roof's numbers, as text or a clean picture to send ----------
function roofLines(pid){
  const p=(CAT.periods||[]).find(x=>String(x.id)===String(pid)),rd=CAT.readings?.[pid]||{},e=rd.electricity?.[0],w=rd.water?.[0];
  const L=[],f=v=>Number(v||0).toLocaleString('en-US',{minimumFractionDigits:3,maximumFractionDigits:3});
  if(e){const fee=Number(e.roof_consumption)>0?Number(e.fees||0)/2:0;
    L.push(['⚡ الكهرباء',''],['العداد',`من ${e.roof_prev??'—'} إلى ${e.roof_current??'—'}`],['الاستهلاك',`${f(e.roof_consumption).replace(/\.000$/,'')} kWh`],
      ['قيمة الاستهلاك',`${f(Number(e.roof_amount)-fee)} JOD`],['نص الرسوم',`${f(fee)} JOD`],['مجموع الكهرباء',`${f(e.roof_amount)} JOD`])}
  if(w)L.push(['💧 المياه',''],['العداد',`من ${w.roof_prev??'—'} إلى ${w.roof_current??'—'}`],['الاستهلاك',`${f(w.roof_consumption).replace(/\.000$/,'')} م³`],['مجموع المياه',`${f(w.roof_amount)} JOD`]);
  const total=Number(e?.roof_amount||0)+Number(w?.roof_amount||0);
  return {month:monthLabel(p?.period_date),lines:L,total:`${f(total)} JOD`};
}
function roofScreen(pid){
  const s=roofLines(pid);let photo=null;
  openSheet(`${head('كشف الروف')}<div class="card"><h2>شهر ${esc(s.month)}</h2>
   ${s.lines.map(([a,b])=>b===''?`<div class="sub" style="margin-top:8px">${a}</div>`:`<div class="line"><span class="grow"><span>${esc(a)}</span></span><b dir="auto">${esc(b)}</b></div>`).join('')}
   <div class="line" style="font-size:16px"><span class="grow"><span><b>المطلوب من الروف</b></span></span><b class="num">${esc(s.total)}</b></div></div>
   <p class="hint">الكشف فيه أرقام الروف بس، بدون أي شي من مصاريفك أو دخلك.</p>
   <label class="pick" style="min-height:52px">📷 أضف صورة العداد (اختياري)<input type="file" accept="image/*" id="roofPhoto"></label><div class="photos" id="roofPh"></div>
   <button class="btn" id="shareImg">مشاركة كصورة</button><button class="btn white" id="shareTxt" style="margin-top:10px">مشاركة كنص</button>`);
  $('#closeSheet').onclick=closeSheet;
  $('#roofPhoto').onchange=async ev=>{const f=ev.target.files[0];if(!f)return;photo=await shrink(f);$('#roofPh').innerHTML=`<img src="${URL.createObjectURL(photo)}" alt="">`};
  const text=()=>`كشف الروف — شهر ${s.month}\n`+s.lines.map(([a,b])=>b===''?`\n${a}`:`${a}: ${b}`).join('\n')+`\n\nالمطلوب من الروف: ${s.total}`;
  const share=async data=>{try{if(navigator.canShare&&!navigator.canShare(data))throw new Error('x');await navigator.share(data)}
    catch(e){if(e.name==='AbortError')return;try{await navigator.clipboard.writeText(text());toast('انتسخ الكشف، الصقه وين ما بدك')}catch{toast('المشاركة مش مدعومة هون',true)}}};
  $('#shareTxt').onclick=()=>share({title:'كشف الروف',text:text()});
  $('#shareImg').onclick=async()=>{const files=[new File([await roofImage(s)],`roof-${s.month.replace('/','-')}.png`,{type:'image/png'})];
    if(photo)files.push(new File([photo],'meter.jpg',{type:'image/jpeg'}));share({title:'كشف الروف',files})};
}
async function roofImage(s){
  const W=900,rowH=58,rows=s.lines.length,H=180+rows*rowH+80,c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d');
  await document.fonts.ready;g.fillStyle='#fff';g.fillRect(0,0,W,H);g.fillStyle='#5b5cf0';g.fillRect(0,0,W,120);
  g.direction='rtl';g.textAlign='right';g.fillStyle='#fff';g.font='700 40px Plex, sans-serif';g.fillText('كشف الروف',W-50,60);g.font='400 26px Plex, sans-serif';g.fillText(`شهر ${s.month}`,W-50,100);
  let y=180;for(const [a,b] of s.lines){if(b===''){g.fillStyle='#4646c9';g.font='700 28px Plex, sans-serif';g.textAlign='right';g.fillText(a,W-50,y);}
    else{g.fillStyle='#4b5568';g.font='400 26px Plex, sans-serif';g.textAlign='right';g.fillText(a,W-50,y);g.fillStyle='#141b2d';g.font='700 26px Plex, sans-serif';g.textAlign='left';
      // "56.762 JOD" reads left to right; "من 64 إلى 73" right to left.
      g.direction=/[؀-ۿ]/.test(b)?'rtl':'ltr';g.fillText(b,50,y);g.direction='rtl'}
    y+=rowH}
  g.fillStyle='#eef0ff';g.fillRect(30,y-20,W-60,80);g.fillStyle='#141b2d';g.font='700 30px Plex, sans-serif';g.textAlign='right';g.fillText('المطلوب من الروف',W-60,y+30);
  g.textAlign='left';g.direction='ltr';g.fillText(s.total,60,y+30);
  return new Promise(r=>c.toBlob(r,'image/png'));
}
// The closed month's report, as the computer worked it out.
function reportCard(r){
  if(!r)return '';const p=r.previous,arrow=(now,before,lowerGood=true)=>{if(!p||before==null)return '';const d=now-before;if(Math.abs(d)<0.005)return '';
    return ` <small style="color:${(lowerGood?d<0:d>0)?'var(--green)':'var(--red)'}">${d>0?'↑':'↓'} ${money(Math.abs(d))}</small>`};
  const nm=n=>({'Home electricity':'كهرباء البيت','Home water':'مياه البيت'}[n]||n);
  const note=r.spend_ratio==null?'':`صرفت ${r.spend_ratio}% من الدخل`+(r.avg_ratio==null?'.':` — ${r.spend_ratio>r.avg_ratio+0.5?'أعلى من':r.spend_ratio<r.avg_ratio-0.5?'أقل من':'تقريباً نفس'} معدّل آخر ${r.avg_months} شهور (${r.avg_ratio}%).`);
  return `<div class="card"><div class="sub">📋 تقرير الشهر</div>
   <div class="line"><span class="grow"><span>المصروف${arrow(r.actual,p?.actual)}</span></span><b class="num">${money(r.actual)}</b></div>
   <div class="line"><span class="grow"><span>المتبقي${arrow(r.remaining,p?.remaining,false)}</span></span><b class="num">${money(r.remaining)}</b></div>
   ${note?`<p class="hint">${esc(note)}</p>`:''}
   ${r.changes.length?`<div class="sub">أكبر التغييرات عن الشهر الماضي</div>${r.changes.map(x=>`<div class="line"><span class="grow"><span>${esc(nm(x.name))}</span></span><b style="color:${x.diff>0?'var(--red)':'var(--green)'}">${x.diff>0?'↑':'↓'} ${money(Math.abs(x.diff))}</b></div>`).join('')}`:''}
   <div class="sub">أكبر 5 مصاريف</div>${r.top.map(x=>`<div class="line"><span class="grow"><span>${esc(x.name)}</span></span><b class="num">${money(x.actual)}</b></div>`).join('')}
   <div class="line"><span class="grow"><span>حصة الروف</span></span><b class="num">${money(r.roof_total)}</b></div>
   <div class="line"><span class="grow"><span>أقساط اندفعت هالشهر</span><small>الباقي بالإجمالي ${money(r.installments.left)}</small></span><b class="num">${money(r.installments.paid)}</b></div></div>`;
}
async function paymentsScreen(oid){
  const o=(CAT.obligations||[]).find(x=>String(x.id)===String(oid));if(!o)return;const ch=await pendingChanges();
  openSheet(`${head(esc(o.name))}<div class="kpis"><div class="kpi"><small>المتبقي</small><b class="num">${money(o.remaining)}</b></div><div class="kpi"><small>الإجمالي</small><b class="num">${money(o.total)}</b></div></div>
   <div class="card"><div class="sub">آخر الدفعات</div>${(o.payments||[]).map(p=>{const c=ch['payment:'+p.id],x=withChange(p,c);return `<button class="line ${c?.type==='delete'?'gone':''}" data-pay="${p.id}"><span class="grow"><span>${dmy(x.paid_on)} ${tag(c)}</span><small>${esc(x.notes||'')}</small></span><b class="num">${money(x.amount)}</b></button>`}).join('')||'<div class="empty">ما في دفعات.</div>'}</div>
   <button class="btn white" id="backView">رجوع لبياناتي</button>`);
  $('#closeSheet').onclick=closeSheet;$('#backView').onclick=viewScreen;
  sheet.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>editRecord('payment',b.dataset.pay,o));
}
function findRecord(kind,id){const pid=String(VIEW.pid),eq=x=>String(x.id)===String(id);
  if(kind==='expense')return (CAT.expenses?.[pid]||[]).find(eq);if(kind==='period')return (CAT.periods||[]).find(eq);
  if(kind==='payment')for(const o of CAT.obligations||[]){const p=(o.payments||[]).find(eq);if(p)return {...p,_ob:o}}
  return (CAT.readings?.[pid]?.[kind]||[]).find(eq)||(CAT.meters?.[kind]||[]).find(eq)}
// backTo: the screen to go back to after saving (the readings or debts screens pass their own).
async function editRecord(kind,id,backTo){
  const rec=findRecord(kind,id);if(!rec)return toast('ما لقيت البند',true);
  const ch=await pendingChanges(),old=ch[kind+':'+id],cur=withChange(rec,old),auto=kind==='expense'&&rec.auto_calculated;
  const label=kind==='expense'?rec.name:kind==='period'?`شهر ${monthLabel(rec.period_date)}`:kind==='payment'?`${rec._ob?.name||'دفعة'} · ${dmy(rec.paid_on)}`:`${KIND_AR[kind]} · ${dmy(rec.record_date)}`;
  const input=([k,l,t])=>{const v=cur[k]??'',dis=auto&&['name','actual','category'].includes(k)?'disabled':'';
    if(t==='section')return `<div class="field"><label>${l}</label><select id="e_${k}">${Object.entries(SECTIONS_AR).map(([a,b])=>`<option value="${a}" ${(v||'auto')===a?'selected':''}>${b}</option>`).join('')}</select></div>`;
    if(t==='status')return `<div class="field"><label>${l}</label><select id="e_${k}">${['Paid','Unpaid','Partial','Not Due'].map(s=>`<option value="${s}" ${v===s?'selected':''}>${STATUS[s][0]}</option>`).join('')}</select></div>`;
    return `<div class="field"><label>${l}</label><input id="e_${k}" ${t==='num'?'type="number" inputmode="decimal" step="0.001"':t==='date'?'type="date"':''} value="${esc(t==='date'?String(v).slice(0,10):v)}" ${dis}></div>`};
  openSheet(`${head('تعديل '+KIND_AR[kind])}<div class="card"><p class="hint" style="margin-top:0">${esc(label)}</p>
   ${auto?'<p class="warn">هالمصروف محسوب تلقائياً من الفواتير، فالاسم والمبلغ ما بيتعدّلوا.</p>':''}
   ${old?`<p class="warn">${old.type==='delete'?'في طلب حذف لهالبند لسا ما انرفع.':'في تعديل لهالبند لسا ما انرفع، رح ينستبدل بهاد.'}</p>`:''}
   ${FORMS[kind].map(input).join('')}
   <button class="btn" id="eSave">احفظ التعديل</button>
   ${kind!=='period'&&!auto?'<button class="btn danger" id="eDel" style="margin-top:10px">احذف</button>':''}
   ${old?'<button class="btn white" id="eUndo" style="margin-top:10px">ألغِ الطلب اللي لسا ما انرفع</button>':''}</div>`);
  $('#closeSheet').onclick=closeSheet;
  const back=typeof backTo==='function'?backTo:()=>{kind==='payment'?paymentsScreen(rec._ob.id):viewScreen()};
  const queue=async(type,data)=>{if(old)await delEntry(old.id);
    await putEntry({id:crypto.randomUUID(),type,created_at:new Date().toISOString(),period_id:kind==='payment'?null:Number(kind==='period'?rec.id:VIEW.pid),period_label:periodLabel(VIEW.pid),
      data:{kind,id:Number(id),v:rec.v,label,...data},photos:[]});toast(type==='delete'?'انحفظ طلب الحذف ✓':'انحفظ التعديل ✓');back();syncNow()};
  $('#eSave').onclick=()=>{const changes={};
    for(const [k,,t] of FORMS[kind]){const el=$('#e_'+k);if(!el||el.disabled)continue;let v=el.value.trim();if(t==='num')v=v===''?null:Number(v);if(t==='date'&&v==='')v=null;
      const before=t==='section'?(rec[k]||'auto'):rec[k]??null,same=t==='num'?(before===null?v===null:v!==null&&Math.abs(Number(before)-v)<0.0005):String(before??'').slice(0,t==='date'?10:undefined)===String(v??'');
      if(!same)changes[k]=v}
    if(!Object.keys(changes).length)return old?toast('ما في تغيير جديد'):toast('ما غيّرت شي');
    // The same rule as the program: paid can't be more than actual (an empty actual takes the budget when Paid).
    if(kind==='expense'){const after={...rec,...changes};let actual=Number(after.actual||0);const paid=Number(after.paid_amount||0);
      if(after.status==='Paid'&&actual<=0&&!rec.auto_calculated)actual=Number(after.budget||0);
      if(paid>actual+.001)return toast(`المدفوع (${paid}) أكبر من الفعلي (${actual})${rec.auto_calculated?' — الفعلي محسوب من القراءة وما بيتغيّر':''}`,true)}
    queue('edit',{changes,before:Object.fromEntries(Object.keys(changes).map(k=>[k,rec[k]??null]))})};
  $('#eDel')&&($('#eDel').onclick=()=>{if(confirm(`تحذف "${label}"؟ بينحذف من البرنامج أول ما يصير في نت.`))queue('delete',{before:{}})});
  $('#eUndo')&&($('#eUndo').onclick=async()=>{await delEntry(old.id);toast('انلغى الطلب');back()});
}

// ---------- readings history: every electricity and water reading, with all its numbers ----------
let METERS='electricity';
const num=(v,d=3)=>v==null||v===''?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:d});
const row=(a,b,cls='')=>`<div class="line ${cls}"><span class="grow"><span>${a}</span></span><b class="num" dir="ltr">${b}</b></div>`;
async function metersScreen(kind=METERS){
  if(!CAT)return toast('حدّث القوائم من Drive أول',true);
  if(!CAT.meters)return toast('حدّث القوائم من Drive عشان توصل القراءات',true);
  METERS=kind;const el=kind==='electricity',list=CAT.meters[kind]||[],unit=el?'kWh':'م³',ch=await pendingChanges();
  const total=x=>Number(x.apartment_amount||0)+Number(x.roof_amount||0);
  openSheet(`${head('القراءات')}
   <div class="seg"><button type="button" data-k="electricity" class="${el?'on':''}">⚡ الكهرباء</button><button type="button" data-k="water" class="${el?'':'on'}">💧 المياه</button></div>
   <div class="card">${list.length?list.map((x,i)=>{const prev=list[i+1],c=ch[kind+':'+x.id],d=prev?Number(x.total_consumption||0)-Number(prev.total_consumption||0):null;
     const arrow=d==null||Math.abs(d)<0.0005?'':` <small style="color:${d>0?'var(--red)':'var(--green)'}">${d>0?'↑':'↓'} ${num(Math.abs(d),1)}</small>`;
     return `<button class="line ${c?.type==='delete'?'gone':''}" data-m="${x.id}"><span class="grow"><span>${dmy(x.record_date)}${x.period_date?` · شهر ${esc(monthLabel(x.period_date))}`:''} ${tag(c)}</span>
       <small>${num(x.total_consumption,1)} ${unit}${arrow}</small></span><span style="text-align:left"><b class="num">${money(total(x))}</b><br>${badge(x.status)}</span></button>`}).join('')
     :'<div class="empty">ما في قراءات.</div>'}</div>
   <p class="hint" style="text-align:center">السهم بيقارن الاستهلاك مع القراءة اللي قبلها.</p>`);
  $('#closeSheet').onclick=closeSheet;
  sheet.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>metersScreen(b.dataset.k));
  sheet.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>meterDetail(kind,b.dataset.m));
}
function meterDetail(kind,id){
  const x=(CAT.meters?.[kind]||[]).find(r=>String(r.id)===String(id));if(!x)return;const el=kind==='electricity';
  const meter=(n,what,a,b,use,u)=>row(n,`${num(a)} → ${num(b)}`)+row(`استهلاك ${what}`,`${num(use,1)} ${u}`);
  const body=el?`
     <div class="card"><div class="sub">العدادات</div>${meter('العداد الرئيسي','الكل',x.main_prev,x.main_current,x.total_consumption,'kWh')}${meter('عداد الروف','الروف',x.roof_prev,x.roof_current,x.roof_consumption,'kWh')}${meter('عداد السيارة','السيارة',x.car_prev,x.car_current,x.car_consumption,'kWh')}
       ${row('استهلاك الشقة (بدون الروف)',`${num(x.apartment_consumption,1)} kWh`)}${row('استهلاك البيت (بدون السيارة)',`${num(x.home_consumption,1)} kWh`)}${x.car_km?row('كيلومترات السيارة',num(x.car_km,0)):''}</div>
     <div class="card"><div class="sub">المبالغ</div>${row('البيت',money(x.home_amount))}${row('السيارة',money(x.car_amount))}${row('الشقة (البيت + السيارة)',money(x.apartment_amount))}${row('الروف',money(x.roof_amount))}
       ${row('الرسوم (مقسومة نصين)',money(x.fees))}${row('<b>المجموع</b>',money(Number(x.apartment_amount||0)+Number(x.roof_amount||0)))}</div>`
   :`<div class="card"><div class="sub">الاستهلاك</div>${row('استهلاك الفاتورة',`${num(x.total_consumption,1)} م³`)}${row('عداد الروف',`${num(x.roof_prev)} → ${num(x.roof_current)}`)}${row('استهلاك الروف',`${num(x.roof_consumption,1)} م³`)}${row('استهلاك الشقة',`${num(x.apartment_consumption,1)} م³`)}</div>
     <div class="card"><div class="sub">المبالغ</div>${row('مي الشقة',money(x.apartment_water))}${row('صرف صحي الشقة',money(x.apartment_sewer))}${row('<b>الشقة</b>',money(x.apartment_amount))}
       ${row('مي الروف',money(x.roof_water))}${row('صرف صحي الروف',money(x.roof_sewer))}${row('<b>الروف</b>',money(x.roof_amount))}${row('<b>المجموع</b>',money(Number(x.apartment_amount||0)+Number(x.roof_amount||0)))}</div>`;
  const diff=Number(x.validation_diff||0);
  openSheet(`${head(el?'⚡ قراءة كهرباء':'💧 قراءة مياه')}
   <div class="card">${row('تاريخ القراءة',dmy(x.record_date))}${row('تاريخ الفاتورة',dmy(x.bill_date))}${x.period_date?row('الشهر',esc(monthLabel(x.period_date))):''}${row('الحالة',badge(x.status))}</div>
   ${body}
   <div class="card"><div class="sub">الفاتورة</div>${row('مبلغ الفاتورة',x.invoice_amount?money(x.invoice_amount):'—')}${x.invoice_amount?row(Math.abs(diff)>0.01?'<span style="color:var(--amber)">الفرق عن الحساب</span>':'الفرق عن الحساب',money(diff)):''}
     ${x.notes?`<p class="hint">${esc(x.notes)}</p>`:''}</div>
   ${x.closed?'<p class="warn">هالشهر مسكّر، فالقراءة ما بتتعدّل من هون.</p>':'<button class="btn" id="mEdit">✏️ عدّل أو احذف</button>'}
   <button class="btn white" id="mBack" style="margin-top:10px">رجوع للقراءات</button>`);
  $('#closeSheet').onclick=closeSheet;$('#mBack').onclick=()=>metersScreen(kind);
  $('#mEdit')&&($('#mEdit').onclick=()=>{VIEW.pid=x.period_id;editRecord(kind,x.id,()=>metersScreen(kind))});
}

// ---------- the living-room AC's breaker, as the computer recorded it (read only here) ----------
const AC_EVENTS={on:'اشتغل',off:'انطفى',fault:'عطل',voltage:'الفولت برّا الطبيعي',offline:'انقطع الاتصال',online:'رجع الاتصال',gap:'استهلاك ناقص'};
const AC_FAULTS={ov_cr:'تيار زايد',ov_vol:'فولت عالي',ov_pwr:'حمل زايد',ls_cr:'تيار قليل',ls_vol:'فولت واطي',ls_pow:'حمل قليل'};
function acScreen(){
  const b=CAT?.breaker;if(!b)return toast('ما في بيانات للمكيف لسا',true);
  const L=b.live,max=Math.max(0.001,...b.hourly.map(h=>h.kwh||0)),cost=v=>v==null?'':`<span dir="ltr">${money(v)}</span>`;
  const chart=`<div style="display:flex;align-items:flex-end;gap:2px;height:90px;direction:ltr;margin-top:6px">${b.hourly.map(h=>`<div title="${h.hour}:00" style="flex:1;border-radius:3px 3px 0 0;height:${h.kwh==null?2:Math.max(3,h.kwh/max*86)}px;background:${h.kwh==null?'var(--border,#e5e7eb)':'var(--brand,#5b5cf0)'}"></div>`).join('')}</div>
    <div style="display:flex;justify-content:space-between;direction:ltr;font-size:11px;color:var(--muted)"><span>0</span><span>6</span><span>12</span><span>18</span><span>23</span></div>`;
  openSheet(`${head('❄️ مكيف الصالون')}
   <div class="card">${L?`${row('الحالة',L.online===false?'<span class="st no">مش متصل</span>':L.on?'<span class="st done">شغّال</span>':'<span class="st wait">مطفي</span>')}
     ${row('القدرة',`${num(L.power,1)} W`)}${row('الفولت',`${num(L.voltage,1)} V`)}${(L.faults||[]).length?row('<span style="color:var(--red)">عطل</span>',esc(L.faults.map(f=>AC_FAULTS[f]||f).join('، '))):''}
     <p class="hint" style="margin:6px 0 0">آخر قراءة من الكمبيوتر: <span dir="ltr">${esc(String(L.at||'').slice(0,16))}</span></p>`:'<p class="hint">ما في قراءة لسا.</p>'}
     ${b.last_report?`<p class="hint" style="margin:4px 0 0">آخر تقرير استهلاك من Tuya: <span dir="ltr">${esc(b.last_report.slice(0,16))}</span></p>`:''}</div>
   <div class="kpis"><div class="kpi"><small>اليوم</small><b class="num">${num(b.today_kwh,2)} kWh</b><small>${cost(b.today_cost)}</small></div>
    <div class="kpi"><small>هالشهر${b.month_first?` (من ${dmy(b.month_first).slice(0,5)})`:''}</small><b class="num">${num(b.month_kwh,2)} kWh</b><small>${cost(b.month_cost)}</small></div></div>
   <div class="card"><div class="sub">اليوم حسب الساعة</div>${chart}</div>
   ${b.daily.length?`<div class="card"><div class="sub">هالشهر حسب اليوم</div>${b.daily.slice().reverse().map(d=>row(dmy(d.day),`${num(d.kwh,2)} kWh${b.price_per_kwh?' · '+money(d.kwh*b.price_per_kwh):''}`)).join('')}</div>`:''}
   ${b.events.length?`<div class="card"><div class="sub">شو صار</div>${b.events.map(e=>row(esc(e.kind==='fault'?`عطل: ${AC_FAULTS[e.detail]||e.detail}`:AC_EVENTS[e.kind]||e.kind),esc(String(e.at).slice(5,16)))).join('')}</div>`:''}
   <p class="hint" style="text-align:center">${b.price_per_kwh?`التكلفة تقديرية بمعدّل سعر آخر فاتورة (${num(b.price_per_kwh*1000,1)} فلس/kWh). `:''}الاستهلاك من Tuya، والبرنامج عالكمبيوتر بيسحبه كل ما يشتغل. التشغيل والإطفاء من البرنامج عالكمبيوتر، لأنه القاطع على شبكة البيت.</p>`);
  $('#closeSheet').onclick=closeSheet;
}

// ---------- debts and installments: the details and every payment ----------
const OB_KIND={installment:'قسط',owed_to_me:'إلي عند حدا',i_owe:'علي لحدا'};
function debtsScreen(){
  if(!CAT)return toast('حدّث القوائم من Drive أول',true);
  const obs=(CAT.obligations||[]).slice().sort((a,b)=>(b.open-a.open)||String(a.next_due_date||'9').localeCompare(String(b.next_due_date||'9')));
  const sum=k=>obs.filter(o=>o.kind===k&&o.open).reduce((t,o)=>t+Number(o.remaining||0),0);
  const bar=p=>`<div style="height:6px;border-radius:9px;background:#eef0f5;margin-top:6px;overflow:hidden"><div style="height:100%;width:${Math.min(100,Math.max(0,Number(p)||0))}%;background:var(--green)"></div></div>`;
  openSheet(`${head('الديون والأقساط')}
   <div class="kpis"><div class="kpi"><small>باقي الأقساط</small><b class="num">${money(sum('installment'))}</b></div><div class="kpi"><small>علي لحدا</small><b class="num">${money(sum('i_owe'))}</b></div>
    <div class="kpi wide"><small>إلي عند الناس</small><b class="num">${money(sum('owed_to_me'))}</b></div></div>
   <div class="card">${obs.length?obs.map(o=>`<button class="line" data-ob="${o.id}" style="display:block"><span style="display:flex;justify-content:space-between;gap:8px"><span class="grow"><span>${esc(o.name)} <span class="st ${o.open?(o.overdue?'wait':'part'):'done'}" style="display:inline-block">${o.open?(o.overdue?'متأخر':OB_KIND[o.kind]||''):'خلص ✓'}</span></span>
      <small>${o.next_due_date?`الاستحقاق الجاي ${dmy(o.next_due_date)}`:o.counterparty?esc(o.counterparty):''}</small></span><span style="text-align:left"><b class="num">${money(o.remaining)}</b><br><small>باقي</small></span></span>${bar(o.progress)}</button>`).join('')
     :'<div class="empty">ما في ديون أو أقساط.</div>'}</div>`);
  $('#closeSheet').onclick=closeSheet;
  sheet.querySelectorAll('[data-ob]').forEach(b=>b.onclick=()=>debtDetail(b.dataset.ob));
}
async function debtDetail(oid){
  const o=(CAT.obligations||[]).find(x=>String(x.id)===String(oid));if(!o)return;const ch=await pendingChanges();
  const inst=o.total_installments?`${o.paid_installments} / ${o.total_installments}`:'—';
  openSheet(`${head(esc(o.name))}
   <div class="kpis"><div class="kpi"><small>الباقي</small><b class="num">${money(o.remaining)}</b></div><div class="kpi"><small>المدفوع</small><b class="num">${money(o.paid)}</b></div>
    <div class="kpi wide"><small>الإجمالي · ${num(o.progress,1)}% انْدفع</small><b class="num">${money(o.total)}</b></div></div>
   <div class="card">${row('النوع',OB_KIND[o.kind]||o.kind)}${o.counterparty?row('مع مين',esc(o.counterparty)):''}${o.monthly_amount?row('القسط الشهري',money(o.monthly_amount)):''}
     ${o.kind==='installment'?row('الأقساط المدفوعة',inst):''}${o.first_due_date?row('أول استحقاق',dmy(o.first_due_date)):''}
     ${o.next_due_date?row(o.overdue?'<span style="color:var(--red)">الاستحقاق الجاي (متأخر)</span>':'الاستحقاق الجاي',dmy(o.next_due_date)):''}
     ${o.notes?`<p class="hint">${esc(o.notes)}</p>`:''}</div>
   <div class="card"><div class="sub">كل الدفعات (${(o.payments||[]).length})</div>${(o.payments||[]).map(p=>{const c=ch['payment:'+p.id],x=withChange(p,c);return `<button class="line ${c?.type==='delete'?'gone':''}" data-pay="${p.id}"><span class="grow"><span>${dmy(x.paid_on)} ${tag(c)}</span><small>${esc(x.notes||'')}</small></span><b class="num">${money(x.amount)}</b></button>`}).join('')||'<div class="empty">ما في دفعات.</div>'}</div>
   ${o.open?'<button class="btn" id="dPay">💳 سجّل دفعة</button>':''}
   <button class="btn white" id="dBack" style="margin-top:10px">رجوع للديون</button>`);
  $('#closeSheet').onclick=closeSheet;$('#dBack').onclick=debtsScreen;
  $('#dPay')&&($('#dPay').onclick=()=>{paymentForm();const s=$('#fOb');if(s){s.value=String(o.id);s.dispatchEvent(new Event('change'))}});
  sheet.querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>editRecord('payment',b.dataset.pay,()=>debtDetail(o.id)));
}

