// Merchant-owned business domain. No Admin token or client role is authority.
// Factory deliberately requires an explicit pool; importing cannot load .env.
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { productImageUrl } = require('../utils/posProductImage');
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
const grants = {
  CASHIER: ['profile.read', 'products.read', 'sale.post', 'customers.read', 'shifts.own', 'wallet.preview'],
  SUPERVISOR: ['profile.read', 'products.read', 'customers.read'],
};
const configurable = new Set(['products.manage', 'parties.manage', 'purchases.post', 'stock.adjust',
  'sale.post', 'sale.discount', 'returns.post', 'shifts.own', 'money.manage', 'debt.collect', 'reports.read', 'users.manage', 'profile.manage', 'wallet.preview', 'wallet.credentials.manage', 'store.manage', 'orders.read', 'orders.manage']);
function createPosBusinessService({ db, afterStage = async () => {}, featureEnabled = (...args)=>require('./unitFeatureService').isUnitFeatureEnabled(...args) }) {
  if (!db?.connect) throw new Error('EXPLICIT_DATABASE_REQUIRED');
  async function transaction(work) {
    const c = await db.connect();
    try { await c.query('BEGIN'); const out = await work(c); await c.query('COMMIT'); return out; }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  async function access(c, req, permission) {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers?.authorization || '');
    if (!match) bad('MERCHANT_AUTH_REQUIRED', 401);
    const user = (await c.query(`SELECT u.id,u.name FROM pos_merchant_sessions s JOIN pos_merchant_users u ON u.id=s.user_id
      WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active FOR SHARE OF u,s`, [hash(match[1])])).rows[0];
    if (!user) bad('MERCHANT_SESSION_INVALID', 401);
    const business = uuid(req.params?.businessId);
    const m = (await c.query(`SELECT m.role,m.permissions,b.* FROM pos_merchant_memberships m
      JOIN pos_businesses b ON b.id=m.business_id AND b.tenant_id=m.tenant_id JOIN tenants t ON t.id=b.tenant_id
      WHERE m.business_id=$1 AND m.user_id=$2 AND m.active AND b.active AND t.status='active' FOR SHARE OF m,b,t`, [business, user.id])).rows[0];
    if (!m) bad('MERCHANT_ACCESS_DENIED', 403);
    if (req.body?.tenant_id != null || req.query?.tenant_id != null || req.body?.role != null && permission !== 'users.manage') bad('CLIENT_AUTHORITY_REJECTED', 403);
    const allowed = m.role === 'OWNER' ? null : new Set([...(grants[m.role] || []), ...(m.role === 'SUPERVISOR' ? m.permissions : [])]);
    if (allowed && !allowed.has(permission)) bad('MERCHANT_PERMISSION_DENIED', 403);
    return { business, user: user.id, userName: user.name, member: m };
  }
  const run = (req, permission, work) => transaction(async c => work(c, await access(c, req, permission)));
  async function lock(c, key) { await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key]); }
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
  async function logout(req) {
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers?.authorization || '');
    if (!match) bad('MERCHANT_AUTH_REQUIRED', 401);
    return transaction(async c => { await c.query('DELETE FROM pos_merchant_sessions WHERE token_hash=$1', [hash(match[1])]); return { logged_out: true }; });
  }
  async function context(req) {
    return run(req, 'profile.read', async (_, a) => ({
      user_id: a.user, role: a.member.role, permissions: a.member.role === 'OWNER' ? [...configurable] : [...(grants[a.member.role] || []), ...a.member.permissions],
      business: { id: a.business, display_name: a.member.display_name, ownership: a.member.ownership, logo_url: a.member.logo_url,
        timezone: a.member.timezone, currency: a.member.currency, receipt_name: a.member.receipt_name,
        receipt_header: a.member.receipt_header, receipt_footer: a.member.receipt_footer, receipt_prefix: a.member.receipt_prefix },
    }));
  }
  async function member(req) {
    return run(req, 'users.manage', async (c, a) => {
      // Only owner can create/assign identities; configurable users.manage alone cannot escalate.
      if (a.member.role !== 'OWNER') bad('OWNER_REQUIRED', 403);
      const b = req.body, role = b.role;
      if (!['OWNER', 'SUPERVISOR', 'CASHIER'].includes(role)) bad('INVALID_ROLE');
      const permissions = b.permissions || [];
      if (!Array.isArray(permissions) || permissions.some(p => !configurable.has(p)) || role !== 'SUPERVISOR' && permissions.length) bad('INVALID_PERMISSIONS');
      const password = passwordInput(b.password, 12);
      const userId = makeId(), passwordHash = await bcrypt.hash(password, 12);
      await c.query('INSERT INTO pos_merchant_users(id,login,name,password_hash) VALUES($1,$2,$3,$4)', [userId, text(b.login, 120).toLowerCase(), text(b.name), passwordHash]);
      await c.query(`INSERT INTO pos_merchant_memberships(business_id,tenant_id,user_id,role,permissions) VALUES($1,$2,$3,$4,$5)`, [a.business, a.member.tenant_id, userId, role, permissions]);
      return { id: userId, role, name: b.name };
    });
  }
  async function product(req) {
    return run(req, 'products.manage', async (c, a) => {
      const b = req.body, image = productImageUrl(b.image_url);
      const id = makeId();
      return (await c.query(`INSERT INTO pos_business_products(id,business_id,sku,barcode,name,category,uom,image_url,selling_price,minimum_stock,online_visible)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,sku,name,selling_price`,
      [id, a.business, text(b.sku, 80), b.barcode ? text(b.barcode, 120) : null, text(b.name), b.category ? text(b.category, 120) : null,
        b.uom ? text(b.uom, 32) : 'pcs', image, amount(b.selling_price, true).toString(), amount(b.minimum_stock || 0).toString(), b.online_visible === true])).rows[0];
    });
  }
  async function catalog(req) {
    return run(req, 'products.read', async (c, a) => {
      const hasOnline=(await c.query("SELECT to_regclass('public.pos_online_reservations') present")).rows[0].present;
      if(hasOnline)await online.expireOnline(a.business);
      const products=(await c.query(`SELECT p.id,p.sku,p.barcode,p.name,p.category,p.uom,p.image_url,p.selling_price,p.minimum_stock,
      p.active,p.sellable,p.online_visible,coalesce(s.on_hand,0) on_hand FROM pos_business_products p
      LEFT JOIN(SELECT product_id,sum(quantity) on_hand FROM pos_inventory_movements WHERE business_id=$1 GROUP BY product_id)s ON s.product_id=p.id
      WHERE p.business_id=$1 ORDER BY p.name,p.id LIMIT 200`, [a.business])).rows;
      if(hasOnline){const reserved=(await c.query("SELECT product_id,sum(quantity) quantity FROM pos_online_reservations WHERE business_id=$1 AND state='RESERVED' GROUP BY product_id",[a.business])).rows;
        for(const p of products){p.reserved=reserved.find(r=>r.product_id===p.id)?.quantity||'0';p.available=(BigInt(p.on_hand)-BigInt(p.reserved)).toString();}}
      return products;
    });
  }
  async function party(req) {
    return run(req, 'parties.manage', async (c, a) => {
      const b = req.body; if (!['CUSTOMER', 'SUPPLIER'].includes(b.kind)) bad('INVALID_PARTY_KIND');
      return (await c.query(`INSERT INTO pos_business_parties(id,business_id,kind,name,phone,address,notes,credit_allowed,credit_limit,due_days,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,kind,name`,
      [makeId(), a.business, b.kind, text(b.name), b.phone ? text(b.phone, 80) : null, b.address ? text(b.address, 500) : null,
        b.notes ? text(b.notes, 1000) : null, b.kind === 'CUSTOMER' && b.credit_allowed === true, amount(b.credit_limit || 0).toString(),
        Number(amount(b.due_days || 0)), a.user])).rows[0];
    });
  }
  async function account(req) {
    return run(req, 'money.manage', async (c, a) => {
      const b = req.body;
      if (!['CASH', 'BANK', 'QRIS'].includes(b.kind)) bad('INVALID_ACCOUNT_KIND');
      return (await c.query('INSERT INTO pos_business_accounts(id,business_id,name,kind) VALUES($1,$2,$3,$4) RETURNING id,name,kind', [makeId(), a.business, text(b.name), b.kind])).rows[0];
    });
  }
  async function getAccount(c, a, id, outflow = 0n, allowClearing = false) {
    const ac = (await c.query(`SELECT id,kind FROM pos_business_accounts WHERE id=$1 AND business_id=$2 AND active FOR UPDATE`, [uuid(id), a.business])).rows[0];
    if (!ac || ac.kind === 'WALLET_CLEARING' && !allowClearing) bad('ACCOUNT_DENIED', 403);
    const balance = BigInt((await c.query('SELECT coalesce(sum(amount),0) amount FROM pos_money_movements WHERE account_id=$1 AND business_id=$2', [ac.id, a.business])).rows[0].amount);
    if (balance < outflow) bad('INSUFFICIENT_BUSINESS_FUNDS', 409);
    return ac;
  }
  async function beginOperation(c, a, b, kind, fields) {
    const request = text(b.request_id); if (request.length < 8) bad('INVALID_REQUEST_ID');
    const requestHash = hash(serialize({ actor: a.user, kind, ...fields }));
    await lock(c, 'pos-business:' + a.business + ':' + request);
    const old = (await c.query('SELECT * FROM pos_business_operations WHERE business_id=$1 AND request_id=$2', [a.business, request])).rows[0];
    if (old) { if (old.request_hash !== requestHash) bad('IDEMPOTENCY_CONFLICT', 409); return { ...old, replay: true }; }
    return { id: makeId(), request, requestHash, replay: false };
  }
  async function insertOperation(c, a, op, kind, f) {
    await c.query(`INSERT INTO pos_business_operations(id,business_id,actor_id,kind,request_id,request_hash,total,paid,party_id,due_date,reference,reason,source_id,channel,shift_id,receipt_snapshot)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [op.id, a.business, a.user, kind, op.request, op.requestHash, f.total.toString(), f.paid.toString(), f.party || null,
      f.due || null, f.reference || null, f.reason || null, f.source || null, f.channel || null, f.shift || null, f.snapshot ? serialize(f.snapshot) : null]);
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
    return run(req, 'purchases.post', async (c, a) => {
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
      for (const i of items) {
        const p = await getProduct(c, a, i.product);
        const movement = makeId();
        await c.query(`INSERT INTO pos_business_lines(id,business_id,operation_id,product_id,sku,name,quantity,unit_price,total,cogs)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0)`, [makeId(), a.business, op.id, p.id, p.sku, p.name, i.quantity.toString(), i.cost.toString(), (i.quantity * i.cost).toString()]);
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
    return run(req, 'stock.adjust', async (c, a) => {
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
    return run(req, 'money.manage', async (c, a) => {
      const b = req.body, kind = b.kind;
      if (!['OPENING', 'CAPITAL', 'WITHDRAWAL', 'EXPENSE', 'OTHER_INCOME', 'TRANSFER'].includes(kind)) bad('INVALID_MONEY_KIND');
      const f = { account: uuid(b.account_id), destination: kind === 'TRANSFER' ? uuid(b.destination_account_id) : null,
        reason: text(b.reason, 500), total: amount(b.amount, true), paid: amount(b.amount, true) };
      if (f.account === f.destination) bad('TRANSFER_SAME_ACCOUNT');
      const op = await beginOperation(c, a, b, kind, f); if (op.replay) return op;
      const negative = ['WITHDRAWAL', 'EXPENSE', 'TRANSFER'].includes(kind);
      // Stable lock order prevents opposite transfers deadlocking.
      for (const id of [f.account, f.destination].filter(Boolean).sort()) await getAccount(c, a, id, id === f.account && negative ? f.total : 0n);
      if (kind === 'OPENING' && (await c.query('SELECT 1 FROM pos_money_movements WHERE business_id=$1 AND account_id=$2 LIMIT 1', [a.business, f.account])).rowCount) bad('OPENING_ALREADY_EXISTS', 409);
      await insertOperation(c, a, op, kind, f);
      await moneyRow(c, a, op.id, f.account, negative ? -f.total : f.total);
      if (f.destination) await moneyRow(c, a, op.id, f.destination, f.total);
      return { id: op.id, replay: false };
    });
  }
  async function payDebt(req) {
    return run(req, 'debt.collect', async (c, a) => {
      const b = req.body, kind = b.kind;
      if (!['AR', 'AP'].includes(kind)) bad('INVALID_DEBT_KIND');
      const f = { source: uuid(b.source_id), account: uuid(b.account_id), total: amount(b.amount, true), paid: amount(b.amount, true) };
      const op = await beginOperation(c, a, b, kind === 'AR' ? 'AR_COLLECTION' : 'AP_PAYMENT', f); if (op.replay) return op;
      await lock(c, 'pos-source:' + a.business + ':' + f.source);
      const original = (await c.query(`SELECT id,party_id,due_date FROM pos_business_operations WHERE id=$1 AND business_id=$2 AND kind=$3`,
        [f.source, a.business, kind === 'AR' ? 'SALE' : 'PURCHASE'])).rows[0];
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
  async function books(req) {
    return run(req, 'reports.read', async (c, a) => ({
      accounts: (await c.query(`SELECT ac.id,ac.name,ac.kind,coalesce(sum(m.amount),0) balance FROM pos_business_accounts ac
        LEFT JOIN pos_money_movements m ON m.account_id=ac.id AND m.business_id=ac.business_id WHERE ac.business_id=$1 GROUP BY ac.id ORDER BY ac.name`, [a.business])).rows,
      debts: (await c.query(`SELECT d.kind,d.party_id,p.name,sum(d.amount) outstanding FROM pos_debt_movements d JOIN pos_business_parties p ON p.id=d.party_id AND p.business_id=d.business_id
        WHERE d.business_id=$1 GROUP BY d.kind,d.party_id,p.name ORDER BY p.name`, [a.business])).rows,
      stock: (await c.query(`SELECT p.id,p.name,coalesce(sum(m.quantity),0) on_hand FROM pos_business_products p
        LEFT JOIN pos_inventory_movements m ON m.product_id=p.id AND m.business_id=p.business_id WHERE p.business_id=$1 GROUP BY p.id ORDER BY p.name`, [a.business])).rows,
    }));
  }
  async function terminal(req) {
    return run(req, 'profile.manage', async (c, a) => (await c.query('INSERT INTO pos_business_terminals(id,business_id,name) VALUES($1,$2,$3) RETURNING id,name',
      [makeId(), a.business, text(req.body.name)])).rows[0]);
  }
  async function openShift(req) {
    return run(req, 'shifts.own', async (c, a) => {
      const b = req.body, ac = await getAccount(c, a, b.cash_account_id);
      if (ac.kind !== 'CASH') bad('CASH_DRAWER_REQUIRED');
      const t = (await c.query('SELECT id FROM pos_business_terminals WHERE id=$1 AND business_id=$2 AND active FOR SHARE', [uuid(b.terminal_id), a.business])).rows[0];
      if (!t) bad('TERMINAL_DENIED', 403);
      return (await c.query(`INSERT INTO pos_business_shifts(id,business_id,user_id,terminal_id,cash_account_id,opening_cash) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
        [makeId(), a.business, a.user, t.id, ac.id, amount(b.opening_cash || 0).toString()])).rows[0];
    });
  }
  async function shiftRow(c, a, id) {
    const s = (await c.query(`SELECT * FROM pos_business_shifts WHERE id=$1 AND business_id=$2 AND user_id=$3 FOR UPDATE`, [uuid(id), a.business, a.user])).rows[0];
    if (!s) bad('SHIFT_DENIED', 403); return s;
  }
  async function closeShift(req) {
    return run(req, 'shifts.own', async (c, a) => {
      const s = await shiftRow(c, a, req.body.shift_id), actual = amount(req.body.actual_cash);
      if (s.status === 'CLOSED') {
        if (BigInt(s.actual_cash) !== actual) bad('SHIFT_ALREADY_CLOSED', 409);
        return { ...s, replay: true };
      }
      const movement = BigInt((await c.query(`SELECT coalesce(sum(m.amount),0) amount FROM pos_money_movements m
        JOIN pos_business_operations o ON o.id=m.operation_id AND o.business_id=m.business_id
        WHERE o.shift_id=$1 AND o.business_id=$2 AND m.account_id=$3 AND o.kind IN('SALE','SALE_RETURN')`, [s.id, a.business, s.cash_account_id])).rows[0].amount);
      const expected = BigInt(s.opening_cash) + movement;
      return (await c.query(`UPDATE pos_business_shifts SET status='CLOSED',closed_at=now(),actual_cash=$1,expected_cash=$2,difference=$3
        WHERE id=$4 AND business_id=$5 RETURNING *`, [actual.toString(), expected.toString(), (actual - expected).toString(), s.id, a.business])).rows[0];
    });
  }
  async function sale(req) {
    return run(req, 'sale.post', async (c, a) => {
      if((await c.query("SELECT to_regclass('public.pos_online_reservations') present")).rows[0].present)await online.expireOnline(a.business);
      return saleWork(c,a,req.body);
    });
  }
  async function saleWork(c,a,b,online = null) {
      if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100 || !Array.isArray(b.payments) || !b.payments.length || b.payments.length > 5) bad('INVALID_SALE');
      // ONLINE is not accepted until reservation/order authorization integration is complete.
      if (!online && b.channel && b.channel !== 'POS') bad('CHANNEL_NOT_READY', 409);
      const items = b.items.map(i => ({ product: uuid(i.product_id), quantity: amount(i.quantity, true) })).sort((x, y) => x.product.localeCompare(y.product));
      if (new Set(items.map(i => i.product)).size !== items.length) bad('DUPLICATE_PRODUCT');
      const payments = b.payments.map(p => {
        if (!['CASH', 'BANK', 'QRIS', 'CREDIT', 'DOMPET_SANTRI'].includes(p.method)) bad('PAYMENT_METHOD_NOT_READY', 409);
        const parsed = { method: p.method, amount: amount(p.amount, true), account: ['CREDIT','DOMPET_SANTRI'].includes(p.method) ? null : uuid(p.account_id),
          tender: p.method === 'CASH' ? amount(p.tendered) : null,
          reference: ['BANK', 'QRIS'].includes(p.method) ? text(p.reference) : null };
        if(p.method==='DOMPET_SANTRI') {const f=wallet.input(p);parsed.wallet={type:f.type,hash:f.hash,unit:f.unit};Object.defineProperty(parsed,'scan',{value:f.credential});}
        return parsed;
      });
      if (new Set(payments.map(p => p.method)).size !== payments.length) bad('DUPLICATE_PAYMENT_METHOD');
      const f = { items, payments, discount: amount(b.discount || 0), reason: b.discount ? text(b.discount_reason, 500) : null,
        party: b.customer_id ? uuid(b.customer_id) : null, due: payments.some(p => p.method === 'CREDIT') ? dueDate(b.due_date) : null,
        shift: b.shift_id ? uuid(b.shift_id) : null, channel: online ? 'ONLINE' : 'POS' };
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
      let subtotal = 0n;
      for (const i of items) {
        i.p = await getProduct(c, a, i.product); if (!i.p.sellable) bad('PRODUCT_NOT_SELLABLE', 403);
        if(online){const snapshot=online.find(l=>l.product_id===i.product);if(!snapshot||BigInt(snapshot.quantity)!==i.quantity)bad('ONLINE_ITEM_MISMATCH');
          i.p={...i.p,name:snapshot.name,sku:snapshot.sku,selling_price:snapshot.unit_price};}
        i.gross = i.quantity * BigInt(i.p.selling_price); subtotal += i.gross;
        i.cogs = await availableCost(c, a, i.product, i.quantity);
      }
      if (f.discount >= subtotal) bad('INVALID_DISCOUNT');
      if (f.discount && a.member.role !== 'OWNER' && !a.member.permissions.includes('sale.discount')) bad('DISCOUNT_DENIED', 403);
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
      f.snapshot = brand;
      await insertOperation(c, a, op, 'SALE', f);
      let allocated = 0n, cumulative = 0n;
      for (const i of items) {
        cumulative += i.gross; const next = f.discount * cumulative / subtotal, discount = next - allocated; allocated = next;
        await c.query(`INSERT INTO pos_business_lines(id,business_id,operation_id,product_id,sku,name,quantity,unit_price,discount,total,cogs)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [makeId(), a.business, op.id, i.p.id, i.p.sku, i.p.name, i.quantity.toString(), i.p.selling_price, discount.toString(), (i.gross - discount).toString(), i.cogs.toString()]);
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
        if(p.wallet)values.push(p.wallet.type);
        await c.query(`INSERT INTO pos_business_payments(id,business_id,operation_id,method,amount,account_id,tendered,change,reference${p.wallet?',credential_method':''})
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9${p.wallet?',$10':''})`,values);
        if(p.resolvedWallet)await wallet.movement(c,a,p.resolvedWallet,p.amount,'debit',op.id,paymentId);
        if (p.account) await moneyRow(c, a, op.id, p.account, p.amount);
      }
      await debtRow(c, a, op.id, f, 'AR', credit, op.id);
      await afterStage('money');
      return { ...(await receiptData(c, a, op.id)), branding: brand };
  }
  async function receiptData(c, a, id, replay = false) {
    const op = (await c.query(`SELECT id,kind,total,paid,party_id,created_at,channel,receipt_snapshot FROM pos_business_operations
      WHERE id=$1 AND business_id=$2 AND kind='SALE'`, [id, a.business])).rows[0];
    if (!op) bad('SALE_NOT_FOUND', 404);
    const lines = (await c.query(`SELECT product_id,sku,name,quantity,unit_price,discount,total FROM pos_business_lines WHERE operation_id=$1 AND business_id=$2 ORDER BY product_id`, [id, a.business])).rows;
    const payments = (await c.query(`SELECT method,CASE WHEN method='DOMPET_SANTRI' THEN 'Dompet Santri' ELSE method END AS label,
      amount,tendered,change,reference,to_jsonb(p)->>'credential_method' AS credential_method FROM pos_business_payments p WHERE operation_id=$1 AND business_id=$2 ORDER BY method`, [id, a.business])).rows;
    return { sale: op, items: lines, payments, replay };
  }
  async function receipt(req) { return run(req, 'sale.post', (c, a) => receiptData(c, a, uuid(req.params.operationId))); }
  async function report(req) {
    return run(req, 'reports.read', async (c, a) => {
      let from, to;
      if (req.query.from || req.query.to) { from = dueDate(req.query.from); to = dueDate(req.query.to); }
      else {
        const period = req.query.period || 'TODAY';
        const unit = { TODAY: 'day', MONTH: 'month', YEAR: 'year' }[period]; if (!unit) bad('INVALID_PERIOD');
        const range = (await c.query(`SELECT to_char(date_trunc($1,now() AT TIME ZONE $2),'YYYY-MM-DD') AS first,
          to_char(now() AT TIME ZONE $2,'YYYY-MM-DD') AS last`, [unit, a.member.timezone])).rows[0];
        from = range.first; to = range.last;
      }
      if (from > to) bad('INVALID_PERIOD');
      const v = [a.business, from, to, a.member.timezone];
      const where = `o.business_id=$1 AND (o.created_at AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date`;
      const k = (await c.query(`SELECT coalesce(sum(total) FILTER(WHERE kind='SALE'),0) sales,
        coalesce(sum(total) FILTER(WHERE kind='SALE_RETURN'),0) returns,
        coalesce(sum(total) FILTER(WHERE kind='SALE' AND channel='POS'),0)-coalesce(sum(total) FILTER(WHERE kind='SALE_RETURN' AND channel='POS'),0) pos_net_sales,
        coalesce(sum(total) FILTER(WHERE kind='SALE' AND channel='ONLINE'),0)-coalesce(sum(total) FILTER(WHERE kind='SALE_RETURN' AND channel='ONLINE'),0) online_net_sales,
        coalesce(sum(total-paid) FILTER(WHERE kind='SALE_RETURN'),0) returned_receivable,
        count(*) FILTER(WHERE kind='SALE') sales_count,coalesce(sum(total) FILTER(WHERE kind='EXPENSE'),0) expenses,
        coalesce(sum(total) FILTER(WHERE kind='OTHER_INCOME'),0) other_income,
        coalesce(sum(total) FILTER(WHERE kind='CAPITAL'),0) capital,
        coalesce(sum(total) FILTER(WHERE kind='WITHDRAWAL'),0) withdrawals FROM pos_business_operations o WHERE ${where}`, v)).rows[0];
      k.cogs = (await c.query(`SELECT coalesce(sum(CASE WHEN o.kind='SALE_RETURN' THEN -l.cogs ELSE l.cogs END),0) cogs FROM pos_business_lines l JOIN pos_business_operations o ON o.id=l.operation_id AND o.business_id=l.business_id WHERE ${where} AND o.kind IN('SALE','SALE_RETURN')`, v)).rows[0].cogs;
      k.net_sales = (BigInt(k.sales)-BigInt(k.returns)).toString();
      k.gross_profit = (BigInt(k.net_sales) - BigInt(k.cogs)).toString();
      k.operating_result = (BigInt(k.gross_profit) + BigInt(k.other_income) - BigInt(k.expenses)).toString();
      k.average_sale = k.sales_count === '0' ? '0' : (BigInt(k.sales) / BigInt(k.sales_count)).toString();
      const paymentMethods = (await c.query(`SELECT p.method,sum(p.amount) sale_amount FROM pos_business_payments p
        JOIN pos_business_operations o ON o.id=p.operation_id AND o.business_id=p.business_id
        WHERE ${where} AND o.kind='SALE' GROUP BY p.method ORDER BY p.method`,v)).rows;
      const refundsByAccount = (await c.query(`SELECT ac.kind,-sum(m.amount) refunded_amount FROM pos_money_movements m
        JOIN pos_business_operations o ON o.id=m.operation_id AND o.business_id=m.business_id
        JOIN pos_business_accounts ac ON ac.id=m.account_id AND ac.business_id=m.business_id
        WHERE ${where} AND o.kind='SALE_RETURN' GROUP BY ac.kind ORDER BY ac.kind`,v)).rows;
      return { from, to, timezone: a.member.timezone, kpi: k,
        payment_methods: paymentMethods, refunds_by_account_kind: refundsByAccount,
        formula: 'Period posted sales minus period posted returns minus net FIFO COGS; operating result adds classified other income and subtracts operating expenses. Capital/prive excluded. Not net profit. Average gross sale rounded down in Rupiah.',
        completeness: 'Wallet clearing is unsettled, not physical cash. ONLINE merchandise is posted once; shipping is separately classified other income/expense, not merchandise or COGS.' };
    });
  }
  const wallet=require('./posBusinessWallet').createBusinessWallet({run,bad,amount,uuid,makeId,featureEnabled,afterStage});
  const returns = require('./posBusinessReturns').createBusinessReturns({run,bad,uuid,amount,text,makeId,lock,beginOperation,
    insertOperation,moneyRow,debtRow,stockRow,addLayer,getAccount,afterStage,shiftRow,wallet});
  const metrics = require('./posBusinessMetrics').createBusinessMetrics({run,bad,dueDate});
  const online=require('./posBusinessOnline').createBusinessOnline({transaction,run,bad,uuid,amount,text,makeId,hash,serialize,lock,
    getProduct,getAccount,saleWork,returns,beginOperation,insertOperation,moneyRow,afterStage});
  return { ...online,walletPreview:wallet.preview,provisionWalletCredential:wallet.provision,revokeWalletCredential:wallet.revoke,saleReturn:returns.saleReturn,purchaseReturn:returns.purchaseReturn, ...metrics, login, logout, context, member, product, catalog, party, account, purchase, adjustment, money, payDebt, books,
    terminal, openShift, closeShift, sale, receipt, report };
}
module.exports = { createPosBusinessService, amount };
