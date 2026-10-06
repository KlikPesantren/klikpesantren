const crypto = require('crypto');
const pool = require('../db');
const permissions = require('../middleware/requirePermission');
const { loadVerifiedUser, assertUnitAccess } = require('./unitAccessService');
const { isUnitFeatureEnabled } = require('./unitFeatureService');

const fail = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
function integer(value, field, positive = false) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) fail(`INVALID_${field}`);
  if (!/^(0|[1-9]\d*)$/.test(String(value ?? ''))) fail(`INVALID_${field}`);
  const n = BigInt(value);
  if (n > 9223372036854775807n || (positive && n === 0n)) fail(`INVALID_${field}`);
  return n;
}
function id(value, field) {
  const n = integer(value, field, true);
  if (n > 2147483647n) fail(`INVALID_${field}`);
  return Number(n);
}
function uuid(value) {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(String(value))) fail('INVALID_ID');
  return value.toLowerCase();
}
function text(value, max, min = 1) {
  const v = String(value ?? '').trim();
  if (v.length < min || v.length > max) fail('INVALID_TEXT');
  return v;
}
function credential(value) {
  const v = text(value, 80);
  return /^[\da-f]+$/i.test(v) ? v.toLowerCase() : v;
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bool = (value, fallback) => {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') fail('INVALID_BOOLEAN');
  return value;
};

// Dependencies are injectable only through this local factory, never request/env flags.
function createPosService({ db = pool, permissionList = permissions.getPermissionList,
  featureEnabled = isUnitFeatureEnabled, afterStage = async () => {} } = {}) {
  async function transaction(work) {
    const c = await db.connect();
    try { await c.query('BEGIN'); const result = await work(c); await c.query('COMMIT'); return result; }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async function scope(req, c, permission) {
    if (!req.user?.id) fail('UNAUTHENTICATED', 401);
    if (req.user.platform || req.user.role === 'platform_superadmin') fail('TENANT_AUTH_REQUIRED', 403);
    const tenantId = id(req.user.tenant_id, 'TENANT');
    if (req.tenantId != null && Number(req.tenantId) !== tenantId) fail('TENANT_ACCESS_DENIED', 403);
    if (String(req.query?.scope || req.headers?.['x-unit-scope'] || '').toLowerCase() === 'all') fail('UNIT_REQUIRED');
    const rawUnit = req.body?.unit_id ?? req.query?.unit_id ?? req.headers?.['x-unit-id'];
    if (rawUnit == null || rawUnit === '') fail('UNIT_REQUIRED');
    const unitId = id(rawUnit, 'UNIT');
    const user = await loadVerifiedUser(req.user, tenantId, c);
    await assertUnitAccess(user, unitId, tenantId, c);
    const tenant = (await c.query('SELECT status,attendance_timezone FROM tenants WHERE id=$1', [tenantId])).rows[0];
    if (tenant?.status !== 'active') fail('TENANT_INACTIVE', 403);
    const allowed = await permissionList(user.role, { tenantScoped: true, tenantId });
    if (!allowed.includes(permission)) fail('PERMISSION_DENIED', 403);
    return { tenantId, unitId, user, allowed, timezone: tenant.attendance_timezone };
  }
  async function merchant(c, a, merchantId) {
    const m = (await c.query('SELECT * FROM merchant_rfid WHERE id=$1 AND tenant_id=$2 FOR SHARE', [id(merchantId, 'MERCHANT'), a.tenantId])).rows[0];
    if (!m || Number(m.unit_id) !== a.unitId || m.location_resolution_status !== 'resolved') fail('MERCHANT_SCOPE_DENIED', 403);
    if (!m.status || !m.pos_enabled) fail('MERCHANT_UNAVAILABLE', 403);
    return m;
  }
  async function selling(c, a, body) {
    const m = await merchant(c, a, body.merchant_id);
    const assignment = await c.query('SELECT user_id FROM pos_cashier_assignments WHERE tenant_id=$1 AND unit_id=$2 AND merchant_id=$3 AND user_id=$4 AND active FOR SHARE',
      [a.tenantId, a.unitId, m.id, a.user.id]);
    if (!assignment.rowCount) fail('CASHIER_NOT_ASSIGNED', 403);
    const t = (await c.query('SELECT id,nama_device,enabled,pos_enabled,attendance_mode,location_resolution_status FROM devices WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 AND merchant_id=$4 FOR SHARE',
      [id(body.terminal_id, 'TERMINAL'), a.tenantId, a.unitId, m.id])).rows[0];
    if (!t?.enabled || !t.pos_enabled || t.attendance_mode != null || t.location_resolution_status !== 'resolved') fail('TERMINAL_DENIED', 403);
    return { m, t };
  }
  async function openShiftRow(c, a, m, t, shiftId) {
    const s = (await c.query(`SELECT * FROM pos_shifts WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 AND merchant_id=$4
      AND terminal_id=$5 AND cashier_id=$6 FOR UPDATE`, [uuid(shiftId), a.tenantId, a.unitId, m.id, t.id, a.user.id])).rows[0];
    if (s?.status !== 'OPEN') fail('SHIFT_NOT_OPEN', 409);
    return s;
  }
  async function lockKey(c, tenantId, namespace, key) {
    await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`pos:${tenantId}:${namespace}:${key}`]);
  }
  async function readSale(c, a, saleId) {
    const sale = (await c.query('SELECT * FROM pos_sales WHERE id=$1 AND tenant_id=$2 AND unit_id=$3', [uuid(saleId), a.tenantId, a.unitId])).rows[0];
    if (!sale) fail('SALE_NOT_FOUND', 404);
    const payment = (await c.query('SELECT * FROM pos_payments WHERE sale_id=$1', [sale.id])).rows[0];
    if (payment?.wallet_transaction_id) payment.wallet_balance_after=(await c.query('SELECT balance_after FROM wallet_transactions WHERE id=$1 AND tenant_id=$2 AND unit_id=$3',
      [payment.wallet_transaction_id,a.tenantId,a.unitId])).rows[0].balance_after;
    const items = (await c.query('SELECT * FROM pos_sale_items WHERE sale_id=$1 ORDER BY product_id', [sale.id])).rows;
    return { sale, payment, items };
  }
  async function wallet(c, a, uid) {
    if (!(await featureEnabled(a.tenantId, a.unitId, 'wallet', c)) || !(await featureEnabled(a.tenantId, a.unitId, 'rfid', c))) fail('FEATURE_DISABLED', 403);
    // Match before membership filtering: ambiguity cannot be hidden by eligibility.
    const people = (await c.query(`SELECT id,status FROM santri WHERE tenant_id=$1 AND
      CASE WHEN btrim(uid_rfid) ~ '^[0-9a-fA-F]+$' THEN lower(btrim(uid_rfid)) ELSE btrim(uid_rfid) END=$2 LIMIT 2 FOR SHARE`, [a.tenantId, uid])).rows;
    if (!people.length) fail('UNKNOWN_CREDENTIAL', 404);
    if (people.length !== 1) fail('AMBIGUOUS_CREDENTIAL', 409);
    const person = people[0];
    if (!['aktif', 'active'].includes(String(person.status).trim().toLowerCase())) fail('MEMBERSHIP_INACTIVE', 403);
    const member = await c.query(`SELECT id FROM santri_units WHERE tenant_id=$1 AND unit_id=$2 AND santri_id=$3 AND status='active' AND left_at IS NULL FOR SHARE`, [a.tenantId, a.unitId, person.id]);
    if (!member.rowCount) fail('MEMBERSHIP_INACTIVE', 403);
    const w = (await c.query('SELECT * FROM wallet_accounts WHERE tenant_id=$1 AND unit_id=$2 AND santri_id=$3 FOR UPDATE', [a.tenantId, a.unitId, person.id])).rows[0];
    if (!w) fail('WALLET_ACCOUNT_REQUIRED', 409);
    if (w.status !== 'active') fail('WALLET_NOT_ACTIVE', 403);
    return w;
  }
  async function walletMovement(c, a, w, amount, direction, referenceType, referenceId, merchantId, terminalId = null) {
    const balance = BigInt(w.current_balance) + (direction === 'credit' ? amount : -amount);
    if (balance < 0n) fail('INSUFFICIENT_BALANCE', 409);
    const tx = (await c.query(`INSERT INTO wallet_transactions(wallet_account_id,tenant_id,unit_id,santri_id,type,direction,amount,balance_after,
      source,reference_type,reference_id,actor_user_id,location_unit_id,merchant_id,device_id,idempotency_key)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'pos',$9,$10,$11,$3,$12,$13,$14) RETURNING id`,
    [w.id,a.tenantId,a.unitId,w.santri_id,direction === 'debit' ? 'payment' : 'refund',direction,amount.toString(),balance.toString(),
      referenceType,referenceId,a.user.id,merchantId,terminalId,`${referenceType}:${referenceId}`])).rows[0];
    await afterStage('ledger');
    await c.query('UPDATE wallet_accounts SET current_balance=$1,updated_at=now() WHERE id=$2 AND tenant_id=$3 AND unit_id=$4', [balance.toString(),w.id,a.tenantId,a.unitId]);
    await afterStage('balance');
    return tx.id;
  }

  async function checkout(req) {
    return transaction(async c => {
      const a = await scope(req, c, 'pos.sell'); const b = req.body;
      const { m, t } = await selling(c,a,b);
      const key = text(b.request_id,160,8);
      if (!Array.isArray(b.items) || b.items.length < 1 || b.items.length > 100) fail('INVALID_CART');
      const items = b.items.map(i => ({ product_id: uuid(i.product_id), quantity: id(i.quantity,'QUANTITY') })).sort((x,y)=>x.product_id.localeCompare(y.product_id));
      if (new Set(items.map(i=>i.product_id)).size !== items.length) fail('DUPLICATE_PRODUCT');
      const discount = integer(b.discount ?? 0,'DISCOUNT');
      const reason = discount > 0n ? text(b.discount_reason,500,5) : null;
      if (discount > 0n && !a.allowed.includes('pos.discount')) fail('DISCOUNT_DENIED',403);
      const method = b.payment?.method;
      if (!['RFID','CASH','TRANSFER_QRIS'].includes(method)) fail('INVALID_PAYMENT_METHOD');
      const uid = method === 'RFID' ? credential(b.payment.credential) : null;
      const tender = method === 'CASH' ? integer(b.payment.tendered,'TENDERED') : null;
      const confirmed = method !== 'TRANSFER_QRIS' || bool(b.payment.confirmed,false);
      const provider = b.payment.provider == null ? null : text(b.payment.provider,120);
      const external = b.payment.reference == null ? null : text(b.payment.reference,160);
      const hash = digest({ unit:a.unitId,actor:a.user.id,merchant:m.id,terminal:t.id,shift:uuid(b.shift_id),items,
        discount:discount.toString(),reason,method,credentialHash:uid ? digest(uid) : null,tender:tender?.toString(),confirmed,provider,external });
      await lockKey(c,a.tenantId,'checkout',key);
      const prior = (await c.query('SELECT id,request_hash FROM pos_sales WHERE tenant_id=$1 AND request_id=$2',[a.tenantId,key])).rows[0];
      if (prior) { if (prior.request_hash !== hash) fail('IDEMPOTENCY_CONFLICT',409); return { ...(await readSale(c,a,prior.id)), replay:true }; }
      await openShiftRow(c,a,m,t,b.shift_id);
      let subtotal = 0n;
      for (const item of items) {
        const p = (await c.query(`SELECT p.*,cat.name AS category_name FROM pos_products p LEFT JOIN pos_categories cat ON cat.id=p.category_id
          WHERE p.id=$1 AND p.tenant_id=$2 AND p.unit_id=$3 AND p.merchant_id=$4 FOR SHARE OF p`,[item.product_id,a.tenantId,a.unitId,m.id])).rows[0];
        if (!p?.active || !p.available) fail('PRODUCT_UNAVAILABLE',403);
        item.product=p; item.gross=BigInt(p.price)*BigInt(item.quantity); subtotal+=item.gross;
      }
      if (subtotal > 9223372036854775807n || discount >= subtotal) fail('INVALID_TOTAL');
      const total=subtotal-discount;
      if (tender != null && tender<total) fail('INSUFFICIENT_TENDER');
      const w = uid ? await wallet(c,a,uid) : null;
      if (w && BigInt(w.current_balance)<total) fail('INSUFFICIENT_BALANCE',409);
      const saleId=crypto.randomUUID(), paymentId=crypto.randomUUID();
      const cashier = (await c.query('SELECT nama FROM users WHERE id=$1 AND tenant_id=$2',[a.user.id,a.tenantId])).rows[0];
      await c.query(`INSERT INTO pos_sales(id,receipt,tenant_id,unit_id,merchant_id,terminal_id,cashier_id,shift_id,merchant_name,cashier_name,terminal_name,
        business_date,timezone,subtotal,discount,discount_reason,grand_total,status,request_id,request_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,(now() AT TIME ZONE $12)::date,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [saleId,`POS-${saleId}`,a.tenantId,a.unitId,m.id,t.id,a.user.id,b.shift_id,m.nama_merchant,cashier.nama,t.nama_device,a.timezone,
        subtotal.toString(),discount.toString(),reason,total.toString(),confirmed?'PAID':'DRAFT',key,hash]);
      await afterStage('sale');
      let allocated=0n, cumulativeGross=0n;
      for (let n=0;n<items.length;n++) {
        const i=items[n]; cumulativeGross+=i.gross;
        const nextAllocation=discount*cumulativeGross/subtotal, d=nextAllocation-allocated; allocated=nextAllocation;
        await c.query(`INSERT INTO pos_sale_items(id,sale_id,tenant_id,unit_id,merchant_id,product_id,sku,name,category_name,quantity,unit_price,gross,discount,total)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,[crypto.randomUUID(),saleId,a.tenantId,a.unitId,m.id,i.product_id,
          i.product.sku,i.product.name,i.product.category_name,i.quantity,i.product.price,i.gross.toString(),d.toString(),(i.gross-d).toString()]);
      }
      await afterStage('items');
      const txId=w?await walletMovement(c,a,w,total,'debit','pos_payment',paymentId,m.id,t.id):null;
      await c.query(`INSERT INTO pos_payments(id,sale_id,tenant_id,unit_id,merchant_id,method,status,amount,wallet_account_id,wallet_transaction_id,
        tendered,change,provider,external_reference,verified_by,verified_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,CASE WHEN $15::integer IS NULL THEN NULL ELSE now() END)`,
      [paymentId,saleId,a.tenantId,a.unitId,m.id,method,confirmed?'CONFIRMED':'PENDING',total.toString(),w?.id??null,txId,
        tender?.toString()??null,tender==null?null:(tender-total).toString(),provider,external,confirmed?a.user.id:null]);
      await afterStage('payment');
      return { ...(await readSale(c,a,saleId)),replay:false };
    });
  }

  async function openShift(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.shifts.manage'), b=req.body, {m,t}=await selling(c,a,b);
      // Unique partial indexes remain authoritative for concurrent opens.
      await lockKey(c,a.tenantId,'shift-cashier',String(a.user.id));
      const exists=await c.query(`SELECT id FROM pos_shifts WHERE tenant_id=$1 AND status='OPEN' AND (terminal_id=$2 OR cashier_id=$3)`,[a.tenantId,t.id,a.user.id]);
      if (exists.rowCount) fail('SHIFT_ALREADY_OPEN',409);
      return (await c.query(`INSERT INTO pos_shifts(id,tenant_id,unit_id,merchant_id,terminal_id,cashier_id,status,opening_cash)
        VALUES($1,$2,$3,$4,$5,$6,'OPEN',$7) RETURNING *`,[crypto.randomUUID(),a.tenantId,a.unitId,m.id,t.id,a.user.id,integer(b.opening_cash??0,'OPENING_CASH').toString()])).rows[0];
    });
  }
  async function closeShift(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.shifts.manage'), b=req.body, {m,t}=await selling(c,a,b);
      const s=await openShiftRow(c,a,m,t,req.params.id);
      if ((await c.query(`SELECT id FROM pos_sales WHERE shift_id=$1 AND status='DRAFT' LIMIT 1`,[s.id])).rowCount) fail('SHIFT_UNPAID_SALES',409);
      const cash=(await c.query(`SELECT coalesce(sum(p.amount),0) AS amount FROM pos_payments p JOIN pos_sales s ON s.id=p.sale_id
        WHERE s.shift_id=$1 AND s.status='PAID' AND p.method='CASH' AND p.status='CONFIRMED'`,[s.id])).rows[0];
      const refunds=(await c.query(`SELECT coalesce(sum(r.amount),0) AS amount FROM pos_refunds r JOIN pos_payments p ON p.id=r.payment_id
        WHERE r.shift_id=$1 AND r.status='CONFIRMED' AND p.method='CASH'`,[s.id])).rows[0];
      const expected=BigInt(s.opening_cash)+BigInt(cash.amount)-BigInt(refunds.amount), actual=integer(b.actual_cash,'ACTUAL_CASH');
      return (await c.query(`UPDATE pos_shifts SET status='CLOSED',closed_at=now(),closed_by=$2,expected_cash=$3,actual_cash=$4,difference=$5
        WHERE id=$1 AND status='OPEN' RETURNING *`,[s.id,a.user.id,expected.toString(),actual.toString(),(actual-expected).toString()])).rows[0];
    });
  }
  async function sale(req) {
    return transaction(async c => { const a=await scope(req,c,'pos.view'); return readSale(c,a,req.params.id); });
  }
  async function confirmPayment(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.sell'), b=req.body;
      const {m,t}=await selling(c,a,b); await openShiftRow(c,a,m,t,b.shift_id);
      const s=(await c.query(`SELECT * FROM pos_sales WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 AND merchant_id=$4 AND terminal_id=$5 AND cashier_id=$6 AND shift_id=$7 FOR UPDATE`,
        [uuid(req.params.id),a.tenantId,a.unitId,m.id,t.id,a.user.id,b.shift_id])).rows[0];
      if (!s) fail('SALE_NOT_FOUND',404);
      const p=(await c.query('SELECT * FROM pos_payments WHERE sale_id=$1 FOR UPDATE',[s.id])).rows[0];
      if (p.method!=='TRANSFER_QRIS' || s.status==='VOID') fail('PAYMENT_NOT_CONFIRMABLE',409);
      const reference=text(b.reference,160);
      if (p.status==='CONFIRMED') {
        if (p.external_reference!==reference) fail('CONFIRMATION_CONFLICT',409);
        return readSale(c,a,s.id);
      }
      if (b.confirmed!==true) fail('CONFIRMATION_REQUIRED');
      await c.query(`UPDATE pos_payments SET status='CONFIRMED',external_reference=$2,verified_by=$3,verified_at=now() WHERE id=$1`,[p.id,reference,a.user.id]);
      await c.query(`UPDATE pos_sales SET status='PAID' WHERE id=$1`,[s.id]);
      return readSale(c,a,s.id);
    });
  }
  async function voidSale(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.sell'), b=req.body; const {m,t}=await selling(c,a,b);
      await openShiftRow(c,a,m,t,b.shift_id);
      const s=(await c.query(`SELECT * FROM pos_sales WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 AND merchant_id=$4 AND cashier_id=$5 AND shift_id=$6 FOR UPDATE`,
        [uuid(req.params.id),a.tenantId,a.unitId,m.id,a.user.id,b.shift_id])).rows[0];
      if (!s) fail('SALE_NOT_FOUND',404);
      if (s.status!=='DRAFT') fail('VOID_UNPAID_ONLY',409);
      await c.query(`UPDATE pos_sales SET status='VOID',void_reason=$2,void_by=$3,void_at=now() WHERE id=$1`,[s.id,text(b.reason,500,5),a.user.id]);
      return readSale(c,a,s.id);
    });
  }
  async function refund(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.refund'), b=req.body, {m,t}=await selling(c,a,b);
      const key=text(b.request_id,160,8), amount=integer(b.amount,'AMOUNT',true), reason=text(b.reason,500,5);
      const paymentId=uuid(b.payment_id), shiftId=b.shift_id?uuid(b.shift_id):null;
      const hash=digest({unit:a.unitId,actor:a.user.id,merchant:m.id,terminal:t.id,paymentId,amount:amount.toString(),reason,shiftId});
      await lockKey(c,a.tenantId,'refund',key);
      const prior=(await c.query('SELECT * FROM pos_refunds WHERE tenant_id=$1 AND request_id=$2',[a.tenantId,key])).rows[0];
      if (prior) { if (prior.request_hash!==hash) fail('IDEMPOTENCY_CONFLICT',409); return {...prior,replay:true}; }
      // If cash, lock the drawer BEFORE original payment, consistent with checkout/close.
      const paymentPreview=(await c.query('SELECT method FROM pos_payments WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 AND merchant_id=$4',[paymentId,a.tenantId,a.unitId,m.id])).rows[0];
      if (!paymentPreview) fail('PAYMENT_NOT_FOUND',404);
      if (paymentPreview.method==='CASH') await openShiftRow(c,a,m,t,shiftId);
      else if (shiftId!==null) fail('REFUND_SHIFT_NOT_APPLICABLE');
      const p=(await c.query('SELECT * FROM pos_payments WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 AND merchant_id=$4 FOR UPDATE',[paymentId,a.tenantId,a.unitId,m.id])).rows[0];
      if (p.status!=='CONFIRMED') fail('PAYMENT_NOT_PAID',409);
      const used=(await c.query('SELECT coalesce(sum(amount),0) AS amount FROM pos_refunds WHERE payment_id=$1',[p.id])).rows[0];
      if (amount+BigInt(used.amount)>BigInt(p.amount)) fail('OVER_REFUND',409);
      const refundId=crypto.randomUUID(); let txId=null;
      if (p.method==='RFID') {
        const w=(await c.query('SELECT * FROM wallet_accounts WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 FOR UPDATE',[p.wallet_account_id,a.tenantId,a.unitId])).rows[0];
        if (!w || w.status==='closed') fail('REFUND_WALLET_UNAVAILABLE',409);
        txId=await walletMovement(c,a,w,amount,'credit','pos_refund',refundId,m.id,t.id);
      }
      const confirmed=p.method!=='TRANSFER_QRIS';
      const result=(await c.query(`INSERT INTO pos_refunds(id,payment_id,tenant_id,unit_id,merchant_id,shift_id,amount,status,reason,actor_id,
        request_id,request_hash,wallet_transaction_id,confirmed_by,confirmed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,CASE WHEN $14::integer IS NULL THEN NULL ELSE now() END) RETURNING *`,
      [refundId,p.id,a.tenantId,a.unitId,m.id,shiftId,amount.toString(),confirmed?'CONFIRMED':'PENDING',reason,a.user.id,key,hash,txId,confirmed?a.user.id:null])).rows[0];
      await afterStage('refund'); return {...result,replay:false};
    });
  }
  async function confirmRefund(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.refund'), b=req.body, {m}=await selling(c,a,b);
      const r=(await c.query('SELECT * FROM pos_refunds WHERE id=$1 AND tenant_id=$2 AND unit_id=$3 AND merchant_id=$4 FOR UPDATE',[uuid(req.params.id),a.tenantId,a.unitId,m.id])).rows[0];
      if (!r) fail('REFUND_NOT_FOUND',404);
      const p=(await c.query('SELECT method FROM pos_payments WHERE id=$1',[r.payment_id])).rows[0];
      if (p.method!=='TRANSFER_QRIS') fail('EXTERNAL_REFUND_ONLY');
      const reference=text(b.reference,160);
      if (b.confirmed!==true) fail('CONFIRMATION_REQUIRED');
      if (r.status==='CONFIRMED') { if (r.external_reference!==reference) fail('CONFIRMATION_CONFLICT',409); return r; }
      return (await c.query(`UPDATE pos_refunds SET status='CONFIRMED',external_reference=$2,confirmed_by=$3,confirmed_at=now() WHERE id=$1 RETURNING *`,[r.id,reference,a.user.id])).rows[0];
    });
  }
  async function createMerchant(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.config.manage');
      return (await c.query(`INSERT INTO merchant_rfid(tenant_id,unit_id,nama_merchant,location_resolution_status,pos_enabled)
        VALUES($1,$2,$3,'resolved',true) RETURNING id,tenant_id,unit_id,nama_merchant,pos_enabled`,
        [a.tenantId,a.unitId,text(req.body.name,100)])).rows[0];
    });
  }
  async function configureMerchant(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.config.manage');
      const result=await c.query(`UPDATE merchant_rfid SET pos_enabled=$1 WHERE id=$2 AND tenant_id=$3 AND unit_id=$4 AND location_resolution_status='resolved' RETURNING id,tenant_id,unit_id,pos_enabled`,
        [bool(req.body.enabled,true),id(req.params.id,'MERCHANT'),a.tenantId,a.unitId]);
      if (!result.rowCount) fail('MERCHANT_SCOPE_DENIED',403);
      return result.rows[0];
    });
  }
  async function configureTerminal(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.config.manage'); const m=await merchant(c,a,req.body.merchant_id);
      // Never convert Attendance or infer legacy NULL ownership.
      const result=await c.query(`UPDATE devices SET pos_enabled=$1 WHERE id=$2 AND tenant_id=$3 AND unit_id=$4 AND merchant_id=$5
        AND attendance_mode IS NULL AND location_resolution_status='resolved' RETURNING id,tenant_id,unit_id,merchant_id,pos_enabled`,
        [bool(req.body.enabled,true),id(req.params.id,'TERMINAL'),a.tenantId,a.unitId,m.id]);
      if (!result.rowCount) fail('TERMINAL_SCOPE_DENIED',403);
      return result.rows[0];
    });
  }
  async function assignCashier(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.config.manage'), m=await merchant(c,a,req.params.id);
      const user=await loadVerifiedUser({id:id(req.body.user_id,'USER')},a.tenantId,c);
      await assertUnitAccess(user,a.unitId,a.tenantId,c);
      return (await c.query(`INSERT INTO pos_cashier_assignments(tenant_id,unit_id,merchant_id,user_id,active) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(tenant_id,merchant_id,user_id) DO UPDATE SET active=excluded.active RETURNING *`,[a.tenantId,a.unitId,m.id,user.id,bool(req.body.active,true)])).rows[0];
    });
  }
  async function category(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.products.manage'), m=await merchant(c,a,req.body.merchant_id);
      return (await c.query(`INSERT INTO pos_categories(id,tenant_id,unit_id,merchant_id,name) VALUES($1,$2,$3,$4,$5) RETURNING *`,
        [crypto.randomUUID(),a.tenantId,a.unitId,m.id,text(req.body.name,120)])).rows[0];
    });
  }
  async function product(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.products.manage'), b=req.body, m=await merchant(c,a,b.merchant_id);
      const values=[a.tenantId,a.unitId,m.id,b.category_id==null?null:uuid(b.category_id),text(b.sku,80),text(b.name,160),
        integer(b.price,'PRICE',true).toString(),bool(b.active,true),bool(b.available,true)];
      const imageUrl=require('../utils/posProductImage').productImageUrl(b.image_url);
      if (req.params?.id) {
        const result=await c.query(`UPDATE pos_products SET category_id=$4,sku=$5,name=$6,price=$7,active=$8,available=$9,image_url=CASE WHEN $12 THEN $10 ELSE image_url END,updated_at=now()
          WHERE tenant_id=$1 AND unit_id=$2 AND merchant_id=$3 AND id=$11 RETURNING *`,[...values,imageUrl,uuid(req.params.id),Object.hasOwn(b,'image_url')]);
        if (!result.rowCount) fail('PRODUCT_NOT_FOUND',404);
        return result.rows[0];
      }
      return (await c.query(`INSERT INTO pos_products(tenant_id,unit_id,merchant_id,category_id,sku,name,price,active,available,image_url,id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[...values,imageUrl,crypto.randomUUID()])).rows[0];
    });
  }
  async function catalog(req) {
    return transaction(async c => {
      const a=await scope(req,c,'pos.view'), m=await merchant(c,a,req.query.merchant_id);
      const categories=(await c.query('SELECT * FROM pos_categories WHERE tenant_id=$1 AND unit_id=$2 AND merchant_id=$3 ORDER BY name',[a.tenantId,a.unitId,m.id])).rows;
      const products=(await c.query('SELECT * FROM pos_products WHERE tenant_id=$1 AND unit_id=$2 AND merchant_id=$3 ORDER BY sku',[a.tenantId,a.unitId,m.id])).rows;
      return {categories,products};
    });
  }
  return { checkout, openShift, closeShift, sale, confirmPayment, voidSale, refund, confirmRefund,
    createMerchant, configureMerchant, configureTerminal, assignCashier, category, product, catalog };
}
module.exports = { createPosService, integer, credential, ...createPosService() };
