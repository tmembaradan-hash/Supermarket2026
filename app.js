'use strict';
const $=s=>document.querySelector(s), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>Number(n||0).toLocaleString('en-US',{maximumFractionDigits:3}), cash=n=>number(n)+' ل.س';
const englishDigits=v=>String(v).replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/٫/g,'.').replace(/٬/g,'');
function numericAttrs(decimal=false){return `type="text" lang="en" dir="ltr" data-numeric inputmode="${decimal?'decimal':'numeric'}" pattern="${decimal?'[0-9]+([.][0-9]{1,3})?':'[0-9]+'}" title="${decimal?'أدخل أرقاماً إنجليزية؛ استخدم النقطة للكسور، حتى 3 منازل':'أدخل مبلغاً صحيحاً بالأرقام الإنجليزية'}" autocomplete="off"`;}
// Capture runs before the field's calculation listeners, including pasted Arabic digits.
document.addEventListener('input',e=>{
  const el=e.target;
  if(!(el instanceof HTMLInputElement)||!el.matches('[data-numeric],[name=barcode],input[type=tel],#item-query,#product-search,#party-search'))return;
  const value=englishDigits(el.value);if(value!==el.value){const start=el.selectionStart,end=el.selectionEnd;el.value=value;try{el.setSelectionRange(start,end);}catch(_){}}
},true);
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Damascus',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const uid=()=>crypto.randomUUID(), clone=x=>JSON.parse(JSON.stringify(x));
let state=Market.state([]), demo=false, demoEvents=[], token='', route='home', invoiceKind='sale',cart=[], bridge=null, busy=false, scan=null, scanCallback=null;
let pending=null,connectionUrl='',invoiceDraft={};
const routes=[['home','⌂','الرئيسية'],['sale','▤','بيع وشراء'],['products','▦','المنتجات'],['parties','♧','الحسابات'],['reports','≡','التقارير'],['settings','⚙','الإعدادات']];
const titleMap={home:'نظرة عامة',sale:'فاتورة جديدة',products:'المنتجات والمخزون',parties:'الزبائن والموردون',reports:'التقارير وكشوف الحساب',settings:'إعدادات المتجر'};
let reportType='docs',reportParty='',reportFrom='',reportTo=today(),reportKind='all';
function toast(t,error=false){const e=$('#toast');e.textContent=t;e.className=error?'error':'';e.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>e.style.display='none',6500);}
function opts(items,selected=''){return items.map(([v,t])=>`<option value="${esc(v)}" ${v===selected?'selected':''}>${esc(t)}</option>`).join('');}
function partyOpts(type='',empty='بدون حساب — حركة عامة',selected=''){return opts([['',empty],...Object.values(state.parties).filter(p=>!type||p.type===type).map(p=>[p.id,p.name])],selected);}
function field(label,name,value='',type='text',extra=''){
  const numeric=type==='number',attrs=numeric?numericAttrs(extra.includes('0.001')):`type="${type}"${type==='date'||type==='tel'?' lang="en" dir="ltr"':''}`;
  const shown=numeric&&Number(value)===0?'':value;
  return `<label>${label}<input name="${name}" ${attrs} value="${esc(shown)}" ${extra}></label>`;
}
function modal(title,html){$('#modal-title').textContent=title;$('#modal-body').innerHTML=html;$('#modal').showModal();}
function empty(t){return `<div class="empty">${t}</div>`;}
function balanceLabel(n){return n>0?'لنا':n<0?'علينا':'مسدد';}
function balanceHtml(n){return `<span class="${n<0?'balance-neg':'balance-pos'}">${cash(Math.abs(n))} <small>${balanceLabel(n)}</small></span>`;}
function connect(url){
  return new Promise((resolve,reject)=>{
    if(!/^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/.test(url))return reject(Error('أدخل رابط نشر Apps Script المنتهي بـ /exec'));
    if(bridge){bridge.destroy();bridge=null;}
    const nonce=uid(), frame=document.createElement('iframe'), waits=new Map();let target=null,targetOrigin='', settled=false;
    frame.hidden=true;frame.title='اتصال Google Sheets';frame.src=url+'?nonce='+nonce;
    const timer=setTimeout(()=>{if(!settled){settled=true;cleanup();reject(Error('تعذر الربط. تحقق من نشر التطبيق بصلاحية Anyone ومن أصل الموقع في التهيئة.'));}},35000);
    function listener(e){
      if(!e.data||e.data.nonce!==nonce||!/^https:\/\/([a-z0-9-]+\.)?googleusercontent\.com$/.test(e.origin))return;
      if(e.data.channel==='market-ready'&&!settled){settled=true;clearTimeout(timer);target=e.source;targetOrigin=e.origin;resolve(bridge);}
      if(e.source!==target||e.origin!==targetOrigin)return;
      if(e.data.channel==='market-response'&&waits.has(e.data.id)){const p=waits.get(e.data.id);waits.delete(e.data.id);clearTimeout(p.timer);p.resolve(e.data.result);}
    }
    function cleanup(){window.removeEventListener('message',listener);frame.remove();clearTimeout(timer);waits.forEach(p=>{clearTimeout(p.timer);p.reject(Error('أُغلق الاتصال'));});waits.clear();}
    bridge={destroy:cleanup,request(request){return new Promise((resolve,reject)=>{if(!target)return reject(Error('الاتصال غير جاهز'));const id=uid();const timer=setTimeout(()=>{waits.delete(id);reject(Error('لم يصل تأكيد الحفظ. أعد محاولة نفس العملية من التنبيه، ولا تدخلها مرة ثانية.'));},45000);waits.set(id,{resolve,reject,timer});target.postMessage({channel:'market-request',nonce,id,request},targetOrigin);});}};
    window.addEventListener('message',listener);document.body.appendChild(frame);
  });
}
async function api(action,extra={}){
  if(demo){
    if(action==='snapshot')return {ok:true,state:Market.state(demoEvents)};
    if(action==='export')return {ok:true,events:demoEvents};
    if(action==='commit'){
      const e=Market.prepare(demoEvents,extra.request,{today:today(),now:new Date().toISOString()});
      if(!demoEvents.some(x=>x.id===e.id))demoEvents.push(e);
      localStorage.setItem('market-demo-v1',JSON.stringify(demoEvents));
      return {ok:true,event:e,state:Market.state(demoEvents)};
    }return {ok:true};
  }
  const r=await bridge.request({action,token,...extra});
  if(!r.ok){const err=Error(r.error);err.confirmed=!r.uncertain;throw err;}return r;
}
function setPending(value){pending=value;if(!demo){if(value)sessionStorage.setItem('market-pending:'+connectionUrl,JSON.stringify(value));else sessionStorage.removeItem('market-pending:'+connectionUrl);}pendingBanner();}
function pendingBanner(){const el=$('#pending-banner');el.hidden=!pending;el.innerHTML=pending?'توجد عملية لم يصل تأكيدها. لا تُعد إدخالها. <button data-a="retry">تحقق وأعد المحاولة</button>':'';}
async function commit(kind,data,date=today(),existing=null){
  if(busy)throw Error('انتظر انتهاء الحفظ');
  if(kind==='expense'&&state.accountingVersion!==2)throw Error('يلزم تحديث نشر Google Apps Script قبل حفظ المصروفات');
  if(pending&&!existing)throw Error('تحقق أولاً من العملية المعلقة في أعلى الشاشة');
  const request=existing||{id:uid(),kind,data:clone(data),date};setPending(request);busy=true;
  document.querySelectorAll('button[type=submit]').forEach(b=>b.disabled=true);
  try{const result=await api('commit',{request});state=result.state;setPending(null);toast(result.warning||('حُفظت العملية '+result.event.number));return result;}
  catch(err){if(err.confirmed||demo)setPending(null);throw err;}
  finally{busy=false;document.querySelectorAll('button[type=submit]').forEach(b=>b.disabled=false);}
}
function seedDemo(){
  let list=[];function add(kind,data){const r={id:uid(),kind,data,date:today()};const e=Market.prepare(list,r,{today:today(),now:new Date().toISOString()});list.push(e);return e;}
  add('opening',{amount:1500000,note:'رصيد تجريبي'});
  const products=[['أرز بسمتي 1 كغ','6281000000013',18000,22000,36,8],['حليب كامل الدسم','6281000000020',8500,11000,24,8],['زيت دوار الشمس 1 لتر','6281000000037',24000,29000,5,6],['سكر أبيض 1 كغ','6281000000044',10500,13000,50,10],['شاي أسود 200 غ','6281000000051',14000,17500,3,5],['بسكويت بالشوكولا','6281000000068',3000,4000,60,12]];
  products.forEach(p=>add('product',{name:p[0],barcode:p[1],cost:p[2],price:p[3],openingQty:p[4],minStock:p[5],unit:'قطعة'}));
  const supplier=add('party',{name:'شركة الشام للتجارة',phone:'09xxxxxxxx',type:'supplier',openingAmount:320000,openingDirection:'us'}).data.id;
  const customer=add('party',{name:'أحمد الحسن',phone:'09xxxxxxxx',type:'customer',openingAmount:85000,openingDirection:'them'}).data.id;
  const ids=Object.keys(Market.state(list).products);
  add('sale',{lines:[{productId:ids[0],qty:2,price:22000},{productId:ids[1],qty:2,price:11000}],discount:0,paid:66000,partyId:'',note:''});
  add('sale',{lines:[{productId:ids[3],qty:3,price:13000}],discount:0,paid:10000,partyId:customer,note:''});
  add('payment',{amount:100000,partyId:supplier,note:'دفعة للمورد'});return list;
}
function enter(){
  $('#gate').hidden=true;$('#shell').hidden=false;$('#demo-banner').hidden=!demo;$('#connection').textContent=demo?'نسخة تجريبية':'متصل بجوجل شيت';
  $('#today').textContent=new Intl.DateTimeFormat('ar-SY-u-nu-latn',{dateStyle:'full',timeZone:'Asia/Damascus'}).format(new Date());
  ['desktop-nav','mobile-nav'].forEach(id=>{$('#'+id).innerHTML=routes.map(([r,icon,t])=>`<a href="#${r}" data-route="${r}"><span>${icon}</span><span>${t}</span></a>`).join('');});
  pendingBanner();navigate(location.hash.slice(1)||'home');
}
function captureDraft(){const f=$('#invoice-form');if(f)invoiceDraft={...Object.fromEntries(new FormData(f)),payMode:$('#pay-mode').value};}
function navigate(r){if(route==='sale')captureDraft();route=titleMap[r]?r:'home';$('#page-title').textContent=titleMap[route];document.querySelectorAll('[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route===route));render();window.scrollTo(0,0);}
function render(){({home:renderHome,sale:renderInvoice,products:renderProducts,parties:renderParties,reports:renderReports,settings:renderSettings}[route])();}
function docTable(docs){return docs.length?`<div class="table-wrap"><table><thead><tr><th>المرجع / الحساب</th><th>الحركة</th><th>القيمة</th><th>الحالة</th><th></th></tr></thead><tbody>${docs.map(e=>`<tr><td><b dir="ltr">${esc(e.number)}</b><small class="muted">${esc(e.data.partyName||e.date)}</small></td><td>${Market.labels[e.kind]}</td><td>${cash(e.data.total??e.data.amount??0)}</td><td><span class="badge ${e.voided?'red':''}">${e.voided?'ملغاة':'معتمدة'}</span></td><td><button data-a="document" data-id="${e.id}">عرض</button></td></tr>`).join('')}</tbody></table></div>`:empty('لا توجد حركات بعد. ابدأ بإضافة المنتجات ورصيد الصندوق.');}
function renderHome(){
  const sales=state.docs.filter(e=>e.kind==='sale'&&!e.voided&&e.date===today()).reduce((a,e)=>a+e.data.total,0);
  const receivables=Object.values(state.parties).reduce((a,p)=>a+Math.max(p.balance,0),0),payables=Object.values(state.parties).reduce((a,p)=>a+Math.max(-p.balance,0),0);
  const low=Object.values(state.products).filter(p=>p.stock<=p.minStock);
  $('#main').innerHTML=`<section class="hero"><div><small>رصيد الصندوق الحالي</small><div class="amount">${number(state.cash)} <span>ليرة سورية</span></div><p>الرصيد الفعلي المسجّل بعد المقبوضات والمدفوعات</p></div><div class="hero-actions"><button class="primary" data-a="new-sale">+ فاتورة بيع</button><button class="secondary" data-a="voucher" data-kind="receipt">إضافة سند قبض</button></div></section>
  <div class="grid stats">${[['مبيعات اليوم',sales,'▤','إجمالي الفواتير المعتمدة'],['مبالغ لنا',receivables,'↙','أرصدة مدينة على الحسابات'],['مبالغ علينا',payables,'↗','أرصدة دائنة للحسابات']].map(([t,v,i,h])=>`<div class="card"><div class="stat-top">${t}<span class="stat-icon">${i}</span></div><div class="stat-value" style="--money-size:${Math.min(23,Math.floor(220/number(v).length))}px">${number(v)} <small>ل.س</small></div><span class="fine">${h}</span></div>`).join('')}</div>
  <div class="section-head"><h2>ماذا تريد أن تسجّل؟</h2><span class="muted">إجراءات سريعة</span></div><div class="quick-actions"><button data-a="new-purchase"><span>▧</span>فاتورة شراء</button><button data-a="voucher" data-kind="payment"><span>↗</span>سند دفع</button><button data-a="voucher" data-kind="expense"><span>↗</span>سند مصروفات</button><button data-a="product"><span>▦</span>منتج جديد</button><button data-a="party"><span>♧</span>حساب جديد</button></div>
  <div class="grid two-col"><section class="card table-card"><div class="section-head"><h2>آخر الحركات</h2><a href="#reports">عرض الكل ←</a></div>${docTable(state.docs.slice(-6).reverse())}</section><section class="card"><div class="section-head"><h2>تحتاج تزويد</h2><span class="badge warn">${low.length} منتجات</span></div>${low.length?low.slice(0,6).map(p=>`<div class="list-row"><span class="row-icon">▦</span><div class="list-name"><b>${esc(p.name)}</b><small>حد التنبيه: ${number(p.minStock)} ${esc(p.unit)}</small></div><span class="warning-text"><b>${number(p.stock)}</b><small>متبقي</small></span></div>`).join(''):empty('مخزونك فوق حدود التنبيه المحددة.')}<p class="fine" style="margin-top:16px">${Object.keys(state.products).length} منتج مسجّل في المتجر</p></section></div>`;
}
function renderProducts(){
  $('#main').innerHTML=`<div class="toolbar"><input id="product-search" placeholder="ابحث بالاسم أو الباركود…" aria-label="البحث في المنتجات"><button data-a="search-scan">▥ مسح</button><button class="primary" data-a="product">+ منتج</button></div><div class="card table-card" id="product-list"></div>`;productList('');
  $('#product-search').addEventListener('input',e=>productList(e.target.value));
}
function productList(q){const list=Object.values(state.products).filter(p=>p.name.includes(q)||p.barcode.includes(q));$('#product-list').innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>المنتج</th><th>الباركود</th><th>المتوفر</th><th>سعر البيع</th><th>تكلفة مرجعية</th><th></th></tr></thead><tbody>${list.map(p=>`<tr><td class="product-name"><b>${esc(p.name)}</b><small class="muted">${esc(p.unit)}</small></td><td dir="ltr">${esc(p.barcode||'—')}</td><td><span class="badge ${p.stock<=p.minStock?'warn':''}">${number(p.stock)}</span></td><td>${cash(p.price)}</td><td>${cash(p.cost)}</td><td><button data-a="product" data-id="${p.id}">تعديل</button></td></tr>`).join('')}</tbody></table></div>`:empty('لا توجد منتجات مطابقة. أضف أول منتج من الزر أعلاه.');}
function productForm(id='',barcode=''){
  const p=state.products[id]||{name:'',barcode,unit:'قطعة',price:0,cost:0,minStock:0,openingQty:0};
  modal(id?'تعديل المنتج':'إضافة منتج',`<form id="product-form" data-id="${esc(id)}"><div class="form-grid"><div class="wide">${field('اسم المنتج','name',p.name,'text','required maxlength="160"')}</div><label class="wide">الباركود<div class="inline"><input name="barcode" lang="en" value="${esc(p.barcode)}" maxlength="100" dir="ltr"><button type="button" data-a="product-scan">▥ كاميرا</button></div></label>${field('الوحدة','unit',p.unit,'text','required maxlength="30"')}${field('سعر البيع — ل.س','price',p.price,'number','required min="0" step="1"')}${field('تكلفة مرجعية — ل.س','cost',p.cost,'number','required min="0" step="1"')}${field('حد تنبيه المخزون','minStock',p.minStock,'number','min="0" step="0.001"')}${!id?field('كمية افتتاحية موجودة فعلاً','openingQty',0,'number','min="0" step="0.001"'):''}</div><p class="hint">الباركود نص للحفاظ على الأصفار في بدايته. تغيير المخزون لاحقاً يتم من الفواتير. تكلفة المنتج عند إنشائه تحدد قيمة المخزون الافتتاحي. بعدها تُحسب تكلفة البيع بمتوسط تكلفة المخزون والمشتريات بعد الخصم؛ تعديل هذه الخانة لا يغيّر قيمة المخزون أو أرباح المبيعات السابقة.</p><div class="error-text" id="form-error"></div><div class="form-actions"><button type="submit" class="primary">حفظ المنتج</button></div></form>`);
}
function renderParties(){
  $('#main').innerHTML=`<div class="toolbar"><input id="party-search" placeholder="اسم الحساب أو الهاتف…" aria-label="البحث في الحسابات"><select id="party-type" aria-label="نوع الحساب">${opts([['','الكل'],['customer','الزبائن'],['supplier','الموردون']])}</select><button class="primary" data-a="party">+ حساب</button></div><div id="party-list" class="card table-card"></div>`;
  const update=()=>partyList($('#party-search').value,$('#party-type').value);$('#party-search').oninput=update;$('#party-type').onchange=update;update();
}
function partyList(q,type){const list=Object.values(state.parties).filter(p=>(!type||p.type===type)&&(p.name.includes(q)||p.phone.includes(q)));$('#party-list').innerHTML=list.length?`<div class="table-wrap"><table><thead><tr><th>الحساب</th><th>النوع</th><th>الرصيد الحالي</th><th></th></tr></thead><tbody>${list.map(p=>`<tr><td><b>${esc(p.name)}</b><small class="muted" dir="ltr">${esc(p.phone)}</small></td><td>${p.type==='customer'?'زبون':'مورد'}</td><td>${balanceHtml(p.balance)}</td><td><button data-a="statement" data-id="${p.id}">كشف حساب</button> <button data-a="party" data-id="${p.id}">تعديل</button></td></tr>`).join('')}</tbody></table></div>`:empty('أضف الزبائن والموردين لتسجيل الديون والدفعات.');}
function partyForm(id=''){
  const p=state.parties[id]||{name:'',phone:'',type:'customer'};
  modal(id?'تعديل الحساب':'إضافة حساب',`<form id="party-form" data-id="${esc(id)}"><div class="form-grid"><label>نوع الحساب<select name="type" ${id?'disabled':''}>${opts([['customer','زبون'],['supplier','مورد']],p.type)}</select></label>${field('الاسم','name',p.name,'text','required maxlength="160"')}${field('رقم الهاتف','phone',p.phone,'tel','maxlength="40"')}${!id?field('رصيد سابق — ل.س','openingAmount',0,'number','min="0" step="1"'):''}${!id?`<label>اتجاه الرصيد السابق<select name="openingDirection">${opts([['them','لنا عنده (هو مدين)'],['us','علينا له (هو دائن)']])}</select></label>`:''}</div><p class="hint">الرصيد السابق يؤثر على كشف الحساب فقط ولا يغيّر الصندوق. دفعات الفواتير تظهر تلقائياً؛ لا تسجلها مرة أخرى كسند.</p><div class="error-text" id="form-error"></div><div class="form-actions"><button type="submit" class="primary">حفظ الحساب</button></div></form>`);
}
function renderInvoice(){
  const sale=invoiceKind==='sale';
  $('#main').innerHTML=`<div class="pill-tabs"><button data-a="invoice-type" data-kind="sale" class="${sale?'active':''}">فاتورة بيع</button><button data-a="invoice-type" data-kind="purchase" class="${!sale?'active':''}">فاتورة شراء</button></div><form id="invoice-form"><div class="invoice-layout"><section class="card"><div class="section-head"><h2>أضف المنتجات</h2><span class="muted">بالاسم أو الباركود</span></div><div class="inline"><input id="item-query" placeholder="اكتب الاسم أو امسح الباركود" autocomplete="off"><button type="button" data-a="invoice-scan" class="primary">▥ مسح</button></div><div class="results" id="item-results"></div><div id="cart"></div></section><section class="card invoice-summary"><h2>ملخص الفاتورة</h2><label>${sale?'الزبون':'المورد'}<select name="partyId" ${!sale?'required':''}>${partyOpts(sale?'customer':'supplier',sale?'زبون نقدي — بدون حساب':'اختر المورد')}</select></label>${field('تاريخ الفاتورة','date',today(),'date',`required max="${today()}"`)}<div class="totals-row"><span>قبل الخصم</span><b id="gross">0 ل.س</b></div>${field('خصم على الفاتورة — ل.س','discount',0,'number','min="0" step="1"')}<div class="totals-row big"><span>الإجمالي</span><span id="total">0</span></div><label>طريقة التسديد<select id="pay-mode">${opts([['cash','نقدي بالكامل'],['partial','دفعة جزئية / آجل']])}</select></label>${field(sale?'المقبوض الآن — ل.س':'المدفوع الآن — ل.س','paid',0,'number','min="0" step="1" readonly')}<div class="totals-row"><span>متبقي على الحساب</span><b id="remaining">0 ل.س</b></div>${field('ملاحظات (اختياري)','note','','text','maxlength="500"')}<div class="error-text" id="invoice-error"></div><button class="primary full" type="submit" style="margin-top:18px">اعتماد وحفظ الفاتورة</button><p class="hint">الحفظ يُحدّث المخزون والصندوق والحساب معاً.</p></section></div></form>`;
  $('#item-query').addEventListener('input',e=>itemResults(e.target.value));
  $('#item-query').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();lookupBarcode(e.target.value);}});
  $('#invoice-form [name=discount]').oninput=invoiceTotals;
  $('#invoice-form [name=paid]').oninput=invoiceTotals;
  $('#pay-mode').onchange=()=>{const p=$('#invoice-form [name=paid]');p.readOnly=$('#pay-mode').value==='cash';if(!p.readOnly)p.value='';invoiceTotals();};Object.entries(invoiceDraft).forEach(([k,v])=>{const el=$('#invoice-form [name=\"'+k+'\"]');if(el)el.value=v;});if(invoiceDraft.payMode){$('#pay-mode').value=invoiceDraft.payMode;$('#invoice-form [name=paid]').readOnly=invoiceDraft.payMode==='cash';}renderCart();
}
function itemResults(q){$('#item-results').innerHTML=q?Object.values(state.products).filter(p=>p.name.includes(q)||p.barcode.includes(q)).slice(0,8).map(p=>`<button type="button" data-a="add-item" data-id="${p.id}"><span>${esc(p.name)}<small class="muted">المتوفر: ${number(p.stock)}</small></span><b>${cash(invoiceKind==='sale'?p.price:p.cost)}</b></button>`).join(''):'';}
function addItem(id){const p=state.products[id];if(!p)return;const l=cart.find(x=>x.productId===id);if(l)l.qty=Market.qty(l.qty+1);else cart.push({productId:id,qty:1,price:invoiceKind==='sale'?p.price:p.cost});$('#item-query').value='';$('#item-results').innerHTML='';renderCart();}
function lookupBarcode(code){const p=Object.values(state.products).find(p=>p.barcode===englishDigits(code).trim());if(p)addItem(p.id);else toast('الباركود غير مسجل. أضف المنتج أولاً من المنتجات.',true);}
function renderCart(){
  $('#cart').innerHTML=cart.length?cart.map((l,i)=>`<div class="cart-row"><div><b>${esc(state.products[l.productId].name)}</b><small>${cash(Math.round(l.qty*l.price))}</small></div><label>الكمية<input ${numericAttrs(true)} data-cart="qty" data-index="${i}" value="${l.qty||''}" min="0.001" step="0.001" required></label><label>سعر الوحدة<input ${numericAttrs()} data-cart="price" data-index="${i}" value="${l.price||''}" min="0" step="1" required></label><button type="button" data-a="remove-item" data-index="${i}" aria-label="حذف البند">×</button></div>`).join(''):empty('الفاتورة فارغة.<br>امسح باركود المنتج أو ابحث عنه لإضافته.');
  document.querySelectorAll('[data-cart]').forEach(input=>input.addEventListener('input',e=>{const i=Number(e.target.dataset.index);cart[i][e.target.dataset.cart]=Number(e.target.value);e.target.closest('.cart-row').querySelector('small').textContent=cash(Math.round(cart[i].qty*cart[i].price));invoiceTotals();}));invoiceTotals();
}
function invoiceTotals(){
  const gross=cart.reduce((a,l)=>a+Math.round(l.qty*l.price),0), discount=Number($('#invoice-form [name=discount]').value)||0,total=gross-discount;
  if($('#pay-mode').value==='cash')$('#invoice-form [name=paid]').value=Math.max(total,0)||'';
  $('#gross').textContent=cash(gross);$('#total').textContent=cash(total);$('#remaining').textContent=cash(total-Number($('#invoice-form [name=paid]').value||0));
}
function voucherForm(kind){
  const opening=kind==='opening',expense=kind==='expense';
  if(expense&&state.accountingVersion!==2){toast('يلزم تحديث نشر Google Apps Script لتفعيل سند المصروفات',true);return;}
  modal(Market.labels[kind],`<form id="voucher-form" data-kind="${kind}"><div class="form-grid">${field('المبلغ — ليرة سورية','amount','','number','min="1" step="1" required')}${field('التاريخ','date',today(),'date',`required max="${today()}"`)}${expense?`<label class="wide">تصنيف المصروف<select name="category" required>${opts([['','اختر التصنيف'],['إيجار','إيجار'],['كهرباء ومياه','كهرباء ومياه'],['رواتب','رواتب'],['نقل','نقل'],['صيانة','صيانة'],['اتصالات','اتصالات'],['أخرى','أخرى']])}</select></label>`:!opening?`<label class="wide">الحساب المرتبط<select name="partyId">${partyOpts()}</select></label>`:''}<div class="wide">${field('البيان / الملاحظة','note','','text',`maxlength="500" ${expense?'required':''}`)}</div></div><p class="hint">${expense?'مصروف نقدي يُخصم من الصندوق ومن صافي الربح. سداد الموردين يكون بسند دفع، وشراء البضاعة بفاتورة شراء.':opening?'أدخل النقد الموجود فعلياً عند بدء الاستخدام، قبل أول فاتورة أو سند.':'اختر حساباً لتسوية ذمته، أو اتركه بدون حساب للسحب والإيداع العام. استخدم سند مصروفات للمصاريف التشغيلية. لا تكرر دفعة مسجلة داخل فاتورة.'}</p><div class="error-text" id="form-error"></div><div class="form-actions"><button type="submit" class="primary">حفظ السند</button></div></form>`);
}
const profitNote='التكلفة بمتوسط المخزون المتحرك حسب ترتيب تسجيل الحركات، وتشمل خصم المشتريات. المبيعات الآجلة تدخل في الربح عند البيع. الإلغاء يعكس الربح بتاريخ الإلغاء. التقرير لا يشمل الضرائب أو الإهلاك أو مصروفات غير مسجلة؛ سندات الدفع العامة القديمة لا تُصنّف كمصروفات تلقائياً.';
function profitSummary(r){return `<div class="grid profit-stats">${[['صافي المبيعات',r.profit.revenue],['تكلفة البضاعة المباعة',r.profit.cost],['مجمل الربح',r.profit.gross],['المصروفات',r.profit.expenses],['صافي الربح',r.profit.net]].map(([label,value])=>`<div class="card"><small>${label}</small><div class="stat-value ${value<0?'balance-neg':''}">${cash(value)}</div></div>`).join('')}</div><p class="hint">${profitNote}</p>`;}
function renderReports(){
  $('#main').innerHTML=`<div class="pill-tabs">${[['profit','تقرير الأرباح'],['docs','الفواتير والسندات'],['statement','كشف حساب'],['cash','حركة الصندوق']].map(([k,t])=>`<button data-a="report-type" data-kind="${k}" class="${reportType===k?'active':''}">${t}</button>`).join('')}</div><section class="card"><div class="report-filter">${reportType==='statement'?`<label>الحساب<select id="report-party">${partyOpts('','اختر زبوناً أو مورداً',reportParty)}</select></label>`:reportType==='docs'?`<label>نوع الحركة<select id="report-kind">${opts([['all','كل الحركات'],['sale','المبيعات'],['purchase','المشتريات'],['receipt','سندات القبض'],['payment','سندات الدفع'],['expense','سندات المصروفات']],reportKind)}</select></label>`:''}${field('من تاريخ','from',reportFrom,'date')}${field('إلى تاريخ','to',reportTo,'date')}<button class="secondary" data-a="print-report">طباعة / PDF</button><button class="secondary" data-a="csv-report">CSV</button></div><div id="report-content"></div></section>`;
  const update=()=>{reportFrom=$('#main [name=from]').value;reportTo=$('#main [name=to]').value;if($('#report-party'))reportParty=$('#report-party').value;if($('#report-kind'))reportKind=$('#report-kind').value;reportContent();};document.querySelectorAll('.report-filter input,.report-filter select').forEach(x=>x.onchange=update);reportContent();
}
function reportData(){
  const from=reportFrom,to=reportTo||'9999-12-31';if(from&&from>to)throw Error('تاريخ البداية بعد تاريخ النهاية');
  if(reportType==='profit'){
    const profit=Market.profit(state,from,to);return {title:'تقرير الأرباح',profit,head:['التاريخ','المرجع','الحركة','صافي المبيعات','تكلفة المبيعات','المصروفات','صافي الربح','التصنيف / البيان'],rows:profit.rows.map(x=>[x.date,x.ref,x.label,x.revenue,x.cost,x.expense,x.revenue-x.cost-x.expense,[x.category,x.note].filter(Boolean).join(' · ')])};
  }
  if(reportType==='statement'){
    if(!state.parties[reportParty])return null;const st=Market.statement(state,reportParty,from,to);
    return {title:'كشف حساب: '+state.parties[reportParty].name,opening:st.opening,closing:st.closing,head:['التاريخ','المرجع','البيان','مدين','دائن','الرصيد'],rows:st.rows.map(x=>[x.date,x.ref,x.label,x.debit,x.credit,x.balance])};
  }
  if(reportType==='cash'){
    const entries=state.cashLedger.slice().sort((a,b)=>a.date.localeCompare(b.date));let opening=0,balance=0;const rows=[];
    entries.forEach(x=>{if(x.date<from){opening+=x.delta;balance=opening;}else if(x.date<=to){balance+=x.delta;rows.push([x.date,x.ref,x.label,Math.max(x.delta,0),Math.max(-x.delta,0),balance]);}});
    return {title:'كشف حركة الصندوق',opening,closing:balance,head:['التاريخ','المرجع','البيان','قبض','دفع','الرصيد'],rows};
  }
  const docs=state.docs.filter(e=>e.date>=from&&e.date<=to&&(reportKind==='all'||e.kind===reportKind));
  return {title:'الفواتير والسندات',docs,head:['التاريخ','الرقم','النوع','الحساب','الإجمالي','المدفوع عند الإصدار','المتبقي عند الإصدار','الحالة'],rows:docs.map(e=>[e.date,e.number,Market.labels[e.kind],e.data.partyName||'',e.data.total??e.data.amount??0,e.data.paid??'',e.data.total!=null?e.data.total-e.data.paid:'',e.voided?'ملغاة':'معتمدة'])};
}
function reportContent(){try{const r=reportData();if(!r){$('#report-content').innerHTML=empty('اختر الحساب لعرض جميع حركاته ورصيده.');return;}$('#report-content').innerHTML=reportType==='docs'?docTable(r.docs.slice().reverse()):reportType==='profit'?profitSummary(r)+dataTable(r):`<div class="report-summary"><div><small>رصيد أول الفترة</small><strong>${cash(r.opening)}</strong></div><div><small>رصيد نهاية الفترة${reportType==='statement'?' · '+balanceLabel(r.closing):''}</small><strong>${cash(reportType==='statement'?Math.abs(r.closing):r.closing)}</strong></div></div>${dataTable(r)}${reportType==='statement'?'<p class="hint">الموجب: لنا عند الحساب. السالب: علينا للحساب. مدين ودائن من منظور دفاتر المتجر. الدفعات تسوّي إجمالي الحساب دون تخصيص لفاتورة معينة.</p>':''}`;}catch(e){$('#report-content').innerHTML=empty(esc(e.message));}}
function dataTable(r){return r.rows.length?`<div class="table-wrap"><table><thead><tr>${r.head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${r.rows.map(row=>`<tr>${row.map(v=>`<td>${typeof v==='number'?number(v):esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`:empty('لا توجد حركات ضمن الفترة المحددة.');}
function documentDetail(id){const e=state.docs.find(d=>d.id===id);if(!e)return;modal(Market.labels[e.kind]+' '+e.number,documentHtml(e)+`<div class="form-actions"><button data-a="print-document" data-id="${e.id}">طباعة / PDF</button>${!e.voided&&['sale','purchase','receipt','payment','expense'].includes(e.kind)?`<button class="danger" data-a="void-form" data-id="${e.id}">إلغاء الحركة</button>`:''}</div>`);}
function documentHtml(e){const d=e.data;return `<p>${esc(e.date)} · ${esc(d.partyName||'حركة عامة')} ${e.voided?' · ملغاة':''}</p>${d.lines?dataTable({head:['المنتج','الكمية','السعر','المجموع'],rows:d.lines.map(l=>[l.name,l.qty,l.price,l.total])})+`<div class="totals-row"><span>الخصم</span><b>${cash(d.discount)}</b></div><div class="totals-row"><span>الإجمالي</span><b>${cash(d.total)}</b></div><div class="totals-row"><span>المدفوع عند الإصدار</span><b>${cash(d.paid)}</b></div><div class="totals-row"><span>المتبقي عند الإصدار</span><b>${cash(d.total-d.paid)}</b></div>`:`<h2>${d.amount?cash(d.amount):''}</h2>`}${d.category?`<p>التصنيف: ${esc(d.category)}</p>`:''}<p class="hint">${esc(d.note||'')}</p>${e.kind==='void'?`<p>مرجع الحركة الأصلية: ${esc(state.docs.find(x=>x.id===d.targetId)?.number||d.targetId)}</p>`:''}`;}
function printHtml(title,html){$('#print-area').innerHTML=`<div class="print-head"><h1>${esc(window.MARKET_CONFIG.storeName||'سوبر ماركت')}</h1><h2>${esc(title)}</h2><p>العملة: ليرة سورية · ${demo?'نسخة تجريبية':''}</p></div>${html}`;window.print();}
function renderSettings(){
  $('#main').innerHTML=`<div class="settings-list"><section class="card"><h2>بداية التشغيل</h2><p class="hint">أدخل النقد الموجود في الصندوق قبل أول حركة مالية. أرصدة الزبائن والموردين تُدخل عند إنشاء حساباتهم، والمخزون الموجود عند إضافة المنتجات.</p><button data-a="voucher" data-kind="opening" class="primary" ${state.docs.length?'disabled':''}>إدخال رصيد افتتاحي للصندوق</button></section><section class="card"><h2>حماية بياناتك</h2><p class="hint">نزّل نسخة من سجل الحركات بصيغة JSON. لنسخة قابلة للاستعادة بسهولة، استخدم «نسخة احتياطية كاملة» من قائمة السوبر ماركت داخل Google Sheets. حافظ على نسخة خارج ملف التشغيل.</p><button data-a="backup">تنزيل سجل الحركات</button></section><section class="card"><h2>الاتصال والاستخدام</h2><p class="hint">${demo?'أنت في النسخة التجريبية. بياناتها محفوظة في هذا المتصفح.':'مدة الجلسة حتى ساعة وقد تنتهي مبكراً؛ كلمة المرور لا تُحفظ على الجهاز. جميع عمليات الحفظ تحتاج اتصالاً بالإنترنت.'}</p><p class="hint">لإضافة التطبيق إلى الموبايل: افتح قائمة المتصفح ← إضافة إلى الشاشة الرئيسية. الكاميرا تحتاج HTTPS وإذن الكاميرا.</p><p class="hint">نسخة لمتجر صغير، صندوق واحد، وصلاحية مشتركة واحدة. تقرير الأرباح يعتمد على الحركات المسجلة وتكلفة المخزون. لا تشمل النسخة ضرائب أو إهلاكاً أو مرتجعات جزئية أو إدارة صلاحيات الموظفين.</p><div class="form-actions">${demo?'<button class="danger" data-a="reset-demo">إعادة بيانات التجربة</button>':''}<button data-a="logout" class="secondary">خروج</button></div></section></div>`;
}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function scannerLibrary(){if(window.Html5Qrcode)return;if(!scannerLibrary.promise)scannerLibrary.promise=new Promise((resolve,reject)=>{const el=document.createElement('script');el.src='vendor/html5-qrcode.min.js';el.onload=resolve;el.onerror=()=>{scannerLibrary.promise=null;reject(Error('تعذر تحميل قارئ الباركود؛ أدخل الرقم يدوياً أو تحقق من الإنترنت.'));};document.head.appendChild(el);});await scannerLibrary.promise;}
async function openScanner(callback){
  scanCallback=callback;$('#scanner-status').textContent='جارٍ تشغيل الكاميرا…';$('#scanner-modal').showModal();
  try{await scannerLibrary();if(!$('#scanner-modal').open)return;scan=new Html5Qrcode('reader',{formatsToSupport:[Html5QrcodeSupportedFormats.EAN_13,Html5QrcodeSupportedFormats.EAN_8,Html5QrcodeSupportedFormats.UPC_A,Html5QrcodeSupportedFormats.UPC_E,Html5QrcodeSupportedFormats.CODE_128,Html5QrcodeSupportedFormats.CODE_39,Html5QrcodeSupportedFormats.QR_CODE],verbose:false});
    const instance=scan;
    await instance.start({facingMode:'environment'},{fps:8,qrbox:(w,h)=>({width:Math.min(w-20,320),height:Math.min(h-20,180)})},async code=>{const fn=scanCallback;scanCallback=null;await closeScanner();if(fn)fn(code);},()=>{});
    if(!$('#scanner-modal').open||scan!==instance){if(instance.isScanning)await instance.stop();instance.clear();return;}$('#scanner-status').textContent='ضع باركود منتج واحد داخل الإطار.';
  }catch(e){$('#scanner-status').textContent='الكاميرا غير متاحة. اسمح بالوصول إليها أو اختر صورة للباركود. '+(e.message||'');}
}
async function closeScanner(){try{if(scan){if(scan.isScanning)await scan.stop();scan.clear();}}catch(e){}scan=null;$('#scanner-modal').close();}
$('#barcode-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{await scannerLibrary();if(scan?.isScanning)await scan.stop();if(!scan)scan=new Html5Qrcode('reader');const code=await scan.scanFile(file,false),fn=scanCallback;scanCallback=null;await closeScanner();if(fn)fn(code);}catch(err){$('#scanner-status').textContent='لم تتم قراءة الباركود. جرّب صورة أوضح أو أدخله يدوياً.';}finally{e.target.value='';}};
$('#close-scanner').onclick=closeScanner;$('#scanner-modal').addEventListener('cancel',e=>{e.preventDefault();closeScanner();});
$('#close-modal').onclick=()=>{if(!busy)$('#modal').close();};$('#modal').addEventListener('cancel',e=>{if(busy)e.preventDefault();});
$('#login-form').onsubmit=async e=>{e.preventDefault();const btn=$('#login-btn');btn.disabled=true;$('#login-status').textContent='جارٍ الاتصال…';try{const url=String(window.MARKET_CONFIG.scriptUrl||'').trim();if(!url)throw Error('لم يكتمل إعداد اتصال المتجر؛ تواصل مع مسؤول المتجر');await connect(url);const r=await bridge.request({action:'login',username:$('#username').value.trim(),password:$('#password').value});$('#password').value='';if(!r.ok)throw Error(r.error);if(r.serverVersion!==2)throw Error('يلزم تحديث نشر Google Apps Script لتفعيل تسجيل الدخول باسم المستخدم');token=r.token;connectionUrl=url;demo=false;state=(await api('snapshot')).state;$('#login-status').textContent='';pending=JSON.parse(sessionStorage.getItem('market-pending:'+connectionUrl)||'null');enter();}catch(err){$('#login-status').textContent=err.message;}finally{btn.disabled=false;}};
$('#demo-btn').onclick=()=>{demo=true;token='';pending=null;try{demoEvents=JSON.parse(localStorage.getItem('market-demo-v1'))||seedDemo();state=Market.state(demoEvents);}catch(e){demoEvents=seedDemo();state=Market.state(demoEvents);}localStorage.setItem('market-demo-v1',JSON.stringify(demoEvents));enter();};
$('#refresh-btn').onclick=async()=>{if(busy)return;try{state=(await api('snapshot')).state;if(route!=='sale')render();toast('تم تحديث الأرصدة');}catch(e){toast(e.message,true);}};
window.addEventListener('hashchange',()=>{if(!$('#shell').hidden)navigate(location.hash.slice(1));});
document.addEventListener('submit',async e=>{
  const form=e.target;if(!['product-form','party-form','invoice-form','voucher-form','void-form'].includes(form.id))return;e.preventDefault();const d=Object.fromEntries(new FormData(form)),err=$('#form-error')||$('#invoice-error');if(err)err.textContent='';
  try{
    if(form.id==='product-form'){await commit('product',{...d,id:form.dataset.id||undefined});$('#modal').close();render();}
    if(form.id==='party-form'){await commit('party',{...d,id:form.dataset.id||undefined,type:form.dataset.id?state.parties[form.dataset.id].type:d.type});$('#modal').close();render();}
    if(form.id==='voucher-form'){await commit(form.dataset.kind,d,d.date);$('#modal').close();render();}
    if(form.id==='void-form'){await commit('void',{targetId:form.dataset.id,note:d.note});$('#modal').close();render();}
    if(form.id==='invoice-form'){const r=await commit(invoiceKind,{...d,lines:clone(cart)},d.date);cart=[];invoiceDraft={};renderInvoice();documentDetail(r.event.id);}
  }catch(error){if(err)err.textContent=error.message;toast(error.message,true);}
});
document.addEventListener('click',async e=>{
  const b=e.target.closest('[data-a]');if(!b)return;const a=b.dataset.a,id=b.dataset.id,kind=b.dataset.kind;
  try{
    if(a==='product')productForm(id);
    if(a==='party')partyForm(id);
    if(a==='voucher')voucherForm(kind);
    if(a==='new-sale'||a==='new-purchase'||a==='invoice-type'){
      const target=kind||(a==='new-sale'?'sale':'purchase');if(target!==invoiceKind&&cart.length&&!confirm('تغيير نوع الفاتورة يمسح البنود الحالية. متابعة؟'))return;if(target!==invoiceKind){cart=[];invoiceDraft={};}else if(route==='sale')captureDraft();invoiceKind=target;location.hash='sale';if(route==='sale')renderInvoice();
    }
    if(a==='add-item')addItem(id);
    if(a==='remove-item'){cart.splice(Number(b.dataset.index),1);renderCart();}
    if(a==='invoice-scan')await openScanner(lookupBarcode);
    if(a==='product-scan')await openScanner(code=>{$('#product-form [name=barcode]').value=englishDigits(code);});
    if(a==='search-scan')await openScanner(code=>{$('#product-search').value=code;productList(code);});
    if(a==='statement'){reportType='statement';reportParty=id;location.hash='reports';if(route==='reports')renderReports();}
    if(a==='report-type'){reportType=kind;renderReports();}
    if(a==='document')documentDetail(id);
    if(a==='print-document'){const d=state.docs.find(x=>x.id===id);printHtml(Market.labels[d.kind]+' '+d.number,documentHtml(d));}
    if(a==='void-form'){
      const d=state.docs.find(x=>x.id===id);$('#modal').close();modal('إلغاء '+d.number,`<form id="void-form" data-id="${id}"><p>سيُسجّل قيد عكسي للمخزون والصندوق والحساب، مع الاحتفاظ بالحركة الأصلية. الإلغاء كامل ولا يمكن التراجع عنه.</p>${field('سبب الإلغاء','note','','text','required maxlength="500"')}<div id="form-error" class="error-text"></div><div class="form-actions"><button class="danger" type="submit">تأكيد إلغاء الحركة</button></div></form>`);
    }
    if(a==='print-report'){const r=reportData();if(!r)throw Error('اختر الحساب أولاً');printHtml(r.title,`<p>الفترة: ${esc(reportFrom||'من البداية')} — ${esc(reportTo||'حتى النهاية')}</p>${r.opening!=null?`<p>أول الفترة: ${cash(r.opening)} · آخر الفترة: ${cash(r.closing)}</p>`:''}${r.profit?profitSummary(r):''}${dataTable(r)}${reportType==='statement'?'<p>الموجب لنا، والسالب علينا في كشف الحساب.</p>':''}`);}
    if(a==='csv-report'){const r=reportData();if(!r)throw Error('اختر الحساب أولاً');const cell=v=>'"'+String(typeof v==='string'&&/^[=+@\-]/.test(v)?"'"+v:v).replace(/"/g,'""')+'"';const rows=[r.head,...r.rows];if(r.profit)rows.push([],['صافي المبيعات',r.profit.revenue],['تكلفة البضاعة المباعة',r.profit.cost],['مجمل الربح',r.profit.gross],['المصروفات',r.profit.expenses],['صافي الربح',r.profit.net],['طريقة الحساب',profitNote]);if(r.opening!=null)rows.push(['رصيد أول الفترة',r.opening],['رصيد نهاية الفترة',r.closing]);download('report-'+today()+'.csv','\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n'),'text/csv;charset=utf-8');}
    if(a==='backup'){const r=await api('export');download('market-backup-'+today()+'.json',JSON.stringify({schemaVersion:1,currency:'SYP',exportedAt:new Date().toISOString(),events:r.events},null,2),'application/json');}
    if(a==='retry'){const req=pending;if(!req)return;const r=await commit(req.kind,req.data,req.date,req);if(['sale','purchase'].includes(req.kind)){cart=[];invoiceDraft={};}render();if(['sale','purchase','receipt','payment','expense'].includes(req.kind))documentDetail(r.event.id);}
    if(a==='reset-demo'&&confirm('حذف تعديلات التجربة وإعادة البيانات الأصلية؟')){demoEvents=seedDemo();localStorage.setItem('market-demo-v1',JSON.stringify(demoEvents));state=Market.state(demoEvents);cart=[];render();}
    if(a==='logout'){if(busy)return;if(pending&&!confirm('هناك عملية معلقة. ستبقى محفوظة للتحقق بعد الدخول. هل تريد الخروج؟'))return;try{await api('logout');}catch(e){}token='';state=Market.state([]);cart=[];invoiceDraft={};if(bridge){bridge.destroy();bridge=null;}$('#shell').hidden=true;$('#gate').hidden=false;$('#password').value='';}
  }catch(err){toast(err.message,true);}
});
window.addEventListener('beforeunload',e=>{if(busy||cart.length){e.preventDefault();e.returnValue='';}});
