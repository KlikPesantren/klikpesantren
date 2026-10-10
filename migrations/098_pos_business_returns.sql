BEGIN;
-- Additive return protection; original 097 and posted records are unchanged.
CREATE FUNCTION pos_business_return_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o pos_business_operations%ROWTYPE; source pos_business_operations%ROWTYPE; oid uuid; money bigint; debt bigint;
BEGIN
 IF TG_TABLE_NAME='pos_business_operations' THEN oid:=NEW.id; ELSE oid:=NEW.operation_id; END IF;
 SELECT * INTO o FROM pos_business_operations WHERE id=oid;
 IF o.kind NOT IN ('SALE_RETURN','PURCHASE_RETURN') THEN RETURN NULL; END IF;
 SELECT * INTO source FROM pos_business_operations WHERE id=o.source_id AND business_id=o.business_id;
 IF NOT FOUND OR source.kind<>(CASE WHEN o.kind='SALE_RETURN' THEN 'SALE' ELSE 'PURCHASE' END) OR o.reason IS NULL THEN
  RAISE EXCEPTION 'Invalid return source' USING ERRCODE='23514';
 END IF;
 SELECT coalesce(sum(amount),0) INTO money FROM pos_money_movements WHERE operation_id=oid;
 SELECT coalesce(sum(amount),0) INTO debt FROM pos_debt_movements WHERE operation_id=oid;
 IF (SELECT coalesce(sum(total),0) FROM pos_business_lines WHERE operation_id=oid)<>o.total
 OR debt<>-(o.total-o.paid) OR (o.kind='SALE_RETURN' AND money<>-o.paid)
 OR (o.kind='PURCHASE_RETURN' AND money<>o.paid) THEN
  RAISE EXCEPTION 'Return amount mismatch' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM pos_business_lines l WHERE l.operation_id=oid AND NOT EXISTS(
   SELECT 1 FROM pos_business_lines src WHERE src.operation_id=o.source_id AND src.product_id=l.product_id AND src.business_id=l.business_id))
 OR EXISTS(SELECT 1 FROM pos_business_lines src WHERE src.operation_id=o.source_id AND (
   src.quantity<(SELECT coalesce(sum(l.quantity),0) FROM pos_business_lines l JOIN pos_business_operations r ON r.id=l.operation_id
    WHERE r.source_id=o.source_id AND r.kind=o.kind AND l.product_id=src.product_id)
   OR src.total<(SELECT coalesce(sum(l.total),0) FROM pos_business_lines l JOIN pos_business_operations r ON r.id=l.operation_id
    WHERE r.source_id=o.source_id AND r.kind=o.kind AND l.product_id=src.product_id))) THEN
  RAISE EXCEPTION 'Return exceeds original items' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM pos_business_lines l WHERE l.operation_id=oid AND NOT EXISTS(
   SELECT 1 FROM pos_inventory_movements m WHERE m.operation_id=oid AND m.product_id=l.product_id AND
   (o.kind='SALE_RETURN' AND m.kind='SALE_RETURN_IN' AND m.quantity=l.quantity AND m.cost=l.cogs
    OR o.kind='PURCHASE_RETURN' AND m.kind='PURCHASE_RETURN_OUT' AND -m.quantity=l.quantity AND m.cost=l.total))) THEN
  RAISE EXCEPTION 'Return stock mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['pos_business_operations','pos_business_lines','pos_money_movements','pos_debt_movements','pos_inventory_movements'] LOOP
 EXECUTE format('CREATE CONSTRAINT TRIGGER pos_return_reconciliation AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_business_return_guard()',t);
 END LOOP;
END $$;
COMMIT;
