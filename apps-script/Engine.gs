/* Shared authoritative accounting engine. No network / browser dependencies. */
var Market = (function () {
  'use strict';
  const labels = {sale:'فاتورة بيع',purchase:'فاتورة شراء',receipt:'سند قبض',payment:'سند دفع',opening:'رصيد صندوق افتتاحي',void:'إلغاء',product:'منتج',party:'حساب'};
  function fail(t) { throw new Error(t); }
  function text(v,max=160) { const s=String(v==null?'':v).trim(); if(s.length>max) fail('النص أطول من المسموح'); return s; }
  function money(v) { const n=Number(v); if(!Number.isSafeInteger(n)||n<0||n>1e12) fail('المبلغ يجب أن يكون ليرات صحيحة بين صفر وتريليون'); return n; }
  function qty(v) { const n=Number(v); if(!Number.isFinite(n)||n<0||n>1e7||Math.abs(n*1000-Math.round(n*1000))>0.00001) fail('الكمية غير صحيحة؛ أقصى دقة 3 منازل'); return Math.round(n*1000)/1000; }
  function qadd(a,b) { return Math.round((a+b)*1000)/1000; }
  function date(v) { const d=text(v,10); if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||isNaN(Date.parse(d+'T12:00:00Z'))||new Date(d+'T12:00:00Z').toISOString().slice(0,10)!==d) fail('التاريخ غير صحيح'); return d; }
  function state(events) {
    const s={products:Object.create(null),parties:Object.create(null),docs:[],cash:0,ledger:[],cashLedger:[],revision:events.length,openingSet:false};
    function move(e,sign=1) {
      const d=e.data, k=e.kind;
      if(k==='sale'||k==='purchase') {
        d.lines.forEach(l=>{const p=s.products[l.productId]; p.stock=qadd(p.stock,sign*(k==='sale'?-l.qty:l.qty));});
        const change=sign*(k==='sale'?d.paid:-d.paid);
        s.cash+=change;
        if(change) s.cashLedger.push({id:e.id,date:e.date,label:labels[k],ref:e.number,delta:change});
        if(d.partyId) {
          const total=sign*(k==='sale'?d.total:-d.total), payment=sign*(k==='sale'?-d.paid:d.paid);
          s.parties[d.partyId].balance+=total+payment;
          s.ledger.push({id:e.id,date:e.date,partyId:d.partyId,label:labels[k],ref:e.number,debit:Math.max(total,0),credit:Math.max(-total,0)});
          if(payment) s.ledger.push({id:e.id,date:e.date,partyId:d.partyId,label:'دفعة ضمن الفاتورة',ref:e.number,debit:Math.max(payment,0),credit:Math.max(-payment,0)});
        }
      } else if(k==='receipt'||k==='payment'||k==='opening') {
        const change=sign*(k==='payment'?-d.amount:d.amount); s.cash+=change;
        s.cashLedger.push({id:e.id,date:e.date,label:labels[k],ref:e.number,delta:change,note:d.note||''});
        if(d.partyId) {
          s.parties[d.partyId].balance-=change;
          s.ledger.push({id:e.id,date:e.date,partyId:d.partyId,label:labels[k],ref:e.number,debit:Math.max(-change,0),credit:Math.max(change,0)});
        }
      }
    }
    events.forEach(e=>{
      const d=e.data;
      if(e.kind==='product') {
        const old=s.products[d.id]; s.products[d.id]={...d,stock:old?old.stock:d.openingQty};
      } else if(e.kind==='party') {
        const old=s.parties[d.id]; s.parties[d.id]={...d,balance:old?old.balance:d.openingBalance};
        if(!old&&d.openingBalance) s.ledger.push({id:e.id,date:e.date,partyId:d.id,label:'رصيد افتتاحي',ref:e.number,debit:Math.max(d.openingBalance,0),credit:Math.max(-d.openingBalance,0)});
      } else if(e.kind==='void') {
        const target=s.docs.find(x=>x.id===d.targetId);
        if(!target||target.voided) fail('سجل إلغاء غير متسق');
        move({...target,id:e.id,date:e.date,number:e.number},-1);
        // Keep original document and explicit reversing entries for audit.
        s.ledger.filter(x=>x.id===e.id).forEach(x=>x.label='إلغاء '+x.label);
        s.cashLedger.filter(x=>x.id===e.id).forEach(x=>x.label='إلغاء '+x.label);
        target.voided=true; target.voidId=e.id;
        s.docs.push({...e});
      } else {
        move(e); s.docs.push({...e,voided:false}); if(e.kind==='opening') s.openingSet=true;
      }
    });
    return s;
  }
  function prepare(events,request,meta) {
    if(!request||!request.data||typeof request.data!=='object') fail('طلب غير صحيح');
    const s=state(events), d=request.data, kind=request.kind; let out;
    const id=text(request.id,80); if(!/^[a-zA-Z0-9-]{16,80}$/.test(id)) fail('معرف العملية غير صحيح');
    const existing=events.find(e=>e.id===id); if(existing) return existing;
    const day=date(request.date||meta.today); if(day>meta.today) fail('لا يمكن تسجيل حركة بتاريخ مستقبلي');
    if(kind==='product') {
      const key=text(d.id||id,80), old=s.products[key]; if(!/^[a-zA-Z0-9-]{16,80}$/.test(key)) fail('معرف المنتج غير صحيح');
      const name=text(d.name), barcode=text(d.barcode,100);
      if(!name) fail('اسم المنتج مطلوب');
      if(barcode&&Object.values(s.products).some(p=>p.barcode===barcode&&p.id!==key)) fail('هذا الباركود مسجل لمنتج آخر');
      out={id:key,name,barcode,unit:text(d.unit||'قطعة',30),cost:money(d.cost),price:money(d.price),minStock:qty(d.minStock||0),openingQty:old?old.openingQty:qty(d.openingQty||0)};
    } else if(kind==='party') {
      const key=text(d.id||id,80), old=s.parties[key]; if(!/^[a-zA-Z0-9-]{16,80}$/.test(key)) fail('معرف الحساب غير صحيح'); if(!['customer','supplier'].includes(d.type)) fail('نوع الحساب غير صحيح');
      if(old&&old.type!==d.type) fail('لا يمكن تغيير نوع حساب موجود');
      const amount=money(d.openingAmount||0), sign=d.openingDirection==='us'?-1:1;
      out={id:key,name:text(d.name),phone:text(d.phone,40),type:d.type,openingBalance:old?old.openingBalance:amount*sign};
      if(!out.name) fail('اسم الحساب مطلوب');
    } else if(kind==='sale'||kind==='purchase') {
      if(!Array.isArray(d.lines)||!d.lines.length||d.lines.length>100) fail('الفاتورة تحتاج 1 إلى 100 بند');
      const used={}; let gross=0;
      const lines=d.lines.map(l=>{
        const p=s.products[text(l.productId,80)]; if(!p) fail('المنتج غير موجود');
        const q=qty(l.qty), price=money(l.price); if(!q) fail('الكمية يجب أن تكون أكبر من صفر');
        used[p.id]=qadd(used[p.id]||0,q); if(kind==='sale'&&used[p.id]>p.stock) fail('الرصيد غير كافٍ: '+p.name+'؛ المتوفر '+p.stock);
        const total=Math.round(q*price); money(total); gross+=total;
        return {productId:p.id,name:p.name,barcode:p.barcode,unit:p.unit,qty:q,price,total};
      });
      money(gross); const discount=money(d.discount||0); if(discount>gross) fail('الخصم أكبر من قيمة الفاتورة');
      const total=gross-discount, paid=money(d.paid); if(paid>total) fail('المدفوع أكبر من إجمالي الفاتورة');
      const partyId=text(d.partyId,80), party=s.parties[partyId];
      if((kind==='purchase'||paid<total)&&!party) fail(kind==='purchase'?'اختر المورد':'اختر الزبون للبيع الآجل');
      if(partyId&&(!party||party.type!==(kind==='sale'?'customer':'supplier'))) fail('نوع الحساب لا يتوافق مع الفاتورة');
      if(kind==='purchase'&&paid>s.cash) fail('رصيد الصندوق لا يغطي الدفعة');
      out={lines,gross,discount,total,paid,partyId,partyName:party?party.name:'زبون نقدي',note:text(d.note,500)};
    } else if(['receipt','payment','opening'].includes(kind)) {
      const amount=money(d.amount); if(amount<=0) fail('المبلغ يجب أن يكون أكبر من صفر');
      const partyId=text(d.partyId,80); if(partyId&&!s.parties[partyId]) fail('الحساب غير موجود');
      if(kind==='opening'&&(s.openingSet||s.docs.length)) fail('الرصيد الافتتاحي يُدخل مرة واحدة قبل الفواتير والسندات');
      if(kind==='opening'&&partyId) fail('الرصيد الافتتاحي ليس مرتبطاً بحساب');
      if(kind==='payment'&&amount>s.cash) fail('رصيد الصندوق لا يكفي للدفع');
      const note=text(d.note,500); if(!partyId&&!note&&kind!=='opening') fail('اكتب بيان السند، مثل مصروف كهرباء أو إيداع رأس مال');
      out={amount,partyId,partyName:partyId?s.parties[partyId].name:'',note};
    } else if(kind==='void') {
      const target=s.docs.find(e=>e.id===d.targetId); if(!target||target.voided||!['sale','purchase','receipt','payment'].includes(target.kind)) fail('هذه الحركة غير قابلة للإلغاء');
      const note=text(d.note,500); if(!note) fail('سبب الإلغاء مطلوب'); out={targetId:target.id,note};
    } else fail('نوع العملية غير مدعوم');
    const prefixes={sale:'S',purchase:'P',receipt:'R',payment:'D',opening:'O',product:'IT',party:'AC',void:'V'};
    const e={id,kind,date:day,createdAt:meta.now,number:prefixes[kind]+'-'+String(events.length+1).padStart(6,'0'),data:out};
    const next=state(events.concat(e));
    if(next.cash<0) fail('الإلغاء يجعل الصندوق سالباً؛ صحح الحركات المرتبطة أولاً');
    if(Object.values(next.products).some(p=>p.stock<0)) fail('لا يمكن إلغاء شراء بضاعة تم بيعها');
    if(!Number.isSafeInteger(next.cash)||Object.values(next.parties).some(p=>!Number.isSafeInteger(p.balance))) fail('الرصيد يتجاوز الدقة العددية المسموحة');
    return e;
  }
  function statement(s,partyId,from='',to='9999-12-31') {
    let balance=0,opening=0;const rows=[];
    s.ledger.filter(x=>x.partyId===partyId).sort((a,b)=>a.date.localeCompare(b.date)).forEach(x=>{
      if(x.date<from){opening+=x.debit-x.credit;balance=opening;} else if(x.date<=to){balance+=x.debit-x.credit;rows.push({...x,balance});}
    }); return {opening,closing:balance,rows};
  }
  return {state,prepare,statement,labels,money,qty};
})();
if(typeof module!=='undefined') module.exports=Market;
