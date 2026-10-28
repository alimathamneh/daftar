// View, edit and delete records; the roof statement; month reports; payments.
'use strict';
// ---------- view, edit and delete (requests the computer applies after you approve them there) ----------
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
const tag=ch=>ch?(ch.type==='delete'?'<span class="st wait">بينحذف</span>':'<span class="st edit">بانتظار الكمبيوتر</span>'):'';

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
   <p class="hint" style="text-align:center">البيانات من آخر تحديث للقوائم: ${dmy(CAT.generated_at)}. التعديلات بتوصل للكمبيوتر بعد الرفع والموافقة.</p>`);
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
  return (CAT.readings?.[pid]?.[kind]||[]).find(eq)}
async function editRecord(kind,id){
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
  const back=()=>{kind==='payment'?paymentsScreen(rec._ob.id):viewScreen()};
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
  $('#eDel')&&($('#eDel').onclick=()=>{if(confirm(`تحذف "${label}"؟ الحذف بيصير عالكمبيوتر لما توافق عليه هناك.`))queue('delete',{before:{}})});
  $('#eUndo')&&($('#eUndo').onclick=async()=>{await delEntry(old.id);toast('انلغى الطلب');back()});
}

