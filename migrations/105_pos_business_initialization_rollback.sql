BEGIN;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pos_business_initializations LIMIT 1) THEN
  RAISE EXCEPTION 'Refusing rollback: business initialization history exists';
 END IF;
END $$;
DROP TABLE pos_business_initialization_corrections;
DROP TABLE pos_business_initialization_items;
DROP TABLE pos_business_initializations;
ALTER TABLE pos_business_operations DROP CONSTRAINT pos_business_operations_kind_check;
ALTER TABLE pos_business_operations ADD CONSTRAINT pos_business_operations_kind_check CHECK(kind IN
 ('PURCHASE','SALE','SALE_RETURN','PURCHASE_RETURN','AR_COLLECTION','AP_PAYMENT','STOCK_ADJUSTMENT',
  'OPENING','EXPENSE','OTHER_INCOME','CAPITAL','WITHDRAWAL','TRANSFER'));
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
 OR (o.kind IN ('OPENING','CAPITAL','OTHER_INCOME') AND (money<>o.total OR debt<>0))
 OR (o.kind IN ('EXPENSE','WITHDRAWAL') AND (money<>-o.total OR debt<>0))
 OR (o.kind='TRANSFER' AND (money<>0 OR (SELECT count(*) FROM pos_money_movements WHERE operation_id=oid)<>2))
 OR (o.kind='STOCK_ADJUSTMENT' AND (money<>0 OR debt<>0)) THEN
  RAISE EXCEPTION 'Merchant money/debt/item reconciliation mismatch' USING ERRCODE='23514';
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
