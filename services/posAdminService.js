const pool=require('../db');
const permission=require('../middleware/requirePermission');
const {resolveActiveUnit,canAccessAllUnits,loadVerifiedUser,assertUnitAccess}=require('./unitAccessService');
const fail=(code,status=400)=>{throw Object.assign(new Error(code),{code,status});};
const number=(value)=>{if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)<1||Number(value)>2147483647)fail('INVALID_ID');return Number(value);};
const name=value=>{const s=String(value??'').trim();if(!s||s.length>100)fail('INVALID_NAME');return s;};
const bool=value=>{if(typeof value!=='boolean')fail('INVALID_BOOLEAN');return value;};
const validDate=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)fail('INVALID_DATE');return value;};

function createPosAdminService({db=pool,permissionList=permission.getPermissionList}={}) {
 async function access(req,c,key='pos.view',write=false){
  if(!req.user?.id)fail('UNAUTHENTICATED',401);
  if(req.user.platform||req.user.role==='platform_superadmin')fail('TENANT_AUTH_REQUIRED',403);
  const tenantId=number(req.user.tenant_id);
  if(req.tenantId!=null&&Number(req.tenantId)!==tenantId)fail('TENANT_ACCESS_DENIED',403);
  const user=await loadVerifiedUser(req.user,tenantId,c);
  if(!(await permissionList(user.role,{tenantScoped:true,tenantId})).includes(key))fail('PERMISSION_DENIED',403);
  if((await c.query('SELECT status FROM tenants WHERE id=$1',[tenantId])).rows[0]?.status!=='active')fail('TENANT_INACTIVE',403);
  const all=String(req.query?.scope||req.headers?.['x-unit-scope']||'').toLowerCase()==='all';
  if(write&&all)fail('UNIT_REQUIRED');
  if(!all&&!(req.body?.unit_id??req.query?.unit_id??req.headers?.['x-unit-id']))fail('UNIT_REQUIRED');
  // Express 5 query is a prototype getter: spreading req drops unit_id/scope.
  // Pass the original request so the canonical guard sees the actual selector.
  const a=await resolveActiveUnit(req,c);
  if(a.mode==='ALL'&&!canAccessAllUnits(user))fail('UNIT_ACCESS_DENIED',403);
  if(write&&a.mode!=='UNIT')fail('UNIT_REQUIRED');
  const units=a.mode==='ALL'?(await c.query('SELECT id FROM unit_pendidikan WHERE tenant_id=$1 AND is_active ORDER BY id',[tenantId])).rows.map(u=>u.id):[a.unitId];
  return {tenantId,unitId:a.unitId,units,user};
 }
 async function run(req,key,write,work){const c=await db.connect();try{await c.query(write?'BEGIN':'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const a=await access(req,c,key,write);const r=await work(c,a);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 function filter(req,a,alias='s'){
  const q=req.query||{},values=[a.tenantId,a.units],where=[`${alias}.tenant_id=$1`,`${alias}.unit_id=ANY($2::integer[])`];
  const add=(sql,v)=>{values.push(v);where.push(sql.replace('?',`$${values.length}`));};
  for(const field of ['merchant_id','cashier_id','terminal_id'])if(q[field])add(`${alias}.${field}=?`,number(q[field]));
  if(q.shift_id){if(!/^[\da-f-]{36}$/i.test(q.shift_id))fail('INVALID_ID');add(`${alias}.shift_id=?::uuid`,q.shift_id);}
  for(const [key,op]of [['from','>='],['to','<=']])if(q[key]){
   add(`${alias}.business_date${op}?::date`,validDate(q[key]));
  }
  if(q.from&&q.to&&q.from>q.to)fail('INVALID_DATE_RANGE');
  if(q.search){const v=String(q.search).trim();if(v.length>100)fail('INVALID_SEARCH');add(`${alias}.receipt ILIKE ?`, `%${v.replace(/[\\%_]/g,'\\$&')}%`);}
  for(const [key,col,valid]of [['method','p.method',['RFID','CASH','TRANSFER_QRIS']],['payment_status','p.status',['PENDING','CONFIRMED']],['sale_status',`${alias}.status`,['DRAFT','PAID','VOID']]])
   if(q[key]){if(!valid.includes(q[key]))fail('INVALID_FILTER');add(`${col}=?`,q[key]);}
  return {values,where:where.join(' AND ')};
 }
 function page(req){const n=Number(req.query?.page||1),size=Number(req.query?.page_size||25);if(!Number.isInteger(n)||n<1||n>100000||!Number.isInteger(size)||size<1||size>100)fail('INVALID_PAGINATION');return {page:n,size,offset:(n-1)*size};}
 const base=`SELECT s.id,s.receipt,s.tenant_id,s.unit_id,s.merchant_id,s.terminal_id,s.cashier_id,s.shift_id,s.business_date,s.created_at,s.subtotal,s.discount,s.grand_total,s.status,
   s.merchant_name,s.cashier_name,s.terminal_name,s.void_reason,s.void_by,s.void_at,u.nama AS unit_name,p.id AS payment_id,p.method,p.status AS payment_status,p.amount,
   p.tendered,p.change,p.external_reference,p.provider,p.verified_by,p.verified_at,p.wallet_transaction_id,
   coalesce(r.confirmed,0) AS refunded,coalesce(r.reserved,0) AS refund_reserved
   FROM pos_sales s JOIN unit_pendidikan u ON u.id=s.unit_id AND u.tenant_id=s.tenant_id JOIN pos_payments p ON p.sale_id=s.id
   LEFT JOIN (SELECT payment_id,sum(amount) FILTER(WHERE status='CONFIRMED') confirmed,sum(amount) reserved FROM pos_refunds WHERE tenant_id=$1 AND unit_id=ANY($2::integer[]) GROUP BY payment_id) r ON r.payment_id=p.id`;
 async function transactions(req){return run(req,'pos.view',false,async(c,a)=>{
  const f=filter(req,a),pg=page(req);const count=(await c.query(`SELECT count(*) AS total FROM pos_sales s JOIN pos_payments p ON p.sale_id=s.id WHERE ${f.where}`,f.values)).rows[0].total;
  const rows=(await c.query(`${base} WHERE ${f.where} ORDER BY s.created_at DESC,s.id DESC LIMIT $${f.values.length+1} OFFSET $${f.values.length+2}`,[...f.values,pg.size,pg.offset])).rows;
  return {rows,total:count,page:pg.page,page_size:pg.size};
 });}
 async function detail(req){return run(req,'pos.view',false,async(c,a)=>{
  const s=(await c.query(`${base} WHERE s.id=$3 AND s.tenant_id=$1 AND s.unit_id=ANY($2::integer[])`,[a.tenantId,a.units,req.params.id])).rows[0];if(!s)fail('SALE_NOT_FOUND',404);
  const items=(await c.query('SELECT product_id,sku,name,category_name,quantity,unit_price,gross,discount,total FROM pos_sale_items WHERE sale_id=$1 ORDER BY product_id',[s.id])).rows;
  const corrections=(await c.query(`SELECT r.id,r.amount,r.status,r.reason,r.created_at,r.confirmed_at,r.actor_id,u.nama actor,r.external_reference,r.wallet_transaction_id,r.shift_id FROM pos_refunds r JOIN users u ON u.id=r.actor_id AND u.tenant_id=r.tenant_id WHERE r.payment_id=$1 ORDER BY r.created_at,r.id`,[s.payment_id])).rows;
  return {sale:s,items,corrections};
 });}
 async function dashboardData(req,c,a){
  const f=filter(req,a),cte=`WITH selected AS (${base} WHERE ${f.where}), item_totals AS (SELECT i.sale_id,sum(i.quantity) quantity FROM pos_sale_items i JOIN selected s ON s.id=i.sale_id AND s.status='PAID' GROUP BY i.sale_id)`;
  const kpi=(await c.query(`${cte} SELECT coalesce(sum(s.grand_total) FILTER(WHERE s.status='PAID'),0) gross_sales,
   coalesce(sum(s.refunded) FILTER(WHERE s.status='PAID'),0) refunds,count(*) FILTER(WHERE s.status='PAID') paid_transactions,
   coalesce(sum(i.quantity),0) gross_items,count(*) FILTER(WHERE s.status='PAID' AND s.refunded>0) refunded_transactions,
   coalesce(sum(s.amount) FILTER(WHERE s.method='TRANSFER_QRIS' AND s.payment_status='PENDING' AND s.status='DRAFT'),0) pending_external
   FROM selected s LEFT JOIN item_totals i ON i.sale_id=s.id`,f.values)).rows[0];
  kpi.net_sales=(BigInt(kpi.gross_sales)-BigInt(kpi.refunds)).toString();kpi.average_paid=kpi.paid_transactions==='0'?'0':(BigInt(kpi.gross_sales)/BigInt(kpi.paid_transactions)).toString();
  const methods=(await c.query(`${cte} SELECT method,count(*) transactions,sum(amount) amount FROM selected WHERE status='PAID' AND payment_status='CONFIRMED' GROUP BY method ORDER BY method`,f.values)).rows;
  const merchants=(await c.query(`${cte} SELECT merchant_id,merchant_name,sum(grand_total) gross,sum(refunded) refunds FROM selected WHERE status='PAID' GROUP BY merchant_id,merchant_name ORDER BY gross DESC LIMIT 20`,f.values)).rows;
  const products=(await c.query(`${cte} SELECT i.product_id,i.name,sum(i.quantity) quantity,sum(i.total) amount FROM pos_sale_items i JOIN selected s ON s.id=i.sale_id WHERE s.status='PAID' GROUP BY i.product_id,i.name ORDER BY quantity DESC LIMIT 10`,f.values)).rows;
  const hours=(await c.query(`${cte} SELECT extract(hour FROM s.created_at AT TIME ZONE original.timezone)::integer AS "hour",count(*) transactions FROM selected s JOIN pos_sales original ON original.id=s.id WHERE s.status='PAID' GROUP BY 1 ORDER BY 1`,f.values)).rows;
  const sv=[a.tenantId,a.units],sw=['tenant_id=$1','unit_id=ANY($2::integer[])',"status='OPEN'"];
  for(const key of ['merchant_id','cashier_id','terminal_id'])if(req.query?.[key]){sv.push(number(req.query[key]));sw.push(`${key}=$${sv.length}`);}
  const openShifts=(await c.query(`SELECT count(*) AS count FROM pos_shifts WHERE ${sw.join(' AND ')}`,sv)).rows[0].count;
  return {kpi,methods,merchants,products,hours,open_shifts:openShifts,basis:'Paid sale cohort by business date; confirmed linked refunds across lifecycle; average paid total rounded down; gross item quantities (amount-only refunds do not change quantities).'};
 }
 async function dashboard(req){return run(req,'pos.view',false,(c,a)=>dashboardData(req,c,a));}
 async function shifts(req){return run(req,'pos.view',false,async(c,a)=>{
  const q=req.query||{},v=[a.tenantId,a.units],w=['s.tenant_id=$1','s.unit_id=ANY($2::integer[])'];
  if(q.shift_id){v.push(q.shift_id);w.push(`s.id=$${v.length}::uuid`);}
  if(q.from&&q.to&&q.from>q.to)fail('INVALID_DATE_RANGE');
  for(const key of ['merchant_id','cashier_id','terminal_id'])if(q[key]){v.push(number(q[key]));w.push(`s.${key}=$${v.length}`);}
  if(q.status){if(!['OPEN','CLOSED'].includes(q.status))fail('INVALID_FILTER');v.push(q.status);w.push(`s.status=$${v.length}`);}
  for(const [key,op]of [['from','>='],['to','<=']])if(q[key]){v.push(validDate(q[key]));w.push(`(s.opened_at AT TIME ZONE t.attendance_timezone)::date${op}$${v.length}::date`);}
  const from=`FROM pos_shifts s JOIN tenants t ON t.id=s.tenant_id JOIN users u ON u.id=s.cashier_id JOIN merchant_rfid m ON m.id=s.merchant_id JOIN devices d ON d.id=s.terminal_id`;
  const pg=page(req),total=(await c.query(`SELECT count(*) total ${from} WHERE ${w.join(' AND ')}`,v)).rows[0].total;
  const rows=(await c.query(`SELECT s.*,u.nama cashier,m.nama_merchant merchant,d.nama_device terminal,
    coalesce(p.cash_sales,0) cash_sales,coalesce(r.cash_refunds,0) cash_refunds,s.opening_cash+coalesce(p.cash_sales,0)-coalesce(r.cash_refunds,0) calculated_expected
    ${from} LEFT JOIN(SELECT s.shift_id,sum(p.amount) cash_sales FROM pos_sales s JOIN pos_payments p ON p.sale_id=s.id WHERE s.tenant_id=$1 AND s.unit_id=ANY($2::integer[]) AND s.status='PAID' AND p.method='CASH' AND p.status='CONFIRMED' GROUP BY s.shift_id)p ON p.shift_id=s.id
    LEFT JOIN(SELECT r.shift_id,sum(r.amount) cash_refunds FROM pos_refunds r JOIN pos_payments p ON p.id=r.payment_id WHERE r.tenant_id=$1 AND r.unit_id=ANY($2::integer[]) AND r.status='CONFIRMED' AND p.method='CASH' GROUP BY r.shift_id)r ON r.shift_id=s.id
    WHERE ${w.join(' AND ')} ORDER BY s.opened_at DESC,s.id DESC LIMIT $${v.length+1} OFFSET $${v.length+2}`,[...v,pg.size,pg.offset])).rows;
  return {rows,total,page:pg.page,page_size:pg.size};
 });}
 async function refunds(req){return run(req,'pos.view',false,async(c,a)=>{
  const f=filter(req,a),pg=page(req),from=`FROM pos_refunds r JOIN pos_payments p ON p.id=r.payment_id JOIN pos_sales s ON s.id=p.sale_id JOIN users actor ON actor.id=r.actor_id`;
  const total=(await c.query(`SELECT count(*) total ${from} WHERE ${f.where}`,f.values)).rows[0].total;
  const rows=(await c.query(`SELECT r.id,r.payment_id,r.unit_id,r.amount,r.status,r.reason,r.created_at,r.confirmed_at,r.external_reference,r.wallet_transaction_id,
   actor.nama actor,s.receipt,s.merchant_id,s.merchant_name,s.cashier_name,p.method,p.amount original_amount,
   totals.cumulative_refunded ${from} JOIN (SELECT payment_id,sum(amount) cumulative_refunded FROM pos_refunds WHERE tenant_id=$1 AND unit_id=ANY($2::integer[]) GROUP BY payment_id) totals ON totals.payment_id=p.id WHERE ${f.where} ORDER BY r.created_at DESC,r.id DESC LIMIT $${f.values.length+1} OFFSET $${f.values.length+2}`,[...f.values,pg.size,pg.offset])).rows;
  return {rows,total,page:pg.page,page_size:pg.size};
 });}
 async function reconciliation(req){return run(req,'pos.reconcile',false,async(c,a)=>{
  const data=await dashboardData(req,c,a);
  const f=filter(req,a);const r=(await c.query(`WITH selected AS (${base} WHERE ${f.where}) SELECT
   coalesce(sum(p.amount),0) pos_debit,coalesce(sum(w.amount),0) wallet_debit,count(*) FILTER(WHERE w.amount IS DISTINCT FROM p.amount) invalid_debit_links
   FROM selected s JOIN pos_payments p ON p.id=s.payment_id LEFT JOIN wallet_transactions w ON w.id=p.wallet_transaction_id
    AND w.source='pos' AND w.direction='debit' AND w.type='payment' AND w.wallet_account_id=p.wallet_account_id AND w.tenant_id=p.tenant_id AND w.unit_id=p.unit_id AND w.reference_type='pos_payment' AND w.reference_id=p.id::text
   WHERE s.status='PAID' AND p.method='RFID'`,f.values)).rows[0];
  const refunds=(await c.query(`WITH selected AS (${base} WHERE ${f.where}) SELECT coalesce(sum(r.amount),0) pos_credit,
   coalesce(sum(w.amount),0) wallet_credit,count(*) FILTER(WHERE w.amount IS DISTINCT FROM r.amount) invalid_credit_links
   FROM selected s JOIN pos_payments p ON p.id=s.payment_id JOIN pos_refunds r ON r.payment_id=p.id AND r.status='CONFIRMED'
   LEFT JOIN wallet_transactions w ON w.id=r.wallet_transaction_id
    AND w.source='pos' AND w.direction='credit' AND w.type='refund' AND w.wallet_account_id=p.wallet_account_id AND w.tenant_id=r.tenant_id AND w.unit_id=r.unit_id AND w.reference_type='pos_refund' AND w.reference_id=r.id::text
   WHERE p.method='RFID'`,f.values)).rows[0];
  return {...data,wallet:{...r,...refunds,debit_difference:(BigInt(r.pos_debit)-BigInt(r.wallet_debit)).toString(),credit_difference:(BigInt(refunds.pos_credit)-BigInt(refunds.wallet_credit)).toString()}};
 });}
 // Management collections are bounded and scoped; no secrets/UIDs projected.
 async function management(req){return run(req,'pos.view',false,async(c,a)=>{
  const kind=req.params.kind,pg=page(req),q=req.query||{},v=[a.tenantId,a.units];
  const sources={products:`SELECT p.id,p.unit_id,p.merchant_id,p.category_id,p.sku,p.name,p.price,p.active,p.available,p.image_url,m.nama_merchant merchant FROM pos_products p JOIN merchant_rfid m ON m.id=p.merchant_id`,
   categories:`SELECT p.id,p.unit_id,p.merchant_id,p.name,p.active,m.nama_merchant merchant FROM pos_categories p JOIN merchant_rfid m ON m.id=p.merchant_id`,
   merchants:`SELECT p.id,p.unit_id,p.nama_merchant name,p.status AS active,p.pos_enabled,p.location_resolution_status,
    coalesce(d.terminals,0) terminals,coalesce(c.cashiers,0) cashiers FROM merchant_rfid p
    LEFT JOIN (SELECT merchant_id,tenant_id,count(*) terminals FROM devices WHERE pos_enabled GROUP BY merchant_id,tenant_id)d ON d.merchant_id=p.id AND d.tenant_id=p.tenant_id
    LEFT JOIN (SELECT merchant_id,tenant_id,count(*) cashiers FROM pos_cashier_assignments WHERE active GROUP BY merchant_id,tenant_id)c ON c.merchant_id=p.id AND c.tenant_id=p.tenant_id`,
   cashiers:`SELECT p.user_id id,p.unit_id,p.merchant_id,p.active,u.nama name,u.role,u.status user_status,m.nama_merchant merchant FROM pos_cashier_assignments p JOIN users u ON u.id=p.user_id AND u.tenant_id=p.tenant_id JOIN merchant_rfid m ON m.id=p.merchant_id`,
   users:`SELECT p.id,p.nama name,p.role,p.status FROM users p`,
   terminals:`SELECT p.id,p.device_id,p.unit_id,p.merchant_id,p.nama_device name,p.enabled,p.pos_enabled,p.attendance_mode,p.status,p.last_ping,p.last_sync,p.firmware_version FROM devices p`};
  if(!sources[kind])fail('INVALID_COLLECTION');
  let condition='p.tenant_id=$1';
  if(kind==='users')condition+=` AND (p.role='superadmin' OR EXISTS(SELECT 1 FROM user_unit_scope scope WHERE scope.user_id=p.id AND scope.tenant_id=p.tenant_id AND scope.unit_id=ANY($2::integer[]) AND scope.status='active'))`;
  else condition+=['merchants','terminals'].includes(kind)&&canAccessAllUnits(a.user)?' AND (p.unit_id=ANY($2::integer[]) OR p.unit_id IS NULL)':' AND p.unit_id=ANY($2::integer[])';
  if(q.merchant_id&&['products','categories','cashiers','terminals'].includes(kind)){v.push(number(q.merchant_id));condition+=` AND p.merchant_id=$${v.length}`;}
  if(kind==='products'&&q.category_id){v.push(q.category_id);condition+=` AND p.category_id=$${v.length}::uuid`;}
  if(q.search){v.push('%'+String(q.search).slice(0,100)+'%');condition+=` AND ${kind==='merchants'?'p.nama_merchant':kind==='users'?'p.nama':kind==='terminals'?'p.nama_device':kind==='cashiers'?'u.nama':'p.name'} ILIKE $${v.length}`;}
  if(['products','categories','merchants','cashiers'].includes(kind)&&q.active){if(!['true','false'].includes(q.active))fail('INVALID_FILTER');v.push(q.active==='true');condition+=` AND p.${kind==='merchants'?'status':'active'}=$${v.length}`;}
  if(kind==='products'&&q.available){if(!['true','false'].includes(q.available))fail('INVALID_FILTER');v.push(q.available==='true');condition+=` AND p.available=$${v.length}`;}
  const sql=`${sources[kind]} WHERE ${condition}`,total=(await c.query(`SELECT count(*) total FROM (${sql}) bounded`,v)).rows[0].total;
  const rows=(await c.query(`${sql} ORDER BY ${kind==='cashiers'?'p.user_id,p.merchant_id':'p.id'} LIMIT $${v.length+1} OFFSET $${v.length+2}`,[...v,pg.size,pg.offset])).rows;
  return {rows,total,page:pg.page,page_size:pg.size};
 });}
 async function editCategory(req){return run(req,'pos.products.manage',true,async(c,a)=>{
  const result=await c.query(`UPDATE pos_categories SET name=$1,active=$2 WHERE id=$3 AND tenant_id=$4 AND unit_id=$5 RETURNING *`,[name(req.body.name),bool(req.body.active),req.params.id,a.tenantId,a.unitId]);if(!result.rowCount)fail('CATEGORY_NOT_FOUND',404);return result.rows[0];
 });}
 async function editMerchant(req){return run(req,'pos.config.manage',true,async(c,a)=>{
  const m=(await c.query('SELECT id,unit_id FROM merchant_rfid WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[number(req.params.id),a.tenantId])).rows[0];if(!m)fail('MERCHANT_NOT_FOUND',404);
  if(m.unit_id!=null){await assertUnitAccess(a.user,m.unit_id,a.tenantId,c);if(Number(m.unit_id)!==a.unitId)fail('MERCHANT_UNIT_CHANGE_FORBIDDEN',409);}
  else if(!canAccessAllUnits(a.user))fail('LEGACY_OWNERSHIP_REQUIRES_SUPERADMIN',403);
  if((await c.query('SELECT id FROM devices WHERE merchant_id=$1 AND tenant_id=$2 AND unit_id IS NOT NULL AND unit_id<>$3 LIMIT 1',[m.id,a.tenantId,a.unitId])).rowCount)fail('MERCHANT_DEVICE_UNIT_CONFLICT',409);
  return (await c.query(`UPDATE merchant_rfid SET nama_merchant=$1,status=$2,unit_id=$3,location_resolution_status='resolved',pos_enabled=$4 WHERE id=$5 AND tenant_id=$6 RETURNING id,unit_id,nama_merchant,status,pos_enabled`,[name(req.body.name),bool(req.body.active),a.unitId,bool(req.body.pos_enabled),m.id,a.tenantId])).rows[0];
 });}
 async function configureTerminal(req){return run(req,'pos.config.manage',true,async(c,a)=>{
  const d=(await c.query('SELECT id,unit_id,merchant_id,attendance_mode FROM devices WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[number(req.params.id),a.tenantId])).rows[0];if(!d)fail('TERMINAL_NOT_FOUND',404);
  if(d.attendance_mode!=null)fail('ATTENDANCE_TERMINAL_FROZEN',403);
  if(d.unit_id!=null&&Number(d.unit_id)!==a.unitId)fail('TERMINAL_SCOPE_DENIED',403);
  if(d.unit_id==null&&!canAccessAllUnits(a.user))fail('LEGACY_OWNERSHIP_REQUIRES_SUPERADMIN',403);
  const m=(await c.query(`SELECT id FROM merchant_rfid WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 AND status AND pos_enabled AND location_resolution_status='resolved' FOR SHARE`,[number(req.body.merchant_id),a.tenantId,a.unitId])).rows[0];if(!m)fail('MERCHANT_SCOPE_DENIED',403);
  if((await c.query('SELECT id FROM pos_shifts WHERE terminal_id=$1 AND tenant_id=$2 LIMIT 1',[d.id,a.tenantId])).rowCount&&Number(d.merchant_id)!==m.id)fail('TERMINAL_HISTORY_PROTECTED',409);
  return (await c.query(`UPDATE devices SET unit_id=$1,merchant_id=$2,pos_enabled=$3,location_resolution_status='resolved' WHERE id=$4 AND tenant_id=$5 RETURNING id,unit_id,merchant_id,pos_enabled`,[a.unitId,m.id,bool(req.body.pos_enabled),d.id,a.tenantId])).rows[0];
 });}
 return {transactions,detail,dashboard,shifts,refunds,reconciliation,management,editCategory,editMerchant,configureTerminal};
}
module.exports={createPosAdminService,...createPosAdminService()};
