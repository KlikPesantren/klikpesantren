// Existing-business opening position. It posts canonical ledgers once and never fabricates sales/purchases.
function createBusinessInitialization({ run, bad, uuid, amount, text, makeId, hash, serialize, lock,
  insertOperation, moneyRow, debtRow, stockRow, addLayer, getProduct, availableCost, consume, accountBalance }) {
  const date = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) bad('INVALID_ACCOUNTING_START_DATE');
    return value;
  };
  const unique = (rows, key, code) => {
    if (new Set(rows.map(key)).size !== rows.length) bad(code);
    return rows;
  };
  const response = async (c, business, replay = false) => {
    const initialization = (await c.query(`SELECT id,accounting_start_date,cash_bank_total,inventory_total,
      receivable_total,payable_total,opening_equity,finalized_at FROM pos_business_initializations WHERE business_id=$1`, [business])).rows[0];
    if (!initialization) return { state: 'NOT_STARTED', finalized: false };
    const items = (await c.query(`SELECT i.kind,i.account_id,i.product_id,i.party_id,i.quantity,i.unit_cost,i.amount,i.due_date,
      coalesce(a.name,p.name,party.name) AS name FROM pos_business_initialization_items i
      LEFT JOIN pos_business_accounts a ON a.id=i.account_id AND a.business_id=i.business_id
      LEFT JOIN pos_business_products p ON p.id=i.product_id AND p.business_id=i.business_id
      LEFT JOIN pos_business_parties party ON party.id=i.party_id AND party.business_id=i.business_id
      WHERE i.business_id=$1 ORDER BY i.kind,name,i.id`, [business])).rows;
    const corrections = (await c.query(`SELECT kind,account_id,product_id,party_id,amount_delta,quantity_delta,unit_cost,reason,corrected_at
      FROM pos_business_initialization_corrections WHERE business_id=$1 ORDER BY corrected_at,id`, [business])).rows;
    return { state: 'FINALIZED', finalized: true, replay, initialization, items,
      equation: { assets: (BigInt(initialization.cash_bank_total) + BigInt(initialization.inventory_total) + BigInt(initialization.receivable_total)).toString(),
        liabilities: initialization.payable_total, equity: initialization.opening_equity, balanced: true },
      corrections, correction_policy: 'Opening position is immutable. Corrections are additive audited adjustments and never overwrite the original snapshot.' };
  };

  async function status(req) {
    return run(req, 'BUSINESS_SETTINGS_VIEW', (c, a) => response(c, a.business));
  }

  async function finalize(req) {
    return run(req, 'BUSINESS_SETTINGS_MANAGE', async (c, a) => {
      if (a.member.role !== 'OWNER') bad('OWNER_REQUIRED', 403);
      const b = req.body || {}, request = text(b.request_id);
      if (request.length < 8) bad('INVALID_REQUEST_ID');
      if (b.confirmation !== 'FINALIZE') bad('FINALIZATION_CONFIRMATION_REQUIRED');
      const startDate = date(b.accounting_start_date);
      const accounts = unique((Array.isArray(b.accounts) ? b.accounts : []).map(row => ({
        account: uuid(row.account_id), amount: amount(row.amount || 0),
      })).filter(row => row.amount > 0n).sort((x, y) => x.account.localeCompare(y.account)), row => row.account, 'DUPLICATE_ACCOUNT');
      const inventory = unique((Array.isArray(b.inventory) ? b.inventory : []).map(row => ({
        product: uuid(row.product_id), quantity: amount(row.quantity || 0), unitCost: amount(row.unit_cost || 0),
      })).filter(row => row.quantity > 0n).sort((x, y) => x.product.localeCompare(y.product)), row => row.product, 'DUPLICATE_PRODUCT');
      const normalizeDebts = rows => rows.map(row => ({ party: row.party_id, amount: amount(row.amount || 0), due: row.due_date }))
        .filter(row => row.amount > 0n).map(row => ({ party: uuid(row.party), amount: row.amount, due: date(row.due) }));
      const receivables = unique(normalizeDebts(Array.isArray(b.receivables) ? b.receivables : []).sort((x, y) => x.party.localeCompare(y.party)), row => row.party, 'DUPLICATE_CUSTOMER');
      const payables = unique(normalizeDebts(Array.isArray(b.payables) ? b.payables : []).sort((x, y) => x.party.localeCompare(y.party)), row => row.party, 'DUPLICATE_SUPPLIER');
      if (accounts.length + inventory.length + receivables.length + payables.length > 500) bad('INITIALIZATION_TOO_LARGE');
      const normalized = { actor: a.user, startDate, accounts, inventory, receivables, payables };
      const requestHash = hash(serialize(normalized));
      await lock(c, `pos-initialization:${a.business}`);
      const old = (await c.query('SELECT request_id,request_hash FROM pos_business_initializations WHERE business_id=$1 FOR UPDATE', [a.business])).rows[0];
      if (old) {
        if (old.request_id !== request || old.request_hash !== requestHash) bad('INITIALIZATION_FINALIZED', 409);
        return response(c, a.business, true);
      }
      const business = (await c.query('SELECT accounting_start_date,timezone FROM pos_businesses WHERE id=$1 FOR UPDATE', [a.business])).rows[0];
      const today = (await c.query("SELECT to_char(now() AT TIME ZONE $1,'YYYY-MM-DD') today", [business.timezone])).rows[0].today;
      if (startDate > today) bad('ACCOUNTING_START_DATE_IN_FUTURE');
      if (business.accounting_start_date && String(business.accounting_start_date).slice(0, 10) !== startDate) bad('ACCOUNTING_START_DATE_LOCKED', 409);
      const activity = (await c.query(`SELECT
        (SELECT count(*) FROM pos_business_operations WHERE business_id=$1) operations,
        (SELECT count(*) FROM pos_money_movements WHERE business_id=$1) money,
        (SELECT count(*) FROM pos_debt_movements WHERE business_id=$1) debt,
        (SELECT count(*) FROM pos_inventory_movements WHERE business_id=$1) stock`, [a.business])).rows[0];
      if (Object.values(activity).some(value => BigInt(value) > 0n)) bad('BUSINESS_ACTIVITY_ALREADY_STARTED', 409);

      const initializationId = makeId();
      const cashBank = accounts.reduce((sum, row) => sum + row.amount, 0n);
      const inventoryValue = inventory.reduce((sum, row) => sum + row.quantity * row.unitCost, 0n);
      const receivable = receivables.reduce((sum, row) => sum + row.amount, 0n);
      const payable = payables.reduce((sum, row) => sum + row.amount, 0n);
      const equity = cashBank + inventoryValue + receivable - payable;
      await c.query(`INSERT INTO pos_business_initializations(id,business_id,request_id,request_hash,accounting_start_date,
        cash_bank_total,inventory_total,receivable_total,payable_total,opening_equity,finalized_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [initializationId, a.business, request, requestHash, startDate,
        cashBank.toString(), inventoryValue.toString(), receivable.toString(), payable.toString(), equity.toString(), a.user]);

      let index = 0;
      const operation = async (kind, total, suffix, party = null, due = null) => {
        const op = { id: makeId(), request: `init:${requestHash.slice(0, 32)}:${++index}:${suffix}`.slice(0, 160), requestHash: hash(serialize({ requestHash, kind, suffix })) };
        await insertOperation(c, a, op, kind, { total, paid: 0n, party, due, reason: `Posisi awal per ${startDate}`, reference: `INIT:${initializationId}` });
        return op.id;
      };
      for (const row of accounts) {
        const account = (await c.query(`SELECT id FROM pos_business_accounts WHERE id=$1 AND business_id=$2 AND active AND kind IN('CASH','BANK') FOR SHARE`, [row.account, a.business])).rows[0];
        if (!account) bad('OPENING_ACCOUNT_DENIED', 403);
        const op = await operation('OPENING', row.amount, `account:${row.account}`);
        await moneyRow(c, a, op, row.account, row.amount);
        await c.query(`INSERT INTO pos_business_initialization_items(id,initialization_id,business_id,kind,account_id,operation_id,amount)
          VALUES($1,$2,$3,'ACCOUNT',$4,$5,$6)`, [makeId(), initializationId, a.business, row.account, op, row.amount.toString()]);
      }
      for (const row of inventory) {
        await getProduct(c, a, row.product);
        const total = row.quantity * row.unitCost, op = await operation('STOCK_ADJUSTMENT', total, `inventory:${row.product}`), movement = makeId();
        await stockRow(c, a, op, row.product, movement, row.quantity, total, 'ADJUSTMENT_IN', `Stok awal per ${startDate}`);
        await addLayer(c, a, row.product, movement, row.quantity, row.unitCost);
        await c.query(`INSERT INTO pos_business_initialization_items(id,initialization_id,business_id,kind,product_id,operation_id,quantity,unit_cost,amount)
          VALUES($1,$2,$3,'INVENTORY',$4,$5,$6,$7,$8)`, [makeId(), initializationId, a.business, row.product, op, row.quantity.toString(), row.unitCost.toString(), total.toString()]);
      }
      const debts = async (rows, partyKind, debtKind, operationKind, itemKind) => {
        for (const row of rows) {
          const party = (await c.query('SELECT id FROM pos_business_parties WHERE id=$1 AND business_id=$2 AND kind=$3 AND active FOR SHARE', [row.party, a.business, partyKind])).rows[0];
          if (!party) bad(`${partyKind}_DENIED`, 403);
          const op = await operation(operationKind, row.amount, `${debtKind.toLowerCase()}:${row.party}`, row.party, row.due);
          await debtRow(c, a, op, { party: row.party, due: row.due }, debtKind, row.amount, op);
          await c.query(`INSERT INTO pos_business_initialization_items(id,initialization_id,business_id,kind,party_id,operation_id,amount,due_date)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [makeId(), initializationId, a.business, itemKind, row.party, op, row.amount.toString(), row.due]);
        }
      };
      await debts(receivables, 'CUSTOMER', 'AR', 'OPENING_AR', 'RECEIVABLE');
      await debts(payables, 'SUPPLIER', 'AP', 'OPENING_AP', 'PAYABLE');
      await c.query('UPDATE pos_businesses SET accounting_start_date=COALESCE(accounting_start_date,$1) WHERE id=$2', [startDate, a.business]);
      return response(c, a.business);
    });
  }

  async function correct(req) {
    return run(req, 'BUSINESS_SETTINGS_MANAGE', async (c, a) => {
      if (a.member.role !== 'OWNER') bad('OWNER_REQUIRED', 403);
      const b = req.body || {}, request = text(b.request_id), kind = b.kind, reason = text(b.reason, 500);
      if (request.length < 8) bad('INVALID_REQUEST_ID');
      if (b.confirmation !== 'CORRECT') bad('CORRECTION_CONFIRMATION_REQUIRED');
      if (!['ACCOUNT','INVENTORY','RECEIVABLE','PAYABLE'].includes(kind)) bad('INVALID_CORRECTION_KIND');
      const signed = value => {
        if (!/^-?(0|[1-9]\d*)$/.test(String(value ?? ''))) bad('INVALID_INTEGER');
        const n = BigInt(value); if (!n || n < -9223372036854775807n || n > 9223372036854775807n) bad('INVALID_INTEGER'); return n;
      };
      const target = uuid(b.target_id), quantity = kind === 'INVENTORY' ? signed(b.quantity_delta) : null;
      const requestedAmount = kind === 'INVENTORY' ? null : signed(b.amount_delta);
      const unitCost = kind === 'INVENTORY' && quantity > 0n ? amount(b.unit_cost) : null;
      const requestHash = hash(serialize({ actor: a.user, kind, target, quantity, requestedAmount, unitCost, reason }));
      await lock(c, `pos-initialization:${a.business}`);
      const initialization = (await c.query('SELECT id FROM pos_business_initializations WHERE business_id=$1 FOR SHARE', [a.business])).rows[0];
      if (!initialization) bad('INITIALIZATION_REQUIRED', 409);
      const old = (await c.query('SELECT request_hash FROM pos_business_initialization_corrections WHERE business_id=$1 AND request_id=$2', [a.business, request])).rows[0];
      if (old) { if (old.request_hash !== requestHash) bad('IDEMPOTENCY_CONFLICT', 409); return response(c, a.business, true); }
      const itemKind = kind, item = (await c.query(`SELECT operation_id,due_date FROM pos_business_initialization_items
        WHERE business_id=$1 AND initialization_id=$2 AND kind=$3 AND coalesce(account_id,product_id,party_id)=$4 FOR SHARE`, [a.business, initialization.id, itemKind, target])).rows[0];
      if (!item) bad('OPENING_ITEM_NOT_FOUND', 404);
      let amountDelta = requestedAmount, movement = null;
      if (kind === 'ACCOUNT') {
        const balance = await accountBalance(c, a.business, target);
        if (balance + amountDelta < 0n) bad('INSUFFICIENT_BUSINESS_FUNDS', 409);
      } else if (kind === 'INVENTORY') {
        await getProduct(c, a, target); movement = makeId();
        if (quantity > 0n) amountDelta = quantity * unitCost;
        else amountDelta = -(await availableCost(c, a, target, -quantity));
      } else {
        const debtKind = kind === 'RECEIVABLE' ? 'AR' : 'AP';
        const outstanding = BigInt((await c.query('SELECT coalesce(sum(amount),0) value FROM pos_debt_movements WHERE business_id=$1 AND source_id=$2 AND kind=$3', [a.business, item.operation_id, debtKind])).rows[0].value);
        if (outstanding + amountDelta < 0n) bad('DEBT_OVERPAYMENT', 409);
      }
      const op = { id: makeId(), request: `init-correction:${hash(request).slice(0, 32)}`, requestHash };
      await insertOperation(c, a, op, 'OPENING_ADJUSTMENT', { total: amountDelta < 0n ? -amountDelta : amountDelta, paid: 0n,
        reason, reference: `INIT-CORRECTION:${initialization.id}` });
      if (kind === 'ACCOUNT') await moneyRow(c, a, op.id, target, amountDelta);
      else if (kind === 'INVENTORY') {
        await stockRow(c, a, op.id, target, movement, quantity, amountDelta < 0n ? -amountDelta : amountDelta, quantity > 0n ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT', reason);
        if (quantity > 0n) await addLayer(c, a, target, movement, quantity, unitCost);
        else if (await consume(c, a, target, -quantity, movement) !== -amountDelta) bad('COST_MISMATCH', 409);
      } else {
        const debtKind = kind === 'RECEIVABLE' ? 'AR' : 'AP';
        await debtRow(c, a, op.id, { party: target, due: item.due_date }, debtKind, amountDelta, item.operation_id);
      }
      await c.query(`INSERT INTO pos_business_initialization_corrections(id,initialization_id,business_id,request_id,request_hash,kind,
        account_id,product_id,party_id,operation_id,amount_delta,quantity_delta,unit_cost,reason,corrected_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [makeId(), initialization.id, a.business, request, requestHash, kind,
        kind === 'ACCOUNT' ? target : null, kind === 'INVENTORY' ? target : null, ['RECEIVABLE','PAYABLE'].includes(kind) ? target : null,
        op.id, amountDelta.toString(), quantity?.toString() || null, unitCost?.toString() || (kind === 'INVENTORY' ? '0' : null), reason, a.user]);
      return response(c, a.business);
    });
  }

  return { initializationStatus: status, finalizeInitialization: finalize, correctInitialization: correct };
}

module.exports = { createBusinessInitialization };
