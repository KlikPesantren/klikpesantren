// Entire synthetic merchant/wallet fixture is rolled back. Never resets a schema.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),bcrypt=require('bcryptjs'),{Pool}=require('pg');
const pool=new Pool({host:'127.0.0.1',port:55439,user:'pos_test_owner',database:'pos_business_v2_test',max:1});
let client,passed=0,before,readBegins=0,queryCount=0,fixtureDate=null,profileReady=false,profiled=false;
const id=()=>crypto.randomUUID(),key=()=>`finance-qa-${id()}`;
const tables=['pos_business_operations','pos_business_lines','pos_inventory_movements','pos_inventory_layers','pos_inventory_allocations','pos_business_payments','pos_money_movements','pos_debt_movements','wallet_accounts','wallet_transactions','pos_business_wallet_links','pos_business_initializations','pos_business_initialization_items','pos_business_initialization_corrections','pos_wallet_settlement_payouts'];
async function fingerprint(){const parts=[];for(const table of tables)parts.push((await client.query(`SELECT md5(coalesce(string_agg(row_to_json(t)::text,'' ORDER BY id::text),'')) hash FROM ${table} t`)).rows[0].hash);return parts.join(':');}
const test=async(name,f)=>{await f();passed++;console.log('PASS '+name);};
async function main(){
 client=await pool.connect();
 const identity=(await client.query('SELECT current_database() db,current_user,host(inet_server_addr()) host,inet_server_port() port')).rows[0];
 assert.deepEqual(identity,{db:'pos_business_v2_test',current_user:'pos_test_owner',host:'127.0.0.1',port:55439});
 before=await fingerprint();await client.query('BEGIN');
 let serial=0;const stack=[];
 const connection={release(){},async query(sql,args){const command=typeof sql==='string'?sql.trim().toUpperCase():'';
  if(command.startsWith('BEGIN')){if(command.includes('READ ONLY'))readBegins++;const save='qa_'+(++serial);stack.push(save);return client.query('SAVEPOINT '+save);}
  if(command==='COMMIT')return client.query('RELEASE SAVEPOINT '+stack.pop());
  if(command==='ROLLBACK'){const save=stack.pop();await client.query('ROLLBACK TO SAVEPOINT '+save);return client.query('RELEASE SAVEPOINT '+save);}
  // Nested service calls share the outer rollback transaction's now(). Give
  // synthetic layers real statement times so FIFO tests model separate posts.
  if(command.startsWith('INSERT INTO POS_INVENTORY_LAYERS('))sql=sql.replace('unit_cost)','unit_cost,created_at)').replace('$6)','$6,clock_timestamp())');
  queryCount++;if(process.env.POS_FINANCE_PROFILE==='1'&&profileReady&&!profiled&&(command.startsWith('WITH UNIFIED')||command.startsWith('WITH DATED'))&&command.includes('LIMIT $14')){profiled=true;const plan=(await client.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+sql,args)).rows[0]['QUERY PLAN'][0];require('node:fs').writeFileSync(require('node:path').join(__dirname,'../.tmp/cashflow-discount-query-profile.json'),JSON.stringify(plan,null,2));console.log('QUERY_PROFILE '+JSON.stringify({planning_ms:plan['Planning Time'],execution_ms:plan['Execution Time'],jit:plan.JIT||null}));}
  if(connection.posReadOnly)assert(!/^(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/i.test(command),'read projection cannot post');
  if(fixtureDate&&command.startsWith('INSERT INTO POS_BUSINESS_OPERATIONS(')){args=[...args];args[16]=fixtureDate.date;sql=sql.replace('finance_category_id)','finance_category_id,created_at)').replace('$18)','$18,$19)');args.push(fixtureDate.time);}
  try{return await client.query(sql,args);}catch(e){console.error('QUERY',sql);throw e;}
 }};
 const db={query:connection.query.bind(connection),connect:async()=>connection};
 const dbPath=require.resolve('../db');require.cache[dbPath]={id:dbPath,filename:dbPath,loaded:true,exports:db};
 const core=require('../services/posBusinessService').createPosBusinessService({db,featureEnabled:async()=>true});
 const business=id(),other=id(),foreign=id(),owner=id(),cashier=id(),otherUser=id(),password=crypto.randomBytes(24).toString('hex');
 const hash=await bcrypt.hash(password,4);
 for(const user of [owner,cashier,otherUser])await client.query('INSERT INTO pos_merchant_users(id,login,name,password_hash) VALUES($1,$2,$3,$4)',[user,'qa-'+user,'Rollback QA',hash]);
 for(const [biz,tenant] of [[business,1],[other,1],[foreign,2]])await client.query("INSERT INTO pos_businesses(id,tenant_id,ownership,display_name,timezone,integration_enabled,wallet_enabled) VALUES($1,$2,'INTERNAL','Rollback pricing QA','Asia/Jakarta',true,true)",[biz,tenant]);
 for(const [biz,tenant,user,role] of [[business,1,owner,'OWNER'],[business,1,cashier,'CASHIER'],[other,1,otherUser,'OWNER'],[foreign,2,otherUser,'OWNER']])await client.query('INSERT INTO pos_merchant_memberships(business_id,tenant_id,user_id,role) VALUES($1,$2,$3,$4)',[biz,tenant,user,role]);
 const ownerToken=(await core.login({body:{login:'qa-'+owner,password}})).token,cashierToken=(await core.login({body:{login:'qa-'+cashier,password}})).token,otherToken=(await core.login({body:{login:'qa-'+otherUser,password}})).token;
 const req=(body={},token=ownerToken,biz=business,params={})=>({body,headers:{authorization:'Bearer '+token},params:{businessId:biz,...params},query:{}});
 const reject=(f,code)=>assert.rejects(f,e=>e.code===code);
 const product=async(name,price,token=ownerToken,biz=business)=>(await core.product(req({sku:key(),name,selling_price:price,uom:'pcs'},token,biz))).id;

 const air=await product('Air',5000),mie=await product('Mie',8000);
 const supplier=(await core.party(req({kind:'SUPPLIER',name:'Finance Supplier'}))).id;
 const customer=(await core.party(req({kind:'CUSTOMER',name:'Finance Customer',credit_allowed:true,credit_limit:'10000000'}))).id;
 const cash=(await core.account(req({kind:'CASH',name:'Cash'}))).id,bank=(await core.account(req({kind:'BANK',name:'Bank'}))).id,bank2=(await core.account(req({kind:'BANK',name:'Bank 2'}))).id;
 const today=(await client.query("SELECT to_char(now() AT TIME ZONE 'Asia/Jakarta','YYYY-MM-DD') AS day")).rows[0].day;
 const read=(f,q={})=>core[f]({...req(),query:q}),money=(kind,amount,extra={})=>core.money(req({kind,amount:String(amount),account_id:cash,reason:'Rollback Finance QA',request_id:key(),...extra}));
 await test('opening AR/AP partial/full, retry, overpay, merchant isolation; no turnover',async()=>{
  await core.finalizeInitialization(req({request_id:key(),confirmation:'FINALIZE',accounting_start_date:'2025-01-01',accounts:[{account_id:cash,amount:'500000'},{account_id:bank,amount:'2000000'}],inventory:[{product_id:air,quantity:'100',unit_cost:'1000'},{product_id:mie,quantity:'100',unit_cost:'3000'}],receivables:[{party_id:customer,amount:'30000',due_date:'2026-02-01'}],payables:[{party_id:supplier,amount:'50000',due_date:'2026-02-01'}]}));
  for(const [kind,value] of [['AR',30000],['AP',50000]]){
   const source=(await read('aging',{kind,as_of:'2026-01-15'})).items[0].source_id;
   const body={kind,source_id:source,account_id:cash,amount:'10000',request_id:key()};
   await core.payDebt(req(body));assert.equal((await core.payDebt(req(body))).replay,true);
   await reject(()=>core.payDebt(req({...body,request_id:key(),amount:String(value)})),'DEBT_OVERPAYMENT');
   await reject(()=>core.payDebt(req({...body,request_id:key()},otherToken,other)),'DEBT_SOURCE_DENIED');
   await core.payDebt(req({...body,amount:String(value-10000),request_id:key()}));
   assert.equal((await read('aging',{kind})).outstanding,'0');
  }
  const r=await read('report',{date:today});assert.equal(r.kpi.sales,'0');
 });
 await test('historical opening consistent across aging, inventory, cashbook and position; corrections effective today',async()=>{
  const r=await read('report',{date:'2026-01-15'}),b=await read('cashBook',{from:'2026-01-01',to:'2026-01-15'});
  assert.equal(r.financial_position.cash,'500000');assert.equal(r.financial_position.receivables,'30000');assert.equal(r.financial_position.payables,'50000');assert.equal(r.inventory.valuation,'400000');assert.equal(b.summary.ending_balance,'2500000');
  await core.correctInitialization(req({request_id:key(),kind:'ACCOUNT',target_id:cash,amount_delta:'1000',reason:'Explicit recorded-date correction',confirmation:'CORRECT'}));
  assert.equal((await read('report',{date:'2026-01-15'})).financial_position.cash,'500000');
  assert.equal((await read('cashBook',{from:'2026-01-01',to:today,kind:'OPENING_ADJUSTMENT'})).total_rows,1);
 });
 await test('transfer two legs, fee one expense, idempotency and exact balance example',async()=>{
  const before=await read('books');const transfer={kind:'TRANSFER',account_id:bank,destination_account_id:cash,amount:'300000',fee:'5000',date:today,reason:'Bank to cash',request_id:key()};
  const first=await core.money(req(transfer));assert.equal((await core.money(req(transfer))).replay,true);
  assert.equal((await client.query('SELECT count(*)::int n,sum(amount)::text net FROM pos_money_movements WHERE operation_id=$1',[first.id])).rows[0].net,'0');
  const after=await read('books');assert.equal(BigInt(after.available_money),BigInt(before.available_money)-5000n);
  assert.equal(after.accounts.find(x=>x.id===bank).balance,'1695000');
  assert.equal((await read('report',{date:today})).kpi.expenses,'5000');
  await money('TRANSFER',1000,{account_id:bank,destination_account_id:bank2});
  await reject(()=>money('TRANSFER',999999999,{account_id:bank,destination_account_id:cash}),'INSUFFICIENT_BUSINESS_FUNDS');
 });
 await test('rollback forced failure leaves no partial transfer or fee',async()=>{
  const snap=await fingerprint(),failing=require('../services/posBusinessService').createPosBusinessService({db,afterStage:async stage=>{if(stage==='money')throw Error('QA_FORCE');}});
  await assert.rejects(()=>failing.money(req({kind:'TRANSFER',account_id:bank,destination_account_id:cash,amount:'100',fee:'5',reason:'force rollback',request_id:key()})),/QA_FORCE/);
  assert.equal(await fingerprint(),snap);
 });
 let sale;
 await test('canonical discounted sales, FIFO, net qty ranking, period customer ranking and DAMAGE',async()=>{
  const terminal=(await core.terminal(req({name:'Finance Terminal'}))).id;
  const opening=BigInt((await read('books')).accounts.find(x=>x.id===cash).balance);
  const shift=(await core.openShift(req({terminal_id:terminal,cash_account_id:cash,opening_cash:String(opening)}))).id;
  sale=await core.sale(req({request_id:key(),shift_id:shift,customer_id:customer,items:[{product_id:air,quantity:'3'},{product_id:mie,quantity:'1'}],discount:'1000',discount_reason:'QA',payments:[{method:'CASH',account_id:cash,amount:'22000',tendered:'22000'}]}));
  await core.adjustment(req({request_id:key(),product_id:air,quantity:'2',direction:'DAMAGE',reason:'Damaged stock'}));
  await money('EXPENSE',2000);await money('OTHER_INCOME',3000);await money('TRANSFER',1000,{destination_account_id:bank});
  const r=await read('report',{date:today,grain:'hour'});assert.equal(r.kpi.gross_before_discount,'23000');assert.equal(r.kpi.discounts,'1000');assert.equal(r.kpi.net_sales,'22000');assert.equal(r.kpi.cogs,'6000');assert.equal(r.kpi.stock_loss,'2000');assert.equal(r.kpi.operating_result,'10000');
  assert.equal(r.sales.products[0].product_id,air);assert.equal(r.top_customers[0].id,customer);assert.equal(r.top_customers[0].net_spend,'22000');assert.equal(r.chart.points.length,24);
  const latest=BigInt((await read('books')).accounts.find(x=>x.id===cash).balance);assert.equal((await core.closeShift(req({shift_id:shift,actual_cash:String(latest)}))).difference,'0');
  assert.equal(latest,opening+22000n-2000n+3000n-1000n);
 });
 await test('more than 500 rows: full per-account sums, cursor coverage and export match',async()=>{
  const seeded=(await client.query(`INSERT INTO pos_business_operations(id,business_id,actor_id,kind,request_id,request_hash,total,paid,reason) SELECT md5($1||g::text)::uuid,$2,$3,'OTHER_INCOME',$1||g::text,repeat('a',64),1,1,'Synthetic pagination fixture' FROM generate_series(1,510) g RETURNING id`,[key(),business,owner])).rows;
  await client.query(`INSERT INTO pos_money_movements(id,business_id,account_id,operation_id,amount,actor_id) SELECT md5(id::text||'money')::uuid,$1,$2,id,1,$3 FROM unnest($4::uuid[]) id`,[business,cash,owner,seeded.map(x=>x.id)]);
  profileReady=true;
  const query={from:'2026-01-01',to:today},first=await read('cashBook',query),ids=new Set();let page=first;
  for(;;){for(const row of page.rows){assert(!ids.has(row.id));ids.add(row.id);}if(!page.next_cursor)break;page=await read('cashBook',{...query,cursor:page.next_cursor});}
  assert.equal(ids.size,first.total_rows);assert(first.total_rows>500);
  const all=await core.cashBook({...req(),query,_cashBookExport:true});
  assert.equal(all.rows.length,first.total_rows);assert.deepEqual(all.summary,first.summary);
  for(const a of first.accounts)assert.equal(a.money_in,all.accounts.find(x=>x.id===a.id).money_in);
  await reject(()=>read('cashBook',{...query,limit:'2.5'}),'INVALID_PAGE_SIZE');
  await reject(()=>read('cashBook',{...query,kind:'EXPENSE',cursor:first.next_cursor}),'INVALID_CURSOR');
  const snap=await fingerprint();await core.cashBookWorkbook({...req(),query});assert.equal(await fingerprint(),snap);
 });
 await test('event view groups transfer before pagination, preserves ledger legs, totals and export',async()=>{
  const query={from:'2026-01-01',to:today,view:'events'},first=await read('cashBook',{...query,limit:37}),seen=new Map();let page=first;
  for(;;){for(const row of page.rows){assert(!seen.has(row.id),'duplicate business event');seen.set(row.id,row);}if(!page.next_cursor)break;page=await read('cashBook',{...query,limit:37,cursor:page.next_cursor});}
  assert.equal(seen.size,first.total_events);assert(first.total_rows>first.total_events);
  const ledger=await core.cashBook({...req(),query:{from:query.from,to:query.to},_cashBookExport:true});
  for(const field of ['money_in','money_out','opening_balance','ending_balance'])assert.equal(first.summary[field],ledger.summary[field]);
  const transfer=[...seen.values()].find(x=>x.kind==='TRANSFER');assert(transfer);
  for(const event of seen.values())if(event.kind==='TRANSFER'){
   assert.equal(event.legs.length,2);assert.equal(event.amount,'0');
   assert.equal(event.legs.reduce((sum,leg)=>sum+BigInt(leg.amount),0n),0n);
   for(const leg of event.legs){const canonical=ledger.rows.find(x=>x.id===leg.id);assert(canonical);assert.equal(leg.amount,canonical.amount);assert.equal(leg.running_balance,canonical.running_balance);}
  }
  assert.equal([...seen.values()].reduce((sum,row)=>sum+row.legs.length,0),ledger.rows.length);
  const ordered=[...seen.values()],at=ordered.findIndex((row,i)=>i>0&&row.kind==='TRANSFER');assert(at>0);
  const preceding=ordered[at-1],cursor=JSON.parse(Buffer.from(first.next_cursor,'base64url').toString());
  Object.assign(cursor,{day:preceding.date,time:preceding.cursor_time,id:preceding.id});
  const boundary=await read('cashBook',{...query,limit:1,cursor:Buffer.from(JSON.stringify(cursor)).toString('base64url')});
  assert.equal(boundary.rows[0].id,ordered[at].id);assert.equal(boundary.rows[0].legs.length,2);
  const exported=await core.cashBook({...req(),query,_cashBookExport:true});assert.deepEqual(exported.rows,ledger.rows);
  await reject(()=>read('cashBook',{...query,account_id:cash}),'EVENT_VIEW_DATE_FILTER_ONLY');
  await reject(()=>read('cashBook',{...query,view:'unexpected'}),'INVALID_CASHBOOK_VIEW');
  await reject(()=>read('cashBook',{...query,view:'ledger',cursor:first.next_cursor}),'INVALID_CURSOR');
 });
 await test('free-text expense/income retain generic classification and stable idempotency',async()=>{
  for(const [kind,code,reason] of [['EXPENSE','OTHER_EXPENSE','Upah pengangkut barang'],['OTHER_INCOME','OTHER_INCOME','Penjualan kardus bekas']]){
   const body={kind,account_id:bank,amount:'1234',date:today,reason,request_id:key()},posted=await core.money(req(body));
   assert.equal((await core.money(req(body))).id,posted.id);
   const row=(await client.query('SELECT c.code,o.reason,count(m.id)::int legs FROM pos_business_operations o LEFT JOIN pos_finance_categories c ON c.id=o.finance_category_id AND c.business_id=o.business_id JOIN pos_money_movements m ON m.operation_id=o.id WHERE o.id=$1 GROUP BY c.code,o.reason',[posted.id])).rows[0];
   assert.deepEqual(row,{code,reason,legs:1});
  }
 });
 await test('daily/monthly/yearly totals and chart bins reconcile',async()=>{
  const month=today.slice(0,7),year=today.slice(0,4),d=await read('report',{date:today}),m=await read('report',{month}),y=await read('report',{year});
  for(const r of [d,m,y])assert.equal(r.kpi.net_sales,String(BigInt(r.kpi.gross_before_discount)-BigInt(r.kpi.discounts)-BigInt(r.kpi.returns)));
  assert.equal(m.kpi.net_sales,d.kpi.net_sales);assert.equal(y.kpi.net_sales,m.kpi.net_sales);
  for(const r of [d,m,y])assert.equal(r.chart.points.reduce((s,p)=>s+BigInt(p.net_sales),0n),BigInt(r.kpi.net_sales));
  assert.equal(y.chart.points.length,Number(today.slice(5,7)));
 });
 await test('permission matrix has no hidden metrics or false zero and rejects cross merchant',async()=>{
  const capabilities=['REPORT_INVENTORY','REPORT_PROFIT','REPORT_FINANCE','REPORT_SALES','REPORT_CUSTOMER'];
  for(let mask=1;mask<32;mask++){const perms=capabilities.filter((_,i)=>mask&(1<<i));
   await client.query("UPDATE pos_merchant_memberships SET permissions=$1 WHERE business_id=$2 AND user_id=$3",[['__EFFECTIVE_V1__',...perms],business,cashier]);
   const r=await core.report({...req({},cashierToken),query:{date:today}});
   assert.equal(Boolean(r.sales),perms.includes('REPORT_SALES'));assert.equal(Boolean(r.profit_loss),perms.includes('REPORT_PROFIT'));assert.equal(Boolean(r.financial_position),perms.includes('REPORT_FINANCE'));
   if(!perms.includes('REPORT_PROFIT'))assert(!Object.hasOwn(r.kpi,'cogs'));
   if(perms.includes('REPORT_PROFIT'))assert.equal(r.profit_loss.net_revenue,'22000');
   if(!perms.includes('PRODUCT_COST_VIEW'))assert(r.inventory?.products.every(x=>x.value_as_of===undefined)??true);
  }
  await client.query("UPDATE pos_merchant_memberships SET permissions='{}' WHERE business_id=$1 AND user_id=$2",[business,cashier]);
  await reject(()=>core.cashBook(req({},cashierToken)),'MERCHANT_PERMISSION_DENIED');
  await reject(()=>core.report(req({},ownerToken,foreign)),'MERCHANT_ACCESS_DENIED');
 });

 await test('timezone boundary, day-month-year and immutable historical amounts',async()=>{
  const terminal=(await core.terminal(req({name:'Boundary terminal'}))).id,shift=(await core.openShift(req({terminal_id:terminal,cash_account_id:cash,opening_cash:'0'}))).id;
  for(const [date,time] of [['2025-12-31','2025-12-31T16:59:59Z'],['2026-01-01','2025-12-31T17:00:01Z'],['2026-01-31','2026-01-31T16:59:59Z'],['2026-02-01','2026-01-31T17:00:01Z']]){
   fixtureDate={date,time};await core.sale(req({request_id:key(),shift_id:shift,items:[{product_id:air,quantity:'1'}],payments:[{method:'BANK',account_id:bank,amount:'5000',reference:'Synthetic boundary',manual_confirmed:true,confirmation_mode:'MANUAL'}]}));fixtureDate=null;
  }
  const dec=await read('report',{date:'2025-12-31'}),jan1=await read('report',{date:'2026-01-01'}),jan31=await read('report',{date:'2026-01-31'}),jan=await read('report',{month:'2026-01'}),feb=await read('report',{month:'2026-02'});
  assert.equal(dec.kpi.net_sales,'5000');assert.equal(jan1.kpi.net_sales,'5000');assert.equal(jan31.kpi.net_sales,'5000');assert.equal(jan.kpi.net_sales,'10000');assert.equal(feb.kpi.net_sales,'5000');
  assert.equal(jan1.chart.points.find(x=>x.bucket==='00').net_sales,'5000');assert.equal(dec.chart.points.find(x=>x.bucket==='23').net_sales,'5000');
  await core.closeShift(req({shift_id:shift,actual_cash:'0'}));
 });

 await test('pre-migration finance request replay preserves original hash without reposting',async()=>{
  const operation=id(),request=key(),fields={account:bank,destination:null,reason:'Legacy finance retry',total:7n,paid:7n},serialize=v=>JSON.stringify(v,(_,x)=>typeof x==='bigint'?String(x):x);
  const digest=crypto.createHash('sha256').update(serialize({actor:owner,kind:'CAPITAL',...fields})).digest('hex');
  await client.query("INSERT INTO pos_business_operations(id,business_id,actor_id,kind,request_id,request_hash,total,paid,reason) VALUES($1,$2,$3,'CAPITAL',$4,$5,7,7,$6)",[operation,business,owner,request,digest,fields.reason]);
  await client.query('INSERT INTO pos_money_movements(id,business_id,account_id,operation_id,amount,actor_id) VALUES($1,$2,$3,$4,7,$5)',[id(),business,bank,operation,owner]);
  const fp=await fingerprint(),r=await core.money(req({kind:'CAPITAL',account_id:bank,amount:'7',reason:fields.reason,request_id:request}));
  assert.equal(r.id,operation);assert.equal(r.replay,true);assert.equal(await fingerprint(),fp);
  await reject(()=>core.money(req({kind:'CAPITAL',account_id:bank,amount:'8',reason:fields.reason,request_id:request})),'IDEMPOTENCY_CONFLICT');
 });

 await test('report snapshot contract and measured bounded-query projections',async()=>{
  assert(readBegins>0);const count=queryCount,start=performance.now();const r=await read('cashBook',{from:'2025-01-01',to:today});const elapsed=performance.now()-start,queries=queryCount-count;
  assert(r.total_rows>500);assert(queries<=12);console.log('PERFORMANCE '+JSON.stringify({cashbook_rows:r.total_rows,page_rows:r.rows.length,queries,elapsed_ms:Math.round(elapsed)}));
  const q0=queryCount,t0=performance.now();await read('report',{year:today.slice(0,4)});console.log('PERFORMANCE '+JSON.stringify({report_queries:queryCount-q0,elapsed_ms:Math.round(performance.now()-t0)}));
 });
 await test('expense/income cancellation restores balances, signed reports, immutable source and exact retry',async()=>{
  for(const kind of ['EXPENSE','OTHER_INCOME']){
   const balance=(await read('books')).available_money,kpi=await read('report',{date:today}),original=await money(kind,1234,{account_id:bank,date:today});
   const source=(await client.query('SELECT row_to_json(o)::text body FROM pos_business_operations o WHERE id=$1',[original.id])).rows[0].body;
   const request=req({request_id:key(),action:'CANCEL',reason:'Salah input terverifikasi'},ownerToken,business,{operationId:original.id});
   const reversed=await core.reviseMoney(request);assert.equal((await core.reviseMoney(request)).id,reversed.id);
   assert.equal((await read('books')).available_money,balance);
   const after=await read('report',{date:today});assert.equal(after.kpi.expenses,kpi.kpi.expenses);assert.equal(after.kpi.other_income,kpi.kpi.other_income);
   const doc=await core.moneyDocument(req({},ownerToken,business,{operationId:original.id}));assert.equal(doc.finance_document.status,'CANCELLED');assert.equal(doc.finance_document.can_cancel,false);
   assert.equal((await client.query('SELECT row_to_json(o)::text body FROM pos_business_operations o WHERE id=$1',[original.id])).rows[0].body,source);
   await reject(()=>core.reviseMoney({...request,body:{...request.body,request_id:key()}}),'MONEY_ALREADY_REVISED');
   await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query('SET CONSTRAINTS ALL DEFERRED');
  }
 });
 await test('correction atomically reverses then replaces, with mandatory reason and linked immutable records',async()=>{
  const original=await money('EXPENSE',1000,{account_id:bank,date:today}),before=await read('books');
  const r=req({request_id:key(),action:'CORRECT',reason:'Nominal salah',replacement:{account_id:bank2,amount:'500',reason:'Nominal benar'}},ownerToken,business,{operationId:original.id});
  await reject(()=>core.reviseMoney({...r,body:{...r.body,reason:''}}),'INVALID_TEXT');
  const result=await core.reviseMoney(r);assert(result.replacement_id);assert.equal((await core.reviseMoney(r)).replacement_id,result.replacement_id);
  assert.equal(BigInt((await read('books')).available_money),BigInt(before.available_money)+500n);
  const doc=(await core.moneyDocument(req({},ownerToken,business,{operationId:original.id}))).finance_document;assert.equal(doc.status,'CORRECTED');assert.equal(doc.correction_id,result.replacement_id);
  await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query('SET CONSTRAINTS ALL DEFERRED');
 });
 await test('transfer cancellation reverses both legs; actual refunded fee choice is explicit and atomic',async()=>{
  for(const refunded of [false,true]){
   const before=await read('books'),original=await money('TRANSFER',1000,{account_id:bank,destination_account_id:bank2,fee:'100',date:today});
   const result=await core.reviseMoney(req({request_id:key(),action:'CANCEL',reason:'Transfer salah',reverse_fee:refunded},ownerToken,business,{operationId:original.id}));
   const legs=(await client.query('SELECT count(*)::int n,sum(amount)::text total FROM pos_money_movements WHERE operation_id=$1',[result.id])).rows[0];assert.deepEqual(legs,{n:2,total:'0'});
   assert.equal(BigInt((await read('books')).available_money),BigInt(before.available_money)-(refunded?0n:100n));
   await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query('SET CONSTRAINTS ALL DEFERRED');
  }
 });
 await test('forced revision failure rolls back both transfer legs/fee; generic sale/tenant/cashier cancellation denied',async()=>{
  const original=await money('TRANSFER',1000,{account_id:bank,destination_account_id:bank2,fee:'100',date:today}),snap=await fingerprint();
  const failing=require('../services/posBusinessService').createPosBusinessService({db,featureEnabled:async()=>true,afterStage:async stage=>{if(stage==='money-reversal')throw Object.assign(Error('FORCED_REVISION_FAILURE'),{code:'FORCED_REVISION_FAILURE'});}});
  const r=req({request_id:key(),action:'CANCEL',reason:'Rollback fixture',reverse_fee:true},ownerToken,business,{operationId:original.id});
  await reject(()=>failing.reviseMoney(r),'FORCED_REVISION_FAILURE');assert.equal(await fingerprint(),snap);
  await reject(()=>core.reviseMoney(req(r.body,cashierToken,business,{operationId:original.id})),'MERCHANT_PERMISSION_DENIED');
  await reject(()=>core.reviseMoney(req(r.body,otherToken,other,{operationId:original.id})),'FINANCE_OPERATION_NOT_FOUND');
  await reject(()=>core.reviseMoney(req(r.body,ownerToken,business,{operationId:sale.sale.id})),'DOMAIN_REVERSAL_REQUIRED');
  const count=(await client.query('SELECT count(*) n FROM pos_business_operations')).rows[0].n;
  await core.moneyDocument(req({},ownerToken,business,{operationId:original.id}));assert.equal((await client.query('SELECT count(*) n FROM pos_business_operations')).rows[0].n,count);
 });

 await test('restricted runtime role reverses without UPDATE privilege on immutable operations',async()=>{
  await client.query('SET LOCAL ROLE pos_business_v2_fixture_runtime');
  try{
   assert.equal((await client.query("SELECT has_table_privilege(current_user,'pos_business_operations','UPDATE') allowed")).rows[0].allowed,false);
   const original=await money('EXPENSE',55,{account_id:bank,date:today});
   const r=await core.reviseMoney(req({request_id:key(),action:'CANCEL',reason:'Restricted role fixture'},ownerToken,business,{operationId:original.id}));
   assert(r.id);await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query('SET CONSTRAINTS ALL DEFERRED');
  }finally{await client.query('RESET ROLE');}
 });
 await test('database rejects malformed reversal legs and correction without replacement; no partial commit',async()=>{
  const original=await money('EXPENSE',100,{account_id:bank,date:today});
  for(const [action,signed,code] of [['CANCEL','-100','MONEY_REVERSAL_LEGS_MISMATCH'],['CORRECT','100','MONEY_CORRECTION_REPLACEMENT_REQUIRED']]){
   await client.query('SAVEPOINT malformed_revision');
   try{
    const operation=id();await client.query("INSERT INTO pos_business_operations(id,business_id,actor_id,kind,request_id,request_hash,total,paid,source_id,reason,accounting_date,receipt_snapshot) VALUES($1,$2,$3,'MONEY_REVERSAL',$4,repeat('a',64),100,100,$5,'Malformed fixture',$6,$7)",[operation,business,owner,key(),original.id,today,JSON.stringify({finance_action:'REVERSAL',original_kind:'EXPENSE',action})]);
    await client.query('INSERT INTO pos_money_movements(id,business_id,actor_id,operation_id,account_id,amount) VALUES($1,$2,$3,$4,$5,$6)',[id(),business,owner,operation,bank,signed]);
    await assert.rejects(()=>client.query('SET CONSTRAINTS ALL IMMEDIATE'),e=>e.code==='23514'&&e.message.includes(code));
   }finally{await client.query('ROLLBACK TO SAVEPOINT malformed_revision');await client.query('RELEASE SAVEPOINT malformed_revision');}
  }
 });
 await test('new posting order and microsecond cutoff keep latest account running balance exact',async()=>{
  const original=await money('EXPENSE',97,{account_id:bank,date:today}),books=await read('books'),book=await read('cashBook',{date:today,view:'events',limit:100});
  const row=book.rows.find(r=>r.source_id===original.id);assert(row);assert.equal(row.legs[0].running_balance,books.accounts.find(a=>a.id===bank).balance);assert(BigInt(row.legs[0].running_balance)>=0n);assert(/\.\d{6}Z$/.test(book.snapshot_at));
 });

 await test('backdated cancellation preserves prior cutoff; reprints retain posted account labels after rename',async()=>{
  const oldName=(await read('books')).accounts.find(a=>a.id===bank).name,original=await money('EXPENSE',100,{account_id:bank,date:'2026-01-15'}),posted=await read('report',{date:'2026-01-15'});
  await client.query('UPDATE pos_business_accounts SET name=$1 WHERE id=$2',['Renamed Bank QA',bank]);
  const originalDoc=await core.moneyDocument(req({},ownerToken,business,{operationId:original.id}));assert.equal(originalDoc.finance_document.legs[0].name,oldName);assert.equal(originalDoc.finance_document.business_date,'2026-01-15');
  const reversed=await core.reviseMoney(req({request_id:key(),action:'CANCEL',reason:'Historical cutoff fixture'},ownerToken,business,{operationId:original.id}));
  const reversalDoc=await core.moneyDocument(req({},ownerToken,business,{operationId:reversed.id}));assert.equal(reversalDoc.finance_document.legs[0].name,'Renamed Bank QA');assert.equal(reversalDoc.finance_document.business_date,today);
  await client.query('UPDATE pos_business_accounts SET name=$1 WHERE id=$2',[oldName,bank]);
  const after=await read('report',{date:'2026-01-15'});assert.equal(after.kpi.expenses,posted.kpi.expenses);assert.deepEqual(after.financial_position,posted.financial_position);
 });
 if(process.env.POS_FINANCE_UI_QA==='1'){
  const fs=require('node:fs'),path=require('node:path'),express=require('express');
  fs.writeFileSync(path.join(__dirname,'../.tmp/finance-ui-fixture-20261029.json'),JSON.stringify({owner:{login:'qa-'+owner,password},cashier:{login:'qa-'+cashier,password},business_id:business}));
  const {app}=await require('./pos-business-local-app').createLocalPosApp(db,{fixture:true});const host=express();let queue=Promise.resolve();
  host.use((req,res,next)=>{const previous=queue;let release;queue=new Promise(resolve=>{release=resolve;});res.once('finish',release);res.once('close',release);previous.then(next);});
  await new Promise(resolve=>{const server=host.listen(55441,'127.0.0.1',()=>console.log('FINANCE_ROLLBACK_UI_READY'));host.post('/__qa_finish',(_req,res)=>{res.json({done:true});server.close(resolve);});host.use(app);});
 }

 await client.query('SET CONSTRAINTS ALL IMMEDIATE');console.log('DEFERRED RECONCILIATION PASS');
 await client.query('ROLLBACK');assert.equal(await fingerprint(),before);console.log('OPERATIONAL FINANCIAL FINGERPRINT UNCHANGED');console.log('PASS '+passed+' finance scenarios');
}
main().catch(e=>{console.error('FAIL',e.code||e.name,e.message?.split('\n')[0]);console.error(e.stack?.split('\n').slice(1,3).join('\n'));if(e.code==='ERR_ASSERTION')console.error('ASSERT',e.actual,e.expected);process.exitCode=1;}).finally(async()=>{if(client){await client.query('ROLLBACK').catch(()=>{});client.release();}await pool.end();});
