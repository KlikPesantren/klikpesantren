const { productImageUrl } = require('../utils/posProductImage');
const permissionModel = require('./posBusinessPermissions');

function createBusinessWorkspace({ run, bad, uuid, amount, text, makeId, bcrypt, passwordInput }) {
  const optional = (value, max) => value == null || String(value).trim() === '' ? null : text(String(value), max);
  const permitted = (access, permission) => permissionModel.has(access.member, permission);

  async function workspace(req) {
    return run(req, null, async (c, a) => {
      const sales = permitted(a, 'REPORT_SALES');
      const profit = permitted(a, 'REPORT_PROFIT');
      const finance = permitted(a, 'REPORT_FINANCE');
      const readiness = (await c.query(`SELECT (display_name<>'' AND timezone<>'' AND currency='IDR') profile,
        EXISTS(SELECT 1 FROM pos_business_accounts WHERE business_id=$1 AND active) account,
        EXISTS(SELECT 1 FROM pos_business_terminals WHERE business_id=$1 AND active) terminal,
        EXISTS(SELECT 1 FROM pos_business_products WHERE business_id=$1 AND active) product,
        storefront_enabled,storefront_slug FROM pos_businesses WHERE id=$1`, [a.business])).rows[0];
      const out = {
        role: a.member.role,
        permissions: a.member.effective_permissions,
        readiness,
        open_shift: (await c.query("SELECT id,terminal_id,cash_account_id,opening_cash,opened_at FROM pos_business_shifts WHERE business_id=$1 AND user_id=$2 AND status='OPEN'", [a.business, a.user])).rows[0] || null,
      };
      if (sales) {
        out.sales_today = (await c.query(`SELECT count(*) transactions,coalesce(sum(total),0) sales,
          CASE WHEN count(*)=0 THEN 0 ELSE coalesce(sum(total),0)/count(*) END average_ticket
          FROM pos_business_operations WHERE business_id=$1 AND kind='SALE'
          AND (created_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date`, [a.business, a.member.timezone])).rows[0];
        out.sales_mix = (await c.query(`SELECT coalesce(sum(total) FILTER(WHERE channel='POS'),0) pos,
          coalesce(sum(total) FILTER(WHERE channel='ONLINE'),0) online
          FROM pos_business_operations WHERE business_id=$1 AND kind='SALE'
          AND (created_at AT TIME ZONE $2)::date=(now() AT TIME ZONE $2)::date`, [a.business, a.member.timezone])).rows[0];
      }
      if (profit) {
        out.finance = (await c.query(`SELECT coalesce(sum(total) FILTER(WHERE kind='SALE'),0) sales,
          coalesce(sum(total) FILTER(WHERE kind='SALE_RETURN'),0) returns,
          coalesce(sum((SELECT coalesce(sum(cogs),0) FROM pos_business_lines l WHERE l.operation_id=o.id))
            FILTER(WHERE kind='SALE'),0) cogs,
          count(*) FILTER(WHERE kind='SALE') transactions
          FROM pos_business_operations o WHERE business_id=$1`, [a.business])).rows[0];
        out.profit = { gross_profit: (BigInt(out.finance.sales) - BigInt(out.finance.returns) - BigInt(out.finance.cogs)).toString() };
      }
      if (finance || permitted(a, 'AR_VIEW') || permitted(a, 'AP_VIEW') || permitted(a, 'INVENTORY_VIEW') || permitted(a, 'ONLINE_STORE_VIEW')) {
        out.attention = (await c.query(`SELECT
          (SELECT count(*) FROM pos_business_products p LEFT JOIN(SELECT product_id,sum(quantity) q FROM pos_inventory_movements WHERE business_id=$1 GROUP BY product_id)s ON s.product_id=p.id WHERE p.business_id=$1 AND coalesce(s.q,0)<=p.minimum_stock) low_stock,
          (SELECT count(*) FROM pos_online_orders WHERE business_id=$1 AND status IN('ORDERED','CONFIRMED','PROCESSING','READY_TO_SHIP')) online_orders,
          (SELECT coalesce(sum(amount),0) FROM pos_debt_movements WHERE business_id=$1 AND kind='AR') receivable,
          (SELECT coalesce(sum(amount),0) FROM pos_debt_movements WHERE business_id=$1 AND kind='AP') payable`, [a.business])).rows[0];
      }
      return out;
    });
  }

  async function profile(req) {
    return run(req, 'BUSINESS_SETTINGS_MANAGE', async (c, a) => {
      const b = req.body || {}, color = b.brand_color || null;
      if (color && !/^#[0-9a-f]{6}$/i.test(color)) bad('INVALID_BRAND_COLOR');
      return (await c.query(`UPDATE pos_businesses SET display_name=$1,legal_name=$2,description=$3,address=$4,phone=$5,
        logo_url=$6,banner_url=$7,brand_color=$8,receipt_name=$9,receipt_header=$10,receipt_footer=$11,receipt_logo=$12,
        receipt_prefix=$13,timezone=$14 WHERE id=$15 RETURNING id,display_name,ownership,timezone,currency`,
      [text(b.display_name), optional(b.legal_name, 160), optional(b.description, 500), optional(b.address, 1000),
        optional(b.phone, 80), productImageUrl(b.logo_url), productImageUrl(b.banner_url), color,
        optional(b.receipt_name, 160), optional(b.receipt_header, 300), optional(b.receipt_footer, 300),
        b.receipt_logo === true, text(b.receipt_prefix, 16).toUpperCase(), text(b.timezone, 80), a.business])).rows[0];
    });
  }

  async function members(req) {
    return run(req, 'USER_VIEW', async (c, a) => (await c.query(`SELECT u.id,u.login,u.name,u.active user_active,
      m.role,m.permissions,m.active membership_active,u.created_at FROM pos_merchant_memberships m
      JOIN pos_merchant_users u ON u.id=m.user_id WHERE m.business_id=$1 ORDER BY m.role,u.name`, [a.business])).rows
      .map(row => ({ ...row, permissions: permissionModel.effective(row.role, row.permissions) })));
  }

  async function updateMember(req) {
    return run(req, 'PERMISSION_MANAGE', async (c, a) => {
      if (a.member.role !== 'OWNER') bad('OWNER_REQUIRED', 403);
      const id = uuid(req.params.userId), b = req.body || {};
      if (id === a.user) bad('SELF_PERMISSION_CHANGE_DENIED', 409);
      const before = (await c.query(`SELECT m.role,m.permissions,m.active,u.name FROM pos_merchant_memberships m
        JOIN pos_merchant_users u ON u.id=m.user_id WHERE m.business_id=$1 AND m.user_id=$2 FOR UPDATE`, [a.business, id])).rows[0];
      if (!before) bad('MEMBER_NOT_FOUND', 404);
      if (before.role === 'OWNER') bad('OWNER_PROTECTED', 409);
      if (!['SUPERVISOR', 'CASHIER'].includes(b.role)) bad('INVALID_ROLE');
      const permissions = permissionModel.encodeExplicit(b.permissions || []);
      if (!permissions) bad('INVALID_PERMISSIONS');
      const row = (await c.query(`UPDATE pos_merchant_memberships SET role=$1,permissions=$2,active=$3
        WHERE business_id=$4 AND user_id=$5 RETURNING user_id,role,permissions,active`,
      [b.role, permissions, b.active !== false, a.business, id])).rows[0];
      if (b.name != null) await c.query('UPDATE pos_merchant_users SET name=$1 WHERE id=$2', [text(b.name), id]);
      const after = { role: row.role, permissions: permissionModel.effective(row.role, row.permissions), active: row.active, name: b.name == null ? before.name : text(b.name) };
      await c.query(`INSERT INTO pos_merchant_permission_audit(id,business_id,actor_id,target_user_id,action,before_state,after_state)
        VALUES($1,$2,$3,$4,'MEMBER_UPDATED',$5,$6)`,
      [makeId(), a.business, a.user, id, JSON.stringify({ ...before, permissions: permissionModel.effective(before.role, before.permissions) }), JSON.stringify(after)]);
      return { ...row, permissions: after.permissions, name: after.name };
    });
  }

  async function resetMemberCredential(req) {
    return run(req, 'USER_MANAGE', async (c, a) => {
      if (a.member.role !== 'OWNER') bad('OWNER_REQUIRED', 403);
      const id = uuid(req.params.userId);
      if (id === a.user) bad('OWNER_PROTECTED', 409);
      const target = (await c.query("SELECT m.role FROM pos_merchant_memberships m WHERE m.business_id=$1 AND m.user_id=$2 AND m.role<>'OWNER' FOR UPDATE", [a.business, id])).rows[0];
      if (!target) bad('MEMBER_NOT_FOUND', 404);
      const password = passwordInput(req.body?.password, 12);
      await c.query('UPDATE pos_merchant_users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash(password, 12), id]);
      await c.query('DELETE FROM pos_merchant_sessions WHERE user_id=$1', [id]);
      await c.query(`INSERT INTO pos_merchant_permission_audit(id,business_id,actor_id,target_user_id,action,after_state)
        VALUES($1,$2,$3,$4,'CREDENTIAL_RESET',$5)`,
      [makeId(), a.business, a.user, id, JSON.stringify({ sessions_revoked: true })]);
      return { credential_reset: true, sessions_revoked: true };
    });
  }

  async function directory(req) {
    const kind = req.query?.kind || 'CUSTOMER';
    if (!['CUSTOMER', 'SUPPLIER'].includes(kind)) bad('INVALID_PARTY_KIND');
    return run(req, kind === 'SUPPLIER' ? 'SUPPLIER_VIEW' : 'CUSTOMER_VIEW', async (c, a) => {
      const rows = (await c.query(`SELECT p.id,p.kind,p.name,p.phone,p.address,p.notes,p.active,p.credit_allowed,p.credit_limit,p.due_days,
        coalesce(d.outstanding,0) outstanding FROM pos_business_parties p
        LEFT JOIN(SELECT party_id,sum(amount) outstanding FROM pos_debt_movements WHERE business_id=$1 GROUP BY party_id)d ON d.party_id=p.id
        WHERE p.business_id=$1 AND p.kind=$2 ORDER BY p.active DESC,p.name LIMIT 300`, [a.business, kind])).rows;
      const maySeeHistory = kind === 'CUSTOMER' || permitted(a, 'PURCHASE_VIEW');
      if (!maySeeHistory || !rows.length) return rows;
      const historyKinds = kind === 'CUSTOMER' ? ['SALE', 'SALE_RETURN'] : ['PURCHASE', 'PURCHASE_RETURN'];
      const metrics = (await c.query(`SELECT party_id,
        count(*) FILTER(WHERE kind=$2) transaction_count,
        coalesce(sum(CASE WHEN kind=$2 THEN total ELSE -total END),0) total_spend,
        coalesce(sum(CASE WHEN kind=$2 AND channel='POS' THEN total WHEN kind=$3 AND channel='POS' THEN -total ELSE 0 END),0) pos_spend,
        coalesce(sum(CASE WHEN kind=$2 AND channel='ONLINE' THEN total WHEN kind=$3 AND channel='ONLINE' THEN -total ELSE 0 END),0) online_spend,
        max(created_at) FILTER(WHERE kind=$2) last_purchase
        FROM pos_business_operations WHERE business_id=$1 AND party_id IS NOT NULL AND kind=ANY($4::text[]) GROUP BY party_id`,
      [a.business, historyKinds[0], historyKinds[1], historyKinds])).rows;
      const byParty = new Map(metrics.map(row => [row.party_id, row]));
      return rows.map(row => {
        const metric = byParty.get(row.id) || { transaction_count: '0', total_spend: '0', pos_spend: '0', online_spend: '0', last_purchase: null };
        const count = BigInt(metric.transaction_count || 0);
        return { ...row, ...metric, average_ticket: count ? (BigInt(metric.total_spend) / count).toString() : '0' };
      });
    });
  }

  async function updateParty(req) {
    return run(req, null, async (c, a) => {
      const id = uuid(req.params.partyId), b = req.body || {};
      const current = (await c.query('SELECT id,kind FROM pos_business_parties WHERE id=$1 AND business_id=$2 FOR UPDATE', [id, a.business])).rows[0];
      if (!current) bad('PARTY_NOT_FOUND', 404);
      const permission = current.kind === 'CUSTOMER' ? 'CUSTOMER_MANAGE' : 'SUPPLIER_MANAGE';
      if (!permitted(a, permission)) bad('MERCHANT_PERMISSION_DENIED', 403);
      const creditAllowed = current.kind === 'CUSTOMER' && b.credit_allowed === true;
      return (await c.query(`UPDATE pos_business_parties SET name=$1,phone=$2,address=$3,notes=$4,active=$5,
        credit_allowed=$6,credit_limit=$7,due_days=$8 WHERE id=$9 AND business_id=$10
        RETURNING id,kind,name,active,credit_allowed,credit_limit,due_days`,
      [text(b.name), optional(b.phone,80), optional(b.address,500), optional(b.notes,1000), b.active !== false,
        creditAllowed, amount(creditAllowed ? b.credit_limit || 0 : 0).toString(), Number(amount(creditAllowed ? b.due_days || 0 : 0)), id, a.business])).rows[0];
    });
  }

  async function inventory(req) {
    return run(req, 'INVENTORY_VIEW', async (c, a) => {
      const costs = permitted(a, 'PRODUCT_COST_VIEW');
      const products = (await c.query(`SELECT p.*,coalesce(s.on_hand,0) on_hand,coalesce(r.reserved,0) reserved,
        coalesce(s.on_hand,0)-coalesce(r.reserved,0) available FROM pos_business_products p
        LEFT JOIN(SELECT product_id,sum(quantity) on_hand FROM pos_inventory_movements WHERE business_id=$1 GROUP BY product_id)s ON s.product_id=p.id
        LEFT JOIN(SELECT product_id,sum(quantity) reserved FROM pos_online_reservations WHERE business_id=$1 AND state='RESERVED' GROUP BY product_id)r ON r.product_id=p.id
        WHERE p.business_id=$1 ORDER BY p.name LIMIT 300`, [a.business])).rows;
      const movements = (await c.query(`SELECT m.id,m.product_id,p.name,m.quantity,m.kind,m.reason,m.created_at,
        ${costs ? 'm.cost' : 'NULL::bigint'} cost FROM pos_inventory_movements m JOIN pos_business_products p ON p.id=m.product_id
        WHERE m.business_id=$1 ORDER BY m.created_at DESC,m.id LIMIT 200`, [a.business])).rows;
      return { products, movements, cost_visible: costs };
    });
  }

  async function activity(req) {
    return run(req, 'FINANCE_TRANSACTION_VIEW', async (c, a) => (await c.query(`SELECT o.id,o.kind,o.channel,o.total,o.paid,
      o.due_date,o.reference,o.reason,o.created_at,p.name party FROM pos_business_operations o
      LEFT JOIN pos_business_parties p ON p.id=o.party_id WHERE o.business_id=$1 ORDER BY o.created_at DESC,o.id LIMIT 300`, [a.business])).rows);
  }

  async function sales(req) {
    return run(req, 'SALE_VIEW', async (c, a) => (await c.query(`SELECT o.id,o.kind,o.channel,o.total,o.paid,
      o.created_at,o.reference,p.name customer,u.name cashier FROM pos_business_operations o
      LEFT JOIN pos_business_parties p ON p.id=o.party_id AND p.business_id=o.business_id
      LEFT JOIN pos_merchant_users u ON u.id=o.actor_id
      WHERE o.business_id=$1 AND o.kind IN('SALE','SALE_RETURN')
      ORDER BY o.created_at DESC,o.id LIMIT 300`, [a.business])).rows);
  }

  async function purchases(req) {
    return run(req, 'PURCHASE_VIEW', async (c, a) => (await c.query(`SELECT o.id,o.kind,o.total,o.paid,o.due_date,
      o.reference,o.created_at,p.name supplier FROM pos_business_operations o
      LEFT JOIN pos_business_parties p ON p.id=o.party_id AND p.business_id=o.business_id
      WHERE o.business_id=$1 AND o.kind IN('PURCHASE','PURCHASE_RETURN')
      ORDER BY o.created_at DESC,o.id LIMIT 300`, [a.business])).rows);
  }

  async function shifts(req) {
    return run(req, 'SHIFT_VIEW_HISTORY', async (c, a) => (await c.query(`SELECT s.id,s.status,s.opening_cash,s.expected_cash,
      s.actual_cash,s.difference,s.opened_at,s.closed_at,t.name terminal,u.name cashier
      FROM pos_business_shifts s JOIN pos_business_terminals t ON t.id=s.terminal_id
      JOIN pos_merchant_users u ON u.id=s.user_id WHERE s.business_id=$1
      ORDER BY s.opened_at DESC,s.id LIMIT 200`, [a.business])).rows);
  }

  async function terminals(req) {
    return run(req, 'SHIFT_OPEN', async (c, a) => (await c.query(`SELECT id,name,active FROM pos_business_terminals
      WHERE business_id=$1 AND active ORDER BY name,id`, [a.business])).rows);
  }

  async function cashDrawers(req) {
    return run(req, 'SHIFT_OPEN', async (c, a) => (await c.query(`SELECT id,name FROM pos_business_accounts
      WHERE business_id=$1 AND active AND kind='CASH' ORDER BY name,id`, [a.business])).rows);
  }

  async function paymentAccounts(req) {
    return run(req, null, async (c, a) => {
      const allowed = ['PURCHASE_CREATE','AP_PAY','AR_COLLECT','EXPENSE_CREATE','OTHER_INCOME_CREATE','TRANSFER_CREATE','CAPITAL_MANAGE','PRIVE_MANAGE','ONLINE_ORDER_MANAGE']
        .some(permission => permitted(a, permission));
      if (!allowed) bad('MERCHANT_PERMISSION_DENIED', 403);
      return (await c.query(`SELECT id,name,kind FROM pos_business_accounts
        WHERE business_id=$1 AND active AND kind IN('CASH','BANK','QRIS') ORDER BY name,id`, [a.business])).rows;
    });
  }

  async function updateProduct(req) {
    return run(req, 'PRODUCT_MANAGE', async (c, a) => {
      const b = req.body || {}, id = uuid(req.params.productId);
      const row = (await c.query(`UPDATE pos_business_products SET name=$1,category=$2,uom=$3,image_url=$4,selling_price=$5,
        minimum_stock=$6,active=$7,sellable=$8 WHERE id=$9 AND business_id=$10 RETURNING id,name,selling_price`,
      [text(b.name), optional(b.category, 120), optional(b.uom, 32) || 'pcs', productImageUrl(b.image_url),
        amount(b.selling_price, true).toString(), amount(b.minimum_stock || 0).toString(), b.active !== false,
        b.sellable !== false, id, a.business])).rows[0];
      if (!row) bad('PRODUCT_NOT_FOUND', 404);
      return row;
    });
  }

  return { workspace, profile, members, updateMember, resetMemberCredential, directory, updateParty, inventory, activity,
    sales, purchases, shifts, terminals, cashDrawers, paymentAccounts, updateProduct };
}

module.exports = { createBusinessWorkspace };
