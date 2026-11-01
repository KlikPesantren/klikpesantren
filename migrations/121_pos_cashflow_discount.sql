BEGIN;
-- Additive schema; no historical pricing configuration or financial amounts are rewritten.
ALTER TABLE pos_price_promotions ADD COLUMN discount_bps integer, ADD COLUMN discount_amount bigint;
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT conname FROM pg_constraint WHERE conrelid='pos_price_promotions'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%kind%' LOOP
  EXECUTE format('ALTER TABLE pos_price_promotions DROP CONSTRAINT %I',r.conname);
 END LOOP;
END $$;
ALTER TABLE pos_price_promotions ADD CONSTRAINT pos_promotion_kind CHECK(kind IN('QUANTITY','BUNDLE','PERCENT','FIXED')),
 ADD CONSTRAINT pos_promotion_shape CHECK(
 (kind='QUANTITY' AND product_id IS NOT NULL AND threshold>0 AND discount_bps IS NULL AND discount_amount IS NULL) OR
 (kind='BUNDLE' AND product_id IS NULL AND threshold IS NULL AND discount_bps IS NULL AND discount_amount IS NULL) OR
 (kind='PERCENT' AND product_id IS NOT NULL AND threshold=1 AND discount_bps IS NOT NULL AND discount_bps BETWEEN 0 AND 10000 AND discount_amount IS NULL AND group_price=0) OR
 (kind='FIXED' AND product_id IS NOT NULL AND threshold=1 AND discount_amount IS NOT NULL AND discount_amount>=0 AND discount_bps IS NULL AND group_price=0));
ALTER TABLE pos_business_operations DROP CONSTRAINT pos_business_operations_kind_check;
ALTER TABLE pos_business_operations ADD CONSTRAINT pos_business_operations_kind_check CHECK(kind IN
 ('PURCHASE','SALE','SALE_RETURN','PURCHASE_RETURN','AR_COLLECTION','AP_PAYMENT','STOCK_ADJUSTMENT',
 'OPENING','OPENING_AR','OPENING_AP','OPENING_ADJUSTMENT','EXPENSE','OTHER_INCOME','CAPITAL','WITHDRAWAL','TRANSFER','MONEY_REVERSAL'));
CREATE UNIQUE INDEX pos_money_single_reversal ON pos_business_operations(business_id,source_id) WHERE kind='MONEY_REVERSAL';
CREATE UNIQUE INDEX pos_money_single_correction ON pos_business_operations(business_id,source_id) WHERE receipt_snapshot->>'finance_action'='CORRECTION';
CREATE FUNCTION pos_money_revision_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o pos_business_operations%ROWTYPE; src pos_business_operations%ROWTYPE; oid uuid;
BEGIN
 IF TG_TABLE_NAME='pos_business_operations' THEN oid:=NEW.id; ELSE oid:=NEW.operation_id; END IF;
 SELECT * INTO o FROM pos_business_operations WHERE id=oid;
 IF o.receipt_snapshot->>'finance_action'='CORRECTION' AND (NOT EXISTS(SELECT 1 FROM pos_business_operations parent_source WHERE parent_source.id=o.source_id AND parent_source.business_id=o.business_id AND parent_source.kind IN('EXPENSE','OTHER_INCOME') AND parent_source.kind=o.kind) OR NOT EXISTS(SELECT 1 FROM pos_business_operations rev WHERE rev.source_id=o.source_id AND rev.business_id=o.business_id AND rev.kind='MONEY_REVERSAL' AND rev.receipt_snapshot->>'action'='CORRECT')) THEN RAISE EXCEPTION 'MONEY_CORRECTION_REQUIRES_REVERSAL' USING ERRCODE='23514'; END IF;
 IF o.kind<>'MONEY_REVERSAL' AND EXISTS(SELECT 1 FROM pos_business_operations WHERE source_id=o.id AND business_id=o.business_id AND kind='MONEY_REVERSAL') THEN SELECT * INTO o FROM pos_business_operations WHERE source_id=oid AND business_id=o.business_id AND kind='MONEY_REVERSAL'; END IF;
 IF o.kind='MONEY_REVERSAL' THEN
  SELECT * INTO src FROM pos_business_operations WHERE id=o.source_id AND business_id=o.business_id;
  IF NOT FOUND OR o.receipt_snapshot->>'original_kind' IS DISTINCT FROM src.kind OR src.kind NOT IN('EXPENSE','OTHER_INCOME','TRANSFER') OR o.total<>src.total OR o.paid<>src.paid
   OR coalesce(length(btrim(o.reason)),0)=0 OR o.receipt_snapshot->>'finance_action' IS DISTINCT FROM 'REVERSAL'
   OR o.party_id IS NOT NULL OR o.shift_id IS NOT NULL THEN
   RAISE EXCEPTION 'INVALID_MONEY_REVERSAL' USING ERRCODE='23514';
  END IF;
  IF src.source_id IS NOT NULL AND src.receipt_snapshot->>'finance_action' IS DISTINCT FROM 'CORRECTION'
   AND NOT EXISTS(SELECT 1 FROM pos_business_operations parent JOIN pos_business_operations rev ON rev.source_id=parent.id AND rev.business_id=parent.business_id AND rev.kind='MONEY_REVERSAL' WHERE parent.id=src.source_id AND parent.business_id=src.business_id AND parent.kind='TRANSFER') THEN
   RAISE EXCEPTION 'LINKED_OPERATION_REQUIRES_DOMAIN_REVERSAL' USING ERRCODE='23514';
  END IF;
  IF o.receipt_snapshot->>'action'='CORRECT' AND NOT EXISTS(SELECT 1 FROM pos_business_operations replacement WHERE replacement.business_id=o.business_id AND replacement.source_id=src.id AND replacement.kind=src.kind AND replacement.receipt_snapshot->>'finance_action'='CORRECTION') THEN RAISE EXCEPTION 'MONEY_CORRECTION_REPLACEMENT_REQUIRED' USING ERRCODE='23514'; END IF;
  IF EXISTS((SELECT account_id,-amount FROM pos_money_movements WHERE operation_id=src.id AND business_id=o.business_id EXCEPT ALL SELECT account_id,amount FROM pos_money_movements WHERE operation_id=o.id AND business_id=o.business_id)
    UNION ALL (SELECT account_id,amount FROM pos_money_movements WHERE operation_id=o.id AND business_id=o.business_id EXCEPT ALL SELECT account_id,-amount FROM pos_money_movements WHERE operation_id=src.id AND business_id=o.business_id))
   OR NOT EXISTS(SELECT 1 FROM pos_money_movements WHERE operation_id=src.id)
   OR EXISTS(SELECT 1 FROM pos_business_lines WHERE operation_id=o.id)
   OR EXISTS(SELECT 1 FROM pos_debt_movements WHERE operation_id=o.id)
   OR EXISTS(SELECT 1 FROM pos_inventory_movements WHERE operation_id=o.id)
   OR EXISTS(SELECT 1 FROM pos_business_payments WHERE operation_id=o.id) THEN
   RAISE EXCEPTION 'MONEY_REVERSAL_LEGS_MISMATCH' USING ERRCODE='23514';
  END IF;
 ELSIF o.receipt_snapshot->>'finance_action'='CORRECTION' THEN
  SELECT * INTO src FROM pos_business_operations WHERE id=o.source_id AND business_id=o.business_id;
  IF NOT FOUND OR src.kind NOT IN('EXPENSE','OTHER_INCOME') OR src.kind<>o.kind
   OR NOT EXISTS(SELECT 1 FROM pos_business_operations WHERE source_id=src.id AND business_id=src.business_id AND kind='MONEY_REVERSAL' AND receipt_snapshot->>'action'='CORRECT') THEN
   RAISE EXCEPTION 'MONEY_CORRECTION_REQUIRES_REVERSAL' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER pos_money_revision_guard AFTER INSERT ON pos_business_operations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_money_revision_guard();
CREATE CONSTRAINT TRIGGER pos_money_revision_guard AFTER INSERT ON pos_money_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_money_revision_guard();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['pos_business_lines','pos_inventory_movements','pos_debt_movements','pos_business_payments'] LOOP EXECUTE format('CREATE CONSTRAINT TRIGGER pos_money_revision_guard AFTER INSERT ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION pos_money_revision_guard()',t); END LOOP; END $$;
ALTER TABLE pos_money_movements ALTER COLUMN created_at SET DEFAULT clock_timestamp();
COMMIT;
