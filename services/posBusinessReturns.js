// Uses the SAME V2 transaction, membership, idempotency and ledger primitives.
function createBusinessReturns(h) {
  const { run, bad, uuid, amount, text, makeId, lock, beginOperation, insertOperation,
    moneyRow, debtRow, stockRow, addLayer, getAccount, afterStage, shiftRow } = h;
  const min = (a, b) => a < b ? a : b;
  async function post(req, purchase) {
    return run(req, 'returns.post', async (c, a) => {
      const b = req.body, kind = purchase ? 'PURCHASE_RETURN' : 'SALE_RETURN';
      if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100) bad('INVALID_ITEMS');
      const items = b.items.map(i => ({ product: uuid(i.product_id), quantity: amount(i.quantity, true) })).sort((x,y) => x.product.localeCompare(y.product));
      if (new Set(items.map(i => i.product)).size !== items.length) bad('DUPLICATE_PRODUCT');
      const f = { source: uuid(b.source_id), items, reason: text(b.reason, 500),
        reference: b.reference ? text(b.reference) : null, shift: b.shift_id ? uuid(b.shift_id) : null,
        confirmed: b.refund_confirmed === true };
      const op = await beginOperation(c, a, b, kind, f); if (op.replay) return op;
      await lock(c, 'pos-source:' + a.business + ':' + f.source);
      const source = (await c.query('SELECT * FROM pos_business_operations WHERE id=$1 AND business_id=$2 AND kind=$3',
        [f.source, a.business, purchase ? 'PURCHASE' : 'SALE'])).rows[0];
      if (!source) bad('RETURN_SOURCE_DENIED', 403);
      const accounts = (await c.query(`SELECT m.account_id,ac.kind,
        sum(m.amount)*$3::integer capacity FROM pos_money_movements m
        JOIN pos_business_operations o ON o.id=m.operation_id AND o.business_id=m.business_id
        JOIN pos_business_accounts ac ON ac.id=m.account_id AND ac.business_id=m.business_id
        WHERE m.business_id=$1 AND (o.id=$2 OR (o.source_id=$2 AND o.kind IN('AR_COLLECTION','AP_PAYMENT','SALE_RETURN','PURCHASE_RETURN')))
        GROUP BY m.account_id,ac.kind ORDER BY m.account_id`, [a.business, f.source, purchase ? -1 : 1])).rows;
      let activeShift;
      if (f.shift) { activeShift = await shiftRow(c, a, f.shift); if (activeShift.status !== 'OPEN') bad('SHIFT_NOT_OPEN',409); }
      // Same ordering as checkout: shift -> account -> product.
      for (const ac of accounts) await getAccount(c, a, ac.account_id);
      f.total = 0n;
      for (const i of items) {
        const p = (await c.query('SELECT id FROM pos_business_products WHERE id=$1 AND business_id=$2 FOR UPDATE', [i.product,a.business])).rows[0];
        if (!p) bad('PRODUCT_DENIED',403); // Archived products can legitimately be returned.
        i.original = (await c.query('SELECT * FROM pos_business_lines WHERE operation_id=$1 AND business_id=$2 AND product_id=$3', [f.source,a.business,i.product])).rows[0];
        if (!i.original) bad('RETURN_ITEM_DENIED',403);
        const returned = BigInt((await c.query(`SELECT coalesce(sum(l.quantity),0) qty FROM pos_business_lines l
          JOIN pos_business_operations o ON o.id=l.operation_id AND o.business_id=l.business_id
          WHERE o.business_id=$1 AND o.source_id=$2 AND o.kind=$3 AND l.product_id=$4`, [a.business,f.source,kind,i.product])).rows[0].qty);
        const originalQty = BigInt(i.original.quantity);
        if (returned+i.quantity>originalQty) bad('OVER_RETURN',409);
        i.total = BigInt(i.original.total)*(returned+i.quantity)/originalQty-BigInt(i.original.total)*returned/originalQty;
        f.total += i.total;
        if (purchase) {
          i.layers = (await c.query(`SELECT l.id,l.unit_cost,l.received_quantity-coalesce(x.used,0) available FROM pos_inventory_layers l
            JOIN pos_inventory_movements m ON m.id=l.movement_id AND m.business_id=l.business_id
            LEFT JOIN(SELECT layer_id,sum(quantity) used FROM pos_inventory_allocations GROUP BY layer_id)x ON x.layer_id=l.id
            WHERE m.operation_id=$1 AND l.business_id=$2 AND l.product_id=$3 ORDER BY l.created_at,l.id`, [f.source,a.business,i.product])).rows;
          if (i.layers.reduce((sum,l)=>sum+BigInt(l.available),0n)<i.quantity) bad('PURCHASE_STOCK_CONSUMED',409);
          i.cost = i.quantity*BigInt(i.original.unit_price);
        } else {
          const allocations = (await c.query(`SELECT l.unit_cost,al.quantity FROM pos_inventory_allocations al
            JOIN pos_inventory_movements m ON m.id=al.movement_id AND m.business_id=al.business_id
            JOIN pos_inventory_layers l ON l.id=al.layer_id AND l.business_id=al.business_id
            WHERE m.operation_id=$1 AND m.business_id=$2 AND m.product_id=$3 ORDER BY l.created_at,l.id`, [f.source,a.business,i.product])).rows;
          let skip=returned, left=i.quantity; i.restored=[]; i.cost=0n;
          for (const al of allocations) {
            const qty=BigInt(al.quantity), ignored=min(skip,qty); skip-=ignored;
            const take=min(left,qty-ignored); if(!take) continue;
            i.restored.push({quantity:take,cost:BigInt(al.unit_cost)}); i.cost+=take*BigInt(al.unit_cost); left-=take;
          }
          if(left) bad('RETURN_COST_BASIS_MISSING',409);
        }
      }
      const debt = BigInt((await c.query('SELECT coalesce(sum(amount),0) amount FROM pos_debt_movements WHERE business_id=$1 AND source_id=$2', [a.business,f.source])).rows[0].amount);
      const reduction=min(debt,f.total); f.paid=f.total-reduction; f.party=source.party_id; f.due=source.due_date; f.channel=source.channel;
      let left=f.paid; const payouts=[];
      // Deterministic allocation: outstanding AR/AP first, then source account UUID order.
      for(const ac of accounts) {
        const value=min(left,BigInt(ac.capacity)); if(value<=0n) continue;
        if(purchase && !f.confirmed || ac.kind!=='CASH' && (!f.confirmed || !f.reference)) bad('REFUND_CONFIRMATION_REQUIRED');
        if(!purchase && ac.kind==='CASH' && (!activeShift || activeShift.cash_account_id!==ac.account_id)) bad('REFUND_CASH_SHIFT_REQUIRED');
        if(!purchase) await getAccount(c,a,ac.account_id,value);
        payouts.push({account:ac.account_id,value}); left-=value;
      }
      if(left) bad('REFUND_SOURCE_FUNDS_MISSING',409);
      await insertOperation(c,a,op,kind,f);
      for(const i of items) {
        const l=i.original, movement=makeId();
        await c.query(`INSERT INTO pos_business_lines(id,business_id,operation_id,product_id,sku,name,quantity,unit_price,discount,total,cogs)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [makeId(),a.business,op.id,i.product,l.sku,l.name,i.quantity.toString(),l.unit_price,
          (i.quantity*BigInt(l.unit_price)-i.total).toString(),i.total.toString(),purchase?'0':i.cost.toString()]);
        await stockRow(c,a,op.id,i.product,movement,purchase?-i.quantity:i.quantity,i.cost,purchase?'PURCHASE_RETURN_OUT':'SALE_RETURN_IN',f.reason);
        if(purchase) {
          let remaining=i.quantity;
          for(const layer of i.layers) { const take=min(remaining,BigInt(layer.available)); if(!take)continue;
            await c.query('INSERT INTO pos_inventory_allocations(id,business_id,product_id,layer_id,movement_id,quantity) VALUES($1,$2,$3,$4,$5,$6)',
              [makeId(),a.business,i.product,layer.id,movement,take.toString()]); remaining-=take; }
        } else for(const r of i.restored) await addLayer(c,a,i.product,movement,r.quantity,r.cost);
      }
      await afterStage('return-stock');
      await debtRow(c,a,op.id,f,purchase?'AP':'AR',-reduction,f.source);
      for(const payout of payouts) await moneyRow(c,a,op.id,payout.account,purchase?payout.value:-payout.value);
      await afterStage('return-money');
      return {id:op.id,total:f.total.toString(),refund:f.paid.toString(),debt_reduction:reduction.toString(),replay:false};
    });
  }
  return { saleReturn:req=>post(req,false), purchaseReturn:req=>post(req,true) };
}
module.exports={createBusinessReturns};
