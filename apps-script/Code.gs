/* Bind this project to the imported Supermarket.xlsx Google Sheet. */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('السوبر ماركت').addItem('تهيئة وربط التطبيق', 'setup_').addItem('تحديث جداول العرض','refreshViews_').addItem('نسخة احتياطية كاملة','backup_').addToUi();
}
function setup_() {
  const ui=SpreadsheetApp.getUi(), props=PropertiesService.getScriptProperties();
  const a=ui.prompt('رابط موقعك','أدخل أصل GitHub Pages فقط، مثل https://username.github.io دون اسم المستودع',ui.ButtonSet.OK_CANCEL);
  if(a.getSelectedButton()!==ui.Button.OK)return;
  const origin=a.getResponseText().trim().replace(/\/$/,'');
  if(!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?$/.test(origin))throw new Error('الرابط يجب أن يكون HTTPS دون مسار');
  const b=ui.prompt('كلمة مرور التطبيق','اختر كلمة مرور طويلة لا تقل عن 16 حرفاً؛ لا تضعها في ملفات GitHub',ui.ButtonSet.OK_CANCEL);
  if(b.getSelectedButton()!==ui.Button.OK)return;
  const password=b.getResponseText(); if(password.length<16)throw new Error('كلمة المرور قصيرة');
  const salt=Utilities.getUuid();
  props.setProperties({SHEET_ID:SpreadsheetApp.getActive().getId(),ALLOWED_ORIGIN:origin,PASSWORD_SALT:salt,PASSWORD_HASH:hash_(salt+password),AUTH_VERSION:Utilities.getUuid()});
  const ss=db_();
  ss.getSheets().forEach(sh=>sh.setRightToLeft(true));
  ['السجل','المنتجات','الحسابات','الفواتير','بنود الفواتير','السندات','حركة الحسابات','الصندوق'].forEach(name=>{if(!ss.getSheetByName(name))throw new Error('استورد Supermarket.xlsx أولاً؛ الورقة مفقودة: '+name);});
  ss.getSheetByName('السجل').getRange('A1:E1').setValues([['معرف العملية','التاريخ','النوع','الرقم','JSON']]);
  refreshViews_(); ui.alert('اكتملت التهيئة. انشر المشروع كتطبيق ويب ينفذ بصلاحياتك مع وصول Anyone.');
}
function hash_(value){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value).map(b=>(b+256).toString(16).slice(-2)).join('');}
function db_(){return SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));}
function events_(){const sh=db_().getSheetByName('السجل');return sh.getLastRow()<2?[]:sh.getRange(2,5,sh.getLastRow()-1,1).getValues().filter(r=>r[0]).map(r=>JSON.parse(r[0]));}
function doGet(e){
  const props=PropertiesService.getScriptProperties();
  const nonce=String(e.parameter.nonce||''); if(!/^[a-zA-Z0-9-]{16,80}$/.test(nonce))return HtmlService.createHtmlOutput('افتح التطبيق من رابط GitHub Pages.');
  const t=HtmlService.createTemplateFromFile('Bridge');
  t.origin=JSON.stringify(props.getProperty('ALLOWED_ORIGIN')||'');t.nonce=JSON.stringify(nonce);
  return t.evaluate().setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
function callApi(req){
  let writeAttempted=false;
  try {
    if(!req||JSON.stringify(req).length>44000)throw new Error('طلب غير صالح أو كبير جداً');
    const p=PropertiesService.getScriptProperties(), cache=CacheService.getScriptCache();
    if(!p.getProperty('AUTH_VERSION'))throw new Error('أكمل تهيئة التطبيق من قائمة السوبر ماركت داخل الشيت');
    if(req.action==='login') {
      const lock=LockService.getScriptLock();lock.waitLock(15000);
      try {
        const failures=Number(cache.get('auth_failures')||0);
        if(failures>=15)throw new Error('محاولات كثيرة؛ انتظر 5 دقائق');
        if(hash_(p.getProperty('PASSWORD_SALT')+String(req.password||''))!==p.getProperty('PASSWORD_HASH')){cache.put('auth_failures',String(failures+1),300);throw new Error('كلمة المرور غير صحيحة');}
        cache.remove('auth_failures');const token=Utilities.getUuid()+Utilities.getUuid();
        cache.put('session_'+hash_(token),p.getProperty('AUTH_VERSION'),3600);
        return {ok:true,token};
      }finally{lock.releaseLock();}
    }
    const sessionKey='session_'+hash_(String(req.token||''));
    if(!req.token||cache.get(sessionKey)!==p.getProperty('AUTH_VERSION'))throw new Error('انتهت الجلسة؛ سجّل الدخول مجدداً');
    if(req.action==='logout'){cache.remove(sessionKey);return {ok:true};}
    if(req.action==='snapshot'){const events=events_();return {ok:true,state:Market.state(events)};}
    if(req.action==='export')return {ok:true,events:events_(),exportedAt:new Date().toISOString()};
    if(req.action!=='commit')throw new Error('عملية غير معروفة');
    const lock=LockService.getScriptLock();lock.waitLock(20000);
    try {
      const events=events_(), old=events.find(e=>e.id===req.request.id);
      if(old)return {ok:true,event:old,state:Market.state(events),duplicate:true};
      const event=Market.prepare(events,req.request,{today:Utilities.formatDate(new Date(),'Asia/Damascus','yyyy-MM-dd'),now:new Date().toISOString()});
      const json=JSON.stringify(event);if(json.length>44000)throw new Error('الفاتورة كبيرة جداً؛ قسمها إلى فاتورتين');
      // Exactly one append is the accounting commit. Derived views are disposable.
      writeAttempted=true;
      db_().getSheetByName('السجل').appendRow([event.id,event.date,event.kind,event.number,json]);
      SpreadsheetApp.flush();events.push(event);
      let warning='';try{views_(Market.state(events));}catch(err){warning='حُفظت الحركة. تعذر تحديث عرض الشيت؛ اختر تحديث جداول العرض من قائمة السوبر ماركت.';}
      return {ok:true,event,state:Market.state(events),warning};
    }finally{lock.releaseLock();}
  }catch(err){return {ok:false,error:String(err.message||err),uncertain:writeAttempted};}
}
function safe_(v){return typeof v==='string'&&/^[=+@\-]/.test(v)?"'"+v:v;}
function table_(name,head,rows){
  const sh=db_().getSheetByName(name);sh.clearContents();
  const data=[head].concat(rows).map(r=>r.map(safe_));
  if(sh.getMaxRows()<data.length)sh.insertRowsAfter(sh.getMaxRows(),data.length-sh.getMaxRows());
  sh.getRange(1,1,data.length,head.length).setValues(data);sh.setRightToLeft(true);sh.setFrozenRows(1);
  sh.getRange(1,1,1,head.length).setBackground('#125b4f').setFontColor('#ffffff').setFontWeight('bold');
}
function views_(s){
  table_('المنتجات',['المعرف','المنتج','الباركود','الوحدة','تكلفة مرجعية','سعر البيع','المخزون','حد التنبيه'],Object.values(s.products).map(p=>[p.id,p.name,"'"+p.barcode,p.unit,p.cost,p.price,p.stock,p.minStock]));
  table_('الحسابات',['المعرف','الاسم','النوع','الهاتف','الرصيد: موجب لنا، سالب علينا'],Object.values(s.parties).map(p=>[p.id,p.name,p.type==='customer'?'زبون':'مورد',"'"+p.phone,p.balance]));
  const invoices=s.docs.filter(e=>['sale','purchase'].includes(e.kind));
  table_('الفواتير',['الرقم','التاريخ','النوع','الحساب','قبل الخصم','الخصم','الإجمالي','المدفوع عند الإصدار','المتبقي عند الإصدار','الحالة','ملاحظات'],invoices.map(e=>[e.number,e.date,Market.labels[e.kind],e.data.partyName,e.data.gross,e.data.discount,e.data.total,e.data.paid,e.data.total-e.data.paid,e.voided?'ملغاة':'معتمدة',e.data.note]));
  table_('بنود الفواتير',['رقم الفاتورة','التاريخ','المنتج','الباركود','الكمية','السعر','الإجمالي','الحالة'],invoices.flatMap(e=>e.data.lines.map(l=>[e.number,e.date,l.name,"'"+l.barcode,l.qty,l.price,l.total,e.voided?'ملغاة':'معتمدة'])));
  table_('السندات',['الرقم','التاريخ','النوع','الحساب','المبلغ','البيان','الحالة'],s.docs.filter(e=>['receipt','payment','opening','void'].includes(e.kind)).map(e=>[e.number,e.date,Market.labels[e.kind],e.data.partyName||'',e.data.amount||0,e.data.note||'',e.voided?'ملغى':'معتمد']));
  table_('حركة الحسابات',['التاريخ','الحساب','البيان','المرجع','مدين','دائن'],s.ledger.map(x=>[x.date,s.parties[x.partyId].name,x.label,x.ref,x.debit,x.credit]));
  let balance=0;table_('الصندوق',['التاريخ','البيان','المرجع','قبض','دفع','الرصيد'],s.cashLedger.map(x=>{balance+=x.delta;return [x.date,x.label,x.ref,Math.max(x.delta,0),Math.max(-x.delta,0),balance];}));
}
function refreshViews_(){const l=LockService.getScriptLock();l.waitLock(20000);try{views_(Market.state(events_()));}finally{l.releaseLock();}}
function backup_(){const ss=db_();const copy=ss.copy(ss.getName()+' - نسخة '+Utilities.formatDate(new Date(),'Asia/Damascus','yyyy-MM-dd HH-mm'));SpreadsheetApp.getUi().alert('تم إنشاء نسخة في Google Drive:\n'+copy.getUrl());}
