// Merchant-owned business domain. No Admin token or client role is authority.
// Factory deliberately requires an explicit pool; importing cannot load .env.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { productImageUrl } = require('../utils/posProductImage');
const merchantPermissions = require('./posBusinessPermissions');
const bad = (code, status = 400) => { throw Object.assign(new Error(code), { code, status }); };
const uuid = value => {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(String(value))) bad('INVALID_ID');
  return value.toLowerCase();
};
const amount = (value, positive = false) => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) bad('INVALID_INTEGER');
  if (!/^(0|[1-9]\d*)$/.test(String(value ?? ''))) bad('INVALID_INTEGER');
  const n = BigInt(value);
  if (n > 9223372036854775807n || (positive && !n)) bad('INVALID_INTEGER');
  return n;
};
const text = (value, max = 160) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) bad('INVALID_TEXT');
  return value.trim();
};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const serialize = v => JSON.stringify(v, (_, item) => typeof item === 'bigint' ? item.toString() : item);
const makeId = () => crypto.randomUUID();
const passwordInput = (value, minimum = 1) => {
  if (typeof value !== 'string' || value.length < minimum || Buffer.byteLength(value, 'utf8') > 72) bad('INVALID_PASSWORD');
  return value; // Never silently trim or bcrypt-truncate a password.
};
function createPosBusinessService({ db, afterStage = async () => {}, featureEnabled = (...args)=>require('./unitFeatureService').isUnitFeatureEnabled(...args) }) {
  if (!db?.connect) throw new Error('EXPLICIT_DATABASE_REQUIRED');
  async function transaction(work, readOnly = false) {
    const c = await db.connect();
    try { c.posReadOnly=readOnly; await c.query(readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN'); const out = await work(c); await c.query('COMMIT'); return out; }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { delete c.posReadOnly; c.release(); }
  }
  async function authenticatedUser(c, req) {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers?.authorization || '');
    if (!match) bad('MERCHANT_AUTH_REQUIRED', 401);
    const user = (await c.query(`SELECT u.id,u.name FROM pos_merchant_sessions s JOIN pos_merchant_users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active ${c.posReadOnly?'':'FOR SHARE OF u,s'}`, [hash(match[1])])).rows[0];
    if (!user) bad('MERCHANT_SESSION_INVALID', 401);
    return user;
  }
  async function access(c, req, permission) {
    const user = await authenticatedUser(c, req);
    const business = uuid(req.params?.businessId);
    const m = (await c.query(`SELECT m.role,m.permissions,b.* FROM pos_merchant_memberships m
      JOIN pos_businesses b ON b.id=m.business_id AND b.tenant_id=m.tenant_id JOIN tenants t ON t.id=b.tenant_id
      WHERE m.business_id=$1 AND m.user_id=$2 AND m.active AND b.active AND t.status='active' ${c.posReadOnly?'':'FOR SHARE OF m,b,t'}`, [business, user.id])).rows[0];
    if (!m) bad('MERCHANT_ACCESS_DENIED', 403);
    if (req.body?.tenant_id != null || req.query?.tenant_id != null || req.body?.role != null && !['users.manage','USER_MANAGE','PERMISSION_MANAGE'].includes(permission)) bad('CLIENT_AUTHORITY_REJECTED', 403);
    const effectivePermissions = merchantPermissions.effective(m.role, m.permissions);
    if (permission && !effectivePermissions.includes(merchantPermissions.canonical(permission))) bad('MERCHANT_PERMISSION_DENIED', 403);
    return { business, user: user.id, userName: user.name, member: { ...m, effective_permissions: effectivePermissions } };
  }
  const run = (req, permission, work) => transaction(async c => work(c, await access(c, req, permission)));
  const read = (req, permission, work) => transaction(async c => work(c, await access(c, req, permission)), true);
  async function lock(c, key) { await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]); }
  async function settlementDestinationEnabled(c) {
    return (await c.query(`SELECT EXISTS(SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='pos_wallet_settlement_payouts' AND column_name='merchant_account_id') enabled`)).rows[0].enabled;
  }
  async function accountBalance(c, business, account, asOf = null, timezone = 'UTC') {
    const values = [business, account], cutoff = asOf ? ` AND o.effective_date<=$4::date AND $3::text IS NOT NULL` : '';
    if (asOf) values.push(timezone, asOf);
    const movement = BigInt((await c.query(`SELECT coalesce(sum(m.amount),0) value FROM pos_money_movements m JOIN pos_business_dated_operations o ON o.id=m.operation_id AND o.business_id=m.business_id
      WHERE m.business_id=$1 AND m.account_id=$2${cutoff}`, values)).rows[0].value);
    if (!await settlementDestinationEnabled(c)) return movement;
    const payoutValues = [business, account], payoutCutoff = asOf ? ' AND payout_date<=$3::date' : '';
    if (asOf) payoutValues.push(asOf);
    const payouts = BigInt((await c.query(`SELECT coalesce(sum(amount),0) value FROM pos_wallet_settlement_payouts
      WHERE business_id=$1 AND merchant_account_id=$2${payoutCutoff}`, payoutValues)).rows[0].value);
    return movement + payouts;
  }
  async function login(req) {
    const b = req.body || {}, login = text(b.login, 120).toLowerCase(), password = passwordInput(b.password);
    const key = hash('login:' + login);
    // Committed failed attempts, not rolled back with credential failure.
    const result = await transaction(async c => {
      await lock(c, 'pos-auth:' + key);
      await c.query(`INSERT INTO pos_merchant_login_limits(key,attempts,started_at) VALUES($1,0,now()) ON CONFLICT DO NOTHING`, [key]);
      await c.query(`UPDATE pos_merchant_login_limits SET attempts=0,started_at=now() WHERE key=$1 AND started_at<now()-interval '15 minutes'`, [key]);
      const limit = (await c.query('SELECT attempts FROM pos_merchant_login_limits WHERE key=$1', [key])).rows[0];
      if (limit.attempts >= 10) return { error: 'LOGIN_RATE_LIMITED', status: 429 };
      await c.query('UPDATE pos_merchant_login_limits SET attempts=attempts+1 WHERE key=$1', [key]);
      const u = (await c.query('SELECT id,password_hash,active FROM pos_merchant_users WHERE login=$1', [login])).rows[0];
      // Fixed dummy hash is test-independent and never an account credential.
      const ok = await bcrypt.compare(password, u?.password_hash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
      if (!u?.active || !ok) return { error: 'INVALID_CREDENTIALS', status: 401 };
      const token = crypto.randomBytes(32).toString('hex');
      await c.query(`INSERT INTO pos_merchant_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '8 hours')`, [hash(token), u.id]);
      await c.query('UPDATE pos_merchant_login_limits SET attempts=0 WHERE key=$1', [key]);
      return { token, expires_in: 28800 };
    });
    if (result.error) bad(result.error, result.status);
    return result;
  }
  async function activate(req) {
    const b = req.body || {}, login = text(b.login, 120).toLowerCase();
    const activationCode = text(b.activation_code, 160), password = passwordInput(b.password, 12);
    return transaction(async c => {
      await lock(c, 'pos-activate:' + hash(login));
      const row = (await c.query(`SELECT u.id,t.business_id FROM pos_merchant_users u
        JOIN pos_merchant_activation_tokens t ON t.user_id=u.id
        JOIN pos_merchant_memberships m ON m.business_id=t.business_id AND m.user_id=t.user_id
        WHERE u.login=$1 AND u.active AND m.active AND t.token_hash=$2 AND t.expires_at>now() FOR UPDATE OF u,t`,
      [login, hash(activationCode)])).rows[0];
      if (!row) bad('ACTIVATION_INVALID', 401);
      await c.query('UPDATE pos_merchant_users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(password, 12), row.id]);
      await c.query('DELETE FROM pos_merchant_sessions WHERE user_id=$1', [row.id]);
      await c.query('DELETE FROM pos_merchant_activation_tokens WHERE business_id=$1 AND user_id=$2', [row.business_id, row.id]);
      return { activated: true };
    });
  }
  async function logout(req) {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers?.authorization || '');
    if (!match) bad('MERCHANT_AUTH_REQUIRED', 401);
    return transaction(async c => { await c.query('DELETE FROM pos_merchant_sessions WHERE token_hash=$1', [hash(match[1])]); return { logged_out: true }; });
  }
  async function memberships(req) {
    return transaction(async c => {
      const user = await authenticatedUser(c, req);
      const rows = (await c.query(`SELECT b.id,b.display_name,b.logo_url,b.ownership,b.timezone,b.currency,
        m.role,m.permissions,t.slug tenant_slug
        FROM pos_merchant_memberships m
        JOIN pos_businesses b ON b.id=m.business_id AND b.tenant_id=m.tenant_id
        JOIN tenants t ON t.id=b.tenant_id
        WHERE m.user_id=$1 AND m.active AND b.active AND t.status='active'
        ORDER BY b.display_name,b.id`, [user.id])).rows;
      return {
        user: { id: user.id, name: user.name },
        businesses: rows.map(row => ({
          id: row.id, display_name: row.display_name, logo_url: row.logo_url,
          ownership: row.ownership, timezone: row.timezone, currency: row.currency,
          tenant_slug: row.tenant_slug, role: row.role,
          permissions: merchantPermissions.effective(row.role, row.permissions),
        })),
      };
    });
  }
  async function context(req) {
    return run(req, null, async (c, a) => ({
      user_id: a.user, user_name: a.userName, role: a.member.role, permissions: a.member.effective_permissions,
      permission_groups: merchantPermissions.GROUPS,
      business: { id: a.business, display_name: a.member.display_name, ownership: a.member.ownership, logo_url: a.member.logo_url,
        timezone: a.member.timezone, currency: a.member.currency, address: a.member.address, phone: a.member.phone,
        receipt_name: a.member.receipt_name,
        receipt_header: a.member.receipt_header, receipt_footer: a.member.receipt_footer, receipt_prefix: a.member.receipt_prefix,
        accounting_start_date: a.member.accounting_start_date },
      units: (await c.query(`SELECT bu.unit_id,coalesce(to_jsonb(u)->>'nama',bu.unit_id::text) AS nama_unit FROM pos_business_units bu
        JOIN unit_pendidikan u ON u.id=bu.unit_id AND u.tenant_id=bu.tenant_id
        WHERE bu.business_id=$1 AND u.is_active ORDER BY nama_unit,u.id`, [a.business])).rows,
      terminals: (await c.query('SELECT id,name FROM pos_business_terminals WHERE business_id=$1 AND active ORDER BY name,id', [a.business])).rows,
    }));
  }
  async function member(req) {
    return run(req, 'USER_MANAGE', async (c, a) => {
      // Only owner can create/assign identities; configurable users.manage alone cannot escalate.
      if (a.member.role !== 'OWNER') bad('OWNER_REQUIRED', 403);
      const b = req.body, role = b.role;
      if (!['SUPERVISOR', 'CASHIER'].includes(role)) bad('INVALID_ROLE');
      const permissions = merchantPermissions.encodeExplicit(b.permissions || merchantPermissions.DEFAULTS[role]);
      if (!permissions) bad('INVALID_PERMISSIONS');
      if (b.password != null) bad('OWNER_PASSWORD_ASSIGNMENT_FORBIDDEN', 400);
      const userId = makeId(), passwordHash = await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 12);
      const activationCode = crypto.randomBytes(24).toString('base64url');
      await c.query('INSERT INTO pos_merchant_users(id,login,name,password_hash) VALUES($1,$2,$3,$4)', [userId, text(b.login, 120).toLowerCase(), text(b.name), passwordHash]);
      await c.query(`INSERT INTO pos_merchant_memberships(business_id,tenant_id,user_id,role,permissions) VALUES($1,$2,$3,$4,$5)`, [a.business, a.member.tenant_id, userId, role, permissions]);
      await c.query(`INSERT INTO pos_merchant_activation_tokens(business_id,user_id,token_hash,expires_at,created_by)
        VALUES($1,$2,$3,now()+interval '48 hours',$4)`, [a.business, userId, hash(activationCode), a.user]);
      await c.query(`INSERT INTO pos_merchant_permission_audit(id,business_id,actor_id,target_user_id,action,after_state)
        VALUES($1,$2,$3,$4,'MEMBER_CREATED',$5)`, [makeId(), a.business, a.user, userId, JSON.stringify({ role, permissions: merchantPermissions.effective(role, permissions), active: true })]);
      return { id: userId, role, name: b.name, login: b.login.trim().toLowerCase(), activation_code: activationCode, activation_expires_in: 172800 };
    });
  }
  async function product(req) {
    return run(req, 'products.manage', async (c, a) => {
      const b = req.body, image = productImageUrl(b.image_url);
      const id = makeId();
      return (await c.query(`INSERT INTO pos_business_products(id,business_id,sku,barcode,name,category,uom,image_url,selling_price,reference_purchase_price,minimum_stock,online_visible)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false) RETURNING id,sku,name,selling_price,reference_purchase_price,online_visible`,
      [id, a.business, text(b.sku, 80), b.barcode ? text(b.barcode, 120) : null, text(b.name), b.category ? text(b.category, 120) : null,
        b.uom ? text(b.uom, 32) : 'pcs', image, amount(b.selling_price, true).toString(),
        b.reference_purchase_price == null || b.reference_purchase_price === '' ? null : amount(b.reference_purchase_price).toString(),
        amount(b.minimum_stock || 0).toString()])).rows[0];
    });
  }
  async function authorizeProductAsset(req) {
    return run(req, 'PRODUCT_MANAGE', async (_c, a) => ({ business_id: a.business }));
  }
  async function catalog(req) {
    return run(req, 'products.read', async (c, a) => {
      const hasOnline=(await c.query("SELECT to_regclass('public.pos_online_reservations') present")).rows[0].present;
      if(hasOnline)await online.expireOnline(a.business);
      const products=(await c.query(`SELECT p.id,p.sku,p.barcode,p.name,p.category,p.uom,p.image_url,p.selling_price,p.reference_purchase_price,p.online_price,p.minimum_stock,
      p.active,p.sellable,p.online_visible,coalesce(s.on_hand,0) on_hand FROM pos_business_products p
      LEFT JOIN(SELECT product_id,sum(quantity) on_hand FROM pos_inventory_movements WHERE business_id=$1 GROUP BY product_id)s ON s.product_id=p.id
      WHERE p.business_id=$1 ORDER BY p.name,p.id LIMIT 200`, [a.business])).rows;
      if(hasOnline){const reserved=(await c.query("SELECT product_id,sum(quantity) quantity FROM pos_online_reservations WHERE business_id=$1 AND state='RESERVED' GROUP BY product_id",[a.business])).rows;
        for(const p of products){p.reserved=reserved.find(r=>r.product_id===p.id)?.quantity||'0';p.available=(BigInt(p.on_hand)-BigInt(p.reserved)).toString();}}
      return products;
    });
  }
  async function party(req) {
    const b = req.body; if (!['CUSTOMER', 'SUPPLIER'].includes(b.kind)) bad('INVALID_PARTY_KIND');
    return run(req, b.kind === 'CUSTOMER' ? 'CUSTOMER_MANAGE' : 'SUPPLIER_MANAGE', async (c, a) => {
      const creditAllowed = b.kind === 'CUSTOMER' && b.credit_allowed === true;
      if (creditAllowed && !merchantPermissions.has(a.member, 'CUSTOMER_CREDIT_MANAGE')) bad('MERCHANT_PERMISSION_DENIED', 403);
      return (await c.query(`INSERT INTO pos_business_parties(id,business_id,kind,name,phone,address,notes,credit_allowed,credit_limit,due_days,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,kind,name`,
      [makeId(), a.business, b.kind, text(b.name), b.phone ? text(b.phone, 80) : null, b.address ? text(b.address, 500) : null,
        b.notes ? text(b.notes, 1000) : null, creditAllowed, amount(creditAllowed ? b.credit_limit || 0 : 0).toString(),
        Number(amount(creditAllowed ? b.due_days || 0 : 0)), a.user])).rows[0];
    });
  }
  async function account(req) {
    return run(req, 'BUSINESS_SETTINGS_MANAGE', async (c, a) => {
      const b = req.body, name = text(req.body.name);
      if (!['CASH', 'BANK', 'QRIS'].includes(b.kind)) bad('INVALID_ACCOUNT_KIND');
      await lock(c, `pos-business-config:${a.business}:account:${b.kind}:${name.toLowerCase()}`);
      const existing = (await c.query(`SELECT id,name,kind,true AS replay FROM pos_business_accounts
        WHERE business_id=$1 AND kind=$2 AND lower(btrim(name))=lower(btrim($3)) AND active FOR UPDATE`, [a.business, b.kind, name])).rows[0];
      if (existing) return existing;
      return (await c.query('INSERT INTO pos_business_accounts(id,business_id,name,kind) VALUES($1,$2,$3,$4) RETURNING id,name,kind', [makeId(), a.business, name, b.kind])).rows[0];
    });
  }
  async function getAccount(c, a, id, outflow = 0n, allowClearing = false) {
    const ac = (await c.query(`SELECT id,name,kind FROM pos_business_accounts WHERE id=$1 AND business_id=$2 AND active FOR UPDATE`, [uuid(id), a.business])).rows[0];
    if (!ac || ac.kind === 'WALLET_CLEARING' && !allowClearing) bad('ACCOUNT_DENIED', 403);
    const balance = await accountBalance(c, a.business, ac.id);
    if (balance < outflow) bad('INSUFFICIENT_BUSINESS_FUNDS', 409);
    return ac;
  }
  async function beginOperation(c, a, b, kind, fields, legacyFields = null) {
    const request = text(b.request_id); if (request.length < 8) bad('INVALID_REQUEST_ID');
    const requestHash = hash(serialize({ actor: a.user, kind, ...fields }));
    await lock(c, 'pos-business:' + a.business + ':' + request);
    const old = (await c.query('SELECT * FROM pos_business_operations WHERE business_id=$1 AND request_id=$2', [a.business, request])).rows[0];
    if (old) { if (old.request_hash !== requestHash && (!legacyFields || old.request_hash !== hash(serialize({actor:a.user,kind,...legacyFields})))) bad('IDEMPOTENCY_CONFLICT', 409); return { ...old, replay: true }; }
    return { id: makeId(), request, requestHash, replay: false };
  }
  async function insertOperation(c, a, op, kind, f) {
    await c.query(`INSERT INTO pos_business_operations(id,business_id,actor_id,kind,request_id,request_hash,total,paid,party_id,due_date,reference,reason,source_id,channel,shift_id,receipt_snapshot,accounting_date,finance_category_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [op.id, a.business, a.user, kind, op.request, op.requestHash, f.total.toString(), f.paid.toString(), f.party || null,
      f.due || null, f.reference || null, f.reason || null, f.source || null, f.channel || null, f.shift || null, f.snapshot ? serialize(f.snapshot) : null,f.accountingDate||null,f.category||null]);
  }
  async function moneyRow(c, a, operation, accountId, value) {
    if (!value) return;
    await c.query('INSERT INTO pos_money_movements(id,business_id,operation_id,account_id,amount,actor_id) VALUES($1,$2,$3,$4,$5,$6)', [makeId(), a.business, operation, accountId, value.toString(), a.user]);
  }
  async function debtRow(c, a, op, f, kind, value, source) {
    if (!value) return;
    await c.query('INSERT INTO pos_debt_movements(id,business_id,party_id,operation_id,source_id,kind,amount,due_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [makeId(), a.business, f.party, op, source, kind, value.toString(), f.due]);
  }
  function dueDate(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v || '') || Number.isNaN(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) bad('INVALID_DUE_DATE');
    return v;
  }
  async function purchase(req) {
    return run(req, 'PURCHASE_CREATE', async (c, a) => {
      const b = req.body;
      if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100) bad('INVALID_ITEMS');
      const items = b.items.map(i => ({ product: uuid(i.product_id), quantity: amount(i.quantity, true), cost: amount(i.unit_cost) })).sort((x, y) => x.product.localeCompare(y.product));
      if (new Set(items.map(i => i.product)).size !== items.length) bad('DUPLICATE_PRODUCT');
      const total = items.reduce((sum, i) => sum + i.quantity * i.cost, 0n), paid = amount(b.paid || 0);
      if (!total || paid > total) bad('INVALID_TOTAL');
      const f = { total, paid, party: uuid(b.supplier_id), due: paid < total ? dueDate(b.due_date) : null,
        account: paid ? uuid(b.account_id) : null, items, reference: b.reference ? text(b.reference) : null };
      const op = await beginOperation(c, a, b, 'PURCHASE', f); if (op.replay) return op;
      const supplier = (await c.query(`SELECT id FROM pos_business_parties WHERE id=$1 AND business_id=$2 AND kind='SUPPLIER' AND active FOR SHARE`, [f.party, a.business])).rows[0];
      if (!supplier) bad('SUPPLIER_DENIED', 403);
      if (paid) await getAccount(c, a, f.account, paid);
      await insertOperation(c, a, op, 'PURCHASE', f);
      const pricingEnabled=await pricing.available(c);
      for (const i of items) {
        const p = await getProduct(c, a, i.product);
        const movement = makeId();
        await c.query(`INSERT INTO pos_business_lines(id,business_id,operation_id,product_id,sku,name,quantity,unit_price,total,cogs${pricingEnabled?',uom_snapshot':''})
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0${pricingEnabled?',$10':''})`, [makeId(), a.business, op.id, p.id, p.sku, p.name, i.quantity.toString(), i.cost.toString(), (i.quantity * i.cost).toString(),...(pricingEnabled?[p.uom]:[])]);
        await stockRow(c, a, op.id, p.id, movement, i.quantity, i.quantity * i.cost, 'PURCHASE_IN');
        await addLayer(c, a, p.id, movement, i.quantity, i.cost);
      }
      await afterStage('stock');
      await moneyRow(c, a, op.id, f.account, -paid);
      await debtRow(c, a, op.id, f, 'AP', total - paid, op.id);
      await afterStage('money');
      return { id: op.id, total: total.toString(), paid: paid.toString(), payable: (total - paid).toString(), replay: false };
    });
  }
  async function getProduct(c, a, product) {
    const p = (await c.query('SELECT * FROM pos_business_products WHERE id=$1 AND business_id=$2 AND active FOR UPDATE', [product, a.business])).rows[0];
    if (!p) bad('PRODUCT_DENIED', 403); return p;
  }
  async function stockRow(c, a, op, product, id, quantity, cost, kind, reason = null) {
    await c.query('INSERT INTO pos_inventory_movements(id,business_id,product_id,operation_id,quantity,cost,kind,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [id, a.business, product, op, quantity.toString(), cost.toString(), kind, reason, a.user]);
  }
  async function addLayer(c, a, product, movement, quantity, cost) {
    await c.query('INSERT INTO pos_inventory_layers(id,business_id,product_id,movement_id,received_quantity,unit_cost) VALUES($1,$2,$3,$4,$5,$6)',
      [makeId(), a.business, product, movement, quantity.toString(), cost.toString()]);
  }
  async function consume(c, a, product, quantity, movement) {
    const layers = (await c.query(`SELECT l.*, l.received_quantity-coalesce(x.used,0) available FROM pos_inventory_layers l
      LEFT JOIN(SELECT layer_id,sum(quantity) used FROM pos_inventory_allocations WHERE business_id=$1 GROUP BY layer_id)x ON x.layer_id=l.id
      WHERE l.business_id=$1 AND l.product_id=$2 ORDER BY l.created_at,l.id`, [a.business, product])).rows;
    if (layers.reduce((sum, l) => sum + BigInt(l.available), 0n) < quantity) bad('INSUFFICIENT_STOCK', 409);
    let remaining = quantity, cost = 0n;
    for (const l of layers) {
      const take = remaining < BigInt(l.available) ? remaining : BigInt(l.available);
      if (!take) continue;
      await c.query('INSERT INTO pos_inventory_allocations(id,business_id,product_id,layer_id,movement_id,quantity) VALUES($1,$2,$3,$4,$5,$6)', [makeId(), a.business, product, l.id, movement, take.toString()]);
      cost += take * BigInt(l.unit_cost); remaining -= take; if (!remaining) break;
    }
    return cost;
  }
  async function adjustment(req) {
    return run(req, 'INVENTORY_ADJUST', async (c, a) => {
      const b = req.body, direction = b.direction;
      if (!['IN', 'OUT', 'DAMAGE'].includes(direction)) bad('INVALID_DIRECTION');
      const f = { product: uuid(b.product_id), quantity: amount(b.quantity, true), reason: text(b.reason, 500), direction,
        unitCost: direction === 'IN' ? amount(b.unit_cost) : null, total: 0n, paid: 0n };
      const op = await beginOperation(c, a, b, 'STOCK_ADJUSTMENT', f); if (op.replay) return op;
      await getProduct(c, a, f.product); await insertOperation(c, a, op, 'STOCK_ADJUSTMENT', f);
      const movement = makeId();
      // Insert movement before allocation; cost known by FIFO read under product lock.
      if (direction === 'IN') {
        await stockRow(c, a, op.id, f.product, movement, f.quantity, f.quantity * f.unitCost, 'ADJUSTMENT_IN', f.reason);
        await addLayer(c, a, f.product, movement, f.quantity, f.unitCost);
      } else {
        const cost = await availableCost(c, a, f.product, f.quantity);
        await stockRow(c, a, op.id, f.product, movement, -f.quantity, cost, direction === 'OUT' ? 'ADJUSTMENT_OUT' : 'DAMAGE', f.reason);
        if (await consume(c, a, f.product, f.quantity, movement) !== cost) bad('COST_MISMATCH', 409);
      }
      return { id: op.id, replay: false };
    });
  }
  async function availableCost(c, a, product, quantity) {
    // Product is already locked. Reservations share this SAME stock, never a second counter.
    if ((await c.query("SELECT to_regclass('public.pos_online_reservations') present")).rows[0].present) {
      const stock = (await c.query(`SELECT
       (SELECT coalesce(sum(quantity),0) FROM pos_inventory_movements WHERE business_id=$1 AND product_id=$2)
       -(SELECT coalesce(sum(quantity),0) FROM pos_online_reservations WHERE business_id=$1 AND product_id=$2 AND state='RESERVED') available`,[a.business,product])).rows[0];
      if (BigInt(stock.available)<quantity) bad('INSUFFICIENT_STOCK',409);
    }
    const rows = (await c.query(`SELECT l.unit_cost,l.received_quantity-coalesce(x.used,0) available FROM pos_inventory_layers l
      LEFT JOIN(SELECT layer_id,sum(quantity) used FROM pos_inventory_allocations WHERE business_id=$1 GROUP BY layer_id)x ON x.layer_id=l.id
      WHERE l.business_id=$1 AND l.product_id=$2 ORDER BY l.created_at,l.id`, [a.business, product])).rows;
    let remaining = quantity, cost = 0n;
    for (const l of rows) { const take = remaining < BigInt(l.available) ? remaining : BigInt(l.available); cost += take * BigInt(l.unit_cost); remaining -= take; }
    if (remaining) bad('INSUFFICIENT_STOCK', 409); return cost;
  }
  async function money(req) {
    const b=req.body||{},kind=b.kind,capability={CAPITAL:'CAPITAL_MANAGE',WITHDRAWAL:'PRIVE_MANAGE',EXPENSE:'EXPENSE_CREATE',OTHER_INCOME:'OTHER_INCOME_CREATE',TRANSFER:'TRANSFER_CREATE'}[kind];
    if(!capability)bad('INVALID_MONEY_KIND');
    return run(req,capability,(c,a)=>moneyWork(c,a,b));
  }
  async function moneyWork(c,a,b,correction=null){
      const kind=b.kind;
      const date=b.date?dueDate(b.date):(await c.query("SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') AS day",[a.member.timezone])).rows[0].day;
      const f={account:uuid(b.account_id),destination:kind==='TRANSFER'?uuid(b.destination_account_id):null,reason:text(b.reason,500),
        total:amount(b.amount,true),paid:amount(b.amount,true),accountingDate:date,category:b.category_id?uuid(b.category_id):null,
        reference:b.reference?text(b.reference):null,fee:kind==='TRANSFER'?amount(b.fee||0):0n};
      if(f.account===f.destination)bad('TRANSFER_SAME_ACCOUNT');
      if(f.fee&&!a.member.effective_permissions.includes('EXPENSE_CREATE'))bad('MERCHANT_PERMISSION_DENIED',403);
      if(f.category){const cat=(await c.query('SELECT kind FROM pos_finance_categories WHERE id=$1 AND business_id=$2 AND active',[f.category,a.business])).rows[0];if(!cat||cat.kind!==kind)bad('FINANCE_CATEGORY_DENIED',403);}
      const legacyFields=b.date==null&&b.category_id==null&&b.reference==null&&b.fee==null?{account:f.account,destination:f.destination,reason:f.reason,total:f.total,paid:f.paid}:null;
      const op=await beginOperation(c,a,b,kind,legacyFields||f,legacyFields);if(op.replay){if(correction&&(op.source_id!==correction.original||op.receipt_snapshot?.finance_action!=='CORRECTION'))bad('IDEMPOTENCY_CONFLICT',409);return op;}
      if(!f.category&&['EXPENSE','OTHER_INCOME'].includes(kind))f.category=(await c.query('SELECT id FROM pos_finance_categories WHERE business_id=$1 AND kind=$2 AND code=$3 AND active',[a.business,kind,kind==='EXPENSE'?'OTHER_EXPENSE':'OTHER_INCOME'])).rows[0]?.id||null;
      const negative=['WITHDRAWAL','EXPENSE','TRANSFER'].includes(kind);
      const accountLabels=[];for(const id of [f.account,f.destination].filter(Boolean).sort())accountLabels.push(await getAccount(c,a,id,id===f.account&&negative?f.total+f.fee:0n));
      f.snapshot={name:a.member.receipt_name||a.member.display_name,accounts:accountLabels,finance_action:correction?'CORRECTION':'POSTED',...(correction?{original_id:correction.original,correction_reason:correction.reason}:{})};if(correction)f.source=correction.original;
      await insertOperation(c,a,op,kind,f);
      await moneyRow(c,a,op.id,f.account,negative?-f.total:f.total);
      if(f.destination)await moneyRow(c,a,op.id,f.destination,f.total);
      if(f.fee){
        const feeOp=await beginOperation(c,a,{request_id:'transfer-fee:'+hash(op.request)},'EXPENSE',{source:op.id,total:f.fee,account:f.account,accountingDate:date});
        const category=(await c.query("SELECT id FROM pos_finance_categories WHERE business_id=$1 AND code='BANK_FEE' AND kind='EXPENSE'",[a.business])).rows[0];
        await insertOperation(c,a,feeOp,'EXPENSE',{source:op.id,total:f.fee,paid:f.fee,accountingDate:date,category:category?.id,snapshot:{name:a.member.receipt_name||a.member.display_name,accounts:accountLabels.filter(ac=>ac.id===f.account),finance_action:'POSTED'},reason:'Biaya transfer: '+f.reason,reference:f.reference});
        await moneyRow(c,a,feeOp.id,f.account,-f.fee);
      }
      // Backdated cash postings may not make any subsequent daily ledger position negative.
      const negativeDays=(await c.query(`WITH flow AS (
        SELECT m.account_id,o.effective_date AS day,m.amount FROM pos_money_movements m JOIN pos_business_dated_operations o ON o.id=m.operation_id AND o.business_id=m.business_id WHERE m.business_id=$1 AND m.account_id=ANY($2::uuid[])
        UNION ALL SELECT merchant_account_id,payout_date,amount FROM pos_wallet_settlement_payouts WHERE business_id=$1 AND merchant_account_id=ANY($2::uuid[])
      ), days AS (SELECT account_id,day,sum(amount) amount FROM flow GROUP BY account_id,day),
      positions AS (SELECT day,sum(amount) OVER(PARTITION BY account_id ORDER BY day) balance FROM days)
      SELECT 1 FROM positions WHERE day>=$3::date AND balance<0 LIMIT 1`,[a.business,[f.account,f.destination].filter(Boolean),date])).rowCount;
      if(negativeDays)bad('HISTORICAL_INSUFFICIENT_FUNDS',409);
      await afterStage('money');return {id:op.id,replay:false};
  }
  async function payDebt(req) {
    const b = req.body, kind = b.kind;
    return run(req, kind === 'AR' ? 'AR_COLLECT' : kind === 'AP' ? 'AP_PAY' : 'INVALID', async (c, a) => {
      if (!['AR', 'AP'].includes(kind)) bad('INVALID_DEBT_KIND');
      const f = { source: uuid(b.source_id), account: uuid(b.account_id), total: amount(b.amount, true), paid: amount(b.amount, true) };
      const op = await beginOperation(c, a, b, kind === 'AR' ? 'AR_COLLECTION' : 'AP_PAYMENT', f); if (op.replay) return op;
      await lock(c, 'pos-source:' + a.business + ':' + f.source);
      const original = (await c.query(`SELECT id,party_id,due_date FROM pos_business_operations WHERE id=$1 AND business_id=$2 AND kind=ANY($3::text[])`,
        [f.source, a.business, kind === 'AR' ? ['SALE','OPENING_AR'] : ['PURCHASE','OPENING_AP']])).rows[0];
      if (!original?.party_id) bad('DEBT_SOURCE_DENIED', 403);
      const outstanding = BigInt((await c.query(`SELECT coalesce(sum(amount),0) amount FROM pos_debt_movements WHERE business_id=$1 AND source_id=$2 AND kind=$3`, [a.business, f.source, kind])).rows[0].amount);
      if (f.total > outstanding) bad('DEBT_OVERPAYMENT', 409);
      await getAccount(c, a, f.account, kind === 'AP' ? f.total : 0n);
      await insertOperation(c, a, op, kind === 'AR' ? 'AR_COLLECTION' : 'AP_PAYMENT', f);
      await moneyRow(c, a, op.id, f.account, kind === 'AR' ? f.total : -f.total);
      await debtRow(c, a, op.id, { party: original.party_id, due: original.due_date }, kind, -f.total, f.source);
      return { id: op.id, remaining: (outstanding - f.total).toString(), replay: false };
    });
  }
  const finance=require('./posBusinessFinance').createBusinessFinance({read,bad,uuid,dueDate});
  const cashBook=finance.cashBook;
  async function terminal(req) {
    return run(req, 'BUSINESS_SETTINGS_MANAGE', async (c, a) => {
      const name = text(req.body.name);
      await lock(c, `pos-business-config:${a.business}:terminal:${name.toLowerCase()}`);
      const existing = (await c.query(`SELECT id,name,true AS replay FROM pos_business_terminals
        WHERE business_id=$1 AND lower(btrim(name))=lower(btrim($2)) AND active FOR UPDATE`, [a.business, name])).rows[0];
      if (existing) return existing;
      return (await c.query('INSERT INTO pos_business_terminals(id,business_id,name) VALUES($1,$2,$3) RETURNING id,name',
        [makeId(), a.business, name])).rows[0];
    });
  }
  async function openShift(req) {
    return run(req, 'SHIFT_OPEN', async (c, a) => {
      const b = req.body, ac = await getAccount(c, a, b.cash_account_id);
      if (ac.kind !== 'CASH') bad('CASH_DRAWER_REQUIRED');
      const t = (await c.query('SELECT id FROM pos_business_terminals WHERE id=$1 AND business_id=$2 AND active FOR SHARE', [uuid(b.terminal_id), a.business])).rows[0];
      if (!t) bad('TERMINAL_DENIED', 403);
      const active = (await c.query(`SELECT user_id,terminal_id,cash_account_id FROM pos_business_shifts
        WHERE business_id=$1 AND status='OPEN' AND (user_id=$2 OR terminal_id=$3 OR cash_account_id=$4)
        ORDER BY opened_at,id LIMIT 1 FOR UPDATE`, [a.business, a.user, t.id, ac.id])).rows[0];
      if (active) bad(active.user_id === a.user ? 'SHIFT_ALREADY_OPEN' : 'SHIFT_RESOURCE_IN_USE', 409);
      try {
        return (await c.query(`INSERT INTO pos_business_shifts(id,business_id,user_id,terminal_id,cash_account_id,opening_cash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
          [makeId(), a.business, a.user, t.id, ac.id, amount(b.opening_cash || 0).toString()])).rows[0];
      } catch (error) {
        if (error.code === '23505' && ['pos_business_shift_user','pos_business_shift_terminal','pos_business_shift_drawer'].includes(error.constraint))
          bad(error.constraint === 'pos_business_shift_user' ? 'SHIFT_ALREADY_OPEN' : 'SHIFT_RESOURCE_IN_USE', 409);
        throw error;
      }
    });
  }
  async function shiftRow(c, a, id) {
    const s = (await c.query(`SELECT * FROM pos_business_shifts WHERE id=$1 AND business_id=$2 AND user_id=$3 FOR UPDATE`, [uuid(id), a.business, a.user])).rows[0];
    if (!s) bad('SHIFT_DENIED', 403); return s;
  }
  async function closeShift(req) {
    return run(req, 'SHIFT_CLOSE', async (c, a) => {
      const s = await shiftRow(c, a, req.body.shift_id), actual = amount(req.body.actual_cash);
      if (s.status === 'CLOSED') {
        if (BigInt(s.actual_cash) !== actual) bad('SHIFT_ALREADY_CLOSED', 409);
        return { ...s, replay: true };
      }
      const movement = BigInt((await c.query(`SELECT coalesce(sum(m.amount),0) amount FROM pos_money_movements m
        JOIN pos_business_operations o ON o.id=m.operation_id AND o.business_id=m.business_id
        WHERE o.business_id=$2 AND m.account_id=$3 AND (m.attributed_shift_id=$1 OR (m.attributed_shift_id IS NULL AND o.shift_id=$1) OR (m.attributed_shift_id IS NULL AND o.accounting_date IS NULL AND o.shift_id IS NULL AND m.created_at>=$4::timestamptz))`, [s.id, a.business, s.cash_account_id,s.opened_at])).rows[0].amount);
      const settlementCash=BigInt((await c.query('SELECT coalesce(sum(amount),0) amount FROM pos_wallet_settlement_payouts WHERE business_id=$1 AND merchant_account_id=$2 AND attributed_shift_id=$3',[a.business,s.cash_account_id,s.id])).rows[0].amount);
      const expected = BigInt(s.opening_cash) + movement + settlementCash;
      return (await c.query(`UPDATE pos_business_shifts SET status='CLOSED',closed_at=now(),actual_cash=$1,expected_cash=$2,difference=$3
        WHERE id=$4 AND business_id=$5 RETURNING *`, [actual.toString(), expected.toString(), (actual - expected).toString(), s.id, a.business])).rows[0];
    });
  }
  async function sale(req) {
    return run(req, 'SALE_CREATE', async (c, a) => {
      if((await c.query("SELECT to_regclass('public.pos_online_reservations') present")).rows[0].present)await online.expireOnline(a.business);
      return saleWork(c,a,req.body);
    });
  }
  async function saleWork(c,a,b,online = null) {
      if(b.packages!=null&&!Array.isArray(b.packages)||(b.packages||[]).length>100)bad('INVALID_ITEMS');
      if (!Array.isArray(b.items) || (!b.items.length&&!b.packages?.length) || b.items.length > 100 || !Array.isArray(b.payments) || !b.payments.length || b.payments.length > 5) bad('INVALID_SALE');
      // ONLINE is not accepted until reservation/order authorization integration is complete.
      if (!online && b.channel && b.channel !== 'POS') bad('CHANNEL_NOT_READY', 409);
      const items = b.items.map(i => ({ product: uuid(i.product_id), quantity: amount(i.quantity, true),...(i.price_level_id?{price_level_id:uuid(i.price_level_id)}:{}) })).sort((x, y) => x.product.localeCompare(y.product));
      if (new Set(items.map(i => i.product)).size !== items.length) bad('DUPLICATE_PRODUCT');
      const payments = b.payments.map(p => {
        if (!['CASH', 'BANK', 'QRIS', 'CREDIT', 'DOMPET_SANTRI'].includes(p.method)) bad('PAYMENT_METHOD_NOT_READY', 409);
        if (['BANK', 'QRIS'].includes(p.method) && (p.manual_confirmed !== true || p.confirmation_mode !== 'MANUAL'))
          bad('PAYMENT_CONFIRMATION_REQUIRED', 409);
        const parsed = { method: p.method, amount: amount(p.amount, true), account: ['CREDIT','DOMPET_SANTRI'].includes(p.method) ? null : uuid(p.account_id),
          tender: p.method === 'CASH' ? amount(p.tendered) : null,
          reference: ['BANK', 'QRIS'].includes(p.method) ? text(p.reference) : null,
          confirmation: ['BANK', 'QRIS'].includes(p.method) ? 'MANUAL' : null };
        if(p.method==='DOMPET_SANTRI') {const f=wallet.input(p);parsed.wallet={type:f.type,hash:f.hash,unit:f.unit};Object.defineProperty(parsed,'scan',{value:f.credential});}
        return parsed;
      });
      if (new Set(payments.map(p => p.method)).size !== payments.length) bad('DUPLICATE_PAYMENT_METHOD');
      const discount=amount(b.discount || 0);
      const f = { items, payments, discount, reason: discount > 0n ? text(b.discount_reason, 500) : null,
        party: b.customer_id ? uuid(b.customer_id) : null, due: payments.some(p => p.method === 'CREDIT') ? dueDate(b.due_date) : null,
        shift: b.shift_id ? uuid(b.shift_id) : null, channel: online ? 'ONLINE' : 'POS' };
      if(b.price_level_id)f.price_level_id=uuid(b.price_level_id);
      if(b.packages?.length)f.packages=b.packages.map(p=>({promotion_id:uuid(p.promotion_id),quantity:amount(p.quantity,true)})).sort((x,y)=>x.promotion_id.localeCompare(y.promotion_id));
      if (!online && !f.shift) bad('INVALID_ID');
      if (online && payments.some(p=>p.method==='DOMPET_SANTRI')) bad('ONLINE_WALLET_NOT_AUTHORIZED',403);
      const op = await beginOperation(c, a, b, 'SALE', f); if (op.replay) return receiptData(c, a, op.id, true);
      const s = f.shift ? await shiftRow(c, a, f.shift) : null;
      if (s && s.status !== 'OPEN') bad('SHIFT_NOT_OPEN', 409);
      const wp=payments.find(p=>p.method==='DOMPET_SANTRI');
      if(wp)wp.account=await wallet.clearing(c,a);
      for (const p of payments.filter(p => p.account).sort((x, y) => x.account.localeCompare(y.account))) {
        const account = await getAccount(c, a, p.account,0n,p.method==='DOMPET_SANTRI');
        if (account.kind !== (p.method==='DOMPET_SANTRI'?'WALLET_CLEARING':p.method) || p.method === 'CASH' && p.account !== s?.cash_account_id) bad('PAYMENT_ACCOUNT_DENIED', 403);
      }
      const pricingEnabled=await pricing.available(c);
      const quote=!online&&pricingEnabled?await pricing.quoteWork(c,a,b):null;
      if(!pricingEnabled&&(b.price_level_id||b.items.some(i=>i.price_level_id)||b.packages?.length))bad('PRICING_MIGRATION_REQUIRED',503);
      if(quote)items.splice(0,items.length,...quote.lines.map(i=>({product:i.product_id,quantity:BigInt(i.quantity),quoted:i})));
      let subtotal = 0n;
      for (const i of items) {
        i.p = await getProduct(c, a, i.product); if (!i.p.sellable) bad('PRODUCT_NOT_SELLABLE', 403);
        if(online){const snapshot=online.find(l=>l.product_id===i.product);if(!snapshot||BigInt(snapshot.quantity)!==i.quantity)bad('ONLINE_ITEM_MISMATCH');
          i.p={...i.p,name:snapshot.name,sku:snapshot.sku,selling_price:snapshot.unit_price};}
        if(i.quoted)i.p={...i.p,selling_price:i.quoted.unit_price};
        i.gross = i.quoted?BigInt(i.quoted.total):i.quantity * BigInt(i.p.selling_price); subtotal += i.gross;
        i.cogs = await availableCost(c, a, i.product, i.quantity);
      }
      if (f.discount >= subtotal) bad('INVALID_DISCOUNT');
      if(f.discount&&quote?.protected_pricing)bad('DISCOUNT_STACKING_DENIED');
      if (f.discount && !a.member.effective_permissions.includes('SALE_DISCOUNT')) bad('DISCOUNT_DENIED', 403);
      f.total = subtotal - f.discount;
      if (payments.reduce((sum, p) => sum + p.amount, 0n) !== f.total) bad('PAYMENT_TOTAL_MISMATCH');
      const credit = payments.find(p => p.method === 'CREDIT')?.amount || 0n;
      if (credit && !f.party) bad('REGISTERED_CREDIT_CUSTOMER_REQUIRED', 403);
      if (f.party) {
        const customer = (await c.query(`SELECT * FROM pos_business_parties WHERE id=$1 AND business_id=$2 AND kind='CUSTOMER' AND active FOR UPDATE`, [f.party, a.business])).rows[0];
        if (!customer) bad('CUSTOMER_DENIED', 403);
        const debt = BigInt((await c.query(`SELECT coalesce(sum(amount),0) amount FROM pos_debt_movements WHERE business_id=$1 AND party_id=$2 AND kind='AR'`, [a.business, f.party])).rows[0].amount);
        if (credit && (!customer.credit_allowed || credit + debt > BigInt(customer.credit_limit))) bad('CREDIT_LIMIT_DENIED', 403);
      }
      f.paid = f.total - credit;
      const brand = { receipt: a.member.receipt_prefix + '-' + op.id, name: a.member.receipt_name || a.member.display_name,
        logo: a.member.receipt_logo ? a.member.logo_url : null, header: a.member.receipt_header, footer: a.member.receipt_footer,
        address: a.member.address, phone: a.member.phone, timezone: a.member.timezone, currency: a.member.currency,
        cashier_id: a.user, cashier_name: a.userName, powered_by: 'KlikPesantren' };
      if(quote)brand.pricing={level:quote.level,offers:quote.offers,promotion_discount:quote.discount,manual_discount:String(f.discount)};
      f.snapshot = brand;
      await insertOperation(c, a, op, 'SALE', f);
      let allocated = 0n, cumulative = 0n;
      for (const i of items) {
        cumulative += i.gross; const next = f.discount * cumulative / subtotal, discount = next - allocated; allocated = next;
        const lineDiscount=discount+(i.quoted?BigInt(i.quoted.discount):0n);
        await c.query(`INSERT INTO pos_business_lines(id,business_id,operation_id,product_id,sku,name,quantity,unit_price,discount,total,cogs${pricingEnabled?',pricing_snapshot,uom_snapshot':''})
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11${pricingEnabled?',$12,$13':''})`, [makeId(), a.business, op.id, i.p.id, i.p.sku, i.p.name, i.quantity.toString(), i.p.selling_price, lineDiscount.toString(), (i.gross - discount).toString(), i.cogs.toString(),...(pricingEnabled?[i.quoted?serialize({...i.quoted.pricing_snapshot,manual_discount:String(discount)}):null,i.p.uom]:[])]);
        const movement = makeId(); await stockRow(c, a, op.id, i.p.id, movement, -i.quantity, i.cogs, 'SALE_OUT');
        if (await consume(c, a, i.p.id, i.quantity, movement) !== i.cogs) bad('COST_MISMATCH', 409);
      }
      await afterStage('stock');
      for (const p of payments) {
        if (p.method === 'CASH' && p.tender < p.amount) bad('INSUFFICIENT_TENDER');
        const paymentId=makeId();
        if(p.method==='DOMPET_SANTRI') {
          const {w}=await wallet.resolve(c,a,{...p.wallet,credential:p.scan});
          p.resolvedWallet=w;
        }
        const values=[paymentId,a.business,op.id,p.method,p.amount.toString(),p.account,p.tender?.toString()||null,
          p.method==='CASH'?(p.tender-p.amount).toString():null,p.reference];
        if(p.wallet)values.push(p.wallet.type,p.wallet.hash);
        await c.query(`INSERT INTO pos_business_payments(id,business_id,operation_id,method,amount,account_id,tendered,change,reference${p.wallet?',credential_method,credential_ref_hash':''})
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9${p.wallet?',$10,$11':''})`,values);
        if(p.resolvedWallet)await wallet.movement(c,a,p.resolvedWallet,p.amount,'debit',op.id,paymentId);
        if (p.account) await moneyRow(c, a, op.id, p.account, p.amount);
      }
      await debtRow(c, a, op.id, f, 'AR', credit, op.id);
      await afterStage('money');
      return { ...(await receiptData(c, a, op.id)), branding: brand };
  }
  async function receiptData(c, a, id, replay = false) {
    const op = (await c.query(`SELECT o.id,o.kind,o.total,o.paid,o.party_id,o.created_at,o.channel,o.receipt_snapshot,p.name customer_name
      FROM pos_business_operations o LEFT JOIN pos_business_parties p ON p.id=o.party_id AND p.business_id=o.business_id
      WHERE o.id=$1 AND o.business_id=$2 AND o.kind='SALE'`, [id, a.business])).rows[0];
    if (!op) bad('SALE_NOT_FOUND', 404);
    const lines = (await c.query(`SELECT product_id,sku,name,quantity,unit_price,discount,total,to_jsonb(l)->'pricing_snapshot' pricing_snapshot,to_jsonb(l)->>'uom_snapshot' uom FROM pos_business_lines l WHERE operation_id=$1 AND business_id=$2 ORDER BY product_id`, [id, a.business])).rows;
    const payments = (await c.query(`SELECT method,CASE WHEN method='DOMPET_SANTRI' THEN 'Dompet Santri' ELSE method END AS label,
      amount,tendered,change,reference,to_jsonb(p)->>'credential_method' AS credential_method FROM pos_business_payments p WHERE operation_id=$1 AND business_id=$2 ORDER BY method`, [id, a.business])).rows;
    return { sale: op, items: lines, payments, replay };
  }
  async function receipt(req) { return run(req, 'SALE_VIEW', (c, a) => receiptData(c, a, uuid(req.params.operationId))); }
  async function report(req) {
    return read(req, null, async (c, a) => {
      const canSales = a.member.effective_permissions.includes('REPORT_SALES');
      const canProfit = a.member.effective_permissions.includes('REPORT_PROFIT');
      const canFinance = a.member.effective_permissions.includes('REPORT_FINANCE');
      const canInventory=a.member.effective_permissions.includes('REPORT_INVENTORY');
      const canCustomer=a.member.effective_permissions.includes('REPORT_CUSTOMER');
      if (!canSales && !canProfit && !canFinance && !canInventory && !canCustomer) bad('MERCHANT_PERMISSION_DENIED', 403);
      const {from,to}=await finance.range(c,a,req.query);
      const v = [a.business, from, to, a.member.timezone];
      const where = `o.business_id=$1 AND o.effective_date BETWEEN $2::date AND $3::date AND $4::text IS NOT NULL`;
      const k = (await c.query(`SELECT coalesce(sum(o.total) FILTER(WHERE o.kind='SALE'),0) sales,
        coalesce(sum(o.total) FILTER(WHERE o.kind='SALE_RETURN'),0) returns,
        coalesce(sum(o.total) FILTER(WHERE o.kind='SALE' AND o.channel='POS'),0)-coalesce(sum(o.total) FILTER(WHERE o.kind='SALE_RETURN' AND o.channel='POS'),0) pos_net_sales,
        coalesce(sum(o.total) FILTER(WHERE o.kind='SALE' AND o.channel='ONLINE'),0)-coalesce(sum(o.total) FILTER(WHERE o.kind='SALE_RETURN' AND o.channel='ONLINE'),0) online_net_sales,
        coalesce(sum(o.total-o.paid) FILTER(WHERE o.kind='SALE_RETURN'),0) returned_receivable,
        count(*) FILTER(WHERE o.kind='SALE') sales_count,coalesce(sum(CASE WHEN o.kind='EXPENSE' THEN o.total WHEN o.kind='MONEY_REVERSAL' AND o.receipt_snapshot->>'original_kind'='EXPENSE' THEN -o.total ELSE 0 END),0) expenses,
        coalesce(sum(CASE WHEN o.kind='OTHER_INCOME' THEN o.total WHEN o.kind='MONEY_REVERSAL' AND o.receipt_snapshot->>'original_kind'='OTHER_INCOME' THEN -o.total ELSE 0 END),0) other_income,
        coalesce(sum(o.total) FILTER(WHERE o.kind='CAPITAL'),0) capital,
        coalesce(sum(o.total) FILTER(WHERE o.kind='WITHDRAWAL'),0) withdrawals FROM pos_business_dated_operations o WHERE ${where}`, v)).rows[0];
      k.cogs = (await c.query(`SELECT coalesce(sum(CASE WHEN o.kind='SALE_RETURN' THEN -l.cogs ELSE l.cogs END),0) cogs FROM pos_business_lines l JOIN pos_business_dated_operations o ON o.id=l.operation_id AND o.business_id=l.business_id WHERE ${where} AND o.kind IN('SALE','SALE_RETURN')`, v)).rows[0].cogs;
      const lt=(await c.query(`SELECT coalesce(sum(coalesce((l.pricing_snapshot->>'commercial_gross')::numeric,l.quantity*l.unit_price)) FILTER(WHERE o.kind='SALE'),0)::text gross_before_discount,coalesce(sum(coalesce((l.pricing_snapshot->>'commercial_discount')::numeric+(l.pricing_snapshot->>'manual_discount')::numeric,l.discount)) FILTER(WHERE o.kind='SALE'),0)::text discounts FROM pos_business_lines l JOIN pos_business_dated_operations o ON o.id=l.operation_id AND o.business_id=l.business_id WHERE ${where}`,v)).rows[0];
      Object.assign(k,lt);
      k.stock_loss=(await c.query(`SELECT coalesce(sum(m.cost),0)::text value FROM pos_inventory_movements m JOIN pos_business_dated_operations o ON o.id=m.operation_id AND o.business_id=m.business_id WHERE ${where} AND m.kind='DAMAGE'`,v)).rows[0].value;
      k.net_sales = (BigInt(k.sales)-BigInt(k.returns)).toString();
      k.gross_profit = (BigInt(k.net_sales) - BigInt(k.cogs)).toString();
      k.operating_result = (BigInt(k.gross_profit) + BigInt(k.other_income) - BigInt(k.expenses) - BigInt(k.stock_loss)).toString();
      k.average_sale = k.sales_count === '0' ? '0' : (BigInt(k.sales) / BigInt(k.sales_count)).toString();
      const paymentMethods = canSales ? (await c.query(`SELECT p.method,sum(p.amount) sale_amount FROM pos_business_payments p
        JOIN pos_business_dated_operations o ON o.id=p.operation_id AND o.business_id=p.business_id
        WHERE ${where} AND o.kind='SALE' GROUP BY p.method ORDER BY p.method`,v)).rows : [];
      const refundsByAccount = canSales ? (await c.query(`SELECT ac.kind,-sum(m.amount) refunded_amount FROM pos_money_movements m
        JOIN pos_business_dated_operations o ON o.id=m.operation_id AND o.business_id=m.business_id
        JOIN pos_business_accounts ac ON ac.id=m.account_id AND ac.business_id=m.business_id
        WHERE ${where} AND o.kind='SALE_RETURN' GROUP BY ac.kind ORDER BY ac.kind`,v)).rows : [];
      const salesProducts = canSales ? (await c.query(`SELECT l.product_id,max(l.sku) sku,max(l.name) name,max(l.uom_snapshot) uom,
        coalesce(p.category,'Tanpa kategori') category,
        coalesce(sum(l.quantity) FILTER(WHERE o.kind='SALE'),0) gross_quantity,
        coalesce(sum(l.quantity) FILTER(WHERE o.kind='SALE_RETURN'),0) returned_quantity,
        coalesce(sum(l.total) FILTER(WHERE o.kind='SALE'),0) gross_revenue,
        coalesce(sum(l.total) FILTER(WHERE o.kind='SALE_RETURN'),0) returned_revenue
        FROM pos_business_lines l JOIN pos_business_dated_operations o ON o.id=l.operation_id AND o.business_id=l.business_id
        LEFT JOIN pos_business_products p ON p.id=l.product_id AND p.business_id=l.business_id
        WHERE ${where} AND o.kind IN('SALE','SALE_RETURN') GROUP BY l.product_id,p.category ORDER BY l.product_id`,v)).rows.map(row=>({
          ...row,net_quantity:(BigInt(row.gross_quantity)-BigInt(row.returned_quantity)).toString(),
          net_revenue:(BigInt(row.gross_revenue)-BigInt(row.returned_revenue)).toString()
        })) : [];
      const categories = canSales ? [...salesProducts.reduce((map,row)=>{
        const old=map.get(row.category)||{category:row.category,gross_quantity:0n,returned_quantity:0n,gross_revenue:0n,returned_revenue:0n};
        for(const key of ['gross_quantity','returned_quantity','gross_revenue','returned_revenue'])old[key]+=BigInt(row[key]);
        map.set(row.category,old);return map;
      },new Map()).values()].map(row=>({category:row.category,...Object.fromEntries(['gross_quantity','returned_quantity','gross_revenue','returned_revenue'].map(key=>[key,row[key].toString()])),
        net_quantity:(row.gross_quantity-row.returned_quantity).toString(),net_revenue:(row.gross_revenue-row.returned_revenue).toString()})) : [];
      const channels = canSales ? (await c.query(`SELECT channel,
        coalesce(sum(total) FILTER(WHERE kind='SALE'),0) gross_sales,
        coalesce(sum(total) FILTER(WHERE kind='SALE_RETURN'),0) returns,
        count(*) FILTER(WHERE kind='SALE') transactions
        FROM pos_business_dated_operations o WHERE ${where} AND kind IN('SALE','SALE_RETURN') GROUP BY channel ORDER BY channel`,v)).rows.map(row=>({
          ...row,net_sales:(BigInt(row.gross_sales)-BigInt(row.returns)).toString()
        })) : [];
      const dailySales = canSales ? (await c.query(`SELECT to_char(series.day_value,'YYYY-MM-DD') AS "day",
        coalesce(sum(CASE WHEN o.kind='SALE' THEN o.total WHEN o.kind='SALE_RETURN' THEN -o.total ELSE 0 END),0) net_sales,
        count(o.id) FILTER(WHERE o.kind='SALE') transactions
        FROM generate_series($2::date,$3::date,'1 day'::interval) AS series(day_value)
        LEFT JOIN pos_business_dated_operations o ON o.business_id=$1
          AND o.effective_date=series.day_value::date AND $4::text IS NOT NULL
          AND o.kind IN('SALE','SALE_RETURN')
        GROUP BY series.day_value ORDER BY series.day_value`,v)).rows : [];
      const cashiers = canSales ? (await c.query(`SELECT o.actor_id,u.name,
        coalesce(sum(o.total) FILTER(WHERE o.kind='SALE'),0) gross_sales,
        coalesce(sum(o.total) FILTER(WHERE o.kind='SALE_RETURN'),0) returns,
        count(*) FILTER(WHERE o.kind='SALE') transactions
        FROM pos_business_dated_operations o JOIN pos_merchant_users u ON u.id=o.actor_id
        WHERE ${where} AND o.kind IN('SALE','SALE_RETURN') GROUP BY o.actor_id,u.name ORDER BY u.name,o.actor_id`,v)).rows.map(row=>({
          ...row,net_sales:(BigInt(row.gross_sales)-BigInt(row.returns)).toString()
        })) : [];
      let walletRefunds=0n;
      const hasWallet=(await c.query("SELECT to_regclass('public.pos_business_wallet_links') present")).rows[0].present;
      if(canSales&&hasWallet)walletRefunds=BigInt((await c.query(`SELECT coalesce(sum(l.amount),0) value
        FROM pos_business_wallet_links l JOIN pos_business_dated_operations o ON o.id=l.operation_id AND o.business_id=l.business_id
        WHERE ${where} AND l.direction='credit'`,v)).rows[0].value);
      const creditRefunds=canSales?BigInt((await c.query(`SELECT coalesce(-sum(d.amount),0) value FROM pos_debt_movements d
        JOIN pos_business_dated_operations o ON o.id=d.operation_id AND o.business_id=d.business_id
        WHERE ${where} AND o.kind='SALE_RETURN' AND d.kind='AR' AND d.amount<0`,v)).rows[0].value):0n;
      const refundMap=new Map(refundsByAccount.map(row=>[row.kind,BigInt(row.refunded_amount)]));
      if(walletRefunds)refundMap.set('DOMPET_SANTRI',walletRefunds);
      if(creditRefunds)refundMap.set('CREDIT',creditRefunds);
      const paymentBreakdown=canSales?[...new Set([...paymentMethods.map(row=>row.method),...refundMap.keys()])].sort().map(method=>{
        const gross=BigInt(paymentMethods.find(row=>row.method===method)?.sale_amount||0),refunded=refundMap.get(method)||0n;
        return {method,gross_amount:gross.toString(),refunded_amount:refunded.toString(),net_amount:(gross-refunded).toString()};
      }):[];
      const canCosts=a.member.effective_permissions.includes('PRODUCT_COST_VIEW');
      const hasReservations=(await c.query("SELECT to_regclass('public.pos_online_reservations') present")).rows[0].present;
      const inventoryProducts=canInventory?(await c.query(`SELECT p.id,p.sku,p.name,p.category,p.minimum_stock,
        coalesce(sum(m.quantity) FILTER(WHERE mo.effective_date<=$2::date),0) on_hand_as_of,
        coalesce(sum(CASE WHEN m.quantity>0 THEN m.cost ELSE -m.cost END) FILTER(WHERE mo.effective_date<=$2::date),0) value_as_of,
        ${hasReservations?"coalesce((SELECT sum(r.quantity) FROM pos_online_reservations r WHERE r.business_id=p.business_id AND r.product_id=p.id AND r.state='RESERVED'),0)":"0::bigint"} reserved_current
        FROM pos_business_products p LEFT JOIN pos_inventory_movements m ON m.product_id=p.id AND m.business_id=p.business_id LEFT JOIN pos_business_dated_operations mo ON mo.id=m.operation_id AND mo.business_id=m.business_id
        WHERE p.business_id=$1 AND $3::text IS NOT NULL GROUP BY p.id ORDER BY p.name,p.id`,[a.business,to,a.member.timezone])).rows.map(row=>({
          ...row,available_current:String(row.on_hand_as_of),availability_basis:'Stock at cutoff; current reservations separate',
          ...(canCosts?{}:{value_as_of:undefined})
        })):[];
      const inventoryMovements=canInventory?(await c.query(`SELECT m.kind,sum(m.quantity) quantity,
        sum(CASE WHEN m.quantity>0 THEN m.cost ELSE -m.cost END) value_change FROM pos_inventory_movements m JOIN pos_business_dated_operations mo ON mo.id=m.operation_id AND mo.business_id=m.business_id
        WHERE m.business_id=$1 AND mo.effective_date BETWEEN $2::date AND $3::date AND $4::text IS NOT NULL GROUP BY m.kind ORDER BY m.kind`,v)).rows:[];
      const inventoryValue=canInventory&&canCosts?inventoryProducts.reduce((sum,row)=>sum+BigInt(row.value_as_of||0),0n):null;
      let financialPosition=null;
      if(canFinance){
        const accounts=await finance.balances(c,a,to);
        const debts=(await c.query(`SELECT d.kind,coalesce(sum(d.amount),0) balance FROM pos_debt_movements d JOIN pos_business_dated_operations o ON o.id=d.operation_id AND o.business_id=d.business_id
          WHERE d.business_id=$1 AND o.effective_date<=$2::date AND $3::text IS NOT NULL GROUP BY d.kind`,[a.business,to,a.member.timezone])).rows;
        const debt=kind=>BigInt(debts.find(row=>row.kind===kind)?.balance||0);
        const opening=(await c.query(`SELECT opening_equity FROM pos_business_initializations WHERE business_id=$1 AND accounting_start_date<=$2::date`,[a.business,to])).rows[0];
        const equityMoves=(await c.query(`SELECT coalesce(sum(total) FILTER(WHERE kind='CAPITAL'),0) capital,
          coalesce(sum(total) FILTER(WHERE kind='WITHDRAWAL'),0) withdrawals FROM pos_business_dated_operations o
          WHERE o.business_id=$1 AND o.effective_date<=$2::date AND $3::text IS NOT NULL`,[a.business,to,a.member.timezone])).rows[0];
        let settlement={gross_wallet_sales:'0',wallet_refunds:'0',payouts:'0',outstanding:'0',recovery:'0'};
        const hasSettlement=(await c.query("SELECT to_regclass('public.pos_wallet_settlement_payouts') present")).rows[0].present;
        if(hasWallet){
          const links=(await c.query(`SELECT coalesce(sum(l.amount) FILTER(WHERE l.direction='debit'),0) sales,
            coalesce(sum(l.amount) FILTER(WHERE l.direction='credit'),0) refunds FROM pos_business_wallet_links l
            JOIN pos_business_dated_operations o ON o.id=l.operation_id AND o.business_id=l.business_id
            WHERE l.business_id=$1 AND o.effective_date<=$2::date AND $3::text IS NOT NULL`,[a.business,to,a.member.timezone])).rows[0];
          const payoutState=hasSettlement?(await c.query(`SELECT coalesce(sum(amount),0) value,
            count(*) FILTER(WHERE merchant_account_id IS NULL)::integer missing_destination FROM pos_wallet_settlement_payouts
            WHERE business_id=$1 AND payout_date<=$2::date`,[a.business,to])).rows[0]:'0';
          const payouts=typeof payoutState==='string'?payoutState:payoutState.value,missingDestination=typeof payoutState==='string'?0:payoutState.missing_destination;
          const net=BigInt(links.sales)-BigInt(links.refunds),paid=BigInt(payouts);
          settlement={gross_wallet_sales:links.sales,wallet_refunds:links.refunds,payouts,missing_destination_payouts:missingDestination,
            outstanding:(net>paid?net-paid:0n).toString(),recovery:(paid>net?paid-net:0n).toString()};
        }
        const physicalAccounts=accounts.filter(row=>['CASH','BANK'].includes(row.kind));
        const qrisPending=accounts.filter(row=>row.kind==='QRIS').reduce((sum,row)=>sum+BigInt(row.balance),0n);
        const cashBank=physicalAccounts.reduce((sum,row)=>sum+BigInt(row.balance),0n),ar=debt('AR'),ap=debt('AP');
        const stock=inventoryValue===null?0n:inventoryValue,settlementReceivable=BigInt(settlement.outstanding),settlementRecovery=BigInt(settlement.recovery);
        const assets=cashBank+qrisPending+stock+ar+settlementReceivable,liabilities=ap+settlementRecovery,equity=assets-liabilities;
        const openingEquity=BigInt(opening?.opening_equity||0),capital=BigInt(equityMoves.capital),withdrawals=BigInt(equityMoves.withdrawals);
        financialPosition={as_of:to,accounts,physical_account_total:cashBank.toString(),qris_pending:String(qrisPending),cash:String(accounts.filter(x=>x.kind==='CASH').reduce((s,x)=>s+BigInt(x.balance),0n)),bank:String(accounts.filter(x=>x.kind==='BANK').reduce((s,x)=>s+BigInt(x.balance),0n)),inventory_value:inventoryValue?.toString(),
          receivables:ar.toString(),payables:ap.toString(),settlement,assets:inventoryValue===null?null:assets.toString(),liabilities:liabilities.toString(),
          equity_derived:inventoryValue===null?null:equity.toString(),opening_equity:openingEquity.toString(),subsequent_capital:capital.toString(),withdrawals:withdrawals.toString(),
          retained_result_derived:inventoryValue===null?null:(equity-openingEquity-capital+withdrawals).toString(),equation_balanced:assets===liabilities+equity,equation_is_derived:true,
          complete:Number(settlement.missing_destination_payouts||0)===0&&inventoryValue!==null,
          exclusions:['Aset tetap, pinjaman, pajak, depresiasi dan kewajiban di luar ledger belum tercakup.',...(Number(settlement.missing_destination_payouts||0)>0?['Legacy settlement payouts without merchant destination account are excluded from physical account balances.']:[]),
            ...(inventoryValue===null?['Inventory valuation is hidden without product-cost permission.']:[])],
          label:'Posisi keuangan operasional terpantau; bukan laporan akuntansi statutory.'};
      }
      const topCustomers=canCustomer?(await c.query(`SELECT p.id,p.name,count(*) FILTER(WHERE o.kind='SALE') transaction_count,sum(CASE WHEN o.kind='SALE' THEN o.total ELSE -o.total END)::text net_spend FROM pos_business_dated_operations o JOIN pos_business_parties p ON p.id=o.party_id AND p.business_id=o.business_id WHERE ${where} AND o.kind IN('SALE','SALE_RETURN') AND p.kind='CUSTOMER' GROUP BY p.id ORDER BY sum(CASE WHEN o.kind='SALE' THEN o.total ELSE -o.total END) DESC,p.id LIMIT 20`,v)).rows:undefined;
      const chart=canSales?await finance.chart(c,a,{from,to},req.query):undefined;
      const pnl=canProfit?{net_revenue:k.net_sales,cogs:k.cogs,gross_profit:k.gross_profit,...(canFinance?{operating_expenses:k.expenses,other_operating_income:k.other_income,stock_loss:k.stock_loss,operating_result:k.operating_result}:{}),label:'Hasil Usaha Operasional; belum mencakup pajak, depresiasi, amortisasi dan bunga yang belum dicatat.'}:undefined;
      if(!canSales)for(const key of ['sales','returns','net_sales','pos_net_sales','online_net_sales','returned_receivable','sales_count','average_sale','gross_before_discount','discounts'])delete k[key];
      if(!canProfit)for(const key of ['cogs','gross_profit','stock_loss','operating_result'])delete k[key];
      if(!canFinance)for(const key of ['expenses','other_income','capital','withdrawals','operating_result'])delete k[key];
      return { from, to, timezone: a.member.timezone, kpi: k,top_customers:topCustomers,chart,
        payment_methods: paymentMethods, refunds_by_account_kind: refundsByAccount,
        sales:canSales?{products:salesProducts.sort((x,y)=>BigInt(y.net_quantity)>BigInt(x.net_quantity)?1:BigInt(y.net_quantity)<BigInt(x.net_quantity)?-1:x.product_id.localeCompare(y.product_id)),categories,channels,cashiers,daily:dailySales,payment_methods:paymentBreakdown,
          category_basis:'Category is read from the current product master; historical category snapshots are not stored.'}:undefined,
        profit_loss:pnl,
        financial_position:financialPosition,
        inventory:canInventory?{as_of:to,products:inventoryProducts,movements:canCosts?inventoryMovements:inventoryMovements.map(({value_change,...row})=>row),valuation:inventoryValue?.toString(),
          valuation_visible:canCosts,low_stock:inventoryProducts.filter(row=>BigInt(row.available_current)<=BigInt(row.minimum_stock)).length}:undefined,
        formula: 'Gross before discount minus discounts minus returns equals net sales; operating result deducts DAMAGE. Period posted sales minus period posted returns minus net FIFO COGS; operating result adds classified other income and subtracts operating expenses. Capital/prive excluded. Not net profit. Average gross sale rounded down in Rupiah.',
        completeness: 'Wallet clearing is unsettled, not physical cash. Destination-attributed settlement payouts increase the selected merchant cash/bank account once and never create revenue. ONLINE merchandise is posted once; shipping is separately classified other income/expense, not merchandise or COGS.' };
    });
  }
  const wallet=require('./posBusinessWallet').createBusinessWallet({run,bad,amount,uuid,makeId,featureEnabled,afterStage});
  const returns = require('./posBusinessReturns').createBusinessReturns({run,bad,uuid,amount,text,makeId,lock,beginOperation,
    insertOperation,moneyRow,debtRow,stockRow,addLayer,getAccount,afterStage,shiftRow,wallet});
  const metrics = require('./posBusinessMetrics').createBusinessMetrics({run:read,bad,dueDate});
  const online=require('./posBusinessOnline').createBusinessOnline({transaction,run,bad,uuid,amount,text,makeId,hash,serialize,lock,
    getProduct,getAccount,saleWork,returns,beginOperation,insertOperation,moneyRow,afterStage,
    permitted:(access,key)=>merchantPermissions.has(access.member,key)});
  const workspace=require('./posBusinessWorkspace').createBusinessWorkspace({run,bad,uuid,amount,text,makeId,bcrypt,passwordInput,crypto,hash});
  const initialization=require('./posBusinessInitialization').createBusinessInitialization({run,bad,uuid,amount,text,makeId,hash,serialize,lock,
    insertOperation,moneyRow,debtRow,stockRow,addLayer,getProduct,availableCost,consume,accountBalance,getAccount});
  const productWorkbooks=require('./posProductWorkbookService').createPosProductWorkbookService({run,bad,makeId});
  const moneyRevisions=require('./posBusinessMoneyRevisions').createMoneyRevisions({run,read,bad,uuid,text,amount,hash,lock,beginOperation,insertOperation,moneyRow,moneyWork,getAccount,accountBalance,afterStage});
  const cashBookWorkbooks=require('./posCashBookWorkbookService').createCashBookWorkbookService({cashBook});
  const pricing=require('./posBusinessPricing').createBusinessPricing({run,bad,uuid,text,makeId,lock});
  const purchaseDetail=req=>run(req,'PURCHASE_VIEW',async(c,a)=>{
    const op=(await c.query(`SELECT o.*,p.name supplier FROM pos_business_operations o LEFT JOIN pos_business_parties p ON p.id=o.party_id AND p.business_id=o.business_id
      WHERE o.id=$1 AND o.business_id=$2 AND o.kind IN('PURCHASE','PURCHASE_RETURN')`,[uuid(req.params.operationId),a.business])).rows[0];
    if(!op)bad('PURCHASE_NOT_FOUND',404);
    const items=(await c.query(`SELECT product_id,sku,name,quantity,unit_price,discount,total,to_jsonb(l)->>'uom_snapshot' uom FROM pos_business_lines l
      WHERE operation_id=$1 AND business_id=$2 ORDER BY product_id`,[op.id,a.business])).rows;
    const outstanding=(await c.query("SELECT coalesce(sum(amount),0) outstanding FROM pos_debt_movements WHERE business_id=$1 AND source_id=$2 AND kind='AP'",[a.business,op.id])).rows[0].outstanding;
    return {invoice:{...op,status:'POSTED',outstanding,payment_status:BigInt(outstanding)>0n?'OUTSTANDING':'SETTLED'},items};
  });
  return { ...moneyRevisions,...online,...workspace,...initialization,walletPreview:wallet.preview,provisionWalletCredential:wallet.provision,revokeWalletCredential:wallet.revoke,saleReturn:returns.saleReturn,purchaseReturn:returns.purchaseReturn, ...metrics, login, activate, logout, context, member, product, authorizeProductAsset, catalog, party, account, purchase, adjustment, money, payDebt,
    ...productWorkbooks, ...cashBookWorkbooks,financeCategories:finance.categories, pricing:pricing.pricing,pricingQuote:pricing.pricingQuote,savePriceLevel:pricing.savePriceLevel,saveLevelPrice:pricing.saveLevelPrice,assignCustomerPriceLevel:pricing.assignCustomerPriceLevel,savePromotion:pricing.savePromotion,purchaseDetail,memberships, terminal, openShift, closeShift, sale, receipt, report, cashBook,books:finance.books };
}
module.exports = { createPosBusinessService, amount };
