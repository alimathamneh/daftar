// Month picker, photos and meter OCR, and the add forms (expense, readings, payment).
'use strict';
// ---------- months, lists and labels ----------
function monthLabel(s){if(!s)return '—';const y0=+s.slice(0,4),m0=+s.slice(5,7),day=+s.slice(8,10),start=CAT?.month_start_day||25;let y=y0,m=m0;if(day>=start){m++;if(m>12){m=1;y++}}return `${String(m).padStart(2,'0')}/${y}`}
const openPeriods=()=>(CAT?.periods||[]).filter(p=>p.status!=='closed');
function periodSelect(id='fPeriod'){const ps=openPeriods();if(!ps.length)return `<div class="warn" style="margin-bottom:12px">ما في شهر مفتوح بالقوائم. حدّث القوائم من Drive، أو افتح شهر عالكمبيوتر.</div><input type="hidden" id="${id}" value="">`;
  return `<div class="field"><label>الشهر</label><select id="${id}">${ps.map(p=>`<option value="${p.id}">${monthLabel(p.period_date)}</option>`).join('')}</select></div>`}
const periodLabel=id=>{const p=(CAT?.periods||[]).find(x=>String(x.id)===String(id));return p?monthLabel(p.period_date):''};

// ---------- photos: shrunk on the phone so uploads stay small ----------
async function shrink(file){const url=URL.createObjectURL(file);try{const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url});
  const max=1600,s=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*s);c.height=Math.round(img.naturalHeight*s);
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);return await new Promise(res=>c.toBlob(b=>res(b||file),'image/jpeg',.82))}catch{return file}finally{URL.revokeObjectURL(url)}}
let PHOTOS=[];
function photoBlock(label){return `<div class="field"><label>${label}</label><div class="photos" id="photoList"></div><label class="pick">📷 صوّر أو اختار صورة<input type="file" accept="image/*" multiple id="photoInput"></label></div>`}
// ---------- meter numbers from a photo (Tesseract.js, bundled in ocr/ and run on the phone) ----------
let OCR=null;
async function ocrWorker(){
  if(OCR)return OCR;
  if(!window.Tesseract)await new Promise((res,rej)=>{const s=document.createElement('script');s.src='ocr/tesseract.min.js';s.onload=res;s.onerror=rej;document.head.append(s)});
  OCR=Tesseract.createWorker('eng',1,{workerPath:'ocr/worker.min.js',corePath:'ocr/',langPath:'ocr/',gzip:true,workerBlobURL:false})
    .then(async w=>{await w.setParameters({tessedit_pageseg_mode:'11'});return w}).catch(e=>{OCR=null;throw e});
  return OCR;
}
async function readMeter(blob,previous,avgUse){
  const url=URL.createObjectURL(blob),img=await new Promise((r,j)=>{const i=new Image();i.onload=()=>r(i);i.onerror=j;i.src=url});
  // Black-and-white copy (threshold at the image's mean) so the digits stand out from the meter face.
  const draw=(invert,binary)=>{const c=document.createElement('canvas'),s=Math.min(1,700/img.naturalWidth);c.width=img.naturalWidth*s;c.height=img.naturalHeight*s;
    const g=c.getContext('2d');g.filter=`grayscale(1) contrast(1.6)${invert?' invert(1)':''}`;g.drawImage(img,0,0,c.width,c.height);
    if(binary){const d=g.getImageData(0,0,c.width,c.height),px=d.data;let sum=0;for(let i=0;i<px.length;i+=4)sum+=px[i];const mean=sum/(px.length/4);
      for(let i=0;i<px.length;i+=4){const v=px[i]>mean?255:0;px[i]=px[i+1]=px[i+2]=v}g.putImageData(d,0,0)}
    return c};
  // Digital meters have dark digits on light, drum meters light on black; each photo is read four ways and the readings pooled.
  const w=await ocrWorker(),found=[];
  for(const [inv,bin] of [[false,false],[true,false],[false,true],[true,true]]){const {data}=await w.recognize(draw(inv,bin));
    for(const word of data.words||[]){const t=(word.text||'').replace(/[Oo]/g,'0').replace(/[Il|]/g,'1').replace(/S/g,'5').replace(/B/g,'8').replace(/\D/g,'');if(t.length>=3&&t.length<=8)
      found.push({n:Number(t),h:word.bbox.y1-word.bbox.y0,conf:word.confidence})}}
  URL.revokeObjectURL(url);if(!found.length)return null;
  const p=Number(previous),known=previous!=null&&previous!==''&&!isNaN(p);
  // A sensible reading is at or above the last one and not far beyond normal use.
  const room=Math.max(10*(Number(avgUse)||0),known?p*0.2:0,500);
  const fits=known?found.filter(x=>x.n>=p&&x.n-p<=room):found;
  const pool=fits.length?fits:known?[]:found;if(!pool.length)return null;
  // Big digits first (the counter is the largest text on the meter), then confidence.
  pool.sort((a,b)=>b.h-a.h||b.conf-a.conf);return pool[0].n;
}
function zoom(url){const z=document.createElement('div');z.className='zoom';z.innerHTML=`<img src="${url}" alt="">`;z.onclick=()=>z.remove();document.body.append(z)}

function drawPhotos(){const box=$('#photoList');if(!box)return;box.innerHTML=PHOTOS.map((p,i)=>`<span class="ph"><img src="${p.url}" alt="" data-zoom="${i}"><button type="button" data-rm="${i}">✕</button></span>`).join('');
  box.querySelectorAll('[data-zoom]').forEach(im=>im.onclick=()=>zoom(PHOTOS[+im.dataset.zoom].url));
  box.querySelectorAll('[data-rm]').forEach(b=>b.onclick=()=>{URL.revokeObjectURL(PHOTOS[+b.dataset.rm].url);PHOTOS.splice(+b.dataset.rm,1);drawPhotos()})}
function bindPhotos(){const inp=$('#photoInput');if(!inp)return;inp.onchange=async()=>{const pick=inp.closest('.pick'),txt=pick.firstChild.textContent;pick.firstChild.textContent='⏳ بجهّز الصور… ';
  try{await addPhotos(inp)}finally{pick.firstChild.textContent=txt}}}
async function addPhotos(inp){{for(const f of inp.files){if(PHOTOS.length>=6){toast('بكفي 6 صور',true);break}const blob=await shrink(f);PHOTOS.push({blob,name:f.name||'photo.jpg',url:URL.createObjectURL(blob)})}inp.value='';drawPhotos()}}

// ---------- forms ----------
const sheet=$('#sheet');
function openSheet(html){sheet.innerHTML=html;sheet.classList.remove('hidden');$('#home').classList.add('hidden');window.scrollTo(0,0)}
function closeSheet(){PHOTOS.forEach(p=>URL.revokeObjectURL(p.url));PHOTOS=[];if(MODE==='shop')return shoppingScreen();sheet.classList.add('hidden');sheet.innerHTML='';$('#home').classList.remove('hidden');renderHome()}
const head=t=>`<div class="top"><h1>${t}</h1><button class="icon-btn" id="closeSheet" aria-label="رجوع">✕</button></div>`;
const val=id=>($('#'+id)?.value||'').trim();
const numv=id=>{const v=val(id);return v===''?null:Number(v)};

async function save(type,data,periodId){
  const e={id:crypto.randomUUID(),type,created_at:new Date().toISOString(),period_id:periodId?Number(periodId):null,period_label:periodId?periodLabel(periodId):'',data,photos:PHOTOS.map(p=>({blob:p.blob,name:p.name}))};
  await putEntry(e);closeSheet();toast(navigator.onLine?'انحفظ ✓ وبيترفع هلأ':'انحفظ على الآيفون ✓');syncNow();
}

function expenseForm(){
  let mode='new';
  openSheet(`${head('مصروف')}<div class="card">${periodSelect()}
   <div class="seg"><button type="button" class="on" data-mode="new">مصروف جديد</button><button type="button" data-mode="pay">دفعة على مصروف</button></div>
   <div id="newBox"><div class="field"><label>اسم المصروف</label><input id="fName" list="names" autocomplete="off"><datalist id="names">${(CAT?.names||[]).map(n=>`<option value="${esc(n.name)}">`).join('')}</datalist></div>
     <div class="row"><div class="field"><label>الفئة</label><input id="fCat" list="cats" autocomplete="off"><datalist id="cats">${(CAT?.categories||[]).map(c=>`<option value="${esc(c)}">`).join('')}</datalist></div>
     <div class="field"><label>القسم</label><select id="fSection"><option value="auto">تلقائي</option><option value="apartment">الشقة</option><option value="car">السيارة</option><option value="roof">الروف</option></select></div></div></div>
   <div id="payBox" class="hidden"><div class="field"><label>المصروف</label><select id="fExpense"></select></div></div>
   <div class="row"><div class="field"><label>المبلغ (JOD)</label><input id="fAmount" type="number" inputmode="decimal" step="0.001"></div><div class="field"><label>التاريخ</label><input id="fDate" type="date" value="${today()}"></div></div>
   <label class="check" id="paidRow"><input type="checkbox" id="fPaid" checked> دفعته</label>
   <div class="field"><label>ملاحظات</label><input id="fNotes"></div>
   ${photoBlock('صورة الفاتورة أو الوصل (اختياري)')}
   <button class="btn" id="saveBtn">احفظ</button></div>`);
  const fillExpenses=()=>{const list=(CAT?.expenses?.[val('fPeriod')]||[]).filter(x=>Number(x.actual)-Number(x.paid_amount||0)>0.0005);
    $('#fExpense').innerHTML=list.length?list.map(x=>`<option value="${x.id}" data-rem="${(Number(x.actual)-Number(x.paid_amount||0)).toFixed(3)}">${esc(x.name)} — باقي ${money(Number(x.actual)-Number(x.paid_amount||0))}</option>`).join(''):'<option value="">ما في مصاريف عليها مبلغ باقي</option>';
    if(mode==='pay'){const o=$('#fExpense').selectedOptions[0];if(o?.dataset.rem)$('#fAmount').value=o.dataset.rem}};
  sheet.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;sheet.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('on',x===b));
    $('#newBox').classList.toggle('hidden',mode!=='new');$('#payBox').classList.toggle('hidden',mode!=='pay');$('#paidRow').classList.toggle('hidden',mode!=='new');fillExpenses()});
  $('#fPeriod')?.addEventListener('change',fillExpenses);$('#fExpense').onchange=()=>{const o=$('#fExpense').selectedOptions[0];if(o?.dataset.rem)$('#fAmount').value=o.dataset.rem};
  $('#fName').onchange=()=>{const n=(CAT?.names||[]).find(x=>x.name===val('fName'));if(n){if(!val('fCat'))$('#fCat').value=n.category||'';if(n.section)$('#fSection').value=n.section}};
  bindPhotos();$('#closeSheet').onclick=closeSheet;
  $('#saveBtn').onclick=()=>{const amount=numv('fAmount');if(!(amount>0))return toast('اكتب المبلغ',true);if(!val('fPeriod'))return toast('اختار الشهر',true);
    if(mode==='new'){if(!val('fName'))return toast('اكتب اسم المصروف',true);
      return save('expense',{mode:'new',name:val('fName'),category:val('fCat')||'أخرى',section:val('fSection'),amount,paid:$('#fPaid').checked,date:val('fDate'),notes:val('fNotes')},val('fPeriod'))}
    const o=$('#fExpense').selectedOptions[0];if(!o?.value)return toast('اختار المصروف',true);
    save('expense',{mode:'pay',expense_id:Number(o.value),name:o.textContent.split(' — ')[0],amount,date:val('fDate'),notes:val('fNotes')},val('fPeriod'))};
}

function readingForm(kind){
  const el=kind==='electricity',last=el?CAT?.last_electricity:CAT?.last_water;
  const prev=k=>last?.[k]!=null?`<span class="hint">السابقة: <span class="num">${last[k]}</span></span>`:'';
  openSheet(`${head(el?'قراءة كهرباء':'قراءة مياه')}<div class="card">${periodSelect()}
   <div class="row"><div class="field"><label>تاريخ القراءة</label><input id="fDate" type="date" value="${today()}"></div><div class="field"><label>تاريخ الفاتورة</label><input id="fBill" type="date" value="${today()}"></div></div>
   ${el?`<div class="field"><label>العداد الرئيسي الحالي</label><input id="fMain" type="number" inputmode="decimal" step="0.001">${prev('main_current')}</div>
   <div class="row"><div class="field"><label>عداد الروف الحالي</label><input id="fRoof" type="number" inputmode="decimal" step="0.001">${prev('roof_current')}</div>
   <div class="field"><label>عداد السيارة الحالي</label><input id="fCar" type="number" inputmode="decimal" step="0.001">${prev('car_current')}</div></div>
   <div class="row"><div class="field"><label>إجمالي الفاتورة (اختياري)</label><input id="fInvoice" type="number" inputmode="decimal" step="0.001"></div><div class="field"><label>الرسوم</label><input id="fFees" type="number" inputmode="decimal" step="0.001" value="0"></div></div>
   <div class="field"><label>كيلومترات السيارة (اختياري)</label><input id="fKm" type="number" inputmode="decimal"></div>`
   :`<div class="row"><div class="field"><label>عداد الروف الحالي</label><input id="fRoof" type="number" inputmode="decimal" step="0.001">${prev('roof_current')}</div>
   <div class="field"><label>استهلاك الفاتورة (م³)</label><input id="fTotal" type="number" inputmode="decimal" step="0.001"></div></div>
   <div class="field"><label>إجمالي الفاتورة (اختياري)</label><input id="fInvoice" type="number" inputmode="decimal" step="0.001"></div>`}
   <div class="field"><label>ملاحظات</label><input id="fNotes"></div>
   <div id="readWarn" class="warn" style="margin-bottom:10px"></div>
   <div id="calcBox" style="margin-bottom:10px"></div>
   ${photoBlock('صور العدادات والفاتورة')}
   <button class="btn" id="saveBtn">احفظ</button></div>`);
  const avg=CAT?.avg_use||{};
  const check=()=>{const w=[];const test=(id,k,n,a)=>{const v=numv(id);if(v==null||last?.[k]==null)return;const use=v-Number(last[k]);
      if(use<0)w.push(`${n} أقل من القراءة السابقة`);else if(a>0&&use>2*a)w.push(`${n}: الاستهلاك ${Math.round(use)} أكثر من ضعف المعدّل (${Math.round(a)})`)};
    if(el){test('fMain','main_current','العداد الرئيسي',avg.main);test('fCar','car_current','عداد السيارة',avg.car);test('fRoof','roof_current','عداد الروف',avg.roof)}
    else test('fRoof','roof_current','عداد الروف',avg.water_roof);$('#readWarn').textContent=w.join(' · ');preview()};
  $('#fPeriod')?.addEventListener('change',()=>check());
  // The reading a new one is measured from, by the same rule as saving (Home.previous in direct.js):
  // the latest reading of an earlier month than the one chosen.
  const prevOf=()=>{const p=(CAT?.periods||[]).find(x=>String(x.id)===String(val('fPeriod'))),list=CAT?.meters?.[kind];if(!p||!list)return last||{};
    return list.filter(x=>x.period_date&&x.period_date<p.period_date).sort((a,b)=>b.period_date.localeCompare(a.period_date)||String(b.record_date).localeCompare(String(a.record_date)))[0]||{}};
  // Live bill preview with the same formulas the PC uses; nothing is saved until "احفظ".
  const preview=()=>{const box=$('#calcBox'),t=CAT?.tariffs?.[kind]||undefined,L=prevOf(),k3=x=>`${(+x).toFixed(3)} JOD`,q=x=>Math.round(+x*1000)/1000;
    let rows=[];
    if(el){const mc=numv('fMain');if(mc==null||L.main_current==null){box.innerHTML='';return}
      const c=Direct.calcElectric({main_prev:L.main_current,main_current:mc,roof_prev:L.roof_current,roof_current:numv('fRoof')??L.roof_current,car_prev:L.car_current,car_current:numv('fCar')??L.car_current,fees:numv('fFees')||0,invoice_amount:numv('fInvoice')},t);
      rows=[['الاستهلاك الكلي',`${q(c.total_consumption)} kWh`],['البيت',`${q(c.home_consumption)} kWh · ${k3(c.home_amount)}`],['السيارة',`${q(c.car_consumption)} kWh · ${k3(c.car_amount)}`],['الروف',`${q(c.roof_consumption)} kWh · ${k3(c.roof_amount)}`],['المجموع',k3(c.apartment_amount+c.roof_amount)]];
      if(numv('fInvoice')!=null)rows.push(['الفرق عن الفاتورة',k3(c.check_diff)])}
    else{const tot=numv('fTotal');if(tot==null){box.innerHTML='';return}
      const c=Direct.calcWater({total_consumption:tot,roof_prev:L.roof_current,roof_current:numv('fRoof')??L.roof_current,invoice_amount:numv('fInvoice')},t);
      rows=[['البيت',`${q(c.apartment_consumption)} م³ · ${k3(c.apartment_amount)}`],['الروف',`${q(c.roof_consumption)} م³ · ${k3(c.roof_amount)}`],['المجموع',k3(c.calculated_bill)]];
      if(numv('fInvoice')!=null)rows.push(['الفرق عن الفاتورة',k3(c.check_diff)])}
    box.innerHTML=`<div class="card" style="padding:10px"><b>🧮 الحساب</b>${rows.map(([a,b])=>`<div style="display:flex;justify-content:space-between;gap:8px"><span>${a}</span><span class="num">${b}</span></div>`).join('')}${t?'':'<small class="hint">بالتعرفة الافتراضية — حدّث القوائم من Drive لتاخذ تعرفتك</small>'}</div>`};
  sheet.querySelectorAll('input[type=number]').forEach(i=>i.addEventListener('input',check));
  // "Read from photo" under each meter: the photo is kept with the reading and the number is only a suggestion.
  const meters=el?[['fMain','main_current'],['fRoof','roof_current'],['fCar','car_current']]:[['fRoof','roof_current']];
  for(const [id,k] of meters){const inp=$('#'+id);const b=document.createElement('label');b.className='ocrbtn';
    b.innerHTML='📷 اقرأ الرقم من صورة<input type="file" accept="image/*" capture="environment">';inp.after(b);
    b.querySelector('input').onchange=async ev=>{const f=ev.target.files[0];ev.target.value='';if(!f)return;
      const blob=await shrink(f);PHOTOS.push({blob,name:`${id}.jpg`,url:URL.createObjectURL(blob)});drawPhotos();
      b.firstChild.textContent='⏳ عم بقرأ الرقم… ';
      try{const n=await readMeter(blob,last?.[k],{main_current:avg.main,roof_current:el?avg.roof:avg.water_roof,car_current:avg.car}[k]);if(n==null)toast('ما قدرت أقرأ الرقم، اكتبه بإيدك',true);
        else{inp.value=n;inp.classList.add('ocr');inp.dispatchEvent(new Event('input'));toast('انقرأ الرقم من الصورة — تأكد منه')}}
      catch(e){toast('القراءة من الصورة بتحتاج نت أول مرة',true)}
      finally{b.firstChild.textContent='📷 اقرأ الرقم من صورة'}};
    inp.addEventListener('input',e=>{if(e.isTrusted)inp.classList.remove('ocr')})}
  bindPhotos();$('#closeSheet').onclick=closeSheet;
  $('#saveBtn').onclick=()=>{if(!val('fPeriod'))return toast('اختار الشهر',true);
    const data=el?{record_date:val('fDate'),bill_date:val('fBill'),main_current:numv('fMain'),roof_current:numv('fRoof'),car_current:numv('fCar'),invoice_amount:numv('fInvoice'),fees:numv('fFees')||0,car_km:numv('fKm'),notes:val('fNotes')}
      :{record_date:val('fDate'),bill_date:val('fBill'),roof_current:numv('fRoof'),total_consumption:numv('fTotal'),invoice_amount:numv('fInvoice'),notes:val('fNotes')};
    if(el&&data.main_current==null)return toast('اكتب قراءة العداد الرئيسي',true);
    if(!el&&data.total_consumption==null&&data.roof_current==null)return toast('اكتب القراءة',true);
    if(!PHOTOS.length&&!confirm('ما في صورة للعداد. تحفظ بدون صورة؟'))return;
    save(kind,data,val('fPeriod'))};
}

function paymentForm(){
  const obs=(CAT?.obligations||[]).filter(o=>o.open!==false);
  openSheet(`${head('دفعة قسط أو دين')}<div class="card">
   ${obs.length?`<div class="field"><label>الحساب</label><select id="fOb">${obs.map(o=>`<option value="${o.id}" data-m="${o.monthly_amount||''}">${esc(o.name)} — باقي ${money(o.remaining)}</option>`).join('')}</select></div>`:'<div class="warn" style="margin-bottom:12px">ما في أقساط مفتوحة بالقوائم. حدّث القوائم من Drive.</div>'}
   <div class="row"><div class="field"><label>المبلغ (JOD)</label><input id="fAmount" type="number" inputmode="decimal" step="0.001"></div><div class="field"><label>تاريخ الدفع</label><input id="fDate" type="date" value="${today()}"></div></div>
   <label class="check"><input type="checkbox" id="fLink" checked> سجّلها كمصروف بالشهر</label>
   <div id="linkBox">${periodSelect()}</div>
   <div class="field"><label>ملاحظات</label><input id="fNotes"></div>
   ${photoBlock('صورة الوصل (اختياري)')}
   <button class="btn" id="saveBtn" ${obs.length?'':'disabled'}>احفظ</button></div>`);
  const fill=()=>{const o=$('#fOb')?.selectedOptions[0];if(o?.dataset.m)$('#fAmount').value=o.dataset.m};fill();
  $('#fOb')&&($('#fOb').onchange=fill);$('#fLink').onchange=()=>$('#linkBox').classList.toggle('hidden',!$('#fLink').checked);
  bindPhotos();$('#closeSheet').onclick=closeSheet;
  $('#saveBtn').onclick=()=>{const amount=numv('fAmount');if(!(amount>0))return toast('اكتب المبلغ',true);const o=$('#fOb').selectedOptions[0];
    const link=$('#fLink').checked;if(link&&!val('fPeriod'))return toast('اختار الشهر',true);
    save('payment',{obligation_id:Number(o.value),obligation_name:o.textContent.split(' — ')[0],amount,paid_on:val('fDate'),link_to_expenses:link,notes:val('fNotes')},link?val('fPeriod'):null)};
}

