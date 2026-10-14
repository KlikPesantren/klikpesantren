-- Existing-business opening position. Forward-only; no historical sale/purchase fabrication.
BEGIN;

ALTER TABLE pos_business_operations DROP CONSTRAINT pos_business_operations_kind_check;
ALTER TABLE pos_business_operations ADD CONSTRAINT pos_business_operations_kind_check CHECK(kind IN
 ('PURCHASE','SALE','SALE_RETURN','PURCHASE_RETURN','AR_COLLECTION','AP_PAYMENT','STOCK_ADJUSTMENT',
  'OPENING','OPENING_AR','OPENING_AP','OPENING_ADJUSTMENT','EXPENSE','OTHER_INCOME','CAPITAL','WITHDRAWAL','TRANSFER'));

CREATE TABLE pos_business_initializations (
 id uuid PRIMARY KEY, business_id uuid NOT NULL REFERENCES pos_businesses(id) ON DELETE CASCADE,
 request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 160), request_hash char(64) NOT NULL,
 accounting_start_date date NOT NULL,
 cash_bank_total bigint NOT NULL CHECK(cash_bank_total>=0),
 inventory_total bigint NOT NULL CHECK(inventory_total>=0),
 receivable_total bigint NOT NULL CHECK(receivable_total>=0),
 payable_total bigint NOT NULL CHECK(payable_total>=0),
 opening_equity bigint NOT NULL,
 finalized_by uuid NOT NULL, finalized_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id), UNIQUE(business_id,request_id), UNIQUE(id,business_id),
 FOREIGN KEY(business_id,finalized_by) REFERENCES pos_merchant_memberships(business_id,user_id),
 CHECK(cash_bank_total+inventory_total+receivable_total=payable_total+opening_equity)
);

CREATE TABLE pos_business_initialization_items (
 id uuid PRIMARY KEY, initialization_id uuid NOT NULL, business_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('ACCOUNT','INVENTORY','RECEIVABLE','PAYABLE')),
 account_id uuid, product_id uuid, party_id uuid, operation_id uuid NOT NULL,
 quantity bigint, unit_cost bigint, amount bigint NOT NULL CHECK(amount>=0), due_date date,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,business_id),
 FOREIGN KEY(initialization_id,business_id) REFERENCES pos_business_initializations(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,business_id) REFERENCES pos_business_accounts(id,business_id),
 FOREIGN KEY(product_id,business_id) REFERENCES pos_business_products(id,business_id),
 FOREIGN KEY(party_id,business_id) REFERENCES pos_business_parties(id,business_id),
 FOREIGN KEY(operation_id,business_id) REFERENCES pos_business_operations(id,business_id) ON DELETE CASCADE,
 CHECK((kind='ACCOUNT' AND account_id IS NOT NULL AND product_id IS NULL AND party_id IS NULL AND quantity IS NULL AND unit_cost IS NULL AND due_date IS NULL)
    OR (kind='INVENTORY' AND account_id IS NULL AND product_id IS NOT NULL AND party_id IS NULL AND quantity>0 AND unit_cost>=0 AND amount=quantity*unit_cost AND due_date IS NULL)
    OR (kind IN ('RECEIVABLE','PAYABLE') AND account_id IS NULL AND product_id IS NULL AND party_id IS NOT NULL AND quantity IS NULL AND unit_cost IS NULL AND amount>0 AND due_date IS NOT NULL))
);
CREATE UNIQUE INDEX pos_initialization_account_once ON pos_business_initialization_items(initialization_id,account_id) WHERE account_id IS NOT NULL;
CREATE UNIQUE INDEX pos_initialization_product_once ON pos_business_initialization_items(initialization_id,product_id) WHERE product_id IS NOT NULL;
CREATE UNIQUE INDEX pos_initialization_party_kind_once ON pos_business_initialization_items(initialization_id,kind,party_id) WHERE party_id IS NOT NULL;

CREATE TABLE pos_business_initialization_corrections (
 id uuid PRIMARY KEY, initialization_id uuid NOT NULL, business_id uuid NOT NULL,
 request_id text NOT NULL CHECK(length(request_id) BETWEEN 8 AND 160), request_hash char(64) NOT NULL,
 kind text NOT NULL CHECK(kind IN ('ACCOUNT','INVENTORY','RECEIVABLE','PAYABLE')),
 account_id uuid, product_id uuid, party_id uuid, operation_id uuid NOT NULL,
 amount_delta bigint, quantity_delta bigint, unit_cost bigint, reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 500),
 corrected_by uuid NOT NULL, corrected_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(business_id,request_id), UNIQUE(id,business_id),
 FOREIGN KEY(initialization_id,business_id) REFERENCES pos_business_initializations(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(account_id,business_id) REFERENCES pos_business_accounts(id,business_id),
 FOREIGN KEY(product_id,business_id) REFERENCES pos_business_products(id,business_id),
 FOREIGN KEY(party_id,business_id) REFERENCES pos_business_parties(id,business_id),
 FOREIGN KEY(operation_id,business_id) REFERENCES pos_business_operations(id,business_id) ON DELETE CASCADE,
 FOREIGN KEY(business_id,corrected_by) REFERENCES pos_merchant_memberships(business_id,user_id),
 CHECK((kind='ACCOUNT' AND account_id IS NOT NULL AND product_id IS NULL AND party_id IS NULL AND amount_delta<>0 AND quantity_delta IS NULL AND unit_cost IS NULL)
    OR (kind='INVENTORY' AND account_id IS NULL AND product_id IS NOT NULL AND party_id IS NULL AND amount_delta IS NOT NULL AND quantity_delta<>0 AND unit_cost>=0)
    OR (kind IN ('RECEIVABLE','PAYABLE') AND account_id IS NULL AND product_id IS NULL AND party_id IS NOT NULL AND amount_delta<>0 AND quantity_delta IS NULL AND unit_cost IS NULL))
);
CREATE INDEX pos_initialization_correction_history ON pos_business_initialization_corrections(business_id,corrected_at,id);

-- Posted opening snapshots are append-only. DELETE remains available only for authorized tenant lifecycle cleanup.
CREATE TRIGGER pos_business_initialization_history BEFORE UPDATE ON pos_business_initializations FOR EACH ROW EXECUTE FUNCTION pos_business_immutable();
CREATE TRIGGER pos_business_initialization_item_history BEFORE UPDATE ON pos_business_initialization_items FOR EACH ROW EXECUTE FUNCTION pos_business_immutable();
CREATE TRIGGER pos_business_initialization_correction_history BEFORE UPDATE ON pos_business_initialization_corrections FOR EACH ROW EXECUTE FUNCTION pos_business_immutable();

-- Extend the existing deferred reconciliation without weakening any prior operation contract.
CREATE OR REPLACE FUNCTION pos_business_reconciles() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o pos_business_operations%ROWTYPE; oid uuid; money bigint; debt bigint; lines bigint;
BEGIN
 IF TG_TABLE_NAME='pos_business_operations' THEN oid:=NEW.id;
 ELSIF TG_TABLE_NAME='pos_inventory_layers' THEN SELECT operation_id INTO oid FROM pos_inventory_movements WHERE id=NEW.movement_id;
 ELSIF TG_TABLE_NAME='pos_inventory_allocations' THEN SELECT operation_id INTO oid FROM pos_inventory_movements WHERE id=NEW.movement_id;
 ELSE oid:=NEW.operation_id; END IF;
 SELECT * INTO o FROM pos_business_operations WHERE id=oid;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT coalesce(sum(amount),0) INTO money FROM pos_money_movements WHERE operation_id=oid;
 SELECT coalesce(sum(amount),0) INTO debt FROM pos_debt_movements WHERE operation_id=oid;
 SELECT coalesce(sum(total),0) INTO lines FROM pos_business_lines WHERE operation_id=oid;
 IF (o.kind='PURCHASE' AND (money<>-o.paid OR debt<>o.total-o.paid OR lines<>o.total))
 OR (o.kind='SALE' AND (money<>o.paid OR debt<>o.total-o.paid OR lines<>o.total
   OR (SELECT coalesce(sum(amount),0) FROM pos_business_payments WHERE operation_id=oid)<>o.total
   OR (SELECT coalesce(sum(amount),0) FROM pos_business_payments WHERE operation_id=oid AND method='CREDIT')<>debt))
 OR (o.kind IN ('AP_PAYMENT','AR_COLLECTION') AND (debt<>-o.total OR money<>CASE WHEN o.kind='AP_PAYMENT' THEN -o.total ELSE o.total END))
 OR (o.kind='OPENING_AR' AND (money<>0 OR debt<>o.total OR NOT EXISTS(SELECT 1 FROM pos_debt_movements WHERE operation_id=oid AND kind='AR')))
 OR (o.kind='OPENING_AP' AND (money<>0 OR debt<>o.total OR NOT EXISTS(SELECT 1 FROM pos_debt_movements WHERE operation_id=oid AND kind='AP')))
 OR (o.kind IN ('OPENING','CAPITAL','OTHER_INCOME') AND (money<>o.total OR debt<>0))
 OR (o.kind IN ('EXPENSE','WITHDRAWAL') AND (money<>-o.total OR debt<>0))
 OR (o.kind='TRANSFER' AND (money<>0 OR (SELECT count(*) FROM pos_money_movements WHERE operation_id=oid)<>2))
 OR (o.kind='STOCK_ADJUSTMENT' AND (money<>0 OR debt<>0)) THEN
  RAISE EXCEPTION 'Merchant money/debt/item reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF o.kind='OPENING_ADJUSTMENT' AND NOT EXISTS(
   SELECT 1 FROM pos_business_initialization_corrections c WHERE c.operation_id=oid AND c.business_id=o.business_id
   AND o.total=abs(c.amount_delta)
   AND ((c.kind='ACCOUNT' AND money=c.amount_delta AND debt=0)
     OR (c.kind='RECEIVABLE' AND money=0 AND debt=c.amount_delta AND EXISTS(SELECT 1 FROM pos_debt_movements d WHERE d.operation_id=oid AND d.kind='AR'))
     OR (c.kind='PAYABLE' AND money=0 AND debt=c.amount_delta AND EXISTS(SELECT 1 FROM pos_debt_movements d WHERE d.operation_id=oid AND d.kind='AP'))
     OR (c.kind='INVENTORY' AND money=0 AND debt=0 AND EXISTS(SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND m.quantity=c.quantity_delta AND m.cost=abs(c.amount_delta)))))
 THEN RAISE EXCEPTION 'Opening correction reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF o.kind='SALE' AND EXISTS(SELECT 1 FROM pos_business_lines l WHERE l.operation_id=oid AND NOT EXISTS(
   SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND m.product_id=l.product_id
   AND m.kind='SALE_OUT' AND -m.quantity=l.quantity AND m.cost=l.cogs)) THEN
  RAISE EXCEPTION 'Sale stock/COGS reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF o.kind='PURCHASE' AND EXISTS(SELECT 1 FROM pos_business_lines l WHERE l.operation_id=oid AND NOT EXISTS(
   SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND m.product_id=l.product_id
   AND m.kind='PURCHASE_IN' AND m.quantity=l.quantity AND m.cost=l.total)) THEN
  RAISE EXCEPTION 'Purchase stock reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM pos_inventory_layers l WHERE l.business_id=o.business_id AND
    l.received_quantity<(SELECT coalesce(sum(quantity),0) FROM pos_inventory_allocations WHERE layer_id=l.id)) THEN
  RAISE EXCEPTION 'Inventory oversold' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND (
   (m.quantity>0 AND (m.quantity<>(SELECT coalesce(sum(received_quantity),0) FROM pos_inventory_layers WHERE movement_id=m.id)
    OR m.cost<>(SELECT coalesce(sum(received_quantity*unit_cost),0) FROM pos_inventory_layers WHERE movement_id=m.id)))
   OR (m.quantity<0 AND (-m.quantity<>(SELECT coalesce(sum(quantity),0) FROM pos_inventory_allocations WHERE movement_id=m.id)
    OR m.cost<>(SELECT coalesce(sum(a.quantity*l.unit_cost),0) FROM pos_inventory_allocations a JOIN pos_inventory_layers l ON l.id=a.layer_id WHERE a.movement_id=m.id))))) THEN
  RAISE EXCEPTION 'Inventory quantity/cost reconciliation mismatch' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM pos_debt_movements WHERE business_id=o.business_id GROUP BY source_id HAVING sum(amount)<0) THEN
  RAISE EXCEPTION 'Debt overpayment' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;

COMMIT;
