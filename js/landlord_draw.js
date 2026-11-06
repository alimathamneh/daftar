/* Landlord images, drawing only: the water and electricity tables sent to the flat's owner, as canvases.
   Same columns as the old Excel sheet; the apartment is one amount (home + car together); the roof is the highlight.
   Drawn in the browser so the Arabic is shaped by the browser and uses the app's own font.
   Every number comes from the saved readings; nothing is recalculated here.
   The same file is in static/js/ (computer) and mobile/js/ (phone): keep the two identical (tests/test_reports.py checks). */
(() => {
'use strict';
let FONT='"IBM Plex Sans Arabic", Plex, "Segoe UI", Tahoma, sans-serif';
const SCALE=2;
const C={ink:'#1f2440',muted:'#6f7890',line:'#e3e6ef',navy:'#343575',navySoft:'#eceeff',zebra:'#f8f9fc',newRow:'#eef1ff',
  roof:'#8a5a00',roofSoft:'#fff6dc',roofCell:'#ffeeb0',apt:'#b42318',aptSoft:'#ffeeed',page:'#ffffff'};

const n2=v=>Number(v||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const n0=v=>Number(v||0).toLocaleString('en-US',{maximumFractionDigits:0});
const jod=v=>`${n2(v)} JOD`;
const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const dmy=s=>{s=String(s||'').slice(0,10);return /^\d{4}-\d\d-\d\d$/.test(s)?`${s.slice(8,10)}/${s.slice(5,7)}/${s.slice(0,4)}`:''};
// "current - previous" as on the bill; readings saved without a label get it from their own date and the one before.
const periodText=(row,prev)=>row.period_label||[dmy(row.record_date),dmy(prev?.record_date)].filter(Boolean).join(' - ')||'-';

// Columns: [group, header, value, kind]. kind: roofDue / aptDue colour the amount owed.
const WATER={title:'فاتورة المياه',unit:'m³',cols:[
  ['period','الفترة',r=>r._period],
  ['bill','قيمة الفاتورة',r=>jod(r.invoice_amount)],
  ['bill','كمية الصرف',r=>`${n0(r.total_consumption)} m³`],
  ['roof','عداد الروف',r=>`${n0(r.roof_current)} m³`],
  ['roof','كمية صرف الروف',r=>`${n0(r.roof_consumption)} m³`],
  ['roof','مياه الروف',r=>jod(r.roof_water)],
  ['roof','صرف صحي الروف',r=>jod(r.roof_sewer)],
  ['roof','المطلوب من الروف',r=>jod(r.roof_amount),'roofDue'],
  ['apt','كمية صرف الشقة',r=>`${n0(r.apartment_consumption)} m³`],
  ['apt','مياه الشقة',r=>jod(r.apartment_water)],
  ['apt','صرف صحي الشقة',r=>jod(r.apartment_sewer)],
  ['apt','المطلوب من الشقة',r=>jod(r.apartment_amount),'aptDue']]};
const ELEC={title:'فاتورة الكهرباء',unit:'kWh',cols:[
  ['period','الفترة',r=>r._period],
  ['bill','العداد السابق',r=>n0(r.main_prev)],
  ['bill','العداد الحالي',r=>n0(r.main_current)],
  ['bill','كمية الاستهلاك',r=>`${n0(r.total_consumption)} kWh`],
  ['bill','قيمة الفاتورة',r=>jod(r.invoice_amount)],
  ['bill','مجموع الرسوم',r=>jod(r.fees)],
  ['roof','عداد الروف السابق',r=>n0(r.roof_prev)],
  ['roof','عداد الروف الحالي',r=>n0(r.roof_current)],
  ['roof','استهلاك الروف',r=>`${n0(r.roof_consumption)} kWh`],
  ['roof','المطلوب من الروف',r=>jod(r.roof_amount),'roofDue'],
  ['apt','استهلاك الشقة',r=>`${n0(r.apartment_consumption)} kWh`],
  ['apt','المطلوب من الشقة',r=>jod(r.apartment_amount),'aptDue']]};
const GROUPS={period:['',C.navy,C.navySoft],bill:['الفاتورة والعداد الرئيسي',C.navy,C.navySoft],roof:['الروف',C.roof,C.roofSoft],apt:['الشقة',C.apt,C.aptSoft]};

// Last `count` readings, oldest first (as in the sheet), each with its period text.
function pick(all,count){
  const list=all.filter(r=>r.record_date).sort((a,b)=>String(a.record_date).localeCompare(String(b.record_date))||a.id-b.id);
  const from=count>0?Math.max(0,list.length-count):0;
  return list.slice(from).map((r,i)=>({...r,_period:periodText(r,list[from+i-1])}));
}

function font(w,px){return `${w} ${px}px ${FONT}`}
function text(ctx,s,x,y,{w=400,px=15,color=C.ink,align='center',rtl=/[؀-ۿ]/.test(s)}={}){
  ctx.font=font(w,px);ctx.fillStyle=color;ctx.textAlign=align;ctx.direction=rtl?'rtl':'ltr';ctx.textBaseline='middle';ctx.fillText(s,x,y);
}
function measure(ctx,s,w,px){ctx.font=font(w,px);return ctx.measureText(s).width}
function rrect(ctx,x,y,w,h,r,fill,stroke){ctx.beginPath();ctx.roundRect(x,y,w,h,r);if(fill){ctx.fillStyle=fill;ctx.fill()}if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke()}}
// A long header goes on two lines, split near the middle.
function headerLines(ctx,h,maxW){
  if(measure(ctx,h,700,13)<=maxW)return [h];
  const words=h.split(' ');if(words.length<2)return [h];
  let best=[h],score=1e9;
  for(let i=1;i<words.length;i++){const a=words.slice(0,i).join(' '),b=words.slice(i).join(' ');const s=Math.max(measure(ctx,a,700,13),measure(ctx,b,700,13));if(s<score){score=s;best=[a,b]}}
  return best;
}

// Draws one table image; `combined` is the roof's total for the latest month across both bills (shown in the header).
function draw(spec,rows,{house,combined}){
  const probe=document.createElement('canvas').getContext('2d');
  // The newest month is a taller row with bigger text, so it stands out from the rest.
  const PAD=36,CELL_H=40,CELL_PX=15,NEW_H=62,NEW_PX=17;
  const cols=spec.cols.map(([group,head,val,kind])=>{
    const vals=rows.map(val);
    const valW=Math.max(0,...vals.map((v,i)=>i===rows.length-1?measure(probe,v,700,NEW_PX)+(kind?16:0):measure(probe,v,kind?700:500,CELL_PX)));
    const minW=Math.max(valW+30,group==='period'?0:96);
    const lines=headerLines(probe,head,minW-16);
    const w=Math.ceil(Math.max(minW,...lines.map(l=>measure(probe,l,700,13)+18)));
    return {group,head,lines,vals,kind,w};
  });
  const tableW=cols.reduce((a,c)=>a+c.w,0);
  const W=tableW+PAD*2;
  const HEAD_TOP=PAD, TILES_TOP=HEAD_TOP+78, TILE_H=78;
  const tableTop=TILES_TOP+TILE_H+28, GROUP_H=30, COLHEAD_H=50;
  const bodyTop=tableTop+GROUP_H+COLHEAD_H;
  const bodyH=rows.length?(rows.length-1)*CELL_H+NEW_H:0;
  const H=bodyTop+bodyH+36;

  const cv=document.createElement('canvas');cv.width=W*SCALE;cv.height=H*SCALE;
  const ctx=cv.getContext('2d');ctx.scale(SCALE,SCALE);
  ctx.fillStyle=C.page;ctx.fillRect(0,0,W,H);
  // Top accent strip
  ctx.fillStyle=C.navy;ctx.fillRect(0,0,W,6);

  const right=W-PAD;
  const last=rows[rows.length-1];
  text(ctx,spec.title+(house?` — ${house}`:''),right,HEAD_TOP+18,{w:700,px:28,align:'right'});
  text(ctx,`توزيع الفاتورة بين الروف والشقة · ${rows.length===1?'آخر شهر':rows.length===2?'آخر شهرين':`آخر ${rows.length} ${rows.length>10?'شهر':'شهور'}`}`,right,HEAD_TOP+52,{px:15,color:C.muted,align:'right'});

  // Tiles for the latest bill: roof owes, apartment owes, and the roof's total with the other bill.
  if(last){
    // The period is isolated left-to-right so "01/11 - 01/10" is not flipped inside the Arabic label.
    // The roof comes first and loudest (solid amber), then the roof's total with the other bill; the apartment is quiet.
    // [label, value, value colour, background, bar colour, label colour, value size]
    const tiles=[['المطلوب من الروف — ⁦'+last._period+'⁩',jod(last.roof_amount),'#2e1d00','#f2b705','#b88600','#4a3300',28]];
    if(combined)tiles.push(['مجموع الروف هالشهر (كهربا + مي)',jod(combined),C.roof,C.roofSoft,C.roof,C.muted,24]);
    tiles.push(['المطلوب من الشقة',jod(last.apartment_amount),C.apt,'#f6f7fa','#e8b4b0',C.muted,19]);
    let x=right;
    for(const [label,val,color,bg,bar,labelColor,px] of tiles){
      const w=Math.ceil(Math.max(measure(probe,label,500,13),measure(probe,val,700,px))+40);
      rrect(ctx,x-w,TILES_TOP,w,TILE_H,14,bg);
      ctx.fillStyle=bar;ctx.fillRect(x-5,TILES_TOP+14,5,TILE_H-28);
      text(ctx,label,x-20,TILES_TOP+22,{w:500,px:13,color:labelColor,align:'right'});
      text(ctx,val,x-20,TILES_TOP+52,{w:px>20?700:600,px,color,align:'right',rtl:false});
      x-=w+14;
    }
  }

  // Group header row (RTL: first column on the right)
  let x=right;const spans=[];
  for(const c of cols){const s=spans[spans.length-1];if(s&&s.group===c.group){s.x-=c.w;s.w+=c.w}else spans.push({group:c.group,x:x-c.w,w:c.w});x-=c.w}
  for(const s of spans){const [label,color,bg]=GROUPS[s.group];if(!label)continue;
    rrect(ctx,s.x+3,tableTop,s.w-6,GROUP_H-6,8,bg);text(ctx,label,s.x+s.w/2,tableTop+(GROUP_H-6)/2,{w:700,px:13,color})}

  // Column headers
  const ch=tableTop+GROUP_H;
  rrect(ctx,PAD,ch,tableW,COLHEAD_H,10,C.navy);
  x=right;
  for(const c of cols){
    const cx=x-c.w/2;
    if(c.lines.length===1)text(ctx,c.lines[0],cx,ch+COLHEAD_H/2,{w:700,px:13,color:'#fff'});
    else{text(ctx,c.lines[0],cx,ch+COLHEAD_H/2-9,{w:700,px:13,color:'#fff'});text(ctx,c.lines[1],cx,ch+COLHEAD_H/2+9,{w:700,px:13,color:'#fff'})}
    x-=c.w;
  }

  // Body
  const oldH=Math.max(0,rows.length-1)*CELL_H;
  rows.slice(0,-1).forEach((r,i)=>{
    const y=bodyTop+i*CELL_H;
    ctx.fillStyle=i%2?C.zebra:'#fff';ctx.fillRect(PAD,y,tableW,CELL_H);
    let x=right;
    for(const c of cols){
      const v=c.vals[i],cx=x-c.w/2,cy=y+CELL_H/2;
      if(c.kind==='roofDue'){rrect(ctx,x-c.w+6,y+5,c.w-12,CELL_H-10,8,C.roofCell);text(ctx,v,cx,cy,{w:700,px:CELL_PX,color:C.roof,rtl:false})}
      else if(c.kind==='aptDue')text(ctx,v,cx,cy,{w:500,px:CELL_PX,color:C.apt,rtl:false});
      else text(ctx,v,cx,cy,{w:c.group==='period'?600:400,px:c.group==='period'?14:CELL_PX,color:C.ink,rtl:false});
      x-=c.w;
    }
    ctx.fillStyle=C.line;ctx.fillRect(PAD,y+CELL_H-1,tableW,1);
  });
  // Thin separators between groups (older rows only; the newest row has its own frame)
  x=right;for(const s of spans.slice(0,-1)){x-=s.w;ctx.fillStyle='#d4d8e6';ctx.fillRect(x,bodyTop,1,oldH)}

  // The newest month: tinted band with a navy frame, a "new month" badge, solid amount pills.
  if(rows.length){
    const i=rows.length-1,y=bodyTop+oldH+6,h=NEW_H-6;
    ctx.save();ctx.shadowColor='rgba(52,53,117,.22)';ctx.shadowBlur=14;ctx.shadowOffsetY=4;
    rrect(ctx,PAD,y,tableW,h,12,'#e4e8ff');ctx.restore();
    ctx.beginPath();ctx.roundRect(PAD+1,y+1,tableW-2,h-2,12);ctx.strokeStyle=C.navy;ctx.lineWidth=2.5;ctx.stroke();
    let x=right;
    for(const c of cols){
      const v=c.vals[i],cx=x-c.w/2,cy=y+h/2;
      // The roof's amount is the one that matters most: a solid amber pill with a glow; the apartment stays plain.
      if(c.kind==='roofDue'){
        ctx.save();ctx.shadowColor='rgba(242,183,5,.55)';ctx.shadowBlur=12;
        rrect(ctx,x-c.w+5,y+7,c.w-10,h-14,11,'#f2b705');ctx.restore();
        ctx.beginPath();ctx.roundRect(x-c.w+5,y+7,c.w-10,h-14,11);ctx.strokeStyle='#b88600';ctx.lineWidth=1.5;ctx.stroke();
        text(ctx,v,cx,cy,{w:700,px:NEW_PX,color:'#2e1d00',rtl:false});
      }else if(c.kind==='aptDue')text(ctx,v,cx,cy,{w:600,px:CELL_PX,color:C.apt,rtl:false});
      else if(c.group==='period'){
        const badge='الشهر الجديد',bw=measure(ctx,badge,700,11)+18;
        rrect(ctx,cx-bw/2,y+6,bw,19,9.5,C.navy);text(ctx,badge,cx,y+16,{w:700,px:11,color:'#fff'});
        text(ctx,v,cx,y+h-15,{w:700,px:14,color:C.navy,rtl:false});
      }else text(ctx,v,cx,cy,{w:700,px:NEW_PX,color:C.ink,rtl:false});
      x-=c.w;
    }
  }

  return cv;
}

// Both images for the last `count` readings (0 = all). The roof's total adds the newest water and electricity bills.
function build(water,elec,count,house=''){
  const w=pick(water||[],count),e=pick(elec||[],count);
  const lw=w[w.length-1],le=e[e.length-1];
  const combined=lw&&le?Number(lw.roof_amount||0)+Number(le.roof_amount||0):0;
  return {water:w.length?draw(WATER,w,{house,combined}):null,electricity:e.length?draw(ELEC,e,{house,combined}):null,
    draft:!!le&&String(le.status||'').toLowerCase()==='draft'};
}
const ready=()=>Promise.all([400,500,600,700].map(w=>document.fonts.load(font(w,16),'المطلوب 0123'))).catch(()=>{});
const toBlob=cv=>new Promise(res=>cv.toBlob(res,'image/png'));
const stamp=()=>today();
window.LandlordDraw={build,ready,toBlob,stamp,setFont:f=>{FONT=f}};
})();
