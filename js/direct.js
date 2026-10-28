/* Direct mode: the iPhone reads and edits the encrypted database copy on Drive itself, whether or not the
   computer is running.

   The rules follow the server one for one (expense, payment, reading, month and delete handlers, the electricity
   and water formulas with the fee split half/half, closed months, audit log and change history), so the
   computer opens the result as if it had made the change. A running computer takes the newer copy in within
   half a minute (workers.phone_worker); it uploads its own changes a few seconds after making them.
   Drive layout and snapshot format: server/sync/drive_sync.py (head file, state-<revision>.enc, zip with manifest). */
(() => {
'use strict';
const HEAD='home-monthly-head.json';
const EDITABLE={expense:['name','category','section','budget','actual','paid_amount','status','payment_date','notes'],
  electricity:['record_date','bill_date','main_current','roof_current','car_current','invoice_amount','fees','notes'],
  water:['record_date','bill_date','total_consumption','roof_current','invoice_amount','notes'],payment:['amount','paid_on','notes'],period:['salary','notes']};
const TABLES={expense:'expenses',electricity:'electricity',water:'water',payment:'obligation_payments',period:'periods'};
const DEFAULT_ELECTRIC={tiers:[[300,.05],[300,.10],[null,.20]],fee_split:'half'};
const DEFAULT_WATER={water_base:2.5,sewer_base:.23,water_rates:[.6,.8,1.1,1.4,1.8,2.2],sewer_rates:[.15,.5,.7,.85,.95,1.2],bounds:[6,12,18,24,30,42]};
const SECTIONS=['apartment','car','roof'];

// ---------- small helpers (same meaning as in app.py) ----------
const sf=v=>{if(v===null||v===undefined||v==='')return 0;const n=Number(v);return Number.isFinite(n)?n:0};
const r=(v,d)=>{const f=10**d;return Math.round(v*f)/f};
const pad=n=>String(n).padStart(2,'0');
const nowIso=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`};
const isoDay=(v,label,optional=false)=>{if(optional&&!v)return null;const s=String(v||'').slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||isNaN(Date.parse(s)))throw new Error(`${label}: تاريخ غير صحيح`);return s};
const money=(v,label,allowZero=false)=>{const n=Number(v);if(!Number.isFinite(n)||n<0||(!allowZero&&n<=0)||n>1e11)throw new Error(`${label}: مبلغ غير صحيح`);return r(n,3)};
const optMoney=(v,label)=>v===null||v===undefined||String(v).trim()===''?0:money(v,label,true);
const cleanSection=v=>{v=String(v||'').trim().toLowerCase();if(v==='home')v='apartment';if(v===''||v==='auto')return null;if(!SECTIONS.includes(v))throw new Error('القسم غير صحيح');return v};
const hex=buf=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
async function version(kind,row){const norm=v=>typeof v==='number'?r(v,3).toFixed(3):(v===null||v===undefined?'':String(v));
  return hex(await crypto.subtle.digest('SHA-1',new TextEncoder().encode(EDITABLE[kind].map(k=>norm(row[k])).join('\x1f')))).slice(0,16)}

// ---------- libraries, loaded the first time direct mode is used ----------
let SQLP=null;
const script=src=>new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(new Error('ما قدرت أحمّل '+src));document.head.append(s)});
async function libs(){if(!window.JSZip)await script('lib/jszip.min.js');if(!SQLP){await script('lib/sql-wasm.js');SQLP=initSqlJs({locateFile:f=>'lib/'+f})}return SQLP}

class Store{
  constructor(db){this.db=db}
  all(sql,p=[]){const st=this.db.prepare(sql);st.bind(p.map(v=>v===undefined?null:v));const out=[];while(st.step())out.push(st.getAsObject());st.free();return out}
  one(sql,p){return this.all(sql,p)[0]||null}
  run(sql,p=[]){this.db.run(sql,p.map(v=>v===undefined?null:v));return this.one('SELECT last_insert_rowid() id').id}
}

// ---------- the formulas (app.py calc_electric / progressive_total / calc_water) ----------
function calcElectric(d,t){
  t=t||DEFAULT_ELECTRIC;const mp=sf(d.main_prev),mc=sf(d.main_current),rp=sf(d.roof_prev),rc=sf(d.roof_current),cp=sf(d.car_prev),cc=sf(d.car_current),fees=sf(d.fees),inv=sf(d.invoice_amount);
  const errors=[];if(mc<mp)errors.push('main');if(rc<rp)errors.push('roof');if(cc<cp)errors.push('car');
  const total=Math.max(mc-mp,0),roof=Math.max(rc-rp,0),apt=Math.max(total-roof,0),car=Math.max(cc-cp,0),home=Math.max(apt-car,0);
  if(roof>total)errors.push('roof>total');if(car>apt)errors.push('car>apt');
  const tiers=t.tiers||DEFAULT_ELECTRIC.tiers,tax=1+sf(t.tax_percent)/100;
  const cost=q=>{let rem=Math.max(q,0),c=0;for(const [cap,rate] of tiers){const use=cap===null||cap===undefined?rem:Math.min(rem,sf(cap));c+=use*sf(rate);rem-=use;if(rem<=1e-9)break}return c};
  const aptE=cost(apt)*tax,roofE=Math.max(cost(apt+roof)-cost(apt),0)*tax;
  const aptAmt=aptE+(apt>0?fees/2:0),roofAmt=roofE+(roof>0?fees/2:0),carShare=apt>0?car/apt:0,carAmt=carShare*aptAmt,homeAmt=aptAmt-carAmt,diff=inv-(aptAmt+roofAmt);
  return {total_consumption:r(total,6),roof_consumption:r(roof,6),apartment_consumption:r(apt,6),home_consumption:r(home,6),car_consumption:r(car,6),
    apartment_amount:r(aptAmt,6),roof_amount:r(roofAmt,6),car_share:carShare,car_amount:r(carAmt,6),home_amount:r(homeAmt,6),check_diff:r(diff,6),valid:!errors.length&&Math.abs(diff)<=.01}
}
function progressive(cons,kind,t){
  const x=Math.max(sf(cons),0);if(x<=0)return 0;const base=sf(kind==='water'?t.water_base:t.sewer_base),rates=kind==='water'?t.water_rates:t.sewer_rates,b=t.bounds||[6,12,18,24,30,42];
  let total=base;if(x<=sf(b[0]))return total;let prev=sf(b[0]);const up=[...b.slice(1),null];
  for(let i=0;i<up.length;i++){const rate=sf(rates[i]);if(up[i]===null){total+=Math.max(x-prev,0)*rate;break}const u=sf(up[i]);total+=Math.max(0,Math.min(x,u)-prev)*rate;if(x<=u)break;prev=u}
  return total;
}
function calcWater(d,t){
  t=t||DEFAULT_WATER;const total=Math.max(sf(d.total_consumption),0),rp=sf(d.roof_prev),rc=sf(d.roof_current),inv=sf(d.invoice_amount),errors=[];
  if(rc<rp)errors.push('roof');const roof=Math.max(rc-rp,0),apt=Math.max(total-roof,0);if(roof>total)errors.push('roof>total');
  let aw=apt>0?progressive(apt,'water',t):0,asw=apt>0?progressive(apt,'sewer',t):0;const tw=total>0?progressive(total,'water',t):0,ts=total>0?progressive(total,'sewer',t):0;
  let rw=roof>0?Math.max(tw-aw,0):0,rs=roof>0?Math.max(ts-asw,0):0;const tax=1+sf(t.tax_percent)/100;aw*=tax;asw*=tax;rw*=tax;rs*=tax;
  const aa=aw+asw,ra=rw+rs,diff=inv-(aa+ra);
  return {roof_consumption:r(roof,6),apartment_consumption:r(apt,6),roof_water:r(rw,6),roof_sewer:r(rs,6),roof_amount:r(ra,6),apartment_water:r(aw,6),
    apartment_sewer:r(asw,6),apartment_amount:r(aa,6),calculated_bill:r(aa+ra,6),check_diff:r(diff,6),valid:!errors.length&&Math.abs(diff)<=.01}
}

// ---------- the handlers ----------
class Home{
  constructor(store,zip,actor){this.s=store;this.zip=zip;this.actor=actor;this.event=''}
  locked(pid){const p=this.s.one('SELECT status FROM periods WHERE id=?',[pid]);return !!(p&&p.status==='closed')}
  needOpen(pid){if(this.locked(pid))throw new Error('هالشهر مسكّر. افتحه من الكمبيوتر أول.')}
  audit(action,type,id,details=''){this.s.run('INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)',[this.actor,action,type,id,details])}
  tariff(util,day){const row=this.s.one('SELECT * FROM tariff_versions WHERE utility=? AND effective_date<=? ORDER BY effective_date DESC,id DESC LIMIT 1',[util,day||new Date().toISOString().slice(0,10)]);
    try{return row?JSON.parse(row.config_json):null}catch{return null}}
  previous(table,pid){const p0=this.s.one('SELECT period_date FROM periods WHERE id=?',[pid]);if(!p0)return {};
    return this.s.one(`SELECT x.* FROM ${table} x JOIN periods p ON p.id=x.period_id WHERE p.period_date<? ORDER BY p.period_date DESC,x.record_date DESC LIMIT 1`,[p0.period_date])||{}}
  syncUtility(pid,name,amount,source){
    const aliases={'كهرباء':['كهرباء','Electricity'],'كهربا سيارة':['كهربا سيارة','كهرباء سيارة','Car Electricity'],'ماء':['ماء','مياه','Water']};
    let found=null;for(const a of aliases[name]||[name]){found=this.s.one('SELECT id FROM expenses WHERE period_id=? AND name=? LIMIT 1',[pid,a]);if(found)break}
    if(found)this.s.run(`UPDATE expenses SET actual=?,source_type=?,auto_calculated=1,status=CASE WHEN status='Paid' THEN 'Paid' ELSE ? END,updated_at=? WHERE id=?`,[amount,source,'Unpaid',nowIso(),found.id]);
    else{const o=this.s.one('SELECT COALESCE(MAX(sort_order),0)+1 n FROM expenses WHERE period_id=?',[pid]).n;
      this.s.run('INSERT INTO expenses(period_id,category,name,budget,actual,status,sort_order,source_type,auto_calculated,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[pid,'Utilities',name,0,amount,'Unpaid',o,source,1,nowIso(),nowIso()])}}
  paidFromBudget(d,old){if(d.status!=='Paid')return;const get=k=>k in d?d[k]:old?old[k]:null;let budget=sf(get('budget')),actual=sf(get('actual'));const paid=sf(get('paid_amount'));
    if(actual<=0&&budget>0)d.actual=actual=budget;if(paid<=0&&actual>0)d.paid_amount=actual}
  addExpense(d){const pid=Number(d.period_id);if(!this.s.one('SELECT 1 FROM periods WHERE id=?',[pid]))throw new Error('الشهر مش موجود');this.needOpen(pid);
    this.paidFromBudget(d);const budget=optMoney(d.budget,'الميزانية'),actual=optMoney(d.actual,'الفعلي'),paid=optMoney(d.paid_amount,'المدفوع');if(paid>actual+.001)throw new Error('المدفوع أكبر من الفعلي');
    const due=isoDay(d.due_date,'الاستحقاق',true),pay=isoDay(d.payment_date,'الدفع',true),o=this.s.one('SELECT COALESCE(MAX(sort_order),0)+1 n FROM expenses WHERE period_id=?',[pid]).n;
    const id=this.s.run(`INSERT INTO expenses(period_id,category,name,budget,actual,status,sort_order,due_date,paid_amount,payment_date,payment_method,recurring,notes,auto_calculated,source_type,section,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,[pid,d.category||'Other',d.name||'New expense',budget,actual,d.status||'Unpaid',o,due,paid,pay,d.payment_method||'',d.recurring?1:0,d.notes||'',0,'',cleanSection(d.section),nowIso(),nowIso()]);
    this.audit('create','expense',id,d.name||'');return id}
  updateExpense(id,d){const e0=this.s.one('SELECT * FROM expenses WHERE id=?',[id]);if(!e0)throw new Error('المصروف مش موجود');this.needOpen(e0.period_id);
    if(e0.auto_calculated&&['actual','name','category'].some(k=>k in d)){d.actual=e0.actual;d.name=e0.name;d.category=e0.category}
    if(!e0.auto_calculated)this.paidFromBudget(d,e0);
    const newPaid='paid_amount' in d?d.paid_amount:e0.paid_amount,changed=Math.abs(sf(newPaid)-sf(e0.paid_amount))>.0005;
    const budget=optMoney('budget' in d?d.budget:e0.budget,'الميزانية'),actual=optMoney('actual' in d?d.actual:e0.actual,'الفعلي'),paid=optMoney(newPaid,'المدفوع');
    if(changed&&paid>actual+.001)throw new Error('المدفوع أكبر من الفعلي');
    const due=isoDay(d.due_date,'الاستحقاق',true),pay=isoDay(d.payment_date,'الدفع',true),section='section' in d?cleanSection(d.section):e0.section;
    this.s.run('UPDATE expenses SET category=?,name=?,budget=?,actual=?,status=?,due_date=?,paid_amount=?,payment_date=?,payment_method=?,recurring=?,notes=?,section=?,updated_at=? WHERE id=?',
      ['category' in d?d.category:e0.category,'name' in d?d.name:e0.name,budget,actual,'status' in d?d.status:e0.status,due,paid,pay,'payment_method' in d?d.payment_method:e0.payment_method,
       ('recurring' in d?d.recurring:e0.recurring)?1:0,'notes' in d?d.notes:e0.notes,section,nowIso(),id]);this.audit('update','expense',id,e0.name)}
  deleteExpense(id){const e=this.s.one('SELECT * FROM expenses WHERE id=?',[id]);if(!e)throw new Error('المصروف مش موجود');this.needOpen(e.period_id);
    if(e.auto_calculated)throw new Error('هالمصروف محسوب تلقائياً، بينحذف من مكانه');this.s.run('DELETE FROM expenses WHERE id=?',[id]);this.audit('delete','expense',id,e.name)}
  updatePeriod(id,d){this.needOpen(id);const p=this.s.one('SELECT * FROM periods WHERE id=?',[id]);if(!p)throw new Error('الشهر مش موجود');
    this.s.run('UPDATE periods SET salary=?,notes=?,updated_at=? WHERE id=?',[optMoney('salary' in d?d.salary:p.salary,'الراتب'),'notes' in d?d.notes||'':p.notes||'',nowIso(),id]);this.audit('update','period',id,'Period details updated')}
  addReading(table,d){const pid=Number(d.period_id);this.needOpen(pid);const t=this.tariff(table,d.bill_date||d.record_date);const calc=table==='electricity'?calcElectric(d,t):calcWater(d,t);
    const p={...d,...calc,status:d.status||(calc.valid?'Calculated':'Draft'),tariff_snapshot:JSON.stringify(t||(table==='electricity'?DEFAULT_ELECTRIC:DEFAULT_WATER)),validation_diff:calc.check_diff};
    const keys=table==='electricity'?['period_id','record_date','bill_date','period_label','main_prev','main_current','total_consumption','invoice_amount','fees','roof_prev','roof_current','roof_consumption','roof_amount','apartment_consumption','apartment_amount','car_prev','car_current','home_consumption','car_consumption','car_share','car_amount','home_amount','car_km','status','tariff_snapshot','validation_diff','notes']
      :['period_id','record_date','bill_date','period_label','invoice_amount','total_consumption','roof_prev','roof_current','roof_consumption','apartment_consumption','roof_water','roof_sewer','roof_amount','apartment_water','apartment_sewer','apartment_amount','status','tariff_snapshot','validation_diff','notes'];
    const id=this.s.run(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,keys.map(k=>p[k]??null));
    this.audit('create',table,id,`Validation ${calc.check_diff}`);return id}
  updateReading(table,id,d){const r0=this.s.one(`SELECT * FROM ${table} WHERE id=?`,[id]);if(!r0)throw new Error('القراءة مش موجودة');this.needOpen(r0.period_id);
    const calcKeys=table==='electricity'?['record_date','bill_date','invoice_amount','fees','main_prev','main_current','roof_prev','roof_current','car_prev','car_current','car_km']:['record_date','bill_date','invoice_amount','total_consumption','roof_prev','roof_current'];
    const rec={...r0};for(const [k,v] of Object.entries(d))if(v!==null&&v!==undefined)rec[k]=v;
    if(calcKeys.some(k=>k in d)){let t;try{t=r0.tariff_snapshot?JSON.parse(r0.tariff_snapshot):this.tariff(table,rec.bill_date||rec.record_date)}catch{t=this.tariff(table,rec.bill_date||rec.record_date)}
      const res=table==='electricity'?calcElectric(rec,t):calcWater(rec,t);Object.assign(rec,res,{validation_diff:res.check_diff,tariff_snapshot:JSON.stringify(t)});
      const keys=table==='electricity'?['record_date','bill_date','period_label','main_prev','main_current','total_consumption','invoice_amount','fees','roof_prev','roof_current','roof_consumption','roof_amount','apartment_consumption','apartment_amount','car_prev','car_current','home_consumption','car_consumption','car_share','car_amount','home_amount','car_km','status','tariff_snapshot','validation_diff','notes']
        :['record_date','bill_date','period_label','invoice_amount','total_consumption','roof_prev','roof_current','roof_consumption','apartment_consumption','roof_water','roof_sewer','roof_amount','apartment_water','apartment_sewer','apartment_amount','status','tariff_snapshot','validation_diff','notes'];
      this.s.run(`UPDATE ${table} SET ${keys.map(k=>k+'=?').join(',')} WHERE id=?`,[...keys.map(k=>rec[k]??null),id])}
    else for(const k of ['status','notes'])if(k in d)this.s.run(`UPDATE ${table} SET ${k}=? WHERE id=?`,[d[k],id]);
    this.audit('update',table,id)}
  deleteReading(table,id){const r0=this.s.one(`SELECT * FROM ${table} WHERE id=?`,[id]);if(!r0)throw new Error('القراءة مش موجودة');this.needOpen(r0.period_id);
    this.s.run(`DELETE FROM ${table} WHERE id=?`,[id]);
    this.audit('delete',table,id)}
  checkPayment(account,d,paymentId){const amount=money(d.amount,'المبلغ'),paidOn=isoDay(d.paid_on,'تاريخ الدفع');let pid=Number(d.period_id)||null;const link=!!d.link_to_expenses;
    if(link){if(account.kind==='owed_to_me')throw new Error('الدين اللي إلك ما بيصير مصروف');if(!pid)throw new Error('اختار الشهر');if(!this.s.one('SELECT 1 FROM periods WHERE id=?',[pid]))throw new Error('الشهر مش موجود');this.needOpen(pid)}
    else if(pid&&!this.s.one('SELECT 1 FROM periods WHERE id=?',[pid]))pid=null;
    const prev=this.s.one('SELECT COALESCE(SUM(amount),0) t FROM obligation_payments WHERE obligation_id=? AND id!=?',[account.id,paymentId||-1]).t;
    if(prev+amount>sf(account.total_amount)+.001)throw new Error('الدفعة أكبر من الباقي');
    return {amount,paid_on:paidOn,paid_by:String(d.paid_by||'').slice(0,140),notes:String(d.notes||'').slice(0,3000),period_id:link?pid:null,link}}
  dropPaymentExpense(eid){if(!eid)return;const e=this.s.one('SELECT period_id FROM expenses WHERE id=?',[eid]);if(e&&this.locked(e.period_id))throw new Error('المصروف المربوط بشهر مسكّر');this.s.run('DELETE FROM expenses WHERE id=?',[eid])}
  syncPaymentExpense(account,paymentId,link){const p=this.s.one('SELECT * FROM obligation_payments WHERE id=?',[paymentId]);if(!p)return;const old=p.expense_id;
    if(!link){if(old)this.dropPaymentExpense(old);this.s.run('UPDATE obligation_payments SET expense_id=NULL,period_id=NULL WHERE id=?',[paymentId]);return}
    if(account.kind==='owed_to_me')throw new Error('الدين اللي إلك ما بيصير مصروف');if(!p.period_id||this.locked(p.period_id))throw new Error('اختار شهر مفتوح');
    const name=(account.kind==='installment'?'Installment · ':'Debt payment · ')+account.name,cat=account.kind==='installment'?'Installments':'Debt Repayments',memo=`Linked payment #${paymentId} · ${p.notes||''}`;
    if(old){const e=this.s.one('SELECT period_id FROM expenses WHERE id=?',[old]);if(e&&this.locked(e.period_id))throw new Error('المصروف الأصلي بشهر مسكّر');
      this.s.run(`UPDATE expenses SET period_id=?,name=?,category=?,budget=?,actual=?,paid_amount=?,payment_date=?,due_date=?,status='Paid',notes=?,updated_at=? WHERE id=?`,[p.period_id,name,cat,p.amount,p.amount,p.amount,p.paid_on,p.paid_on,memo,nowIso(),old])}
    else{const eid=this.s.run(`INSERT INTO expenses(period_id,category,name,budget,actual,status,sort_order,due_date,paid_amount,payment_date,notes,auto_calculated,source_type,created_at,updated_at) VALUES(?,?,?,?,?,'Paid',?,?,?,?,?,0,'obligation_payment',?,?)`,
      [p.period_id,cat,name,p.amount,p.amount,999,p.paid_on,p.amount,p.paid_on,memo,nowIso(),nowIso()]);this.s.run('UPDATE obligation_payments SET expense_id=? WHERE id=?',[eid,paymentId])}}
  addPayment(oid,d){const a=this.s.one('SELECT * FROM obligations WHERE id=?',[oid]);if(!a)throw new Error('الحساب مش موجود');if(a.status==='archived')throw new Error('الحساب مؤرشف');
    const c=this.checkPayment(a,d);const id=this.s.run('INSERT INTO obligation_payments(obligation_id,amount,paid_on,paid_by,notes,period_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',[oid,c.amount,c.paid_on,c.paid_by,c.notes,c.period_id,nowIso(),nowIso()]);
    this.syncPaymentExpense(a,id,c.link);this.audit('create','obligation_payment',id,`${c.amount.toFixed(3)} JOD`);return id}
  updatePayment(id,d){const old=this.s.one('SELECT * FROM obligation_payments WHERE id=?',[id]);if(!old)throw new Error('الدفعة مش موجودة');const a=this.s.one('SELECT * FROM obligations WHERE id=?',[old.obligation_id]);
    const c=this.checkPayment(a,{...old,...d},id);this.s.run('UPDATE obligation_payments SET amount=?,paid_on=?,paid_by=?,notes=?,period_id=?,updated_at=? WHERE id=?',[c.amount,c.paid_on,c.paid_by,c.notes,c.period_id,nowIso(),id]);
    this.syncPaymentExpense(a,id,c.link);this.audit('update','obligation_payment',id,`${c.amount.toFixed(3)} JOD`)}
  deletePayment(id){const p=this.s.one('SELECT * FROM obligation_payments WHERE id=?',[id]);if(!p)throw new Error('الدفعة مش موجودة');this.dropPaymentExpense(p.expense_id);
    for(const f of this.s.all('SELECT stored_name FROM attachments WHERE obligation_payment_id=?',[id]))this.zip.remove('uploads/'+f.stored_name);
    this.s.run('DELETE FROM attachments WHERE obligation_payment_id=?',[id]);this.s.run('DELETE FROM obligation_payments WHERE id=?',[id]);this.audit('delete','obligation_payment',id)}
  async attach(photos,rel){for(const ph of photos||[]){const bytes=new Uint8Array(await ph.blob.arrayBuffer());const ext=(ph.blob.type||'').includes('png')?'.png':'.jpg';
      const stored=hex(crypto.getRandomValues(new Uint8Array(16)))+ext;this.zip.file('uploads/'+stored,bytes,{createFolders:false});
      const id=this.s.run('INSERT INTO attachments(period_id,expense_id,electricity_id,water_id,file_name,stored_name,mime_type,category) VALUES(?,?,?,?,?,?,?,?)',
        [rel.period_id||null,rel.expense_id||null,rel.electricity_id||null,rel.water_id||null,(ph.name||'photo')+(/\.(jpe?g|png)$/i.test(ph.name||'')?'':ext),stored,ext==='.png'?'image/png':'image/jpeg',rel.category||'Other']);
      if(rel.obligation_id)this.s.run('UPDATE attachments SET obligation_id=?,obligation_payment_id=? WHERE id=?',[rel.obligation_id,rel.obligation_payment_id||null,id]);this.audit('upload','attachment',id,ph.name||'')}}
  current(kind,id){const row=this.s.one(`SELECT * FROM ${TABLES[kind]} WHERE id=?`,[id]);return row}
  // One phone entry, with the same meaning as phone_apply.apply_one on the computer.
  async apply(e){
    this.event='iphone-'+crypto.randomUUID();const d=e.data||{},pid=e.period_id;
    try{
      if(e.type==='expense'&&d.mode==='pay'){const x=this.s.one('SELECT * FROM expenses WHERE id=?',[d.expense_id]);if(!x)throw new Error('المصروف مش موجود');
        const paid=Math.min(sf(x.actual),sf(x.paid_amount)+sf(d.amount));this.updateExpense(x.id,{paid_amount:paid,status:paid>=sf(x.actual)-.0005?'Paid':'Partial',payment_date:d.date||x.payment_date});
        await this.attach(e.photos,{period_id:pid,expense_id:x.id,category:'Bill'});return}
      if(e.type==='expense'){const a=d.amount||0;const id=this.addExpense({period_id:pid,name:d.name,category:d.category||'أخرى',section:d.section||'auto',budget:a,actual:a,status:d.paid?'Paid':'Unpaid',paid_amount:d.paid?a:0,payment_date:d.paid?d.date:'',notes:[d.notes,'(من الآيفون)'].filter(Boolean).join(' ')});
        await this.attach(e.photos,{period_id:pid,expense_id:id,category:'Bill'});return}
      if(e.type==='electricity'||e.type==='water'){const prev=this.previous(e.type,pid),pick=k=>d[k]!==null&&d[k]!==undefined?d[k]:(prev[k]||0);
        const base={period_id:pid,record_date:d.record_date,bill_date:d.bill_date||d.record_date,invoice_amount:d.invoice_amount||0,notes:[d.notes,'(من الآيفون)'].filter(Boolean).join(' ')};
        const body=e.type==='electricity'?{...base,fees:d.fees||0,main_prev:prev.main_current||0,main_current:d.main_current,roof_prev:prev.roof_current||0,roof_current:pick('roof_current'),car_prev:prev.car_current||0,car_current:pick('car_current'),car_km:d.car_km||''}
          :{...base,total_consumption:d.total_consumption||0,roof_prev:prev.roof_current||0,roof_current:pick('roof_current')};
        const id=this.addReading(e.type,body);await this.attach(e.photos,{period_id:pid,[e.type+'_id']:id,category:'Meter Photo'});return}
      if(e.type==='payment'){const id=this.addPayment(d.obligation_id,{amount:d.amount,paid_on:d.paid_on,notes:[d.notes,'(من الآيفون)'].filter(Boolean).join(' '),link_to_expenses:!!d.link_to_expenses,period_id:d.link_to_expenses?pid:null});
        await this.attach(e.photos,{obligation_id:d.obligation_id,obligation_payment_id:id,category:'Bill'});return}
      if(e.type==='edit'||e.type==='delete'){const now=this.current(d.kind,d.id);if(!now)throw new Error('البند ما عاد موجود');
        if(await version(d.kind,now)!==d.v)throw new Error('تغيّر عالكمبيوتر بعد ما الآيفون شافه');const ch=d.changes||{};
        if(e.type==='delete'){({expense:()=>this.deleteExpense(d.id),electricity:()=>this.deleteReading('electricity',d.id),water:()=>this.deleteReading('water',d.id),payment:()=>this.deletePayment(d.id)}[d.kind]||(()=>{throw new Error('ما بينحذف من الآيفون')}))();return}
        ({expense:()=>this.updateExpense(d.id,{...ch}),electricity:()=>this.updateReading('electricity',d.id,ch),water:()=>this.updateReading('water',d.id,ch),payment:()=>this.updatePayment(d.id,ch),period:()=>this.updatePeriod(d.id,ch)}[d.kind])();return}
      if(e.type==='gas'){this.s.run('INSERT OR IGNORE INTO gas_swaps(id,cylinder,swapped_on,price,by,created_at) VALUES(?,?,?,?,?,?)',[d.id,(d.cylinder||'المطبخ').slice(0,40),isoDay(d.swapped_on,'التاريخ'),d.price??null,d.by||'',new Date().toISOString()]);return}
      if(e.type==='shopping'){for(const op of Object.values(d.ops||{})){const old=this.s.one('SELECT updated_at FROM shopping_items WHERE id=?',[op.id]);if(old&&old.updated_at>=op.updated_at)continue;
          if(old)this.s.run(`UPDATE shopping_items SET name=COALESCE(NULLIF(?,''),name),qty=?,in_cart=?,staple=?,deleted=?,updated_at=? WHERE id=?`,[op.name||'',op.qty||'',op.in_cart?1:0,op.staple?1:0,op.deleted?1:0,op.updated_at,op.id]);
          else if(op.name)this.s.run('INSERT INTO shopping_items(id,name,qty,in_cart,staple,deleted,updated_at,added_by) VALUES(?,?,?,?,?,?,?,?)',[op.id,op.name,op.qty||'',op.in_cart?1:0,op.staple?1:0,op.deleted?1:0,op.updated_at,op.by||''])}return}
      throw new Error('نوع غير معروف');
    }finally{this.event=''}
  }
}

// Paid, remaining and the next due date of a debt (obligations.obligation_summary on the computer).
const shiftDue=(day,months)=>{const [y0,m0,d0]=day.split('-').map(Number),t=m0-1+months,y=y0+Math.floor(t/12),m=((t%12)+12)%12+1,last=new Date(y,m,0).getDate();
  return `${y}-${pad(m)}-${pad(Math.min(d0,last))}`};
function obligationSummary(s,o){
  const res=s.one('SELECT COALESCE(SUM(amount),0) total FROM obligation_payments WHERE obligation_id=?',[o.id]);
  const paid=r(sf(res.total),3),total=sf(o.total_amount),rest=r(Math.max(0,total-paid),3),monthly=sf(o.monthly_amount);
  const scheduled=monthly>0?Math.max(0,Math.floor((paid+0.00001)/monthly)):0,number=Math.trunc(sf(o.planned_installments))||(monthly>0?Math.ceil(total/monthly):0);
  let due=null;if(rest>.0005&&(o.status||'active')==='active'&&o.first_due_date)due=o.kind==='installment'&&monthly>0?shiftDue(o.first_due_date,scheduled):o.first_due_date;
  return {paid,remaining:rest,progress:total>0?r(100*paid/total,1):0,paid_installments:number?Math.min(scheduled,number):0,total_installments:number,
    next_due:due,overdue:!!(due&&due<nowIso().slice(0,10))}}

// End-of-month report of a closed month (periods.month_report on the computer, line for line).
function monthReport(s,pid){
  const summary=id=>{const p=s.one('SELECT * FROM periods WHERE id=?',[id]);if(!p)return null;
    const ex=s.all('SELECT * FROM expenses WHERE period_id=? ORDER BY sort_order,id',[id]),actual=ex.reduce((t,x)=>t+sf(x.actual),0);
    return {period:p,expenses:ex,actual,remaining:sf(p.salary)-actual}};
  const util=(t,id)=>s.one(`SELECT * FROM ${t} WHERE period_id=? ORDER BY record_date DESC,id DESC LIMIT 1`,[id]);
  const sm=summary(pid);if(!sm)return null;const p=sm.period;
  const prev=s.one('SELECT * FROM periods WHERE period_date<? ORDER BY period_date DESC LIMIT 1',[p.period_date]),ps=prev?summary(prev.id):null;
  const nxt=s.one('SELECT period_date FROM periods WHERE period_date>? ORDER BY period_date LIMIT 1',[p.period_date]),salary=sf(p.salary);
  const totals=x=>({salary:sf(x.period.salary),actual:x.actual,remaining:x.remaining});
  const lines=(x,id)=>{const out={};for(const e of x.expenses)out[e.name]=(out[e.name]||0)+sf(e.actual);
    for(const [t,label] of [['electricity','Home electricity'],['water','Home water']]){const u=util(t,id);if(u&&!(label in out))out[label]=sf(u.apartment_amount)}return out};
  const changes=[];
  if(ps){const now=lines(sm,pid),before=lines(ps,prev.id);
    for(const name of new Set([...Object.keys(now),...Object.keys(before)])){const d=r((now[name]||0)-(before[name]||0),3);
      if(Math.abs(d)>=0.5)changes.push({name,diff:d,now:r(now[name]||0,3),before:r(before[name]||0,3)})}
    changes.sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff)||(a.name<b.name?-1:a.name>b.name?1:0))}
  const top=sm.expenses.map(e=>({name:e.name,actual:sf(e.actual),status:e.status})).sort((a,b)=>b.actual-a.actual).slice(0,5);
  const roof={};for(const t of ['electricity','water']){const u=util(t,pid);roof[t]=u?{amount:sf(u.roof_amount),status:u.status}:null}
  const end=nxt?nxt.period_date:'9999-12-31';
  const paidHere=sf(s.one('SELECT COALESCE(SUM(amount),0) t FROM obligation_payments WHERE paid_on>=? AND paid_on<?',[p.period_date,end]).t);
  let left=0;for(const o of s.all("SELECT id,total_amount FROM obligations WHERE COALESCE(status,'active')!='archived'"))
    left+=Math.max(sf(o.total_amount)-sf(s.one('SELECT COALESCE(SUM(amount),0) t FROM obligation_payments WHERE obligation_id=?',[o.id]).t),0);
  const ratio=salary?r(sm.actual/salary*100,1):null;
  const ratios=s.all('SELECT id FROM periods WHERE period_date<? AND salary>0 ORDER BY period_date DESC LIMIT 6',[p.period_date]).map(x=>summary(x.id))
    .filter(x=>x&&sf(x.period.salary)).map(x=>x.actual/sf(x.period.salary)*100);
  return {period:{id:p.id,period_date:p.period_date,status:p.status},...totals(sm),previous:ps?totals(ps):null,changes:changes.slice(0,3),top,roof,
    roof_total:r(Object.values(roof).reduce((t,v)=>t+(v?v.amount:0),0),3),installments:{paid:r(paidHere,3),left:r(left,3)},
    spend_ratio:ratio,avg_ratio:ratios.length?r(ratios.reduce((a,b)=>a+b,0)/ratios.length,1):null,avg_months:ratios.length}}

// The AC breaker, as the computer recorded it (breaker.summary): today and this month, by hour and by day.
// Read only: the phone can't reach the breaker, which is on the home network.
function breakerSummary(s){
  if(!s.one("SELECT 1 x FROM sqlite_master WHERE type='table' AND name='breaker_hourly'"))return null;
  const today=nowIso().slice(0,10),month=today.slice(0,7);
  const hours={};for(const x of s.all('SELECT * FROM breaker_hourly WHERE hour LIKE ? ORDER BY hour',[today+'%']))hours[x.hour.slice(11,13)]=x;
  const days=s.all('SELECT substr(hour,1,10) day,SUM(kwh) kwh,MAX(max_w) max_w FROM breaker_hourly WHERE hour LIKE ? GROUP BY day ORDER BY day',[month+'%']);
  const bill=s.one('SELECT home_amount,home_consumption FROM electricity WHERE home_consumption>0 AND home_amount>0 ORDER BY record_date DESC,id DESC LIMIT 1');
  const price=bill?r(bill.home_amount/bill.home_consumption,4):null;
  let live=null;try{live=JSON.parse((s.one("SELECT value FROM settings WHERE key='breaker_live'")||{}).value||'null')}catch{}
  const todayKwh=r(Object.values(hours).reduce((t,x)=>t+sf(x.kwh),0),4),monthKwh=r(days.reduce((t,x)=>t+sf(x.kwh),0),4);
  if(!live&&!days.length)return null;
  return {live,today_kwh:todayKwh,month_kwh:monthKwh,price_per_kwh:price,today_cost:price?r(todayKwh*price,3):null,month_cost:price?r(monthKwh*price,3):null,
    hourly:[...Array(24).keys()].map(h=>{const k=pad(h);return {hour:k,kwh:hours[k]?r(sf(hours[k].kwh),4):null}}),
    daily:days.map(x=>({day:x.day,kwh:r(sf(x.kwh),4),max_w:x.max_w})),events:s.all('SELECT at,kind,detail FROM breaker_events ORDER BY id DESC LIMIT 12')}}

// Each gas cylinder: last swap, days since, average days it lasts (phone_inbox.gas on the computer).
function gasState(s){
  const rows=s.all('SELECT * FROM gas_swaps WHERE deleted=0 ORDER BY swapped_on,created_at'),day=v=>new Date(String(v).slice(0,10)+'T00:00:00'),today=day(nowIso());
  const out=[];for(const name of [...new Set(rows.map(x=>x.cylinder))]){
    const days=rows.filter(x=>x.cylinder===name).map(x=>day(x.swapped_on)),gaps=[];
    for(let i=1;i<days.length;i++){const g=Math.round((days[i]-days[i-1])/864e5);if(g>0)gaps.push(g)}
    const last=days[days.length-1],since=Math.round((today-last)/864e5),avg=gaps.length?r(gaps.reduce((a,b)=>a+b,0)/gaps.length,1):null;
    out.push({cylinder:name,last:`${last.getFullYear()}-${pad(last.getMonth()+1)}-${pad(last.getDate())}`,since,avg,swaps:days.length,left:avg==null?null:Math.round(avg-since)})}
  const year=nowIso().slice(0,4),spent=rows.filter(x=>String(x.swapped_on).slice(0,4)===year).reduce((t,x)=>t+sf(x.price),0);
  return {cylinders:out.length?out:[{cylinder:'المطبخ',last:null,since:null,avg:null,swaps:0,left:null}],swaps:rows.slice().reverse().slice(0,40),spent_this_year:r(spent,3)}}

// ---------- lists for the phone, rebuilt from the edited database (same shape as phone_inbox.build_catalog) ----------
async function catalogFrom(s,old){
  const setting=(k,d)=>(s.one('SELECT value FROM settings WHERE key=?',[k])||{value:d}).value;
  const withV=async(kind,rows)=>{for(const x of rows)x.v=await version(kind,x);return rows};
  const periods=await withV('period',s.all('SELECT id,period_date,status,salary,notes FROM periods ORDER BY period_date DESC'));
  const expenses={},readings={},summary={};
  for(const p of periods){const k=String(p.id);
    expenses[k]=await withV('expense',s.all('SELECT id,name,category,section,budget,actual,paid_amount,status,payment_date,notes,0 AS auto_calculated FROM expenses WHERE period_id=? ORDER BY sort_order,id',[p.id]));
    readings[k]={electricity:await withV('electricity',s.all(`SELECT id,${EDITABLE.electricity.join(',')},status,apartment_amount,home_amount,car_amount,roof_amount,roof_consumption,roof_prev FROM electricity WHERE period_id=? ORDER BY record_date DESC,id DESC`,[p.id])),
      water:await withV('water',s.all(`SELECT id,${EDITABLE.water.join(',')},status,apartment_amount,roof_amount,roof_consumption,roof_prev FROM water WHERE period_id=? ORDER BY record_date DESC,id DESC`,[p.id]))};
    const actual=expenses[k].reduce((t,e)=>t+sf(e.actual),0),paid=expenses[k].reduce((t,e)=>t+Math.min(sf(e.paid_amount),sf(e.actual)),0);
    const util=(t,cols)=>s.one(`SELECT ${cols} FROM ${t} WHERE period_id=? ORDER BY record_date DESC,id DESC LIMIT 1`,[p.id]);
    summary[k]={salary:sf(p.salary),actual:r(actual,3),paid:r(paid,3),unpaid:r(actual-paid,3),remaining:r(sf(p.salary)-actual,3),
      utilities:{electricity:util('electricity','apartment_amount,home_amount,car_amount,roof_amount,apartment_consumption,roof_consumption,status,invoice_amount'),
        water:util('water','apartment_amount,roof_amount,apartment_consumption,roof_consumption,status,invoice_amount')}}}
  // Names and categories for the expense form, typical meter use for the "looks too high" warning (phone_inbox.build_catalog).
  const names=s.all(`SELECT name,category,MAX(section) section,MAX(actual) actual FROM expenses
    WHERE period_id IN (SELECT id FROM periods ORDER BY period_date DESC LIMIT 6) GROUP BY name,category ORDER BY name`);
  let configured=[];try{const raw=setting('categories','[]');configured=raw.trim().startsWith('[')?JSON.parse(raw):raw.split(',')}catch{}
  const categories=[...new Set([...names.map(n=>n.category).filter(Boolean),...configured.map(x=>String(x).trim()).filter(Boolean)])];
  const avgE=s.one('SELECT AVG(total_consumption) main,AVG(roof_consumption) roof,AVG(car_consumption) car FROM (SELECT * FROM electricity ORDER BY record_date DESC LIMIT 6)')||{};
  const avgW=s.one('SELECT AVG(roof_consumption) w FROM (SELECT * FROM water ORDER BY record_date DESC LIMIT 6)')||{};
  const avg_use={main:r(sf(avgE.main),1),roof:r(sf(avgE.roof),1),car:r(sf(avgE.car),1),water_roof:r(sf(avgW.w),1)};
  const obligations=[];for(const o of s.all("SELECT * FROM obligations WHERE COALESCE(status,'active')!='archived' ORDER BY name")){
    const sm=obligationSummary(s,o);
    obligations.push({id:o.id,name:o.name,kind:o.kind,counterparty:o.counterparty||'',monthly_amount:o.monthly_amount,total:o.total_amount,
      paid:sm.paid,remaining:sm.remaining,open:sm.remaining>.0005,progress:sm.progress,first_due_date:o.first_due_date,next_due_date:sm.next_due,overdue:sm.overdue,
      paid_installments:sm.paid_installments,total_installments:sm.total_installments,notes:o.notes||'',
      payments:await withV('payment',s.all('SELECT id,amount,paid_on,notes,period_id,expense_id FROM obligation_payments WHERE obligation_id=? ORDER BY paid_on DESC,id DESC',[o.id]))})}
  // Every reading with all its numbers, newest first, for the readings history screen.
  const meters={electricity:await withV('electricity',s.all(`SELECT e.*,p.period_date FROM electricity e LEFT JOIN periods p ON p.id=e.period_id ORDER BY e.record_date DESC,e.id DESC`)),
    water:await withV('water',s.all(`SELECT w.*,p.period_date FROM water w LEFT JOIN periods p ON p.id=w.period_id ORDER BY w.record_date DESC,w.id DESC`))};
  for(const x of [...meters.electricity,...meters.water]){delete x.tariff_snapshot;x.closed=!!periods.find(p=>p.id===x.period_id&&p.status==='closed')}
  const items=s.all('SELECT * FROM shopping_items WHERE deleted=0 ORDER BY in_cart,updated_at DESC');
  const reports={};for(const p of periods)if(p.status==='closed')reports[String(p.id)]=monthReport(s,p.id);
  return {...old,source:'drive',generated_at:new Date().toISOString(),periods,expenses,readings,meters,summary,obligations,names,categories,avg_use,gas:gasState(s),reports,breaker:breakerSummary(s),
    shopping:{items:items.filter(x=>!x.staple),staples:items.filter(x=>x.staple),names:s.all('SELECT DISTINCT name FROM shopping_items ORDER BY name').map(x=>x.name)},
    last_electricity:s.one('SELECT record_date,main_current,roof_current,car_current FROM electricity ORDER BY record_date DESC,id DESC LIMIT 1')||{},
    last_water:s.one('SELECT record_date,roof_current,total_consumption FROM water ORDER BY record_date DESC,id DESC LIMIT 1')||{},
    tariffs:{electricity:new Home(s).tariff('electricity'),water:new Home(s).tariff('water')},
    month_start_day:Number(setting('month_start_day','25'))||25}
}

// ---------- Drive: the snapshot exchange (drive_sync.SyncEngine.sync / download) ----------
async function driveFiles(tok,q,fields='files(id,name,modifiedTime)'){return (await (await gapi(tok,'https://www.googleapis.com/drive/v3/files?'+new URLSearchParams({q,fields,pageSize:'20'}))).json()).files||[]}
async function locate(tok){
  const root=await findFolder(tok,'Home Monthly System');if(!root)throw new Error('ما لقيت مجلد البرنامج على Drive');
  const cur=await findFolder(tok,'Current Sync',root);
  for(const folder of [cur,root].filter(Boolean)){const f=(await driveFiles(tok,`name = '${HEAD}' and '${folder}' in parents and trashed = false`))[0];if(f)return {root,folder,headId:f.id}}
  throw new Error('لسا ما في نسخة من البرنامج على Drive')}
const readHead=async(tok,id)=>(await gapi(tok,`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).json();
// The salt of the Drive copy, so the phone can make its key from the password without anything from the computer.
async function salt(tok){const {headId}=await locate(tok);return (await readHead(tok,headId)).salt}

async function openCopy(tok,headId,key){
  const head=await readHead(tok,headId);if(head.salt!==key.salt)throw Object.assign(new Error('كلمة التشفير على الآيفون مش نفس اللي بالبرنامج'),{badKey:true});
  const blob=new Uint8Array(await (await gapi(tok,`https://www.googleapis.com/drive/v3/files/${head.blob_id}?alt=media`)).arrayBuffer());
  if(hex(await crypto.subtle.digest('SHA-256',blob))!==head.sha256)throw new Error('النسخة على Drive مش سليمة');
  let plain;try{plain=await decryptBytes(key.raw,blob)}catch{throw Object.assign(new Error('كلمة التشفير غلط، جرّب مرة ثانية'),{badKey:true})}
  const SQL=await libs(),zip=await JSZip.loadAsync(plain);
  return {head,zip,db:new SQL.Database(await zip.file('database/home_system.db').async('uint8array'))}}
// Nothing is automatic any more (same as the computer's start-up): every line is an ordinary expense.
const unlockAll=db=>{db.run('UPDATE expenses SET auto_calculated=0 WHERE auto_calculated=1');db.run('UPDATE expense_template_items SET auto_calculated=0 WHERE auto_calculated=1')};
// The lists straight from the Drive copy. The computer uploads its changes a few seconds after making them.
async function lists(tok,key,old){
  const {headId}=await locate(tok);
  const {db}=await openCopy(tok,headId,key);
  try{return await catalogFrom(new Store(db),old)}finally{db.close()}}
// Apply `entries` straight into the Drive copy. Returns {applied:[ids], failed:{id:reason}, catalog}.
// If the computer saved a copy at the same moment, start again once from its copy.
async function run(tok,entries,key){
  try{return await runOnce(tok,entries,key)}
  catch(err){if(!err.moved)throw err;return runOnce(tok,entries,key)}}
async function runOnce(tok,entries,key){
  const {folder,headId}=await locate(tok);
  const {head,zip,db}=await openCopy(tok,headId,key),s=new Store(db);
  const actor=(s.one("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1")||{}).id||null,home=new Home(s,zip,actor);
  db.create_function('home_event_id',()=>home.event);db.create_function('home_actor_id',()=>actor);unlockAll(db);
  const applied=[],failed={};
  for(const e of entries){db.run('SAVEPOINT one');try{await home.apply(e);db.run('RELEASE one');applied.push(e.id)}catch(err){db.run('ROLLBACK TO one');db.run('RELEASE one');failed[e.id]=err.message}}
  if(!applied.length){db.close();return {applied,failed,catalog:null}}
  if(db.exec('PRAGMA integrity_check')[0].values[0][0]!=='ok')throw new Error('فحص قاعدة البيانات فشل، ما رفعت شي');
  const catalog=await catalogFrom(s,CAT);
  zip.file('database/home_system.db',db.export(),{createFolders:false});db.close();
  const rev=crypto.randomUUID().replace(/-/g,''),manifest=JSON.parse(await zip.file('manifest.json').async('string'));
  zip.file('manifest.json',JSON.stringify({...manifest,format:3,revision:rev,parent_revision:head.revision,device_id:'iphone',created_at:new Date().toISOString()}));
  // The computer accepts only files in the archive (drive_sync.validate_snapshot): no folder entries.
  // Drop the entry alone: zip.remove() on a folder would also delete everything in it, the database included.
  for(const [path,f] of Object.entries(zip.files))if(f.dir)delete zip.files[path];
  const secured=await encryptBytes(key.raw,await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:6}}));
  // New copy first, then a check that nobody moved the head meanwhile, then the head: the same order as the computer.
  const boundary='hm'+Math.random().toString(36).slice(2);
  const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name:`state-${rev}.enc`,parents:[folder]})}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,secured,`\r\n--${boundary}--`]);
  const created=await (await gapi(tok,'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body})).json();
  const latest=await readHead(tok,headId);
  if(latest.revision!==head.revision){await gapi(tok,`https://www.googleapis.com/drive/v3/files/${created.id}`,{method:'DELETE'}).catch(()=>{});throw Object.assign(new Error('النسخة تغيّرت وإحنا بنعدّل. جرّب مرة ثانية'),{moved:true})}
  const next={revision:rev,blob_id:created.id,created_at:new Date().toISOString(),device_id:'iphone',salt:head.salt,sha256:hex(await crypto.subtle.digest('SHA-256',secured))};
  await gapi(tok,`https://www.googleapis.com/upload/drive/v3/files/${headId}?uploadType=media`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});
  gapi(tok,`https://www.googleapis.com/drive/v3/files/${head.blob_id}`,{method:'DELETE'}).catch(()=>{});
  return {applied,failed,catalog};
}
// ---------- shared shopping list (another person's phone, phone_inbox.exchange_shared_shopping on the computer) ----------
// A separate folder holds only item names; the other phone writes its changes to one file and reads the list from another.
const SHOP_FOLDER='Home Monthly Shopping',SHOP_LIST='shopping-list.json',SHOP_INBOX='shopping-changes.json';
async function putNamed(tok,folder,name,id,body){
  if(id)return gapi(tok,`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`,{method:'PATCH',headers:{'Content-Type':'application/json'},body});
  const boundary='hm'+Math.random().toString(36).slice(2);
  return gapi(tok,'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},
    body:new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name,parents:[folder],mimeType:'application/json'})}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`,body,`\r\n--${boundary}--`])})}
// Apply what the other phone wrote, then publish the current list for it. Returns the newer lists, or `cat` as it was.
async function shopExchange(tok,key,cat){
  const folder=await findFolder(tok,SHOP_FOLDER);if(!folder)return cat;  // the list was never shared: nothing to do
  const find=async n=>(await driveFiles(tok,`name = '${n}' and '${folder}' in parents and trashed = false`))[0]?.id||null;
  const listId=await find(SHOP_LIST),inboxId=await find(SHOP_INBOX);
  let ops=[];if(inboxId){try{ops=(await (await gapi(tok,`https://www.googleapis.com/drive/v3/files/${inboxId}?alt=media`)).json()).ops||[]}catch{}}
  else await putNamed(tok,folder,SHOP_INBOX,null,'{"ops":[]}');
  // Only changes not seen before and newer than the list: last change wins, item by item.
  const seen=new Set(await kvGet('shopSeen')||[]),items=[...(cat?.shopping?.items||[]),...(cat?.shopping?.staples||[])];
  const fresh=ops.filter(o=>o&&/^[A-Za-z0-9_-]{6,64}$/.test(String(o.id||''))&&!seen.has(o.id+'|'+o.updated_at)&&(()=>{const it=items.find(x=>x.id===o.id);return it?String(o.updated_at)>String(it.updated_at):!o.deleted&&!!String(o.name||'').trim()})());
  if(fresh.length){const res=await run(tok,[{id:'shared-'+crypto.randomUUID(),type:'shopping',data:{ops:fresh},photos:[]}],key);if(res.catalog)cat=res.catalog}
  await kvSet('shopSeen',[...new Set([...seen,...ops.map(o=>o.id+'|'+o.updated_at)])].slice(-1000));
  const current=JSON.stringify(cat?.shopping||{});
  if(!listId||current!==await kvGet('shopPublished')){await putNamed(tok,folder,SHOP_LIST,listId,JSON.stringify({...(cat?.shopping||{}),updated_at:new Date().toISOString()}));await kvSet('shopPublished',current)}
  return cat}

window.Direct={run,lists,salt,shopExchange,calcElectric,calcWater,version,Store,Home,catalogFrom,libs};
})();
